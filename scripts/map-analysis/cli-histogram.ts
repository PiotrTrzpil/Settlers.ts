/**
 * Frequency histogram of raw object values across all maps.
 * Quick overview of which raw values exist and how common they are.
 *
 * Run: npx tsx scripts/map-analysis/cli-histogram.ts [map-dir]
 */
import { loadMapData, findMapFiles, DEFAULT_MAP_DIR } from './map-data-loader';

const mapDir = process.argv[2] || DEFAULT_MAP_DIR;
const maps = findMapFiles(mapDir);
const counts = new Map<number, number>();
let parsed = 0;

for (const mapFile of maps) {
    try {
        const data = loadMapData(mapFile);
        for (let i = 0; i < data.tileCount; i++) {
            const val = data.objectBytes[i]!;
            if (val !== 0) {
                counts.set(val, (counts.get(val) ?? 0) + 1);
            }
        }
        parsed++;
    } catch {
        // skip broken maps
    }
}

console.log(`Parsed ${parsed}/${maps.length} maps\n`);

const sorted = [...counts.entries()].sort((a, b) => a[0] - b[0]);
console.log('Raw\tTotal\t\tRarity');
console.log('───\t─────\t\t──────');
for (const [raw, count] of sorted) {
    let rarity: string;
    if (count < 50) rarity = 'VERY_RARE';
    else if (count < 500) rarity = 'RARE';
    else if (count < 5000) rarity = 'uncommon';
    else rarity = 'common';
    console.log(`${raw}\t${count}\t\t${rarity}`);
}
