import type { TickSystem } from '../core/tick-system';

/** Opaque handle returned by schedule(), used for cancellation. */
// eslint-disable-next-line sonarjs/redundant-type-aliases -- intentional opaque alias for readability
export type ScheduleHandle = number;

/** Sentinel value for "no scheduled callback". */
export const NO_HANDLE: ScheduleHandle = 0;

interface ScheduledEntry {
    handle: ScheduleHandle;
    callback: () => void;
}

/**
 * Priority-queue-based deferred callback system.
 * Systems schedule work N ticks in the future; the scheduler drains
 * due callbacks each tick with zero cost for sleeping entries.
 */
export class TickScheduler implements TickSystem {
    private _currentTick = 0;
    private nextHandle: ScheduleHandle = 1;
    private readonly queue = new Map<number, ScheduledEntry[]>();
    private readonly cancelled = new Set<ScheduleHandle>();

    /** Schedule a callback to fire after `delayTicks` ticks (minimum 1). */
    schedule(delayTicks: number, callback: () => void): ScheduleHandle {
        if (delayTicks < 1) {
            throw new Error(`TickScheduler.schedule: delayTicks must be >= 1, got ${delayTicks}`);
        }
        const handle = this.nextHandle++;
        const targetTick = this._currentTick + delayTicks;
        let bucket = this.queue.get(targetTick);
        if (!bucket) {
            bucket = [];
            this.queue.set(targetTick, bucket);
        }
        bucket.push({ handle, callback });
        return handle;
    }

    /** Cancel a pending callback. No-op if already fired or invalid handle. */
    cancel(handle: ScheduleHandle): void {
        if (handle === NO_HANDLE) {
            return;
        }
        this.cancelled.add(handle);
    }

    /** Returns true if the handle refers to a still-pending callback. */
    isPending(handle: ScheduleHandle): boolean {
        if (handle === NO_HANDLE) {
            return false;
        }
        if (this.cancelled.has(handle)) {
            return false;
        }
        // Search for the handle in future buckets
        for (const [tick, bucket] of this.queue) {
            if (tick <= this._currentTick) {
                continue;
            }
            for (const entry of bucket) {
                if (entry.handle === handle) {
                    return true;
                }
            }
        }
        return false;
    }

    /** Current monotonic tick count (for debugging / diagnostics). */
    get currentTick(): number {
        return this._currentTick;
    }

    // TickSystem
    tick(_dt: number): void {
        this._currentTick++;
        const bucket = this.queue.get(this._currentTick);
        if (!bucket) {
            return;
        }
        this.queue.delete(this._currentTick);

        for (const entry of bucket) {
            if (this.cancelled.has(entry.handle)) {
                this.cancelled.delete(entry.handle);
                continue;
            }
            try {
                entry.callback();
            } catch (e) {
                console.error(`TickScheduler: callback for handle ${entry.handle} threw:`, e);
            }
        }
    }

    destroy(): void {
        this.queue.clear();
        this.cancelled.clear();
        this._currentTick = 0;
        this.nextHandle = 1;
    }
}
