/**
 * LuaEventDispatcher - Manages Lua event registration and dispatch
 * Bridges game events to Lua callback functions
 */

import { lua, lauxlib, to_luastring, to_jsstring } from 'fengari';
import type { lua_State } from 'fengari';

/**
 * Convert JS string to Lua string (Uint8Array)
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
import type { LuaRuntime } from './lua-runtime';

const log = new LogHandler('LuaEventDispatcher');

/** All available script events */
export type ScriptEventType =
    | 'TICK'
    | 'FIVE_TICKS'
    | 'FIRST_TICK_OF_NEW_GAME'
    | 'FIRST_TICK_OF_NEW_OR_LOADED_GAME'
    | 'VICTORY_CONDITION_CHECK'
    | 'COMMAND'
    | 'SPACE'
    | 'DRAG_BUILDING'
    | 'CRUSH_BUILDING'
    | 'WARRIOR_SENT'
    | 'MAGIC_SPELL_CAST'
    | 'PRODUCTION'
    | 'GOODARRIVE'
    | 'SETTLER_CHANGE_TYPE'
    | 'MENUCLICK'
    | 'ZOOM_FACTOR_CHANGED'
    | 'BUILD_PRIO'
    | 'WORK_AREA'
    | 'WORK_STATUS'
    | 'SHOW_WORK_AREA'
    | 'CREATE_FOUNDATION_CART';

/** Event handler reference (Lua function stored in registry) */
interface EventHandler {
    ref: number;
}

export class LuaEventDispatcher {
    private runtime: LuaRuntime;
    private handlers: Map<ScriptEventType, EventHandler[]> = new Map();

    constructor(runtime: LuaRuntime) {
        this.runtime = runtime;
    }

    /**
     * Register a Lua function as an event handler
     * @param event Event type to listen for
     * @param luaFuncRef Reference to Lua function (from luaL_ref)
     */
    public registerHandler(event: ScriptEventType, luaFuncRef: number): void {
        if (!this.handlers.has(event)) {
            this.handlers.set(event, []);
        }
        this.handlers.get(event)!.push({ ref: luaFuncRef });
        log.debug(`Registered handler for ${event}`);
    }

    /**
     * Unregister all handlers for an event
     */
    public clearHandlers(event: ScriptEventType): void {
        const handlers = this.handlers.get(event);
        if (handlers) {
            const L = this.runtime.getState();
            for (const handler of handlers) {
                lauxlib.luaL_unref(L, lua.LUA_REGISTRYINDEX, handler.ref);
            }
            this.handlers.delete(event);
        }
    }

    /**
     * Clear all event handlers
     */
    public clearAllHandlers(): void {
        const L = this.runtime.getState();
        for (const [, handlers] of this.handlers) {
            for (const handler of handlers) {
                lauxlib.luaL_unref(L, lua.LUA_REGISTRYINDEX, handler.ref);
            }
        }
        this.handlers.clear();
    }

    /**
     * Dispatch an event to all registered handlers
     * @param event Event type
     * @param args Arguments to pass to handlers
     */
    public dispatch(event: ScriptEventType, ...args: any[]): void {
        const handlers = this.handlers.get(event);
        if (!handlers || handlers.length === 0) {
            return;
        }

        const L = this.runtime.getState();
        this.runtime.resetInstructionCount();

        for (const handler of handlers) {
            try {
                // Get function from registry
                lua.lua_rawgeti(L, lua.LUA_REGISTRYINDEX, handler.ref);

                if (!lua.lua_isfunction(L, -1)) {
                    lua.lua_pop(L, 1);
                    log.error(`Handler for ${event} is not a function`);
                    continue;
                }

                // Push arguments
                for (const arg of args) {
                    this.runtime.pushJSValue(arg);
                }

                // Call the handler
                const result = lua.lua_pcall(L, args.length, 0, 0);
                if (result !== lua.LUA_OK) {
                    const error = toJsStr(lua.lua_tostring(L, -1));
                    lua.lua_pop(L, 1);
                    log.error(`Error in ${event} handler: ${error}`);
                }
            } catch (e) {
                const msg = e instanceof Error ? e.message : String(e);
                log.error(`Exception dispatching ${event}: ${msg}`);
            }
        }
    }

    /**
     * Check if there are any handlers for an event
     */
    public hasHandlers(event: ScriptEventType): boolean {
        const handlers = this.handlers.get(event);
        return handlers !== undefined && handlers.length > 0;
    }

    /**
     * Get count of handlers for an event
     */
    public getHandlerCount(event: ScriptEventType): number {
        return this.handlers.get(event)?.length ?? 0;
    }

    /**
     * Register the Events table in Lua
     * Creates Events.TICK(), Events.VICTORY_CONDITION_CHECK(), etc.
     */
    public registerEventsAPI(): void {
        const L = this.runtime.getState();

        // Create Events table
        lua.lua_newtable(L);

        // Register event registration functions
        const events: ScriptEventType[] = [
            'TICK',
            'FIVE_TICKS',
            'FIRST_TICK_OF_NEW_GAME',
            'FIRST_TICK_OF_NEW_OR_LOADED_GAME',
            'VICTORY_CONDITION_CHECK',
            'COMMAND',
            'SPACE',
            'DRAG_BUILDING',
            'CRUSH_BUILDING',
            'WARRIOR_SENT',
            'MAGIC_SPELL_CAST',
            'PRODUCTION',
            'GOODARRIVE',
            'SETTLER_CHANGE_TYPE',
            'MENUCLICK',
            'ZOOM_FACTOR_CHANGED',
            'BUILD_PRIO',
            'WORK_AREA',
            'WORK_STATUS',
            'SHOW_WORK_AREA',
            'CREATE_FOUNDATION_CART',
        ];

        for (const eventName of events) {
            this.createEventRegistrationFunction(L, eventName);
        }

        // Set as global
        lua.lua_setglobal(L, toLuaStr('Events'));
    }

    /**
     * Create a function that registers a handler for an event
     */
    private createEventRegistrationFunction(L: lua_State, eventName: ScriptEventType): void {
        // Capture 'this' for use in closure
        // eslint-disable-next-line @typescript-eslint/no-this-alias
        const dispatcher = this;

        lua.lua_pushcfunction(L, (luaState: lua_State) => {
            // Check that argument is a function
            lauxlib.luaL_checktype(luaState, 1, lua.LUA_TFUNCTION);

            // Store function in registry and get reference
            lua.lua_pushvalue(luaState, 1);
            const ref = lauxlib.luaL_ref(luaState, lua.LUA_REGISTRYINDEX);

            // Register the handler
            dispatcher.registerHandler(eventName, ref);

            return 0;
        });

        lua.lua_setfield(L, -2, toLuaStr(eventName));
    }
}
