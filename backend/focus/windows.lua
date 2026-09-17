-- Windows host-focus provider: does the requested Steam app own the
-- foreground window? Facts come from a one-shot PowerShell probe
-- (notify-action.ps1 -GameFocus) started through the backend's CreateProcessW
-- seam, so it runs in the desktop session; from a non-interactive session
-- GetForegroundWindow answers null (measured, docs/platforms.md). The verdict
-- is computed here, pure, so tools/windows-focus.test.lua can pin it.
--
-- Two process maps, both from Steam's own records: console_log.txt's
-- "Game process added/removed" lines for every process Steam tracks (present
-- for any launched app, overlay or not), and gameoverlayui.exe's -gameid/-pid
-- command lines (present only when the overlay renderer hooked a device).
-- They must agree wherever they overlap.
local M = {}

local function id(value)
    local n = tonumber(value)
    if not n or n <= 0 or n ~= math.floor(n) then return nil end
    return n
end

--- 'game' when the foreground process is tracked as `appid`, 'desktop' when
--- the app is tracked but some untracked process (Steam, the shell, anything
--- else) owns the foreground, 'unknown' for everything that cannot authorize
--- a correction: no foreground window, an app Steam is not tracking, another
--- Steam app in front, or maps that contradict each other.
function M.select(appid, fg, tracked, overlay)
    if not id(fg) then return 'unknown' end
    local by_pid, mine = {}, {}
    for _, list in ipairs({ tracked or {}, overlay or {} }) do
        for _, entry in ipairs(list) do
            local pid, app = id(entry.pid), id(entry.appid)
            if not pid or not app then return 'unknown' end
            if by_pid[pid] and by_pid[pid] ~= app then return 'unknown' end
            by_pid[pid] = app
            if app == appid then mine[pid] = true end
        end
    end
    if next(mine) == nil then return 'unknown' end
    if mine[fg] then return 'game' end
    if by_pid[fg] then return 'unknown' end
    return 'desktop'
end

local function pairs_list(text)
    local list = {}
    for pid, app in text:gmatch('(%d+):(%d+)') do
        list[#list + 1] = { pid = tonumber(pid), appid = tonumber(app) }
    end
    return list
end

--- The probe's result file: `fg=<pid>`, `tracked=<pid>:<appid>,...`,
--- `overlay=<pid>:<appid>,...`, one per line, values possibly empty. Nil
--- when a line is missing, so a partial file reads as unknown.
function M.parse(text)
    if type(text) ~= 'string' then return nil end
    local fg = text:match('\nfg=([^\r\n]*)') or text:match('^fg=([^\r\n]*)')
    local tracked = text:match('\ntracked=([^\r\n]*)') or text:match('^tracked=([^\r\n]*)')
    local overlay = text:match('\noverlay=([^\r\n]*)') or text:match('^overlay=([^\r\n]*)')
    if not fg or not tracked or not overlay then return nil end
    return tonumber(fg), pairs_list(tracked), pairs_list(overlay)
end

local function read(path)
    local file = io.open(path, 'rb')
    if not file then return nil end
    local data = file:read('*a')
    file:close()
    return data
end

--- host: { spawn = function(arguments, wait_ms) -> boolean, runtime = dir,
--- steam = dir or nil, log = function(line) or nil }. The probe writes one
--- result file named by a random token and the call waits for the helper to
--- exit, bounded; no file, a late file, or a bad file is unknown.
M.WAIT_MS = 3000

function M.query(appid, host)
    if type(host) ~= 'table' or type(host.spawn) ~= 'function' or type(host.runtime) ~= 'string' then
        return 'unknown'
    end
    local token = string.format('%08x%08x', math.random(0, 0x7fffffff), math.random(0, 0x7fffffff))
    local sep = (type(package) == 'table' and type(package.config) == 'string') and package.config:sub(1, 1) or '\\'
    local result = host.runtime .. sep .. 'focus-' .. token .. '.txt'
    local arguments = '-GameFocus ' .. tostring(appid) .. ' -Result "' .. result .. '"'
    if type(host.steam) == 'string' and host.steam ~= '' then
        arguments = arguments .. ' -SteamDir "' .. host.steam .. '"'
    end
    if not host.spawn(arguments, M.WAIT_MS) then return 'unknown' end
    local text = read(result)
    os.remove(result)
    local fg, tracked, overlay = M.parse(text)
    local verdict = 'unknown'
    if fg ~= nil or tracked then verdict = M.select(appid, fg, tracked, overlay) end
    if type(host.log) == 'function' then
        host.log('focus: probe appid=' .. tostring(appid) .. ' fg=' .. tostring(fg)
            .. ' tracked=' .. (tracked and #tracked or 'none')
            .. ' overlay=' .. (overlay and #overlay or 'none') .. ' -> ' .. verdict)
    end
    return verdict
end

return M
