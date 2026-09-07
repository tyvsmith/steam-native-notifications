package.path = './backend/?.lua;' .. package.path
local focus = require('game_focus')
local calls = 0
package.preload['focus.gamescope'] = function()
    return {query = function(appid) calls = calls + 1; assert(appid == 553850); return 'desktop' end}
end
assert(focus.query(553850, 'windows') == 'unknown')
assert(focus.query(553850, 'macos') == 'unknown')
assert(calls == 0 and not package.loaded['focus.gamescope'], 'unsupported platforms must not load Linux code')
for _, appid in ipairs({0, -1, 1.5, 4294967296, math.huge, 0/0, '553850'}) do
    assert(focus.query(appid, 'linux') == 'unknown')
end
assert(calls == 0, 'invalid IDs must not reach a provider')
assert(focus.query(553850, 'linux') == 'desktop')
assert(calls == 1, 'supported platform must query its provider')
package.loaded['focus.gamescope'].query = function() return 'game' end
assert(focus.query(553850, 'linux') == 'game')
package.loaded['focus.gamescope'].query = function() return 'garbage' end
assert(focus.query(553850, 'linux') == 'unknown')
package.loaded['focus.gamescope'].query = function() error('unavailable') end
assert(focus.query(553850, 'linux') == 'unknown')
print('PASS focus provider dispatch, validation, and failure contract')
