/**
 * IntervalDrain — tick-interval gate for drain loops (building-demand, construction demands).
 */

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
