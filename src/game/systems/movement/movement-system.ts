import { EntityType, TileCoord, tileKey } from '../../entity';
import { MovementController, MovementState } from './movement-controller';
import { PathfindingService } from './pathfinding-service';
import { CollisionResolver } from './collision-resolver';
import { BlockedStateHandler } from './blocked-state-handler';
import type { TickSystem } from '../../tick-system';
import type { EventBus } from '../../event-bus';
import type { SeededRng } from '../../rng';

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

    // Terrain and occupancy references (also forwarded to sub-services)
    private tileOccupancy?: Map<string, number>;
    private buildingOccupancy?: Set<string>;

    // Event bus for notifying other systems of movement changes
    private readonly eventBus: EventBus;

    // Pathfinding, collision, and blocked-state sub-services
    private readonly pathfinder: PathfindingService;
    private collisionResolver?: CollisionResolver;
    private blockedStateHandler?: BlockedStateHandler;

    // Cached callbacks
    private readonly updatePositionFn: UpdatePositionFn;
    private readonly getEntityFn: GetEntityFn;

    // Seeded RNG for deterministic push behavior
    private readonly rng: SeededRng;

    // Previous movement state per controller for change detection
    private prevStates: Map<number, MovementState> = new Map();

    constructor(config: MovementSystemConfig) {
        this.eventBus = config.eventBus;
        this.rng = config.rng;
        this.updatePositionFn = config.updatePosition;
        this.getEntityFn = config.getEntity;
        this.pathfinder = new PathfindingService();
    }

    // -------------------------------------------------------------------------
    // Setup
    // -------------------------------------------------------------------------

    /**
     * Set the terrain data for pathfinding and collision.
     */
    setTerrainData(groundType: Uint8Array, groundHeight: Uint8Array, mapWidth: number, mapHeight: number): void {
        this.pathfinder.setTerrainData(groundType, groundHeight, mapWidth, mapHeight);
        this.collisionResolver?.setTerrainData(groundType, mapWidth, mapHeight);
    }

    /**
     * Set the tile occupancy map for collision detection.
     * Must be called before any movement updates occur.
     */
    setTileOccupancy(occupancy: Map<string, number>, buildingOccupancy: Set<string>): void {
        this.tileOccupancy = occupancy;
        this.buildingOccupancy = buildingOccupancy;
        this.pathfinder.setOccupancy(occupancy);
        this.pathfinder.setBuildingOccupancy(buildingOccupancy);
        this.rebuildSubServices();
    }

    /** (Re)build CollisionResolver and BlockedStateHandler after occupancy is available. */
    private rebuildSubServices(): void {
        if (!this.tileOccupancy) return;

        this.collisionResolver = new CollisionResolver({
            pathfinder: this.pathfinder,
            rng: this.rng,
            tileOccupancy: this.tileOccupancy,
            getEntity: this.getEntityFn,
            updatePosition: this.updatePositionFn,
            getController: id => this.controllers.get(id),
        });

        this.blockedStateHandler = new BlockedStateHandler(this.pathfinder);
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

        const path = this.pathfinder.findPath(
            controller.tileX,
            controller.tileY,
            targetX,
            targetY,
            true // ignoreOccupancy: initial plan should ignore transient units
        );

        if (!path || path.length === 0) return false;

        if (controller.isInTransit) {
            controller.redirectPath(path);
        } else {
            controller.startPath(path);
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
                this.updateController(controller, deltaSec);
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
                `[MovementSystem] TELEPORT DETECTED! Entity ${controller.entityId} jumped ${teleportDist.toFixed(2)} tiles`
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
        if (!this.tileOccupancy) return false;

        const key = tileKey(wp.x, wp.y);
        const blockingEntityId = this.tileOccupancy.get(key);
        if (blockingEntityId === undefined || blockingEntityId === controller.entityId) {
            return false; // tile is free
        }

        // Building footprint tiles are impassable (door tiles are excluded from buildingOccupancy)
        if (this.buildingOccupancy?.has(key)) {
            controller.setBlocked(deltaSec);
            return true;
        }

        // Non-unit, non-building occupants (e.g. door tiles owned by building) — allow passage
        const blockingEntity = this.getEntityFn(blockingEntityId);
        if (!blockingEntity || blockingEntity.type !== EntityType.Unit) {
            return false;
        }

        // Escalation (give-up / escalated repath) takes precedence over normal resolution
        if (this.blockedStateHandler) {
            const result = this.blockedStateHandler.handle(controller, deltaSec);
            if (result === 'gave-up') return true;
            if (result === 'escalated') return false; // path replaced — retry the move loop
        }

        // Normal collision resolution (detour, repair, push, yield, wait)
        if (this.collisionResolver) {
            return this.collisionResolver.resolveBlockedWaypoint(controller, wp, deltaSec);
        }

        // Fallback: no resolver available yet, just mark as blocked
        controller.setBlocked(deltaSec);
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
