import { EntityType, TileCoord, tileKey } from '../../entity';
import { MovementController } from './movement-controller';
import { findPath } from '../pathfinding';
import { isPassable } from '../placement';
import { GRID_DELTAS, getAllNeighbors } from '../hex-directions';
import { findRandomFreeDirection, shouldYieldToPush } from './push-utils';

/** How many steps ahead to look when doing prefix path repair */
const PATH_REPAIR_DISTANCE = 10;

/**
 * Callback for updating entity position in the game state.
 * Returns true if the update was successful.
 */
export type UpdatePositionFn = (entityId: number, x: number, y: number) => boolean;

/**
 * Callback for getting entity information.
 */
export type GetEntityFn = (entityId: number) => { type: EntityType; x: number; y: number } | undefined;

/**
 * MovementSystem manages all unit movement controllers and coordinates
 * their updates, collision resolution, and pathfinding.
 */
export class MovementSystem {
    private controllers: Map<number, MovementController> = new Map();

    // Map terrain and occupancy data
    private groundType?: Uint8Array;
    private groundHeight?: Uint8Array;
    private mapWidth?: number;
    private mapHeight?: number;
    private tileOccupancy?: Map<string, number>;

    // Callbacks for game state interaction
    private updatePosition?: UpdatePositionFn;
    private getEntity?: GetEntityFn;

    /**
     * Set the terrain data for pathfinding and collision.
     */
    setTerrainData(
        groundType: Uint8Array,
        groundHeight: Uint8Array,
        mapWidth: number,
        mapHeight: number
    ): void {
        this.groundType = groundType;
        this.groundHeight = groundHeight;
        this.mapWidth = mapWidth;
        this.mapHeight = mapHeight;
    }

    /**
     * Set the tile occupancy map for collision detection.
     */
    setTileOccupancy(occupancy: Map<string, number>): void {
        this.tileOccupancy = occupancy;
    }

    /**
     * Set callbacks for game state interaction.
     */
    setCallbacks(updatePosition: UpdatePositionFn, getEntity: GetEntityFn): void {
        this.updatePosition = updatePosition;
        this.getEntity = getEntity;
    }

    /**
     * Create a new movement controller for a unit.
     */
    createController(entityId: number, x: number, y: number, speed: number): MovementController {
        const controller = new MovementController(entityId, x, y, speed);
        this.controllers.set(entityId, controller);
        return controller;
    }

    /**
     * Get an existing movement controller.
     */
    getController(entityId: number): MovementController | undefined {
        return this.controllers.get(entityId);
    }

    /**
     * Remove a movement controller.
     */
    removeController(entityId: number): void {
        this.controllers.delete(entityId);
    }

    /**
     * Check if a controller exists.
     */
    hasController(entityId: number): boolean {
        return this.controllers.has(entityId);
    }

    /**
     * Get all controllers.
     */
    getAllControllers(): IterableIterator<MovementController> {
        return this.controllers.values();
    }

    /**
     * Issue a move command to a unit.
     * Calculates path and sets up the controller for movement.
     * @returns true if a valid path was found
     */
    moveUnit(entityId: number, targetX: number, targetY: number): boolean {
        const controller = this.controllers.get(entityId);
        if (!controller) return false;

        if (!this.groundType || !this.groundHeight || !this.mapWidth || !this.mapHeight || !this.tileOccupancy) {
            return false;
        }

        const path = findPath(
            controller.tileX, controller.tileY,
            targetX, targetY,
            this.groundType, this.groundHeight,
            this.mapWidth, this.mapHeight,
            this.tileOccupancy
        );

        if (!path || path.length === 0) return false;

        // Use startPath if stationary, redirectPath if in motion
        if (controller.isInTransit) {
            controller.redirectPath(path);
        } else {
            controller.startPath(path);
        }

        return true;
    }

    /**
     * Update all movement controllers for one tick.
     * @param deltaSec Time since last tick in seconds
     */
    update(deltaSec: number): void {
        for (const controller of this.controllers.values()) {
            this.updateController(controller, deltaSec);
        }
    }

    /**
     * Update a single movement controller.
     */
    private updateController(controller: MovementController, deltaSec: number): void {
        // Advance progress
        controller.advanceProgress(deltaSec);

        // Process moves while progress >= 1 and path remains
        while (controller.canMove()) {
            const wp = controller.nextWaypoint;
            if (!wp) break;

            // Check if next waypoint is blocked by another unit
            if (this.tileOccupancy) {
                const blockingEntityId = this.tileOccupancy.get(tileKey(wp.x, wp.y));
                if (blockingEntityId !== undefined && blockingEntityId !== controller.entityId) {
                    const blockingEntity = this.getEntity?.(blockingEntityId);
                    if (blockingEntity && blockingEntity.type === EntityType.Unit) {
                        const resolved = this.tryResolveObstacle(
                            controller,
                            blockingEntityId
                        );
                        if (!resolved) {
                            // Wait and retry next tick
                            controller.setBlocked(deltaSec);
                            break;
                        }
                        // After resolution, re-check if waypoint is still valid
                        const stillBlocked = this.tileOccupancy.get(tileKey(wp.x, wp.y));
                        if (stillBlocked !== undefined && stillBlocked !== controller.entityId) {
                            controller.setBlocked(deltaSec);
                            break;
                        }
                    }
                }
            }

            // Execute the move
            const newPos = controller.executeMove();
            if (newPos && this.updatePosition) {
                this.updatePosition(controller.entityId, newPos.x, newPos.y);
            }
        }

        // Finalize tick (handle path/transit completion)
        controller.finalizeTick();
    }

    /**
     * Try to resolve an obstacle blocking the path.
     * Strategies:
     *   a) Find a 1-tile detour around the obstacle
     *   b) Recalculate a prefix of the path
     *   c) Push the blocking unit (lower entity ID yields)
     */
    private tryResolveObstacle(
        controller: MovementController,
        blockingEntityId: number
    ): boolean {
        // Strategy a: Try a 1-tile detour around the obstacle
        if (this.groundType && this.groundHeight && this.mapWidth && this.mapHeight) {
            const detour = this.findDetour(controller);
            if (detour) {
                controller.insertDetour(detour);
                return true;
            }
        }

        // Strategy b: Recalculate a prefix of the path
        if (this.groundType && this.groundHeight && this.mapWidth && this.mapHeight && this.tileOccupancy) {
            const remainingSteps = controller.path.length - controller.pathIndex;

            if (remainingSteps > PATH_REPAIR_DISTANCE) {
                // Recalculate prefix
                const prefixTargetIdx = Math.min(
                    controller.pathIndex + PATH_REPAIR_DISTANCE,
                    controller.path.length - 1
                );
                const prefixTarget = controller.path[prefixTargetIdx];
                const newPrefix = findPath(
                    controller.tileX, controller.tileY,
                    prefixTarget.x, prefixTarget.y,
                    this.groundType, this.groundHeight,
                    this.mapWidth, this.mapHeight,
                    this.tileOccupancy
                );
                if (newPrefix && newPrefix.length > 0) {
                    controller.replacePathPrefix(newPrefix, prefixTargetIdx + 1);
                    return true;
                }
            } else {
                // Few steps left — recalculate entire remaining path
                const goal = controller.path[controller.path.length - 1];
                const newPath = findPath(
                    controller.tileX, controller.tileY,
                    goal.x, goal.y,
                    this.groundType, this.groundHeight,
                    this.mapWidth, this.mapHeight,
                    this.tileOccupancy
                );
                if (newPath && newPath.length > 0) {
                    controller.replacePath(newPath);
                    return true;
                }
            }
        }

        // Strategy c: Push the blocking unit
        return this.pushUnit(controller.entityId, blockingEntityId);
    }

    /**
     * Find a 1-tile detour around a blocked tile.
     */
    private findDetour(controller: MovementController): TileCoord | null {
        if (!this.groundType || !this.mapWidth || !this.mapHeight || !this.tileOccupancy) {
            return null;
        }

        const blockedWp = controller.nextWaypoint;
        if (!blockedWp) return null;

        // The tile we want to rejoin the path at
        const nextIdx = controller.pathIndex + 1;
        const rejoinWp = nextIdx < controller.path.length
            ? controller.path[nextIdx]
            : blockedWp;

        const neighbors = getAllNeighbors({ x: controller.tileX, y: controller.tileY });

        for (const neighbor of neighbors) {
            // Skip the blocked tile itself
            if (neighbor.x === blockedWp.x && neighbor.y === blockedWp.y) continue;

            // Bounds check
            if (neighbor.x < 0 || neighbor.x >= this.mapWidth ||
                neighbor.y < 0 || neighbor.y >= this.mapHeight) {
                continue;
            }

            const nIdx = neighbor.x + neighbor.y * this.mapWidth;

            // Must be passable
            if (!isPassable(this.groundType[nIdx])) continue;

            // Must not be occupied
            if (this.tileOccupancy.has(tileKey(neighbor.x, neighbor.y))) continue;

            // Check that this detour tile is a hex neighbor of the rejoin point
            const rdx = neighbor.x - rejoinWp.x;
            const rdy = neighbor.y - rejoinWp.y;
            const isAdjacentToRejoin = GRID_DELTAS.some(([gx, gy]) => gx === rdx && gy === rdy);

            if (isAdjacentToRejoin) {
                return neighbor;
            }
        }

        return null;
    }

    /**
     * Push a blocking unit out of the way.
     * Only succeeds if the blocking unit's ID is higher than the pushing unit's ID.
     */
    private pushUnit(pushingEntityId: number, blockedEntityId: number): boolean {
        // Check if push is allowed (lower ID has priority)
        if (!shouldYieldToPush(pushingEntityId, blockedEntityId)) return false;

        const blockedController = this.controllers.get(blockedEntityId);
        if (!blockedController) return false;

        if (!this.tileOccupancy) return false;

        const terrain = this.groundType && this.mapWidth && this.mapHeight
            ? { groundType: this.groundType, mapWidth: this.mapWidth, mapHeight: this.mapHeight }
            : undefined;

        const freeDir = findRandomFreeDirection(
            blockedController.tileX,
            blockedController.tileY,
            this.tileOccupancy,
            terrain
        );
        if (!freeDir) return false;

        // Handle the push in the controller
        blockedController.handlePush(freeDir.x, freeDir.y);

        // Update game state
        if (this.updatePosition) {
            this.updatePosition(blockedEntityId, freeDir.x, freeDir.y);
        }

        return true;
    }
}
