/**
 * Shared map file loader for analysis scripts.
 * Reads a .map file and extracts all relevant raw data arrays for analysis.
 */
import * as fs from 'fs';
import * as path from 'path';
import { BinaryReader } from '../../src/resources/file/binary-reader';
import { OriginalMapFile } from '../../src/resources/map/original/original-map-file';
import { MapChunkType } from '../../src/resources/map/original/map-chunk-type';

/** Raw data arrays extracted from a map file, ready for analysis. */
export interface MapRawData {
    filename: string;
    mapWidth: number;
    mapHeight: number;
    tileCount: number;
    /** Raw object byte per tile (byte 0 of 4-byte object data). 0 = empty. */
    objectBytes: Uint8Array;
    /** Ground type per tile (byte 1 of 4-byte landscape data). S4GroundType values. */
    groundTypes: Uint8Array;
    /** Ground height per tile (byte 0 of 4-byte landscape data). */
    groundHeights: Uint8Array;
    /** Terrain attributes per tile (byte 2 of landscape). Bits: dark-land(6), pond(5), sun(0-4). */
    terrainAttrs: Uint8Array;
    /** Gameplay attributes per tile (byte 3 of landscape). Bits: founding-stone(7), fog(0-5). */
    gameplayAttrs: Uint8Array;
}

/** Load a map file and extract all raw data arrays. */
export function loadMapData(mapFilePath: string): MapRawData {
    const buf = fs.readFileSync(mapFilePath);
    const reader = new BinaryReader(new Uint8Array(buf).buffer);
    reader.filename = path.basename(mapFilePath);
    const file = new OriginalMapFile(reader);

    const landscapeChunk = file.getChunkByType(MapChunkType.MapLandscape);
    if (!landscapeChunk) throw new Error('No MapLandscape chunk in file');

    const objectsChunk = file.getChunkByType(MapChunkType.MapObjects);
    if (!objectsChunk) throw new Error('No MapObjects chunk in file');

    const landscapeData = landscapeChunk.getReader().getBuffer();
    const objectData = objectsChunk.getReader().getBuffer();

    const tileCount = landscapeData.length / 4;
    const mapWidth = Math.sqrt(tileCount);
    const mapHeight = mapWidth;

    // Extract landscape layers (4 bytes per tile)
    const groundHeights = new Uint8Array(tileCount);
    const groundTypes = new Uint8Array(tileCount);
    const terrainAttrs = new Uint8Array(tileCount);
    const gameplayAttrs = new Uint8Array(tileCount);
    for (let i = 0; i < tileCount; i++) {
        const base = i * 4;
        groundHeights[i] = landscapeData[base]!;
        groundTypes[i] = landscapeData[base + 1]!;
        terrainAttrs[i] = landscapeData[base + 2]!;
        gameplayAttrs[i] = landscapeData[base + 3]!;
    }

    // Extract object bytes (byte 0 of 4-byte object data, or 1-byte-per-tile)
    const bytesPerTile = objectData.length / tileCount;
    const objectBytes = new Uint8Array(tileCount);
    if (bytesPerTile === 4) {
        for (let i = 0; i < tileCount; i++) {
            objectBytes[i] = objectData[i * 4]!;
        }
    } else if (bytesPerTile === 1) {
        objectBytes.set(objectData);
    } else {
        throw new Error(`Unknown object format: ${bytesPerTile} bytes/tile`);
    }

    return {
        filename: path.basename(mapFilePath),
        mapWidth,
        mapHeight,
        tileCount,
        objectBytes,
        groundTypes,
        groundHeights,
        terrainAttrs,
        gameplayAttrs,
    };
}

/** Read map path from CLI args or exit with usage message. */
export function getMapPathFromArgs(scriptName: string): string {
    const mapFile = process.argv[2];
    if (!mapFile) {
        console.error(`Usage: npx tsx scripts/${scriptName} <map-file>`);
        process.exit(1);
    }
    return mapFile;
}
