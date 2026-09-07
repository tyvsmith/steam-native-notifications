-- Read-only correction for Steam focus inside a uniquely identified Gamescope.
local M = {}

function M.select(appid, windows, owners)
    if not windows or #owners ~= 1 or owners[1] ~= appid then return 'unknown' end
    local wrappers, active, game = 0, 0, false
    for _, window in ipairs(windows) do
        if window[2] then active = active + 1 end
        if window[1] == 'gamescope' then
            wrappers, game = wrappers + 1, window[2]
        end
    end
    if wrappers ~= 1 or active ~= 1 then return 'unknown' end
    return game and 'game' or 'desktop'
end

local native
local function api()
    if native then return native end
    local ffi = require('ffi')
    ffi.cdef[[
        struct wl_proxy;
        struct wl_interface;
        struct wl_message { const char *name; const char *signature;
                            const struct wl_interface **types; };
        struct wl_interface { const char *name; int version; int method_count;
            const struct wl_message *methods; int event_count; const struct wl_message *events; };
        struct wl_array { size_t size; size_t alloc; void *data; };
        union wl_argument { int32_t i; uint32_t u; int32_t f; const char *s;
            void *o; uint32_t n; struct wl_array *a; int32_t h; };
        typedef int (*snn_dispatcher)(const void *, void *, uint32_t,
                                     const struct wl_message *, union wl_argument *);
        struct wl_proxy *wl_display_connect_to_fd(int fd);
        void wl_display_disconnect(struct wl_proxy *display);
        int wl_display_get_fd(struct wl_proxy *display);
        int wl_display_dispatch_pending(struct wl_proxy *display);
        int wl_display_prepare_read(struct wl_proxy *display);
        void wl_display_cancel_read(struct wl_proxy *display);
        int wl_display_read_events(struct wl_proxy *display);
        int wl_display_flush(struct wl_proxy *display);
        struct wl_proxy *wl_proxy_marshal_array_constructor_versioned(
            struct wl_proxy *, uint32_t, union wl_argument *, const struct wl_interface *, uint32_t);
        int wl_proxy_add_dispatcher(struct wl_proxy *, snn_dispatcher, const void *, void *);
        void wl_proxy_destroy(struct wl_proxy *);
        extern const struct wl_interface wl_registry_interface;
        extern const struct wl_interface wl_callback_interface;
        extern const struct wl_interface wl_output_interface;
        struct snn_pollfd { int fd; short events; short revents; };
        struct snn_timespec { long tv_sec; long tv_nsec; };
        struct snn_sockaddr_un { unsigned short family; char path[108]; };
        int socket(int, int, int);
        int connect(int, const void *, unsigned int);
        int close(int);
        int poll(struct snn_pollfd *, unsigned long, int);
        int clock_gettime(int, struct snn_timespec *);
    ]]
    native = {ffi = ffi, wl = ffi.load('libwayland-client.so.0')}
    return native
end

-- Only version 1 events are bound. libwayland owns binary decoding and framing.
-- Protocol: wlr-protocols/unstable/wlr-foreign-toplevel-management-unstable-v1.xml
local function interfaces(ffi, wl)
    local handle = ffi.new('struct wl_interface[1]')
    local manager = ffi.new('struct wl_interface[1]')
    local output = ffi.new('const struct wl_interface *[1]', {wl.wl_output_interface})
    local child = ffi.new('const struct wl_interface *[1]', {handle})
    local events = ffi.new('struct wl_message[7]', {
        {'title', 's', nil}, {'app_id', 's', nil},
        {'output_enter', 'o', output}, {'output_leave', 'o', output},
        {'state', 'a', nil}, {'done', '', nil}, {'closed', '', nil},
    })
    local manager_events = ffi.new('struct wl_message[2]', {
        {'toplevel', 'n', child}, {'finished', '', nil},
    })
    handle[0] = {name = 'zwlr_foreign_toplevel_handle_v1', version = 1,
        event_count = 7, events = events}
    manager[0] = {name = 'zwlr_foreign_toplevel_manager_v1', version = 1,
        event_count = 2, events = manager_events}
    -- Keep every backing allocation alive until all proxies are destroyed.
    return {handle, manager, output, child, events, manager_events}
end

function M.snapshot()
    local display_name, runtime = os.getenv('WAYLAND_DISPLAY'), os.getenv('XDG_RUNTIME_DIR')
    if not display_name or not runtime then return nil end
    local a = api()
    local ffi, wl = a.ffi, a.wl
    local path = display_name:sub(1, 1) == '/' and display_name or runtime .. '/' .. display_name
    if #path >= 108 then return nil end
    -- Own a new nonblocking socket; never consume Steam's WAYLAND_SOCKET fd.
    local fd = ffi.C.socket(1, 1 + 2048 + 524288, 0)
    if fd < 0 then return nil end
    local address = ffi.new('struct snn_sockaddr_un', {family = 1})
    ffi.copy(address.path, path)
    if ffi.C.connect(fd, address, 2 + #path + 1) ~= 0 then ffi.C.close(fd); return nil end
    local display = wl.wl_display_connect_to_fd(fd)
    if display == nil then return nil end -- libwayland closes fd on failure
    local definitions = interfaces(ffi, wl)
    local proxies, kinds, windows = {}, {}, {}
    local callback, prepared, failed, manager_name, synced
    local now_buf = ffi.new('struct snn_timespec[1]')
    local function now()
        assert(ffi.C.clock_gettime(1, now_buf) == 0)
        return tonumber(now_buf[0].tv_sec) + tonumber(now_buf[0].tv_nsec) / 1e9
    end
    local function track(proxy, kind)
        assert(proxy ~= nil, 'missing proxy')
        proxies[#proxies + 1] = proxy
        kinds[tostring(proxy)] = kind
        assert(wl.wl_proxy_add_dispatcher(proxy, callback, nil, nil) == 0)
        return proxy
    end
    local function dispatch(_, target, opcode, _, args)
        local key = tostring(ffi.cast('struct wl_proxy *', target))
        local kind = kinds[key]
        if kind == 'registry' and opcode == 0 then
            if ffi.string(args[1].s) == 'zwlr_foreign_toplevel_manager_v1' then
                manager_name = tonumber(args[0].u)
            end
        elseif kind == 'sync' then synced = true
        elseif kind == 'manager' then
            if opcode == 1 then failed = true; return end
            local proxy = track(ffi.cast('struct wl_proxy *', args[0].o), 'window')
            windows[tostring(proxy)] = {'', false}
        elseif kind == 'window' then
            local window = windows[key]
            if opcode == 1 then window[1] = ffi.string(args[0].s)
            elseif opcode == 4 then
                local states = args[0].a
                assert(states.size % 4 == 0)
                window[2] = false
                local values = ffi.cast('uint32_t *', states.data)
                for i = 0, tonumber(states.size) / 4 - 1 do
                    if values[i] == 2 then window[2] = true end
                end
            elseif opcode == 6 then windows[key] = nil end
        end
    end
    callback = ffi.cast('snn_dispatcher', function(...)
        if not pcall(dispatch, ...) then failed = true end
        return 0
    end)
    local ok, result = pcall(function()
        local deadline = now() + 0.5
        local pollfd = ffi.new('struct snn_pollfd[1]', {{fd, 1, 0}})
        local function roundtrip()
            synced = false
            track(wl.wl_proxy_marshal_array_constructor_versioned(display, 0,
                ffi.new('union wl_argument[1]'), wl.wl_callback_interface, 1), 'sync')
            while not synced do
                assert(now() < deadline and not failed, 'focus query timed out or failed')
                assert(wl.wl_display_dispatch_pending(display) >= 0)
                if synced then break end
                assert(wl.wl_display_prepare_read(display) == 0)
                prepared = true
                -- The tiny request set should flush immediately; fail closed on backpressure.
                assert(wl.wl_display_flush(display) >= 0)
                pollfd[0].revents = 0
                assert(ffi.C.poll(pollfd, 1, math.max(0, math.ceil((deadline - now()) * 1000))) > 0)
                assert(pollfd[0].revents == 1)
                prepared = false -- read_events consumes the preparation even on failure
                assert(wl.wl_display_read_events(display) >= 0)
            end
            assert(not failed)
        end
        local registry = track(wl.wl_proxy_marshal_array_constructor_versioned(display, 1,
            ffi.new('union wl_argument[1]'), wl.wl_registry_interface, 1), 'registry')
        roundtrip()
        if not manager_name then return nil end
        local args = ffi.new('union wl_argument[4]')
        args[0].u, args[1].s, args[2].u = manager_name, definitions[2][0].name, 1
        track(wl.wl_proxy_marshal_array_constructor_versioned(registry, 0, args,
            definitions[2], 1), 'manager')
        roundtrip()
        local snapshot = {}
        for _, window in pairs(windows) do snapshot[#snapshot + 1] = window end
        return snapshot
    end)
    if prepared then wl.wl_display_cancel_read(display) end
    for i = #proxies, 1, -1 do wl.wl_proxy_destroy(proxies[i]) end
    wl.wl_display_disconnect(display)
    callback:free()
    -- Explicit reference protects protocol metadata through native cleanup.
    assert(definitions[1])
    if not ok then return nil, tostring(result) end
    return result
end

local function read(path)
    local file = io.open(path, 'rb')
    if not file then return nil end
    local data = file:read('*a')
    file:close()
    return data
end

function M.owners(fs)
    local owners = {}
    for _, entry in ipairs(fs.list('/proc')) do
        if entry.name:match('^%d+$') then
            local path = '/proc/' .. entry.name
            local exe = fs.canonical(path .. '/exe')
            if exe and exe:match('/gamescope$') then
                local env = read(path .. '/environ')
                local id = env and ('\0' .. env):match('%zSteamAppId=(%d+)%z')
                owners[#owners + 1] = tonumber(id) or false
            elseif not exe then
                local comm = read(path .. '/comm')
                if comm and comm:match('^gamescope') then owners[#owners + 1] = false end
            end
        end
    end
    return owners
end

function M.query(appid)
    local ok, result = pcall(function()
        local owners = M.owners(require('fs'))
        if #owners ~= 1 or owners[1] ~= appid then return 'unknown' end
        return M.select(appid, M.snapshot(), owners)
    end)
    return ok and result or 'unknown'
end

-- Native dispatch calls back into Lua; it must not run from a compiled trace.
if jit then jit.off(M.snapshot, true) end

return M
