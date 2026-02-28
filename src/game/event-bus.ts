/**
 * Lightweight typed event bus for decoupling game systems.
 * Features register event handlers instead of being called directly.
 *
 * Error isolation: Handlers that throw are caught and logged with throttling.
 * One bad handler won't crash the loop or prevent other handlers from running.
 */

import type { BuildingType } from './buildings/types';
import type { BuildingState } from './features/building-construction';
import type { UnitType } from './unit-types';
import type { EntityType } from './entity';
import type { EMaterialType } from './economy';
import { LogHandler } from '@/utilities/log-handler';
import { ThrottledLogger } from '@/utilities/throttled-logger';
import { toastError } from './toast-notifications';

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
        buildingState: BuildingState;
    };
    /** Emitted when a building is removed/cancelled */
    'building:removed': {
        entityId: number;
        buildingState: BuildingState;
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

    // === Carrier Events ===

    /** Emitted when a carrier is registered with a tavern */
    'carrier:created': {
        entityId: number;
        homeBuilding: number;
    };

    /** Emitted when a carrier is removed from the system */
    'carrier:removed': {
        entityId: number;
        homeBuilding: number;
        /** True if carrier was removed while on a job */
        hadActiveJob: boolean;
    };

    /** Emitted when a carrier's status changes */
    'carrier:statusChanged': {
        entityId: number;
        previousStatus: number;
        newStatus: number;
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

    /** Emitted when a carrier arrives at their home tavern */
    'carrier:arrivedHome': {
        entityId: number;
        homeBuilding: number;
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

    /** Emitted when a carrier returns to their home tavern and becomes idle/resting */
    'carrier:returnedHome': {
        entityId: number;
        homeBuilding: number;
    };

    /** Emitted when carrier assignment fails (no carrier, reservation failed, or movement failed) */
    'carrier:assignmentFailed': {
        requestId: number;
        reason: 'no_carrier' | 'reservation_failed' | 'movement_failed';
        sourceBuilding: number;
        destBuilding: number;
        material: EMaterialType;
        carrierId?: number;
    };

    // === Logistics Events ===

    /** Emitted when logistics cleanup completes after a building is destroyed */
    'logistics:buildingCleanedUp': {
        buildingId: number;
        requestsCancelled: number;
        jobsCancelled: number;
    };

    /** Emitted when a new resource request is created */
    'request:created': {
        requestId: number;
        buildingId: number;
        materialType: EMaterialType;
        amount: number;
        /** RequestPriority enum value (0=High, 1=Normal, 2=Low) */
        priority: number;
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
}

type EventHandler<T> = (payload: T) => void;

const log = new LogHandler('EventBus');

export class EventBus {
    private handlers = new Map<string, Set<EventHandler<any>>>();

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
            try {
                handler(payload);
            } catch (e) {
                const err = e instanceof Error ? e : new Error(String(e));
                const logged = this.getErrorLogger(event as string).error(
                    `Handler for '${event as string}' threw`,
                    err
                );
                // Toast on first failure (when throttle allows logging)
                if (logged) {
                    toastError('EventBus', `${event as string}: ${err.message}`);
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
