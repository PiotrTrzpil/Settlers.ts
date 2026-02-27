/**
 * Show tree placement details for a specific map.
 * Usage: npx tsx scripts/trees-on-map.ts <mapfile>
 */
import { loadMapData } from './map-analysis/map-data-loader';
import { RAW_OBJECT_REGISTRY } from '../src/resources/map/raw-object-registry';

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
const COASTAL = new Set([0, 8, 48]);

const data = loadMapData(process.argv[2]!);
const w = data.mapWidth;

// Build coastal tile set
const coastalTiles = new Set<number>();
for (let i = 0; i < data.tileCount; i++) {
    if (COASTAL.has(data.groundTypes[i]! & 0xf8)) coastalTiles.add(i);
}

function isNearCoast(idx: number, radius: number): boolean {
    const x = idx % w;
    const y = (idx / w) | 0;
    for (let dy = -radius; dy <= radius; dy++) {
        for (let dx = -radius; dx <= radius; dx++) {
            const nx = x + dx,
                ny = y + dy;
            if (nx >= 0 && nx < w && ny >= 0 && ny < data.mapHeight) {
                if (coastalTiles.has(ny * w + nx)) return true;
            }
        }
    }
    return false;
}

console.log(`\n=== ${data.filename} (${w}x${data.mapHeight}) ===\n`);

for (let raw = 1; raw <= 18; raw++) {
    const positions: number[] = [];
    for (let i = 0; i < data.objectBytes.length; i++) {
        if (data.objectBytes[i] === raw) positions.push(i);
    }
    if (positions.length === 0) continue;

    const grounds: Record<string, number> = {};
    let nearCoast = 0;
    let onCoast = 0;
    for (const pos of positions) {
        const gt = data.groundTypes[pos]! & 0xf8;
        const name = GT[gt] ?? 'GT' + gt;
        grounds[name] = (grounds[name] ?? 0) + 1;
        if (COASTAL.has(gt)) onCoast++;
        if (isNearCoast(pos, 3)) nearCoast++;
    }

    const entry = RAW_OBJECT_REGISTRY.find(e => e.raw === raw);
    const label = entry?.label ?? '???';
    const terrainStr = Object.entries(grounds)
        .sort((a, b) => b[1] - a[1])
        .map(([k, v]) => k + ':' + (((v / positions.length) * 100) | 0) + '%')
        .join(', ');
    const coastPct = (((nearCoast / positions.length) * 100) | 0) + '%';

    console.log(
        'raw=' +
            String(raw).padEnd(3) +
            ' n=' +
            String(positions.length).padEnd(6) +
            ' coast=' +
            coastPct.padEnd(5) +
            ' onCoast=' +
            String(onCoast).padEnd(5) +
            ' terrain=[' +
            terrainStr +
            ']  ' +
            label
    );
}
