/**
 * Movement system — per-unit controllers, bump resolution, and pathfinding.
 *
 *   const system = new MovementSystem({ eventBus, updatePosition, unitOccupancy, buildingOccupancy, rng });
 *   system.setTerrainData(groundType, width, height);
 *   system.createController(entityId, tile, speed);
 *   system.moveUnit(entityId, target);
 *   system.update(deltaSec);
 */

export type { MovementState } from './movement-controller';
export { MovementController } from './movement-controller';
export type { UpdatePositionFn, MovementSystemConfig } from './movement-system';
export { MovementSystem } from './movement-system';
