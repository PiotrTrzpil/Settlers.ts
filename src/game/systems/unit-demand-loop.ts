/**
 * Shared helpers for unit-demand systems (building workers, construction diggers/builders).
 *
 * IntervalDrain: tick-interval gate for drain loops.
 * UnitDemandJobHandlers: job-complete/fail routing by JobKind + committed unit.
 */

import type { JobKind } from './choreo/types';

/** Accumulates dt and returns true when a drain cycle should run. */
export class IntervalDrain {
    private acc = 0;

    constructor(private readonly intervalSec: number) {}

    /** Advance by dt; returns true once per interval. */
    tick(dt: number): boolean {
        this.acc += dt;
        if (this.acc < this.intervalSec) {
            return false;
        }
        this.acc -= this.intervalSec;
        return true;
    }
}

/**
 * Callbacks for settler:taskCompleted / settler:taskFailed routing on unit demands.
 * Systems keep their demand maps; this matches JobKind (not magic string jobIds).
 */
export interface UnitDemandJobHandlers<T> {
    /** True if this demand system owns the completed/failed job's domain kind. */
    ownsKind(kind: JobKind): boolean;
    /** Find the demand committed to this unit, if any. */
    findByUnit(unitId: number): T | undefined;
    onJobCompleted(demand: T, unitId: number): void;
    onJobFailed(demand: T, unitId: number): void;
}

/** Handle settler:taskCompleted for a demand system. */
export function handleDemandJobCompleted<T>(handlers: UnitDemandJobHandlers<T>, unitId: number, kind: JobKind): void {
    if (!handlers.ownsKind(kind)) {
        return;
    }
    const demand = handlers.findByUnit(unitId);
    if (demand) {
        handlers.onJobCompleted(demand, unitId);
    }
}

/** Handle settler:taskFailed for a demand system. */
export function handleDemandJobFailed<T>(handlers: UnitDemandJobHandlers<T>, unitId: number, kind: JobKind): void {
    if (!handlers.ownsKind(kind)) {
        return;
    }
    const demand = handlers.findByUnit(unitId);
    if (demand) {
        handlers.onJobFailed(demand, unitId);
    }
}
