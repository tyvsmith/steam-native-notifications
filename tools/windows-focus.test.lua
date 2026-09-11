-- Verdict, result-file parsing, and probe plumbing of backend/focus/windows.lua.
package.path = './backend/?.lua;' .. package.path
local win = require('focus.windows')
local APP = 2190059198

-- select(): the verdict table
local tracked = { { pid = 1708, appid = APP } }
assert(win.select(APP, 1708, tracked, {}) == 'game', 'foreground pid tracked as the app')
assert(win.select(APP, 5724, tracked, {}) == 'desktop', 'untracked foreground (Steam, the shell) is desktop')
assert(win.select(APP, nil, tracked, {}) == 'unknown', 'no foreground window')
assert(win.select(APP, 0, tracked, {}) == 'unknown', 'null foreground window')
assert(win.select(APP, 1708, {}, {}) == 'unknown', 'app not tracked by Steam at all')
assert(win.select(APP, 5724, {}, {}) == 'unknown', 'nothing tracked: never desktop')
assert(win.select(APP, 4444, { { pid = 1708, appid = APP }, { pid = 4444, appid = 570 } }, {})
    == 'unknown', 'another Steam app in front is not desktop')
assert(win.select(APP, 9000, tracked, { { pid = 9000, appid = APP } }) == 'game',
    'the overlay map alone can name the foreground process')
assert(win.select(APP, 1708, tracked, { { pid = 1708, appid = 570 } }) == 'unknown',
    'the two maps disagreeing on a pid is contradictory')
assert(win.select(APP, 1708, { { pid = 1708, appid = APP }, { pid = 1708, appid = 570 } }, {})
    == 'unknown', 'one pid tracked under two apps is contradictory')
assert(win.select(APP, 1708, { { pid = 'x', appid = APP } }, {}) == 'unknown', 'malformed entries')
assert(win.select(APP, 2, { { pid = 1, appid = APP }, { pid = 2, appid = APP } }, {}) == 'game',
    'a multi-process game: any tracked pid of the app counts')

-- parse(): the probe's file
local fg, t, o = win.parse('fg=1708\ntracked=1708:2190059198,11932:2264186190\noverlay=1708:2190059198\n')
assert(fg == 1708 and #t == 2 and t[2].pid == 11932 and t[2].appid == 2264186190 and #o == 1)
fg, t, o = win.parse('fg=0\r\ntracked=\r\noverlay=\r\n')
assert(fg == 0 and #t == 0 and #o == 0, 'empty maps with CRLF')
assert(win.parse('fg=1708\ntracked=1:2\n') == nil, 'a missing line is a partial file')
assert(win.parse(nil) == nil and win.parse('') == nil)

-- query(): plumbing through a fake host
local dir = os.getenv('TMPDIR') or '/tmp'
local spawned, logs = {}, {}
local function host(body)
    return {
        runtime = dir,
        steam = 'C:\\Program Files (x86)\\Steam',
        log = function(line) logs[#logs + 1] = line end,
        spawn = function(arguments, wait_ms)
            spawned[#spawned + 1] = { arguments = arguments, wait_ms = wait_ms }
            local path = arguments:match('%-Result "([^"]+)"')
            if body then
                local f = assert(io.open(path, 'wb')); f:write(body); f:close()
            end
            return true
        end,
    }
end
assert(win.query(APP, nil) == 'unknown', 'no host, no probe')
assert(win.query(APP, host('fg=1708\ntracked=1708:' .. APP .. '\noverlay=\n')) == 'game')
local args = spawned[1].arguments
local sep = package.config:sub(1, 1)
assert(args:match('^%-GameFocus ' .. APP .. ' %-Result "' .. (dir .. sep):gsub('%p', '%%%0') .. 'focus%-%x+%.txt"'), args)
assert(args:find('-SteamDir "C:\\Program Files (x86)\\Steam"', 1, true), 'the published Steam dir rides along')
assert(spawned[1].wait_ms == win.WAIT_MS, 'the spawn waits for the helper, bounded')
assert(logs[1]:find('^focus: probe appid=' .. APP .. ' fg=1708 tracked=1 overlay=0 %-> game$'), logs[1])
local leftover = io.open(spawned[1].arguments:match('%-Result "([^"]+)"'), 'rb')
assert(leftover == nil, 'the result file is consumed')
assert(win.query(APP, host('fg=5724\ntracked=1708:' .. APP .. '\noverlay=\n')) == 'desktop')
assert(win.query(APP, host(nil)) == 'unknown', 'no result file (helper timed out or failed)')
assert(win.query(APP, host('garbage')) == 'unknown', 'unparseable result')
assert(win.query(APP, host('fg=1708\ntracked=\noverlay=\n')) == 'unknown', 'app not tracked')
local refused = host(nil); refused.spawn = function() return false end
assert(win.query(APP, refused) == 'unknown', 'spawn refused')
print('PASS windows focus verdict, result parsing, and probe plumbing')
