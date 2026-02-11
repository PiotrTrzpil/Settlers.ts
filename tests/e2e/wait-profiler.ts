/**
 * Wait Profiler for E2E Tests
 *
 * Instruments all wait operations to identify bottlenecks and optimize test performance.
 *
 * ## Usage
 *
 * The profiler is automatically integrated with GamePage. To view results:
 *
 *   // In a test or afterAll hook:
 *   console.log(WaitProfiler.getSummary());
 *
 *   // Or get raw data:
 *   const records = WaitProfiler.getRecords();
 *
 * ## Environment Variables
 *
 *   WAIT_PROFILER=0          Disable profiling (enabled by default)
 *   WAIT_PROFILER_VERBOSE=1  Log each wait as it completes
 *
 * ## Categories
 *
 * - frame: waitForFrames, waitForReady - render loop sync
 * - state: waitForUnitCount, waitForBuildingCount - debug bridge polling
 * - movement: waitForUnitAtDestination, waitForUnitToMove - position tracking
 * - render: waitForMode, moveCamera - visual state changes
 * - audio: unlockAudio, toggleMusic - audio subsystem
 * - dom: waitForGameUi - DOM element visibility
 */

export type WaitCategory = 'frame' | 'state' | 'movement' | 'render' | 'audio' | 'dom';

export interface WaitRecord {
    /** Category of wait operation */
    category: WaitCategory;
    /** Method name that initiated the wait */
    method: string;
    /** What condition we're waiting for */
    condition: string;
    /** Start timestamp (performance.now) */
    startTime: number;
    /** End timestamp (performance.now) */
    endTime: number;
    /** Total duration in milliseconds */
    duration: number;
    /** Number of poll iterations (for polling waits) */
    pollCount: number;
    /** Whether the wait timed out */
    timedOut: boolean;
    /** Configured timeout value */
    timeout: number;
    /** Test file that initiated the wait (if available) */
    testFile?: string;
    /** Additional context (expected value, actual value, etc.) */
    context?: Record<string, unknown>;
}

export interface WaitSummary {
    /** Total number of waits recorded */
    totalWaits: number;
    /** Total time spent waiting (ms) */
    totalDuration: number;
    /** Waits that timed out */
    timedOutCount: number;
    /** Breakdown by category */
    byCategory: Record<WaitCategory, CategorySummary>;
    /** Top 10 slowest individual waits */
    slowestWaits: WaitRecord[];
    /** Methods with highest aggregate wait time */
    byMethod: MethodSummary[];
}

export interface CategorySummary {
    count: number;
    totalDuration: number;
    avgDuration: number;
    maxDuration: number;
    timedOutCount: number;
}

export interface MethodSummary {
    method: string;
    category: WaitCategory;
    count: number;
    totalDuration: number;
    avgDuration: number;
    maxDuration: number;
}

class WaitProfilerImpl {
    private records: WaitRecord[] = [];
    private enabled: boolean;
    private verbose: boolean;
    private currentTestFile?: string;

    constructor() {
        // Enabled by default, disable with WAIT_PROFILER=0
        this.enabled = process.env.WAIT_PROFILER !== '0';
        this.verbose = process.env.WAIT_PROFILER_VERBOSE === '1';
    }

    /** Enable or disable profiling at runtime */
    setEnabled(enabled: boolean): void {
        this.enabled = enabled;
    }

    /** Set current test file for context */
    setTestFile(file: string): void {
        this.currentTestFile = file;
    }

    /** Check if profiling is enabled */
    isEnabled(): boolean {
        return this.enabled;
    }

    /** Clear all recorded data */
    reset(): void {
        this.records = [];
    }

    /**
     * Record a wait operation.
     * Called by instrumented wait methods in GamePage.
     */
    record(record: Omit<WaitRecord, 'testFile'>): void {
        if (!this.enabled) return;

        const fullRecord: WaitRecord = {
            ...record,
            testFile: this.currentTestFile,
        };

        this.records.push(fullRecord);

        if (this.verbose) {
            const status = record.timedOut ? '⏱️ TIMEOUT' : '✓';
            const duration = record.duration.toFixed(1);
            console.log(
                `[WaitProfiler] ${status} ${record.category}/${record.method}: ${duration}ms (${record.pollCount} polls) - ${record.condition}`
            );
        }
    }

    /**
     * Wrap an async wait function to automatically record timing.
     */
    async wrap<T>(
        category: WaitCategory,
        method: string,
        condition: string,
        timeout: number,
        fn: () => Promise<T>,
        context?: Record<string, unknown>
    ): Promise<T> {
        if (!this.enabled) {
            return fn();
        }

        const startTime = performance.now();
        const pollCount = 0;
        let timedOut = false;

        // Create a proxy to count polls if the function supports it
        const wrappedFn = async() => {
            try {
                return await fn();
            } catch (error) {
                if (error instanceof Error && error.message.includes('Timeout')) {
                    timedOut = true;
                }
                throw error;
            }
        };

        try {
            const result = await wrappedFn();
            return result;
        } finally {
            const endTime = performance.now();
            this.record({
                category,
                method,
                condition,
                startTime,
                endTime,
                duration: endTime - startTime,
                pollCount,
                timedOut,
                timeout,
                context,
            });
        }
    }

    /**
     * Wrap a polling wait with poll counting.
     */
    async wrapPolling<T>(
        category: WaitCategory,
        method: string,
        condition: string,
        timeout: number,
        pollFn: (incrementPoll: () => void) => Promise<T>,
        context?: Record<string, unknown>
    ): Promise<T> {
        if (!this.enabled) {
            return pollFn(() => {});
        }

        const startTime = performance.now();
        let pollCount = 0;
        let timedOut = false;

        const incrementPoll = () => {
            pollCount++;
        };

        try {
            const result = await pollFn(incrementPoll);
            return result;
        } catch (error) {
            if (error instanceof Error && error.message.includes('Timeout')) {
                timedOut = true;
            }
            throw error;
        } finally {
            const endTime = performance.now();
            this.record({
                category,
                method,
                condition,
                startTime,
                endTime,
                duration: endTime - startTime,
                pollCount,
                timedOut,
                timeout,
                context,
            });
        }
    }

    /** Get all recorded waits */
    getRecords(): WaitRecord[] {
        return [...this.records];
    }

    /** Get summary statistics */
    getSummary(): WaitSummary {
        const categories: WaitCategory[] = ['frame', 'state', 'movement', 'render', 'audio', 'dom'];

        const byCategory = {} as Record<WaitCategory, CategorySummary>;
        for (const cat of categories) {
            const catRecords = this.records.filter(r => r.category === cat);
            byCategory[cat] = {
                count: catRecords.length,
                totalDuration: catRecords.reduce((sum, r) => sum + r.duration, 0),
                avgDuration: catRecords.length > 0
                    ? catRecords.reduce((sum, r) => sum + r.duration, 0) / catRecords.length
                    : 0,
                maxDuration: catRecords.length > 0
                    ? Math.max(...catRecords.map(r => r.duration))
                    : 0,
                timedOutCount: catRecords.filter(r => r.timedOut).length,
            };
        }

        // Group by method
        const methodMap = new Map<string, WaitRecord[]>();
        for (const record of this.records) {
            const key = record.method;
            if (!methodMap.has(key)) {
                methodMap.set(key, []);
            }
            methodMap.get(key)!.push(record);
        }

        const byMethod: MethodSummary[] = Array.from(methodMap.entries())
            .map(([method, records]) => ({
                method,
                category: records[0].category,
                count: records.length,
                totalDuration: records.reduce((sum, r) => sum + r.duration, 0),
                avgDuration: records.reduce((sum, r) => sum + r.duration, 0) / records.length,
                maxDuration: Math.max(...records.map(r => r.duration)),
            }))
            .sort((a, b) => b.totalDuration - a.totalDuration);

        // Top 10 slowest
        const slowestWaits = [...this.records]
            .sort((a, b) => b.duration - a.duration)
            .slice(0, 10);

        return {
            totalWaits: this.records.length,
            totalDuration: this.records.reduce((sum, r) => sum + r.duration, 0),
            timedOutCount: this.records.filter(r => r.timedOut).length,
            byCategory,
            slowestWaits,
            byMethod,
        };
    }

    /** Get a formatted text report */
    getReport(): string {
        const summary = this.getSummary();
        const lines: string[] = [];

        lines.push('');
        lines.push('╔══════════════════════════════════════════════════════════════════╗');
        lines.push('║                    WAIT PROFILER REPORT                          ║');
        lines.push('╚══════════════════════════════════════════════════════════════════╝');
        lines.push('');

        // Overview
        lines.push(`Total waits: ${summary.totalWaits}`);
        lines.push(`Total wait time: ${(summary.totalDuration / 1000).toFixed(2)}s`);
        lines.push(`Timed out: ${summary.timedOutCount}`);
        lines.push('');

        // By category
        lines.push('┌─────────────────────────────────────────────────────────────────┐');
        lines.push('│ BY CATEGORY                                                     │');
        lines.push('├─────────────────────────────────────────────────────────────────┤');
        lines.push('│ Category   │ Count │ Total (s) │ Avg (ms) │ Max (ms) │ Timeouts │');
        lines.push('├────────────┼───────┼───────────┼──────────┼──────────┼──────────┤');

        const categories: WaitCategory[] = ['frame', 'state', 'movement', 'render', 'audio', 'dom'];
        for (const cat of categories) {
            const s = summary.byCategory[cat];
            if (s.count === 0) continue;
            const catStr = cat.padEnd(10);
            const countStr = s.count.toString().padStart(5);
            const totalStr = (s.totalDuration / 1000).toFixed(2).padStart(9);
            const avgStr = s.avgDuration.toFixed(1).padStart(8);
            const maxStr = s.maxDuration.toFixed(1).padStart(8);
            const toStr = s.timedOutCount.toString().padStart(8);
            lines.push(`│ ${catStr} │${countStr} │${totalStr} │${avgStr} │${maxStr} │${toStr} │`);
        }
        lines.push('└─────────────────────────────────────────────────────────────────┘');
        lines.push('');

        // By method (top 10)
        lines.push('┌─────────────────────────────────────────────────────────────────┐');
        lines.push('│ TOP METHODS BY TOTAL WAIT TIME                                  │');
        lines.push('├─────────────────────────────────────────────────────────────────┤');
        lines.push('│ Method                          │ Count │ Total (s) │ Avg (ms) │');
        lines.push('├─────────────────────────────────┼───────┼───────────┼──────────┤');

        for (const m of summary.byMethod.slice(0, 10)) {
            const methodStr = m.method.slice(0, 31).padEnd(31);
            const countStr = m.count.toString().padStart(5);
            const totalStr = (m.totalDuration / 1000).toFixed(2).padStart(9);
            const avgStr = m.avgDuration.toFixed(1).padStart(8);
            lines.push(`│ ${methodStr} │${countStr} │${totalStr} │${avgStr} │`);
        }
        lines.push('└─────────────────────────────────────────────────────────────────┘');
        lines.push('');

        // Slowest individual waits
        if (summary.slowestWaits.length > 0) {
            lines.push('┌─────────────────────────────────────────────────────────────────┐');
            lines.push('│ SLOWEST INDIVIDUAL WAITS                                        │');
            lines.push('├─────────────────────────────────────────────────────────────────┤');

            for (const w of summary.slowestWaits.slice(0, 5)) {
                const duration = (w.duration / 1000).toFixed(2);
                const status = w.timedOut ? ' [TIMEOUT]' : '';
                lines.push(`│ ${duration}s - ${w.method}${status}`);
                lines.push(`│        ${w.condition.slice(0, 55)}`);
                if (w.testFile) {
                    lines.push(`│        in ${w.testFile.split('/').pop()}`);
                }
                lines.push('├─────────────────────────────────────────────────────────────────┤');
            }
            lines.push('└─────────────────────────────────────────────────────────────────┘');
        }

        return lines.join('\n');
    }

    /** Get a compact summary (default output) */
    getCompactSummary(): string {
        const summary = this.getSummary();
        if (summary.totalWaits === 0) return '';

        const lines: string[] = [];
        lines.push('');
        lines.push(`⏱️  Wait Profiler: ${summary.totalWaits} waits, ${(summary.totalDuration / 1000).toFixed(2)}s total${summary.timedOutCount > 0 ? `, ${summary.timedOutCount} timeouts` : ''}`);

        // Category breakdown (one line)
        const catParts: string[] = [];
        const categories: WaitCategory[] = ['frame', 'state', 'movement', 'render', 'audio', 'dom'];
        for (const cat of categories) {
            const s = summary.byCategory[cat];
            if (s.count > 0) {
                catParts.push(`${cat}:${(s.totalDuration / 1000).toFixed(1)}s`);
            }
        }
        if (catParts.length > 0) {
            lines.push(`    ${catParts.join(' | ')}`);
        }

        // Top 3 worst offenders
        if (summary.slowestWaits.length > 0) {
            lines.push('    Slowest:');
            for (const w of summary.slowestWaits.slice(0, 3)) {
                const duration = (w.duration / 1000).toFixed(2);
                const status = w.timedOut ? ' [TIMEOUT]' : '';
                lines.push(`      ${duration}s - ${w.method}: ${w.condition.slice(0, 40)}${status}`);
            }
        }

        return lines.join('\n');
    }

    /** Get JSON export for further analysis */
    toJSON(): string {
        return JSON.stringify({
            summary: this.getSummary(),
            records: this.records,
        }, null, 2);
    }
}

/** Singleton instance */
export const WaitProfiler = new WaitProfilerImpl();
