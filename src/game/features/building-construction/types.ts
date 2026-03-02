/**
 * Building construction state types.
 * Defines all types for tracking construction progress.
 */

import { BuildingType } from '../../buildings/types';
import { Race } from '../../race';
import { UnitType } from '../../unit-types';
import type { EMaterialType } from '../../economy/material-type';
import type { ConstructionCost } from '../../economy/building-production';

/**
 * Phases of building construction.
 * Progression is event-driven: diggers level terrain, carriers deliver materials, builders construct.
 */
export enum BuildingConstructionPhase {
    /** Placed, ground changed to DustyWay, awaiting diggers */
    WaitingForDiggers = 0,
    /** Diggers actively leveling terrain (driven by digger work ticks) */
    TerrainLeveling = 1,
    /** Leveling done, awaiting materials + builders */
    WaitingForBuilders = 2,
    /** Builders actively constructing (driven by builder work ticks + materials) */
    ConstructionRising = 3,
    /** Final rise animation (timed, 0.5s) */
    CompletedRising = 4,
    /** Terminal — building is fully completed */
    Completed = 5,
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
 * Active construction site data — one per building under construction.
 * Managed by ConstructionSiteManager.
 * Created on building:placed, removed on building:completed or entity removal.
 *
 * The sole state object for a building under construction. A building entity
 * with no ConstructionSite record is operational.
 */
export interface ConstructionSite {
    buildingId: number;
    buildingType: BuildingType;
    race: Race;
    player: number;
    tileX: number;
    tileY: number;
    /** Current construction phase */
    phase: BuildingConstructionPhase;
    /** Original terrain state before construction site modification. Set when digging starts. */
    originalTerrain: ConstructionSiteOriginalTerrain | null;
    /** Whether terrain leveling has been finalized (applied at 1.0) */
    terrainModified: boolean;
    /** Digger slots (from building size) */
    requiredDiggers: number;
    /** Entity IDs of diggers currently working */
    assignedDiggers: Set<number>;
    /** 0.0–1.0, incremented by each digger work tick */
    levelingProgress: number;
    /** All terrain leveled */
    levelingComplete: boolean;
    /** From getConstructionCosts(buildingType, race) */
    constructionCosts: readonly ConstructionCost[];
    /** Materials delivered so far */
    deliveredMaterials: Map<EMaterialType, number>;
    /** Sum of all cost quantities */
    totalCostAmount: number;
    /** Sum of all delivered quantities */
    deliveredAmount: number;
    /** Builder slots (from building size) */
    requiredBuilders: number;
    /** Entity IDs of builders currently working */
    assignedBuilders: Set<number>;
    /** 0.0–1.0, incremented by builder work ticks */
    constructionProgress: number;
    /** Materials consumed by builder work ticks */
    consumedAmount: number;
    /** 0.0–1.0, driven by CompletedRising timer. Used by visual state for the final rise animation. */
    completedRisingProgress: number;
}

/**
 * Which unit type (and count) each building spawns when construction completes.
 */
export interface BuildingSpawnConfig {
    unitType: UnitType;
    count: number;
    /** Override default selectability from UNIT_TYPE_CONFIG (undefined = use default) */
    selectable?: boolean;
    /** If set, units spawn one at a time at this interval (seconds) instead of all at once */
    spawnInterval?: number;
}

/**
 * Terrain modification context for construction.
 * Pass this to enable terrain leveling during construction.
 */
export interface TerrainContext {
    terrain: import('../../terrain').TerrainData;
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
    /** Overall construction progress (0.0 to 1.0) for UI display */
    overallProgress: number;
    /** Is the building fully completed */
    isCompleted: boolean;
    /** Current phase for debugging/display */
    phase: BuildingConstructionPhase;
}
