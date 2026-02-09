/**
 * Building construction system.
 * Re-exported from the building-construction feature module for backward compatibility.
 */

export type { BuildingSpawnConfig, TerrainContext, BuildingVisualState } from '../features/building-construction';
export { BUILDING_SPAWN_ON_COMPLETE, getBuildingVisualState } from '../features/building-construction';

// Re-export updateBuildingConstruction as a compatibility shim
// New code should use BuildingConstructionSystem registered with GameLoop instead.
import { BuildingConstructionSystem } from '../features/building-construction';
import type { TerrainContext } from '../features/building-construction';
import type { GameState } from '../game-state';

/**
 * @deprecated Use BuildingConstructionSystem registered with GameLoop instead.
 * This function is provided for backward compatibility with tests.
 */
export function updateBuildingConstruction(
    state: GameState,
    dt: number,
    terrainContext?: TerrainContext
): void {
    const system = new BuildingConstructionSystem(state);
    system.setTerrainContext(terrainContext);
    system.tick(dt);
}
