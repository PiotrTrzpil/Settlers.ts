/**
 * Script to analyze MapObjects chunk (type 6) with multiple parsing approaches
 * Run with: npx ts-node scripts/analyze-map-objects.ts <map-file-path>
 */

import * as fs from 'fs';

// Tree type names for display
const TREE_NAMES: Record<number, string> = {
    1: 'OAK', 2: 'BEECH', 3: 'ASH', 4: 'LINDEN', 5: 'BIRCH',
    6: 'POPLAR', 7: 'CHESTNUT', 8: 'MAPLE', 9: 'FIR', 10: 'SPRUCE',
    11: 'COCONUT', 12: 'DATE', 13: 'WALNUT', 14: 'CORKOAK',
    15: 'PINE', 16: 'PINE2', 17: 'OLIVE_L', 18: 'OLIVE_S'
};

interface TreeResult {
    name: string;
    count: number;
    byType: Map<number, number>;
    positions: Array<{x: number; y: number; type: number}>;
    spatialVariance: number; // Higher = more clustered
}

function isTreeType(val: number): boolean {
    return val >= 1 && val <= 18;
}

function calculateSpatialVariance(positions: Array<{x: number; y: number}>, mapWidth: number, mapHeight: number): number {
    if (positions.length < 10) return 0;

    // Divide map into 16x16 grid and count trees per cell
    const gridSize = 16;
    const cellW = Math.ceil(mapWidth / gridSize);
    const cellH = Math.ceil(mapHeight / gridSize);
    const grid: number[][] = Array(gridSize).fill(0).map(() => Array(gridSize).fill(0));

    for (const pos of positions) {
        const cx = Math.min(gridSize - 1, Math.floor(pos.x / cellW));
        const cy = Math.min(gridSize - 1, Math.floor(pos.y / cellH));
        grid[cy][cx]++;
    }

    // Calculate variance of grid cell counts
    const values = grid.flat();
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    const variance = values.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / values.length;

    return variance;
}

function analyzeApproach(
    name: string,
    data: Uint8Array,
    mapWidth: number,
    mapHeight: number,
    extractor: (data: Uint8Array, tileIndex: number) => number
): TreeResult {
    const tileCount = mapWidth * mapHeight;
    const byType = new Map<number, number>();
    const positions: Array<{x: number; y: number; type: number}> = [];

    for (let i = 0; i < tileCount; i++) {
        const val = extractor(data, i);
        if (isTreeType(val)) {
            byType.set(val, (byType.get(val) ?? 0) + 1);
            positions.push({
                x: i % mapWidth,
                y: Math.floor(i / mapWidth),
                type: val
            });
        }
    }

    const spatialVariance = calculateSpatialVariance(positions, mapWidth, mapHeight);

    return {
        name,
        count: positions.length,
        byType,
        positions,
        spatialVariance
    };
}

function printResult(r: TreeResult): void {
    console.log(`\n=== ${r.name} ===`);
    console.log(`Total trees: ${r.count}`);
    console.log(`Spatial variance: ${r.spatialVariance.toFixed(1)} (higher = more clustered)`);

    if (r.count > 0 && r.count < 500000) {
        console.log('Distribution by type:');
        const sorted = [...r.byType.entries()].sort((a, b) => b[1] - a[1]);
        for (const [type, count] of sorted) {
            const pct = (count / r.count * 100).toFixed(1);
            const name = TREE_NAMES[type] || `TYPE_${type}`;
            console.log(`  ${name.padEnd(10)} (#${type.toString().padStart(2)}): ${count.toString().padStart(6)} (${pct}%)`);
        }
    }
}

async function main() {
    const mapPath = process.argv[2];
    if (!mapPath) {
        console.log('Usage: npx ts-node scripts/analyze-map-objects.ts <map-file-path>');
        console.log('Example: npx ts-node scripts/analyze-map-objects.ts public/Siedler4/Map/Campaign/AO_Viking1.map');
        process.exit(1);
    }

    console.log(`Analyzing: ${mapPath}`);

    // Read the map file
    const fileData = fs.readFileSync(mapPath);
    const buffer = new Uint8Array(fileData);

    // Find chunk 6 (MapObjects) - simplified parser
    // Map files have 8-byte header, then chunks with: offset(4) + type(4) + checksum(4) + unpackedLen(4) + packedLen(4)
    let offset = 8; // Skip main header
    let mapObjectsData: Uint8Array | null = null;
    let mapWidth = 0;
    let mapHeight = 0;

    // First find GeneralInfo chunk (type 1) to get map size
    while (offset < buffer.length - 20) {
        const _chunkOffset = buffer[offset] | (buffer[offset+1] << 8) | (buffer[offset+2] << 16) | (buffer[offset+3] << 24);
        const chunkType = buffer[offset+4] | (buffer[offset+5] << 8) | (buffer[offset+6] << 16) | (buffer[offset+7] << 24);
        const unpackedLen = buffer[offset+12] | (buffer[offset+13] << 8) | (buffer[offset+14] << 16) | (buffer[offset+15] << 24);
        const packedLen = buffer[offset+16] | (buffer[offset+17] << 8) | (buffer[offset+18] << 16) | (buffer[offset+19] << 24);

        if (chunkType === 0) break;

        const dataOffset = offset + 20;
        const dataLen = packedLen > 0 ? packedLen : unpackedLen;

        if (chunkType === 1 && unpackedLen >= 16) {
            // GeneralInfo - read map size at offset 12-16
            const sizeOffset = dataOffset + 12;
            mapWidth = buffer[sizeOffset] | (buffer[sizeOffset+1] << 8) | (buffer[sizeOffset+2] << 16) | (buffer[sizeOffset+3] << 24);
            mapHeight = mapWidth; // Square maps
            console.log(`Map size: ${mapWidth}x${mapHeight}`);
        }

        if (chunkType === 6) {
            mapObjectsData = buffer.slice(dataOffset, dataOffset + dataLen);
            console.log(`MapObjects chunk: ${mapObjectsData.length} bytes`);
        }

        offset += 20 + dataLen;
    }

    if (!mapObjectsData || mapWidth === 0) {
        console.error('Could not find MapObjects chunk or map size');
        process.exit(1);
    }

    const tileCount = mapWidth * mapHeight;
    const bytesPerTile = mapObjectsData.length / tileCount;
    console.log(`Bytes per tile: ${bytesPerTile}`);

    const results: TreeResult[] = [];

    // === INTERLEAVED APPROACHES (4 bytes per tile) ===
    if (bytesPerTile === 4) {
        // Byte 0
        results.push(analyzeApproach('INTERLEAVED: Byte 0', mapObjectsData, mapWidth, mapHeight,
            (d, i) => d[i * 4]));

        // Byte 1
        results.push(analyzeApproach('INTERLEAVED: Byte 1', mapObjectsData, mapWidth, mapHeight,
            (d, i) => d[i * 4 + 1]));

        // Byte 2
        results.push(analyzeApproach('INTERLEAVED: Byte 2', mapObjectsData, mapWidth, mapHeight,
            (d, i) => d[i * 4 + 2]));

        // Byte 3
        results.push(analyzeApproach('INTERLEAVED: Byte 3', mapObjectsData, mapWidth, mapHeight,
            (d, i) => d[i * 4 + 3]));

        // Byte 0 where Byte 2 has flag (64 or 65)
        results.push(analyzeApproach('INTERLEAVED: Byte 0 where Byte2=64|65', mapObjectsData, mapWidth, mapHeight,
            (d, i) => (d[i * 4 + 2] === 64 || d[i * 4 + 2] === 65) ? d[i * 4] : 0));

        // Byte 0 where Byte 2 != 0
        results.push(analyzeApproach('INTERLEAVED: Byte 0 where Byte2!=0', mapObjectsData, mapWidth, mapHeight,
            (d, i) => d[i * 4 + 2] !== 0 ? d[i * 4] : 0));

        // === CONSECUTIVE SUB-CHUNK APPROACHES ===
        for (let layer = 0; layer < 4; layer++) {
            results.push(analyzeApproach(`CONSECUTIVE: Layer ${layer}`, mapObjectsData, mapWidth, mapHeight,
                (d, i) => d[layer * tileCount + i]));
        }

        // === 16-BIT VALUE APPROACHES ===
        results.push(analyzeApproach('16-BIT LE: Low word', mapObjectsData, mapWidth, mapHeight,
            (d, i) => d[i * 4] | (d[i * 4 + 1] << 8)));

        results.push(analyzeApproach('16-BIT LE: High word', mapObjectsData, mapWidth, mapHeight,
            (d, i) => d[i * 4 + 2] | (d[i * 4 + 3] << 8)));

        // === COMBINED APPROACHES ===
        // Byte 0 OR Byte 1 (take first non-zero)
        results.push(analyzeApproach('COMBINED: Byte0 OR Byte1', mapObjectsData, mapWidth, mapHeight,
            (d, i) => {
                const b0 = d[i * 4];
                const b1 = d[i * 4 + 1];
                if (isTreeType(b0)) return b0;
                if (isTreeType(b1)) return b1;
                return 0;
            }));

        // XOR of bytes (looking for encoded values)
        results.push(analyzeApproach('XOR: Byte0 XOR Byte2', mapObjectsData, mapWidth, mapHeight,
            (d, i) => d[i * 4] ^ d[i * 4 + 2]));
    }

    // === PRINT RESULTS ===
    console.log('\n' + '='.repeat(60));
    console.log('ANALYSIS RESULTS');
    console.log('='.repeat(60));

    // Sort by a score: we want reasonable tree count + good spatial variance
    const scored = results.map(r => {
        // Ideal tree count: 5,000-50,000 for a 640x640 map
        const idealMin = tileCount * 0.01; // 1%
        const idealMax = tileCount * 0.15; // 15%
        const countScore = r.count >= idealMin && r.count <= idealMax ? 100 :
            r.count < idealMin ? r.count / idealMin * 50 :
                Math.max(0, 50 - (r.count - idealMax) / idealMax * 50);

        // Higher variance is better (clustered forests vs uniform)
        const varianceScore = Math.min(100, r.spatialVariance / 100);

        // Diversity: more tree types = more realistic
        const diversityScore = Math.min(100, r.byType.size * 10);

        const total = countScore * 0.5 + varianceScore * 0.3 + diversityScore * 0.2;

        return { result: r, score: total, countScore, varianceScore, diversityScore };
    });

    scored.sort((a, b) => b.score - a.score);

    // Print top 5 candidates
    console.log('\nTOP 5 CANDIDATES (by realism score):');
    for (let i = 0; i < Math.min(5, scored.length); i++) {
        const s = scored[i];
        console.log(`\n#${i + 1}: Score ${s.score.toFixed(1)} (count:${s.countScore.toFixed(0)}, var:${s.varianceScore.toFixed(0)}, div:${s.diversityScore.toFixed(0)})`);
        printResult(s.result);
    }

    // Print all results summary
    console.log('\n' + '='.repeat(60));
    console.log('ALL RESULTS SUMMARY');
    console.log('='.repeat(60));
    console.log('Name'.padEnd(40) + 'Count'.padStart(8) + 'Variance'.padStart(10) + 'Types'.padStart(6));
    console.log('-'.repeat(64));
    for (const s of scored) {
        const r = s.result;
        console.log(
            r.name.padEnd(40) +
            r.count.toString().padStart(8) +
            r.spatialVariance.toFixed(1).padStart(10) +
            r.byType.size.toString().padStart(6)
        );
    }
}

main().catch(console.error);
