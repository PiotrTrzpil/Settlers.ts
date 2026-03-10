/**
 * Unit spawning configuration for building construction completion.
 *
 * Defines which unit types each building spawns when construction completes.
 * The actual spawning logic is handled by the `spawn_building_units` command.
 */

import { BuildingType } from '../../buildings/types';
import { UnitType } from '../../core/unit-types';
import type { BuildingSpawnConfig } from './types';

/**
 * Which unit type (and count) each building spawns when construction completes.
 * Residence buildings spawn carriers on completion. Other buildings (e.g. Barrack)
 * spawn units through dedicated systems, not at construction time.
 * Buildings not listed here don't spawn units on completion.
 */
/** Seconds between each carrier spawn from a residence */
const RESIDENCE_SPAWN_INTERVAL = 3;

export const BUILDING_SPAWN_ON_COMPLETE: Record<number, BuildingSpawnConfig | undefined> = {
    [BuildingType.ResidenceSmall]: { unitType: UnitType.Carrier, count: 2, spawnInterval: RESIDENCE_SPAWN_INTERVAL },
    [BuildingType.ResidenceMedium]: { unitType: UnitType.Carrier, count: 4, spawnInterval: RESIDENCE_SPAWN_INTERVAL },
    [BuildingType.ResidenceBig]: { unitType: UnitType.Carrier, count: 6, spawnInterval: RESIDENCE_SPAWN_INTERVAL },
};

