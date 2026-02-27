/**
 * Histogram of MapObjects raw values for a single map file.
 * Shows distribution of decoration types and highlights unmapped ones.
 *
 * Run: npx tsx scripts/histogram-map.ts <map-file>
 * Example: npx tsx scripts/histogram-map.ts public/Siedler4/Map/Campaign/AO_maya2.map
 */
import * as path from 'path';
import { lookupRawObject } from '../src/resources/map/raw-object-registry';
import { loadMapData, getMapPathFromArgs } from './map-analysis';

const mapFilePath = getMapPathFromArgs('histogram-map.ts');
const data = loadMapData(mapFilePath);

const hist = new Map<number, number>();
for (let i = 0; i < data.tileCount; i++) {
    const val = data.objectBytes[i]!;
    if (val > 0) hist.set(val, (hist.get(val) ?? 0) + 1);
}

const sorted = [...hist.entries()].sort((a, b) => b[1] - a[1]);

console.log(`Map: ${path.basename(mapFilePath)}`);
console.log(`Total non-zero object slots: ${sorted.reduce((s, [, c]) => s + c, 0)}\n`);

console.log('Raw\tCount\tCategory\tStatus');
console.log('---\t-----\t--------\t------');

let unmappedCount = 0;
let unmappedTypes = 0;

for (const [r, count] of sorted) {
    let category: string;
    let status: string;

    const entry = lookupRawObject(r);
    if (entry) {
        category = entry.category;
        status = 'mapped';
    } else {
        category = '???';
        status = 'UNMAPPED';
        unmappedCount += count;
        unmappedTypes++;
    }

    console.log(`${r}\t${count}\t${category}\t\t${status}`);
}

console.log(`\n--- Summary ---`);
console.log(`Unique raw values: ${sorted.length}`);
console.log(`Known types: ${sorted.length - unmappedTypes}`);
console.log(`UNMAPPED decoration types: ${unmappedTypes} (${unmappedCount} instances)`);
