/**
 * Correlate unmapped decoration raw values with terrain types.
 * Shows which ground type each unmapped decoration appears on most.
 *
 * Run: npx tsx scripts/terrain-correlation.ts <map-file>
 */
import * as fs from 'fs';
import * as path from 'path';
import { BinaryReader } from '../src/resources/file/binary-reader';
import { OriginalMapFile } from '../src/resources/map/original/original-map-file';
import { MapChunkType } from '../src/resources/map/original/map-chunk-type';
import { DECORATION_TYPES } from '../src/game/systems/map-objects';
import { S4GroundType } from '../src/resources/map/s4-types';

const GROUND_TYPE_NAMES: Partial<Record<number, string>> = {
    [S4GroundType.WATER1]: 'Water1',
    [S4GroundType.GRASS]: 'Grass',
    [S4GroundType.GRASS_ROCK]: 'Grass/Rock',
    [S4GroundType.GRASS_DESERT]: 'Grass/Desert',
    [S4GroundType.GRASS_SWAMP]: 'Grass/Swamp',
    [S4GroundType.GRASS_MUD]: 'Grass/Mud',
    [S4GroundType.DARKGRASS]: 'DarkGrass',
    [S4GroundType.DARKGRASS_GRASS]: 'DarkGrass/Grass',
    [S4GroundType.ROCK]: 'Rock',
    [S4GroundType.ROCK_GRASS]: 'Rock/Grass',
    [S4GroundType.BEACH]: 'Beach',
    [S4GroundType.DESERT]: 'Desert',
    [S4GroundType.DESERT_GRASS]: 'Desert/Grass',
    [S4GroundType.SWAMP]: 'Swamp',
    [S4GroundType.SWAMP_GRASS]: 'Swamp/Grass',
    [S4GroundType.RIVER1]: 'River1',
    [S4GroundType.RIVER2]: 'River2',
    [S4GroundType.RIVER3]: 'River3',
    [S4GroundType.RIVER4]: 'River4',
    [S4GroundType.SNOW]: 'Snow',
    [S4GroundType.MUD]: 'Mud',
    [S4GroundType.MUD_GRASS]: 'Mud/Grass',
};

const mapFile = process.argv[2];
if (!mapFile) {
    console.error('Usage: npx tsx scripts/terrain-correlation.ts <map-file>');
    process.exit(1);
}

const mappedRawValues = new Set(DECORATION_TYPES.map(d => d.raw));

const buf = fs.readFileSync(mapFile);
const reader = new BinaryReader(new Uint8Array(buf).buffer);
reader.filename = path.basename(mapFile);
const file = new OriginalMapFile(reader);

// Get map dimensions from landscape chunk
const landscapeChunk = file.getChunkByType(MapChunkType.MapLandscape);
if (!landscapeChunk) {
    console.error('No landscape chunk');
    process.exit(1);
}
const landscapeData = landscapeChunk.getReader().getBuffer();
const tileCount = landscapeData.length / 4;
const mapWidth = Math.sqrt(tileCount);

// Extract ground types (byte 1 of each 4-byte tile)
const groundTypes = new Uint8Array(tileCount);
for (let i = 0; i < tileCount; i++) {
    groundTypes[i] = landscapeData[i * 4 + 1]!;
}

// Get objects chunk
const objectsChunk = file.getChunkByType(MapChunkType.MapObjects);
if (!objectsChunk) {
    console.error('No objects chunk');
    process.exit(1);
}
const objectData = objectsChunk.getReader().getBuffer();

// Build per-raw-value terrain histogram (only unmapped decoration values)
const terrainByRaw = new Map<number, Map<number, number>>();
const totalByRaw = new Map<number, number>();

for (let i = 0; i < tileCount; i++) {
    const rawVal = objectData[i * 4]!;
    if (rawVal <= 18 || rawVal === 0) continue; // skip trees and empty
    if (rawVal >= 124 && rawVal <= 135) continue; // skip resource stone
    if (mappedRawValues.has(rawVal)) continue; // skip already mapped

    const groundType = groundTypes[i]!;
    if (!terrainByRaw.has(rawVal)) terrainByRaw.set(rawVal, new Map());
    const terrainHist = terrainByRaw.get(rawVal)!;
    terrainHist.set(groundType, (terrainHist.get(groundType) ?? 0) + 1);
    totalByRaw.set(rawVal, (totalByRaw.get(rawVal) ?? 0) + 1);
}

const DARK_GROUND_TYPES = new Set([
    S4GroundType.DARKGRASS,
    S4GroundType.DARKGRASS_GRASS,
    S4GroundType.SWAMP,
    S4GroundType.SWAMP_GRASS,
    S4GroundType.GRASS_SWAMP,
]);

// Sort by count descending
const sorted = [...totalByRaw.entries()].sort((a, b) => b[1] - a[1]);

console.log(`Map: ${path.basename(mapFile)} (${mapWidth}x${mapWidth})`);
console.log(`Unmapped decoration types: ${sorted.length}\n`);

console.log('Raw\tCount\tDark%\tTop terrains');
console.log('---\t-----\t-----\t------------');

for (const [raw, total] of sorted) {
    const terrainHist = terrainByRaw.get(raw)!;
    const terrainSorted = [...terrainHist.entries()].sort((a, b) => b[1] - a[1]);

    let darkCount = 0;
    for (const [gt, count] of terrainHist) {
        if (DARK_GROUND_TYPES.has(gt)) darkCount += count;
    }
    const darkPct = Math.round((darkCount / total) * 100);

    const topTerrains = terrainSorted
        .slice(0, 3)
        .map(([gt, c]) => `${GROUND_TYPE_NAMES[gt as S4GroundType] ?? `Unknown(${gt})`}:${c}`)
        .join(', ');

    console.log(`${raw}\t${total}\t${darkPct}%\t${topTerrains}`);
}

// Summary: group by dark ground affinity
console.log('\n--- Dark ground candidates (>50% on dark terrain) ---');
const darkCandidates: Array<{ raw: number; count: number; darkPct: number }> = [];
const nonDarkCandidates: Array<{ raw: number; count: number; darkPct: number }> = [];

for (const [raw, total] of sorted) {
    const terrainHist = terrainByRaw.get(raw)!;
    let darkCount = 0;
    for (const [gt, count] of terrainHist) {
        if (DARK_GROUND_TYPES.has(gt)) darkCount += count;
    }
    const darkPct = Math.round((darkCount / total) * 100);
    if (darkPct > 50) {
        darkCandidates.push({ raw, count: total, darkPct });
    } else {
        nonDarkCandidates.push({ raw, count: total, darkPct });
    }
}

for (const c of darkCandidates) {
    console.log(`  raw=${c.raw}\tcount=${c.count}\tdark=${c.darkPct}%`);
}

console.log('\n--- Non-dark unmapped ---');
for (const c of nonDarkCandidates) {
    console.log(`  raw=${c.raw}\tcount=${c.count}\tdark=${c.darkPct}%`);
}
