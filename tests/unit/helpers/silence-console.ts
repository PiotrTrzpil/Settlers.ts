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

let writer: ConsoleLogWriter | undefined;
let hintPrinted = false;

beforeEach(ctx => {
    const testId = ctx.task.file?.name ? `${ctx.task.file.name} > ${ctx.task.name}` : ctx.task.name;

    writer = new ConsoleLogWriter(testId);

    onTestFailed(() => {
        if (hintPrinted) return;
        hintPrinted = true;
        const runId = process.env['TIMELINE_RUN_ID'];
        const dbPath = runId ? `tests/unit/.timeline/run_${runId}.db` : '(unknown)';
        origStderrWrite(`\n  Console output & timeline: ${dbPath}\n`);
        origStderrWrite(`  Query: pnpm timeline -- --db ${dbPath} --console\n\n`);
    });

    for (const m of CONSOLE_METHODS) {
        console[m] = (...args: unknown[]) => {
            writer!.record(m, args);
        };
    }

    process.stdout.write = ((chunk: string | Uint8Array, ...rest: unknown[]) => {
        const text = typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString();
        if (text.trim()) writer!.record('log', [text.trimEnd()]);
        if (typeof rest[rest.length - 1] === 'function') (rest[rest.length - 1] as () => void)();
        return true;
    }) as typeof process.stdout.write;

    process.stderr.write = ((chunk: string | Uint8Array, ...rest: unknown[]) => {
        const text = typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString();
        if (text.trim()) writer!.record('error', [text.trimEnd()]);
        if (typeof rest[rest.length - 1] === 'function') (rest[rest.length - 1] as () => void)();
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
