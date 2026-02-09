/* eslint-disable complexity */
/**
 * Parser for MapObjects chunk (type 6)
 * Extracts map object data (trees, decorations) from map files
 *
 * IMPORTANT: This chunk contains TILE-BASED data (one value per map tile),
 * NOT entity-based data like buildings/settlers. Each byte represents the
 * object type at that tile position.
 */

import { BinaryReader } from '@/resources/file/binary-reader';
import { LogHandler } from '@/utilities/log-handler';
import { S4TreeType } from '../../s4-types';
import type { MapObjectData } from '../../map-entity-data';

const log = new LogHandler('ObjectParser');

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
    distribution: Map<number, number>;
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
    data: Uint8Array,
    mapWidth: number,
    mapHeight: number,
    extractor: (d: Uint8Array, i: number) => number
): Candidate {
    const tileCount = mapWidth * mapHeight;
    const distribution = new Map<number, number>();
    const positions: Array<{x: number; y: number}> = [];

    for (let i = 0; i < tileCount; i++) {
        const val = extractor(data, i);
        if (val >= 1 && val <= 18) {
            distribution.set(val, (distribution.get(val) ?? 0) + 1);
            positions.push({ x: i % mapWidth, y: Math.floor(i / mapWidth) });
        }
    }

    return {
        name,
        count: positions.length,
        variance: calcVariance(positions, mapWidth, mapHeight),
        types: distribution.size,
        distribution
    };
}

/**
 * Parse MapObjects chunk data
 */
export function parseMapObjects(
    reader: BinaryReader,
    mapWidth: number,
    mapHeight: number
): MapObjectData[] {
    const objects: MapObjectData[] = [];
    const dataLength = reader.length;

    if (dataLength === 0) {
        log.debug('Empty map objects chunk');
        return objects;
    }

    const tileCount = mapWidth * mapHeight;
    const data = reader.getBuffer();
    const bytesPerTile = dataLength / tileCount;

    log.debug(`MapObjects: ${dataLength} bytes, ${mapWidth}x${mapHeight} map, ${bytesPerTile} bytes/tile`);

    // Analyze all candidates
    const candidates: Candidate[] = [];

    if (bytesPerTile === 4) {
        // Interleaved approaches
        for (let b = 0; b < 4; b++) {
            candidates.push(analyzeCandidate(`INTRLV_B${b}`, data, mapWidth, mapHeight, (d, i) => d[i * 4 + b]));
        }

        // Consecutive sub-chunks
        for (let l = 0; l < 4; l++) {
            candidates.push(analyzeCandidate(`CONSEC_L${l}`, data, mapWidth, mapHeight, (d, i) => d[l * tileCount + i]));
        }

        // Byte 0 with presence flag check
        candidates.push(analyzeCandidate('B0_IF_B2_64', data, mapWidth, mapHeight,
            (d, i) => (d[i * 4 + 2] === 64 || d[i * 4 + 2] === 65) ? d[i * 4] : 0));

        candidates.push(analyzeCandidate('B0_IF_B2_NZ', data, mapWidth, mapHeight,
            (d, i) => d[i * 4 + 2] !== 0 ? d[i * 4] : 0));

        // Combined byte 0 OR byte 1
        candidates.push(analyzeCandidate('B0_OR_B1', data, mapWidth, mapHeight,
            (d, i) => {
                const b0 = d[i * 4], b1 = d[i * 4 + 1];
                return (b0 >= 1 && b0 <= 18) ? b0 : (b1 >= 1 && b1 <= 18) ? b1 : 0;
            }));
    }

    // Score and rank candidates
    const scored = candidates.map(c => {
        const idealMin = tileCount * 0.005; // 0.5% min
        const idealMax = tileCount * 0.20;  // 20% max
        const countOK = c.count >= idealMin && c.count <= idealMax;
        const score = (countOK ? 50 : c.count < idealMin ? c.count / idealMin * 25 : 25) +
            Math.min(30, c.variance / 50) +
            Math.min(20, c.types * 2);
        return { ...c, score };
    }).sort((a, b) => b.score - a.score);

    // Print ranking table
    log.debug('\n=== CANDIDATE RANKING ===');
    log.debug('Name           Count    Var   Types  Score  Distribution');
    log.debug('-'.repeat(75));
    for (const c of scored) {
        const distStr = [...c.distribution.entries()]
            .sort((a, b) => b[1] - a[1])
            .slice(0, 5)
            .map(([t, n]) => `${TREE_NAMES[t] || t}:${n}`)
            .join(', ');
        log.debug(
            `${c.name.padEnd(14)} ${c.count.toString().padStart(7)} ${c.variance.toFixed(0).padStart(6)} ` +
            `${c.types.toString().padStart(5)}  ${c.score.toFixed(1).padStart(5)}  ${distStr}`
        );
    }

    // Use the best candidate
    const best = scored[0];
    log.debug(`\nUsing: ${best.name} (${best.count} trees, variance=${best.variance.toFixed(0)})`);

    // Re-extract with the best approach
    let extractor: (d: Uint8Array, i: number) => number;
    if (best.name.startsWith('INTRLV_B')) {
        const b = parseInt(best.name.slice(-1));
        extractor = (d, i) => d[i * 4 + b];
    } else if (best.name.startsWith('CONSEC_L')) {
        const l = parseInt(best.name.slice(-1));
        extractor = (d, i) => d[l * tileCount + i];
    } else if (best.name === 'B0_IF_B2_64') {
        extractor = (d, i) => (d[i * 4 + 2] === 64 || d[i * 4 + 2] === 65) ? d[i * 4] : 0;
    } else if (best.name === 'B0_IF_B2_NZ') {
        extractor = (d, i) => d[i * 4 + 2] !== 0 ? d[i * 4] : 0;
    } else if (best.name === 'B0_OR_B1') {
        extractor = (d, i) => {
            const b0 = d[i * 4], b1 = d[i * 4 + 1];
            return (b0 >= 1 && b0 <= 18) ? b0 : (b1 >= 1 && b1 <= 18) ? b1 : 0;
        };
    } else {
        extractor = (d, i) => d[i * 4]; // Default fallback
    }

    for (let i = 0; i < tileCount; i++) {
        const val = extractor(data, i);
        if (val >= 1 && val <= 18) {
            objects.push({
                x: i % mapWidth,
                y: Math.floor(i / mapWidth),
                objectType: val as S4TreeType
            });
        }
    }

    // Check if it's 1 byte per tile format
    if (dataLength === tileCount) {
        log.debug('Format: 1 byte per tile');
        for (let tileIndex = 0; tileIndex < tileCount; tileIndex++) {
            const objectType = data[tileIndex];
            if (objectType >= S4TreeType.OAK && objectType <= S4TreeType.OLIVE_SMALL) {
                objects.push({
                    x: tileIndex % mapWidth,
                    y: Math.floor(tileIndex / mapWidth),
                    objectType: objectType as S4TreeType,
                });
            }
        }
    }
    // Check if it's 4 bytes per tile format
    else if (dataLength === tileCount * 4) {
        log.debug('Format: 4 bytes per tile - analyzing structure...');

        // Log sample tiles with non-zero byte 0
        let samplesLogged = 0;
        for (let tileIndex = 0; tileIndex < tileCount && samplesLogged < 10; tileIndex++) {
            const offset = tileIndex * 4;
            if (data[offset] !== 0) {
                const x = tileIndex % mapWidth;
                const y = Math.floor(tileIndex / mapWidth);
                log.debug(`  Tile (${x},${y}): [${data[offset]}, ${data[offset+1]}, ${data[offset+2]}, ${data[offset+3]}]`);
                samplesLogged++;
            }
        }

        // Try interpreting as 4 separate layers (each layer is 1 byte per tile)
        // This would mean: layer0 = bytes 0,4,8..., layer1 = bytes 1,5,9..., etc.
        log.debug('Checking if data is 4 interleaved layers:');
        for (let layer = 0; layer < 4; layer++) {
            let treeCount = 0;
            for (let tileIndex = 0; tileIndex < tileCount; tileIndex++) {
                const val = data[tileIndex * 4 + layer];
                if (val >= S4TreeType.OAK && val <= S4TreeType.OLIVE_SMALL) {
                    treeCount++;
                }
            }
            log.debug(`  Layer ${layer} (byte offset ${layer}): ${treeCount} tree types`);
        }

        // Also check if it's 4 consecutive sub-chunks (each is mapWidth*mapHeight bytes)
        log.debug('Checking if data is 4 consecutive sub-chunks:');
        for (let subChunk = 0; subChunk < 4; subChunk++) {
            let treeCount = 0;
            const chunkStart = subChunk * tileCount;
            for (let i = 0; i < tileCount; i++) {
                const val = data[chunkStart + i];
                if (val >= S4TreeType.OAK && val <= S4TreeType.OLIVE_SMALL) {
                    treeCount++;
                }
            }
            log.debug(`  SubChunk ${subChunk} (bytes ${chunkStart}-${chunkStart + tileCount - 1}): ${treeCount} tree types`);
        }

        // Data is interleaved: [byte0, byte1, byte2, byte3] per tile
        // Byte 0 appears to be the object type at specific locations (sparse, not uniform)
        // The sample tiles show trees (11, 12) at clustered positions, not uniform distribution

        // Analyze byte 0 values to understand object type distribution
        const byte0Distribution = new Map<number, number>();
        for (let tileIndex = 0; tileIndex < tileCount; tileIndex++) {
            const val = data[tileIndex * 4];
            if (val !== 0) {
                byte0Distribution.set(val, (byte0Distribution.get(val) ?? 0) + 1);
            }
        }

        const sortedByte0 = [...byte0Distribution.entries()].sort((a, b) => b[1] - a[1]);
        log.debug('Byte 0 (interleaved) non-zero value distribution:');
        for (const [val, count] of sortedByte0.slice(0, 15)) {
            const isTree = val >= S4TreeType.OAK && val <= S4TreeType.OLIVE_SMALL;
            log.debug(`  Value ${val}: ${count} tiles${isTree ? ' (TREE)' : ''}`);
        }

        // Format analysis:
        // - Byte 0: Object type (tree 1-18, or other decoration >18)
        // - Byte 1: Zone/biome ID (NOT tree types - values 1-4 create uniform zones)
        // - Byte 2: Presence/flags (1=empty, 64/65=has object)
        // - Byte 3: Unknown attribute

        // Use byte 0 for explicit tree placements
        // Note: This gives ~1,230 trees which may be "seed trees"
        // that S4 expands procedurally at runtime based on zones
        log.debug('Using byte 0 for tree types (explicit placements only)');
        for (let tileIndex = 0; tileIndex < tileCount; tileIndex++) {
            const offset = tileIndex * 4;
            const objectType = data[offset]; // Byte 0 = object type
            if (objectType >= S4TreeType.OAK && objectType <= S4TreeType.OLIVE_SMALL) {
                objects.push({
                    x: tileIndex % mapWidth,
                    y: Math.floor(tileIndex / mapWidth),
                    objectType: objectType as S4TreeType,
                });
            }
        }
    }
    else {
        log.debug(`Unknown format: ${dataLength} bytes doesn't match 1 or 4 bytes per tile`);
        // Try reading as 1 byte per tile anyway up to tileCount
        const readCount = Math.min(dataLength, tileCount);
        for (let i = 0; i < readCount; i++) {
            const objectType = data[i];
            if (objectType >= S4TreeType.OAK && objectType <= S4TreeType.OLIVE_SMALL) {
                objects.push({
                    x: i % mapWidth,
                    y: Math.floor(i / mapWidth),
                    objectType: objectType as S4TreeType,
                });
            }
        }
    }

    log.debug(`Parsed ${objects.length} map objects (trees)`);
    return objects;
}
