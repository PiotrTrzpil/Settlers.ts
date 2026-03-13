/**
 * UnitReservationRegistry — tracks units that are committed to a feature-managed task
 * and must not be interrupted by player move commands.
 *
 * Features (barracks training, auto-recruit, tower garrison) reserve units when they
 * begin a committed task. The move command handlers check this registry before moving.
 *
 * ## Lifecycle
 *
 * 1. `reserve(unitId, { purpose, onForcedRelease? })` — lock the unit at commitment time.
 * 2. `release(unitId)` — unlock on normal completion or manual cancellation.
 * 3. If the unit entity is removed while still reserved (e.g. killed en-route), the registry
 *    auto-releases it and invokes `onForcedRelease` so the feature can clean up its own state.
 *    Features do NOT need a separate `entity:removed` handler for reservation cleanup.
 *
 * ## Purpose field
 *
 * Every reservation carries a `purpose` string (e.g. `'barracks-training'`, `'auto-recruit'`,
 * `'garrison-en-route'`, `'garrison'`). `getAll()` exposes the full map for diagnostics/debug.
 *
 * ## Event ordering
 *
 * `UnitReservationRegistry` subscribes to `entity:removed` in its constructor, which must be
 * called before `EntityCleanupRegistry.registerEvents()`. This guarantees that `onForcedRelease`
 * fires before any feature-level `cleanupRegistry.onEntityRemoved` handler — so by the time
 * those handlers run, reservation state is already clean.
 */

import type { EventBus } from '../event-bus';
import { EventSubscriptionManager } from '../event-bus';

export interface ReservationInfo {
    /** Debug label identifying why this unit is reserved. Shown in the diagnostics panel. */
    purpose: string;

    /**
     * Called when the unit entity is forcibly removed (e.g. killed) while still reserved.
     * The reservation is cleared before this callback fires — do NOT call `release()` inside it.
     * Use this to clean up feature-specific in-flight state (active trainings, en-route maps, etc.).
     */
    onForcedRelease?: (unitId: number) => void;
}

export class UnitReservationRegistry {
    private readonly reservations = new Map<number, ReservationInfo>();
    private readonly subscriptions = new EventSubscriptionManager();

    constructor(eventBus: EventBus) {
        this.subscriptions.subscribe(eventBus, 'entity:removed', ({ entityId }) => {
            const info = this.reservations.get(entityId);
            if (!info) {
                return;
            }
            this.reservations.delete(entityId);
            info.onForcedRelease?.(entityId);
        });
    }

    /**
     * Reserve a unit, preventing player move commands from interrupting it.
     * Call immediately when the feature commits the unit to a task.
     */
    reserve(unitId: number, info: ReservationInfo): void {
        this.reservations.set(unitId, info);
    }

    /**
     * Release a unit on normal task completion or manual cancellation.
     * Do NOT call this inside `onForcedRelease` — the registry already cleared it.
     */
    release(unitId: number): void {
        this.reservations.delete(unitId);
    }

    /**
     * Atomically replace the reservation info for an already-reserved unit.
     * Use when transitioning between purposes (e.g. garrison-en-route → garrison)
     * to avoid the momentary unreserved gap of a release + reserve pair.
     */
    updateReservation(unitId: number, info: ReservationInfo): void {
        this.reservations.set(unitId, info);
    }

    isReserved(unitId: number): boolean {
        return this.reservations.has(unitId);
    }

    /** All active reservations, keyed by unit ID. Read-only — for diagnostics only. */
    getAll(): ReadonlyMap<number, Readonly<ReservationInfo>> {
        return this.reservations;
    }
}
