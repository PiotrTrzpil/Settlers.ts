import { LogHandler } from './log-handler';

/**
 * Throttled logger that prevents console flooding.
 *
 * When errors/warnings fire every frame (e.g. a broken render layer or tick system),
 * this logger emits at most one log entry per `throttleMs` and reports how
 * many identical messages were suppressed in between.
 *
 * Usage:
 *   const tl = new ThrottledLogger(log, 1000);
 *   // hot path — call as often as you like
 *   tl.error('Layer "Landscape" failed', err);
 *   tl.warn('Feature not implemented');
 */
export class ThrottledLogger {
    private lastTime = 0;
    private suppressed = 0;

    constructor(
        private readonly log: LogHandler,
        private readonly throttleMs: number
    ) {}

    /**
     * Check if throttling allows a log, update state, and return formatted message.
     * Returns null if suppressed, otherwise the message (with suppression count if any).
     */
    private shouldLog(message: string): string | null {
        const now = performance.now();
        if (now - this.lastTime < this.throttleMs) {
            this.suppressed++;
            return null;
        }

        this.lastTime = now;
        if (this.suppressed > 0) {
            const result = `${message} (${this.suppressed} similar suppressed)`;
            this.suppressed = 0;
            return result;
        }
        return message;
    }

    /**
     * Log an error if enough time has passed since the last one.
     * Returns `true` when the message was actually logged,
     * `false` when it was suppressed (caller can use this to decide
     * whether to fire a toast or other one-shot action).
     */
    error(message: string, error: Error): boolean {
        const finalMessage = this.shouldLog(message);
        if (finalMessage === null) return false;
        this.log.error(finalMessage, error);
        return true;
    }

    /**
     * Log a warning if enough time has passed since the last one.
     * Same throttling behavior as error() but for non-fatal issues.
     */
    warn(message: string): boolean {
        const finalMessage = this.shouldLog(message);
        if (finalMessage === null) return false;
        this.log.warn(finalMessage);
        return true;
    }
}
