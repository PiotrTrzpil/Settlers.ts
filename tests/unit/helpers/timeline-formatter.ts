/**
 * Pure formatting functions for timeline entries.
 *
 * No SQL, no side-effects — takes data, returns strings.
 */

import type { TimelineEntry } from './timeline-recorder';

/** Format a single entry as an aligned, fixed-width line. */
function formatLine(e: TimelineEntry): string {
    const tick = String(e.tick).padStart(6);
    const cat = e.category.padEnd(10);
    const et = e.entityType ? e.entityType.charAt(0) : ' ';
    const id = e.entityId !== undefined ? `${et}#${e.entityId}`.padEnd(8) : '        ';
    const pl = e.player !== undefined ? `P${e.player}` : '  ';
    const pos = e.x !== undefined && e.y !== undefined ? `(${e.x},${e.y})`.padEnd(9) : '         ';
    const ev = e.event.padEnd(22);
    return `  tick ${tick}  [${cat}] ${pl} ${id} ${pos} ${ev} ${e.detail}`;
}

/** Format entries as compact aligned lines for console output. */
export function formatEntries(entries: readonly TimelineEntry[]): string {
    if (entries.length === 0) return '  (no timeline entries)';
    return entries.map(formatLine).join('\n');
}

/** Format category counts as a compact inline summary. */
export function formatCategoryCounts(counts: { category: string; count: number }[]): string {
    return counts.map(c => `${c.category}=${c.count}`).join(', ');
}

/** Format event-pattern counts (for the "middle" section of a summary). */
export function formatPatternCounts(patterns: { pattern: string; count: number }[]): string {
    return patterns.map(p => `    ×${String(p.count).padStart(6)}  [${p.pattern}]`).join('\n');
}

export interface SummaryParts {
    total: number;
    categories: { category: string; count: number }[];
    head: readonly TimelineEntry[];
    headCount: number;
    middlePatterns: { pattern: string; count: number }[];
    middleSize: number;
    tail: readonly TimelineEntry[];
    tailCount: number;
}

/** Build a smart summary string from pre-queried parts. */
export function formatSummary(parts: SummaryParts): string {
    const lines: string[] = [];

    lines.push(`  [${parts.total} entries total: ${formatCategoryCounts(parts.categories)}]`);

    lines.push(`\n  ── first ${parts.headCount} entries ──`);
    lines.push(formatEntries(parts.head));

    lines.push(`\n  ── ${parts.middleSize} entries omitted, top patterns ──`);
    lines.push(formatPatternCounts(parts.middlePatterns));

    lines.push(`\n  ── last ${parts.tailCount} entries ──`);
    lines.push(formatEntries(parts.tail));

    return lines.join('\n');
}

/** Build a compact LLM-friendly diagnostic report from pre-queried sections. */
export function formatDiagnostics(sections: {
    categories: { category: string; count: number }[];
    errors: readonly TimelineEntry[];
    entityHistory?: { entityId: number; entries: readonly TimelineEntry[] };
    tail: readonly TimelineEntry[];
    tailCount: number;
}): string {
    const parts: string[] = [];

    parts.push(`[Categories] ${formatCategoryCounts(sections.categories)}`);

    if (sections.errors.length > 0) {
        parts.push(`[Errors] ${sections.errors.length} error(s)\n${formatEntries(sections.errors)}`);
    }

    if (sections.entityHistory) {
        const { entityId, entries } = sections.entityHistory;
        parts.push(`[Entity #${entityId} history] ${entries.length} entries\n${formatEntries(entries)}`);
    }

    parts.push(`[Last ${sections.tailCount} entries]\n${formatEntries(sections.tail)}`);

    return parts.join('\n\n');
}
