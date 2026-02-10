/**
 * Movement system module.
 *
 * This module provides a clean, encapsulated movement system for units:
 *
 * - MovementController: Per-unit state machine managing position, path, and interpolation
 * - MovementSystem: Coordinates all controllers, handles collision resolution
 * - Interpolator: Calculates smooth visual positions between tiles
 *
 * Usage:
 *   const system = new MovementSystem();
 *   system.setTerrainData(groundType, groundHeight, width, height);
 *   system.setTileOccupancy(occupancy);
 *   system.setCallbacks(updatePosition, getEntity);
 *
 *   // Create controller when unit spawns
 *   const controller = system.createController(entityId, x, y, speed);
 *
 *   // Issue movement commands
 *   system.moveUnit(entityId, targetX, targetY);
 *
 *   // Update each tick
 *   system.update(deltaSec);
 *
 *   // For rendering, use Interpolator
 *   const interpolator = new Interpolator(tileToWorldFn);
 *   const worldPos = interpolator.getInterpolatedPosition(controller);
 */

export type { MovementState } from './movement-controller';
export { MovementController } from './movement-controller';
export type { UpdatePositionFn, GetEntityFn } from './movement-system';
export { MovementSystem } from './movement-system';
export type { WorldCoord, TileToWorldFn } from './interpolator';
export { Interpolator, createTestInterpolator } from './interpolator';

// Push utilities - clean API without GameState coupling
export {
    pushUnit,
    findRandomFreeDirection,
    findSmartFreeDirection,
    shouldYieldToPush,
    executePush,
} from './push-utils';
export type { TileOccupancyAccessor, TerrainAccessor } from './push-utils';
