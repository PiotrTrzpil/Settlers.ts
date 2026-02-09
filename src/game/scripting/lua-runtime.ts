/**
 * LuaRuntime - Wrapper around Fengari Lua VM
 * Provides safe execution environment for map scripts
 */

import { lua, lauxlib, lualib, to_luastring, to_jsstring } from 'fengari';
import type { lua_State } from 'fengari';

/**
 * Convert JS string to Lua string (Uint8Array)
 * Fengari requires this conversion for all string operations
 */
function toLuaStr(str: string): Uint8Array {
    return to_luastring(str);
}

/**
 * Convert Lua string (Uint8Array) to JS string
 */
function toJsStr(luaStr: Uint8Array | string): string {
    if (typeof luaStr === 'string') {
        return luaStr;
    }
    return to_jsstring(luaStr);
}
import { LogHandler } from '@/utilities/log-handler';

const log = new LogHandler('LuaRuntime');

/** Maximum instructions before script is terminated */
const MAX_INSTRUCTIONS = 1_000_000;

/** Instruction check interval */
const INSTRUCTION_CHECK_INTERVAL = 10_000;

export class LuaRuntime {
    private L: lua_State;
    private instructionCount = 0;
    private destroyed = false;

    constructor() {
        this.L = this.createSandboxedVM();
        log.debug('Lua runtime initialized');
    }

    /**
     * Create a sandboxed Lua VM with dangerous functions removed
     */
    private createSandboxedVM(): lua_State {
        const L = lauxlib.luaL_newstate();

        // Load standard libraries
        lualib.luaL_openlibs(L);

        // Remove dangerous functions/libraries
        const dangerous = [
            'os',           // OS access
            'io',           // File I/O
            'loadfile',     // Load files
            'dofile',       // Execute files
            'package',      // Module loading
        ];

        for (const name of dangerous) {
            lua.lua_pushnil(L);
            lua.lua_setglobal(L, toLuaStr(name));
        }

        // Set up instruction count hook for infinite loop protection
        this.setupInstructionLimit(L);

        return L;
    }

    /**
     * Set up instruction counting to prevent infinite loops
     */
    private setupInstructionLimit(L: lua_State): void {
        lua.lua_sethook(L, () => {
            this.instructionCount += INSTRUCTION_CHECK_INTERVAL;
            if (this.instructionCount > MAX_INSTRUCTIONS) {
                lauxlib.luaL_error(L, toLuaStr('Script exceeded maximum instruction count'));
            }
        }, lua.LUA_MASKCOUNT, INSTRUCTION_CHECK_INTERVAL);
    }

    /**
     * Reset instruction counter (call before each script execution)
     */
    public resetInstructionCount(): void {
        this.instructionCount = 0;
    }

    /**
     * Get the raw Lua state for direct API access
     */
    public getState(): lua_State {
        return this.L;
    }

    /**
     * Execute Lua code and return result
     */
    public execute(code: string): void {
        if (this.destroyed) {
            throw new Error('LuaRuntime has been destroyed');
        }

        this.resetInstructionCount();

        // Load the code (convert to Lua string)
        const loadResult = lauxlib.luaL_loadstring(this.L, toLuaStr(code));
        if (loadResult !== lua.LUA_OK) {
            const error = toJsStr(lua.lua_tostring(this.L, -1));
            lua.lua_pop(this.L, 1);
            throw new Error(`Lua parse error: ${error}`);
        }

        // Execute the code
        const callResult = lua.lua_pcall(this.L, 0, 0, 0);
        if (callResult !== lua.LUA_OK) {
            const error = toJsStr(lua.lua_tostring(this.L, -1));
            lua.lua_pop(this.L, 1);
            throw new Error(`Lua execution error: ${error}`);
        }
    }

    /**
     * Execute Lua code and return a single value
     */
    public eval<T = any>(code: string): T {
        if (this.destroyed) {
            throw new Error('LuaRuntime has been destroyed');
        }

        this.resetInstructionCount();

        // Wrap in return statement if not already
        const wrappedCode = code.startsWith('return ') ? code : `return ${code}`;

        // Load the code (convert to Lua string)
        const loadResult = lauxlib.luaL_loadstring(this.L, toLuaStr(wrappedCode));
        if (loadResult !== lua.LUA_OK) {
            const error = toJsStr(lua.lua_tostring(this.L, -1));
            lua.lua_pop(this.L, 1);
            throw new Error(`Lua parse error: ${error}`);
        }

        // Execute and get one result
        const callResult = lua.lua_pcall(this.L, 0, 1, 0);
        if (callResult !== lua.LUA_OK) {
            const error = toJsStr(lua.lua_tostring(this.L, -1));
            lua.lua_pop(this.L, 1);
            throw new Error(`Lua execution error: ${error}`);
        }

        // Convert result to JS value
        const result = this.toJSValue(-1);
        lua.lua_pop(this.L, 1);

        return result as T;
    }

    /**
     * Call a Lua function by name
     */
    public callFunction(name: string, ...args: any[]): any {
        if (this.destroyed) {
            throw new Error('LuaRuntime has been destroyed');
        }

        this.resetInstructionCount();

        // Get the function
        lua.lua_getglobal(this.L, toLuaStr(name));
        if (!lua.lua_isfunction(this.L, -1)) {
            lua.lua_pop(this.L, 1);
            return undefined; // Function doesn't exist
        }

        // Push arguments
        for (const arg of args) {
            this.pushJSValue(arg);
        }

        // Call the function
        const callResult = lua.lua_pcall(this.L, args.length, 1, 0);
        if (callResult !== lua.LUA_OK) {
            const error = toJsStr(lua.lua_tostring(this.L, -1));
            lua.lua_pop(this.L, 1);
            throw new Error(`Lua error in ${name}(): ${error}`);
        }

        // Get result
        const result = this.toJSValue(-1);
        lua.lua_pop(this.L, 1);

        return result;
    }

    /**
     * Check if a global function exists
     */
    public hasFunction(name: string): boolean {
        lua.lua_getglobal(this.L, toLuaStr(name));
        const isFunc = lua.lua_isfunction(this.L, -1);
        lua.lua_pop(this.L, 1);
        return isFunc;
    }

    /**
     * Set a global variable
     */
    public setGlobal(name: string, value: any): void {
        this.pushJSValue(value);
        lua.lua_setglobal(this.L, toLuaStr(name));
    }

    /**
     * Get a global variable
     */
    public getGlobal(name: string): any {
        lua.lua_getglobal(this.L, toLuaStr(name));
        const value = this.toJSValue(-1);
        lua.lua_pop(this.L, 1);
        return value;
    }

    /**
     * Create a new table and set it as a global
     */
    public createTable(name: string): void {
        lua.lua_newtable(this.L);
        lua.lua_setglobal(this.L, toLuaStr(name));
    }

    /**
     * Set a field in a global table
     */
    public setTableField(tableName: string, fieldName: string, value: any): void {
        lua.lua_getglobal(this.L, toLuaStr(tableName));
        if (!lua.lua_istable(this.L, -1)) {
            lua.lua_pop(this.L, 1);
            throw new Error(`${tableName} is not a table`);
        }

        this.pushJSValue(value);
        lua.lua_setfield(this.L, -2, toLuaStr(fieldName));
        lua.lua_pop(this.L, 1);
    }

    /**
     * Register a JS function as a Lua function in a table
     */
    public registerFunction(tableName: string, funcName: string, fn: (...args: any[]) => any): void {
        lua.lua_getglobal(this.L, toLuaStr(tableName));
        if (!lua.lua_istable(this.L, -1)) {
            lua.lua_pop(this.L, 1);
            throw new Error(`${tableName} is not a table`);
        }

        // Create wrapper that converts args and returns
        lua.lua_pushcfunction(this.L, (L: lua_State) => {
            try {
                // Get number of arguments
                const nargs = lua.lua_gettop(L);
                const args: any[] = [];

                // Convert Lua args to JS
                for (let i = 1; i <= nargs; i++) {
                    args.push(this.toJSValue(i));
                }

                // Call the function
                const result = fn(...args);

                // Push result if any
                if (result !== undefined) {
                    this.pushJSValue(result);
                    return 1;
                }
                return 0;
            } catch (e) {
                const msg = e instanceof Error ? e.message : String(e);
                log.error(`Error in ${tableName}.${funcName}(): ${msg}`);
                return lauxlib.luaL_error(L, toLuaStr(msg));
            }
        });

        lua.lua_setfield(this.L, -2, toLuaStr(funcName));
        lua.lua_pop(this.L, 1);
    }

    /**
     * Register a JS function as a global Lua function
     */
    public registerGlobalFunction(name: string, fn: (...args: any[]) => any): void {
        lua.lua_pushcfunction(this.L, (L: lua_State) => {
            try {
                const nargs = lua.lua_gettop(L);
                const args: any[] = [];

                for (let i = 1; i <= nargs; i++) {
                    args.push(this.toJSValue(i));
                }

                const result = fn(...args);

                if (result !== undefined) {
                    this.pushJSValue(result);
                    return 1;
                }
                return 0;
            } catch (e) {
                const msg = e instanceof Error ? e.message : String(e);
                log.error(`Error in ${name}(): ${msg}`);
                return lauxlib.luaL_error(L, toLuaStr(msg));
            }
        });

        lua.lua_setglobal(this.L, toLuaStr(name));
    }

    /**
     * Convert Lua value at stack index to JS value
     */
    public toJSValue(idx: number): any {
        const type = lua.lua_type(this.L, idx);

        switch (type) {
        case lua.LUA_TNIL:
            return undefined;
        case lua.LUA_TBOOLEAN:
            return lua.lua_toboolean(this.L, idx);
        case lua.LUA_TNUMBER:
            return lua.lua_tonumber(this.L, idx);
        case lua.LUA_TSTRING:
            return toJsStr(lua.lua_tostring(this.L, idx));
        case lua.LUA_TTABLE:
            return this.tableToObject(idx);
        case lua.LUA_TFUNCTION:
            // Store function reference
            lua.lua_pushvalue(this.L, idx);
            return lauxlib.luaL_ref(this.L, lua.LUA_REGISTRYINDEX);
        default:
            return undefined;
        }
    }

    /**
     * Push JS value onto Lua stack
     */
    public pushJSValue(value: any): void {
        if (value === undefined || value === null) {
            lua.lua_pushnil(this.L);
        } else if (typeof value === 'boolean') {
            lua.lua_pushboolean(this.L, value);
        } else if (typeof value === 'number') {
            if (Number.isInteger(value)) {
                lua.lua_pushinteger(this.L, value);
            } else {
                lua.lua_pushnumber(this.L, value);
            }
        } else if (typeof value === 'string') {
            lua.lua_pushstring(this.L, toLuaStr(value));
        } else if (Array.isArray(value)) {
            this.arrayToTable(value);
        } else if (typeof value === 'object') {
            this.objectToTable(value);
        } else if (typeof value === 'function') {
            lua.lua_pushcfunction(this.L, (L: lua_State) => {
                const nargs = lua.lua_gettop(L);
                const args: any[] = [];
                for (let i = 1; i <= nargs; i++) {
                    args.push(this.toJSValue(i));
                }
                const result = value(...args);
                if (result !== undefined) {
                    this.pushJSValue(result);
                    return 1;
                }
                return 0;
            });
        } else {
            lua.lua_pushnil(this.L);
        }
    }

    /**
     * Convert Lua table to JS object
     */
    private tableToObject(idx: number): Record<string, any> | any[] {
        const result: Record<string, any> = {};
        let isArray = true;
        let maxIndex = 0;

        // Make index absolute
        if (idx < 0) {
            idx = lua.lua_gettop(this.L) + idx + 1;
        }

        // Iterate using lua_next
        lua.lua_pushnil(this.L); // First key
        while (lua.lua_next(this.L, idx) !== 0) {
            // Stack: key at -2, value at -1
            const keyType = lua.lua_type(this.L, -2);
            let key: string | number;

            if (keyType === lua.LUA_TNUMBER) {
                key = lua.lua_tointeger(this.L, -2);
                if (typeof key === 'number' && key > maxIndex) {
                    maxIndex = key;
                }
            } else if (keyType === lua.LUA_TSTRING) {
                key = toJsStr(lua.lua_tostring(this.L, -2));
                isArray = false;
            } else {
                // Skip non-string/number keys
                lua.lua_pop(this.L, 1); // Pop value, keep key for next iteration
                continue;
            }

            // Get value (recursively)
            result[key] = this.toJSValue(-1);

            // Pop value, keep key for next iteration
            lua.lua_pop(this.L, 1);
        }

        // Convert to array if all keys are sequential integers starting at 1
        if (isArray && maxIndex > 0) {
            const arr: any[] = [];
            for (let i = 1; i <= maxIndex; i++) {
                arr.push(result[i]);
            }
            return arr;
        }

        return result;
    }

    /**
     * Convert JS array to Lua table
     */
    private arrayToTable(arr: any[]): void {
        lua.lua_newtable(this.L);
        for (let i = 0; i < arr.length; i++) {
            this.pushJSValue(arr[i]);
            lua.lua_rawseti(this.L, -2, i + 1); // Lua arrays are 1-indexed
        }
    }

    /**
     * Convert JS object to Lua table
     */
    private objectToTable(obj: Record<string, any>): void {
        lua.lua_newtable(this.L);
        for (const [key, value] of Object.entries(obj)) {
            this.pushJSValue(value);
            lua.lua_setfield(this.L, -2, toLuaStr(key));
        }
    }

    /**
     * Clean up and destroy the Lua VM
     */
    public destroy(): void {
        if (!this.destroyed) {
            lua.lua_close(this.L);
            this.destroyed = true;
            log.debug('Lua runtime destroyed');
        }
    }
}
