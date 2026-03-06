import { EntityType, TileCoord, tileKey } from '../../entity';
import { MovementController, MovementState } from './movement-controller';
import { PathfindingService } from './pathfinding-service';
import { CollisionResolver } from './collision-resolver';
import { BlockedStateHandler } from './blocked-state-handler';
import type { TickSystem } from '../../tick-system';
import type { EventBus } from '../../event-bus';
import type { SeededRng } from '../../rng';
import { type ComponentStore, mapStore } from '../../ecs';
import { LogHandler } from '@/utilities/log-handler';

const log = new LogHandler('MovementSystem');

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
    tileOccupancy: Map<string, number>;
    buildingOccupancy: Set<string>;
}

/**
 * MovementSystem manages all unit movement controllers and coordinates
 * their updates, collision resolution, and pathfinding.
 *
 * Responsibilities:
 *   - Controller lifecycle (create / get / remove)
 *   - Per-tick update loop (advance, move, finalize)
 *   - Delegating collision resolution to CollisionResolver
 *   - Delegating blocked escalation to BlockedStateHandler
 *   - Delegating pathfinding to PathfindingService
 *   - Emitting movement-stopped events
 */
export class MovementSystem implements TickSystem {
    private controllers: Map<number, MovementController> = new Map();

    /** Uniform read-only view for cross-cutting queries */
    readonly store: ComponentStore<MovementController> = mapStore(this.controllers);

    // Terrain and occupancy references (also forwarded to sub-services)
    private readonly tileOccupancy: Map<string, number>;
    private readonly buildingOccupancy: Set<string>;

    // Event bus for notifying other systems of movement changes
    private readonly eventBus: EventBus;

    /** Enable verbose movement events (pathFound, pathFailed, blocked, escalation, collisionResolved) */
    private _verbose = false;

    get verbose(): boolean {
        return this._verbose;
    }

    set verbose(value: boolean) {
        this._verbose = value;
        this.collisionResolver.verbose = value;
    }

    // Pathfinding, collision, and blocked-state sub-services
    private readonly pathfinder: PathfindingService;
    private readonly collisionResolver: CollisionResolver;
    private readonly blockedStateHandler: BlockedStateHandler;

    // Cached callbacks
    private readonly updatePositionFn: UpdatePositionFn;
    private readonly getEntityFn: GetEntityFn;

    // Previous movement state per controller for change detection
    private prevStates: Map<number, MovementState> = new Map();

    constructor(config: MovementSystemConfig) {
        this.eventBus = config.eventBus;
        this.updatePositionFn = config.updatePosition;
        this.getEntityFn = config.getEntity;
        this.tileOccupancy = config.tileOccupancy;
        this.buildingOccupancy = config.buildingOccupancy;
        this.pathfinder = new PathfindingService();
        this.pathfinder.setOccupancy(config.tileOccupancy);
        this.pathfinder.setBuildingOccupancy(config.buildingOccupancy);
        this.collisionResolver = new CollisionResolver({
            pathfinder: this.pathfinder,
            tileOccupancy: config.tileOccupancy,
            buildingOccupancy: config.buildingOccupancy,
            getEntity: this.getEntityFn,
            updatePosition: this.updatePositionFn,
            getController: this.controllers.get.bind(this.controllers),
            eventBus: this.eventBus,
        });
        this.blockedStateHandler = new BlockedStateHandler(this.pathfinder);
    }

    // -------------------------------------------------------------------------
    // Setup
    // -------------------------------------------------------------------------

    /**
     * Set the terrain data for pathfinding and collision.
     */
    setTerrainData(groundType: Uint8Array, groundHeight: Uint8Array, mapWidth: number, mapHeight: number): void {
        this.pathfinder.setTerrainData(groundType, groundHeight, mapWidth, mapHeight);
        this.collisionResolver.setTerrainData(groundType, mapWidth, mapHeight);
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

        const path = this.pathfinder.findPath(
            fromX,
            fromY,
            targetX,
            targetY,
            true // ignoreOccupancy: initial plan should ignore transient units
        );

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

        // Accumulate blocked time every tick the unit remains blocked
        // (not just on collision-check ticks, so the give-up timeout tracks wall-clock time)
        if (controller.state === 'blocked') {
            controller.addBlockedTime(deltaSec);
        }

        while (controller.canMove()) {
            const wp = controller.nextWaypoint;
            if (!wp) break;

            if (this.handleBlockedWaypoint(controller, wp, deltaSec)) break;

            const newPos = controller.executeMove();
            if (newPos) {
                this.updatePositionFn(controller.entityId, newPos.x, newPos.y);
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

    /**
     * Check if the waypoint is blocked and attempt resolution via escalation pipeline:
     * BlockedStateHandler handles timeouts; CollisionResolver handles obstacle strategies.
     *
     * Returns true when the unit should stop processing moves this tick.
     */
    private handleBlockedWaypoint(controller: MovementController, wp: TileCoord, deltaSec: number): boolean {
        const key = tileKey(wp.x, wp.y);
        const blockingEntityId = this.tileOccupancy.get(key);
        if (blockingEntityId === undefined || blockingEntityId === controller.entityId) {
            return false; // tile is free
        }

        // Escalation (give-up / escalated repath) takes precedence over normal resolution
        const escalated = this.tryEscalate(controller, deltaSec);
        if (escalated !== null) return escalated;

        // Block classification + resolution (building footprint, non-unit, unit collision)
        return this.collisionResolver.resolveBlock(controller, wp, blockingEntityId);
    }

    /**
     * Run the blocked-state handler escalation pipeline.
     * Returns true (stop) / false (continue) when escalation fires, null when not triggered.
     */
    private tryEscalate(controller: MovementController, deltaSec: number): boolean | null {
        const result = this.blockedStateHandler.handle(controller, deltaSec);
        if (result === 'gave-up') {
            if (this.verbose) {
                this.eventBus.emit('movement:escalation', { entityId: controller.entityId, result: 'gave_up' });
            }
            return true;
        }
        if (result === 'escalated') {
            if (this.verbose) {
                this.eventBus.emit('movement:escalation', { entityId: controller.entityId, result: 'repath' });
            }
            return false;
        }
        return null;
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
