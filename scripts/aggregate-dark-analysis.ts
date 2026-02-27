/**
 * Aggregate dark-land analysis across ALL maps.
 * For each raw value in range 89-252, compute what % of placements across all maps
 * have the dark-land bit set.
 *
 * Usage: npx tsx scripts/aggregate-dark-analysis.ts
 */
import * as fs from 'fs';
import * as path from 'path';
import { loadMapData } from './map-analysis/map-data-loader';
import { RAW_OBJECT_REGISTRY } from '../src/resources/map/raw-object-registry';

const mapDir = path.resolve(process.cwd(), 'public/Siedler4/Map');

function findMapFiles(dir: string): string[] {
    const results: string[] = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) results.push(...findMapFiles(full));
        else if (entry.name.endsWith('.map')) results.push(full);
    }
    return results;
}

const maps = findMapFiles(mapDir);
console.log(`Scanning ${maps.length} maps...\n`);

// Track per-raw-value: total placements, dark placements, ground type breakdown
interface Stats {
    total: number;
    dark: number;
    maps: number;
    grounds: Record<string, number>;
}

const GT: Record<number, string> = {
    0: 'Water',
    8: 'Beach',
    16: 'Grass',
    24: 'DarkGrass',
    32: 'Swamp',
    48: 'Beach2',
    56: 'Snow',
    64: 'Desert',
    72: 'DesertTrans',
    80: 'Rock',
};

const stats = new Map<number, Stats>();

for (const mapPath of maps) {
    try {
        const data = loadMapData(mapPath);
        const seen = new Set<number>();

        for (let i = 0; i < data.objectBytes.length; i++) {
            const raw = data.objectBytes[i]!;
            if (raw === 0 || raw < 89 || raw > 252) continue;

            if (!stats.has(raw)) stats.set(raw, { total: 0, dark: 0, maps: 0, grounds: {} });
            const s = stats.get(raw)!;
            s.total++;
            if ((data.terrainAttrs[i]! & 0x40) !== 0) s.dark++;

            const gt = data.groundTypes[i]! & 0xf8;
            const name = GT[gt] ?? 'GT' + gt;
            s.grounds[name] = (s.grounds[name] ?? 0) + 1;

            seen.add(raw);
        }

        for (const raw of seen) stats.get(raw)!.maps++;
    } catch {
        // skip unparseable maps
    }
}

// Sort by dark%
const sorted = [...stats.entries()].sort((a, b) => {
    const darkA = a[1].dark / a[1].total;
    const darkB = b[1].dark / b[1].total;
    return darkB - darkA;
});

const pad = (s: string, w: number) => s.padEnd(w);
const rpad = (s: string, w: number) => String(s).padStart(w);

console.log(
    `${pad('Raw', 5)} ${pad('Label', 18)} ${pad('Category', 16)} ${rpad('Total', 7)} ${rpad('Maps', 5)} ${rpad('Dark%', 6)} ${pad('Top Terrain', 50)}`
);
console.log(
    `${pad('───', 5)} ${pad('─────', 18)} ${pad('────────', 16)} ${rpad('─────', 7)} ${rpad('────', 5)} ${rpad('─────', 6)} ${pad('───────────', 50)}`
);

for (const [raw, s] of sorted) {
    if (s.total < 5) continue; // skip very rare values

    const entry = RAW_OBJECT_REGISTRY.find(e => e.raw === raw);
    const label = entry?.label ?? '???';
    const cat = entry?.category ?? '???';
    const darkPct = (((s.dark / s.total) * 100) | 0) + '%';

    const topTerrain = Object.entries(s.grounds)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(([k, v]) => k + ':' + (((v / s.total) * 100) | 0) + '%')
        .join(', ');

    console.log(
        `${pad(String(raw), 5)} ${pad(label, 18)} ${pad(cat, 16)} ${rpad(String(s.total), 7)} ${rpad(String(s.maps), 5)} ${rpad(darkPct, 6)} ${topTerrain}`
    );
}
