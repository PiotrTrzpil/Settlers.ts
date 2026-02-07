/**
 * Building construction system.
 * Updates building construction progress over time.
 */

import { GameState } from '../game-state';
import { EntityType } from '../entity';
import { BuildingType } from './types';
import { BuildingConstructionPhase, BuildingState } from './state';
import { UnitType } from '../unit-types';
import { MapSize } from '@/utilities/map-size';

/**
 * Which unit type (and count) each building spawns when construction completes.
 * The Barrack produces soldiers, residence buildings produce settlers, etc.
 * Buildings not listed here don't spawn units on completion.
 *
 * Selectability of spawned units is determined by UNIT_TYPE_CONFIG by default.
 * Use the optional `selectable` field to override the default for specific buildings.
 */
export interface BuildingSpawnConfig {
    unitType: UnitType;
    count: number;
    /** Override default selectability from UNIT_TYPE_CONFIG (undefined = use default) */
    selectable?: boolean;
}

export const BUILDING_SPAWN_ON_COMPLETE: Record<number, BuildingSpawnConfig | undefined> = {
    [BuildingType.Barrack]: { unitType: UnitType.Swordsman, count: 3 },
    [BuildingType.SmallHouse]: { unitType: UnitType.Bearer, count: 2 },
    [BuildingType.MediumHouse]: { unitType: UnitType.Bearer, count: 4 },
    [BuildingType.LargeHouse]: { unitType: UnitType.Bearer, count: 6 },
};
import { isPassable } from '../systems/placement';
import {
    captureOriginalTerrain,
    applyTerrainLeveling,
} from '../systems/terrain-leveling';

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

/** Handle terrain leveling initialization for a building */
function handleTerrainCapture(
    buildingState: BuildingState,
    newPhase: BuildingConstructionPhase,
    ctx: TerrainContext
): void {
    if (newPhase !== BuildingConstructionPhase.TerrainLeveling) return;
    if (buildingState.originalTerrain) return;

    buildingState.originalTerrain = captureOriginalTerrain(
        buildingState, ctx.groundType, ctx.groundHeight, ctx.mapSize
    );
}

/** Handle active terrain leveling during construction */
function handleTerrainLeveling(
    buildingState: BuildingState,
    newPhase: BuildingConstructionPhase,
    ctx: TerrainContext
): boolean {
    if (newPhase !== BuildingConstructionPhase.TerrainLeveling) return false;
    if (!buildingState.originalTerrain) return false;

    return applyTerrainLeveling(
        buildingState, ctx.groundType, ctx.groundHeight, ctx.mapSize,
        buildingState.phaseProgress
    );
}

/** Finalize terrain when transitioning out of TerrainLeveling phase */
function handleTerrainFinalization(
    buildingState: BuildingState,
    previousPhase: BuildingConstructionPhase,
    newPhase: BuildingConstructionPhase,
    ctx: TerrainContext
): boolean {
    if (previousPhase !== BuildingConstructionPhase.TerrainLeveling) return false;
    if (newPhase <= BuildingConstructionPhase.TerrainLeveling) return false;
    if (!buildingState.originalTerrain || buildingState.terrainModified) return false;

    buildingState.terrainModified = true;
    return applyTerrainLeveling(
        buildingState, ctx.groundType, ctx.groundHeight, ctx.mapSize, 1.0
    );
}

/** Update a single building's construction state */
function updateSingleBuilding(
    state: GameState,
    buildingState: BuildingState,
    dt: number,
    terrainContext?: TerrainContext
): boolean {
    const previousPhase = buildingState.phase;

    buildingState.elapsedTime += dt;
    const elapsedFraction = Math.min(buildingState.elapsedTime / buildingState.totalDuration, 1.0);

    const newPhase = determinePhase(elapsedFraction);
    buildingState.phase = newPhase;
    buildingState.phaseProgress = calculatePhaseProgress(elapsedFraction, newPhase);

    let terrainModified = false;
    if (terrainContext) {
        handleTerrainCapture(buildingState, newPhase, terrainContext);
        terrainModified = handleTerrainLeveling(buildingState, newPhase, terrainContext);
        terrainModified = handleTerrainFinalization(
            buildingState, previousPhase, newPhase, terrainContext
        ) || terrainModified;
    }

    if (newPhase === BuildingConstructionPhase.Completed) {
        spawnUnitsOnBuildingComplete(state, buildingState, terrainContext);
    }

    return terrainModified;
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
        if (buildingState.phase === BuildingConstructionPhase.Completed) continue;

        if (updateSingleBuilding(state, buildingState, dt, terrainContext)) {
            terrainModified = true;
        }
    }

    if (terrainModified && terrainContext?.onTerrainModified) {
        terrainContext.onTerrainModified();
    }
}

/** Check if a tile is valid for spawning a unit */
function isValidSpawnTile(
    state: GameState,
    x: number, y: number,
    terrainContext?: TerrainContext
): boolean {
    if (terrainContext) {
        const { mapSize, groundType } = terrainContext;
        if (x < 0 || x >= mapSize.width || y < 0 || y >= mapSize.height) return false;
        if (!isPassable(groundType[mapSize.toIndex(x, y)])) return false;
    }
    return !state.getEntityAt(x, y);
}

/** Generate ring perimeter tiles (only the edge of a square ring) */
function* getRingTiles(cx: number, cy: number, radius: number): Generator<{ x: number; y: number }> {
    for (let dy = -radius; dy <= radius; dy++) {
        for (let dx = -radius; dx <= radius; dx++) {
            if (Math.abs(dx) === radius || Math.abs(dy) === radius) {
                yield { x: cx + dx, y: cy + dy };
            }
        }
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

    const { tileX: bx, tileY: by } = buildingState;
    let spawned = 0;

    for (let radius = 1; radius <= 4 && spawned < spawnDef.count; radius++) {
        for (const tile of getRingTiles(bx, by, radius)) {
            if (spawned >= spawnDef.count) break;
            if (!isValidSpawnTile(state, tile.x, tile.y, terrainContext)) continue;

            state.addEntity(
                EntityType.Unit, spawnDef.unitType, tile.x, tile.y,
                entity.player, spawnDef.selectable
            );
            spawned++;
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
