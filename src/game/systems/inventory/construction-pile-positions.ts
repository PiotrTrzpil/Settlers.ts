/**
 * Construction Pile Positions
 *
 * Resolves door-adjacent staging tile positions for construction piles.
 * Construction materials are placed near the building door, sorted by Manhattan
 * distance from the door.
 *
 * Each pile holds at most SLOT_CAPACITY (8) items. Materials needing more than 8
 * units get multiple pile positions (ceil(count/SLOT_CAPACITY) tiles).
 *
 * Pile positions are assigned once at construction site creation and stored on
 * the ConstructionSite for the entire construction lifecycle.
 */

import type { TileCoord } from '../../core/coordinates';
import { tileKey } from '../../core/coordinates';
import type { BuildingType } from '../../buildings/building-type';
import type { EMaterialType } from '../../economy/material-type';
import type { Race } from '../../core/race';
import { getBuildingDoorPos } from '../../data/game-data-access';
import { getConstructionCosts } from '../../economy/building-production';
import { getBuildingBlockArea } from '../../buildings/types';
import { SLOT_CAPACITY } from './inventory-configs';

/** All 8 adjacent tile offsets (ring of radius 1), plus ring of radius 2 for overflow. */
const RING1_OFFSETS: ReadonlyArray<readonly [number, number]> = [
    [-1, -1],
    [0, -1],
    [1, -1],
    [-1, 0],
    [1, 0],
    [-1, 1],
    [0, 1],
    [1, 1],
];

const RING2_OFFSETS: ReadonlyArray<readonly [number, number]> = [
    [-2, -2],
    [-1, -2],
    [0, -2],
    [1, -2],
    [2, -2],
    [-2, -1],
    [2, -1],
    [-2, 0],
    [2, 0],
    [-2, 1],
    [2, 1],
    [-2, 2],
    [-1, 2],
    [0, 2],
    [1, 2],
    [2, 2],
];

/**
 * Returns candidate staging tiles near the building door, outside the block area.
 * Sorted by Manhattan distance from door (ring 1 first, then ring 2).
 * Returns up to `count` candidates.
 */
function getCandidateTiles(
    buildingType: BuildingType,
    race: Race,
    tileX: number,
    tileY: number,
    count: number
): TileCoord[] {
    const door = getBuildingDoorPos(tileX, tileY, race, buildingType);

    // Exclude tiles inside the building's block area so piles are always
    // accessible without walking onto the (eventually blocked) footprint.
    const blockArea = getBuildingBlockArea(tileX, tileY, buildingType, race);
    const blockedKeys = new Set<string>();
    for (const tile of blockArea) {
        blockedKeys.add(tileKey(tile.x, tile.y));
    }

    const allOffsets = [...RING1_OFFSETS, ...RING2_OFFSETS];
    const candidates = allOffsets
        .map(([dx, dy]) => ({
            x: door.x + dx,
            y: door.y + dy,
            dist: Math.abs(dx) + Math.abs(dy),
        }))
        .filter(({ x, y }) => !blockedKeys.has(tileKey(x, y)));

    candidates.sort((a, b) => a.dist - b.dist);

    return candidates.slice(0, count).map(({ x, y }) => ({ x, y }));
}

/**
 * Returns an ordered list of candidate staging tiles adjacent to the building door.
 * Count equals the total number of inventory slots needed (one per pile of ≤SLOT_CAPACITY items).
 * Exported for tests.
 */
export function getConstructionCandidates(
    buildingType: BuildingType,
    race: Race,
    tileX: number,
    tileY: number
): TileCoord[] {
    const costs = getConstructionCosts(buildingType, race);
    let totalSlots = 0;
    for (const cost of costs) {
        totalSlots += Math.ceil(cost.count / SLOT_CAPACITY);
    }
    return getCandidateTiles(buildingType, race, tileX, tileY, totalSlots);
}

/**
 * Assign pile positions for all construction materials.
 * Each material gets ceil(count / SLOT_CAPACITY) positions.
 * Positions are door-adjacent tiles outside the building block area, sorted by proximity.
 *
 * Called once at construction site creation.
 */
export function assignConstructionPilePositions(
    buildingType: BuildingType,
    race: Race,
    tileX: number,
    tileY: number
): Map<EMaterialType, TileCoord[]> {
    const costs = getConstructionCosts(buildingType, race);

    // Calculate total number of pile slots needed across all materials
    let totalSlots = 0;
    for (const cost of costs) {
        totalSlots += Math.ceil(cost.count / SLOT_CAPACITY);
    }

    const candidates = getCandidateTiles(buildingType, race, tileX, tileY, totalSlots);
    const positions = new Map<EMaterialType, TileCoord[]>();
    let candidateIdx = 0;

    for (const cost of costs) {
        const slotsNeeded = Math.ceil(cost.count / SLOT_CAPACITY);
        const materialPositions: TileCoord[] = [];

        for (let i = 0; i < slotsNeeded; i++) {
            if (candidateIdx >= candidates.length) {
                console.warn(
                    `[construction-pile-positions] Not enough candidate tiles for material ` +
                        `${cost.material} at building (${tileX}, ${tileY}); ` +
                        `need ${totalSlots} slots but only ${candidates.length} tiles available.`
                );
                break;
            }
            materialPositions.push(candidates[candidateIdx]!);
            candidateIdx++;
        }

        if (materialPositions.length > 0) {
            positions.set(cost.material, materialPositions);
        }
    }

    return positions;
}
