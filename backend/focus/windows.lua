-- Both hosts use the same one-shot PowerShell ownership detector.
local M = {}
function M.query(appid, host)
    if type(host) ~= 'table' or type(host.spawn) ~= 'function'
        or type(host.runtime) ~= 'string' or type(host.steam) ~= 'string'
        or host.runtime:find('["\r\n]') or host.steam:find('["\r\n]') then return 'unknown' end
    local path = host.runtime .. '/focus-' .. tostring(math.random(1, 2147483647)) .. '.txt'
    os.remove(path)
    local ok = host.spawn('-AppId ' .. tostring(appid) .. ' -SteamDir "' .. host.steam
        .. '" -Result "' .. path .. '"', 2000)
    local file = ok and io.open(path, 'rb')
    local verdict = file and file:read('*a') or nil
    if file then file:close() end
    os.remove(path)
    return (verdict == 'game' or verdict == 'desktop') and verdict or 'unknown'
end
return M
