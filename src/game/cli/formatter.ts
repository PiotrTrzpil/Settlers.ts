import type { OutputFormatter } from './types';

/**
 * Creates a compact text formatter for CLI output.
 * Columns are space-padded (no box-drawing), numbers are never zero-padded.
 */
export function createFormatter(): OutputFormatter {
    return { table, kv };
}

const COL_SEP = '  ';

function table(rows: string[][], headers?: string[]): string {
    if (rows.length === 0 && !headers) return '';

    const allRows = headers ? [headers, ...rows] : rows;
    const colCount = allRows.reduce((max, row) => Math.max(max, row.length), 0);
    const widths = new Array<number>(colCount).fill(0);

    for (const row of allRows) {
        for (let c = 0; c < row.length; c++) {
            widths[c] = Math.max(widths[c]!, row[c]!.length);
        }
    }

    const lines: string[] = [];

    if (headers) {
        lines.push(formatRow(headers, widths));
        lines.push(widths.map(w => '-'.repeat(w)).join(COL_SEP));
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
    if (entries.length === 0) return '';

    const maxKeyLen = entries.reduce((max, [key]) => Math.max(max, key.length), 0);

    return entries.map(([key, value]) => `${key.padStart(maxKeyLen)}: ${value}`).join('\n');
}
