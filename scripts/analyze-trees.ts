/* eslint-disable complexity */
/**
 * Analyze tree data from map files - tries multiple parsing approaches
 * Run with: npx vite-node scripts/analyze-trees.ts <map-path>
 *
 * Example: npx vite-node scripts/analyze-trees.ts public/Siedler4/Map/Campaign/AO_Viking1.map
 */

import * as fs from 'fs';
import { BinaryReader } from '../src/resources/file/binary-reader';
import { OriginalMapLoader } from '../src/resources/map/original/original-map/game-map-loader';
import { MapChunkType } from '../src/resources/map/original/map-chunk-type';
import { S4GroundType } from '../src/resources/map/s4-types';

const TREE_NAMES: Record<number, string> = {
    1: 'OAK', 2: 'BEECH', 3: 'ASH', 4: 'LINDEN', 5: 'BIRCH',
    6: 'POPLAR', 7: 'CHESTNUT', 8: 'MAPLE', 9: 'FIR', 10: 'SPRUCE',
    11: 'COCONUT', 12: 'DATE', 13: 'WALNUT', 14: 'CORKOAK',
    15: 'PINE', 16: 'PINE2', 17: 'OLIVE_L', 18: 'OLIVE_S'
};

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

function isWater(groundType: number): boolean {
    return groundType >= S4GroundType.WATER1 && groundType <= S4GroundType.WATER8;
}

function isSnow(groundType: number): boolean {
    return groundType === S4GroundType.SNOW || groundType === S4GroundType.SNOW_ROCK;
}

function isDesert(groundType: number): boolean {
    return groundType === S4GroundType.DESERT || groundType === S4GroundType.DESERT_GRASS;
}

function isGrass(groundType: number): boolean {
    return groundType === S4GroundType.GRASS ||
           groundType === S4GroundType.GRASS_ROCK ||
           groundType === S4GroundType.GRASS_ISLE ||
           groundType === S4GroundType.DARKGRASS ||
           groundType === S4GroundType.DARKGRASS_GRASS;
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
            if (isWater(gt)) onWater++;
            else if (isSnow(gt)) onSnow++;
            else if (isDesert(gt)) onDesert++;
            else if (isGrass(gt)) onGrass++;
        }
    }

    const variance = calcVariance(positions, mapWidth, mapHeight);
    const count = positions.length;

    // Scoring
    const idealMin = tileCount * 0.005;
    const idealMax = tileCount * 0.20;
    const countOK = count >= idealMin && count <= idealMax;

    // Penalize trees on water/snow heavily
    const waterPenalty = count > 0 ? (onWater / count) * 100 : 0;
    const snowPenalty = count > 0 ? (onSnow / count) * 50 : 0;

    // Reward trees on grass
    const grassBonus = count > 0 ? (onGrass / count) * 20 : 0;

    // Good variety of tree types
    const typeBonus = Math.min(20, distribution.size * 2);

    // Clustered distribution (higher variance = more clustered)
    const varianceBonus = Math.min(30, variance / 50);

    const score =
        (countOK ? 50 : count < idealMin ? count / idealMin * 25 : 25) +
        varianceBonus +
        typeBonus +
        grassBonus -
        waterPenalty -
        snowPenalty;

    return {
        name,
        count,
        variance,
        types: distribution.size,
        onWater,
        onSnow,
        onDesert,
        onGrass,
        distribution,
        score
    };
}

async function main() {
    const mapPath = process.argv[2];
    if (!mapPath) {
        console.log('Usage: npx vite-node scripts/analyze-trees.ts <map-path>');
        console.log('Example: npx vite-node scripts/analyze-trees.ts public/Siedler4/Map/Campaign/AO_Viking1.map');
        process.exit(1);
    }

    console.log(`\nAnalyzing: ${mapPath}\n`);

    // Read map file
    const fileData = fs.readFileSync(mapPath);
    const buffer = new Uint8Array(fileData);
    const reader = new BinaryReader(buffer);
    reader.filename = mapPath;

    // Load map
    const loader = new OriginalMapLoader(reader);
    const mapWidth = loader.mapSize.width;
    const mapHeight = loader.mapSize.height;
    const tileCount = mapWidth * mapHeight;

    console.log(`Map size: ${mapWidth}x${mapHeight} (${tileCount} tiles)`);

    // Get landscape data (for terrain validation)
    const groundType = loader.landscape.getGroundType();

    // Get MapObjects chunk
    const objectReader = (loader as any).getChunkReader(MapChunkType.MapObjects);
    if (!objectReader) {
        console.error('Could not find MapObjects chunk');
        process.exit(1);
    }

    const objectData = objectReader.getBuffer();
    const bytesPerTile = objectData.length / tileCount;

    console.log(`MapObjects chunk: ${objectData.length} bytes (${bytesPerTile} bytes/tile)`);
    console.log(`First 16 bytes: [${Array.from(objectData.slice(0, 16)).join(', ')}]`);

    // Analyze all candidates
    const candidates: Candidate[] = [];

    if (bytesPerTile === 4) {
        // Interleaved approaches
        for (let b = 0; b < 4; b++) {
            candidates.push(analyzeCandidate(`INTRLV_B${b}`, objectData, groundType, mapWidth, mapHeight,
                (d, i) => d[i * 4 + b]));
        }

        // Consecutive sub-chunks
        for (let l = 0; l < 4; l++) {
            candidates.push(analyzeCandidate(`CONSEC_L${l}`, objectData, groundType, mapWidth, mapHeight,
                (d, i) => d[l * tileCount + i]));
        }

        // Byte 0 with presence flag
        candidates.push(analyzeCandidate('B0_IF_B2_64', objectData, groundType, mapWidth, mapHeight,
            (d, i) => (d[i * 4 + 2] === 64 || d[i * 4 + 2] === 65) ? d[i * 4] : 0));

        candidates.push(analyzeCandidate('B0_IF_B2_NZ', objectData, groundType, mapWidth, mapHeight,
            (d, i) => d[i * 4 + 2] !== 0 ? d[i * 4] : 0));

        // Combined approaches
        candidates.push(analyzeCandidate('B0_OR_B1', objectData, groundType, mapWidth, mapHeight,
            (d, i) => {
                const b0 = d[i * 4], b1 = d[i * 4 + 1];
                return (b0 >= 1 && b0 <= 18) ? b0 : (b1 >= 1 && b1 <= 18) ? b1 : 0;
            }));

        // Byte 0 AND Byte 1
        candidates.push(analyzeCandidate('B0_AND_B1', objectData, groundType, mapWidth, mapHeight,
            (d, i) => {
                const b0 = d[i * 4], b1 = d[i * 4 + 1];
                return (b0 >= 1 && b0 <= 18 && b1 >= 1 && b1 <= 18) ? b0 : 0;
            }));
    }

    // Sort by score
    candidates.sort((a, b) => b.score - a.score);

    // Print results
    console.log('\n' + '='.repeat(100));
    console.log('CANDIDATE ANALYSIS');
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

    // Detailed view of top candidate
    const best = candidates[0];
    console.log('\n' + '='.repeat(100));
    console.log(`BEST CANDIDATE: ${best.name}`);
    console.log('='.repeat(100));
    console.log(`Total trees: ${best.count}`);
    console.log(`Spatial variance: ${best.variance.toFixed(1)} (higher = more clustered)`);
    console.log(`Tree types: ${best.types}`);
    console.log(`On water: ${best.onWater} (${(best.onWater / best.count * 100).toFixed(1)}%)`);
    console.log(`On snow: ${best.onSnow} (${(best.onSnow / best.count * 100).toFixed(1)}%)`);
    console.log(`On desert: ${best.onDesert} (${(best.onDesert / best.count * 100).toFixed(1)}%)`);
    console.log(`On grass: ${best.onGrass} (${(best.onGrass / best.count * 100).toFixed(1)}%)`);
    console.log('\nFull distribution:');
    const sortedDist = [...best.distribution.entries()].sort((a, b) => b[1] - a[1]);
    for (const [type, count] of sortedDist) {
        const pct = (count / best.count * 100).toFixed(1);
        console.log(`  ${(TREE_NAMES[type] || `TYPE_${type}`).padEnd(10)}: ${count.toString().padStart(6)} (${pct}%)`);
    }

    console.log('\n' + '='.repeat(100));
    console.log('RECOMMENDATION:');
    if (best.onWater / best.count > 0.1) {
        console.log('WARNING: >10% of trees are on water - this candidate is likely WRONG');
    }
    if (best.count < tileCount * 0.001) {
        console.log('WARNING: Very few trees (<0.1% of tiles) - may need procedural generation');
    }
    if (best.variance < 50) {
        console.log('WARNING: Low spatial variance - trees are uniformly distributed (unnatural)');
    }
    if (best.types < 3) {
        console.log('WARNING: Only 1-2 tree types - may be reading wrong data');
    }

    if (best.score > 50 && best.onWater / best.count < 0.01 && best.variance > 100) {
        console.log(`GOOD: "${best.name}" appears to be a valid tree data source`);
    } else {
        console.log('Consider trying other maps or investigating the data format further');
    }
}

main().catch(console.error);
