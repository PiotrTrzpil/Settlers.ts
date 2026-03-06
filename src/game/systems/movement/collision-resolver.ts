/**
 * CollisionResolver handles all collision detection and resolution strategies
 * when a unit's next waypoint is occupied by another unit.
 *
 * Resolution strategies (tried in order):
 *   1. Sidestep detour — insert a 1-tile lateral move + repath the suffix
 *   2. Path repair — recalculate a segment or the full remaining path
 *   3. Push — displace the blocking unit to a free neighbour
 *   4. Yield — move the blocked unit itself sideways (mutual yield)
 *   5. Wait — mark unit as blocked for this tick (caller handles timeout)
 */

import { TileCoord, tileKey } from '../../entity';
import { EntityType } from '../../entity';
import { isPassable } from '../../terrain';
import { findBestNeighbor, shouldYieldToPush } from './push-utils';
import { MovementController } from './movement-controller';
import type { IPathfinder } from './pathfinding-service';
import type { EventBus } from '../../event-bus';

/** How many steps ahead to look when doing prefix path repair */
const PATH_REPAIR_DISTANCE = 10;

/**
 * Callback type for retrieving entity metadata.
 */
export type GetEntityFn = (entityId: number) => { type: EntityType; x: number; y: number } | undefined;

/**
 * Callback type for updating entity position in the game state.
 */
export type UpdatePositionFn = (entityId: number, x: number, y: number) => boolean;

/**
 * Interface for the collision resolver.
 */
export interface ICollisionResolver {
    /**
     * Classify the block (building footprint vs unit) and attempt resolution.
     * Returns true if the unit is blocked (caller should skip this tick).
     */
    resolveBlock(controller: MovementController, wp: TileCoord, blockingEntityId: number): boolean;
}

/**
 * Configuration for CollisionResolver.
 */
export interface CollisionResolverConfig {
    pathfinder: IPathfinder;
    tileOccupancy: Map<string, number>;
    buildingOccupancy: Set<string>;
    getEntity: GetEntityFn;
    updatePosition: UpdatePositionFn;
    getController: (entityId: number) => MovementController | undefined;
    eventBus: EventBus;
    groundType?: Uint8Array;
    mapWidth?: number;
    mapHeight?: number;
}

/**
 * Concrete collision resolver that applies progressive de-blocking strategies.
 */
export class CollisionResolver implements ICollisionResolver {
    private readonly pathfinder: IPathfinder;
    private readonly tileOccupancy: Map<string, number>;
    private readonly buildingOccupancy: Set<string>;
    private readonly getEntity: GetEntityFn;
    private readonly updatePosition: UpdatePositionFn;
    private readonly getController: (entityId: number) => MovementController | undefined;
    private readonly eventBus: EventBus;

    /** Enable verbose collision events (gated by MovementSystem.verbose) */
    verbose = false;

    // Terrain data — optional because it may not be set yet
    private groundType: Uint8Array | undefined;
    private mapWidth: number | undefined;
    private mapHeight: number | undefined;

    constructor(config: CollisionResolverConfig) {
        this.pathfinder = config.pathfinder;
        this.tileOccupancy = config.tileOccupancy;
        this.buildingOccupancy = config.buildingOccupancy;
        this.getEntity = config.getEntity;
        this.updatePosition = config.updatePosition;
        this.getController = config.getController;
        this.eventBus = config.eventBus;
        this.groundType = config.groundType;
        this.mapWidth = config.mapWidth;
        this.mapHeight = config.mapHeight;
    }

    /**
     * Update terrain data (called when the map loads or changes).
     */
    setTerrainData(groundType: Uint8Array, mapWidth: number, mapHeight: number): void {
        this.groundType = groundType;
        this.mapWidth = mapWidth;
        this.mapHeight = mapHeight;
    }

    /**
     * Classify the block and attempt resolution.
     * Building footprint → block immediately.
     * Non-unit occupant (door) → allow passage.
     * Unit → delegate to unit collision resolution pipeline.
     */
    resolveBlock(controller: MovementController, wp: TileCoord, blockingEntityId: number): boolean {
        const key = tileKey(wp.x, wp.y);

        // Building footprint tiles are impassable (door tiles excluded from buildingOccupancy)
        if (this.buildingOccupancy.has(key)) {
            this.emitBlocked(controller.entityId, wp, blockingEntityId, true);
            controller.setBlocked();
            return true;
        }

        // Non-unit occupants (e.g. door tiles owned by a building) — allow passage
        const blockingEntity = this.getEntity(blockingEntityId);
        if (!blockingEntity || blockingEntity.type !== EntityType.Unit) {
            return false;
        }

        this.emitBlocked(controller.entityId, wp, blockingEntityId, false);
        return this.resolveUnitCollision(controller, blockingEntityId);
    }

    /**
     * Resolve a collision with another unit using progressive de-blocking strategies.
     */
    private resolveUnitCollision(controller: MovementController, blockingEntityId: number): boolean {
        if (!this.tryResolveObstacle(controller, blockingEntityId)) {
            if (!this.tryYield(controller, blockingEntityId)) {
                this.emitResolution(
                    controller.entityId,
                    'wait',
                    true,
                    controller.tileX,
                    controller.tileY,
                    undefined,
                    blockingEntityId
                );
                controller.setBlocked();
                return true;
            }
        }

        // After resolution, re-check the current waypoint (detour may have changed it)
        const currentWp = controller.nextWaypoint;
        if (currentWp) {
            const stillBlocked = this.tileOccupancy.get(tileKey(currentWp.x, currentWp.y));
            if (stillBlocked !== undefined && stillBlocked !== controller.entityId) {
                controller.setBlocked();
                return true;
            }
        }

        return false;
    }

    // -------------------------------------------------------------------------
    // Obstacle resolution strategies
    // -------------------------------------------------------------------------

    /**
     * Try strategies a, b, c to clear the path.
     * Returns true if any strategy succeeded.
     */
    private tryResolveObstacle(controller: MovementController, blockingEntityId: number): boolean {
        const x = controller.tileX;
        const y = controller.tileY;

        // Strategy a: 1-tile sidestep + repath suffix
        // Only commit the detour if we can also fix the remaining path —
        // otherwise the old suffix still goes through the blocked tile
        // and the unit oscillates between the detour and the blocker.
        if (this.pathfinder.hasTerrainData()) {
            if (this.tryDetourWithRepath(controller)) {
                this.emitResolution(controller.entityId, 'detour', true, x, y, controller.nextWaypoint);
                return true;
            }
            this.emitResolution(controller.entityId, 'detour', false, x, y);
        }

        // Strategy b: recalculate path around the obstacle
        if (this.tryPathRepair(controller)) {
            this.emitResolution(controller.entityId, 'pathRepair', true, x, y);
            return true;
        }
        this.emitResolution(controller.entityId, 'pathRepair', false, x, y);

        // Strategy c: push the blocking unit
        const pushed = this.pushUnit(controller.entityId, blockingEntityId);
        this.emitResolution(controller.entityId, 'push', pushed, x, y, undefined, blockingEntityId);
        return pushed;
    }

    /**
     * Mutual yield: when we cannot push the blocker (priority), step sideways ourselves.
     * Only applies when the blocker is also moving (two walkers meeting head-on).
     */
    private tryYield(controller: MovementController, blockingEntityId: number): boolean {
        const blockerController = this.getController(blockingEntityId);
        if (!blockerController || blockerController.state === 'idle') return false;

        // Do not yield a unit mid-transit — it would cause a visual teleport
        if (controller.isInTransit) return false;

        const goal = controller.goal;
        const best = findBestNeighbor({
            x: controller.tileX,
            y: controller.tileY,
            goalX: goal?.x,
            goalY: goal?.y,
            isValid: (nx, ny) => this.isValidSidestepTile(nx, ny),
        });

        if (!best) {
            this.emitResolution(
                controller.entityId,
                'yield',
                false,
                controller.tileX,
                controller.tileY,
                undefined,
                blockingEntityId
            );
            return false;
        }

        controller.handlePush(best.x, best.y);
        this.updatePosition(controller.entityId, best.x, best.y);

        if (goal) {
            this.repathToGoal(controller, goal);
        }

        this.emitResolution(
            controller.entityId,
            'yield',
            true,
            controller.tileX,
            controller.tileY,
            best,
            blockingEntityId
        );
        return true;
    }

    // -------------------------------------------------------------------------
    // Sidestep / detour
    // -------------------------------------------------------------------------

    /**
     * Find a 1-tile sidestep around the blocked waypoint.
     * Prefers tiles that keep the unit moving toward its goal.
     */
    private findDetour(controller: MovementController): TileCoord | null {
        const blockedWp = controller.nextWaypoint;
        if (!blockedWp) return null;

        const goal = controller.goal;
        return findBestNeighbor({
            x: controller.tileX,
            y: controller.tileY,
            goalX: goal?.x,
            goalY: goal?.y,
            excludeTile: blockedWp,
            isValid: (nx, ny) => this.isValidSidestepTile(nx, ny),
        });
    }

    /** Check if a tile is a valid sidestep candidate (in-bounds, passable, not occupied by a unit or building). */
    private isValidSidestepTile(nx: number, ny: number): boolean {
        if (this.groundType && this.mapWidth && this.mapHeight) {
            if (nx < 0 || nx >= this.mapWidth || ny < 0 || ny >= this.mapHeight) return false;
            const nIdx = nx + ny * this.mapWidth;
            if (!isPassable(this.groundType[nIdx]!)) return false;
        }

        const key = tileKey(nx, ny);

        // Hard building footprint tiles are always impassable
        if (this.buildingOccupancy.has(key)) return false;

        const occupantId = this.tileOccupancy.get(key);
        if (occupantId !== undefined) {
            const occupant = this.getEntity(occupantId);
            // Reject if occupied by another unit; allow door corridors (building-owned but passable)
            if (occupant && occupant.type === EntityType.Unit) return false;
        }

        return true;
    }

    /**
     * Try a 1-tile sidestep detour and repath the remaining path from the detour tile.
     * The detour is only committed if the suffix repath also succeeds — otherwise the
     * old path still passes through the blocker and the unit oscillates.
     */
    private tryDetourWithRepath(controller: MovementController): boolean {
        const detour = this.findDetour(controller);
        if (!detour) return false;

        const goal = controller.goal;
        if (!goal) {
            // No goal — just insert the detour as a one-off step
            controller.insertDetour(detour);
            return true;
        }

        // Verify we can actually complete the path from the detour tile
        const newSuffix = this.pathfinder.findPath(detour.x, detour.y, goal.x, goal.y, false);
        if (!newSuffix || newSuffix.length === 0) return false;

        // Reject if the repath immediately routes back through the pre-detour tile —
        // that would cause a 180° reversal (current → detour → current again).
        const firstStep = newSuffix[0]!;
        if (firstStep.x === controller.tileX && firstStep.y === controller.tileY) return false;

        controller.insertDetour(detour);
        controller.replacePathSuffix(newSuffix, controller.pathIndex + 1);
        return true;
    }

    // -------------------------------------------------------------------------
    // Path repair
    // -------------------------------------------------------------------------

    /** Recalculate a prefix or the full remaining path around the obstacle. */
    private tryPathRepair(controller: MovementController): boolean {
        const remainingSteps = controller.path.length - controller.pathIndex;

        if (remainingSteps > PATH_REPAIR_DISTANCE) {
            return this.repairPathPrefix(controller);
        }
        return this.repairFullPath(controller);
    }

    /** Recalculate only the next PATH_REPAIR_DISTANCE steps. */
    private repairPathPrefix(controller: MovementController): boolean {
        const prefixTargetIdx = Math.min(controller.pathIndex + PATH_REPAIR_DISTANCE, controller.path.length - 1);
        const prefixTarget = controller.path[prefixTargetIdx]!;

        const newPrefix = this.pathfinder.findPath(
            controller.tileX,
            controller.tileY,
            prefixTarget.x,
            prefixTarget.y,
            false // respect occupancy
        );

        if (newPrefix && newPrefix.length > 0) {
            if (this.wouldReverse(controller, newPrefix)) return false;
            controller.replacePathPrefix(newPrefix, prefixTargetIdx + 1);
            return true;
        }

        return false;
    }

    /** Recalculate the entire remaining path to the goal. */
    private repairFullPath(controller: MovementController): boolean {
        const goal = controller.path[controller.path.length - 1]!;

        const newPath = this.pathfinder.findPath(
            controller.tileX,
            controller.tileY,
            goal.x,
            goal.y,
            false // respect occupancy
        );

        if (newPath && newPath.length > 0) {
            if (this.wouldReverse(controller, newPath)) return false;
            controller.replacePath(newPath);
            return true;
        }

        return false;
    }

    // -------------------------------------------------------------------------
    // Push
    // -------------------------------------------------------------------------

    /**
     * Push the blocking unit to a free neighbour if priority rules allow it.
     * Lower entity ID has priority; the higher-ID unit yields.
     */
    private pushUnit(pushingEntityId: number, blockingEntityId: number): boolean {
        if (!shouldYieldToPush(pushingEntityId, blockingEntityId)) return false;

        const blockedController = this.getController(blockingEntityId);
        if (!blockedController) return false;

        // Do not push a unit mid-transit — it would cause a visual teleport
        if (blockedController.isInTransit) return false;

        // Use the pusher's goal as bias — push the blocker out of the pusher's
        // path rather than toward the blocker's own goal (which may point back
        // into the pusher, causing 180° reversals in head-on collisions).
        const pushingController = this.getController(pushingEntityId);
        const biasGoal = pushingController?.goal ?? blockedController.goal;

        const freeDir = findBestNeighbor({
            x: blockedController.tileX,
            y: blockedController.tileY,
            goalX: biasGoal?.x,
            goalY: biasGoal?.y,
            isValid: (nx, ny) => this.isValidSidestepTile(nx, ny),
        });
        if (!freeDir) return false;

        blockedController.handlePush(freeDir.x, freeDir.y);
        this.updatePosition(blockingEntityId, freeDir.x, freeDir.y);

        const ownGoal = blockedController.goal;
        if (ownGoal) {
            this.repathToGoal(blockedController, ownGoal);
        }

        return true;
    }

    // -------------------------------------------------------------------------
    // Helpers
    // -------------------------------------------------------------------------

    /**
     * Repath a controller from its current position to a goal.
     * First tries occupancy-aware routing; falls back to ignoring occupancy if surrounded.
     */
    private repathToGoal(controller: MovementController, goal: TileCoord): void {
        if (controller.tileX === goal.x && controller.tileY === goal.y) return;

        let newPath = this.pathfinder.findPath(
            controller.tileX,
            controller.tileY,
            goal.x,
            goal.y,
            false // respect occupancy
        );

        if (!newPath || newPath.length === 0) {
            newPath = this.pathfinder.findPath(
                controller.tileX,
                controller.tileY,
                goal.x,
                goal.y,
                true // fall back: ignore occupancy
            );
        }

        if (newPath && newPath.length > 0) {
            if (this.wouldReverse(controller, newPath)) return;
            controller.redirectPath(newPath);
        }
    }

    /**
     * Check if the first step of a new path would reverse back to the unit's previous tile.
     * This prevents 180° turns when repath/repair routes back through the tile the unit just left.
     */
    private wouldReverse(controller: MovementController, path: TileCoord[]): boolean {
        if (!controller.isInTransit) return false; // not moving — no reversal possible
        const first = path[0]!;
        return first.x === controller.prevTileX && first.y === controller.prevTileY;
    }

    /** Emit a movement:blocked event (when verbose mode is enabled). */
    private emitBlocked(entityId: number, wp: TileCoord, blockerId: number, isBuilding: boolean): void {
        if (!this.verbose) return;
        this.eventBus.emit('movement:blocked', { entityId, x: wp.x, y: wp.y, blockerId, isBuilding });
    }

    /** Emit a collision resolution event (when verbose mode is enabled). */
    private emitResolution(
        entityId: number,
        strategy: 'detour' | 'pathRepair' | 'push' | 'yield' | 'wait',
        success: boolean,
        x: number,
        y: number,
        to?: TileCoord | null,
        targetId?: number
    ): void {
        if (!this.verbose) return;
        this.eventBus.emit('movement:collisionResolved', {
            entityId,
            strategy,
            success,
            x,
            y,
            toX: to?.x,
            toY: to?.y,
            targetId,
        });
    }
}
