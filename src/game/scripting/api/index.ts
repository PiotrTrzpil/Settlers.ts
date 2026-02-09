/**
 * Lua API modules
 * Exports all API registration functions and contexts
 */

export { registerGameAPI, RACE_CONSTANTS } from './game-api';
export type { GameAPIContext } from './game-api';

export { registerSettlersAPI, S4_SETTLER_TYPES } from './settlers-api';
export type { SettlersAPIContext } from './settlers-api';

export { registerBuildingsAPI, S4_BUILDING_TYPES, BUILDING_STATE_CONSTANTS } from './buildings-api';
export type { BuildingsAPIContext } from './buildings-api';

export { registerMapAPI } from './map-api';
export type { MapAPIContext } from './map-api';

export { registerGoodsAPI, S4_GOOD_TYPES } from './goods-api';
export type { GoodsAPIContext } from './goods-api';

export { registerDebugAPI } from './debug-api';
export type { DebugAPIContext } from './debug-api';

export { registerAIAPI, AI_MODE_CONSTANTS } from './ai-api';
export type { AIAPIContext } from './ai-api';
