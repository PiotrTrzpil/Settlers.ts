/**
 * Movement system module.
 *
 * This module provides a clean, encapsulated movement system for units:
 *
 * - MovementController: Per-unit state machine managing position, path, and interpolation
 * - MovementSystem: Coordinates all controllers, handles bump resolution
 * - Interpolator: Calculates smooth visual positions between tiles
 *
 * Usage:
 *   const system = new MovementSystem({
 *       eventBus,
 *       updatePosition: (id, x, y) => ...,
 *       getEntity: (id) => ...,
 *   });
 *   system.setTerrainData(groundType, groundHeight, width, height);
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
export type { UpdatePositionFn, GetEntityFn, MovementSystemConfig } from './movement-system';
export { MovementSystem } from './movement-system';
export type { WorldCoord, TileToWorldFn } from './interpolator';
export { Interpolator, createTestInterpolator } from './interpolator';

// Extracted sub-modules
export type { IPathfinder } from './pathfinding-service';
export { PathfindingService } from './pathfinding-service';
