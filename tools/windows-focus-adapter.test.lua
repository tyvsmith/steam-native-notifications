package.path = 'backend/?.lua;backend/?/init.lua;' .. package.path
local focus = require('game_focus')
local path = os.tmpname()
os.remove(path)
assert(os.execute('mkdir -p ' .. path))
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
os.remove(path)
print('PASS Windows focus adapter')
