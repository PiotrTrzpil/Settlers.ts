/**
 * Diagnostic helpers for simulation tests.
 *
 * Free-tile scanning and ASCII map printing for debugging
 * building placement and work-area geometry.
 */

import { BuildingType, getBuildingFootprint, getBuildingBlockArea } from '@/game/buildings/types';
import { getBuildingDoorPos } from '@/game/data/game-data-access';
import { Race } from '@/game/core/race';
import { ringTiles } from '@/game/systems/spatial-search';
import type { GameState } from '@/game/game-state';
import type { Tile } from '@/game/core/coordinates';

export type TileCandidate = { x: number; y: number; distSq: number };

/** Scan expanding rings around center to find free (unoccupied) tiles, sorted by distance. */
export function scanFreeTiles(state: GameState, center: Tile, maxRadius: number, limit: number): TileCandidate[] {
    const candidates: TileCandidate[] = [];
    for (let r = 0; r <= maxRadius && candidates.length < limit; r++) {
        for (const tile of ringTiles(center.x, center.y, r)) {
            if (state.getGroundEntityAt(tile.x, tile.y)) continue;
            const dx = tile.x - center.x;
            const dy = tile.y - center.y;
            candidates.push({ x: tile.x, y: tile.y, distSq: dx * dx + dy * dy });
        }
    }
    candidates.sort((a, b) => a.distSq - b.distSq);
    return candidates;
}

/** Print ASCII tile map showing building footprint, door, work center, and candidate tiles. */
export function printBuildingDiagnosticMap(
    building: Tile,
    buildingType: BuildingType,
    race: Race,
    center: Tile,
    candidates: TileCandidate[]
): void {
    const door = getBuildingDoorPos(building.x, building.y, race, buildingType);
    console.log(`\n  Building anchor: (${building.x}, ${building.y})`);
    console.log(`  Door:            (${door.x}, ${door.y})  anchor+(${door.x - building.x},${door.y - building.y})`);
    console.log(
        `  Work area center:(${center.x}, ${center.y})  anchor+(${center.x - building.x},${center.y - building.y})`
    );

    const fullFootprint = new Set(
        getBuildingFootprint(building.x, building.y, buildingType, race).map(t => `${t.x},${t.y}`)
    );
    const blockArea = new Set(
        getBuildingBlockArea(building.x, building.y, buildingType, race).map(t => `${t.x},${t.y}`)
    );
    console.log(`  Full footprint: ${fullFootprint.size} tiles, block area: ${blockArea.size} tiles`);

    const candMap = new Map<string, number>();
    for (let i = 0; i < candidates.length; i++) candMap.set(`${candidates[i]!.x},${candidates[i]!.y}`, i + 1);

    printTileGrid(building, center, door, fullFootprint, blockArea, candMap);

    console.log(`\n  Top ${candidates.length} candidates (closest to work area center):`);
    for (let i = 0; i < candidates.length; i++) {
        const c = candidates[i]!;
        console.log(`    #${i + 1}: (${c.x},${c.y}) distSq=${c.distSq}  center+(${c.x - center.x},${c.y - center.y})`);
    }
}

function printTileGrid(
    building: Tile,
    center: Tile,
    door: Tile,
    fullFootprint: Set<string>,
    blockArea: Set<string>,
    candMap: Map<string, number>
): void {
    const minX = building.x - 2,
        maxX = building.x + 10;
    const minY = building.y - 1,
        maxY = Math.max(center.y, door.y) + 5;

    let header = '     ';
    for (let x = minX; x <= maxX; x++) header += (x % 10).toString().padStart(2);
    console.log(header);

    for (let y = minY; y <= maxY; y++) {
        let row = `  ${y.toString().padStart(3)}`;
        for (let x = minX; x <= maxX; x++) {
            const key = `${x},${y}`;
            if (x === door.x && y === door.y) row += ' D';
            else if (x === center.x && y === center.y) row += ' W';
            else if (candMap.has(key)) row += ` ${candMap.get(key)}`;
            else if (blockArea.has(key)) row += ' B';
            else if (fullFootprint.has(key)) row += ' ~';
            else row += ' .';
        }
        console.log(row);
    }
}
