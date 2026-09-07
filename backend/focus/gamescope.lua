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

-- Linux Gamescope provider. Protocol details stay in focus.wayland.
function M.query(appid)
    local owners = M.owners(require('fs'))
    if #owners ~= 1 or owners[1] ~= appid then return 'unknown' end
    return M.select(appid, require('focus.wayland').snapshot(), owners)
end

return M
