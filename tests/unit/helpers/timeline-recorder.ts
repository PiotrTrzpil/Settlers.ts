/**
 * Timeline recorder for integration test diagnostics.
 *
 * Records structured events during simulation ticks, producing a compact
 * human-readable timeline that an AI agent can parse to diagnose failures
 * without interactive debugging.
 *
 * Auto-dumped on runUntil() timeout so every failure includes a causal narrative.
 */

export type TimelineCategory =
    | 'unit'
    | 'building'
    | 'carrier'
    | 'inventory'
    | 'logistics'
    | 'world'
    | 'combat'
    | 'movement'
    | 'error';

export interface TimelineEntry {
    tick: number;
    category: TimelineCategory;
    entityId?: number;
    event: string;
    detail: string;
}

export class TimelineRecorder {
    private entries: TimelineEntry[] = [];

    record(tick: number, category: TimelineCategory, entityId: number | undefined, event: string, detail: string) {
        this.entries.push({ tick, category, entityId, event, detail });
    }

    /** Return the last N entries (default: all). */
    getEntries(last?: number): readonly TimelineEntry[] {
        if (last === undefined) return this.entries;
        return this.entries.slice(-last);
    }

    /** Format entries as a compact, aligned string for console output. */
    format(last = 50): string {
        const entries = this.getEntries(last);
        if (entries.length === 0) return '  (no timeline entries)';
        return this.formatEntries(entries);
    }

    /**
     * Format a smart summary for long timelines (timeouts with 50k+ ticks).
     * Shows: category counts, first N entries, last N entries, and deduplicated
     * repeated patterns in between. Avoids OOM from formatting millions of entries.
     */
    formatSummary(headCount = 50, tailCount = 200): string {
        const total = this.entries.length;
        if (total === 0) return '  (no timeline entries)';
        if (total <= headCount + tailCount) return this.formatEntries(this.entries);

        const lines: string[] = [];

        // Category counts
        const counts = new Map<string, number>();
        for (const e of this.entries) {
            counts.set(e.category, (counts.get(e.category) ?? 0) + 1);
        }
        const countStr = [...counts.entries()]
            .sort((a, b) => b[1] - a[1])
            .map(([cat, n]) => `${cat}=${n}`)
            .join(', ');
        lines.push(`  [${total} entries total: ${countStr}]`);

        // Head
        lines.push(`\n  ── first ${headCount} entries ──`);
        lines.push(this.formatEntries(this.entries.slice(0, headCount)));

        // Middle summary: deduplicated event patterns
        const middle = this.entries.slice(headCount, -tailCount);
        const patternCounts = new Map<string, number>();
        for (const e of middle) {
            const key = `[${e.category}] ${e.event}`;
            patternCounts.set(key, (patternCounts.get(key) ?? 0) + 1);
        }
        const topPatterns = [...patternCounts.entries()]
            .sort((a, b) => b[1] - a[1])
            .slice(0, 20);
        lines.push(`\n  ── ${middle.length} entries omitted, top patterns ──`);
        for (const [pattern, n] of topPatterns) {
            lines.push(`    ×${String(n).padStart(6)}  ${pattern}`);
        }

        // Tail
        lines.push(`\n  ── last ${tailCount} entries ──`);
        lines.push(this.formatEntries(this.entries.slice(-tailCount)));

        return lines.join('\n');
    }

    private formatEntries(entries: readonly TimelineEntry[]): string {
        const lines: string[] = [];
        for (const e of entries) {
            const tick = String(e.tick).padStart(6);
            const cat = e.category.padEnd(10);
            const id = e.entityId !== undefined ? `#${e.entityId}`.padEnd(6) : '      ';
            const ev = e.event.padEnd(22);
            lines.push(`  tick ${tick}  [${cat}] ${id} ${ev} ${e.detail}`);
        }
        return lines.join('\n');
    }

    /** Number of recorded entries. */
    get length(): number {
        return this.entries.length;
    }

    clear() {
        this.entries = [];
    }
}
