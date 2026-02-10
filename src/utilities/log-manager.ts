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
            const formatted = msg.source + '\t' + msg.msg + suppressedNote;
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

        if (msg.exception) {
            console.error(msg.source + '\t' + msg.exception.message);
        }
    }
}
