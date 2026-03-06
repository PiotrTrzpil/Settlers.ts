/**
 * PeriodicTimer
 *
 * Accumulates elapsed time and fires when an interval elapses.
 * Extracts the repeated "timeSince += dt; if >= interval: reset" pattern
 * used by StallDetector, MatchDiagnostics, and similar periodic checks.
 */
export class PeriodicTimer {
    private accumulated = 0;

    constructor(private readonly intervalSec: number) {}

    /**
     * Advance the timer by `dt` seconds.
     * Returns `true` if the interval has elapsed (and resets the accumulator).
     */
    advance(dt: number): boolean {
        this.accumulated += dt;
        if (this.accumulated >= this.intervalSec) {
            this.accumulated = 0;
            return true;
        }
        return false;
    }
}
