/**
 * CLI table formatting for map analysis output.
 * Fixed-width column alignment for readable terminal output.
 */
import type { ObjectProfile, CategorySummary, TerrainGroupSummary } from './object-profile';

/** Pad string to fixed width (right-padded). */
function pad(s: string, width: number): string {
    return s.length >= width ? s.slice(0, width) : s + ' '.repeat(width - s.length);
}

/** Left-pad a number/string for right-alignment. */
function rpad(s: string | number, width: number): string {
    const str = String(s);
    return str.length >= width ? str : ' '.repeat(width - str.length) + str;
}

/** Format a count with k/M suffix for compact display. */
function fmtCount(n: number): string {
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
    if (n >= 10_000) return `${(n / 1000).toFixed(0)}k`;
    if (n >= 1_000) return `${(n / 1000).toFixed(1)}k`;
    return String(n);
}

/** Format height range compactly: "avg (min-max)" */
function fmtHeight(p: ObjectProfile): string {
    return `${p.height.avg} (${p.height.min}-${p.height.max})`;
}

/** Format top N terrain types compactly. */
function fmtTerrain(p: ObjectProfile, topN: number): string {
    return p.terrain
        .slice(0, topN)
        .map(t => `${t.name}:${t.pct}%`)
        .join(', ');
}

const SEPARATOR = '─'.repeat(140);

/** Print the full analysis report to stdout. */
export function printFullReport(
    filename: string,
    mapWidth: number,
    tileCount: number,
    profiles: ObjectProfile[],
    categorySummaries: CategorySummary[],
    terrainGroupSummaries: TerrainGroupSummary[]
): void {
    const totalObjects = profiles.reduce((s, p) => s + p.count, 0);
    const unmappedProfiles = profiles.filter(p => !p.mapped);
    const unmappedCount = unmappedProfiles.reduce((s, p) => s + p.count, 0);

    // Header
    console.log(`\nMap: ${filename} (${mapWidth}x${mapWidth})`);
    console.log(
        `Object tiles: ${fmtCount(totalObjects)} / ${fmtCount(tileCount)} (${Math.round((totalObjects / tileCount) * 100)}%)`
    );
    console.log(
        `Unique raw values: ${profiles.length} (${profiles.length - unmappedProfiles.length} mapped, ${unmappedProfiles.length} unmapped)`
    );
    console.log(`Unmapped instances: ${fmtCount(unmappedCount)}`);

    // Per-object table
    console.log(`\n${SEPARATOR}`);
    console.log('OBJECT PROFILES (all raw values, sorted by count)');
    console.log(SEPARATOR);
    console.log(
        `${pad('Raw', 5)} ${rpad('Count', 8)}  ${pad('Label', 20)} ${pad('Category', 18)} ` +
            `${pad('Terrain (top 3)', 42)} ${pad('Height', 14)} ${rpad('Dark%', 5)} ${rpad('Pond%', 5)}  ${pad('Status', 8)}`
    );
    console.log(
        `${pad('───', 5)} ${rpad('─────', 8)}  ${pad('─────', 20)} ${pad('────────', 18)} ` +
            `${pad('───────────────', 42)} ${pad('──────', 14)} ${rpad('─────', 5)} ${rpad('─────', 5)}  ${pad('──────', 8)}`
    );

    for (const p of profiles) {
        const status = p.mapped ? '' : 'UNMAPPED';
        console.log(
            `${pad(String(p.raw), 5)} ${rpad(fmtCount(p.count), 8)}  ${pad(p.label, 20)} ${pad(p.category, 18)} ` +
                `${pad(fmtTerrain(p, 3), 42)} ${pad(fmtHeight(p), 14)} ${rpad(p.darkLandPct + '%', 5)} ${rpad(p.pondPct + '%', 5)}  ${pad(status, 8)}`
        );
    }

    // Category summary
    console.log(`\n${SEPARATOR}`);
    console.log('CATEGORY SUMMARY');
    console.log(SEPARATOR);
    console.log(
        `${pad('Category', 22)} ${rpad('Count', 8)} ${rpad('Unique', 6)}  ${rpad('AvgH', 5)}  ${pad('Primary Terrain', 20)}`
    );
    console.log(
        `${pad('────────', 22)} ${rpad('─────', 8)} ${rpad('──────', 6)}  ${rpad('────', 5)}  ${pad('───────────────', 20)}`
    );

    for (const cs of categorySummaries) {
        console.log(
            `${pad(cs.category, 22)} ${rpad(fmtCount(cs.totalCount), 8)} ${rpad(String(cs.uniqueTypes), 6)}  ` +
                `${rpad(String(cs.avgHeight), 5)}  ${pad(`${cs.primaryGroup} (${cs.primaryGroupPct}%)`, 20)}`
        );
    }

    // Terrain group summary
    console.log(`\n${SEPARATOR}`);
    console.log('TERRAIN GROUP SUMMARY (how many objects sit on each terrain group)');
    console.log(SEPARATOR);
    console.log(`${pad('Group', 14)} ${rpad('Objects', 10)} ${rpad('% Total', 8)} ${rpad('Unique', 6)}`);
    console.log(`${pad('─────', 14)} ${rpad('───────', 10)} ${rpad('───────', 8)} ${rpad('──────', 6)}`);

    for (const tgs of terrainGroupSummaries) {
        console.log(
            `${pad(tgs.group, 14)} ${rpad(fmtCount(tgs.objectCount), 10)} ${rpad(tgs.pctOfTotal + '%', 8)} ${rpad(String(tgs.uniqueTypes), 6)}`
        );
    }

    // Unmapped detail section
    if (unmappedProfiles.length > 0) {
        console.log(`\n${SEPARATOR}`);
        console.log(`UNMAPPED VALUES (${unmappedProfiles.length} types, ${fmtCount(unmappedCount)} instances)`);
        console.log(SEPARATOR);
        console.log(
            `${pad('Raw', 5)} ${rpad('Count', 8)}  ${pad('Terrain (top 3)', 50)} ${pad('Height', 14)} ${rpad('Dark%', 5)} ${rpad('Pond%', 5)}`
        );
        console.log(
            `${pad('───', 5)} ${rpad('─────', 8)}  ${pad('───────────────', 50)} ${pad('──────', 14)} ${rpad('─────', 5)} ${rpad('─────', 5)}`
        );

        for (const p of unmappedProfiles) {
            console.log(
                `${pad(String(p.raw), 5)} ${rpad(fmtCount(p.count), 8)}  ${pad(fmtTerrain(p, 4), 50)} ${pad(fmtHeight(p), 14)} ${rpad(p.darkLandPct + '%', 5)} ${rpad(p.pondPct + '%', 5)}`
            );
        }
    }

    console.log('');
}
