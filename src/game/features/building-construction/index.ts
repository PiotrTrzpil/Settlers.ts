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
 * - Constants: BUILDING_SPAWN_ON_COMPLETE
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

// System (for registration with GameLoop)
export { BuildingConstructionSystem, BUILDING_SPAWN_ON_COMPLETE } from './construction-system';

// Queries (for renderers)
export { getBuildingVisualState } from './visual-state';

// Terrain functions (re-exported for backward compatibility and tests)
export {
    captureOriginalTerrain,
    applyTerrainLeveling,
    restoreOriginalTerrain,
    CONSTRUCTION_SITE_GROUND_TYPE,
} from './internal/terrain-capture';
