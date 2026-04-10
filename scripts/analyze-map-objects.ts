/**
 * Analyze tree distribution from a Settlers 4 map file.
 * Uses the project's OriginalMapLoader to properly decompress and parse chunks.
 *
 * Usage:
 *   npx tsx scripts/analyze-map-objects.ts <map-path>
 *   npx tsx scripts/analyze-map-objects.ts public/Siedler4/Map/Campaign/AO_Viking1.map
 */

import fs from 'fs';
import { OriginalMapLoader } from '@/resources/map/original/original-map/game-map-loader';
import { BinaryReader } from '@/resources/file/binary-reader';
import { S4TreeType } from '@/resources/map/s4-types';

// --- Helpers ---

function isTreeType(val: number): boolean {
    return val >= 1 && val <= 18;
}

function treeName(val: number): string {
    return S4TreeType[val] ?? `TYPE_${val}`;
}

interface TreeStats {
    count: number;
    byType: Map<number, number>;
    positions: Array<{ x: number; y: number; type: number }>;
}

function calculateSpatialVariance(
    positions: Array<{ x: number; y: number }>,
    mapWidth: number,
    mapHeight: number
): number {
    if (positions.length < 10) return 0;

    const gridSize = 16;
    const cellW = Math.ceil(mapWidth / gridSize);
    const cellH = Math.ceil(mapHeight / gridSize);
    const grid: number[][] = Array(gridSize)
        .fill(0)
        .map(() => Array(gridSize).fill(0) as number[]);

    for (const pos of positions) {
        const cx = Math.min(gridSize - 1, Math.floor(pos.x / cellW));
        const cy = Math.min(gridSize - 1, Math.floor(pos.y / cellH));
        grid[cy]![cx]!++;
    }

    const values = grid.flat();
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    return values.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / values.length;
}

function collectTreeStats(objects: Array<{ x: number; y: number; objectType: number }>): TreeStats {
    const byType = new Map<number, number>();
    const positions: Array<{ x: number; y: number; type: number }> = [];

    for (const obj of objects) {
        if (isTreeType(obj.objectType)) {
            byType.set(obj.objectType, (byType.get(obj.objectType) ?? 0) + 1);
            positions.push({ x: obj.x, y: obj.y, type: obj.objectType });
        }
    }

    return { count: positions.length, byType, positions };
}

// --- Main ---

function main(): void {
    const mapPath = process.argv[2];
    if (!mapPath) {
        console.log('Usage: npx tsx scripts/analyze-map-objects.ts <map-path>');
        console.log('Example: npx tsx scripts/analyze-map-objects.ts public/Siedler4/Map/Campaign/AO_Viking1.map');
        process.exit(1);
    }

    if (!fs.existsSync(mapPath)) {
        console.error(`File not found: ${mapPath}`);
        process.exit(1);
    }

    console.log(`Analyzing: ${mapPath}`);

    const buffer = fs.readFileSync(mapPath);
    const data = new Uint8Array(buffer);
    const reader = new BinaryReader(data, 0, data.byteLength, mapPath);
    const loader = new OriginalMapLoader(reader);

    const mapWidth = loader.mapSize.width;
    const mapHeight = loader.mapSize.height;
    console.log(`Map size: ${mapWidth}x${mapHeight}`);

    const entities = loader.entityData;
    const tileCount = mapWidth * mapHeight;

    // --- Tree analysis ---
    const stats = collectTreeStats(entities.objects);
    const variance = calculateSpatialVariance(stats.positions, mapWidth, mapHeight);

    console.log(`\n${'='.repeat(60)}`);
    console.log('TREE ANALYSIS');
    console.log('='.repeat(60));
    console.log(`Total objects: ${entities.objects.length}`);
    console.log(`Total trees: ${stats.count}`);
    console.log(`Non-tree objects: ${entities.objects.length - stats.count}`);
    console.log(`Tree coverage: ${((stats.count / tileCount) * 100).toFixed(2)}%`);
    console.log(`Spatial variance: ${variance.toFixed(1)} (higher = more clustered)`);
    console.log(`Tree species: ${stats.byType.size}`);

    if (stats.count > 0) {
        console.log('\nDistribution by type:');
        const sorted = [...stats.byType.entries()].sort((a, b) => b[1] - a[1]);
        for (const [type, count] of sorted) {
            const pct = ((count / stats.count) * 100).toFixed(1);
            console.log(
                `  ${treeName(type).padEnd(14)} (#${type.toString().padStart(2)}): ${count.toString().padStart(6)} (${pct}%)`
            );
        }
    }

    // --- Non-tree objects summary ---
    const nonTreeTypes = new Map<number, number>();
    for (const obj of entities.objects) {
        if (!isTreeType(obj.objectType)) {
            nonTreeTypes.set(obj.objectType, (nonTreeTypes.get(obj.objectType) ?? 0) + 1);
        }
    }

    if (nonTreeTypes.size > 0) {
        console.log(`\n${'='.repeat(60)}`);
        console.log('NON-TREE OBJECTS');
        console.log('='.repeat(60));
        const sorted = [...nonTreeTypes.entries()].sort((a, b) => b[1] - a[1]);
        for (const [type, count] of sorted) {
            console.log(`  Object type ${type.toString().padStart(3)}: ${count.toString().padStart(6)}`);
        }
    }
}

main();
