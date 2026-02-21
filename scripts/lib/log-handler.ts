/** Minimal log handler for scripts */
export class LogHandler {
    constructor(private name: string) {}

    debug(..._args: unknown[]): void {
        // Silent by default
    }

    log(...args: unknown[]): void {
        console.log(`[${this.name}]`, ...args);
    }

    error(...args: unknown[]): void {
        console.error(`[${this.name}]`, ...args);
    }
}
