/**
 * Vitest setup file: captures all console output during tests and writes
 * it to the timeline SQLite DB (console_log table) instead of stdout.
 *
 * Also intercepts raw process.stdout/stderr.write to catch output that
 * bypasses console.* (e.g. loglevel, stack traces).
 *
 * Query captured output with:
 *   pnpm timeline -- --console               # console from auto-picked test
 *   pnpm timeline -- --console --test <id>    # specific test
 *   pnpm timeline -- --console --level error  # only console.error
 */
import { beforeEach, afterEach, onTestFailed } from 'vitest';
import { ConsoleLogWriter } from './console-log-store';

const CONSOLE_METHODS = ['log', 'warn', 'info', 'debug', 'error'] as const;
type ConsoleMethod = (typeof CONSOLE_METHODS)[number];

// Save originals once at module load
const origConsole = {} as Record<ConsoleMethod, (...args: unknown[]) => void>;
for (const m of CONSOLE_METHODS) {
    origConsole[m] = console[m];
}
const origStdoutWrite = process.stdout.write.bind(process.stdout);
const origStderrWrite = process.stderr.write.bind(process.stderr);

/**
 * When DEBUG_CONSOLE=1, console output is both captured to timeline DB
 * AND passed through to the terminal. This makes `console.log` debugging
 * work as expected without needing to query the timeline DB.
 */
const passThrough = process.env['DEBUG_CONSOLE'] === '1';

let writer: ConsoleLogWriter | undefined;
let hintPrinted = false;

/**
 * Link the current console capture session to a simulation test_id.
 * Called by Simulation constructor so `--console --test sim_xxx` works.
 */
export function linkConsoleToSimulation(simTestId: string): void {
    writer?.addAlias(simTestId);
}

beforeEach(ctx => {
    const testId = ctx.task.file?.name ? `${ctx.task.file.name} > ${ctx.task.name}` : ctx.task.name;

    writer = new ConsoleLogWriter(testId);

    onTestFailed(() => {
        if (hintPrinted) return;
        hintPrinted = true;
        const runId = process.env['TIMELINE_RUN_ID'];
        const dbPath = runId ? `output/timeline/unit/run_${runId}.db` : '(unknown)';
        origStderrWrite(`\n  Console output & timeline: ${dbPath}\n`);
        origStderrWrite(`  Query: pnpm timeline -- --db ${dbPath} --console\n\n`);
    });

    for (const m of CONSOLE_METHODS) {
        console[m] = (...args: unknown[]) => {
            writer!.record(m, args);
            if (passThrough) origConsole[m](...args);
        };
    }

    process.stdout.write = ((
        chunk: string | Uint8Array,
        encoding?: BufferEncoding | ((err?: Error | null) => void),
        cb?: (err?: Error | null) => void
    ) => {
        const text = typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString();
        if (text.trim()) writer!.record('log', [text.trimEnd()]);
        if (passThrough) origStdoutWrite(chunk, encoding as BufferEncoding, cb);
        else if (typeof cb === 'function') cb();
        else if (typeof encoding === 'function') encoding();
        return true;
    }) as typeof process.stdout.write;

    process.stderr.write = ((
        chunk: string | Uint8Array,
        encoding?: BufferEncoding | ((err?: Error | null) => void),
        cb?: (err?: Error | null) => void
    ) => {
        const text = typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString();
        if (text.trim()) writer!.record('error', [text.trimEnd()]);
        if (passThrough) origStderrWrite(chunk, encoding as BufferEncoding, cb);
        else if (typeof cb === 'function') cb();
        else if (typeof encoding === 'function') encoding();
        return true;
    }) as typeof process.stderr.write;
});

afterEach(() => {
    // Restore everything
    for (const m of CONSOLE_METHODS) {
        console[m] = origConsole[m];
    }
    process.stdout.write = origStdoutWrite;
    process.stderr.write = origStderrWrite;

    if (writer) {
        writer.flush();
        writer = undefined;
    }
});
