/**
 * Phase transition logic for building construction.
 * Handles determining which phase a building should be in based on elapsed time,
 * and calculating progress within each phase.
 */

import { BuildingConstructionPhase } from '../types';

/**
 * Phase durations as fraction of total construction time.
 * TerrainLeveling: 20%, ConstructionRising: 35%, CompletedRising: 45%
 * Note: Poles phase is skipped (duration 0) - terrain leveling starts immediately.
 */
export const PHASE_DURATIONS: Record<BuildingConstructionPhase, number> = {
    [BuildingConstructionPhase.Poles]: 0,
    [BuildingConstructionPhase.TerrainLeveling]: 0.20,
    [BuildingConstructionPhase.ConstructionRising]: 0.35,
    [BuildingConstructionPhase.CompletedRising]: 0.45,
    [BuildingConstructionPhase.Completed]: 0, // Terminal phase
};

/**
 * Get the start time (as fraction) for a given phase.
 */
export function getPhaseStartTime(phase: BuildingConstructionPhase): number {
    let startTime = 0;
    for (let p = 0; p < phase; p++) {
        startTime += PHASE_DURATIONS[p as BuildingConstructionPhase];
    }
    return startTime;
}

/**
 * Determine which phase we should be in based on elapsed time.
 */
export function determinePhase(elapsedFraction: number): BuildingConstructionPhase {
    if (elapsedFraction >= 1.0) {
        return BuildingConstructionPhase.Completed;
    }

    let accumulated = 0;
    for (let p = 0; p <= BuildingConstructionPhase.CompletedRising; p++) {
        accumulated += PHASE_DURATIONS[p as BuildingConstructionPhase];
        if (elapsedFraction < accumulated) {
            return p as BuildingConstructionPhase;
        }
    }

    return BuildingConstructionPhase.Completed;
}

/**
 * Calculate progress within the current phase (0.0 to 1.0).
 */
export function calculatePhaseProgress(elapsedFraction: number, phase: BuildingConstructionPhase): number {
    if (phase === BuildingConstructionPhase.Completed) {
        return 1.0;
    }

    const startTime = getPhaseStartTime(phase);
    const duration = PHASE_DURATIONS[phase];

    if (duration <= 0) return 1.0;

    const progressInPhase = (elapsedFraction - startTime) / duration;
    return Math.max(0, Math.min(1, progressInPhase));
}
