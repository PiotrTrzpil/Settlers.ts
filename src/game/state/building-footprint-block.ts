/**
 * Building footprint blocking — toggles a building's non-door footprint tiles
 * in the buildingOccupancy set.
 *
 * Construction sites clear the block so their footprints stay walkable during
 * terrain leveling; when the structure starts rising, the block is restored.
 *
 * Extracted from GameState to keep that file under the size limit.
 */

import { EntityType, tileKey, type Entity } from '../entity';
import type { BuildingType } from '../buildings/building-type';
import { getBuildingBlockArea, getBuildingPassableTiles } from '../buildings/types';

/**
 * Remove a building's non-door footprint tiles from buildingOccupancy.
 * Used for construction sites — their footprints should be walkable during leveling.
 */
export function clearBuildingFootprintBlock(entity: Entity | undefined, buildingOccupancy: Set<string>): void {
    if (!entity || entity.type !== EntityType.Building) {
        return;
    }
    const blockArea = getBuildingBlockArea(entity, entity.subType as BuildingType, entity.race);
    for (const tile of blockArea) {
        buildingOccupancy.delete(tileKey(tile));
    }
}

/**
 * Re-add a building's non-door footprint tiles to buildingOccupancy.
 * Used when a construction site finishes leveling and the structure starts rising.
 */
export function restoreBuildingFootprintBlock(entity: Entity | undefined, buildingOccupancy: Set<string>): void {
    if (!entity || entity.type !== EntityType.Building) {
        return;
    }
    const blockArea = getBuildingBlockArea(entity, entity.subType as BuildingType, entity.race);
    const passableKeys = getBuildingPassableTiles(entity, entity.subType as BuildingType, entity.race, blockArea);
    for (const tile of blockArea) {
        const key = tileKey(tile);
        if (!passableKeys.has(key)) {
            buildingOccupancy.add(key);
        }
    }
}
