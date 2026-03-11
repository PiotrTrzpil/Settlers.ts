/**
 * Per-test timeline recorder for integration test diagnostics.
 *
 * Composes TimelineWriter (SQLite storage) and pure formatting functions
 * into the public API consumed by test-simulation.ts.
 *
 * All tests in a run share a single DB file; each recorder writes to its
 * own test_id partition so entries can be queried per-test or across tests.
 */

import { TimelineWriter, type TimelineQueryOpts } from './timeline-store';
import { formatEntries, formatSummary, formatDiagnostics } from './timeline-formatter';

// ─── Types ───────────────────────────────────────────────────────

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
    entityType?: string;
    unitId?: number;
    buildingId?: number;
    player?: number;
    x?: number;
    y?: number;
    event: string;
    detail: string;
    level?: string;
    unitType?: string;
    buildingType?: string;
    meta?: string;
}

// ─── Recorder ────────────────────────────────────────────────────

export class TimelineRecorder {
    private readonly writer: TimelineWriter;

    constructor(testId: string) {
        this.writer = new TimelineWriter(testId);
    }

    // ─── Recording ────────────────────────────────────────────────

    record(entry: TimelineEntry) {
        this.writer.record(entry);
    }

    // ─── Queries ──────────────────────────────────────────────────

    getEntries(last?: number): readonly TimelineEntry[] {
        return last === undefined ? this.writer.lastN(this.writer.length) : this.writer.lastN(last);
    }

    query(opts: TimelineQueryOpts): TimelineEntry[] {
        return this.writer.query(opts);
    }

    entityHistory(entityId: number, limit = 500): TimelineEntry[] {
        return this.writer.query({ entityId, limit });
    }

    errors(): TimelineEntry[] {
        return this.writer.query({ category: 'error', limit: 500 });
    }

    countByCategory(): { category: string; count: number }[] {
        return this.writer.countByCategory();
    }

    countByEvent(limit?: number): { event: string; count: number }[] {
        return this.writer.countByEvent(limit);
    }

    get length(): number {
        return this.writer.length;
    }

    // ─── Formatting ───────────────────────────────────────────────

    format(last = 50): string {
        return formatEntries(this.writer.lastN(last));
    }

    formatSummary(headCount = 50, tailCount = 200): string {
        const total = this.writer.length;
        if (total === 0) return '  (no timeline entries)';
        if (total <= headCount + tailCount) {
            return formatEntries(this.writer.lastN(total));
        }
        return formatSummary({
            total,
            categories: this.writer.countByCategory(),
            head: this.writer.head(headCount),
            headCount,
            middlePatterns: this.writer.middlePatterns(headCount, tailCount),
            middleSize: total - headCount - tailCount,
            tail: this.writer.lastN(tailCount),
            tailCount,
        });
    }

    formatDiagnostics(opts: { entityId?: number; lastEntries?: number } = {}): string {
        const { entityId, lastEntries = 100 } = opts;
        return formatDiagnostics({
            categories: this.writer.countByCategory(),
            errors: this.errors(),
            entityHistory: entityId !== undefined ? { entityId, entries: this.entityHistory(entityId) } : undefined,
            tail: this.writer.lastN(lastEntries),
            tailCount: lastEntries,
        });
    }

    // ─── Lifecycle ────────────────────────────────────────────────

    finalize(status: 'passed' | 'failed', tickCount: number, errorCount: number) {
        this.writer.finalize(status, tickCount, errorCount);
    }

    clear() {
        this.writer.clear();
    }

    close() {
        this.writer.close();
    }
}
