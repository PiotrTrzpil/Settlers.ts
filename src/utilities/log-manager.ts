export enum LogType {
    Error,
    Debug,
    Warn,
    Info
}

export interface ILogMessage {
    type: LogType;
    source: string;
    msg: string | any;
    exception?: Error;
    index?: number;
}

export type LogMessageCallback = ((msg: ILogMessage) => void);

/** Minimum interval between identical log messages (in ms) */
const LOG_THROTTLE_MS = 1000;

/**
 * Patterns that indicate async boundaries where we should truncate the stack.
 * These are browser-internal async scheduling points that add noise.
 */
const ASYNC_BOUNDARY_PATTERNS = [
    /requestAnimationFrame/,
    /setTimeout/,
    /setInterval/,
    /Promise\.then/,
    /async function/,
    /MutationObserver/,
];

/**
 * Clean up stack traces by:
 * 1. Truncating at async boundaries (requestAnimationFrame, setTimeout, etc.)
 * 2. Removing repeated consecutive frames
 * @param stack The stack trace string
 * @returns Cleaned stack trace
 */
function cleanStackTrace(stack: string): string {
    const lines = stack.split('\n');
    const result: string[] = [];
    let asyncFrameCount = 0;

    for (const line of lines) {
        const trimmed = line.trim();

        // Check if this line is an async boundary
        const isAsyncBoundary = ASYNC_BOUNDARY_PATTERNS.some(p => p.test(trimmed));

        if (isAsyncBoundary) {
            asyncFrameCount++;
            // Keep the first async boundary for context, truncate the rest
            if (asyncFrameCount === 1) {
                result.push(line);
                result.push('    ... (async stack truncated)');
            }
            break;
        }

        result.push(line);
    }

    return result.join('\n');
}

export class LogManager {
    public log: ILogMessage[] = [];
    private logMsgCount = 0;
    private listener: LogMessageCallback | null = null;

    /** Throttle state: source+msg -> { lastTime, suppressedCount } */
    private throttleState = new Map<string, { lastTime: number; suppressedCount: number }>();

    public onLogMessage(callback: LogMessageCallback | null): void {
        this.listener = callback;

        if (!callback) {
            return;
        }

        // send old messages
        for (const msg of this.log) {
            callback(msg);
        }
    }

    public push(msg: ILogMessage): void {
        msg.index = this.logMsgCount++;

        // save message to log
        this.log.push(msg);
        if (this.log.length > 100) {
            this.log.shift();
        }

        // publish to listener
        if (this.listener) {
            this.listener(msg);
        }

        // Check throttle for console output
        const msgStr = typeof msg.msg === 'string' ? msg.msg : JSON.stringify(msg.msg);
        const throttleKey = `${msg.source}:${msg.type}:${msgStr}`;
        const now = performance.now();
        const state = this.throttleState.get(throttleKey);

        if (state && now - state.lastTime < LOG_THROTTLE_MS) {
            // Throttled - just count
            state.suppressedCount++;
            return;
        }

        // Not throttled - log to console
        const suppressedNote = state && state.suppressedCount > 0
            ? ` (${state.suppressedCount} similar suppressed)`
            : '';

        // Reset or create throttle state
        this.throttleState.set(throttleKey, { lastTime: now, suppressedCount: 0 });

        // write out to console
        if (typeof msg.msg !== 'string') {
            console.dir(msg.msg);
        } else {
            // Build complete message including exception details to avoid multiple console calls
            // (each console.error triggers Chrome to show async stack traces)
            let formatted = msg.source + '\t' + msg.msg + suppressedNote;

            if (msg.exception) {
                formatted += '\n' + msg.exception.message;
                if (msg.exception.stack) {
                    formatted += '\n' + cleanStackTrace(msg.exception.stack);
                }
            }

            switch (msg.type) {
            case LogType.Error:
                console.error(formatted);
                break;
            case LogType.Warn:
                console.warn(formatted);
                break;
            case LogType.Info:
                console.info(formatted);
                break;
            case LogType.Debug:
                console.log(formatted);
                break;
            }
        }
    }
}
