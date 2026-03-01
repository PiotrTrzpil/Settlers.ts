/**
 * Work Area Types
 *
 * Constants for the work area system.
 * Work areas define where a building's worker operates.
 */

import { BuildingType } from '../../buildings/types';

/**
 * Building types that have work areas (buildings whose workers go out to work).
 * Production buildings that process inputs indoors (Sawmill, Bakery, etc.) are excluded.
 */
export const WORK_AREA_BUILDINGS: ReadonlySet<BuildingType> = new Set([
    BuildingType.WoodcutterHut,
    BuildingType.StonecutterHut,
    BuildingType.GrainFarm,
    BuildingType.FisherHut,
    BuildingType.HunterHut,
    BuildingType.ForesterHut,
    BuildingType.AgaveFarmerHut,
    BuildingType.BeekeeperHut,
    BuildingType.SunflowerFarmerHut,
    BuildingType.WaterworkHut,
]);
