package.path = './backend/?.lua;' .. package.path
local ok, focus = pcall(require, 'game_focus')
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
assert(focus.snapshot() == nil, 'missing display must not imply desktop')
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
io.open = open
print('PASS native focus selection and missing display')
