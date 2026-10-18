-- Backend half of the bridge. The frontend extracts the toast text inside
-- Steam's JS context and hands it here; this end is only responsible for
-- getting it to the notification daemon.

local logger = require("logger")
local millennium = require("millennium")
local json = require("json")
local fs = require("fs")

local APP_NAME = "Steam"

-- Platform, decided once. Lua's package.config opens with the directory
-- separator: "\" on Windows, "/" everywhere else (LuaJIT sets it like PUC
-- Lua). macOS shares the "/" and is told apart by LuaJIT's jit.os ("OSX";
-- Millennium's host is LuaJIT and opens the standard libraries, so the jit
-- table should be there), falling back to the SystemVersion.plist every
-- macOS carries when no jit table is exposed. Every path and spawn below
-- branches on these, nothing else asks the OS. docs/platforms.md is the
-- plan for the platforms that do not deliver yet.
local SEP = (type(package) == "table" and type(package.config) == "string")
    and package.config:sub(1, 1) or "/"
local IS_WINDOWS = SEP == "\\"
local function detect_macos()
    if IS_WINDOWS then return false end
    if type(jit) == "table" and type(jit.os) == "string" then
        return jit.os == "OSX"
    end
    local probe = io.open("/System/Library/CoreServices/SystemVersion.plist", "r")
    if probe then
        probe:close()
        return true
    end
    return false
end
local IS_MACOS = detect_macos()
local PLATFORM = IS_WINDOWS and "windows" or (IS_MACOS and "macos" or "linux")

---@ffi
---@return string
function Platform()
    return PLATFORM
end
-- Set by flatpak inside an app's sandbox (Steam's is com.valvesoftware.Steam).
-- Millennium does not run there today; logged so a run that does is
-- recognisable, and every $HOME-relative path below already resolves inside
-- the sandbox through Steam's --persist=. bind mount.
local FLATPAK_ID = (PLATFORM == "linux") and os.getenv("FLATPAK_ID") or nil

--- Separator-safe join. A trailing separator on a piece is dropped first, so
--- a steam_path() that answers with one (Millennium's Linux build does) or a
--- cache variable typed with one never doubles up. Millennium's fs has a
--- join as well; this one needs no module, so the paths it builds exist
--- before any require can fail and the offline tests exercise the same code.
local function join(...)
    local pieces = { ... }
    local path = pieces[1]
    for i = 2, #pieces do
        path = (path:gsub("[/\\]+$", "")) .. SEP .. pieces[i]
    end
    return path
end

-- The packed .star is never unpacked on disk, so there is no plugin directory
-- at runtime. Everything file-shaped lives in a cache directory instead: the
-- notify-action helper is carried inside the .star as an asset and written out
-- here at load, and tools/fire drops its command file here too. XDG_CACHE_HOME
-- to match the helper's own icon cache next door (inside a Flatpak sandbox
-- flatpak points it at the per-app cache, which is where it should be); on
-- Windows the per-user local (non-roaming) app data folder and on macOS the
-- user's Library/Caches, the same role on each.
local function runtime_dir()
    local home = os.getenv("HOME") or ""
    if IS_WINDOWS then
        local base = os.getenv("LOCALAPPDATA")
            or join(os.getenv("USERPROFILE") or "", "AppData", "Local")
        return join(base, "steam-native-notifications")
    end
    if IS_MACOS then
        return join(home, "Library", "Caches", "steam-native-notifications")
    end
    -- A set-but-empty XDG_CACHE_HOME counts as unset (the base directory
    -- spec), as it does in tools/lib/snn.ts.
    local cache = os.getenv("XDG_CACHE_HOME")
    if cache == nil or cache == "" then cache = join(home, ".cache") end
    return join(cache, "steam-native-notifications")
end
local RUNTIME_DIR = runtime_dir()
-- Windows delivers through a PowerShell helper (clicks come back through
-- Steam's own steam:// dispatch, frontend/steamurl.ts); POSIX through the sh
-- helper. Each platform materializes only what it runs.
local HELPER = join(RUNTIME_DIR, IS_WINDOWS and "notify-action.ps1" or "notify-action")
local HELPER_ASSET = IS_WINDOWS and "tools/notify-action.ps1" or "tools/notify-action"
local LOG_FILE = join(RUNTIME_DIR, "plugin.log")

--- Millennium keeps a packed plugin's logger output in an in-memory buffer
--- (readable in its UI log viewer) and never writes it to Steam's
--- console-linux.txt, which would blind tools/capture. Every line is mirrored
--- into a session log file next to the helper; on_load truncates it, so the
--- file always describes the current Steam session.
local function log_line(level, line)
    local tagged = "[steam-native-notifications] " .. line
    if level == "error" then logger:error(tagged) else logger:info(tagged) end
    local handle = io.open(LOG_FILE, "a")
    if handle then
        handle:write(os.date("[%Y-%m-%d %H:%M:%S] ") .. tagged .. "\n")
        handle:close()
    end
end

--- POSIX single-quote escaping: end the quote, add an escaped quote, reopen.
--- Everything else inside single quotes is literal, so this is sufficient.
--- POSIX only: cmd.exe and PowerShell quote differently, and the Windows
--- branch of spawn_helper brings its own (docs/platforms.md).
local function shell_quote(value)
    local escaped = tostring(value):gsub("'", "'\\''")
    return "'" .. escaped .. "'"
end

--- Write one bundled asset into RUNTIME_DIR. Runs on every load, so the
--- on-disk copy always matches the packed plugin. Spawned through `sh` on
--- POSIX (io.open cannot set an executable bit, and does not need to).
--- Written in binary mode: a no-op on POSIX, and the only mode that keeps a
--- packed asset byte-identical on Windows, where text mode rewrites line
--- endings.
local function materialize_asset(asset, target)
    local content = millennium.assets.read(asset)
    if type(content) ~= "string" or content == "" then
        return nil, "asset " .. asset .. " missing from the plugin bundle"
    end
    fs.create_directories(RUNTIME_DIR)
    local handle, err = io.open(target, "wb")
    if not handle then return nil, tostring(err) end
    -- A short write (disk full, a quota) surfaces on write or on close, and
    -- either would otherwise report a truncated helper as installed.
    local written, write_err = handle:write(content)
    local closed, close_err = handle:close()
    if not written then return nil, tostring(write_err) end
    if not closed then return nil, tostring(close_err) end
    return target
end

local function install_helper()
    if IS_WINDOWS then
        local path, err = materialize_asset('tools/game-focus.ps1', join(RUNTIME_DIR, 'game-focus.ps1'))
        if not path then return nil, err end
    end
    return materialize_asset(HELPER_ASSET, HELPER)
end

--- CreateProcessW through LuaJIT's ffi: the one way to start a child with
--- no console from Millennium's GUI-subsystem Lua host (os.execute is the C
--- runtime's system(), which runs cmd.exe and flashes a window per call;
--- io.popen is _popen, documented to hang in GUI programs). Lazy and under
--- pcall: whether the host enables ffi is the first hardware check in
--- docs/platforms.md, and a host without it must degrade to a log line,
--- never a load failure.
local win_ffi
local function windows_ffi()
    if win_ffi ~= nil then return win_ffi or nil end
    local ok, ffi = pcall(require, "ffi")
    if not ok or type(ffi) ~= "table" then
        win_ffi = false
        return nil
    end
    pcall(ffi.cdef, [[
        typedef struct {
            uint32_t cb; void* lpReserved; void* lpDesktop; void* lpTitle;
            uint32_t dwX, dwY, dwXSize, dwYSize, dwXCountChars, dwYCountChars,
                dwFillAttribute, dwFlags;
            uint16_t wShowWindow, cbReserved2; void* lpReserved2;
            void* hStdInput; void* hStdOutput; void* hStdError;
        } SNN_STARTUPINFOW;
        typedef struct {
            void* hProcess; void* hThread; uint32_t dwProcessId, dwThreadId;
        } SNN_PROCESS_INFORMATION;
        int32_t CreateProcessW(const wchar_t*, wchar_t*, void*, void*, int32_t,
            uint32_t, void*, const wchar_t*, SNN_STARTUPINFOW*,
            SNN_PROCESS_INFORMATION*);
        int32_t CloseHandle(void*);
        uint32_t WaitForSingleObject(void*, uint32_t);
        int32_t TerminateProcess(void*, uint32_t);
        int MultiByteToWideChar(unsigned int, uint32_t, const char*, int,
            wchar_t*, int);
    ]])
    win_ffi = ffi
    return ffi
end

--- UTF-8 to UTF-16 for the W-suffixed API; LOCALAPPDATA can carry any
--- username, so the command line cannot be assumed ASCII.
local function to_wide(ffi, text)
    local CP_UTF8 = 65001
    local needed = ffi.C.MultiByteToWideChar(CP_UTF8, 0, text, #text, nil, 0)
    if needed <= 0 then return nil end
    local buffer = ffi.new("wchar_t[?]", needed + 1)
    ffi.C.MultiByteToWideChar(CP_UTF8, 0, text, #text, buffer, needed)
    buffer[needed] = 0
    return buffer
end

--- Start Windows PowerShell (5.1: pwsh cannot project WinRT) on the
--- materialized helper with CREATE_NO_WINDOW, detached. False, with the
--- reason logged, when ffi is missing or the call fails.
local function spawn_windows_helper(arguments, wait_ms, helper)
    local ffi = windows_ffi()
    if not ffi then
        log_line("error",
            "ffi unavailable in this Lua host; Windows delivery needs it (docs/platforms.md)")
        return false
    end
    local system_root = os.getenv("SystemRoot") or "C:\\Windows"
    local powershell = join(system_root, "System32", "WindowsPowerShell", "v1.0", "powershell.exe")
    local command = '"' .. powershell .. '" -NoProfile -NonInteractive'
        .. ' -ExecutionPolicy Bypass -File "' .. (helper or HELPER) .. '" ' .. arguments
    local ok, spawned = pcall(function()
        local CREATE_NO_WINDOW = 0x08000000
        local startup = ffi.new("SNN_STARTUPINFOW")
        startup.cb = ffi.sizeof("SNN_STARTUPINFOW")
        local process = ffi.new("SNN_PROCESS_INFORMATION")
        local wide = to_wide(ffi, command)
        if not wide then return false end
        if ffi.C.CreateProcessW(nil, wide, nil, nil, 0, CREATE_NO_WINDOW,
            nil, nil, startup, process) == 0 then
            return false
        end
        local completed = true
        if wait_ms then
            completed = ffi.C.WaitForSingleObject(process.hProcess, wait_ms) == 0
            if not completed then ffi.C.TerminateProcess(process.hProcess, 1) end
        end
        ffi.C.CloseHandle(process.hProcess)
        ffi.C.CloseHandle(process.hThread)
        return completed
    end)
    if not ok or not spawned then
        log_line("error", "CreateProcessW failed for the Windows helper"
            .. (ok and "" or (": " .. tostring(spawned))))
        return false
    end
    return true
end

local notify_seq = 0

--- Hand the delivery slots to the platform's helper, detached, and say
--- whether anything was spawned. The one seam that knows how a process
--- starts on each OS; Notify above it is OS-blind.
---
--- POSIX: `sh <helper> ... >/dev/null 2>&1 &`. Backgrounded because the
--- helper can block for the notification daemon's action lifetime, and this
--- backend's single event loop must keep answering the frontend's polls.
---
--- Windows (EXPERIMENTAL; docs/platforms.md lists the hardware checks): the
--- six slots travel as a <id>.notify JSON file --
--- a file, not a command line, so quoting stays out of the contract -- and
--- notify-action.ps1 is started through CreateProcessW above and exits after
--- Show(). A click returns through Steam's own steam:// URL handling; only
--- then does the frontend request a short, route-aware focus helper.
---
--- macOS: not implemented. sh is there but notify-send and gdbus are not;
--- the helper would fail on its own, and does so loudly, but nothing is
--- gained by spawning it. The delivery design (terminal-notifier or alerter)
--- is docs/platforms.md.
---
--- Until macOS lands this logs and returns false there, so an install on
--- that platform fails in the log rather than in silence.
local function spawn_helper(title, body, raw_image, route, ingame, suppress_popup)
    if IS_MACOS then
        log_line("error", "unsupported platform: macos"
            .. " delivery is not implemented, notification dropped")
        return false
    end
    if IS_WINDOWS then
        notify_seq = notify_seq + 1
        local id = tostring(os.time()) .. "-" .. tostring(notify_seq)
        local file = join(RUNTIME_DIR, id .. ".notify")
        local handle = io.open(file, "wb")
        if not handle then
            log_line("error", "could not write " .. file .. "; notification dropped")
            return false
        end
        -- Checked like materialize_asset: a short write would hand the
        -- helper a truncated JSON file and report "ok", losing the
        -- notification on both surfaces (the frontend closes Steam's toast
        -- on "ok").
        local written = handle:write(json.encode({
            title = title, body = body, image = raw_image,
            route = route, ingame = ingame, suppressPopup = suppress_popup,
        }))
        local closed = handle:close()
        if not written or not closed then
            log_line("error", "payload write failed for " .. file .. "; notification dropped")
            os.remove(file)
            return false
        end
        if not spawn_windows_helper('-Id "' .. id .. '"') then
            os.remove(file)
            return false
        end
        return true
    end
    local command = table.concat({
        "sh",
        shell_quote(HELPER),
        shell_quote(title), shell_quote(body), shell_quote(raw_image),
        shell_quote(route), shell_quote(ingame),
        ">/dev/null 2>&1 &",
    }, " ")
    os.execute(command)
    return true
end

--- Positional over the ffi bridge: title, body, image, route, ingame,
--- suppressPopup. The first five slots stay identical to tools/notify-action.
--- (The old callable
--- transport could not order multiple arguments, so everything once arrived
--- as one JSON string.)
---
--- Called from the frontend via ffi('Notify').
--- Backgrounded: a notification daemon that is slow, restarting, or absent must
--- never block the Steam UI thread that called into us.
---@ffi
---@param title any
---@param body any
---@param image any
---@param route any
---@param ingame any
---@param suppressPopup any
---@return string
function Notify(title, body, image, route, ingame, suppressPopup)
    title = (title ~= nil and title ~= "") and tostring(title) or APP_NAME
    body = body ~= nil and tostring(body) or ""
    local raw_image = image ~= nil and tostring(image) or ""
    route = route ~= nil and tostring(route) or ""
    ingame = ingame ~= nil and tostring(ingame) or ""
    local suppress_popup = suppressPopup == "true"

    -- This end is a marshaller: quote and hand over. Everything the daemon
    -- needs done to the values (markup escaping, icon resolution, the click)
    -- happens in the helper, next to the notify-send that renders them. The
    -- first five positional arguments are a contract shared with tools/notify-action
    -- and tools/test-backend. A missing helper was already reported loudly at
    -- load; delivering without it would mean a second, untested notify-send.
    if not spawn_helper(title, body, raw_image, route, ingame, suppress_popup) then
        return "unsupported"
    end
    return "ok"
end

--- Run the bounded Windows foreground pulse after a click has dispatched.
--- Delivery never waits for activation: one helper exists only while it is
--- finding and raising the requested Steam window.
---@ffi
---@param kind any
---@return string
function FocusSteam(kind)
    kind = tostring(kind or "")
    if not IS_WINDOWS or (kind ~= "chat" and kind ~= "main") then
        return "unsupported"
    end
    if not spawn_windows_helper('-FocusKind "' .. kind .. '"') then
        return "unsupported"
    end
    return "ok"
end

---@ffi
---@param line any
---@return string
function Log(line)
    log_line("info", tostring(line or ""))
    return "ok"
end

--- The current user's steamid64, from loginusers.vdf ("MostRecent" "1").
--- Server-notification routes point at the user's own community pages
--- (profiles/<steamid64>/tradeoffers and the like), exactly as Steam's own
--- click handlers build them; the frontend has no filesystem, so this end
--- supplies the id.
---
--- Millennium's own answer for the Steam directory, or nil. The registry
--- SteamPath on Windows, ~/.steam/steam/ on Linux, and on macOS the app
--- bundle's MacOS directory, which is not where Steam keeps its data.
--- Millennium documents that it need not be where Millennium itself lives,
--- which is fine; the files wanted here belong to Steam.
local function millennium_steam_dir()
    local ok, steam = pcall(function() return millennium.steam_path() end)
    if ok and type(steam) == "string" and steam ~= "" then
        return (steam:gsub("[/\\]+$", ""))
    end
    return nil
end

--- Every directory Steam's data (config/, appcache/) may live in on this
--- platform, most authoritative first; the caller takes the first that has
--- the file it wants. Millennium's answer leads. Linux then tries the native
--- locations before Steam's Flatpak per-app directory as the host sees it
--- (inside the sandbox $HOME-relative paths already resolve there through
--- --persist=., so the native entries cover that case too). macOS adds the
--- Application Support data directory the bundle answer leaves out. Windows
--- has no guess: the registry is the only source, and Millennium reads it.
local function steam_dir_candidates()
    local dirs = { millennium_steam_dir() }
    if IS_WINDOWS then return dirs end
    local home = os.getenv("HOME") or ""
    if IS_MACOS then
        dirs[#dirs + 1] = join(home, "Library", "Application Support", "Steam")
        return dirs
    end
    dirs[#dirs + 1] = join(home, ".steam", "steam")
    dirs[#dirs + 1] = join(home, ".local", "share", "Steam")
    local flatpak = join(home, ".var", "app", "com.valvesoftware.Steam")
    dirs[#dirs + 1] = join(flatpak, ".local", "share", "Steam")
    dirs[#dirs + 1] = join(flatpak, ".steam", "steam")
    return dirs
end

-- Same restricted VDF grammar as standalone/login-user.ts; shared fixtures pin parity.
local function login_user(text)
    local offset, invalid = 1, false
    local function token()
        while offset <= #text do
            local char = text:sub(offset, offset)
            if char:match("%s") then offset = offset + 1
            elseif text:sub(offset, offset + 1) == "//" then
                offset = (text:find("[\r\n]", offset + 2) or #text) + 1
            elseif char == '"' then
                offset = offset + 1
                local value = '"'
                while offset <= #text do
                    char = text:sub(offset, offset)
                    offset = offset + 1
                    if char == '"' then return value end
                    if char == "\\" then
                        if offset > #text then invalid = true; return nil end
                        char = text:sub(offset, offset)
                        offset = offset + 1
                    end
                    value = value .. char
                end
                invalid = true; return nil
            elseif char == "{" or char == "}" then offset = offset + 1; return char
            else invalid = true; return nil end
        end
        return nil
    end
    local function string_value(value)
        if value and value:sub(1, 1) == '"' then return value:sub(2) end
    end
    local name = string_value(token())
    if not name or name:lower() ~= "users" or token() ~= "{" then return nil end
    local accounts, recent, seen = {}, {}, {}
    local value = token()
    while value ~= "}" do
        local id = string_value(value)
        if not id or not id:match("^7656119%d%d%d%d%d%d%d%d%d%d$") or seen[id] or token() ~= "{" then return nil end
        seen[id] = true
        accounts[#accounts + 1] = id
        local fields = {}
        value = token()
        while value ~= "}" do
            local key, field = string_value(value), string_value(token())
            if not key or not field then return nil end
            key = key:lower()
            if fields[key] then return nil end
            fields[key] = true
            if key == "mostrecent" and field == "1" then recent[#recent + 1] = id end
            value = token()
        end
        value = token()
    end
    -- A trailing malformed token must not turn a damaged file into a valid identity.
    if token() ~= nil or invalid or offset <= #text then return nil end
    if #recent == 1 then return recent[1] end
    if #recent == 0 and #accounts == 1 then return accounts[1] end
    return nil
end

local function most_recent_steamid()
    for _, dir in ipairs(steam_dir_candidates()) do
        local handle = io.open(join(dir, "config", "loginusers.vdf"), "r")
        if handle then
            local text = handle:read("*a")
            handle:close()
            -- The first existing file is authoritative, including ambiguity or damage.
            return login_user(text)
        end
    end
    return nil
end

---@ffi
---@return string
function Identity()
    return json.encode({ steamid64 = most_recent_steamid() })
end

--- The helper resolves game art under <steam>/appcache/librarycache, and
--- only this end can ask Millennium where <steam> is. Handed over in a file
--- rather than on the command line, so the five-argument spawn string stays
--- what it is on every platform (a Windows wrapper reads the same file).
--- Rewritten at every load, removed when Millennium has no answer, so the
--- helper never reads a stale one; the helper keeps its own guesses for a
--- missing file and a directory that holds no library cache.
local STEAM_DIR_FILE = join(RUNTIME_DIR, "steam-dir")
local function publish_steam_dir()
    local steam = millennium_steam_dir()
    if steam then
        local handle = io.open(STEAM_DIR_FILE, "w")
        if handle then
            handle:write(steam, "\n")
            handle:close()
            return
        end
    end
    os.remove(STEAM_DIR_FILE)
end

local function request_id(value)
    return type(value) == "string" and #value == 36 and value:match("^[%x%-]+$") ~= nil
end

local stop_control
local function start_control()
    if not millennium.config or type(millennium.config.on_change) ~= "function" then
        log_line("error", "control: Millennium config push API unavailable")
        return
    end
    -- Subscribe only to new changes; never execute persisted requests on load.
    stop_control = millennium.config.on_change(function(key, value)
        if key ~= "snnControl" or type(value) ~= "string" or #value > 65536 then return end
        local ok, request = pcall(json.decode, value)
        if not ok or type(request) ~= "table" or not request_id(request.id)
            or type(request.deadline) ~= "string" or not request.deadline:match("^%d+$")
            or not tonumber(request.deadline) or tonumber(request.deadline) <= os.time() * 1000
            or (request.kind ~= "status" and request.kind ~= "sample" and request.kind ~= "dev") then return end
        pcall(millennium.config.delete, "snnControl")
        local called, result, err = pcall(millennium.call_frontend_method, "receiveControl", {value})
        if not called or err then log_line("error", "control: frontend push failed: " .. tostring(err or result)) end
    end)
end

---@ffi
---@param kind string
---@param payload string
---@return string
function ReportDiagnostic(kind, payload)
    if (kind ~= "status" and kind ~= "command") or type(payload) ~= "string" or #payload > 65536 then
        return "invalid"
    end
    local ok, reply = pcall(json.decode, payload)
    if not ok or type(reply) ~= "table" or not request_id(reply.id) then return "invalid" end
    -- The caller removes this directory on timeout; never recreate a late reply.
    local path = join(RUNTIME_DIR, ".control-requests", reply.id, "result")
    local handle = io.open(path, "w")
    if not handle then return "unavailable" end
    handle:write(payload)
    handle:close()
    return "ok"
end

--- Steam tracks focus inside nested Gamescope, not necessarily its host window.
--- The optional Linux probe only answers for a uniquely identified wrapper.
---@ffi
---@param appid number
---@return string
function GameHostFocus(appid)
    local ok, result = pcall(function()
        return require('game_focus').query(appid, PLATFORM, { runtime = RUNTIME_DIR, steam = millennium_steam_dir(), spawn = function(args, wait) return spawn_windows_helper(args, wait, join(RUNTIME_DIR, 'game-focus.ps1')) end })
    end)
    return ok and result or "unknown"
end

local function on_load()
    -- Directory first, then truncate: the session log starts fresh so that
    -- tools/capture never reads a previous session's lines as current.
    fs.create_directories(RUNTIME_DIR)
    local fresh = io.open(LOG_FILE, "w")
    if fresh then fresh:close() end

    log_line("info", "backend loaded")
    log_line("info", "platform: " .. PLATFORM
        .. (FLATPAK_ID and (" flatpak: " .. FLATPAK_ID) or "")
        .. " runtime: " .. RUNTIME_DIR)

    publish_steam_dir()

    -- Each platform materializes what it runs: the sh helper on Linux and the
    -- PowerShell helper on Windows (-Setup registers its AUMID at every load,
    -- idempotently). macOS has
    -- no delivery yet and says so once here, and again per dropped
    -- notification, so neither end is ever silent.
    if IS_MACOS then
        log_line("error", "desktop delivery is not implemented on macos"
            .. " -- notifications will not be delivered (docs/platforms.md)")
    else
        local helper, err = install_helper()
        if helper then
            log_line("info", "helper: " .. helper)
        else
            log_line("error", "helper install FAILED: " .. tostring(err)
                .. " -- notifications will not be delivered")
        end
        if IS_WINDOWS and helper then
            log_line("info", "windows delivery is EXPERIMENTAL"
                .. " -- docs/platforms.md lists the tested surface")
            if not spawn_windows_helper("-Setup") then
                log_line("error", "helper -Setup could not run"
                    .. " -- toasts may be unbranded")
            end
        end
    end

    start_control()
    millennium.ready()
end

local function on_unload()
    if stop_control then stop_control(); stop_control = nil end
    log_line("info", "backend unloaded")
end

local function on_frontend_loaded() end

return {
    on_load = on_load,
    on_unload = on_unload,
    on_frontend_loaded = on_frontend_loaded,
}
