/**
 * Analyze settlers, buildings, and stacks from a Settlers 4 map file.
 * Shows entity placement, per-player summaries, and tower garrison analysis.
 *
 * Usage:
 *   npx tsx scripts/analyze-map-entities.ts <map-path>
 *   npx tsx scripts/analyze-map-entities.ts public/Siedler4/Map/Campaign/MD_roman4.map
 */

import fs from 'fs';
import { OriginalMapLoader } from '@/resources/map/original/original-map/game-map-loader';
import { BinaryReader } from '@/resources/file/binary-reader';
import { S4BuildingType, S4SettlerType, S4GoodType } from '@/resources/map/s4-types';
import { MapChunkType } from '@/resources/map/original/map-chunk-type';
import type { MapBuildingData, MapSettlerData, MapStackData } from '@/resources/map/map-entity-data';

// --- Tower/garrison types ---

const TOWER_TYPES = new Set([
    S4BuildingType.LOOKOUTTOWER,
    S4BuildingType.GUARDTOWERSMALL,
    S4BuildingType.GUARDTOWERBIG,
    S4BuildingType.CASTLE,
]);

const GARRISON_CAPACITY: Record<number, { swordsman: number; bowman: number }> = {
    [S4BuildingType.GUARDTOWERSMALL]: { swordsman: 1, bowman: 2 },
    [S4BuildingType.GUARDTOWERBIG]: { swordsman: 3, bowman: 3 },
    [S4BuildingType.CASTLE]: { swordsman: 5, bowman: 5 },
};

const SWORDSMAN_TYPES = new Set([S4SettlerType.SWORDSMAN_01, S4SettlerType.SWORDSMAN_02, S4SettlerType.SWORDSMAN_03]);
const BOWMAN_TYPES = new Set([S4SettlerType.BOWMAN_01, S4SettlerType.BOWMAN_02, S4SettlerType.BOWMAN_03]);

const MILITARY_TYPES = new Set([
    ...SWORDSMAN_TYPES,
    ...BOWMAN_TYPES,
    S4SettlerType.AXEWARRIOR_01,
    S4SettlerType.AXEWARRIOR_02,
    S4SettlerType.AXEWARRIOR_03,
    S4SettlerType.BLOWGUNWARRIOR_01,
    S4SettlerType.BLOWGUNWARRIOR_02,
    S4SettlerType.BLOWGUNWARRIOR_03,
    S4SettlerType.BACKPACKCATAPULTIST_01,
    S4SettlerType.BACKPACKCATAPULTIST_02,
    S4SettlerType.BACKPACKCATAPULTIST_03,
]);

// --- Helpers ---

function name<T extends Record<number, string>>(enumObj: T, value: number): string {
    return enumObj[value] ?? `UNKNOWN_${value}`;
}

function groupBy<T>(items: T[], keyFn: (item: T) => string): Map<string, T[]> {
    const map = new Map<string, T[]>();
    for (const item of items) {
        const key = keyFn(item);
        const group = map.get(key);
        if (group) {
            group.push(item);
        } else {
            map.set(key, [item]);
        }
    }
    return map;
}

function manhattan(a: { x: number; y: number }, b: { x: number; y: number }): number {
    return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}

// --- Printers ---

function printBuildings(buildings: MapBuildingData[]): void {
    console.log(`\n${'='.repeat(60)}`);
    console.log(`BUILDINGS (${buildings.length} total)`);
    console.log('='.repeat(60));

    const byPlayer = groupBy(buildings, b => String(b.player));
    for (const [player, pBuildings] of [...byPlayer].sort((a, b) => +a[0] - +b[0])) {
        console.log(`\n  Player ${player} (${pBuildings.length} buildings):`);
        const byType = groupBy(pBuildings, b => name(S4BuildingType, b.buildingType));
        for (const [typeName, group] of [...byType].sort((a, b) => b[1].length - a[1].length)) {
            const positions = group.map(b => `(${b.x},${b.y})`).join(' ');
            console.log(`    ${typeName.padEnd(24)} x${group.length}  ${positions}`);
        }
    }
}

function printSettlers(settlers: MapSettlerData[]): void {
    console.log(`\n${'='.repeat(60)}`);
    console.log(`SETTLERS (${settlers.length} total)`);
    console.log('='.repeat(60));

    const byPlayer = groupBy(settlers, s => String(s.player));
    for (const [player, pSettlers] of [...byPlayer].sort((a, b) => +a[0] - +b[0])) {
        const militaryCount = pSettlers.filter(s => MILITARY_TYPES.has(s.settlerType)).length;
        const civilianCount = pSettlers.length - militaryCount;
        console.log(
            `\n  Player ${player} (${pSettlers.length} settlers: ${civilianCount} civilian, ${militaryCount} military):`
        );
        const byType = groupBy(pSettlers, s => name(S4SettlerType, s.settlerType));
        for (const [typeName, group] of [...byType].sort((a, b) => b[1].length - a[1].length)) {
            const positions = group.map(s => `(${s.x},${s.y})`).join(' ');
            console.log(`    ${typeName.padEnd(24)} x${group.length}  ${positions}`);
        }
    }
}

function printStacks(stacks: MapStackData[]): void {
    console.log(`\n${'='.repeat(60)}`);
    console.log(`STACKS (${stacks.length} total)`);
    console.log('='.repeat(60));

    for (const stack of stacks) {
        console.log(
            `  ${name(S4GoodType, stack.materialType).padEnd(20)} x${stack.amount}  at (${stack.x},${stack.y})`
        );
    }
}

function printTowerDetail(tower: MapBuildingData, settlers: MapSettlerData[]): void {
    const NEAR_RADIUS = 5;
    const towerName = name(S4BuildingType, tower.buildingType);
    const capacity = GARRISON_CAPACITY[tower.buildingType];

    console.log(`\n  ${towerName} at (${tower.x},${tower.y}) player=${tower.player}`);
    if (capacity) {
        console.log(`    Capacity: ${capacity.swordsman} swordsmen + ${capacity.bowman} bowmen`);
    } else {
        console.log('    (no garrison slots — lookout tower)');
    }

    const atPosition = settlers.filter(s => s.x === tower.x && s.y === tower.y);
    if (atPosition.length > 0) {
        console.log('    AT EXACT POSITION:');
        for (const s of atPosition) {
            console.log(`      ${name(S4SettlerType, s.settlerType)} player=${s.player}`);
        }
    }

    const nearby = settlers
        .filter(s => s !== atPosition.find(a => a === s) && manhattan(s, tower) <= NEAR_RADIUS)
        .sort((a, b) => manhattan(a, tower) - manhattan(b, tower));

    if (nearby.length > 0) {
        console.log(`    NEARBY (≤${NEAR_RADIUS} tiles):`);
        for (const s of nearby) {
            const dist = manhattan(s, tower);
            const mil = MILITARY_TYPES.has(s.settlerType) ? ' [MILITARY]' : '';
            console.log(
                `      ${name(S4SettlerType, s.settlerType)} at (${s.x},${s.y}) dist=${dist} player=${s.player}${mil}`
            );
        }
    }

    if (atPosition.length === 0 && nearby.length === 0) {
        console.log('    (no settlers nearby)');
    }
}

function printGarrisonSummary(towers: MapBuildingData[], settlers: MapSettlerData[]): void {
    const garrisoned: Array<{ tower: MapBuildingData; settler: MapSettlerData }> = [];
    for (const tower of towers) {
        for (const s of settlers) {
            if (s.x === tower.x && s.y === tower.y && MILITARY_TYPES.has(s.settlerType)) {
                garrisoned.push({ tower, settler: s });
            }
        }
    }

    if (garrisoned.length > 0) {
        console.log(`\n  POTENTIAL GARRISONED UNITS (military at exact tower position): ${garrisoned.length}`);
        for (const { tower, settler } of garrisoned) {
            console.log(
                `    ${name(S4SettlerType, settler.settlerType)} in ${name(S4BuildingType, tower.buildingType)} at (${tower.x},${tower.y})`
            );
        }
    } else {
        console.log('\n  No military settlers found at exact tower positions.');
    }
}

function printTowerGarrisonAnalysis(buildings: MapBuildingData[], settlers: MapSettlerData[]): void {
    const towers = buildings.filter(b => TOWER_TYPES.has(b.buildingType));
    if (towers.length === 0) {
        console.log('\n  No towers found.');
        return;
    }

    console.log(`\n${'='.repeat(60)}`);
    console.log('TOWER GARRISON ANALYSIS');
    console.log('='.repeat(60));

    for (const tower of towers) {
        printTowerDetail(tower, settlers);
    }

    printGarrisonSummary(towers, settlers);
}

// --- Main ---

function main(): void {
    const mapPath = process.argv[2];
    if (!mapPath) {
        console.log('Usage: npx tsx scripts/analyze-map-entities.ts <map-path>');
        console.log('Example: npx tsx scripts/analyze-map-entities.ts public/Siedler4/Map/Campaign/MD_roman4.map');
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

    console.log(`Map size: ${loader.mapSize.width}x${loader.mapSize.height}`);
    console.log(`Players: ${loader.general.playerCount}`);

    const entities = loader.entityData;

    printBuildings(entities.buildings);
    printSettlers(entities.settlers);
    printStacks(entities.stacks);
    printTowerGarrisonAnalysis(entities.buildings, entities.settlers);

    // Also dump raw settler chunk bytes to inspect unknown fields
    printSettlerRawExtra(loader, entities.settlers);
}

/**
 * Re-read the settlers chunk to show the 6 unknown bytes per entry.
 * These might encode garrison assignment or other placement flags.
 */
function printSettlerRawExtra(loader: OriginalMapLoader, settlers: MapSettlerData[]): void {
    // Re-read chunk to get raw bytes
    const chunkReader = loader.getChunkReader(MapChunkType.MapSettlers);
    if (!chunkReader || settlers.length === 0) return;

    console.log(`\n${'='.repeat(60)}`);
    console.log('SETTLER RAW ENTRY BYTES (12 bytes each)');
    console.log('='.repeat(60));
    console.log('  Format: x(2) y(2) type(1) player(1) unknown(6)');

    const ENTRY_SIZE = 12;
    const entryCount = Math.floor(chunkReader.length / ENTRY_SIZE);

    for (let i = 0; i < entryCount; i++) {
        const x = chunkReader.readWord();
        const y = chunkReader.readWord();
        const settlerType = chunkReader.readByte();
        const player = chunkReader.readByte();
        const extra: number[] = [];
        for (let j = 0; j < 6; j++) {
            extra.push(chunkReader.readByte());
        }

        if (x === 0 && y === 0 && settlerType === 0) continue;
        if (settlerType < 1 || settlerType > 66 || x > 10000 || y > 10000) continue;

        const hexExtra = extra.map(b => b.toString(16).padStart(2, '0')).join(' ');
        const decExtra = extra.join(',');
        console.log(
            `  ${name(S4SettlerType, settlerType).padEnd(24)} (${x},${y}) p=${player}  extra=[${hexExtra}] (${decExtra})`
        );
    }
}

main();
