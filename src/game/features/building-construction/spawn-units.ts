/**
 * Unit spawning configuration for building construction completion.
 *
 * Defines which unit types each building spawns when construction completes.
 * The actual spawning logic is handled by the `spawn_building_units` command.
 */

import { BuildingType } from '../../buildings/types';
import { UnitType } from '../../unit-types';
import type { BuildingSpawnConfig } from './types';

/**
 * Which unit type (and count) each building spawns when construction completes.
 * The Barrack produces soldiers, residence buildings produce settlers, etc.
 * Buildings not listed here don't spawn units on completion.
 */
export const BUILDING_SPAWN_ON_COMPLETE: Record<number, BuildingSpawnConfig | undefined> = {
    [BuildingType.Barrack]: { unitType: UnitType.Swordsman, count: 3 },
    [BuildingType.ResidenceSmall]: { unitType: UnitType.Carrier, count: 2 },
    [BuildingType.ResidenceMedium]: { unitType: UnitType.Carrier, count: 4 },
    [BuildingType.ResidenceBig]: { unitType: UnitType.Carrier, count: 6 },
};
