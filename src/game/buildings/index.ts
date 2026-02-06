/**
 * Building system module.
 * Re-exports all building-related types, enums, and utilities.
 */

// Building types and sizes
export type { BuildingSize } from './types';
export {
    BuildingType,
    BUILDING_SIZE,
    getBuildingSize,
    getBuildingFootprint,
} from './types';

// Building construction state
export type { CapturedTerrainTile, ConstructionSiteOriginalTerrain, BuildingState } from './state';
export { BuildingConstructionPhase } from './state';
