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

    const { phase } = site;
    const levelingProgress = site.terrain.progress;
    const constructionProgress = site.building.progress;

    switch (phase) {
    case BuildingConstructionPhase.WaitingForDiggers:
    case BuildingConstructionPhase.TerrainLeveling:
    case BuildingConstructionPhase.Evacuating:
    case BuildingConstructionPhase.WaitingForBuilders:
        // Waiting/leveling/evacuating phases: show construction sprite at 0 height (no visual progress yet)
        return {
            useConstructionSprite: true,
            verticalProgress: 0.0,
            overallProgress: levelingProgress * 0.3,
            isCompleted: false,
            phase,
        };

    case BuildingConstructionPhase.ConstructionRising:
        if (constructionProgress < 0.5) {
            // First half: construction scaffold sprite rises from bottom to fully visible
            return {
                useConstructionSprite: true,
                verticalProgress: constructionProgress * 2,
                overallProgress: 0.3 + constructionProgress * 0.7,
                isCompleted: false,
                phase,
            };
        } else {
            // Second half: final building sprite rises from bottom; scaffold stays fully visible as overlay
            return {
                useConstructionSprite: false,
                verticalProgress: (constructionProgress - 0.5) * 2,
                overallProgress: 0.3 + constructionProgress * 0.7,
                isCompleted: false,
                phase,
            };
        }

    case BuildingConstructionPhase.CompletedRising:
        // Not actively entered — building:completed is emitted directly from construction:progressComplete.
        // Kept as a safe fallback for any deserialized state in transit.
        return {
            useConstructionSprite: false,
            verticalProgress: 1.0,
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

    default: {
        const _: never = phase;
        throw new Error(`getBuildingVisualState: unhandled BuildingConstructionPhase ${_}`);
    }
    }
}
