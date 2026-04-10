import { EntityType, tileKey, type Tile } from '../../entity';
import { MovementController, MovementState } from './movement-controller';
import { PathfindingService } from './pathfinding-service';
import type { TickSystem } from '../../core/tick-system';
import type { EventBus } from '../../event-bus';
import { type ComponentStore, mapStore } from '../../ecs';
import { LogHandler } from '@/utilities/log-handler';
import { consumeLastPathfindingFailure, setPathfindingEntityContext } from '../pathfinding';
import { BumpResolver } from './bump-resolver';
import { runCrowdDispersal, clearDispersalCooldown } from './crowd-dispersal';

const log = new LogHandler('MovementSystem');

type TileWithEntityType = Tile & { type: EntityType };

/** After waiting this long, repath to find an alternative route around terrain */
const REPATH_WAIT_TIMEOUT = 0.5; // seconds

/** After this long, clear path and let the task system reassign */
const GIVEUP_WAIT_TIMEOUT = 2.0; // seconds

/**
 * Callback for updating entity position in the game state.
 * Returns true if the update was successful.
 */
export type UpdatePositionFn = (entityId: number, newPos: Tile) => boolean;

/**
 * Callback for getting entity information.
 */
export type GetEntityFn = (entityId: number) => TileWithEntityType | undefined;

/**
 * Configuration for MovementSystem dependencies.
 */
export interface MovementSystemConfig {
    eventBus: EventBus;
    updatePosition: UpdatePositionFn;
    getEntity: GetEntityFn;
    unitOccupancy: Map<string, number>;
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
 *   - Delegating collision resolution to BumpResolver
 *   - Delegating pathfinding to PathfindingService
 *   - Emitting movement-stopped events
 */
export class MovementSystem implements TickSystem {
    private controllers: Map<number, MovementController> = new Map();

    /** Uniform read-only view for cross-cutting queries */
    readonly store: ComponentStore<MovementController> = mapStore(this.controllers);

    // Terrain and occupancy references
    private readonly unitOccupancy: Map<string, number>;
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
        this.bumpResolverDeps.verbose = value;
    }

    // Pathfinding service
    private readonly pathfinder: PathfindingService;

    // Bump resolution
    private readonly bumpResolverDeps: {
        controllers: Map<number, MovementController>;
        unitOccupancy: Map<string, number>;
        buildingOccupancy: Set<string>;
        eventBus: EventBus;
        pathfinder: PathfindingService;
        updatePositionFn: UpdatePositionFn;
        terrainGroundType: Uint8Array | undefined;
        terrainMapWidth: number;
        terrainMapHeight: number;
        verbose: boolean;
    };

    private readonly bumpResolver: BumpResolver;

    // Cached callbacks
    private readonly updatePositionFn: UpdatePositionFn;
    private readonly getEntityFn: GetEntityFn;

    // Previous movement state per controller for change detection
    private prevStates: Map<number, MovementState> = new Map();

    constructor(config: MovementSystemConfig) {
        this.eventBus = config.eventBus;
        this.updatePositionFn = config.updatePosition;
        this.getEntityFn = config.getEntity;
        this.unitOccupancy = config.unitOccupancy;
        this.buildingOccupancy = config.buildingOccupancy;
        this.buildingFootprint = config.buildingFootprint;
        this.pathfinder = new PathfindingService();
        this.pathfinder.setBuildingOccupancy(config.buildingOccupancy);
        this.pathfinder.setUnitOccupancy(config.unitOccupancy);

        this.bumpResolverDeps = {
            controllers: this.controllers,
            unitOccupancy: config.unitOccupancy,
            buildingOccupancy: config.buildingOccupancy,
            eventBus: config.eventBus,
            pathfinder: this.pathfinder,
            updatePositionFn: config.updatePosition,
            terrainGroundType: undefined,
            terrainMapWidth: 0,
            terrainMapHeight: 0,
            verbose: this._verbose,
        };
        this.bumpResolver = new BumpResolver(this.bumpResolverDeps);
    }

    // -------------------------------------------------------------------------
    // Setup
    // -------------------------------------------------------------------------

    /**
     * Set the terrain data for pathfinding and bump validation.
     */
    setTerrainData(groundType: Uint8Array, groundHeight: Uint8Array, mapWidth: number, mapHeight: number): void {
        this.pathfinder.setTerrainData(groundType, groundHeight, mapWidth, mapHeight);
        this.bumpResolverDeps.terrainGroundType = groundType;
        this.bumpResolverDeps.terrainMapWidth = mapWidth;
        this.bumpResolverDeps.terrainMapHeight = mapHeight;
    }

    // -------------------------------------------------------------------------
    // Controller lifecycle
    // -------------------------------------------------------------------------

    createController(entityId: number, tile: Tile, speed: number): MovementController {
        const controller = new MovementController(entityId, tile, speed);
        this.controllers.set(entityId, controller);
        this.unitOccupancy.set(tileKey(tile), entityId);
        return controller;
    }

    getController(entityId: number): MovementController | undefined {
        return this.controllers.get(entityId);
    }

    removeController(entityId: number): void {
        const ctrl = this.controllers.get(entityId);
        if (ctrl) {
            const key = tileKey({ x: ctrl.tileX, y: ctrl.tileY });
            if (this.unitOccupancy.get(key) === entityId) {
                this.unitOccupancy.delete(key);
            }
        }
        this.controllers.delete(entityId);
        this.prevStates.delete(entityId);
        clearDispersalCooldown(entityId);
    }

    hasController(entityId: number): boolean {
        return this.controllers.has(entityId);
    }

    getAllControllers(): IterableIterator<MovementController> {
        return this.controllers.values();
    }

    /**
     * Repath all moving units whose remaining path passes through any of the given tiles.
     * Used when building footprint is blocked mid-game (e.g. construction site evacuation)
     * so in-flight units route around the newly blocked area.
     */
    repathUnitsThrough(blockedKeys: Set<string>, excludeIds?: Set<number>): void {
        for (const ctrl of this.controllers.values()) {
            if (excludeIds?.has(ctrl.entityId)) {
                continue;
            }
            if (ctrl.state !== 'moving' || !ctrl.hasPath) {
                continue;
            }
            const remaining = ctrl.path.slice(ctrl.pathIndex);
            const passesThrough = remaining.some(wp => blockedKeys.has(tileKey(wp)));
            if (!passesThrough) {
                continue;
            }

            const goal = ctrl.goal;
            if (!goal) {
                continue;
            }
            setPathfindingEntityContext(ctrl.entityId);
            this.pathfinder.setPathfindingEntityId(ctrl.entityId);
            const newPath = this.pathfinder.findPath(ctrl.tileX, ctrl.tileY, goal.x, goal.y);
            setPathfindingEntityContext(undefined);
            this.pathfinder.setPathfindingEntityId(undefined);
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
    moveUnit(entityId: number, target: Tile): boolean {
        const controller = this.controllers.get(entityId);
        if (!controller) {
            return false;
        }

        const fromX = controller.tileX;
        const fromY = controller.tileY;

        setPathfindingEntityContext(entityId);
        this.pathfinder.setPathfindingEntityId(entityId);
        const path = this.pathfinder.findPath(fromX, fromY, target.x, target.y);
        setPathfindingEntityContext(undefined);
        this.pathfinder.setPathfindingEntityId(undefined);

        if (!path || path.length === 0) {
            this.emitPathFailed(entityId, fromX, fromY, target.x, target.y);
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
                unitId: entityId,
                fromX,
                fromY,
                toX: target.x,
                toY: target.y,
                pathLength: path.length,
                redirect,
            });
        }

        return true;
    }

    private emitPathFailed(unitId: number, fromX: number, fromY: number, toX: number, toY: number): void {
        const diag = consumeLastPathfindingFailure();
        this.eventBus.emit('movement:pathFailed', {
            unitId,
            fromX,
            fromY,
            toX,
            toY,
            x: fromX,
            y: fromY,
            level: 'warn',
            // eslint-disable-next-line no-restricted-syntax -- diag is optional pathfinding diagnostic data; fallbacks are sentinel defaults when diagnostics are unavailable
            startPassable: diag?.startPassable ?? true,
            // eslint-disable-next-line no-restricted-syntax -- diag is optional pathfinding diagnostic data; fallbacks are sentinel defaults when diagnostics are unavailable
            goalPassable: diag?.goalPassable ?? true,
            // eslint-disable-next-line no-restricted-syntax -- diag is optional pathfinding diagnostic data; fallbacks are sentinel defaults when diagnostics are unavailable
            startInBuilding: diag?.startInBuilding ?? false,
            // eslint-disable-next-line no-restricted-syntax -- diag is optional pathfinding diagnostic data; fallbacks are sentinel defaults when diagnostics are unavailable
            goalInBuilding: diag?.goalInBuilding ?? false,
            nodesSearched: diag?.nodesSearched ?? -1,
            // eslint-disable-next-line no-restricted-syntax -- diag is optional pathfinding diagnostic data; fallbacks are sentinel defaults when diagnostics are unavailable
            exhausted: diag?.exhausted ?? false,
            // eslint-disable-next-line no-restricted-syntax -- diag is optional pathfinding diagnostic data; empty string is the correct default when no neighbor info available
            neighborInfo: diag?.neighborInfo ?? '',
        });
    }

    /**
     * Push any unit standing at (x, y) to a free passable neighbor tile.
     * Used when spawning a unit at a specific tile (e.g. building door).
     * Returns true if the tile is now free (was empty or push succeeded).
     */
    pushUnitAt(tile: Tile): boolean {
        return this.bumpResolver.pushUnitAt(tile);
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

        runCrowdDispersal(
            this,
            this.controllers.values(),
            this.unitOccupancy,
            this.buildingOccupancy,
            this.bumpResolverDeps.terrainGroundType,
            this.bumpResolverDeps.terrainMapWidth,
            this.bumpResolverDeps.terrainMapHeight,
            deltaSec
        );
    }

    private updateController(controller: MovementController, deltaSec: number): void {
        const prevState = this.prevStates.get(controller.entityId) ?? controller.state;

        controller.advanceProgress(deltaSec);

        while (controller.canMove()) {
            const wp = controller.nextWaypoint;
            if (!wp) {
                break;
            }

            // If next waypoint is building-blocked and the unit is NOT on a blocked tile
            // itself (i.e. it's trying to enter, not escape), repath around it.
            const wpKey = tileKey(wp);
            if (this.buildingOccupancy.has(wpKey)) {
                const currentKey = tileKey({ x: controller.tileX, y: controller.tileY });
                if (!this.buildingOccupancy.has(currentKey)) {
                    this.repathFromCurrent(controller);
                    break;
                }
            }

            const occupantId = this.getUnitAt(tileKey(wp), controller.entityId);

            if (occupantId === undefined) {
                this.stepForward(controller);
            } else if (!this.resolveCollision(controller, occupantId, deltaSec)) {
                break;
            }
        }

        controller.finalizeTick();
        this.detectTeleport(controller, prevState);

        controller.updateLastVisualPosition();
        this.emitMovementStopped(controller, prevState);
        this.prevStates.set(controller.entityId, controller.state);
    }

    // -------------------------------------------------------------------------
    // Tile occupancy queries
    // -------------------------------------------------------------------------

    private getUnitAt(key: string, selfId: number): number | undefined {
        const occupant = this.unitOccupancy.get(key);
        if (occupant !== undefined && occupant !== selfId) {
            return occupant;
        }
        return undefined;
    }

    // -------------------------------------------------------------------------
    // Step & collision helpers
    // -------------------------------------------------------------------------

    private stepForward(controller: MovementController): void {
        const oldKey = tileKey({ x: controller.tileX, y: controller.tileY });
        const newPos = controller.executeMove();
        if (newPos) {
            if (this.unitOccupancy.get(oldKey) === controller.entityId) {
                this.unitOccupancy.delete(oldKey);
            }
            this.unitOccupancy.set(tileKey(newPos), controller.entityId);
            this.updatePositionFn(controller.entityId, newPos);
            if (this._verbose) {
                this.eventBus.emit('movement:step', {
                    unitId: controller.entityId,
                    x: newPos.x,
                    y: newPos.y,
                    pathIdx: controller.pathIndex,
                    pathLen: controller.path.length,
                });
            }
        }
        controller.resetWaitTime();
    }

    private resolveCollision(controller: MovementController, occupantId: number, deltaSec: number): boolean {
        controller.addWaitTime(deltaSec);

        if (this.bumpResolver.tryBump(controller, occupantId)) {
            this.stepForward(controller);
            return true;
        }

        if (controller.cumulativeWaitTime > GIVEUP_WAIT_TIMEOUT) {
            if (this._verbose) {
                this.eventBus.emit('movement:escalation', {
                    unitId: controller.entityId,
                    result: 'gave_up',
                });
            }
            controller.clearPath();
            return false;
        }

        if (controller.waitTime > REPATH_WAIT_TIMEOUT) {
            if (this._verbose) {
                this.eventBus.emit('movement:escalation', {
                    unitId: controller.entityId,
                    result: 'repath',
                });
            }
            this.repathFromCurrent(controller);
            return false;
        }

        if (this._verbose) {
            const wp = controller.nextWaypoint!;
            this.eventBus.emit('movement:blocked', {
                unitId: controller.entityId,
                x: wp.x,
                y: wp.y,
                blockerId: occupantId,
                isBuilding: false,
            });
        }
        controller.haltProgress();
        return false;
    }

    private repathFromCurrent(controller: MovementController): void {
        const goal = controller.goal;
        if (goal) {
            setPathfindingEntityContext(controller.entityId);
            this.pathfinder.setPathfindingEntityId(controller.entityId);
            const newPath = this.pathfinder.findPath(controller.tileX, controller.tileY, goal.x, goal.y);
            setPathfindingEntityContext(undefined);
            this.pathfinder.setPathfindingEntityId(undefined);
            if (newPath && newPath.length > 0) {
                controller.replacePath(newPath);
            }
        }
        controller.resetWaitTime();
    }

    // -------------------------------------------------------------------------
    // Diagnostics
    // -------------------------------------------------------------------------

    private detectTeleport(controller: MovementController, prevState: MovementState): void {
        const teleportDist = controller.detectTeleport();
        const steps = Math.max(1, controller.stepsTakenThisTick);
        // Diagonal steps cover sqrt(2) ≈ 1.414 tile-coords, so use that as the per-step base
        const threshold = 1.5 * Math.SQRT2 * steps + 0.01;
        if (teleportDist > threshold) {
            console.warn(
                `[MovementSystem] TELEPORT DETECTED! Entity ${controller.entityId} jumped ${teleportDist.toFixed(2)} tiles` +
                    ` | state=${controller.state} prevState=${prevState}` +
                    ` | tile=(${controller.tileX},${controller.tileY}) prev=(${controller.prevTileX},${controller.prevTileY})` +
                    ` | progress=${controller.progress.toFixed(2)} inTransit=${controller.isInTransit}` +
                    ` | pathLen=${controller.path.length} pathIdx=${controller.pathIndex}` +
                    ` | steps=${steps}`
            );
            this.eventBus.emit('movement:teleport', {
                unitId: controller.entityId,
                distance: teleportDist,
                state: controller.state,
                prevState,
                x: controller.tileX,
                y: controller.tileY,
                level: 'warn',
            });
        }
    }

    private emitMovementStopped(controller: MovementController, prevState: MovementState): void {
        if (controller.state !== prevState && controller.state === 'idle' && prevState !== 'idle') {
            this.eventBus.emit('unit:movementStopped', {
                unitId: controller.entityId,
                direction: controller.direction,
            });
        }
    }
}
