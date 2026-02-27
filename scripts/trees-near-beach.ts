/**
 * Find which tree types most commonly appear near sea/beach terrain.
 * Usage: npx tsx scripts/trees-near-beach.ts
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

const TREE_RAWS = new Set(Array.from({ length: 18 }, (_, i) => i + 1)); // raw 1-18
const TREE_NAMES: Record<number, string> = {};
for (const e of RAW_OBJECT_REGISTRY) {
    if (TREE_RAWS.has(e.raw)) TREE_NAMES[e.raw] = e.label;
}

// Beach/sea ground types
const COASTAL_GROUND = new Set([0, 8, 48]); // Water=0, Beach=8, Beach2=48

interface TreeStats {
    total: number;
    nearCoast: number; // within N tiles of coastal ground
    onCoastalGround: number; // tree tile itself is coastal ground type
    groundBreakdown: Record<string, number>;
}

const stats = new Map<number, TreeStats>();
for (const raw of TREE_RAWS) {
    stats.set(raw, { total: 0, nearCoast: 0, onCoastalGround: 0, groundBreakdown: {} });
}

const maps = findMapFiles(mapDir);
console.log(`Scanning ${maps.length} maps for tree-beach proximity...\n`);

const NEIGHBOR_RADIUS = 3;

for (const mapPath of maps) {
    try {
        const data = loadMapData(mapPath);
        const w = data.mapWidth;
        const h = data.mapHeight;

        // Build a set of coastal tiles for fast lookup
        const coastalTiles = new Set<number>();
        for (let i = 0; i < data.tileCount; i++) {
            const gt = data.groundTypes[i]! & 0xf8;
            if (COASTAL_GROUND.has(gt)) coastalTiles.add(i);
        }

        for (let i = 0; i < data.objectBytes.length; i++) {
            const raw = data.objectBytes[i]!;
            if (!TREE_RAWS.has(raw)) continue;

            const s = stats.get(raw)!;
            s.total++;

            const gt = data.groundTypes[i]! & 0xf8;
            const GROUND_TYPE_NAMES: Record<number, string> = {
                0: 'Water',
                8: 'Beach',
                16: 'Grass',
                24: 'DarkGrass',
                32: 'Swamp',
                48: 'Beach2',
                56: 'Snow',
                64: 'Desert',
            };
            const gtName = GROUND_TYPE_NAMES[gt] ?? 'Other';
            s.groundBreakdown[gtName] = (s.groundBreakdown[gtName] ?? 0) + 1;

            if (COASTAL_GROUND.has(gt)) {
                s.onCoastalGround++;
            }

            // Check neighbors within radius
            const x = i % w;
            const y = (i / w) | 0;
            let foundCoast = false;
            for (let dy = -NEIGHBOR_RADIUS; dy <= NEIGHBOR_RADIUS && !foundCoast; dy++) {
                for (let dx = -NEIGHBOR_RADIUS; dx <= NEIGHBOR_RADIUS && !foundCoast; dx++) {
                    if (dx === 0 && dy === 0) continue;
                    const nx = x + dx;
                    const ny = y + dy;
                    if (nx >= 0 && nx < w && ny >= 0 && ny < h) {
                        if (coastalTiles.has(ny * w + nx)) foundCoast = true;
                    }
                }
            }
            if (foundCoast) s.nearCoast++;
        }
    } catch {
        // skip unparseable
    }
}

const pad = (s: string, w: number) => s.padEnd(w);
const rpad = (s: string, w: number) => String(s).padStart(w);

// Sort by nearCoast percentage
const sorted = [...stats.entries()]
    .filter(([, s]) => s.total > 0)
    .sort((a, b) => b[1].nearCoast / b[1].total - a[1].nearCoast / a[1].total);

console.log(
    `${pad('Raw', 4)} ${pad('Tree', 14)} ${rpad('Total', 8)} ${rpad('NearCoast', 10)} ${rpad('Coast%', 7)} ${rpad('OnCoast', 8)} ${pad('Top Ground Types', 50)}`
);
console.log(
    `${pad('───', 4)} ${pad('────', 14)} ${rpad('─────', 8)} ${rpad('─────────', 10)} ${rpad('──────', 7)} ${rpad('───────', 8)} ${pad('────────────────', 50)}`
);

for (const [raw, s] of sorted) {
    const coastPct = ((s.nearCoast / s.total) * 100).toFixed(1) + '%';
    const topGround = Object.entries(s.groundBreakdown)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 4)
        .map(([k, v]) => k + ':' + (((v / s.total) * 100) | 0) + '%')
        .join(', ');

    console.log(
        `${pad(String(raw), 4)} ${pad(TREE_NAMES[raw] ?? '???', 14)} ${rpad(String(s.total), 8)} ${rpad(String(s.nearCoast), 10)} ${rpad(coastPct, 7)} ${rpad(String(s.onCoastalGround), 8)} ${topGround}`
    );
}
