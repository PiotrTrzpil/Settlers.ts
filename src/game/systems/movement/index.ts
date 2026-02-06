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

export { MovementController, MovementState } from './movement-controller';
export { MovementSystem, UpdatePositionFn, GetEntityFn } from './movement-system';
export { Interpolator, WorldCoord, TileToWorldFn, createTestInterpolator } from './interpolator';

// Push utilities - clean API without GameState coupling
export {
    pushUnit,
    findRandomFreeDirection,
    shouldYieldToPush,
    executePush,
} from './push-utils';
export type { TileOccupancyAccessor, TerrainAccessor } from './push-utils';
