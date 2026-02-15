/**
 * Building Construction Feature Module
 *
 * Self-contained module for building construction logic.
 * External code should only import from this file.
 *
 * Public API:
 * - Types: BuildingState, BuildingVisualState, BuildingConstructionPhase, TerrainContext
 * - System: BuildingConstructionSystem (registers with GameLoop as TickSystem)
 * - Queries: getBuildingVisualState (for renderers)
 * - Constants: BUILDING_SPAWN_ON_COMPLETE, DEFAULT_CONSTRUCTION_DURATION
 */

// Types
export type {
    BuildingState,
    BuildingVisualState,
    BuildingSpawnConfig,
    CapturedTerrainTile,
    ConstructionSiteOriginalTerrain,
    TerrainContext,
} from './types';
export { BuildingConstructionPhase } from './types';

// Manager (owns building states, lives on GameState)
export {
    BuildingStateManager,
    DEFAULT_CONSTRUCTION_DURATION,
    type BuildingStateManagerConfig,
} from './building-state-manager';

// System (for registration with GameLoop)
export { BuildingConstructionSystem, BUILDING_SPAWN_ON_COMPLETE } from './construction-system';

// Queries (for renderers)
export { getBuildingVisualState } from './visual-state';

// Terrain functions (for testing terrain modification)
export {
    captureOriginalTerrain,
    applyTerrainLeveling,
    restoreOriginalTerrain,
    CONSTRUCTION_SITE_GROUND_TYPE,
} from './terrain';
