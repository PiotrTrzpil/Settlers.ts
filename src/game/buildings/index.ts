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

// Building construction system and spawn config
export type { BuildingSpawnConfig } from './construction';
export { BUILDING_SPAWN_ON_COMPLETE, getBuildingVisualState } from './construction';

// Territory system
export { TerritoryMap, NO_OWNER, BUILDING_TERRITORY_RADIUS } from './territory';
