/**
 * Histogram of MapObjects raw values for a single map file.
 * Shows distribution of decoration types and highlights unmapped ones.
 *
 * Run: npx tsx scripts/histogram-map.ts <map-file>
 * Example: npx tsx scripts/histogram-map.ts public/Siedler4/Map/Campaign/AO_maya2.map
 */
import * as fs from 'fs';
import * as path from 'path';
import { BinaryReader } from '../src/resources/file/binary-reader';
import { OriginalMapFile } from '../src/resources/map/original/original-map-file';
import { MapChunkType } from '../src/resources/map/original/map-chunk-type';
import { DECORATION_TYPES } from '../src/game/systems/map-objects';

const mapFile = process.argv[2];
if (!mapFile) {
    console.error('Usage: npx tsx scripts/histogram-map.ts <map-file>');
    process.exit(1);
}

const mappedRawValues = new Set(DECORATION_TYPES.map(d => d.raw));

const buf = fs.readFileSync(mapFile);
const reader = new BinaryReader(new Uint8Array(buf).buffer);
reader.filename = path.basename(mapFile);
const file = new OriginalMapFile(reader);
const chunk = file.getChunkByType(MapChunkType.MapObjects);
if (!chunk) {
    console.log('No MapObjects chunk');
    process.exit(1);
}

const data = chunk.getReader();
const raw = data.getBuffer();
const hist = new Map<number, number>();

for (let i = 0; i < raw.length / 4; i++) {
    const val = raw[i * 4]!;
    if (val > 0) hist.set(val, (hist.get(val) ?? 0) + 1);
}

const sorted = [...hist.entries()].sort((a, b) => b[1] - a[1]);

console.log(`Map: ${path.basename(mapFile)}`);
console.log(`Total non-zero object slots: ${sorted.reduce((s, [, c]) => s + c, 0)}\n`);

console.log('Raw\tCount\tCategory\tStatus');
console.log('---\t-----\t--------\t------');

let unmappedCount = 0;
let unmappedTypes = 0;

for (const [r, count] of sorted) {
    let category: string;
    let status: string;

    if (r >= 1 && r <= 18) {
        category = 'tree';
        status = 'mapped';
    } else if (r >= 124 && r <= 135) {
        category = 'resource_stone';
        status = 'mapped';
    } else if (mappedRawValues.has(r)) {
        const info = DECORATION_TYPES.find(d => d.raw === r)!;
        category = info.category;
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
console.log(`Mapped decoration types: ${sorted.length - unmappedTypes}`);
console.log(`UNMAPPED decoration types: ${unmappedTypes} (${unmappedCount} instances)`);
