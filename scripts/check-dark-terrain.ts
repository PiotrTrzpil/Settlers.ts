/**
 * Per-map terrain analysis for specific raw values.
 * Usage: npx tsx scripts/check-dark-terrain.ts <mapfile> [<mapfile2> ...]
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

const CHECK = [
    93, 94, 95, 96, 97, 98, 99, 100, 101, 102, 103, 104, 105, 106, 111, 112, 113, 114, 123, 137, 138, 139, 140, 141,
    142, 143, 144, 145, 146, 147, 148, 149, 150, 153, 160, 161, 162, 189, 190, 191, 192, 212, 213, 214, 220, 230, 231,
    232, 233, 234, 235, 236, 237, 238, 239, 240, 241, 242, 243, 244, 245, 246, 247, 248, 249, 250, 251, 252,
];

function analyzeMap(mapPath: string) {
    const data = loadMapData(mapPath);

    console.log(`\n=== ${data.filename} ===\n`);

    for (const raw of CHECK) {
        const positions: number[] = [];
        for (let i = 0; i < data.objectBytes.length; i++) {
            if (data.objectBytes[i] === raw) positions.push(i);
        }
        if (positions.length === 0) continue;

        const grounds: Record<string, number> = {};
        let darkCount = 0;
        for (const pos of positions) {
            const gt = data.groundTypes[pos]! & 0xf8;
            const name = GT[gt] ?? 'GT' + gt;
            grounds[name] = (grounds[name] ?? 0) + 1;
            if ((data.terrainAttrs[pos]! & 0x40) !== 0) darkCount++;
        }

        const entry = RAW_OBJECT_REGISTRY.find(e => e.raw === raw);
        const label = entry?.label ?? '???';
        const cat = entry?.category ?? '???';
        const sorted = Object.entries(grounds).sort((a, b) => b[1] - a[1]);
        const terrainStr = sorted.map(([k, v]) => k + ':' + (((v / positions.length) * 100) | 0) + '%').join(', ');
        const darkPct = ((darkCount / positions.length) * 100) | 0;
        console.log(
            'raw=' +
                String(raw).padEnd(4) +
                ' n=' +
                String(positions.length).padEnd(6) +
                ' cat=' +
                cat.padEnd(16) +
                ' dark=' +
                String(darkPct + '%').padEnd(5) +
                ' terrain=[' +
                terrainStr +
                ']  ' +
                label
        );
    }
}

for (const arg of process.argv.slice(2)) {
    analyzeMap(arg);
}
