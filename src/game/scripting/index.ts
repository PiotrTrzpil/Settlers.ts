/**
 * Lua Scripting Module
 *
 * Provides Lua scripting support for map scripts, victory conditions,
 * and game events. Compatible with Settlers 4 script API.
 *
 * Usage:
 * ```typescript
 * import { LuaScriptSystem } from '@/game/scripting';
 *
 * const scriptSystem = new LuaScriptSystem({
 *   gameState,
 *   mapWidth: 256,
 *   mapHeight: 256,
 * });
 *
 * scriptSystem.initialize();
 * scriptSystem.loadScriptCode(`
 *   Events.TICK(function()
 *     -- Called every game tick
 *   end)
 * `);
 *
 * // In game loop:
 * scriptSystem.tick(deltaTime);
 *
 * // Cleanup:
 * scriptSystem.destroy();
 * ```
 */

// Core runtime
export { LuaRuntime } from './lua-runtime';

// Event system
export { LuaEventDispatcher } from './event-dispatcher';
export type { ScriptEventType } from './event-dispatcher';

// Script system
export { LuaScriptSystem } from './lua-script-system';
export type { LuaScriptSystemConfig } from './lua-script-system';

// Script loading
export {
    loadScriptFromMapData,
    loadScriptFromString,
    validateScript,
    extractScriptMetadata,
} from './script-loader';
export type { ScriptSource } from './script-loader';

// Compatibility
export { applyLuaCompatShim, LUA_COMPAT_SHIM } from './lua-compat';

// Script service (high-level integration)
export { ScriptService, deriveScriptPath } from './script-service';
export type { ScriptLoadResult } from './script-service';

// API constants (for external use)
export {
    RACE_CONSTANTS,
    S4_SETTLER_TYPES,
    S4_BUILDING_TYPES,
    S4_GOOD_TYPES,
    BUILDING_STATE_CONSTANTS,
    AI_MODE_CONSTANTS,
} from './api';
