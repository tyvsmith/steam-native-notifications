-- Supply only the two filesystem operations consumed by the existing provider.
package.path = './backend/?.lua;./backend/?/init.lua;' .. package.path
local entries, paths = {}, {}
for line in io.lines() do
    local id, path = line:match('^(%d+)|(.*)$')
    if id then
        entries[#entries + 1] = { name = id }
        paths['/proc/' .. id .. '/exe'] = path ~= '' and path or nil
    end
end
package.preload.fs = function()
    return {
        list = function(path) return path == '/proc' and entries or {} end,
        canonical = function(path) return paths[path] end,
    }
end
print(require('game_focus').query(tonumber(arg[1]), 'linux'))
