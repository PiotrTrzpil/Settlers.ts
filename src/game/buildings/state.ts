/**
 * Building construction state types.
 * Separated to avoid circular dependencies with building-construction.ts.
 */

import { BuildingType } from './types';

/**
 * Phases of building construction.
 * Each phase uses different visuals and progresses over time.
 */
export enum BuildingConstructionPhase {
    /** Initial phase: building poles/markers appear */
    Poles = 0,
    /** Terrain leveling phase: ground is prepared */
    TerrainLeveling = 1,
    /** Construction frame rises from bottom */
    ConstructionRising = 2,
    /** Completed building frame rises from bottom */
    CompletedRising = 3,
    /** Building is fully completed */
    Completed = 4,
}

/**
 * A single tile captured before construction site modification.
 * Stores all original state needed for restoration.
 */
export interface CapturedTerrainTile {
    x: number;
    y: number;
    /** Original ground type (landscape type) before construction */
    originalGroundType: number;
    /** Original ground height before leveling */
    originalGroundHeight: number;
    /** True if this tile is part of the building footprint (gets ground type changed).
     *  False if it's a neighbor tile (only height is leveled for smooth transitions). */
    isFootprint: boolean;
}

/**
 * Stores original terrain state before construction site modification.
 * Used to restore terrain if building is cancelled.
 */
export interface ConstructionSiteOriginalTerrain {
    /** All captured tiles (footprint + surrounding neighbors) */
    tiles: CapturedTerrainTile[];
    /** Target (leveled) height for the construction site */
    targetHeight: number;
}

/**
 * State tracking for building construction progress.
 * Similar to UnitState for movement interpolation.
 */
export interface BuildingState {
    entityId: number;
    /** Building type, used to determine footprint for terrain modification */
    buildingType: BuildingType;
    /** Current construction phase */
    phase: BuildingConstructionPhase;
    /** Progress within current phase (0.0 to 1.0) */
    phaseProgress: number;
    /** Total construction duration in seconds */
    totalDuration: number;
    /** Time elapsed since construction started */
    elapsedTime: number;
    /** Building anchor tile position (top-left corner of footprint) */
    tileX: number;
    tileY: number;
    /** Original terrain state before construction */
    originalTerrain: ConstructionSiteOriginalTerrain | null;
    /** Whether terrain modification has been applied */
    terrainModified: boolean;
}
