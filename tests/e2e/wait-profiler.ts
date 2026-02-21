/**
 * Wait Profiler for E2E Tests
 *
 * Instruments all wait operations to identify bottlenecks.
 * Enabled by default. Disable with WAIT_PROFILER=0.
 * Verbose per-wait logging with WAIT_PROFILER_VERBOSE=1.
 */

export type WaitCategory = 'frame' | 'state' | 'movement' | 'render' | 'audio' | 'dom';

interface WaitRecord {
    category: WaitCategory;
    method: string;
    condition: string;
    startTime: number;
    endTime: number;
    duration: number;
    pollCount: number;
    timedOut: boolean;
    timeout: number;
}

interface CategorySummary {
    count: number;
    totalDuration: number;
    avgDuration: number;
    maxDuration: number;
    timedOutCount: number;
}

interface MethodSummary {
    method: string;
    count: number;
    totalDuration: number;
    avgDuration: number;
    maxDuration: number;
}

interface WaitSummary {
    totalWaits: number;
    totalDuration: number;
    timedOutCount: number;
    byCategory: Record<WaitCategory, CategorySummary>;
    slowestWaits: WaitRecord[];
    byMethod: MethodSummary[];
}

const CATEGORIES: WaitCategory[] = ['frame', 'state', 'movement', 'render', 'audio', 'dom'];

class WaitProfilerImpl {
    private records: WaitRecord[] = [];
    private readonly enabled: boolean;
    private readonly verbose: boolean;

    constructor() {
        this.enabled = process.env['WAIT_PROFILER'] !== '0';
        this.verbose = process.env['WAIT_PROFILER_VERBOSE'] === '1';
    }

    isEnabled(): boolean {
        return this.enabled;
    }

    record(record: WaitRecord): void {
        if (!this.enabled) return;

        this.records.push(record);

        if (this.verbose) {
            const status = record.timedOut ? 'TIMEOUT' : 'ok';
            console.log(
                `[WaitProfiler] ${status} ${record.category}/${record.method}: ${record.duration.toFixed(1)}ms - ${record.condition}`
            );
        }
    }

    getReport(): string {
        const summary = this.getSummary();
        const lines: string[] = [];

        lines.push('');
        lines.push('=== WAIT PROFILER REPORT ===');
        lines.push('');
        lines.push(`Total waits: ${summary.totalWaits}`);
        lines.push(`Total wait time: ${(summary.totalDuration / 1000).toFixed(2)}s`);
        lines.push(`Timed out: ${summary.timedOutCount}`);
        lines.push('');

        // By category
        lines.push('BY CATEGORY:');
        for (const cat of CATEGORIES) {
            const s = summary.byCategory[cat];
            if (s.count === 0) continue;
            lines.push(
                `  ${cat.padEnd(10)} ${String(s.count).padStart(4)}x  ${(s.totalDuration / 1000).toFixed(2).padStart(7)}s  avg ${s.avgDuration.toFixed(0).padStart(5)}ms  max ${s.maxDuration.toFixed(0).padStart(5)}ms${s.timedOutCount ? `  ${s.timedOutCount} timeouts` : ''}`
            );
        }
        lines.push('');

        // Top methods
        lines.push('TOP METHODS:');
        for (const m of summary.byMethod.slice(0, 10)) {
            lines.push(
                `  ${m.method.slice(0, 30).padEnd(30)} ${String(m.count).padStart(4)}x  ${(m.totalDuration / 1000).toFixed(2).padStart(7)}s  avg ${m.avgDuration.toFixed(0).padStart(5)}ms`
            );
        }
        lines.push('');

        // Slowest waits
        if (summary.slowestWaits.length > 0) {
            lines.push('SLOWEST WAITS:');
            for (const w of summary.slowestWaits.slice(0, 5)) {
                const status = w.timedOut ? ' [TIMEOUT]' : '';
                lines.push(`  ${(w.duration / 1000).toFixed(2)}s - ${w.method}: ${w.condition.slice(0, 50)}${status}`);
            }
        }

        return lines.join('\n');
    }

    getCompactSummary(): string {
        const summary = this.getSummary();
        if (summary.totalWaits === 0) return '';

        const lines: string[] = [];
        lines.push('');
        lines.push(
            `Wait Profiler: ${summary.totalWaits} waits, ${(summary.totalDuration / 1000).toFixed(2)}s total${summary.timedOutCount > 0 ? `, ${summary.timedOutCount} timeouts` : ''}`
        );

        const catParts: string[] = [];
        for (const cat of CATEGORIES) {
            const s = summary.byCategory[cat];
            if (s.count > 0) {
                catParts.push(`${cat}:${(s.totalDuration / 1000).toFixed(1)}s`);
            }
        }
        if (catParts.length > 0) {
            lines.push(`    ${catParts.join(' | ')}`);
        }

        if (summary.slowestWaits.length > 0) {
            lines.push('    Slowest:');
            for (const w of summary.slowestWaits.slice(0, 3)) {
                const status = w.timedOut ? ' [TIMEOUT]' : '';
                lines.push(
                    `      ${(w.duration / 1000).toFixed(2)}s - ${w.method}: ${w.condition.slice(0, 40)}${status}`
                );
            }
        }

        return lines.join('\n');
    }

    private getSummary(): WaitSummary {
        const byCategory = {} as Record<WaitCategory, CategorySummary>;
        for (const cat of CATEGORIES) {
            const catRecords = this.records.filter(r => r.category === cat);
            byCategory[cat] = {
                count: catRecords.length,
                totalDuration: catRecords.reduce((sum, r) => sum + r.duration, 0),
                avgDuration:
                    catRecords.length > 0 ? catRecords.reduce((sum, r) => sum + r.duration, 0) / catRecords.length : 0,
                maxDuration: catRecords.length > 0 ? Math.max(...catRecords.map(r => r.duration)) : 0,
                timedOutCount: catRecords.filter(r => r.timedOut).length,
            };
        }

        const methodMap = new Map<string, WaitRecord[]>();
        for (const record of this.records) {
            const key = record.method;
            if (!methodMap.has(key)) methodMap.set(key, []);
            methodMap.get(key)!.push(record);
        }

        const byMethod: MethodSummary[] = Array.from(methodMap.entries())
            .map(([method, records]) => ({
                method,
                count: records.length,
                totalDuration: records.reduce((sum, r) => sum + r.duration, 0),
                avgDuration: records.reduce((sum, r) => sum + r.duration, 0) / records.length,
                maxDuration: Math.max(...records.map(r => r.duration)),
            }))
            .sort((a, b) => b.totalDuration - a.totalDuration);

        const slowestWaits = [...this.records].sort((a, b) => b.duration - a.duration).slice(0, 10);

        return {
            totalWaits: this.records.length,
            totalDuration: this.records.reduce((sum, r) => sum + r.duration, 0),
            timedOutCount: this.records.filter(r => r.timedOut).length,
            byCategory,
            slowestWaits,
            byMethod,
        };
    }
}

/** Singleton instance */
export const WaitProfiler = new WaitProfilerImpl();
