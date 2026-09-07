package.path = './backend/?.lua;' .. package.path
local ok, focus = pcall(require, 'focus.gamescope')
assert(ok, 'native focus module must load: ' .. tostring(focus))
assert(focus.select(553850, {{'gamescope', false}, {'terminal', true}}, {553850}) == 'desktop')
assert(focus.select(553850, {{'gamescope', true}, {'terminal', false}}, {553850}) == 'game')
for _, case in ipairs({
    {{{'gamescope', false}}, {553850}},
    {{{'gamescope', false}, {'terminal', true}}, {570}},
    {{{'gamescope', true}, {'gamescope', false}}, {553850}},
    {{{'gamescope', true}}, {553850, 570}},
    {{{'gamescope', true}, {'terminal', true}}, {553850}},
    {{{'terminal', true}}, {553850}},
    {{{'gamescope', true}}, {false}},
}) do assert(focus.select(553850, case[1], case[2]) == 'unknown') end
local getenv = os.getenv
os.getenv = function() return nil end
assert(require('focus.wayland').snapshot() == nil, 'missing display must not imply desktop')
os.getenv = getenv
local ffi_module = package.loaded.ffi
local ffi_loader = package.preload.ffi
package.loaded.ffi = nil
package.preload.ffi = function() error('FFI unavailable') end
os.getenv = function(name)
    if name == 'WAYLAND_DISPLAY' then return 'wayland-test' end
    if name == 'XDG_RUNTIME_DIR' then return '/tmp' end
end
local available, windows = pcall(require('focus.wayland').snapshot)
assert(available and windows == nil, 'Wayland reader must contain missing native support')
package.loaded.ffi, package.preload.ffi = ffi_module, ffi_loader
os.getenv = getenv
local open = io.open
local files = {['/proc/1/environ'] = 'SteamAppId=553850\0', ['/proc/2/comm'] = 'gamescope-wl\n'}
io.open = function(path)
    if not files[path] then return nil end
    return {read = function() return files[path] end, close = function() end}
end
local fs = {
    list = function() return {{name = '1'}, {name = 'self'}} end,
    canonical = function(path) if path == '/proc/1/exe' then return '/usr/bin/gamescope' end end,
}
assert(focus.owners(fs)[1] == 553850)
files['/proc/1/environ'] = 'SteamAppId=553850garbage\0'
assert(focus.owners(fs)[1] == false, 'malformed owner must remain ambiguous')
files['/proc/1/environ'] = nil
assert(focus.owners(fs)[1] == false, 'unreadable owner must remain ambiguous')
fs.list = function() return {{name = '1'}, {name = '2'}} end
assert(#focus.owners(fs) == 2, 'unreadable second wrapper must not disappear')
files['/proc/1/environ'] = 'SteamAppId=553850\0'
files['/proc/2/environ'] = 'SteamAppId=570\0'
fs.canonical = function(path)
    return path == '/proc/1/exe' and '/usr/bin/gamescope' or '/usr/bin/gamescope-wl'
end
local owners = focus.owners(fs)
assert(#owners == 2 and owners[2] == 570, 'readable gamescope-wl must not disappear')
assert(focus.select(553850, {{'gamescope', false}, {'terminal', true}}, owners) == 'unknown')
fs.list = function() return {{name = '2'}} end
assert(focus.owners(fs)[1] == 570, 'single gamescope-wl owner must be recognized')
fs.canonical = function() return '/usr/bin/gamescopereaper' end
assert(#focus.owners(fs) == 0, 'unrelated gamescope prefixes must not count as owners')
io.open = open
print('PASS native focus selection and missing display')
