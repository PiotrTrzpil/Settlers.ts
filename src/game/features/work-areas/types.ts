/**
 * Work Area Types
 *
 * Constants for the work area system.
 * Work areas define where a building's worker operates.
 */

import { BuildingType } from '../../buildings/types';

/** Radii for the 3 concentric debug visualization circles (in tiles) */
export const WORK_AREA_RADII = [6, 12, 18] as const;

/** The outer radius used for gameplay (worker search range) */
export const WORK_AREA_RADIUS = WORK_AREA_RADII[2];

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
