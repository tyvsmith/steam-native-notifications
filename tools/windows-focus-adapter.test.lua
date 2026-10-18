package.path = 'backend/?.lua;backend/?/init.lua;' .. package.path
local focus = require('game_focus')
local path = os.getenv('TMPDIR') or os.getenv('TEMP') or os.getenv('TMP') or '/tmp'
local calls = 0
local host = { runtime = path, steam = 'C:\\Steam', spawn = function(args, deadline)
    calls = calls + 1
    assert(deadline == 2000)
    local result = args:match('%-Result "([^"]+)"')
    assert(result)
    local file = assert(io.open(result, 'wb')); file:write('desktop'); file:close()
    return true
end }
assert(focus.query(17, 'windows', host) == 'desktop')
assert(calls == 1)
assert(focus.query('17', 'windows', host) == 'unknown')
assert(calls == 1)
host.spawn = function() return false end
assert(focus.query(17, 'windows', host) == 'unknown')
host.spawn = function() error('probe failure') end
assert(focus.query(17, 'windows', host) == 'unknown')
host.steam = 'C:\\bad"path'
assert(focus.query(17, 'windows', host) == 'unknown')
print('PASS Windows focus adapter')
