/**
 * Lightweight typed event bus for decoupling game systems.
 * Features register event handlers instead of being called directly.
 *
 * Error isolation: Handlers that throw are caught and logged with throttling.
 * One bad handler won't crash the loop or prevent other handlers from running.
 */

import type { BuildingType } from './buildings/types';
import type { Race } from './core/race';
import type { UnitType } from './core/unit-types';
import type { EntityType } from './entity';
import type { EMaterialType } from './economy';
import type { MapObjectType } from './types/map-object-types';
import { LogHandler } from '@/utilities/log-handler';
import { ThrottledLogger } from '@/utilities/throttled-logger';

// ─────────────────────────────────────────────────────────────
// Shared payload types — defined here so event-bus has no feature imports.
// Features re-export these from event-bus rather than defining their own.
// ─────────────────────────────────────────────────────────────

/** Single barracks training recipe — inputs consumed to produce one soldier. */
export interface TrainingRecipe {
    /** Materials consumed per training cycle. */
    inputs: readonly { material: EMaterialType; count: number }[];
    /** Base soldier type produced (e.g. Swordsman, not Swordsman2). */
    unitType: UnitType;
    /** Soldier level (1, 2, or 3). */
    level: number;
}

/** Controls how the next recipe is selected for a multi-recipe building. */
export enum ProductionMode {
    Even = 'even',
    Proportional = 'proportional',
    Manual = 'manual',
}

/** Event map defining all game events and their payloads */
export interface GameEvents {
    /** Emitted when a building is successfully placed (construction begins) */
    'building:placed': {
        entityId: number;
        buildingType: BuildingType;
        x: number;
        y: number;
        player: number;
    };
    /** Emitted when building construction completes */
    'building:completed': {
        entityId: number;
        buildingType: BuildingType;
        race: Race;
        /** True when the building was placed as instantly completed (no construction). */
        placedCompleted?: boolean;
        /** True when the building should auto-spawn its dedicated worker. */
        spawnWorker?: boolean;
    };
    /** Emitted when a building is removed/cancelled */
    'building:removed': {
        entityId: number;
        buildingType: BuildingType;
    };
    /** Emitted when a unit is spawned */
    'unit:spawned': {
        entityId: number;
        unitType: UnitType;
        x: number;
        y: number;
        player: number;
    };
    /** Emitted when terrain is modified (e.g., during building construction leveling) */
    'terrain:modified': Record<string, never>;

    // === Movement Events ===

    /**
     * Emitted when a unit stops moving (becomes idle).
     * Used by CarrierSystem for arrival detection.
     * Note: movementStarted and directionChanged were removed - animation
     * is now handled by SettlerTaskSystem directly, not via events.
     */
    'unit:movementStopped': {
        entityId: number;
        direction: number;
    };

    // === Verbose Movement Events (gated by MovementSystem.verbose) ===

    /** A path was requested and found */
    'movement:pathFound': {
        entityId: number;
        fromX: number;
        fromY: number;
        toX: number;
        toY: number;
        pathLength: number;
        redirect: boolean;
    };

    /** A path was requested but no route exists */
    'movement:pathFailed': {
        entityId: number;
        fromX: number;
        fromY: number;
        toX: number;
        toY: number;
    };

    /** Unit's next waypoint is blocked by another entity */
    'movement:blocked': {
        entityId: number;
        x: number;
        y: number;
        blockerId: number;
        isBuilding: boolean;
    };

    /** Blocked-state handler escalated (repath or gave up) */
    'movement:escalation': {
        entityId: number;
        result: 'repath' | 'gave_up';
    };

    /** Collision resolution strategy was attempted */
    'movement:collisionResolved': {
        entityId: number;
        strategy: 'detour' | 'pathRepair' | 'push' | 'yield' | 'wait';
        success: boolean;
        x: number;
        y: number;
        /** Target tile of the resolution (detour/push/yield destination) */
        toX?: number;
        toY?: number;
        /** Entity that was pushed or blocking */
        targetId?: number;
    };

    // === Carrier Events ===

    /** Emitted when a carrier is registered */
    'carrier:created': {
        entityId: number;
    };

    /** Emitted when a carrier is removed from the system */
    'carrier:removed': {
        entityId: number;
    };

    /** Emitted when a carrier arrives at a building for pickup */
    'carrier:arrivedForPickup': {
        entityId: number;
        buildingId: number;
    };

    /** Emitted when a carrier arrives at a building for delivery */
    'carrier:arrivedForDelivery': {
        entityId: number;
        buildingId: number;
    };

    /** Emitted when a carrier completes a pickup (material transferred) */
    'carrier:pickupComplete': {
        entityId: number;
        fromBuilding: number;
        material: number;
        amount: number;
    };

    /** Emitted when a carrier pickup fails (material not available) */
    'carrier:pickupFailed': {
        entityId: number;
        fromBuilding: number;
        material: number;
        /** Amount that was requested but not available */
        requestedAmount: number;
    };

    /** Emitted when a carrier completes a delivery (material transferred) */
    'carrier:deliveryComplete': {
        entityId: number;
        toBuilding: number;
        material: number;
        amount: number;
        /** Amount that couldn't be delivered (destination full) */
        overflow: number;
    };

    /** Emitted when a carrier is successfully assigned to a transport job */
    'carrier:assigned': {
        requestId: number;
        carrierId: number;
        sourceBuilding: number;
        destBuilding: number;
        material: EMaterialType;
    };

    /** Emitted when a transport job is cancelled (from any path — task interruption, carrier removal, etc.) */
    'carrier:transportCancelled': {
        carrierId: number;
        requestId: number;
        reason: string;
    };

    /** Emitted when carrier assignment fails (reservation failed or movement failed) */
    'carrier:assignmentFailed': {
        requestId: number;
        reason: 'reservation_failed' | 'movement_failed';
        sourceBuilding: number;
        destBuilding: number;
        material: EMaterialType;
        carrierId?: number;
    };

    /**
     * Emitted (throttled) when no idle carrier is available for a pending request.
     * Deduplicated per (building, material) — fires at most once per ~5 seconds.
     */
    'logistics:noCarrier': {
        requestId: number;
        buildingId: number;
        materialType: EMaterialType;
        sourceBuilding: number;
    };

    // === Logistics Events ===

    /** Emitted when no supply source is found for a pending request */
    'logistics:noMatch': {
        requestId: number;
        buildingId: number;
        materialType: EMaterialType;
    };

    /** Emitted when logistics cleanup completes after a building is destroyed */
    'logistics:buildingCleanedUp': {
        buildingId: number;
        requestsCancelled: number;
        jobsCancelled: number;
    };

    /** Emitted when a new resource request is created */
    'logistics:requestCreated': {
        requestId: number;
        buildingId: number;
        materialType: EMaterialType;
        amount: number;
        /** RequestPriority enum value (0=High, 1=Normal, 2=Low) */
        priority: number;
    };

    /** Emitted when a resource request is removed/cancelled */
    'logistics:requestRemoved': {
        requestId: number;
    };

    /** Emitted when a resource request is assigned to a carrier */
    'logistics:requestAssigned': {
        requestId: number;
        carrierId: number;
        sourceBuilding: number;
    };

    /** Emitted when a resource request is fulfilled (delivery complete) */
    'logistics:requestFulfilled': {
        requestId: number;
        buildingId: number;
        materialType: EMaterialType;
    };

    /** Emitted when a resource request is reset to pending (carrier dropped it, timeout, etc.) */
    'logistics:requestReset': {
        requestId: number;
        buildingId: number;
        materialType: EMaterialType;
        reason: string;
    };

    // === Inventory Events ===

    /** Emitted when a building's inventory changes */
    'inventory:changed': {
        buildingId: number;
        materialType: EMaterialType;
        slotType: 'input' | 'output';
        previousAmount: number;
        newAmount: number;
    };

    // === Production Control Events ===

    /** Emitted when a building's production mode changes */
    'production:modeChanged': {
        buildingId: number;
        mode: ProductionMode;
    };

    // === Tree Events ===

    /** Emitted when a tree is planted by a forester */
    'tree:planted': {
        entityId: number;
        treeType: MapObjectType;
        x: number;
        y: number;
    };

    /** Emitted when a tree finishes growing and becomes a full tree */
    'tree:matured': {
        entityId: number;
    };

    /** Emitted when a tree is fully cut down */
    'tree:cut': {
        entityId: number;
    };

    // === Crop Events ===

    /** Emitted when a crop is planted by a farmer */
    'crop:planted': {
        entityId: number;
        cropType: MapObjectType;
        x: number;
        y: number;
    };

    /** Emitted when a crop finishes growing and becomes ready for harvest */
    'crop:matured': {
        entityId: number;
        cropType: MapObjectType;
    };

    /** Emitted when a crop is fully harvested */
    'crop:harvested': {
        entityId: number;
        cropType: MapObjectType;
    };

    // === Combat Events ===

    /** Emitted when a unit takes damage from combat */
    'combat:unitAttacked': {
        attackerId: number;
        targetId: number;
        damage: number;
        remainingHealth: number;
    };

    /** Emitted when a unit is killed in combat */
    'combat:unitDefeated': {
        entityId: number;
        defeatedBy: number;
    };

    // === Entity Lifecycle Events ===

    /**
     * Emitted when any entity is added to the game.
     * Systems subscribe to handle type-specific initialization
     * (e.g., MovementSystem creates controllers for units).
     */
    'entity:created': {
        entityId: number;
        type: EntityType;
        subType: number;
        x: number;
        y: number;
        player: number;
        /** Initial visual variation (sprite offset from map data). 0 for most entities. */
        variation: number;
    };

    /**
     * Emitted when any entity is removed from the game.
     * Systems should subscribe to clean up per-entity state.
     */
    'entity:removed': {
        entityId: number;
    };

    // === Pile Events ===

    /** Emitted after a free pile entity is fully created (kind + quantity set). */
    'pile:freePilePlaced': {
        entityId: number;
        materialType: EMaterialType;
        quantity: number;
    };

    /** Emitted when a building's piles are converted to free piles (during building destruction). */
    'pile:buildingPilesConverted': {
        buildingId: number;
        /** Maps material type → pile entity ID for each converted pile. */
        piles: Map<EMaterialType, number>;
    };

    // === Construction Events ===

    /** Emitted when the first digger starts working on a construction site */
    'construction:diggingStarted': {
        buildingId: number;
    };
    /** Emitted when a single tile's terrain is leveled during construction */
    'construction:tileCompleted': {
        buildingId: number;
        tileX: number;
        tileY: number;
        targetHeight: number;
        isFootprint: boolean;
    };
    /** Emitted when terrain leveling is complete for a construction site */
    'construction:levelingComplete': {
        buildingId: number;
    };
    /** Emitted when the first builder starts constructing */
    'construction:buildingStarted': {
        buildingId: number;
    };
    /** Emitted when a material is delivered to a construction site inventory */
    'construction:materialDelivered': {
        buildingId: number;
        material: EMaterialType;
    };
    /** Emitted when delivered material overflows (destination full) — used to keep delivery count in sync */
    'construction:materialOverflowed': {
        buildingId: number;
        material: EMaterialType;
        amount: number;
    };
    /** Emitted when construction progress reaches 1.0 */
    'construction:progressComplete': {
        buildingId: number;
    };
    /** Emitted when a digger or builder claims a slot on a construction site. */
    'construction:workerAssigned': {
        buildingId: number;
        workerId: number;
        role: 'digger' | 'builder';
    };
    /** Emitted when a digger or builder releases their slot (finished or interrupted). */
    'construction:workerReleased': {
        buildingId: number;
        workerId: number;
        role: 'digger' | 'builder';
    };
    /**
     * Emitted by ConstructionSiteManager when a site needs a worker it doesn't have.
     * RecruitSystem subscribes to this instead of polling ConstructionSiteManager.
     */
    'construction:workerNeeded': {
        role: 'digger' | 'builder';
        siteId: number;
        tileX: number;
        tileY: number;
        player: number;
    };

    // === Barracks Training Events ===

    // === Settler Task Events ===

    // --- Verbose Choreography Events (gated by WorkerTaskExecutor.verbose) ---

    /** A choreography node started executing */
    'choreo:nodeStarted': {
        unitId: number;
        jobId: string;
        nodeIndex: number;
        /** Total number of nodes in the job */
        nodeCount: number;
        /** ChoreoTaskType name (e.g. GO_TO_TARGET, WORK_ON_ENTITY) */
        task: string;
        /** Animation jobPart key (empty string if none) */
        jobPart: string;
        /** Duration in frames (0 for open-ended nodes like movement) */
        duration: number;
    };

    /** A choreography node completed and advanced to the next */
    'choreo:nodeCompleted': {
        unitId: number;
        jobId: string;
        nodeIndex: number;
        task: string;
    };

    /** Animation was resolved and applied to a settler */
    'choreo:animationApplied': {
        unitId: number;
        jobPart: string;
        sequenceKey: string;
        loop: boolean;
    };

    /** Settler returned home to wait (output full, input unavailable, or first visit) */
    'choreo:waitingAtHome': {
        unitId: number;
        homeBuilding: number;
        reason: 'output_full' | 'cant_work' | 'first_visit';
    };

    /** Emitted when a settler starts a choreography job (walking to target, gathering, etc.) */
    'settler:taskStarted': {
        unitId: number;
        jobId: string;
        targetId: number | null;
        targetPos: { x: number; y: number } | null;
        homeBuilding: number | null;
    };

    /** Emitted when a settler completes a choreography job and returns to idle. */
    'settler:taskCompleted': {
        unitId: number;
        jobId: string;
    };

    /** Emitted when a settler's job is interrupted (target lost, pathfinding failure, etc.) */
    'settler:taskFailed': {
        unitId: number;
        jobId: string;
        /** Index of the choreography node that was executing when the failure occurred. */
        nodeIndex: number;
        /** The choreography step type that failed (e.g. GO_TO_TARGET, WORK_ON_ENTITY). */
        failedStep: string;
        /** Entity target of the job, if any. */
        targetId: number | null;
        /** Whether work had actually started before the interruption. */
        workStarted: boolean;
        /** Whether the unit was carrying material that was lost. */
        wasCarrying: boolean;
    };

    // === Barracks Training Events ===

    /** Emitted when a barracks begins a training cycle (inputs consumed, carrier recruited). */
    'barracks:trainingStarted': {
        buildingId: number;
        recipe: TrainingRecipe;
        carrierId: number;
    };

    /** Emitted when a barracks completes training — soldier spawned */
    'barracks:trainingCompleted': {
        buildingId: number;
        unitType: UnitType;
        level: number;
        soldierId: number;
    };

    /** Emitted when a training cycle is interrupted (e.g. carrier killed en route). */
    'barracks:trainingInterrupted': {
        buildingId: number;
        reason: 'carrier_killed';
    };

    // === Auto-Recruit Events ===

    /** Emitted when a carrier is dispatched to pick up a tool for recruitment. */
    'recruitment:started': {
        carrierId: number;
        targetUnitType: UnitType;
        pileEntityId: number;
        siteId: number;
    };

    /** Emitted when a carrier completes tool pickup and is ready for transformation. */
    'recruitment:completed': {
        carrierId: number;
        targetUnitType: UnitType;
    };

    /** Emitted when a recruitment fails (pile gone, path blocked, etc.). */
    'recruitment:failed': {
        carrierId: number;
        reason: string;
    };

    /** Emitted when a carrier is transformed into a different unit type. */
    'unit:transformed': {
        entityId: number;
        fromType: UnitType;
        toType: UnitType;
    };

    // === Settler Location Events ===

    /**
     * Emitted when a building is destroyed while a settler is approaching it with
     * intent to enter. Features identify whether the settler is theirs via their own
     * data structures (garrison via UnitReservationRegistry, settler-tasks via runtimes map).
     */
    'settler-location:approachInterrupted': {
        settlerId: number;
        buildingId: number;
    };

    // === Garrison Events ===

    /** Emitted when a unit enters a tower garrison (becomes hidden). */
    'garrison:unitEntered': {
        buildingId: number;
        unitId: number;
    };

    /** Emitted when a unit is ejected from a tower garrison (becomes visible at door). */
    'garrison:unitExited': {
        buildingId: number;
        unitId: number;
    };
}

export type EventHandler<T> = (payload: T) => void;

const log = new LogHandler('EventBus');

export class EventBus {
    private handlers = new Map<string, Set<EventHandler<any>>>();

    /**
     * When true, handler errors are re-thrown instead of caught.
     * Enable in tests so failures surface immediately.
     */
    public strict = false;

    /** Called when a handler error is logged for the first time (throttled). Set by the owning layer. */
    onHandlerError: ((event: string, err: Error) => void) | null = null;

    /** Per-event throttled logger to prevent error spam */
    private errorLoggers = new Map<string, ThrottledLogger>();

    /** Get or create throttled logger for an event type */
    private getErrorLogger(event: string): ThrottledLogger {
        let logger = this.errorLoggers.get(event);
        if (!logger) {
            logger = new ThrottledLogger(log, 2000);
            this.errorLoggers.set(event, logger);
        }
        return logger;
    }

    /** Register an event handler */
    on<K extends keyof GameEvents>(event: K, handler: EventHandler<GameEvents[K]>): void {
        if (!this.handlers.has(event as string)) {
            this.handlers.set(event as string, new Set());
        }
        this.handlers.get(event as string)!.add(handler); // OK: set() above guarantees entry exists
    }

    /** Remove an event handler */
    off<K extends keyof GameEvents>(event: K, handler: EventHandler<GameEvents[K]>): void {
        this.handlers.get(event as string)?.delete(handler);
    }

    /**
     * Emit an event to all registered handlers.
     * Each handler is called in isolation - if one throws, others still run.
     * Errors are logged with throttling, and a toast is shown on first failure.
     */
    emit<K extends keyof GameEvents>(event: K, payload: GameEvents[K]): void {
        const handlers = this.handlers.get(event as string);
        if (!handlers) return;

        for (const handler of handlers) {
            if (this.strict) {
                handler(payload);
                continue;
            }
            try {
                handler(payload);
            } catch (e) {
                const err = e instanceof Error ? e : new Error(String(e));
                const logged = this.getErrorLogger(event as string).error(
                    `Handler for '${event as string}' threw`,
                    err
                );
                if (logged) {
                    this.onHandlerError?.(event as string, err);
                }
            }
        }
    }

    /** Remove all handlers */
    clear(): void {
        this.handlers.clear();
        this.errorLoggers.clear();
    }
}

/**
 * Helper class to manage event subscriptions and unsubscribe all at once.
 * Reduces boilerplate when a system needs to track multiple event handlers.
 *
 * @example
 * ```ts
 * class MySystem {
 *     private subscriptions = new EventSubscriptionManager();
 *
 *     registerEvents(eventBus: EventBus): void {
 *         this.subscriptions.subscribe(eventBus, 'unit:movementStopped', (payload) => {
 *             this.handleMovementStopped(payload.entityId);
 *         });
 *     }
 *
 *     unregisterEvents(): void {
 *         this.subscriptions.unsubscribeAll();
 *     }
 * }
 * ```
 */
export class EventSubscriptionManager {
    private subscriptions: Array<{
        eventBus: EventBus;
        event: keyof GameEvents;
        handler: EventHandler<any>;
    }> = [];

    /**
     * Subscribe to an event and track the subscription for later cleanup.
     */
    subscribe<K extends keyof GameEvents>(eventBus: EventBus, event: K, handler: EventHandler<GameEvents[K]>): void {
        eventBus.on(event, handler);
        this.subscriptions.push({ eventBus, event, handler });
    }

    /**
     * Unsubscribe from all tracked events.
     * Call this in unregisterEvents() to clean up all handlers.
     */
    unsubscribeAll(): void {
        for (const { eventBus, event, handler } of this.subscriptions) {
            eventBus.off(event, handler);
        }
        this.subscriptions = [];
    }

    /**
     * Get the number of active subscriptions.
     * Useful for testing/debugging.
     */
    get count(): number {
        return this.subscriptions.length;
    }
}
