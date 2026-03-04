/**
 * Construction Pile Positions
 *
 * Resolves door-adjacent staging tile positions for construction piles.
 * Construction materials are placed near the building door, sorted by Manhattan
 * distance from the door. The number of staging slots matches the number of
 * distinct material types required to construct the building (capped at 8).
 */

import type { TileCoord } from '../../coordinates';
import type { Entity } from '../../entity';
import { EntityType } from '../../entity';
import { tileKey } from '../../coordinates';
import { BuildingType } from '../../buildings/building-type';
import type { EMaterialType } from '../../economy/material-type';
import type { GameState } from '../../game-state';
import { getBuildingDoorPos } from '../../game-data-access';
import { getConstructionCosts } from '../../economy/building-production';

/** Maximum number of construction staging slots. */
const MAX_CONSTRUCTION_SLOTS = 8;

/** All 8 adjacent tile offsets (ring of radius 1). */
const RING_OFFSETS: ReadonlyArray<readonly [number, number]> = [
    [-1, -1],
    [0, -1],
    [1, -1],
    [-1, 0],
    [1, 0],
    [-1, 1],
    [0, 1],
    [1, 1],
];

/**
 * Returns an ordered list of candidate staging tiles adjacent to the building door.
 * Tiles are sorted by Manhattan distance from the door, ascending.
 * Count equals the number of distinct material types in the building's construction
 * costs for its race, capped at MAX_CONSTRUCTION_SLOTS.
 */
export function getConstructionCandidates(building: Entity): TileCoord[] {
    const buildingType = building.subType as BuildingType;
    const race = building.race;

    const door = getBuildingDoorPos(building.x, building.y, race, buildingType);
    const costs = getConstructionCosts(buildingType, race);
    const count = Math.min(costs.length, MAX_CONSTRUCTION_SLOTS);

    const candidates = RING_OFFSETS.map(([dx, dy]) => ({
        x: door.x + dx,
        y: door.y + dy,
        dist: Math.abs(dx) + Math.abs(dy),
    }));

    candidates.sort((a, b) => a.dist - b.dist);

    return candidates.slice(0, count).map(({ x, y }) => ({ x, y }));
}

/**
 * Returns the first candidate tile that is not already used by another pile and
 * not occupied by a StackedPile entity.
 *
 * Returns null (with console.warn) if all candidate tiles are occupied.
 */
export function getConstructionPilePosition(
    building: Entity,
    material: EMaterialType,
    usedPositions: ReadonlySet<string>,
    gameState: GameState
): TileCoord | null {
    const candidates = getConstructionCandidates(building);

    for (const pos of candidates) {
        const key = tileKey(pos.x, pos.y);
        if (usedPositions.has(key)) continue;
        const occupant = gameState.getEntityAt(pos.x, pos.y);
        if (occupant?.type === EntityType.StackedPile) continue;
        return pos;
    }

    console.warn(
        `[construction-pile-positions] No free staging tile for material ${material} ` +
            `near building ${building.id} at (${building.x}, ${building.y}); all candidates occupied.`
    );
    return null;
}
