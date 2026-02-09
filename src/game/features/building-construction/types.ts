/**
 * Building construction state types.
 * Defines all types for tracking construction progress.
 */

import { BuildingType } from '../../buildings/types';
import { UnitType } from '../../unit-types';

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

/**
 * Which unit type (and count) each building spawns when construction completes.
 */
export interface BuildingSpawnConfig {
    unitType: UnitType;
    count: number;
    /** Override default selectability from UNIT_TYPE_CONFIG (undefined = use default) */
    selectable?: boolean;
}

/**
 * Terrain modification context for construction.
 * Pass this to enable terrain leveling during construction.
 */
export interface TerrainContext {
    groundType: Uint8Array;
    groundHeight: Uint8Array;
    mapSize: import('@/utilities/map-size').MapSize;
    /** Callback to notify that terrain has changed and needs re-upload to GPU */
    onTerrainModified?: () => void;
}

/**
 * Visual state for rendering a building.
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
