/**
 * Building construction state types.
 * Defines all types for tracking construction progress.
 */

import { BuildingType } from '../../buildings/types';
import { Race } from '../../core/race';
import type { TerrainData } from '../../terrain';
import { UnitType } from '../../core/unit-types';
import type { EMaterialType } from '../../economy/material-type';
import type { ConstructionCost } from '../../economy/building-production';
import type { Tile } from '../../core/coordinates';

/**
 * Phases of building construction.
 * Progression is event-driven: diggers level terrain, carriers deliver materials, builders construct.
 */
export enum BuildingConstructionPhase {
    /** Placed, ground changed to DustyWay, awaiting diggers */
    WaitingForDiggers = 0,
    /** Diggers actively leveling terrain (driven by digger work ticks) */
    TerrainLeveling = 1,
    /** Leveling done but units still on footprint — evacuating before footprint block is restored */
    Evacuating = 2,
    /** Leveling done, awaiting materials + builders */
    WaitingForBuilders = 3,
    /** Builders actively constructing (driven by builder work ticks + materials) */
    ConstructionRising = 4,
    /** Final rise animation (progress-based) */
    CompletedRising = 5,
    /** Terminal — building is fully completed */
    Completed = 6,
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
 * Worker slot tracking — shared structure for both digger and builder phases.
 * Tracks assigned workers and the one-shot "started" event flag.
 */
export interface WorkerSlots {
    /** Max concurrent workers for this phase (derived from building size) */
    required: number;
    /** Entity IDs of workers currently assigned */
    assigned: Set<number>;
    /** Whether the first worker has been assigned (for one-shot event emission) */
    started: boolean;
}

/**
 * Terrain leveling phase data.
 * Tracks digger slots, leveling progress, and captured terrain for restoration.
 */
export interface TerrainPhase {
    slots: WorkerSlots;
    /** 0.0–1.0, incremented by each digger work tick */
    progress: number;
    /** All terrain leveled — gate for builder assignment */
    complete: boolean;
    /** Original terrain state before construction site modification. Set when digging starts. */
    originalTerrain: ConstructionSiteOriginalTerrain | null;
    /** Whether terrain leveling has been finalized (applied at 1.0) */
    modified: boolean;
    /** Indices into originalTerrain.tiles[] for tiles that still need height leveling. Null before terrain capture. */
    unleveledTiles: Set<number> | null;
    /** Tile indices currently reserved by a digger (claimed via reserveUnleveledTile, released on complete/interrupt). */
    reservedTiles: Set<number>;
    /** Total number of tiles that needed leveling (for progress calculation). 0 before terrain capture. */
    totalLevelingTiles: number;
}

/**
 * Material delivery tracking.
 * Tracks construction costs only — consumed/delivered amounts are derived from
 * BuildingInventoryManager throughput counters (totalIn/totalOut).
 */
export interface MaterialsData {
    /** From getConstructionCosts(buildingType, race) */
    costs: readonly ConstructionCost[];
    /** Sum of all cost quantities */
    totalCost: number;
}

/**
 * Building construction phase data.
 * Tracks builder slots and construction progress.
 */
export interface BuildingPhase {
    slots: WorkerSlots;
    /** 0.0–1.0, incremented by builder work ticks */
    progress: number;
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
    /** Terrain leveling phase data (digger slots, progress, captured terrain) */
    terrain: TerrainPhase;
    /** Material delivery tracking */
    materials: MaterialsData;
    /** Building construction phase data (builder slots, progress) */
    building: BuildingPhase;
    /** Pre-computed pile positions per material — multiple positions when count > 8 (one pile per 8 items). */
    pilePositions: ReadonlyMap<EMaterialType, readonly Tile[]>;
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
    terrain: TerrainData;
    /** Callback to notify that terrain has changed and needs re-upload to GPU */
    onTerrainModified?: (reason: 'leveling' | 'restore', x: number, y: number) => void;
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
