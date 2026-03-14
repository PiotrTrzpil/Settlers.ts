import type { OutputFormatter } from './types';

/**
 * Creates a compact text formatter for CLI output.
 * Columns are space-padded (no box-drawing), numbers are never zero-padded.
 */
export function createFormatter(): OutputFormatter {
    return { table, kv, section, banner };
}

const COL_SEP = '  ';

function table(rows: string[][], headers?: string[]): string {
    if (rows.length === 0 && !headers) {
        return '';
    }

    const allRows = headers ? [headers, ...rows] : rows;
    const colCount = allRows.reduce((max, row) => Math.max(max, row.length), 0);
    const widths = Array.from<number>({ length: colCount }).fill(0);

    for (const row of allRows) {
        for (let c = 0; c < row.length; c++) {
            widths[c] = Math.max(widths[c]!, row[c]!.length);
        }
    }

    const lines: string[] = [];

    if (headers) {
        lines.push(
            formatRow(
                headers.map(h => h.toUpperCase()),
                widths
            )
        );
        lines.push(widths.map(w => '\u2500'.repeat(w)).join(COL_SEP));
    }

    for (const row of rows) {
        lines.push(formatRow(row, widths));
    }

    return lines.join('\n');
}

function formatRow(row: string[], widths: number[]): string {
    const last = row.length - 1;
    return row.map((cell, i) => (i < last ? cell.padEnd(widths[i]!) : cell)).join(COL_SEP);
}

function kv(entries: [string, string | number][]): string {
    if (entries.length === 0) {
        return '';
    }

    const maxKeyLen = entries.reduce((max, [key]) => Math.max(max, key.length), 0);

    return entries.map(([key, value]) => `${key.padEnd(maxKeyLen)}  ${value}`).join('\n');
}

/** Format a section header: ── Title ── */
function section(title: string, detail?: string): string {
    const suffix = detail ? `  ${detail}` : '';
    return `\u2500\u2500 ${title}${suffix} \u2500\u2500`;
}

/** Format a top-level banner with a rule underneath. */
function banner(title: string): string {
    return `${title}\n${'='.repeat(title.length)}`;
}
