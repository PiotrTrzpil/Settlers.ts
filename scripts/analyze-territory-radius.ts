/**
 * Analyze territory radius from map data.
 *
 * For each non-territory building, finds the NEAREST castle/tower of the same player.
 * Groups by which tower type is nearest, then shows the distance distribution.
 * This tells us: "what radius does each tower type need to cover its buildings?"
 *
 * Run: npx tsx scripts/analyze-territory-radius.ts
 */
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { BinaryReader } from '../src/resources/file/binary-reader';
import { OriginalMapFile } from '../src/resources/map/original/original-map-file';
import { MapChunkType } from '../src/resources/map/original/map-chunk-type';
import { parseBuildings } from '../src/resources/map/original/chunk-parsers';
import { S4BuildingType } from '../src/resources/map/s4-types';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const TERRITORY_TYPES = new Set([S4BuildingType.CASTLE, S4BuildingType.GUARDTOWERSMALL, S4BuildingType.GUARDTOWERBIG]);

const TERRITORY_NAMES: Record<number, string> = {
    [S4BuildingType.CASTLE]: 'Castle',
    [S4BuildingType.GUARDTOWERSMALL]: 'SmallTower',
    [S4BuildingType.GUARDTOWERBIG]: 'BigTower',
};

interface NearestTowerHit {
    map: string;
    player: number;
    towerType: string;
    dist: number;
    buildingType: number;
    bx: number;
    by: number;
    tx: number;
    ty: number;
}

/**
 * Compute the "required radius" parameter for fillCircle to cover this tile offset.
 * Mirrors the exact formula used in isInsideIsoEllipse:
 *   screenR = radius * 0.5
 *   sx = dx - dy * 0.5
 *   sy = dy * 0.5 / 0.7
 *   inside when sx² + sy² ≤ screenR²
 *
 * So: screenDist = sqrt(sx² + sy²), requiredRadius = screenDist * 2
 */
const Y_SCALE = 1.0 / 0.7;

function requiredRadius(x1: number, y1: number, x2: number, y2: number): number {
    const dx = x2 - x1;
    const dy = y2 - y1;
    const sx = dx - dy * 0.5;
    const sy = dy * 0.5 * Y_SCALE;
    const screenDist = Math.sqrt(sx * sx + sy * sy);
    return screenDist * 2; // because fillCircle uses screenR = radius * 0.5
}

function findMapFiles(baseDir: string): string[] {
    const results: string[] = [];
    function walk(dir: string) {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) walk(full);
            else if (entry.name.endsWith('.map') || entry.name.endsWith('.edm')) results.push(full);
        }
    }
    walk(baseDir);
    return results;
}

interface ParsedBuilding {
    buildingType: number;
    player: number;
    x: number;
    y: number;
}

function findNearestTowerHits(
    mapName: string,
    player: number,
    playerBuildings: ParsedBuilding[],
    towers: ParsedBuilding[]
): NearestTowerHit[] {
    const hits: NearestTowerHit[] = [];
    for (const b of playerBuildings) {
        if (TERRITORY_TYPES.has(b.buildingType)) continue;

        let nearestDist = Infinity;
        let nearestTower = towers[0]!;
        for (const t of towers) {
            const d = requiredRadius(t.x, t.y, b.x, b.y);
            if (d < nearestDist) {
                nearestDist = d;
                nearestTower = t;
            }
        }

        hits.push({
            map: mapName,
            player,
            towerType: TERRITORY_NAMES[nearestTower.buildingType]!,
            dist: Math.round(nearestDist * 10) / 10,
            buildingType: b.buildingType,
            bx: b.x,
            by: b.y,
            tx: nearestTower.x,
            ty: nearestTower.y,
        });
    }
    return hits;
}

function analyzeMap(mapPath: string): NearestTowerHit[] {
    const buf = fs.readFileSync(mapPath);
    const reader = new BinaryReader(new Uint8Array(buf).buffer);
    reader.filename = path.basename(mapPath);

    let file: OriginalMapFile;
    try {
        file = new OriginalMapFile(reader);
    } catch {
        return [];
    }

    const buildingReader = file.getChunkReader(MapChunkType.MapBuildings);
    if (!buildingReader) return [];

    const buildings = parseBuildings(buildingReader);
    if (buildings.length === 0) return [];

    // Group by player
    const byPlayer = new Map<number, ParsedBuilding[]>();
    for (const b of buildings) {
        let arr = byPlayer.get(b.player);
        if (!arr) {
            arr = [];
            byPlayer.set(b.player, arr);
        }
        arr.push(b);
    }

    const hits: NearestTowerHit[] = [];
    const mapName = path.basename(mapPath);

    for (const [player, playerBuildings] of byPlayer) {
        const towers = playerBuildings.filter(b => TERRITORY_TYPES.has(b.buildingType));
        if (towers.length === 0) continue;
        hits.push(...findNearestTowerHits(mapName, player, playerBuildings, towers));
    }

    return hits;
}

// ── Helpers ───────────────────────────────────────────────────────

function percentile(sorted: number[], p: number): number {
    return sorted[Math.floor(sorted.length * p)]!;
}

function printStats(label: string, distances: number[]) {
    distances.sort((a, b) => a - b);
    const n = distances.length;
    console.log(
        `${label.padEnd(12)}| ${String(n).padStart(6)} | ` +
            `${String(percentile(distances, 0)).padStart(5)} | ` +
            `${String(percentile(distances, 0.5)).padStart(6)} | ` +
            `${String(percentile(distances, 0.75)).padStart(5)} | ` +
            `${String(percentile(distances, 0.9)).padStart(5)} | ` +
            `${String(percentile(distances, 0.95)).padStart(5)} | ` +
            `${String(percentile(distances, 0.99)).padStart(5)} | ` +
            `${String(distances[n - 1]).padStart(5)}`
    );
}

// ── Main ──────────────────────────────────────────────────────────

const mapDir = path.resolve(__dirname, '../public/Siedler4/Map');
const mapFiles = findMapFiles(mapDir);

console.log(`Scanning ${mapFiles.length} map files...\n`);

const allHits: NearestTowerHit[] = [];

for (const mapFile of mapFiles) {
    allHits.push(...analyzeMap(mapFile));
}

console.log(`Analyzed ${allHits.length} buildings with nearby towers.\n`);

// Group by nearest tower type
const byTowerType = new Map<string, NearestTowerHit[]>();
for (const h of allHits) {
    let arr = byTowerType.get(h.towerType);
    if (!arr) {
        arr = [];
        byTowerType.set(h.towerType, arr);
    }
    arr.push(h);
}

console.log('=== Required "radius" parameter (fillCircle) to cover each building ===');
console.log('(uses same isometric ellipse formula as territory system)\n');
console.log('Tower Type  | Count  | Min   | Median | P75   | P90   | P95   | P99   | Max');
console.log('------------|--------|-------|--------|-------|-------|-------|-------|------');

for (const [type, hits] of [...byTowerType.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    printStats(
        type,
        hits.map(h => h.dist)
    );
}

// Overall stats (distance to nearest tower of ANY type)
console.log('------------|--------|-------|--------|-------|-------|-------|-------|------');
printStats(
    'ALL',
    allHits.map(h => h.dist)
);

// Top outliers
console.log('\n=== Buildings farthest from their nearest tower (top 20) ===\n');
allHits.sort((a, b) => b.dist - a.dist);
for (const h of allHits.slice(0, 20)) {
    console.log(
        `  dist=${String(h.dist).padStart(6)} | nearest=${h.towerType.padEnd(12)} ` +
            `| ${h.map.padEnd(30)} p${h.player} bldg=${h.buildingType} at (${h.bx},${h.by}) ← tower at (${h.tx},${h.ty})`
    );
}

// Per-type: show the P95 and P99 which suggest the "intended" radius
console.log('\n=== Suggested territory radius (P95 = covers 95% of buildings) ===\n');
for (const [type, hits] of [...byTowerType.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    const dists = hits.map(h => h.dist).sort((a, b) => a - b);
    const p95 = percentile(dists, 0.95);
    const p99 = percentile(dists, 0.99);
    console.log(`  ${type.padEnd(12)}: P95=${p95}, P99=${p99}`);
}
