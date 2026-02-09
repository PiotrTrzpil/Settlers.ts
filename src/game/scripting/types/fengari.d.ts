/**
 * Type declarations for Fengari Lua interpreter
 * @see https://github.com/fengari-lua/fengari
 *
 * Note: Fengari uses Uint8Array (Lua strings) for most string operations.
 * Use to_luastring() to convert JS strings before passing to Lua functions.
 */

declare module 'fengari' {
    /** Lua string type - can be string or Uint8Array */
    export type LuaString = string | Uint8Array;

    export interface lua_State {
        // Opaque type representing Lua state
    }

    export namespace lua {
        // Thread status
        const LUA_OK: number;
        const LUA_YIELD: number;
        const LUA_ERRRUN: number;
        const LUA_ERRSYNTAX: number;
        const LUA_ERRMEM: number;
        const LUA_ERRERR: number;

        // Type constants
        const LUA_TNONE: number;
        const LUA_TNIL: number;
        const LUA_TBOOLEAN: number;
        const LUA_TLIGHTUSERDATA: number;
        const LUA_TNUMBER: number;
        const LUA_TSTRING: number;
        const LUA_TTABLE: number;
        const LUA_TFUNCTION: number;
        const LUA_TUSERDATA: number;
        const LUA_TTHREAD: number;

        // Pseudo-indices
        const LUA_REGISTRYINDEX: number;

        // Hook masks
        const LUA_MASKCALL: number;
        const LUA_MASKRET: number;
        const LUA_MASKLINE: number;
        const LUA_MASKCOUNT: number;

        // State manipulation
        function lua_close(L: lua_State): void;

        // Stack manipulation
        function lua_gettop(L: lua_State): number;
        function lua_settop(L: lua_State, idx: number): void;
        function lua_pop(L: lua_State, n: number): void;
        function lua_pushvalue(L: lua_State, idx: number): void;
        function lua_remove(L: lua_State, idx: number): void;
        function lua_insert(L: lua_State, idx: number): void;
        function lua_replace(L: lua_State, idx: number): void;

        // Type checking
        function lua_type(L: lua_State, idx: number): number;
        function lua_typename(L: lua_State, tp: number): string;
        function lua_isnil(L: lua_State, idx: number): boolean;
        function lua_isboolean(L: lua_State, idx: number): boolean;
        function lua_isnumber(L: lua_State, idx: number): boolean;
        function lua_isstring(L: lua_State, idx: number): boolean;
        function lua_istable(L: lua_State, idx: number): boolean;
        function lua_isfunction(L: lua_State, idx: number): boolean;

        // Value getters
        function lua_toboolean(L: lua_State, idx: number): boolean;
        function lua_tonumber(L: lua_State, idx: number): number;
        function lua_tointeger(L: lua_State, idx: number): number;
        function lua_tostring(L: lua_State, idx: number): string;

        // Value pushers
        function lua_pushnil(L: lua_State): void;
        function lua_pushboolean(L: lua_State, b: boolean): void;
        function lua_pushnumber(L: lua_State, n: number): void;
        function lua_pushinteger(L: lua_State, n: number): void;
        function lua_pushstring(L: lua_State, s: LuaString): void;
        function lua_pushlstring(L: lua_State, s: Uint8Array, len: number): void;
        function lua_pushcfunction(L: lua_State, fn: (L: lua_State) => number): void;
        function lua_pushlightuserdata(L: lua_State, p: any): void;

        // Table operations
        function lua_newtable(L: lua_State): void;
        function lua_createtable(L: lua_State, narr: number, nrec: number): void;
        function lua_gettable(L: lua_State, idx: number): number;
        function lua_settable(L: lua_State, idx: number): void;
        function lua_getfield(L: lua_State, idx: number, k: LuaString): number;
        function lua_setfield(L: lua_State, idx: number, k: LuaString): void;
        function lua_rawget(L: lua_State, idx: number): number;
        function lua_rawset(L: lua_State, idx: number): void;
        function lua_rawgeti(L: lua_State, idx: number, n: number): number;
        function lua_rawseti(L: lua_State, idx: number, n: number): void;

        // Global table
        function lua_getglobal(L: lua_State, name: LuaString): number;
        function lua_setglobal(L: lua_State, name: LuaString): void;

        // Function calls
        function lua_call(L: lua_State, nargs: number, nresults: number): void;
        function lua_pcall(L: lua_State, nargs: number, nresults: number, msgh: number): number;

        // Debug hooks
        function lua_sethook(L: lua_State, fn: (L: lua_State, ar: any) => void, mask: number, count: number): void;

        // Next (for table iteration)
        function lua_next(L: lua_State, idx: number): number;
    }

    export namespace lauxlib {
        function luaL_newstate(): lua_State;
        function luaL_loadstring(L: lua_State, s: LuaString): number;
        function luaL_loadbuffer(L: lua_State, buff: Uint8Array, size: number, name: LuaString): number;
        function luaL_ref(L: lua_State, t: number): number;
        function luaL_unref(L: lua_State, t: number, ref: number): void;
        function luaL_checktype(L: lua_State, arg: number, t: number): void;
        function luaL_checkinteger(L: lua_State, arg: number): number;
        function luaL_checknumber(L: lua_State, arg: number): number;
        function luaL_checkstring(L: lua_State, arg: number): string;
        function luaL_optinteger(L: lua_State, arg: number, def: number): number;
        function luaL_optnumber(L: lua_State, arg: number, def: number): number;
        function luaL_optstring(L: lua_State, arg: number, def: string): string;
        function luaL_error(L: lua_State, msg: LuaString): never;
        function luaL_typename(L: lua_State, idx: number): string;
    }

    export namespace lualib {
        function luaL_openlibs(L: lua_State): void;
    }

    // String utilities
    export function to_luastring(str: string): Uint8Array;
    export function to_jsstring(luastr: Uint8Array): string;
}

declare module 'fengari-interop' {
    import { lua_State } from 'fengari';

    export function push(L: lua_State, value: any): void;
    export function tojs(L: lua_State, idx: number): any;
    export function luaopen_js(L: lua_State): number;
}
