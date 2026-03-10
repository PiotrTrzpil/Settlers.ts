import { EntityType, TileCoord, tileKey } from '../../entity';
import { MovementController, MovementState } from './movement-controller';
import { PathfindingService } from './pathfinding-service';
import type { TickSystem } from '../../core/tick-system';
import type { EventBus, GameEvents } from '../../event-bus';
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

    /**
     * Unit-only tile occupancy, independent of building footprint ownership.
     * tileOccupancy can't track units on building tiles (building owns the entry),
     * so this map ensures unit-vs-unit collision detection works everywhere.
     */
    private readonly unitPositions: Map<string, number> = new Map();

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
        this.unitPositions.set(tileKey(x, y), entityId);
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
        const ctrl = this.controllers.get(entityId);
        if (ctrl) {
            const key = tileKey(ctrl.tileX, ctrl.tileY);
            if (this.unitPositions.get(key) === entityId) {
                this.unitPositions.delete(key);
            }
        }
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
     * Repath all moving units whose remaining path passes through any of the given tiles.
     * Used when building footprint is blocked mid-game (e.g. construction site evacuation)
     * so in-flight units route around the newly blocked area.
     * @param excludeIds Units to skip (e.g. evacuating units that have valid escape paths)
     */
    repathUnitsThrough(blockedKeys: Set<string>, excludeIds?: Set<number>): void {
        for (const ctrl of this.controllers.values()) {
            if (excludeIds?.has(ctrl.entityId)) continue;
            if (ctrl.state !== 'moving' || !ctrl.hasPath) continue;
            const remaining = ctrl.path.slice(ctrl.pathIndex);
            const passesThrough = remaining.some(wp => blockedKeys.has(tileKey(wp.x, wp.y)));
            if (!passesThrough) continue;

            const goal = ctrl.goal;
            if (!goal) continue;
            const newPath = this.pathfinder.findPath(ctrl.tileX, ctrl.tileY, goal.x, goal.y);
            if (newPath && newPath.length > 0) {
                ctrl.replacePath(newPath);
            } else {
                ctrl.clearPath();
            }
        }
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

    /**
     * Push any unit standing at (x, y) to a free passable neighbor tile.
     * Used when spawning a unit at a specific tile (e.g. building door).
     * Returns true if the tile is now free (was empty or push succeeded).
     */
    pushUnitAt(x: number, y: number): boolean {
        const key = tileKey(x, y);
        const occupantId = this.unitPositions.get(key);
        if (occupantId === undefined) return true; // no unit here

        const occupant = this.controllers.get(occupantId);
        if (!occupant) return true;

        const neighbors = getAllNeighbors({ x, y });
        for (const n of neighbors) {
            if (!this.isTilePassableForBump(n.x, n.y)) continue;
            if (this.getUnitAt(tileKey(n.x, n.y), occupantId) !== undefined) continue;

            // Push the occupant to the free neighbor
            const oldKey = tileKey(occupant.tileX, occupant.tileY);
            if (this.unitPositions.get(oldKey) === occupantId) {
                this.unitPositions.delete(oldKey);
            }
            occupant.handlePush(n.x, n.y);
            this.unitPositions.set(tileKey(n.x, n.y), occupantId);
            this.updatePositionFn(occupantId, n.x, n.y);
            this.repathBumpedOccupant(occupant, n);
            return true;
        }
        return false; // no free neighbor
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

            // If next waypoint is building-blocked and the unit is NOT on a blocked tile
            // itself (i.e. it's trying to enter, not escape), repath around it.
            // Units on blocked tiles (e.g. during evacuation) must be allowed to step
            // through to escape.
            const wpKey = tileKey(wp.x, wp.y);
            if (this.buildingOccupancy.has(wpKey)) {
                const currentKey = tileKey(controller.tileX, controller.tileY);
                if (!this.buildingOccupancy.has(currentKey)) {
                    this.repathFromCurrent(controller);
                    break;
                }
                // else: unit is escaping from inside blocked area — allow step
            }

            const occupantId = this.getUnitAt(tileKey(wp.x, wp.y), controller.entityId);

            if (occupantId === undefined) {
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
    // Tile occupancy queries
    // -------------------------------------------------------------------------

    /**
     * Find the unit occupying a tile, checking both tileOccupancy and unitPositions.
     * Returns undefined if no unit occupies the tile (buildings are ignored).
     */
    private getUnitAt(key: string, selfId: number): number | undefined {
        const tileOcc = this.tileOccupancy.get(key);
        if (tileOcc !== undefined && tileOcc !== selfId && this.controllers.has(tileOcc)) {
            return tileOcc;
        }
        const unitOcc = this.unitPositions.get(key);
        if (unitOcc !== undefined && unitOcc !== selfId) {
            return unitOcc;
        }
        return undefined;
    }

    // -------------------------------------------------------------------------
    // Step & collision helpers
    // -------------------------------------------------------------------------

    /** Execute a single step forward onto a free tile. */
    private stepForward(controller: MovementController): void {
        const oldKey = tileKey(controller.tileX, controller.tileY);
        const newPos = controller.executeMove();
        if (newPos) {
            if (this.unitPositions.get(oldKey) === controller.entityId) {
                this.unitPositions.delete(oldKey);
            }
            this.unitPositions.set(tileKey(newPos.x, newPos.y), controller.entityId);
            this.updatePositionFn(controller.entityId, newPos.x, newPos.y);
            if (this._verbose) {
                this.eventBus.emit('movement:step', {
                    entityId: controller.entityId,
                    x: newPos.x,
                    y: newPos.y,
                    pathIdx: controller.pathIndex,
                    pathLen: controller.path.length,
                });
            }
        }
        controller.resetWaitTime();
    }

    /**
     * Handle collision with an occupied tile. Returns true if the loop should continue
     * (bump succeeded), false if the loop should break (waiting/repath/giveup).
     */
    private resolveCollision(controller: MovementController, occupantId: number, deltaSec: number): boolean {
        controller.addWaitTime(deltaSec);

        // Always try bump first — even after repath timeout
        if (this.tryBump(controller, occupantId)) {
            this.stepForward(controller);
            return true;
        }

        // Bump failed — escalate based on how long we've been waiting
        if (controller.waitTime > GIVEUP_WAIT_TIMEOUT) {
            if (this._verbose) {
                this.eventBus.emit('movement:escalation', {
                    entityId: controller.entityId,
                    result: 'gave_up',
                });
            }
            controller.clearPath();
            return false;
        }

        if (controller.waitTime > REPATH_WAIT_TIMEOUT) {
            if (this._verbose) {
                this.eventBus.emit('movement:escalation', {
                    entityId: controller.entityId,
                    result: 'repath',
                });
            }
            this.repathFromCurrent(controller);
            return false;
        }

        // Can't bump — wait this tick, halt progress to prevent accumulation
        if (this._verbose) {
            const wp = controller.nextWaypoint!;
            this.eventBus.emit('movement:blocked', {
                entityId: controller.entityId,
                x: wp.x,
                y: wp.y,
                blockerId: occupantId,
                isBuilding: false,
            });
        }
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
        // Never bump a unit performing a pick/put animation — wait for it to finish
        if (occupant.busy) return false;
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
        if (this._verbose && depth === 0) {
            const occ = this.controllers.get(occupantId);
            this.eventBus.emit('movement:bumpAttempt', {
                entityId: bumper.entityId,
                occupantId,
                hasController: !!occ,
                occupantState: occ?.state,
                occupantBusy: occ?.busy,
            });
        }
        if (depth > MovementSystem.MAX_BUMP_DEPTH) {
            this.emitBumpFailed(bumper.entityId, occupantId, 'max_depth');
            return false;
        }

        const occupant = this.controllers.get(occupantId);
        if (!occupant || !this.canBumpOccupant(bumper, occupant)) {
            this.emitBumpFailed(bumper.entityId, occupantId, this.bumpFailReason(occupant), {
                occupantState: occupant?.state,
                occupantBusy: occupant?.busy,
            });
            return false;
        }

        const dest = this.findBumpDestination(occupant, bumper, depth);
        if (!dest) {
            // Last resort: swap tiles (only at top level, not during recursive chain bumps)
            if (depth === 0 && this.trySwap(bumper, occupant, occupantId)) {
                return true;
            }
            this.emitBumpFailed(bumper.entityId, occupantId, 'no_destination', {
                occupantPos: `${occupant.tileX},${occupant.tileY}`,
            });
            return false;
        }

        // If the destination is occupied, recursively bump its occupant first
        if (!this.clearTileForBump(occupant, dest, depth)) {
            this.emitBumpFailed(bumper.entityId, occupantId, 'dest_occupied', {
                occupantPos: `${dest.x},${dest.y}`,
            });
            return false;
        }

        // Execute the bump — update unitPositions before entity position
        this.executeBump(bumper.entityId, occupant, occupantId, dest);
        return true;
    }

    /** Perform the physical bump: update occupancy maps, move the occupant, repath if needed. */
    private executeBump(bumperId: number, occupant: MovementController, occupantId: number, dest: TileCoord): void {
        if (this._verbose) {
            this.eventBus.emit('movement:bump', {
                bumperId,
                occupantId,
                fromX: occupant.tileX,
                fromY: occupant.tileY,
                toX: dest.x,
                toY: dest.y,
            });
        }
        const oldKey = tileKey(occupant.tileX, occupant.tileY);
        if (this.unitPositions.get(oldKey) === occupantId) {
            this.unitPositions.delete(oldKey);
        }
        occupant.handlePush(dest.x, dest.y);
        this.unitPositions.set(tileKey(dest.x, dest.y), occupantId);
        this.updatePositionFn(occupantId, dest.x, dest.y);
        this.repathBumpedOccupant(occupant, dest);
    }

    /**
     * Last-resort swap: move the occupant to the bumper's tile.
     * Only valid when the bumper's tile is passable for the occupant.
     */
    private trySwap(bumper: MovementController, occupant: MovementController, occupantId: number): boolean {
        const bumperTile: TileCoord = { x: bumper.tileX, y: bumper.tileY };
        if (!this.isTilePassableForBump(bumperTile.x, bumperTile.y)) return false;

        this.executeBump(bumper.entityId, occupant, occupantId, bumperTile);
        return true;
    }

    /** If the bumped unit has a goal, repath it from its new position. */
    private repathBumpedOccupant(occupant: MovementController, dest: TileCoord): void {
        const goal = occupant.goal;
        if (!goal) return;
        const newPath = this.pathfinder.findPath(dest.x, dest.y, goal.x, goal.y);
        if (newPath && newPath.length > 0) {
            occupant.replacePath(newPath);
        }
    }

    /** Return the reason string for a failed bump check (before canBumpOccupant). */
    private bumpFailReason(occupant: MovementController | undefined): string {
        if (!occupant) return 'no_controller';
        if (occupant.busy) return 'busy';
        if (occupant.state === 'moving' && occupant.waitTime === 0) return 'actively_moving';
        return 'priority';
    }

    /** Emit movement:bumpFailed if verbose logging is enabled. */
    private emitBumpFailed(
        bumperId: number,
        occupantId: number,
        reason: string,
        extra?: Omit<GameEvents['movement:bumpFailed'], 'entityId' | 'occupantId' | 'reason'>
    ): void {
        if (!this._verbose) return;
        this.eventBus.emit('movement:bumpFailed', { entityId: bumperId, occupantId, reason, ...extra });
    }

    /** Ensure the target tile is free by recursively bumping its occupant if needed. */
    private clearTileForBump(bumper: MovementController, dest: TileCoord, depth: number): boolean {
        const destOccupantId = this.getUnitAt(tileKey(dest.x, dest.y), bumper.entityId);
        if (destOccupantId === undefined) return true;
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
            // Never push the occupant back onto the bumper's tile
            if (n.x === bumper.tileX && n.y === bumper.tileY) continue;
            if (!this.isTilePassableForBump(n.x, n.y)) continue;
            const nOccupant = this.getUnitAt(tileKey(n.x, n.y), occupant.entityId);
            if (nOccupant === undefined) {
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

    /** Check if an occupant can be bumped (idle or waiting, not busy). */
    private isBumpableOccupant(occupantId: number): boolean {
        const ctrl = this.controllers.get(occupantId);
        if (!ctrl) return false;
        if (ctrl.busy) return false;
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
     * in bounds, passable terrain, not blocked by a completed building.
     * Uses buildingOccupancy (movement-blocking tiles) rather than buildingFootprint
     * so that construction sites in digging phase allow bumps onto their tiles.
     * Does NOT check unit occupancy — caller handles that.
     */
    private isTilePassableForBump(x: number, y: number): boolean {
        if (x < 0 || x >= this.terrainMapWidth || y < 0 || y >= this.terrainMapHeight) return false;
        if (this.terrainGroundType) {
            const idx = x + y * this.terrainMapWidth;
            if (!isPassable(this.terrainGroundType[idx]!)) return false;
        }
        const key = tileKey(x, y);
        if (this.buildingOccupancy.has(key)) return false;
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
