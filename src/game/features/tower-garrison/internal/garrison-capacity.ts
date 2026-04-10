import { BuildingType } from '@/game/buildings/building-type';
import { UnitType } from '@/game/core/unit-types';
import type { GarrisonRole } from '../types';

export interface GarrisonCapacity {
    swordsmanSlots: number;
    bowmanSlots: number;
}

const GARRISON_CAPACITY_MAP: ReadonlyMap<BuildingType, GarrisonCapacity> = new Map([
    [BuildingType.GuardTowerSmall, { swordsmanSlots: 1, bowmanSlots: 2 }],
    [BuildingType.GuardTowerBig, { swordsmanSlots: 3, bowmanSlots: 3 }],
    [BuildingType.Castle, { swordsmanSlots: 4, bowmanSlots: 5 }],
]);

/** Returns true if this building type can hold a garrison. Single source of truth. */
export function isGarrisonBuildingType(buildingType: BuildingType): boolean {
    return GARRISON_CAPACITY_MAP.has(buildingType);
}

/** Returns undefined for non-garrison buildings. */
export function getGarrisonCapacity(buildingType: BuildingType): GarrisonCapacity | undefined {
    return GARRISON_CAPACITY_MAP.get(buildingType);
}

const GARRISON_ROLE_MAP: ReadonlyMap<UnitType, GarrisonRole> = new Map([
    [UnitType.Swordsman1, 'swordsman'],
    [UnitType.Swordsman2, 'swordsman'],
    [UnitType.Swordsman3, 'swordsman'],
    [UnitType.Bowman1, 'bowman'],
    [UnitType.Bowman2, 'bowman'],
    [UnitType.Bowman3, 'bowman'],
]);

/**
 * Maps a UnitType to its garrison role.
 * Only Swordsman (L1/L2/L3) → 'swordsman' and Bowman (L1/L2/L3) → 'bowman' are valid.
 * All other unit types return undefined (cannot garrison).
 *
 * Implemented as an explicit lookup — no dynamic inference from isUnitTypeMilitary().
 */
export function getGarrisonRole(unitType: UnitType): GarrisonRole | undefined {
    return GARRISON_ROLE_MAP.get(unitType);
}
