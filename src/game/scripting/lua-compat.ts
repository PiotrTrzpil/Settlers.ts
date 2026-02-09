/**
 * Lua 3.2 Compatibility Layer
 *
 * Settlers 4 used Lua 3.2, while Fengari implements Lua 5.3.
 * This module provides compatibility shims for common Lua 3.2 patterns
 * that don't work directly in Lua 5.3.
 *
 * Key differences:
 * - Lua 3.2: `and`/`or` keywords, `~=` for not-equal
 * - Lua 3.2: `tinsert`, `tremove`, `getn` table functions
 * - Lua 3.2: Different string library function names
 * - Lua 5.3: `#` length operator, `table.insert`, `table.remove`
 */

/**
 * Lua compatibility shim code to inject before running scripts.
 * This creates global aliases for Lua 3.2 style functions.
 */
export const LUA_COMPAT_SHIM = `
-- Lua 3.2 compatibility shim for Lua 5.3

-- Table functions (Lua 3.2 style)
tinsert = table.insert
tremove = table.remove
function getn(t)
    return #t
end

-- String functions (Lua 3.2 had these as globals)
strlen = string.len
strsub = string.sub
strlower = string.lower
strupper = string.upper
strfind = string.find
format = string.format
gsub = string.gsub

-- Math functions (some were global in 3.2)
abs = math.abs
floor = math.floor
ceil = math.ceil
min = math.min
max = math.max
random = math.random
randomseed = math.randomseed
sqrt = math.sqrt
sin = math.sin
cos = math.cos

-- dostring compatibility (deprecated but some scripts might use it)
function dostring(str)
    local f, err = load(str)
    if f then
        return f()
    else
        error(err)
    end
end

-- call function (deprecated, replaced by pcall/xpcall)
function call(func, args)
    if type(args) ~= "table" then
        args = {args}
    end
    return func(table.unpack(args))
end

-- foreachi and foreach (deprecated iterators)
function foreachi(t, f)
    for i = 1, #t do
        local result = f(i, t[i])
        if result then return result end
    end
end

function foreach(t, f)
    for k, v in pairs(t) do
        local result = f(k, v)
        if result then return result end
    end
end

-- sort was global in 3.2
sort = table.sort

-- Read-only table helper (some scripts use this)
function readOnly(t)
    return setmetatable({}, {
        __index = t,
        __newindex = function()
            error("Attempt to modify read-only table")
        end,
        __metatable = false
    })
end

-- Type checking helpers
function type_is(value, typename)
    return type(value) == typename
end
`;

/**
 * Apply the compatibility shim to a Lua runtime.
 * Should be called once after creating the runtime, before loading any scripts.
 *
 * @param runtime The LuaRuntime instance
 */
export function applyLuaCompatShim(runtime: { execute: (code: string) => void }): void {
    runtime.execute(LUA_COMPAT_SHIM);
}
