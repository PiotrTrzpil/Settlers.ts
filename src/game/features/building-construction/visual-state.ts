/**
 * Visual state query API for renderers.
 * Provides a clean interface for renderers to query building construction display data.
 */

import { BuildingConstructionPhase, type ConstructionSite, type BuildingVisualState } from './types';

/**
 * Get the visual state for a building based on its construction site.
 * Renderers use this to determine which sprite to show and how to render it.
 *
 * When site is undefined, the building is operational (no active construction site).
 * When site exists, visual state is derived from site.phase and progress fields.
 */
export function getBuildingVisualState(site: ConstructionSite | undefined): BuildingVisualState {
    // No site means building is operational / fully completed
    if (!site) {
        return {
            useConstructionSprite: false,
            verticalProgress: 1.0,
            overallProgress: 1.0,
            isCompleted: true,
            phase: BuildingConstructionPhase.Completed,
        };
    }

    const { phase, levelingProgress, constructionProgress, completedRisingProgress } = site;

    switch (phase) {
    case BuildingConstructionPhase.WaitingForDiggers:
    case BuildingConstructionPhase.TerrainLeveling:
    case BuildingConstructionPhase.WaitingForBuilders:
        // Waiting/leveling phases: show construction sprite at 0 height (no visual progress yet)
        return {
            useConstructionSprite: true,
            verticalProgress: 0.0,
            overallProgress: levelingProgress * 0.3,
            isCompleted: false,
            phase,
        };

    case BuildingConstructionPhase.ConstructionRising:
        // Construction sprite rises from bottom
        return {
            useConstructionSprite: true,
            verticalProgress: constructionProgress,
            overallProgress: 0.3 + constructionProgress * 0.7,
            isCompleted: false,
            phase,
        };

    case BuildingConstructionPhase.CompletedRising:
        // Completed sprite rises from bottom
        return {
            useConstructionSprite: false,
            verticalProgress: completedRisingProgress,
            overallProgress: 1.0,
            isCompleted: false,
            phase,
        };

    case BuildingConstructionPhase.Completed:
        // Terminal state — site should be removed immediately after
        return {
            useConstructionSprite: false,
            verticalProgress: 1.0,
            overallProgress: 1.0,
            isCompleted: true,
            phase,
        };
    }
}
