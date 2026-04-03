/**
 * Core module barrel — base types and utilities with no feature dependencies.
 */

export { type Tile, tileKey, isInMapBounds, CARDINAL_OFFSETS, EXTENDED_OFFSETS } from './coordinates';
export { distSq } from './distance';
export { bfsFind, scanRect } from './tile-search';
export { Race } from './race';
export type { SeededRng } from './rng';
export type { TickSystem } from './tick-system';
