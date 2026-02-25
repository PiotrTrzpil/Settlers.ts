/**
 * Histogram of MapObjects raw values across multiple maps.
 * Uses the actual game map loader to handle decompression.
 *
 * Run: npx tsx scripts/histogram-objects.ts
 */
import * as fs from 'fs';
import * as path from 'path';
import { BinaryReader } from '../src/resources/file/binary-reader';
import { OriginalMapFile } from '../src/resources/map/original/original-map-file';
import { MapChunkType } from '../src/resources/map/original/map-chunk-type';

function findMaps(dir: string): string[] {
    const results: string[] = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) results.push(...findMaps(full));
        else if (entry.name.endsWith('.map')) results.push(full);
    }
    return results;
}

const mapDir = process.argv[2] || 'public/Siedler4/Map';
const maps = findMaps(mapDir);
const global = new Map<number, number>();
let parsed = 0;

for (const mapFile of maps) {
    try {
        const buf = fs.readFileSync(mapFile);
        const reader = new BinaryReader(new Uint8Array(buf).buffer);
        reader.filename = path.basename(mapFile);
        const file = new OriginalMapFile(reader);

        const chunk = file.getChunkByType(MapChunkType.MapObjects);
        if (!chunk) continue;

        const data = chunk.getReader();
        const raw = data.getBuffer();

        for (let i = 0; i < raw.length / 4; i++) {
            const val = raw[i * 4]!;
            if (val > 18) {
                global.set(val, (global.get(val) ?? 0) + 1);
            }
        }
        parsed++;
    } catch {
        // skip broken maps
    }
}

console.log(`Parsed ${parsed}/${maps.length} maps\n`);

const sorted = [...global.entries()].sort((a, b) => a[0] - b[0]);
console.log('Raw\tTotal\t\tRarity');
console.log('---\t-----\t\t------');
for (const [raw, count] of sorted) {
    let rarity: string;
    if (count < 50) rarity = 'VERY_RARE';
    else if (count < 500) rarity = 'RARE';
    else if (count < 5000) rarity = 'uncommon';
    else rarity = 'common';
    console.log(`${raw}\t${count}\t\t${rarity}`);
}
