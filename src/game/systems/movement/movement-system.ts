import { EntityType, TileCoord, tileKey } from '../../entity';
import { MovementController, MovementState } from './movement-controller';
import { findPath } from '../pathfinding';
import { isPassable } from '../terrain-queries';
import { getAllNeighbors, hexDistance } from '../hex-directions';
import { findSmartFreeDirection, shouldYieldToPush } from './push-utils';
import type { TickSystem } from '../../tick-system';
import type { EventBus } from '../../event-bus';
import type { SeededRng } from '../../rng';

/** How many steps ahead to look when doing prefix path repair */
const PATH_REPAIR_DISTANCE = 10;

/** After this many seconds blocked, do a full repath ignoring the blocker */
const BLOCKED_REPATH_TIMEOUT = 0.5;

/** After this many seconds blocked, give up and stop */
const BLOCKED_GIVEUP_TIMEOUT = 2.0;

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
 * Configuration for MovementSystem dependencies.
 */
export interface MovementSystemConfig {
    eventBus: EventBus;
    rng: SeededRng;
    updatePosition: UpdatePositionFn;
    getEntity: GetEntityFn;
}

/**
 * MovementSystem manages all unit movement controllers and coordinates
 * their updates, collision resolution, and pathfinding.
 */
export class MovementSystem implements TickSystem {
    private controllers: Map<number, MovementController> = new Map();

    // Map terrain and occupancy data (set when map loads via setTerrainData)
    private groundType?: Uint8Array;
    private groundHeight?: Uint8Array;
    private mapWidth?: number;
    private mapHeight?: number;
    private tileOccupancy?: Map<string, number>;

    // Callbacks for game state interaction
    private readonly updatePosition: UpdatePositionFn;
    private readonly getEntity: GetEntityFn;

    // Event bus for notifying other systems of movement changes
    private readonly eventBus: EventBus;

    // Seeded RNG for deterministic push behavior
    private readonly rng: SeededRng;

    // Previous movement state per controller for change detection
    private prevStates: Map<number, MovementState> = new Map();

    constructor(config: MovementSystemConfig) {
        this.eventBus = config.eventBus;
        this.rng = config.rng;
        this.updatePosition = config.updatePosition;
        this.getEntity = config.getEntity;
    }

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
        this.prevStates.delete(entityId);
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

        // Escalation based on how long we've been blocked:
        // 1. Try normal obstacle resolution (detour / path repair / push)
        // 2. After BLOCKED_REPATH_TIMEOUT: full repath ignoring occupancy
        // 3. After BLOCKED_GIVEUP_TIMEOUT: give up and stop
        if (controller.blockedTime >= BLOCKED_GIVEUP_TIMEOUT) {
            controller.clearPath();
            return true;
        }

        if (controller.blockedTime >= BLOCKED_REPATH_TIMEOUT) {
            // Escalated repath: ignore occupancy to find ANY path to goal
            if (this.tryEscalatedRepath(controller)) return false;
        }

        if (!this.tryResolveObstacle(controller, blockingEntityId)) {
            // Try mutual yielding: if we can't push them (they have lower ID),
            // and they're also walking, we step sideways ourselves
            if (!this.tryYield(controller, blockingEntityId)) {
                controller.setBlocked(deltaSec);
                return true;
            }
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
        const prevState = this.prevStates.get(controller.entityId) ?? controller.state;

        controller.advanceProgress(deltaSec);

        while (controller.canMove()) {
            const wp = controller.nextWaypoint;
            if (!wp) break;

            if (this.handleBlockedWaypoint(controller, wp, deltaSec)) break;

            const newPos = controller.executeMove();
            if (newPos) {
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

        controller.updateLastVisualPosition();
        this.emitMovementStopped(controller, prevState);
        this.prevStates.set(controller.entityId, controller.state);
    }

    private emitMovementStopped(controller: MovementController, prevState: MovementState): void {
        if (controller.state !== prevState && controller.state === 'idle' && prevState !== 'idle') {
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
     * Strategies: detour (step sideways + repath), path repair, or push.
     */
    private tryResolveObstacle(controller: MovementController, blockingEntityId: number): boolean {
        // Strategy a: Try a 1-tile sidestep + repath remaining path
        if (this.hasTerrainData()) {
            const detour = this.findDetour(controller);
            if (detour) {
                controller.insertDetour(detour);
                // After inserting the sidestep, repair the rest of the path
                // so we don't walk back into the blocker
                this.tryPathRepairAfterDetour(controller);
                return true;
            }
        }

        // Strategy b: Recalculate path around the obstacle
        if (this.tryPathRepair(controller)) return true;

        // Strategy c: Push the blocking unit
        return this.pushUnit(controller.entityId, blockingEntityId);
    }

    /** Check if a tile is a valid sidestep candidate */
    private isValidSidestepTile(nx: number, ny: number): boolean {
        if (!this.groundType || !this.mapWidth || !this.mapHeight || !this.tileOccupancy) {
            return false;
        }

        if (nx < 0 || nx >= this.mapWidth || ny < 0 || ny >= this.mapHeight) return false;

        const nIdx = nx + ny * this.mapWidth;
        if (!isPassable(this.groundType[nIdx])) return false;
        if (this.tileOccupancy.has(tileKey(nx, ny))) return false;

        return true;
    }

    /**
     * Find a 1-tile sidestep around a blocked tile.
     * Prefers tiles that are closer to the goal (or at least not further away).
     * No longer requires adjacency to the rejoin point — path repair handles reconnection.
     */
    private findDetour(controller: MovementController): TileCoord | null {
        const blockedWp = controller.nextWaypoint;
        if (!blockedWp) return null;

        const goal = controller.goal;
        const neighbors = getAllNeighbors({ x: controller.tileX, y: controller.tileY });

        // Score each valid neighbor: prefer tiles closer to goal, avoid going backward
        let best: TileCoord | null = null;
        let bestScore = -Infinity;

        for (const neighbor of neighbors) {
            // Don't sidestep onto the blocked tile itself
            if (neighbor.x === blockedWp.x && neighbor.y === blockedWp.y) continue;
            if (!this.isValidSidestepTile(neighbor.x, neighbor.y)) continue;

            let score = 0;
            if (goal) {
                const currDist = hexDistance(controller.tileX, controller.tileY, goal.x, goal.y);
                const newDist = hexDistance(neighbor.x, neighbor.y, goal.x, goal.y);
                score = currDist - newDist; // positive = getting closer
            }
            if (score > bestScore) {
                bestScore = score;
                best = neighbor;
            }
        }

        return best;
    }

    /**
     * After inserting a sidestep detour, repair the path from the detour tile to the goal.
     * This replaces the old path suffix so the unit doesn't walk back into the blocker.
     */
    private tryPathRepairAfterDetour(controller: MovementController): void {
        if (!this.hasTerrainData() || !this.tileOccupancy) return;

        const goal = controller.goal;
        if (!goal) return;

        // The detour tile is at pathIndex (just inserted), path continues from pathIndex+1
        const detourTile = controller.path[controller.pathIndex];
        if (!detourTile) return;

        const newSuffix = findPath(
            detourTile.x,
            detourTile.y,
            goal.x,
            goal.y,
            this.groundType!,
            this.groundHeight!,
            this.mapWidth!,
            this.mapHeight!,
            this.tileOccupancy,
            false // respect occupancy to route around blockers
        );

        if (newSuffix && newSuffix.length > 0) {
            // Replace: keep the detour tile at pathIndex, replace everything after with the new suffix
            controller.replacePathSuffix(newSuffix, controller.pathIndex + 1);
        }
        // If repath fails, the old path suffix remains — unit will try again next tick
    }

    /**
     * Escalated repath: used after being blocked for a while.
     * Does a full repath ignoring occupancy to find any path to goal.
     */
    private tryEscalatedRepath(controller: MovementController): boolean {
        if (!this.hasTerrainData() || !this.tileOccupancy) return false;

        const goal = controller.goal;
        if (!goal) return false;

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
            true // ignore occupancy — just find ANY path
        );

        if (newPath && newPath.length > 0) {
            controller.replacePath(newPath);
            controller.resetBlockedTime();
            return true;
        }
        return false;
    }

    /**
     * Mutual yielding: when we can't push the blocker (they have lower ID or are moving),
     * and we have room, step sideways ourselves to let them pass.
     */
    private tryYield(controller: MovementController, blockingEntityId: number): boolean {
        if (!this.hasTerrainData() || !this.tileOccupancy) return false;

        // Only yield if the blocker is also moving (two walkers meeting)
        const blockerController = this.controllers.get(blockingEntityId);
        if (!blockerController || blockerController.state === 'idle') return false;

        // Find a free sidestep tile
        const neighbors = getAllNeighbors({ x: controller.tileX, y: controller.tileY });
        const goal = controller.goal;

        let best: TileCoord | null = null;
        let bestScore = -Infinity;

        for (const neighbor of neighbors) {
            if (!this.isValidSidestepTile(neighbor.x, neighbor.y)) continue;

            let score = 0;
            if (goal) {
                const currDist = hexDistance(controller.tileX, controller.tileY, goal.x, goal.y);
                const newDist = hexDistance(neighbor.x, neighbor.y, goal.x, goal.y);
                score = currDist - newDist;
            }
            if (score > bestScore) {
                bestScore = score;
                best = neighbor;
            }
        }

        if (!best) return false;

        // Execute the yield: move ourselves sideways and repath
        controller.handlePush(best.x, best.y);
        this.updatePosition(controller.entityId, best.x, best.y);

        if (goal) {
            this.repathToGoal(controller, goal);
        }

        return true;
    }

    /**
     * Repath a controller from its current position to a goal.
     * Uses occupancy-aware pathfinding so the new path routes around nearby units.
     */
    private repathToGoal(controller: MovementController, goal: TileCoord): void {
        if (!this.hasTerrainData() || !this.tileOccupancy) return;

        // Don't repath if already at goal
        if (controller.tileX === goal.x && controller.tileY === goal.y) return;

        // Try occupancy-aware path first (avoids walking back into the pusher)
        let newPath = findPath(
            controller.tileX,
            controller.tileY,
            goal.x,
            goal.y,
            this.groundType!,
            this.groundHeight!,
            this.mapWidth!,
            this.mapHeight!,
            this.tileOccupancy,
            false // respect occupancy to route around nearby units
        );

        // Fall back to ignoring occupancy if no path found (e.g. surrounded)
        if (!newPath || newPath.length === 0) {
            newPath = findPath(
                controller.tileX,
                controller.tileY,
                goal.x,
                goal.y,
                this.groundType!,
                this.groundHeight!,
                this.mapWidth!,
                this.mapHeight!,
                this.tileOccupancy,
                true
            );
        }

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
