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

export class LogManager {
    public log: ILogMessage[] = [];
    private logMsgCount = 0;
    private listener: LogMessageCallback | null = null;

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

        // write out to console
        if (typeof msg.msg !== 'string') {
            console.dir(msg.msg);
        } else {
            const formatted = msg.source + '\t' + msg.msg;
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
