/**
 * EntityCleanupRegistry — centralizes entity:removed cleanup across all features and systems.
 *
 * Problem it solves:
 * Multiple features/systems independently subscribed to `entity:removed` with nearly identical
 * patterns. This made cleanup order implicit (first-registered = first-called) and scattered
 * across 10+ files.
 *
 * Design:
 * - A single `entity:removed` subscription drives all cleanup.
 * - Features register callbacks with an optional numeric priority (lower = earlier).
 * - Handlers at the same priority run in registration order (stable).
 *
 * Priority constants are exported so callers use named values, not magic numbers.
 * See {@link CLEANUP_PRIORITY} for the full removal order.
 *
 * Usage:
 * ```ts
 * cleanupRegistry.onEntityRemoved(entityId => this.myMap.delete(entityId));
 * cleanupRegistry.onEntityRemoved(entityId => this.inventoryManager.removeInventory(entityId), CLEANUP_PRIORITY.LATE);
 * ```
 */

import type { Entity } from '../entity';
import { type EventBus, EventSubscriptionManager } from '../event-bus';
import { createLogger } from '@/utilities/logger';

const log = createLogger('EntityCleanupRegistry');

// ─────────────────────────────────────────────────────────────
// Priority constants
// ─────────────────────────────────────────────────────────────

/**
 * Named priority levels for entity cleanup order. Lower numbers execute first; handlers with
 * equal priority run in registration order (GameServices kernel handlers, then feature load order).
 *
 * Full order of work on `entity:removed`:
 *  1. RESERVATIONS — `UnitReservationRegistry` drops the unit's reservation and fires its
 *     `onForcedRelease` callback, so every later handler sees clean reservation state.
 *  2. EARLY        — material-transfer drops a removed carrier's carried material as a free pile.
 *  3. DEFAULT      — all general cleanup: map-object blocking, movement controller, feature state
 *     (buildings, overlays, carriers, settler locations, …), visual state and pile slots.
 *  4. LOGISTICS    — logistics dispatcher cancels transport jobs / releases inventory reservations
 *     for a destroyed building (inventory data must still exist).
 *  5. LATE         — `BuildingInventoryManager.destroySlots` removes the entity's inventory.
 *
 * Afterwards (separate `entity:removed` bus subscription made by `Game` after GameServices is
 * built), `GameLoop.notifyEntityRemoved` calls `TickSystem.onEntityRemoved` in tick order.
 */
export const CLEANUP_PRIORITY = {
    /** Reservation release — runs before every other handler (see UnitReservationRegistry) */
    RESERVATIONS: -100,

    /** Early cleanup — for handlers that other systems depend on having run first */
    EARLY: 0,

    /** Default priority — general cleanup (building state, overlays, carrier state, etc.) */
    DEFAULT: 100,

    /**
     * Logistics priority — must cancel transport jobs and release inventory reservations
     * before inventory data is removed.
     */
    LOGISTICS: 200,

    /**
     * Late priority — runs after all DEFAULT and LOGISTICS handlers.
     * Use for inventory removal (must happen after logistics reservation release).
     */
    LATE: 300,
} as const;

export type CleanupPriority = (typeof CLEANUP_PRIORITY)[keyof typeof CLEANUP_PRIORITY];

// ─────────────────────────────────────────────────────────────
// Registry
// ─────────────────────────────────────────────────────────────

/** A cleanup handler for a specific entity removal event. */
type EntityCleanupHandler = (entityId: number, entity: Entity) => void;

interface RegisteredHandler {
    priority: number;
    handler: EntityCleanupHandler;
}

/**
 * Central registry for entity cleanup.
 * Maintains a single `entity:removed` subscription and dispatches to all registered handlers
 * in priority order.
 */
export class EntityCleanupRegistry {
    private readonly handlers: RegisteredHandler[] = [];
    private readonly subscriptions = new EventSubscriptionManager();

    /**
     * Register a cleanup handler to run when any entity is removed.
     *
     * @param handler - Function called with the removed entity ID
     * @param priority - Execution order (lower = earlier). Defaults to CLEANUP_PRIORITY.DEFAULT
     */
    onEntityRemoved(handler: EntityCleanupHandler, priority: number = CLEANUP_PRIORITY.DEFAULT): void {
        this.handlers.push({ priority, handler });
    }

    /**
     * Subscribe to the event bus and begin dispatching cleanup on entity removal.
     * Call once during system initialization.
     */
    registerEvents(eventBus: EventBus): void {
        // Sort handlers by priority (stable — insertion order preserved for equal priorities)
        this.handlers.sort((a, b) => a.priority - b.priority);

        this.subscriptions.subscribe(eventBus, 'entity:removed', ({ entityId, entity }) => {
            for (const { handler } of this.handlers) {
                try {
                    handler(entityId, entity);
                } catch (e) {
                    // Cleanup handlers must not abort each other — log and continue.
                    // This mirrors the EventBus's own per-handler isolation.
                    log.error(
                        `Cleanup handler for entity ${entityId} threw:`,
                        e instanceof Error ? e : new Error(String(e))
                    );
                }
            }
        });
    }

    /**
     * Unsubscribe from the event bus. Cleanup handlers remain registered (can re-subscribe).
     */
    unregisterEvents(): void {
        this.subscriptions.unsubscribeAll();
    }

    /**
     * Unsubscribe from the event bus and clear all registered handlers.
     * Call on game destruction to prevent handler accumulation across game restarts.
     */
    destroy(): void {
        this.subscriptions.unsubscribeAll();
        this.handlers.length = 0;
    }
}
