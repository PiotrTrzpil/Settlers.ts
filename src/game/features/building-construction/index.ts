/**
 * Building Construction Feature Module
 *
 * Self-contained module for building construction logic.
 * External code should only import from this file.
 *
 * Public API:
 * - Types: BuildingVisualState, BuildingConstructionPhase, ConstructionSite, TerrainContext
 * - System: BuildingConstructionSystem (registers with GameLoop as TickSystem)
 * - Queries: getBuildingVisualState (for renderers)
 * - Constants: BUILDING_SPAWN_ON_COMPLETE
 */

// Types
export type {
    BuildingVisualState,
    BuildingSpawnConfig,
    CapturedTerrainTile,
    ConstructionSite,
    ConstructionSiteOriginalTerrain,
    TerrainContext,
} from './types';
export { BuildingConstructionPhase } from './types';

// System (for registration with GameLoop)
export { BuildingConstructionSystem } from './construction-system';

// Unit spawning constants (logic now routed through spawn_building_units command)
export { BUILDING_SPAWN_ON_COMPLETE } from './spawn-units';

// Interval-based carrier spawning from residences
export { ResidenceSpawnerSystem } from './residence-spawner';

// Queries (for renderers)
export { getBuildingVisualState } from './visual-state';

// Terrain functions (for testing terrain modification)
export {
    captureOriginalTerrain,
    applyTerrainLeveling,
    setConstructionSiteGroundType,
    restoreOriginalTerrain,
    CONSTRUCTION_SITE_GROUND_TYPE,
} from './terrain';

// Map building population (for loading buildings from map files)
export { type PopulateBuildingsOptions, populateMapBuildings, mapS4BuildingType } from './map-buildings';

// Construction site manager, types, and request system (for game-services wiring)
export { ConstructionSiteManager, type SerializedConstructionSite } from './construction-site-manager';
export { ConstructionRequestSystem } from './construction-request-system';
