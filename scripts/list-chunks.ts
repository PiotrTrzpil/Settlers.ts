
import fs from 'fs';
import path from 'path';
import { OriginalMapFile } from '@/resources/map/original/original-map-file';
import { BinaryReader } from '@/resources/file/binary-reader';
import { MapChunkType } from '@/resources/map/original/map-chunk-type';

const mapPath = path.join(process.cwd(), 'public/Siedler4/Map/Campaign/AO_maya1.map');

console.log(`Reading map: ${mapPath}`);

try {
    const buffer = fs.readFileSync(mapPath);
    const data = new Uint8Array(buffer);
    const reader = new BinaryReader(data, 0, data.byteLength, 'AO_maya1.map');

    // OriginalMapFile parses chunks in constructor
    const mapFile = new OriginalMapFile(reader);

    console.log(`\nFound ${mapFile.getChunkCount()} chunks:`);

    for (let i = 0; i < mapFile.getChunkCount(); i++) {
        const chunk = mapFile.getChunkByIndex(i);
        const name = MapChunkType[chunk.chunkType] || 'Unknown';
        console.log(`Chunk ${i}: Type ${chunk.chunkType} (${name}), Length ${chunk.length}`);
    }

} catch (e) {
    console.error('Error:', e);
}
