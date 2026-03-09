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
