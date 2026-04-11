import type { TickSystem } from '../core/tick-system';
import { TICK_RATE } from '../core/tick-rate';

/** Opaque handle returned by schedule(), used for cancellation. */
// eslint-disable-next-line sonarjs/redundant-type-aliases -- intentional opaque alias for readability
export type ScheduleHandle = number;

/** Sentinel value for "no scheduled callback". */
export const NO_HANDLE: ScheduleHandle = 0;

interface PendingEntry {
    handle: ScheduleHandle;
    targetTick: number;
    callback: () => void;
}

/**
 * Game-speed-aware deferred callback system.
 *
 * Advances by `dt * TICK_RATE` each tick, so delays scale with game speed
 * (dt already includes BASE_SPEED × gameSpeed from the game loop).
 * Systems schedule work N ticks in the future; the scheduler drains
 * due callbacks each tick with zero cost for sleeping entries.
 */
export class TickScheduler implements TickSystem {
    private _currentTick = 0;
    private nextHandle: ScheduleHandle = 1;
    /** Sorted ascending by targetTick. Entries with equal targetTick preserve insertion order. */
    private readonly pending: PendingEntry[] = [];
    private readonly cancelled = new Set<ScheduleHandle>();
    /** Callbacks to run on the very next real tick, regardless of game speed. */
    private deferred: Array<() => void> = [];

    /**
     * Defer a callback to the next real tick, independent of game speed.
     * Use for technical deferral (avoiding re-entrancy), not gameplay delays.
     */
    deferNextTick(callback: () => void): void {
        this.deferred.push(callback);
    }

    /** Schedule a callback to fire after `delayTicks` game-speed-scaled ticks (minimum 1). */
    schedule(delayTicks: number, callback: () => void): ScheduleHandle {
        if (delayTicks < 1) {
            throw new Error(`TickScheduler.schedule: delayTicks must be >= 1, got ${delayTicks}`);
        }
        const handle = this.nextHandle++;
        const targetTick = this._currentTick + delayTicks;
        // Binary search for insertion point (stable: insert after equal targetTicks)
        let lo = 0;
        let hi = this.pending.length;
        while (lo < hi) {
            const mid = (lo + hi) >>> 1;
            if (this.pending[mid]!.targetTick <= targetTick) {
                lo = mid + 1;
            } else {
                hi = mid;
            }
        }
        this.pending.splice(lo, 0, { handle, targetTick, callback });
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
        return this.pending.some(e => e.handle === handle);
    }

    /** Current game-speed-scaled tick count (for debugging / diagnostics). */
    get currentTick(): number {
        return this._currentTick;
    }

    // TickSystem
    tick(dt: number): void {
        // Drain deferred callbacks first (independent of game speed)
        if (this.deferred.length > 0) {
            const batch = this.deferred;
            this.deferred = [];
            for (const cb of batch) {
                try {
                    cb();
                } catch (e) {
                    console.error('TickScheduler: deferred callback threw:', e);
                }
            }
        }

        this._currentTick += dt * TICK_RATE;

        // Drain all due entries from the front of the sorted array
        let drained = 0;
        while (drained < this.pending.length && this.pending[drained]!.targetTick <= this._currentTick) {
            const entry = this.pending[drained]!;
            drained++;
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
        if (drained > 0) {
            this.pending.splice(0, drained);
        }
    }

    destroy(): void {
        this.pending.length = 0;
        this.deferred = [];
        this.cancelled.clear();
        this._currentTick = 0;
        this.nextHandle = 1;
    }
}
