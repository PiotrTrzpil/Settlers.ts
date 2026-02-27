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
import { getAllNeighbors, hexDistance } from '../hex-directions';
import { findSmartFreeDirection, shouldYieldToPush } from './push-utils';
import type { TerrainAccessor } from './push-utils';
import { MovementController } from './movement-controller';
import type { IPathfinder } from './pathfinding-service';
import type { SeededRng } from '../../rng';

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
     * Attempt to resolve a collision at the given waypoint.
     * Returns true if the unit is blocked (caller should skip this tick).
     */
    resolveBlockedWaypoint(controller: MovementController, wp: TileCoord, deltaSec: number): boolean;
}

/**
 * Configuration for CollisionResolver.
 */
export interface CollisionResolverConfig {
    pathfinder: IPathfinder;
    rng: SeededRng;
    tileOccupancy: Map<string, number>;
    getEntity: GetEntityFn;
    updatePosition: UpdatePositionFn;
    getController: (entityId: number) => MovementController | undefined;
    groundType?: Uint8Array;
    mapWidth?: number;
    mapHeight?: number;
}

/**
 * Concrete collision resolver that applies progressive de-blocking strategies.
 */
export class CollisionResolver implements ICollisionResolver {
    private readonly pathfinder: IPathfinder;
    private readonly rng: SeededRng;
    private readonly tileOccupancy: Map<string, number>;
    private readonly getEntity: GetEntityFn;
    private readonly updatePosition: UpdatePositionFn;
    private readonly getController: (entityId: number) => MovementController | undefined;

    // Terrain data — optional because it may not be set yet
    private groundType: Uint8Array | undefined;
    private mapWidth: number | undefined;
    private mapHeight: number | undefined;

    constructor(config: CollisionResolverConfig) {
        this.pathfinder = config.pathfinder;
        this.rng = config.rng;
        this.tileOccupancy = config.tileOccupancy;
        this.getEntity = config.getEntity;
        this.updatePosition = config.updatePosition;
        this.getController = config.getController;
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
     * Check whether the waypoint is occupied by another unit and attempt resolution.
     * Returns true if the unit ends up blocked (caller should break from the move loop).
     */
    resolveBlockedWaypoint(controller: MovementController, wp: TileCoord, deltaSec: number): boolean {
        const blockingEntityId = this.tileOccupancy.get(tileKey(wp.x, wp.y));
        if (blockingEntityId === undefined || blockingEntityId === controller.entityId) {
            return false; // tile is free — no collision
        }

        const blockingEntity = this.getEntity(blockingEntityId);
        if (!blockingEntity || blockingEntity.type !== EntityType.Unit) {
            return false; // non-unit blocker — ignore
        }

        if (!this.tryResolveObstacle(controller, blockingEntityId)) {
            if (!this.tryYield(controller, blockingEntityId)) {
                controller.setBlocked(deltaSec);
                return true;
            }
        }

        // After resolution, re-check the current waypoint (detour may have changed it)
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

    // -------------------------------------------------------------------------
    // Obstacle resolution strategies
    // -------------------------------------------------------------------------

    /**
     * Try strategies a, b, c to clear the path.
     * Returns true if any strategy succeeded.
     */
    private tryResolveObstacle(controller: MovementController, blockingEntityId: number): boolean {
        // Strategy a: 1-tile sidestep + repath suffix
        if (this.pathfinder.hasTerrainData()) {
            const detour = this.findDetour(controller);
            if (detour) {
                controller.insertDetour(detour);
                this.tryPathRepairAfterDetour(controller);
                return true;
            }
        }

        // Strategy b: recalculate path around the obstacle
        if (this.tryPathRepair(controller)) return true;

        // Strategy c: push the blocking unit
        return this.pushUnit(controller.entityId, blockingEntityId);
    }

    /**
     * Mutual yield: when we cannot push the blocker (priority), step sideways ourselves.
     * Only applies when the blocker is also moving (two walkers meeting head-on).
     */
    private tryYield(controller: MovementController, blockingEntityId: number): boolean {
        const blockerController = this.getController(blockingEntityId);
        if (!blockerController || blockerController.state === 'idle') return false;

        const goal = controller.goal;
        const neighbors = getAllNeighbors({ x: controller.tileX, y: controller.tileY });

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

        controller.handlePush(best.x, best.y);
        this.updatePosition(controller.entityId, best.x, best.y);

        if (goal) {
            this.repathToGoal(controller, goal);
        }

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
        const neighbors = getAllNeighbors({ x: controller.tileX, y: controller.tileY });

        let best: TileCoord | null = null;
        let bestScore = -Infinity;

        for (const neighbor of neighbors) {
            if (neighbor.x === blockedWp.x && neighbor.y === blockedWp.y) continue;
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

        return best;
    }

    /** Check if a tile is a valid sidestep candidate (in-bounds, passable, unoccupied). */
    private isValidSidestepTile(nx: number, ny: number): boolean {
        if (!this.groundType || !this.mapWidth || !this.mapHeight) return false;

        if (nx < 0 || nx >= this.mapWidth || ny < 0 || ny >= this.mapHeight) return false;

        const nIdx = nx + ny * this.mapWidth;
        if (!isPassable(this.groundType[nIdx]!)) return false;
        if (this.tileOccupancy.has(tileKey(nx, ny))) return false;

        return true;
    }

    /**
     * After inserting a sidestep detour tile, repath the suffix from that detour tile to the
     * original goal so the unit does not walk back into the blocker.
     */
    private tryPathRepairAfterDetour(controller: MovementController): void {
        const goal = controller.goal;
        if (!goal) return;

        const detourTile = controller.path[controller.pathIndex];
        if (!detourTile) return;

        const newSuffix = this.pathfinder.findPath(
            detourTile.x,
            detourTile.y,
            goal.x,
            goal.y,
            false // respect occupancy
        );

        if (newSuffix && newSuffix.length > 0) {
            controller.replacePathSuffix(newSuffix, controller.pathIndex + 1);
        }
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

        const terrain = this.buildTerrainAccessor();
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

        blockedController.handlePush(freeDir.x, freeDir.y);
        this.updatePosition(blockingEntityId, freeDir.x, freeDir.y);

        if (goal) {
            this.repathToGoal(blockedController, goal);
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
            controller.redirectPath(newPath);
        }
    }

    /** Build a TerrainAccessor from current terrain state, or return undefined if unavailable. */
    private buildTerrainAccessor(): TerrainAccessor | undefined {
        if (!this.groundType || !this.mapWidth || !this.mapHeight) return undefined;
        return { groundType: this.groundType, mapWidth: this.mapWidth, mapHeight: this.mapHeight };
    }
}
