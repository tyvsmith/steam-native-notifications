-- Host-focus boundary: providers answer relative to the requested Steam app ID.
-- Unknown never authorizes a desktop correction; the caller retains Steam focus.
local M = {}

function M.query(appid, platform)
    if type(appid) ~= 'number' or appid <= 0 or appid > 4294967295
        or appid ~= math.floor(appid) then return 'unknown' end
    local ok, result = pcall(function()
        if platform == 'linux' then return require('focus.gamescope').query(appid) end
        return 'unknown'
    end)
    return ok and (result == 'game' or result == 'desktop') and result or 'unknown'
end

return M
