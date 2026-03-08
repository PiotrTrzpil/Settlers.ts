import { EntityType, TileCoord, tileKey } from '../../entity';
import { MovementController, MovementState } from './movement-controller';
import { PathfindingService } from './pathfinding-service';
import type { TickSystem } from '../../core/tick-system';
import type { EventBus } from '../../event-bus';
import { type ComponentStore, mapStore } from '../../ecs';
import { LogHandler } from '@/utilities/log-handler';
import { getAllNeighbors } from '../hex-directions';
import { isPassable } from '../../terrain';

const log = new LogHandler('MovementSystem');

/** After waiting this long, repath to find an alternative route around terrain */
const REPATH_WAIT_TIMEOUT = 0.5; // seconds

/** After this long, clear path and let the task system reassign */
const GIVEUP_WAIT_TIMEOUT = 2.0; // seconds

/**
 * Score a candidate bump destination. Higher is better.
 * Prefers tiles perpendicular to the bumper's travel direction (side-step),
 * penalizes tiles ahead of the bumper (which cause repeated bumps).
 */
function scoreBumpTile(tile: TileCoord, occupant: MovementController, travelDx: number, travelDy: number): number {
    const dx = tile.x - occupant.tileX;
    const dy = tile.y - occupant.tileY;
    // Dot product: how much this tile aligns with the bumper's travel direction
    // Negative dot = perpendicular/behind = good; positive = ahead = bad
    return -(dx * travelDx + dy * travelDy);
}

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
    updatePosition: UpdatePositionFn;
    getEntity: GetEntityFn;
    tileOccupancy: Map<string, number>;
    buildingOccupancy: Set<string>;
    buildingFootprint: Set<string>;
}

/**
 * MovementSystem manages all unit movement controllers and coordinates
 * their updates, bump resolution, and pathfinding.
 *
 * Responsibilities:
 *   - Controller lifecycle (create / get / remove)
 *   - Per-tick update loop (advance, move, finalize)
 *   - Inline bump-or-wait collision resolution
 *   - Delegating pathfinding to PathfindingService
 *   - Emitting movement-stopped events
 */
export class MovementSystem implements TickSystem {
    private controllers: Map<number, MovementController> = new Map();

    /** Uniform read-only view for cross-cutting queries */
    readonly store: ComponentStore<MovementController> = mapStore(this.controllers);

    // Terrain and occupancy references
    private readonly tileOccupancy: Map<string, number>;
    private readonly buildingOccupancy: Set<string>;
    private readonly buildingFootprint: Set<string>;

    // Event bus for notifying other systems of movement changes
    private readonly eventBus: EventBus;

    /** Enable verbose movement events (pathFound, pathFailed, bump, wait) */
    private _verbose = false;

    get verbose(): boolean {
        return this._verbose;
    }

    set verbose(value: boolean) {
        this._verbose = value;
    }

    // Pathfinding service
    private readonly pathfinder: PathfindingService;

    // Cached callbacks
    private readonly updatePositionFn: UpdatePositionFn;
    private readonly getEntityFn: GetEntityFn;

    // Terrain data for bump validation
    private terrainGroundType: Uint8Array | undefined;
    private terrainMapWidth = 0;
    private terrainMapHeight = 0;

    // Previous movement state per controller for change detection
    private prevStates: Map<number, MovementState> = new Map();

    constructor(config: MovementSystemConfig) {
        this.eventBus = config.eventBus;
        this.updatePositionFn = config.updatePosition;
        this.getEntityFn = config.getEntity;
        this.tileOccupancy = config.tileOccupancy;
        this.buildingOccupancy = config.buildingOccupancy;
        this.buildingFootprint = config.buildingFootprint;
        this.pathfinder = new PathfindingService();
        this.pathfinder.setBuildingOccupancy(config.buildingOccupancy);
        this.pathfinder.setTileOccupancy(config.tileOccupancy);
    }

    // -------------------------------------------------------------------------
    // Setup
    // -------------------------------------------------------------------------

    /**
     * Set the terrain data for pathfinding and bump validation.
     */
    setTerrainData(groundType: Uint8Array, groundHeight: Uint8Array, mapWidth: number, mapHeight: number): void {
        this.pathfinder.setTerrainData(groundType, groundHeight, mapWidth, mapHeight);
        this.terrainGroundType = groundType;
        this.terrainMapWidth = mapWidth;
        this.terrainMapHeight = mapHeight;
    }

    // -------------------------------------------------------------------------
    // Controller lifecycle
    // -------------------------------------------------------------------------

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

    // -------------------------------------------------------------------------
    // Movement commands
    // -------------------------------------------------------------------------

    /**
     * Issue a move command to a unit.
     * Calculates path and sets up the controller for movement.
     * @returns true if a valid path was found
     */
    moveUnit(entityId: number, targetX: number, targetY: number): boolean {
        const controller = this.controllers.get(entityId);
        if (!controller) return false;

        const fromX = controller.tileX;
        const fromY = controller.tileY;

        const path = this.pathfinder.findPath(fromX, fromY, targetX, targetY);

        if (!path || path.length === 0) {
            if (this.verbose) {
                this.eventBus.emit('movement:pathFailed', { entityId, fromX, fromY, toX: targetX, toY: targetY });
            }
            return false;
        }

        const redirect = controller.isInTransit;
        if (redirect) {
            controller.redirectPath(path);
        } else {
            controller.startPath(path);
        }

        if (this.verbose) {
            this.eventBus.emit('movement:pathFound', {
                entityId,
                fromX,
                fromY,
                toX: targetX,
                toY: targetY,
                pathLength: path.length,
                redirect,
            });
        }

        return true;
    }

    // -------------------------------------------------------------------------
    // Tick
    // -------------------------------------------------------------------------

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
                try {
                    this.updateController(controller, deltaSec);
                } catch (e) {
                    const err = e instanceof Error ? e : new Error(String(e));
                    log.error(`Unhandled error in movement tick for entity ${entityId}`, err);
                }
            }
        }
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

            const occupantId = this.tileOccupancy.get(tileKey(wp.x, wp.y));
            // A tile is free if empty, owned by the mover, or occupied by a non-unit
            // (e.g. building door tile — only units block movement at runtime).
            const isFree =
                occupantId === undefined || occupantId === controller.entityId || !this.controllers.has(occupantId);

            if (isFree) {
                this.stepForward(controller);
            } else if (!this.resolveCollision(controller, occupantId, deltaSec)) {
                break;
            }
        }

        controller.finalizeTick();

        // Detect visual position discontinuity (teleport guard)
        const teleportDist = controller.detectTeleport();
        if (teleportDist > 1.5) {
            console.warn(
                `[MovementSystem] TELEPORT DETECTED! Entity ${controller.entityId} jumped ${teleportDist.toFixed(2)} tiles` +
                    ` | state=${controller.state} prevState=${prevState}` +
                    ` | tile=(${controller.tileX},${controller.tileY}) prev=(${controller.prevTileX},${controller.prevTileY})` +
                    ` | progress=${controller.progress.toFixed(2)} inTransit=${controller.isInTransit}` +
                    ` | pathLen=${controller.path.length} pathIdx=${controller.pathIndex}`
            );
        }

        controller.updateLastVisualPosition();
        this.emitMovementStopped(controller, prevState);
        this.prevStates.set(controller.entityId, controller.state);
    }

    // -------------------------------------------------------------------------
    // Step & collision helpers
    // -------------------------------------------------------------------------

    /** Execute a single step forward onto a free tile. */
    private stepForward(controller: MovementController): void {
        const newPos = controller.executeMove();
        if (newPos) {
            this.updatePositionFn(controller.entityId, newPos.x, newPos.y);
        }
        controller.resetWaitTime();
    }

    /**
     * Handle collision with an occupied tile. Returns true if the loop should continue
     * (bump succeeded), false if the loop should break (waiting/repath/giveup).
     */
    private resolveCollision(controller: MovementController, occupantId: number, deltaSec: number): boolean {
        controller.addWaitTime(deltaSec);

        if (controller.waitTime > GIVEUP_WAIT_TIMEOUT) {
            controller.clearPath();
            return false;
        }

        if (controller.waitTime > REPATH_WAIT_TIMEOUT) {
            this.repathFromCurrent(controller);
            return false;
        }

        if (this.tryBump(controller, occupantId)) {
            this.stepForward(controller);
            return true;
        }

        // Can't bump — wait this tick, halt progress to prevent accumulation
        controller.haltProgress();
        return false;
    }

    /** Repath the controller from its current position to its goal. */
    private repathFromCurrent(controller: MovementController): void {
        const goal = controller.goal;
        if (goal) {
            const newPath = this.pathfinder.findPath(controller.tileX, controller.tileY, goal.x, goal.y);
            if (newPath && newPath.length > 0) {
                controller.replacePath(newPath);
            }
        }
        controller.resetWaitTime();
    }

    // -------------------------------------------------------------------------
    // Bump resolution
    // -------------------------------------------------------------------------

    /** Maximum depth for recursive bump chains to prevent infinite loops. */
    private static readonly MAX_BUMP_DEPTH = 4;

    /** Check if bumper is allowed to push occupant (priority + state rules). */
    private canBumpOccupant(bumper: MovementController, occupant: MovementController): boolean {
        // Only bump idle or waiting units — actively moving units will leave soon
        if (occupant.state === 'moving' && occupant.waitTime === 0) return false;
        // Moving bumper can always push idle occupants (it has a destination, they don't).
        // When both are moving/waiting, lower ID has priority to prevent oscillation.
        if (occupant.state !== 'idle' && bumper.entityId >= occupant.entityId) return false;
        return true;
    }

    /**
     * Attempt to bump an occupant out of the way, recursively if needed.
     * Returns true if bump succeeded (occupant moved, tile is now free).
     */
    private tryBump(bumper: MovementController, occupantId: number, depth = 0): boolean {
        if (depth > MovementSystem.MAX_BUMP_DEPTH) return false;

        const occupant = this.controllers.get(occupantId);
        if (!occupant || !this.canBumpOccupant(bumper, occupant)) return false;

        const dest = this.findBumpDestination(occupant, bumper, depth);
        if (!dest) return false;

        // If the destination is occupied, recursively bump its occupant first
        if (!this.clearTileForBump(occupant, dest, depth)) return false;

        // Execute the bump
        occupant.handlePush(dest.x, dest.y);
        this.updatePositionFn(occupantId, dest.x, dest.y);

        // If the bumped unit has a goal, repath it from the new position
        const occupantGoal = occupant.goal;
        if (occupantGoal) {
            const newPath = this.pathfinder.findPath(dest.x, dest.y, occupantGoal.x, occupantGoal.y);
            if (newPath && newPath.length > 0) {
                occupant.replacePath(newPath);
            }
        }

        return true;
    }

    /** Ensure the target tile is free by recursively bumping its occupant if needed. */
    private clearTileForBump(bumper: MovementController, dest: TileCoord, depth: number): boolean {
        const destOccupantId = this.tileOccupancy.get(tileKey(dest.x, dest.y));
        if (destOccupantId === undefined || destOccupantId === bumper.entityId) return true;
        if (!this.controllers.has(destOccupantId)) return true;
        return this.tryBump(bumper, destOccupantId, depth + 1);
    }

    /**
     * Find the best neighbor tile to bump an occupant to.
     * Prefers free tiles. If none, considers tiles occupied by bumpable units (recursive bump).
     * Avoids pushing the occupant into the bumper's path.
     */
    private findBumpDestination(
        occupant: MovementController,
        bumper: MovementController,
        depth: number
    ): TileCoord | null {
        const neighbors = getAllNeighbors({ x: occupant.tileX, y: occupant.tileY });
        const travelDx = occupant.tileX - bumper.tileX;
        const travelDy = occupant.tileY - bumper.tileY;

        // Separate into free tiles and tiles with bumpable occupants
        const free: TileCoord[] = [];
        const bumpable: TileCoord[] = [];

        for (const n of neighbors) {
            if (!this.isTilePassableForBump(n.x, n.y)) continue;
            const nOccupant = this.tileOccupancy.get(tileKey(n.x, n.y));
            if (nOccupant === undefined || nOccupant === occupant.entityId) {
                free.push(n);
            } else if (depth < MovementSystem.MAX_BUMP_DEPTH && this.isBumpableOccupant(nOccupant)) {
                bumpable.push(n);
            }
        }

        // Prefer free tiles; fall back to bumpable tiles for chain-push
        const candidates = free.length > 0 ? free : bumpable;
        if (candidates.length === 0) return null;
        if (candidates.length === 1) return candidates[0]!;

        return this.pickBestBumpTile(candidates, occupant, travelDx, travelDy);
    }

    /** Check if an occupant can be bumped (idle or waiting). */
    private isBumpableOccupant(occupantId: number): boolean {
        const ctrl = this.controllers.get(occupantId);
        if (!ctrl) return false;
        if (ctrl.state === 'idle') return true;
        // Moving but waiting (stuck) — bumpable
        return ctrl.waitTime > 0;
    }

    /** Pick the best tile from candidates using bump scoring (perpendicular to travel direction). */
    private pickBestBumpTile(
        candidates: TileCoord[],
        occupant: MovementController,
        travelDx: number,
        travelDy: number
    ): TileCoord {
        let best = candidates[0]!;
        let bestScore = scoreBumpTile(best, occupant, travelDx, travelDy);
        for (let i = 1; i < candidates.length; i++) {
            const n = candidates[i]!;
            const score = scoreBumpTile(n, occupant, travelDx, travelDy);
            if (score > bestScore) {
                bestScore = score;
                best = n;
            }
        }
        return best;
    }

    /**
     * Check if a tile is passable for bump destination:
     * in bounds, passable terrain, not inside any building footprint.
     * Rejects ALL building footprint tiles (including door corridor) so units
     * are never bumped deeper into a building — only away from it.
     * Does NOT check unit occupancy — caller handles that.
     */
    private isTilePassableForBump(x: number, y: number): boolean {
        if (x < 0 || x >= this.terrainMapWidth || y < 0 || y >= this.terrainMapHeight) return false;
        if (this.terrainGroundType) {
            const idx = x + y * this.terrainMapWidth;
            if (!isPassable(this.terrainGroundType[idx]!)) return false;
        }
        const key = tileKey(x, y);
        // Reject entire building footprint (blocked tiles + door corridor)
        // so bumps always push units away from buildings, never into them
        if (this.buildingFootprint.has(key)) return false;
        return true;
    }

    // -------------------------------------------------------------------------
    // Events
    // -------------------------------------------------------------------------

    private emitMovementStopped(controller: MovementController, prevState: MovementState): void {
        if (controller.state !== prevState && controller.state === 'idle' && prevState !== 'idle') {
            this.eventBus.emit('unit:movementStopped', {
                entityId: controller.entityId,
                direction: controller.direction,
            });
        }
    }
}
