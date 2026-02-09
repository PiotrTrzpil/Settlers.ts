/**
 * Visual state query API for renderers.
 * Provides a clean interface for renderers to query building construction display data.
 */

import { BuildingConstructionPhase, type BuildingState, type BuildingVisualState } from './types';

/**
 * Get the visual state for a building based on its construction progress.
 * Renderers use this to determine which sprite to show and how to render it.
 */
export function getBuildingVisualState(buildingState: BuildingState | undefined): BuildingVisualState {
    // No state means building is pre-existing / fully completed
    if (!buildingState || buildingState.phase === BuildingConstructionPhase.Completed) {
        return {
            useConstructionSprite: false,
            verticalProgress: 1.0,
            overallProgress: 1.0,
            isCompleted: true,
            phase: BuildingConstructionPhase.Completed,
        };
    }

    const { phase, phaseProgress } = buildingState;
    const overallProgress = buildingState.elapsedTime / buildingState.totalDuration;

    switch (phase) {
    case BuildingConstructionPhase.Poles:
        // Poles phase: show nothing or poles (we'll show construction sprite at 0 height)
        return {
            useConstructionSprite: true,
            verticalProgress: 0.0,
            overallProgress,
            isCompleted: false,
            phase,
        };

    case BuildingConstructionPhase.TerrainLeveling:
        // Terrain leveling: still no building visible (terrain modification)
        return {
            useConstructionSprite: true,
            verticalProgress: 0.0,
            overallProgress,
            isCompleted: false,
            phase,
        };

    case BuildingConstructionPhase.ConstructionRising:
        // Construction sprite rises from bottom
        return {
            useConstructionSprite: true,
            verticalProgress: phaseProgress,
            overallProgress,
            isCompleted: false,
            phase,
        };

    case BuildingConstructionPhase.CompletedRising:
        // Completed sprite rises from bottom with construction sprite visible behind
        return {
            useConstructionSprite: false,
            verticalProgress: phaseProgress,
            overallProgress,
            isCompleted: false,
            phase,
        };

    default:
        return {
            useConstructionSprite: false,
            verticalProgress: 1.0,
            overallProgress: 1.0,
            isCompleted: true,
            phase: BuildingConstructionPhase.Completed,
        };
    }
}
