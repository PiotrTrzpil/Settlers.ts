/**
 * Building construction system.
 * Updates building construction progress over time.
 */

import { GameState } from '../game-state';
import {
    BuildingConstructionPhase,
    BuildingState,
    EntityType,
    BUILDING_SPAWN_ON_COMPLETE,
} from '../entity';
import { MapSize } from '@/utilities/map-size';
import { isPassable } from './placement';
import {
    captureOriginalTerrain,
    applyTerrainLeveling,
} from './terrain-leveling';

/**
 * Phase durations as fraction of total construction time.
 * TerrainLeveling: 20%, ConstructionRising: 35%, CompletedRising: 45%
 * Note: Poles phase is skipped (duration 0) - terrain leveling starts immediately.
 */
const PHASE_DURATIONS: Record<BuildingConstructionPhase, number> = {
    [BuildingConstructionPhase.Poles]: 0,
    [BuildingConstructionPhase.TerrainLeveling]: 0.20,
    [BuildingConstructionPhase.ConstructionRising]: 0.35,
    [BuildingConstructionPhase.CompletedRising]: 0.45,
    [BuildingConstructionPhase.Completed]: 0, // Terminal phase
};

/**
 * Get the start time (as fraction) for a given phase.
 */
function getPhaseStartTime(phase: BuildingConstructionPhase): number {
    let startTime = 0;
    for (let p = 0; p < phase; p++) {
        startTime += PHASE_DURATIONS[p as BuildingConstructionPhase];
    }
    return startTime;
}

/**
 * Determine which phase we should be in based on elapsed time.
 */
function determinePhase(elapsedFraction: number): BuildingConstructionPhase {
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
function calculatePhaseProgress(elapsedFraction: number, phase: BuildingConstructionPhase): number {
    if (phase === BuildingConstructionPhase.Completed) {
        return 1.0;
    }

    const startTime = getPhaseStartTime(phase);
    const duration = PHASE_DURATIONS[phase];

    if (duration <= 0) return 1.0;

    const progressInPhase = (elapsedFraction - startTime) / duration;
    return Math.max(0, Math.min(1, progressInPhase));
}

/**
 * Terrain modification context for construction.
 * Pass this to enable terrain leveling during construction.
 */
export interface TerrainContext {
    groundType: Uint8Array;
    groundHeight: Uint8Array;
    mapSize: MapSize;
    /** Callback to notify that terrain has changed and needs re-upload to GPU */
    onTerrainModified?: () => void;
}

/**
 * Update building construction progress for all buildings.
 * Called each game tick.
 *
 * When a building transitions to the Completed phase, it may auto-spawn
 * units (e.g., Barrack spawns soldiers) as defined by BUILDING_SPAWN_ON_COMPLETE.
 *
 * @param state Game state containing building states
 * @param dt Delta time in seconds
 * @param terrainContext Optional terrain context for terrain modification
 */
export function updateBuildingConstruction(
    state: GameState,
    dt: number,
    terrainContext?: TerrainContext
): void {
    let terrainModified = false;

    for (const buildingState of state.buildingStates.values()) {
        // Skip completed buildings
        if (buildingState.phase === BuildingConstructionPhase.Completed) {
            continue;
        }

        const previousPhase = buildingState.phase;

        // Update elapsed time
        buildingState.elapsedTime += dt;

        // Calculate elapsed fraction (0.0 to 1.0)
        const elapsedFraction = Math.min(
            buildingState.elapsedTime / buildingState.totalDuration,
            1.0
        );

        // Determine current phase based on elapsed time
        const newPhase = determinePhase(elapsedFraction);
        buildingState.phase = newPhase;

        // Calculate progress within the current phase
        buildingState.phaseProgress = calculatePhaseProgress(elapsedFraction, newPhase);

        // Handle terrain leveling if context is provided
        if (terrainContext) {
            // Capture original terrain on first tick in TerrainLeveling phase
            if (newPhase === BuildingConstructionPhase.TerrainLeveling &&
                !buildingState.originalTerrain) {
                buildingState.originalTerrain = captureOriginalTerrain(
                    buildingState,
                    terrainContext.groundType,
                    terrainContext.groundHeight,
                    terrainContext.mapSize
                );
            }

            // Apply terrain leveling during TerrainLeveling phase
            if (newPhase === BuildingConstructionPhase.TerrainLeveling &&
                buildingState.originalTerrain) {
                const modified = applyTerrainLeveling(
                    buildingState,
                    terrainContext.groundType,
                    terrainContext.groundHeight,
                    terrainContext.mapSize,
                    buildingState.phaseProgress
                );
                if (modified) {
                    terrainModified = true;
                }
            }

            // Mark terrain as fully modified when leaving TerrainLeveling phase
            if (previousPhase === BuildingConstructionPhase.TerrainLeveling &&
                newPhase > BuildingConstructionPhase.TerrainLeveling) {
                // Apply final leveling (progress = 1.0) if not already done
                if (buildingState.originalTerrain && !buildingState.terrainModified) {
                    const modified = applyTerrainLeveling(
                        buildingState,
                        terrainContext.groundType,
                        terrainContext.groundHeight,
                        terrainContext.mapSize,
                        1.0
                    );
                    if (modified) {
                        terrainModified = true;
                    }
                    buildingState.terrainModified = true;
                }
            }
        }

        // Spawn units when building transitions to Completed phase
        // (previousPhase is guaranteed to be non-Completed here due to early continue above)
        if (newPhase === BuildingConstructionPhase.Completed) {
            spawnUnitsOnBuildingComplete(state, buildingState, terrainContext);
        }
    }

    // Notify that terrain was modified
    if (terrainModified && terrainContext?.onTerrainModified) {
        terrainContext.onTerrainModified();
    }
}

/**
 * Spawn units adjacent to a building that just completed construction.
 * Uses BUILDING_SPAWN_ON_COMPLETE to determine which unit type and count to spawn.
 * Searches in expanding rings around the building to find free passable tiles.
 */
function spawnUnitsOnBuildingComplete(
    state: GameState,
    buildingState: BuildingState,
    terrainContext?: TerrainContext
): void {
    const spawnDef = BUILDING_SPAWN_ON_COMPLETE[buildingState.buildingType];
    if (!spawnDef) return;

    const entity = state.getEntity(buildingState.entityId);
    if (!entity) return;

    const bx = buildingState.tileX;
    const by = buildingState.tileY;
    // Use explicit override from spawn config if provided, otherwise undefined
    // so addEntity falls back to UNIT_TYPE_CONFIG defaults
    const selectable = spawnDef.selectable;

    // Search expanding rings around the building for free tiles
    let spawned = 0;
    for (let radius = 1; radius <= 4 && spawned < spawnDef.count; radius++) {
        for (let dy = -radius; dy <= radius; dy++) {
            for (let dx = -radius; dx <= radius; dx++) {
                if (spawned >= spawnDef.count) break;
                // Only process tiles on the current ring perimeter
                if (Math.abs(dx) !== radius && Math.abs(dy) !== radius) continue;

                const nx = bx + dx;
                const ny = by + dy;

                // Bounds check
                if (terrainContext) {
                    const ms = terrainContext.mapSize;
                    if (nx < 0 || nx >= ms.width || ny < 0 || ny >= ms.height) continue;
                    if (!isPassable(terrainContext.groundType[ms.toIndex(nx, ny)])) continue;
                }

                // Occupancy check
                if (state.getEntityAt(nx, ny)) continue;

                state.addEntity(EntityType.Unit, spawnDef.unitType, nx, ny, entity.player, selectable);
                spawned++;
            }
        }
    }
}

/**
 * Get the visual progress for rendering a building.
 * Returns information about which sprite to use and how to render it.
 */
export interface BuildingVisualState {
    /** Should show the construction sprite (true) or completed sprite (false) */
    useConstructionSprite: boolean;
    /** Vertical visibility (0.0 = hidden, 1.0 = fully visible) for "rising" effect */
    verticalProgress: number;
    /** Overall construction progress (0.0 to 1.0) */
    overallProgress: number;
    /** Is the building fully completed */
    isCompleted: boolean;
    /** Current phase for debugging/display */
    phase: BuildingConstructionPhase;
}

/**
 * Get the visual state for a building based on its construction progress.
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
