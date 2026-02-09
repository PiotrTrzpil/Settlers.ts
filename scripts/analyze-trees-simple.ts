#!/usr/bin/env npx tsx
/**
 * Standalone tree data analyzer for S4 map files
 * Run with: npx tsx scripts/analyze-trees-simple.ts <map-path>
 */

import * as fs from 'fs';

const TREE_NAMES: Record<number, string> = {
    1: 'OAK', 2: 'BEECH', 3: 'ASH', 4: 'LINDEN', 5: 'BIRCH',
    6: 'POPLAR', 7: 'CHESTNUT', 8: 'MAPLE', 9: 'FIR', 10: 'SPRUCE',
    11: 'COCONUT', 12: 'DATE', 13: 'WALNUT', 14: 'CORKOAK',
    15: 'PINE', 16: 'PINE2', 17: 'OLIVE_L', 18: 'OLIVE_S'
};

// Ground types
const WATER_TYPES = new Set([0, 1, 2, 3, 4, 5, 6, 7]); // 0-7
const SNOW_TYPES = new Set([128, 129]); // SNOW, SNOW_ROCK
const DESERT_TYPES = new Set([64, 65]); // DESERT, DESERT_GRASS
const GRASS_TYPES = new Set([16, 17, 18, 20, 21, 23, 24, 25]); // Various grass

interface ChunkInfo {
    type: number;
    offset: number;
    length: number;
    unpackedLength: number;
}

interface Candidate {
    name: string;
    count: number;
    variance: number;
    types: number;
    onWater: number;
    onSnow: number;
    onDesert: number;
    onGrass: number;
    distribution: Map<number, number>;
    score: number;
}

// Simple LZSS decompression (Settlers format) - with safety limits
function decompress(src: Uint8Array, dstLen: number): Uint8Array {
    // Safety check
    if (dstLen > 50_000_000) {
        console.error(`Decompression target too large: ${dstLen} bytes`);
        return new Uint8Array(0);
    }

    const dst = new Uint8Array(dstLen);
    let srcPos = 0;
    let dstPos = 0;
    let iterations = 0;
    const maxIterations = dstLen * 2;

    while (dstPos < dstLen && srcPos < src.length && iterations < maxIterations) {
        iterations++;
        const flag = src[srcPos++];

        for (let bit = 0; bit < 8 && dstPos < dstLen && srcPos < src.length; bit++) {
            if ((flag & (1 << bit)) !== 0) {
                // Literal byte
                dst[dstPos++] = src[srcPos++];
            } else {
                // Back-reference
                if (srcPos + 1 >= src.length) break;
                const lo = src[srcPos++];
                const hi = src[srcPos++];
                const offset = ((hi & 0xF0) << 4) | lo;
                const length = (hi & 0x0F) + 3;

                if (offset === 0) continue;

                let readPos = dstPos - offset;
                if (readPos < 0) readPos = 0;

                for (let i = 0; i < length && dstPos < dstLen; i++) {
                    dst[dstPos++] = dst[readPos++];
                }
            }
        }
    }

    if (iterations >= maxIterations) {
        console.error('Decompression aborted: too many iterations');
    }

    return dst;
}

// Decode XOR-encoded header
function decodeHeader(data: Uint8Array, offset: number, length: number): Uint8Array {
    const result = new Uint8Array(length);
    const key = [0xB6, 0x9C, 0x76, 0x5A, 0x8D, 0xE3, 0x2C, 0xF9];

    for (let i = 0; i < length; i++) {
        result[i] = data[offset + i] ^ key[i % 8];
    }

    return result;
}

function readInt32LE(data: Uint8Array, offset: number): number {
    return data[offset] | (data[offset + 1] << 8) | (data[offset + 2] << 16) | (data[offset + 3] << 24);
}

function parseChunks(data: Uint8Array): ChunkInfo[] {
    const chunks: ChunkInfo[] = [];

    // Skip file header (8 bytes for checksum + version)
    let offset = 8;

    while (offset < data.length - 24) {
        // Decode chunk header
        const header = decodeHeader(data, offset, 24);

        const chunkType = readInt32LE(header, 0);
        const length = readInt32LE(header, 4);
        const unpackedLength = readInt32LE(header, 8);

        if (chunkType === 0) break;

        chunks.push({
            type: chunkType,
            offset: offset + 24,
            length,
            unpackedLength
        });

        offset += 24 + length;
    }

    return chunks;
}

function getChunkData(fileData: Uint8Array, chunk: ChunkInfo): Uint8Array {
    const rawData = fileData.slice(chunk.offset, chunk.offset + chunk.length);

    if (chunk.length === chunk.unpackedLength) {
        return rawData;
    }

    return decompress(rawData, chunk.unpackedLength);
}

function calcVariance(positions: Array<{x: number; y: number}>, mapWidth: number, mapHeight: number): number {
    if (positions.length < 10) return 0;
    const gridSize = 16;
    const cellW = Math.ceil(mapWidth / gridSize);
    const cellH = Math.ceil(mapHeight / gridSize);
    const grid: number[] = Array(gridSize * gridSize).fill(0);
    for (const pos of positions) {
        const cx = Math.min(gridSize - 1, Math.floor(pos.x / cellW));
        const cy = Math.min(gridSize - 1, Math.floor(pos.y / cellH));
        grid[cy * gridSize + cx]++;
    }
    const mean = grid.reduce((a, b) => a + b, 0) / grid.length;
    return grid.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / grid.length;
}

function analyzeCandidate(
    name: string,
    objectData: Uint8Array,
    groundType: Uint8Array,
    mapWidth: number,
    mapHeight: number,
    extractor: (d: Uint8Array, i: number) => number
): Candidate {
    const tileCount = mapWidth * mapHeight;
    const distribution = new Map<number, number>();
    const positions: Array<{x: number; y: number}> = [];
    let onWater = 0, onSnow = 0, onDesert = 0, onGrass = 0;

    for (let i = 0; i < tileCount; i++) {
        const val = extractor(objectData, i);
        if (val >= 1 && val <= 18) {
            distribution.set(val, (distribution.get(val) ?? 0) + 1);
            const x = i % mapWidth;
            const y = Math.floor(i / mapWidth);
            positions.push({ x, y });

            const gt = groundType[i];
            if (WATER_TYPES.has(gt)) onWater++;
            else if (SNOW_TYPES.has(gt)) onSnow++;
            else if (DESERT_TYPES.has(gt)) onDesert++;
            else if (GRASS_TYPES.has(gt)) onGrass++;
        }
    }

    const variance = calcVariance(positions, mapWidth, mapHeight);
    const count = positions.length;

    const idealMin = tileCount * 0.005;
    const idealMax = tileCount * 0.20;
    const countOK = count >= idealMin && count <= idealMax;

    const waterPenalty = count > 0 ? (onWater / count) * 100 : 0;
    const snowPenalty = count > 0 ? (onSnow / count) * 50 : 0;
    const grassBonus = count > 0 ? (onGrass / count) * 20 : 0;
    const typeBonus = Math.min(20, distribution.size * 2);
    const varianceBonus = Math.min(30, variance / 50);

    const score =
        (countOK ? 50 : count < idealMin ? count / idealMin * 25 : 25) +
        varianceBonus + typeBonus + grassBonus - waterPenalty - snowPenalty;

    return {
        name, count, variance,
        types: distribution.size,
        onWater, onSnow, onDesert, onGrass,
        distribution, score
    };
}

async function main() {
    const mapPath = process.argv[2];
    if (!mapPath) {
        console.log('Usage: npx tsx scripts/analyze-trees-simple.ts <map-path>');
        console.log('Example: npx tsx scripts/analyze-trees-simple.ts public/Siedler4/Map/Campaign/AO_Viking1.map');
        process.exit(1);
    }

    console.log(`\nAnalyzing: ${mapPath}\n`);

    const fileData = new Uint8Array(fs.readFileSync(mapPath));
    const chunks = parseChunks(fileData);

    console.log(`Found ${chunks.length} chunks`);

    // Find GeneralInfo (type 1) to get map size
    const generalChunk = chunks.find(c => c.type === 1);
    if (!generalChunk) {
        console.error('Could not find GeneralInfo chunk');
        process.exit(1);
    }

    const generalData = getChunkData(fileData, generalChunk);
    const mapWidth = readInt32LE(generalData, 12);
    const mapHeight = mapWidth; // Square maps
    const tileCount = mapWidth * mapHeight;

    console.log(`Map size: ${mapWidth}x${mapHeight} (${tileCount} tiles)`);

    // Find Landscape (type 13) to get ground types
    const landscapeChunk = chunks.find(c => c.type === 13);
    if (!landscapeChunk) {
        console.error('Could not find Landscape chunk');
        process.exit(1);
    }

    const landscapeData = getChunkData(fileData, landscapeChunk);
    console.log(`Landscape chunk: ${landscapeData.length} bytes`);

    // Extract ground type (byte 1 of each 4-byte tile)
    const groundType = new Uint8Array(tileCount);
    for (let i = 0; i < tileCount; i++) {
        groundType[i] = landscapeData[i * 4 + 1];
    }

    // Find MapObjects (type 6)
    const objectChunk = chunks.find(c => c.type === 6);
    if (!objectChunk) {
        console.error('Could not find MapObjects chunk');
        process.exit(1);
    }

    const objectData = getChunkData(fileData, objectChunk);
    const bytesPerTile = objectData.length / tileCount;

    console.log(`MapObjects chunk: ${objectData.length} bytes (${bytesPerTile} bytes/tile)`);
    console.log(`First 16 bytes: [${Array.from(objectData.slice(0, 16)).join(', ')}]`);

    // Analyze all candidates
    const candidates: Candidate[] = [];

    if (bytesPerTile === 4) {
        for (let b = 0; b < 4; b++) {
            candidates.push(analyzeCandidate(`INTRLV_B${b}`, objectData, groundType, mapWidth, mapHeight,
                (d, i) => d[i * 4 + b]));
        }

        for (let l = 0; l < 4; l++) {
            candidates.push(analyzeCandidate(`CONSEC_L${l}`, objectData, groundType, mapWidth, mapHeight,
                (d, i) => d[l * tileCount + i]));
        }

        candidates.push(analyzeCandidate('B0_IF_B2_64', objectData, groundType, mapWidth, mapHeight,
            (d, i) => (d[i * 4 + 2] === 64 || d[i * 4 + 2] === 65) ? d[i * 4] : 0));

        candidates.push(analyzeCandidate('B0_IF_B2_NZ', objectData, groundType, mapWidth, mapHeight,
            (d, i) => d[i * 4 + 2] !== 0 ? d[i * 4] : 0));

        candidates.push(analyzeCandidate('B0_OR_B1', objectData, groundType, mapWidth, mapHeight,
            (d, i) => {
                const b0 = d[i * 4], b1 = d[i * 4 + 1];
                return (b0 >= 1 && b0 <= 18) ? b0 : (b1 >= 1 && b1 <= 18) ? b1 : 0;
            }));
    }

    candidates.sort((a, b) => b.score - a.score);

    // Print results
    console.log('\n' + '='.repeat(100));
    console.log('CANDIDATE ANALYSIS (sorted by score)');
    console.log('='.repeat(100));
    console.log(
        'Name'.padEnd(14) +
        'Count'.padStart(8) +
        'Var'.padStart(7) +
        'Types'.padStart(6) +
        'Water'.padStart(7) +
        'Snow'.padStart(6) +
        'Desert'.padStart(7) +
        'Grass'.padStart(7) +
        'Score'.padStart(7) +
        '  Distribution'
    );
    console.log('-'.repeat(100));

    for (const c of candidates) {
        const distStr = [...c.distribution.entries()]
            .sort((a, b) => b[1] - a[1])
            .slice(0, 4)
            .map(([t, n]) => `${TREE_NAMES[t] || t}:${n}`)
            .join(', ');

        const waterPct = c.count > 0 ? (c.onWater / c.count * 100).toFixed(0) + '%' : '-';
        const snowPct = c.count > 0 ? (c.onSnow / c.count * 100).toFixed(0) + '%' : '-';
        const desertPct = c.count > 0 ? (c.onDesert / c.count * 100).toFixed(0) + '%' : '-';
        const grassPct = c.count > 0 ? (c.onGrass / c.count * 100).toFixed(0) + '%' : '-';

        console.log(
            c.name.padEnd(14) +
            c.count.toString().padStart(8) +
            c.variance.toFixed(0).padStart(7) +
            c.types.toString().padStart(6) +
            waterPct.padStart(7) +
            snowPct.padStart(6) +
            desertPct.padStart(7) +
            grassPct.padStart(7) +
            c.score.toFixed(1).padStart(7) +
            '  ' + distStr
        );
    }

    const best = candidates[0];
    console.log('\n' + '='.repeat(100));
    console.log(`BEST: ${best.name} - ${best.count} trees, ${best.variance.toFixed(0)} variance, ${best.types} types`);
    console.log('='.repeat(100));
}

main().catch(console.error);
