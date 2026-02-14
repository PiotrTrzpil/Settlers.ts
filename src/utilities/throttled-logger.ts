import { LogHandler } from './log-handler';

/**
 * Throttled error logger that prevents console flooding.
 *
 * When errors fire every frame (e.g. a broken render layer or tick system),
 * this logger emits at most one log entry per `throttleMs` and reports how
 * many identical errors were suppressed in between.
 *
 * Usage:
 *   const tl = new ThrottledLogger(log, 1000);
 *   // hot path — call as often as you like
 *   tl.error('Layer "Landscape" failed', err);
 */
export class ThrottledLogger {
    private lastTime = 0;
    private suppressed = 0;

    constructor(
        private readonly log: LogHandler,
        private readonly throttleMs: number
    ) {}

    /**
     * Log an error if enough time has passed since the last one.
     * Returns `true` when the message was actually logged,
     * `false` when it was suppressed (caller can use this to decide
     * whether to fire a toast or other one-shot action).
     */
    error(message: string, error: Error): boolean {
        const now = performance.now();
        if (now - this.lastTime < this.throttleMs) {
            this.suppressed++;
            return false;
        }

        if (this.suppressed > 0) {
            this.log.error(`${message} (${this.suppressed} similar suppressed)`, error);
            this.suppressed = 0;
        } else {
            this.log.error(message, error);
        }
        this.lastTime = now;
        return true;
    }
}
