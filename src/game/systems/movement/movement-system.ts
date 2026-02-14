import { EntityType, TileCoord, tileKey } from '../../entity';
import { MovementController, MovementState } from './movement-controller';
import { findPath } from '../pathfinding';
import { isPassable } from '../../features/placement';
import { GRID_DELTAS, getAllNeighbors } from '../hex-directions';
import { findSmartFreeDirection, shouldYieldToPush } from './push-utils';
import type { TickSystem } from '../../tick-system';
import type { EventBus } from '../../event-bus';
import type { SeededRng } from '../../rng';

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
/** Tracks previous state for change detection */
interface ControllerSnapshot {
    state: MovementState;
    direction: number;
}

export class MovementSystem implements TickSystem {
    private controllers: Map<number, MovementController> = new Map();

    // Map terrain and occupancy data
    private groundType?: Uint8Array;
    private groundHeight?: Uint8Array;
    private mapWidth?: number;
    private mapHeight?: number;
    private tileOccupancy?: Map<string, number>;

    // Callbacks for game state interaction (MUST be set via setCallbacks)
    private updatePosition!: UpdatePositionFn;
    private getEntity!: GetEntityFn;

    // Event bus for notifying other systems of movement changes (MUST be set via setEventBus)
    private eventBus!: EventBus;

    // Seeded RNG for deterministic push behavior (MUST be set via setRng)
    private rng!: SeededRng;

    // Previous state snapshots for change detection
    private prevSnapshots: Map<number, ControllerSnapshot> = new Map();

    /**
     * Set the terrain data for pathfinding and collision.
     */
    setTerrainData(groundType: Uint8Array, groundHeight: Uint8Array, mapWidth: number, mapHeight: number): void {
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
     * Set the event bus for emitting movement events.
     */
    setEventBus(eventBus: EventBus): void {
        this.eventBus = eventBus;
    }

    /**
     * Set the seeded RNG for deterministic push behavior.
     */
    setRng(rng: SeededRng): void {
        this.rng = rng;
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
        this.prevSnapshots.delete(entityId);
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
     * Clear all controllers.
     */
    clear(): void {
        this.controllers.clear();
        this.prevSnapshots.clear();
    }

    /**
     * Restore a movement controller from serialized data (used by persistence).
     */
    restoreController(data: {
        entityId: number;
        x: number;
        y: number;
        prevTileX: number;
        prevTileY: number;
        progress: number;
        speed: number;
        path: Array<{ x: number; y: number }>;
        pathIndex: number;
    }): void {
        const controller = new MovementController(data.entityId, data.x, data.y, data.speed);
        // Restore path if unit was moving
        if (data.path.length > 0) {
            controller.startPath(data.path);
            // Fast-forward to saved position in path
            for (let i = 0; i < data.pathIndex; i++) {
                controller.executeMove();
            }
        }
        this.controllers.set(data.entityId, controller);
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
            controller.tileX,
            controller.tileY,
            targetX,
            targetY,
            this.groundType,
            this.groundHeight,
            this.mapWidth,
            this.mapHeight,
            this.tileOccupancy,
            true // ignoreOccupancy: Initial plan should ignore transient units
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

    /** TickSystem interface — delegates to update(). */
    tick(dt: number): void {
        this.update(dt);
    }

    /**
     * Update all movement controllers for one tick.
     * @param deltaSec Time since last tick in seconds
     */
    update(deltaSec: number): void {
        // Sort by entity ID for deterministic iteration order
        const sortedIds = [...this.controllers.keys()].sort((a, b) => a - b);
        for (const entityId of sortedIds) {
            const controller = this.controllers.get(entityId);
            if (controller) {
                this.updateController(controller, deltaSec);
            }
        }
    }

    /** Check if the waypoint is blocked by a unit and try to resolve it */
    private handleBlockedWaypoint(controller: MovementController, wp: TileCoord, deltaSec: number): boolean {
        if (!this.tileOccupancy) return false;

        const blockingEntityId = this.tileOccupancy.get(tileKey(wp.x, wp.y));
        if (blockingEntityId === undefined || blockingEntityId === controller.entityId) {
            return false;
        }

        const blockingEntity = this.getEntity(blockingEntityId);
        if (!blockingEntity || blockingEntity.type !== EntityType.Unit) {
            return false;
        }

        if (!this.tryResolveObstacle(controller, blockingEntityId)) {
            controller.setBlocked(deltaSec);
            return true;
        }

        // After resolution, re-check if the CURRENT waypoint is still blocked
        // (detour may have changed the next waypoint to a different tile)
        const currentWp = controller.nextWaypoint;
        if (currentWp) {
            const stillBlocked = this.tileOccupancy.get(tileKey(currentWp.x, currentWp.y));
            if (stillBlocked !== undefined && stillBlocked !== controller.entityId) {
                controller.setBlocked(deltaSec);
                return true;
            }
        }

        return false;
    }

    /**
     * Update a single movement controller.
     */
    private updateController(controller: MovementController, deltaSec: number): void {
        // Capture state before update for change detection
        const prevSnapshot = this.prevSnapshots.get(controller.entityId);
        const prevState = prevSnapshot?.state ?? controller.state;
        const prevDirection = prevSnapshot?.direction ?? controller.direction;

        controller.advanceProgress(deltaSec);

        while (controller.canMove()) {
            const wp = controller.nextWaypoint;
            if (!wp) break;

            if (this.handleBlockedWaypoint(controller, wp, deltaSec)) break;

            const newPos = controller.executeMove();
            if (newPos && this.updatePosition) {
                this.updatePosition(controller.entityId, newPos.x, newPos.y);
            }
        }

        controller.finalizeTick();

        // Detect teleporting (visual position discontinuity)
        const teleportDist = controller.detectTeleport();
        if (teleportDist > 1.5) {
            console.warn(
                `[MovementSystem] TELEPORT DETECTED! Entity ${controller.entityId} jumped ${teleportDist.toFixed(2)} tiles`
            );
        }

        // Update last visual position for next frame's teleport detection
        controller.updateLastVisualPosition();

        // Emit events for state/direction changes
        this.emitMovementEvents(controller, prevState, prevDirection);

        // Update snapshot for next tick
        this.prevSnapshots.set(controller.entityId, {
            state: controller.state,
            direction: controller.direction,
        });
    }

    /**
     * Emit movement stopped event when unit stops.
     * Note: movementStarted and directionChanged events were removed as
     * animation is now handled by SettlerTaskSystem, not event-driven.
     * movementStopped is kept for CarrierSystem arrival detection.
     */
    private emitMovementEvents(controller: MovementController, prevState: MovementState, _prevDirection: number): void {
        const newState = controller.state;

        // Only emit movementStopped - used by CarrierSystem for arrival detection
        if (newState !== prevState && newState === 'idle' && prevState !== 'idle') {
            this.eventBus.emit('unit:movementStopped', {
                entityId: controller.entityId,
                direction: controller.direction,
            });
        }
    }

    /** Check if terrain data is available for pathfinding */
    private hasTerrainData(): boolean {
        return !!(this.groundType && this.groundHeight && this.mapWidth && this.mapHeight);
    }

    /** Try to repair the path by recalculating a portion of it */
    private tryPathRepair(controller: MovementController): boolean {
        if (!this.hasTerrainData() || !this.tileOccupancy) return false;

        const remainingSteps = controller.path.length - controller.pathIndex;

        if (remainingSteps > PATH_REPAIR_DISTANCE) {
            return this.repairPathPrefix(controller);
        }
        return this.repairFullPath(controller);
    }

    /** Recalculate a prefix of the path */
    private repairPathPrefix(controller: MovementController): boolean {
        const prefixTargetIdx = Math.min(controller.pathIndex + PATH_REPAIR_DISTANCE, controller.path.length - 1);
        const prefixTarget = controller.path[prefixTargetIdx];
        const newPrefix = findPath(
            controller.tileX,
            controller.tileY,
            prefixTarget.x,
            prefixTarget.y,
            this.groundType!,
            this.groundHeight!,
            this.mapWidth!,
            this.mapHeight!,
            this.tileOccupancy!,
            false // ignoreOccupancy: Repair should respect current obstacles
        );
        if (newPrefix && newPrefix.length > 0) {
            controller.replacePathPrefix(newPrefix, prefixTargetIdx + 1);
            return true;
        }
        return false;
    }

    /** Recalculate the entire remaining path */
    private repairFullPath(controller: MovementController): boolean {
        const goal = controller.path[controller.path.length - 1];
        const newPath = findPath(
            controller.tileX,
            controller.tileY,
            goal.x,
            goal.y,
            this.groundType!,
            this.groundHeight!,
            this.mapWidth!,
            this.mapHeight!,
            this.tileOccupancy!,
            false // ignoreOccupancy: Repair should respect current obstacles
        );
        if (newPath && newPath.length > 0) {
            controller.replacePath(newPath);
            return true;
        }
        return false;
    }

    /**
     * Try to resolve an obstacle blocking the path.
     * Strategies: detour, path repair, or push.
     */
    private tryResolveObstacle(controller: MovementController, blockingEntityId: number): boolean {
        // Strategy a: Try a 1-tile detour
        if (this.hasTerrainData()) {
            const detour = this.findDetour(controller);
            if (detour) {
                controller.insertDetour(detour);
                return true;
            }
        }

        // Strategy b: Recalculate path
        if (this.tryPathRepair(controller)) return true;

        // Strategy c: Push the blocking unit
        return this.pushUnit(controller.entityId, blockingEntityId);
    }

    /** Check if a tile is a valid detour candidate */
    private isValidDetourTile(neighbor: TileCoord, blockedWp: TileCoord): boolean {
        if (!this.groundType || !this.mapWidth || !this.mapHeight || !this.tileOccupancy) {
            return false;
        }

        if (neighbor.x === blockedWp.x && neighbor.y === blockedWp.y) return false;
        if (neighbor.x < 0 || neighbor.x >= this.mapWidth) return false;
        if (neighbor.y < 0 || neighbor.y >= this.mapHeight) return false;

        const nIdx = neighbor.x + neighbor.y * this.mapWidth;
        if (!isPassable(this.groundType[nIdx])) return false;
        if (this.tileOccupancy.has(tileKey(neighbor.x, neighbor.y))) return false;

        return true;
    }

    /** Check if neighbor is adjacent to the rejoin point */
    private isAdjacentToRejoin(neighbor: TileCoord, rejoinWp: TileCoord): boolean {
        const rdx = neighbor.x - rejoinWp.x;
        const rdy = neighbor.y - rejoinWp.y;
        return GRID_DELTAS.some(([gx, gy]) => gx === rdx && gy === rdy);
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

        const nextIdx = controller.pathIndex + 1;
        const rejoinWp = nextIdx < controller.path.length ? controller.path[nextIdx] : blockedWp;

        const neighbors = getAllNeighbors({ x: controller.tileX, y: controller.tileY });

        for (const neighbor of neighbors) {
            if (!this.isValidDetourTile(neighbor, blockedWp)) continue;
            if (this.isAdjacentToRejoin(neighbor, rejoinWp)) return neighbor;
        }

        return null;
    }

    /**
     * Repath a controller from its current position to a goal.
     */
    private repathToGoal(controller: MovementController, goal: TileCoord): void {
        if (!this.hasTerrainData() || !this.tileOccupancy) return;

        // Don't repath if already at goal
        if (controller.tileX === goal.x && controller.tileY === goal.y) return;

        const newPath = findPath(
            controller.tileX,
            controller.tileY,
            goal.x,
            goal.y,
            this.groundType!,
            this.groundHeight!,
            this.mapWidth!,
            this.mapHeight!,
            this.tileOccupancy,
            true // ignoreOccupancy for planning
        );

        if (newPath && newPath.length > 0) {
            controller.redirectPath(newPath);
        }
    }

    /**
     * Push a blocking unit out of the way.
     * Only succeeds if the blocking unit's ID is higher than the pushing unit's ID.
     * Prefers pushing in a direction that helps the blocked unit toward its goal.
     * Immediately repaths the pushed unit to continue toward its original goal.
     */
    private pushUnit(pushingEntityId: number, blockedEntityId: number): boolean {
        if (!shouldYieldToPush(pushingEntityId, blockedEntityId)) return false;

        const blockedController = this.controllers.get(blockedEntityId);
        if (!blockedController) return false;

        // Don't push a unit that's mid-transit - would cause visual teleport
        if (blockedController.isInTransit) return false;

        if (!this.tileOccupancy || !this.rng) return false;

        const terrain = this.hasTerrainData()
            ? { groundType: this.groundType!, mapWidth: this.mapWidth!, mapHeight: this.mapHeight! }
            : undefined;

        // Save the goal before pushing - unit should continue toward this
        const goal = blockedController.goal;

        const freeDir = findSmartFreeDirection(
            blockedController.tileX,
            blockedController.tileY,
            this.tileOccupancy,
            this.rng,
            terrain,
            goal?.x,
            goal?.y
        );
        if (!freeDir) return false;

        // Execute the push
        blockedController.handlePush(freeDir.x, freeDir.y);
        this.updatePosition(blockedEntityId, freeDir.x, freeDir.y);

        // Repath to continue toward original goal
        if (goal) {
            this.repathToGoal(blockedController, goal);
        }

        return true;
    }
}
