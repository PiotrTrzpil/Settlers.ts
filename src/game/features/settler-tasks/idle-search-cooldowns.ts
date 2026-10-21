/**
 * Idle-search cooldowns — the single mechanism that decides when an idle unit may
 * search for work again (`UnitRuntime.idleSearchReady`).
 *
 * Every delay is a TickScheduler callback tracked per unit, so all pending
 * cooldowns of a unit are cancelled when it is removed.
 */

import type { TickScheduler, ScheduleHandle } from '../../systems/tick-scheduler';
import { seconds } from '../../core/tick-rate';
import type { UnitRuntime } from './unit-runtime';

/** Ticks between idle work searches when no work is found (also the spawn stagger modulus). */
export const IDLE_SEARCH_COOLDOWN = 10;

/** Ticks to rest after completing a job before searching for new work (home-building workers). */
export const POST_JOB_REST_TICKS = seconds(5);

/** First-search delay of a newly registered unit — staggers searches across ticks by entity id. */
export function initialSearchStagger(entityId: number): number {
    return Math.max(1, entityId % IDLE_SEARCH_COOLDOWN);
}

export class IdleSearchCooldowns {
    /** Pending cooldown handles per unit (a unit may have several in flight, e.g. stagger + rest). */
    private readonly pending = new Map<number, ScheduleHandle[]>();

    constructor(private readonly tickScheduler: TickScheduler) {}

    /**
     * Mark the unit not ready and make it ready again after `delay` ticks.
     * Pending cooldowns of the same unit are kept — each one marks the unit ready when it fires.
     */
    start(entityId: number, runtime: UnitRuntime, delay: number): void {
        runtime.idleSearchReady = false;
        const handle: ScheduleHandle = this.tickScheduler.schedule(delay, () =>
            this.onElapsed(entityId, handle, runtime)
        );
        let handles = this.pending.get(entityId);
        if (!handles) {
            handles = [];
            this.pending.set(entityId, handles);
        }
        handles.push(handle);
    }

    /** Cancel every pending cooldown of a removed unit. */
    cancelAll(entityId: number): void {
        const handles = this.pending.get(entityId);
        if (!handles) {
            return;
        }
        for (const handle of handles) {
            this.tickScheduler.cancel(handle);
        }
        this.pending.delete(entityId);
    }

    /** Cancel all pending cooldowns (system teardown). */
    destroy(): void {
        for (const handles of this.pending.values()) {
            for (const handle of handles) {
                this.tickScheduler.cancel(handle);
            }
        }
        this.pending.clear();
    }

    private onElapsed(entityId: number, handle: ScheduleHandle, runtime: UnitRuntime): void {
        runtime.idleSearchReady = true;
        const handles = this.pending.get(entityId)!;
        handles.splice(handles.indexOf(handle), 1);
        if (handles.length === 0) {
            this.pending.delete(entityId);
        }
    }
}
