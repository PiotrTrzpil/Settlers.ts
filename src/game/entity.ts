export interface TileCoord {
    x: number;
    y: number;
}

/** Convert tile coordinates to a string key for Map lookups */
export function tileKey(x: number, y: number): string {
    return x + ',' + y;
}

/** 4-directional neighbor offsets (right, left, down, up) */
export const CARDINAL_OFFSETS: ReadonlyArray<readonly [number, number]> = [
    [1, 0], [-1, 0], [0, 1], [0, -1]
];

/** 6-directional neighbor offsets (cardinal + two diagonals) */
export const EXTENDED_OFFSETS: ReadonlyArray<readonly [number, number]> = [
    [1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1]
];

export enum EntityType {
    None = 0,
    Unit = 1,
    Building = 2,
    /** Map objects like trees, stones, resources */
    MapObject = 3,
    /** Stacked resources on the ground (logs, planks, etc.) */
    StackedResource = 4,
}

/**
 * Types of map objects (landscape elements).
 * These are natural objects that exist on the map independently of players.
 */
export enum MapObjectType {
    // Trees
    TreePine = 0,
    TreeOak = 1,
    TreeBirch = 2,
    TreePalm = 3,
    TreeCypress = 4,
    TreeDead = 5,

    // Stones
    StoneSmall = 10,
    StoneMedium = 11,
    StoneLarge = 12,

    // Resources (mineable)
    IronDeposit = 20,
    GoldDeposit = 21,
    CoalDeposit = 22,
    StoneDeposit = 23,
    SulfurDeposit = 24,
    GemsDeposit = 25,

    // Plants
    Bush = 30,
    Mushroom = 31,
    Flowers = 32,
    Corn = 33,
    Wheat = 34,

    // Other objects
    Stump = 40,
    FallenTree = 41,
    Pile = 42,
}

export enum BuildingType {
    Lumberjack = 1,
    Warehouse = 2,
    Sawmill = 3,
    Stonecutter = 4,
    Farm = 5,
    Windmill = 6,
    Bakery = 7,
    Fishery = 8,
    PigFarm = 9,
    Slaughterhouse = 10,
    Waterworks = 11,
    CoalMine = 12,
    IronMine = 13,
    GoldMine = 14,
    IronSmelter = 15,
    GoldSmelter = 16,
    WeaponSmith = 17,
    ToolSmith = 18,
    Barrack = 19,
    Forester = 20,
    LivingHouse = 21,
    Tower = 22,
    Winegrower = 23,
    Hunter = 24,
    DonkeyFarm = 25,
    StoneMine = 26,
    SulfurMine = 27,
    Healer = 28,
    SmallHouse = 29,
    MediumHouse = 30,
    LargeHouse = 31,
    LargeTower = 32,
    Castle = 33,
    AmmunitionMaker = 34,
    SmallTemple = 35,
    LargeTemple = 36,
    ScoutTower = 37,
    Shipyard = 38,
    Decoration = 39,
    WinePress = 40,
    SiegeWorkshop = 41,
    LargeDecoration = 42,
}

export enum UnitType {
    Settler = 0,
    Soldier = 1,
    Bearer = 2,
    Swordsman = 3,
    Bowman = 4,
    Pikeman = 5,
    Priest = 6,
    Pioneer = 7,
    Thief = 8,
    Geologist = 9,
}

/**
 * Configuration for each unit type.
 * Centralizes all unit properties so adding new types is a single-entry change.
 */
export interface UnitTypeConfig {
    /** Display name for UI */
    name: string;
    /** Default movement speed in tiles/second */
    speed: number;
    /** Whether units of this type are selectable by the player */
    selectable: boolean;
    /** Whether this is a military unit (can fight) */
    military: boolean;
}

/**
 * Central registry of unit type configurations.
 * To add a new unit type:
 * 1. Add an entry to the UnitType enum
 * 2. Add its config here
 * 3. Optionally add it to BUILDING_SPAWN_ON_COMPLETE if a building produces it
 */
export const UNIT_TYPE_CONFIG: Record<UnitType, UnitTypeConfig> = {
    [UnitType.Settler]: { name: 'Settler', speed: 2, selectable: false, military: false },
    [UnitType.Soldier]: { name: 'Soldier', speed: 2.5, selectable: true, military: true },
    [UnitType.Bearer]: { name: 'Bearer', speed: 2, selectable: false, military: false },
    [UnitType.Swordsman]: { name: 'Swordsman', speed: 2, selectable: true, military: true },
    [UnitType.Bowman]: { name: 'Bowman', speed: 2.2, selectable: true, military: true },
    [UnitType.Pikeman]: { name: 'Pikeman', speed: 1.8, selectable: true, military: true },
    [UnitType.Priest]: { name: 'Priest', speed: 1.5, selectable: true, military: false },
    [UnitType.Pioneer]: { name: 'Pioneer', speed: 2, selectable: true, military: false },
    [UnitType.Thief]: { name: 'Thief', speed: 3, selectable: true, military: false },
    [UnitType.Geologist]: { name: 'Geologist', speed: 1.5, selectable: true, military: false },
};

/** Get the default selectable state for a unit type. */
export function isUnitTypeSelectable(unitType: UnitType): boolean {
    return UNIT_TYPE_CONFIG[unitType]?.selectable ?? true;
}

/** Get the default speed for a unit type. */
export function getUnitTypeSpeed(unitType: UnitType): number {
    return UNIT_TYPE_CONFIG[unitType]?.speed ?? 2;
}

/** Territory radius for each building type (in tiles) */
export const BUILDING_TERRITORY_RADIUS: Record<number, number> = {
    [BuildingType.Lumberjack]: 4,
    [BuildingType.Warehouse]: 6,
    [BuildingType.Sawmill]: 4,
    [BuildingType.Stonecutter]: 4,
    [BuildingType.Farm]: 6,
    [BuildingType.Windmill]: 4,
    [BuildingType.Bakery]: 4,
    [BuildingType.Fishery]: 4,
    [BuildingType.PigFarm]: 5,
    [BuildingType.Slaughterhouse]: 4,
    [BuildingType.Waterworks]: 4,
    [BuildingType.CoalMine]: 4,
    [BuildingType.IronMine]: 4,
    [BuildingType.GoldMine]: 4,
    [BuildingType.IronSmelter]: 4,
    [BuildingType.GoldSmelter]: 4,
    [BuildingType.WeaponSmith]: 4,
    [BuildingType.ToolSmith]: 4,
    [BuildingType.Barrack]: 5,
    [BuildingType.Forester]: 6,
    [BuildingType.LivingHouse]: 4,
    [BuildingType.Tower]: 10,
    [BuildingType.Winegrower]: 6,
};

/** Which unit type each building auto-spawns at placement time (undefined = no auto-spawn) */
export const BUILDING_UNIT_TYPE: Record<number, UnitType | undefined> = {
    [BuildingType.Lumberjack]: UnitType.Settler,
    [BuildingType.Warehouse]: undefined,
};

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
    [BuildingType.SmallHouse]: { unitType: UnitType.Settler, count: 2 },
    [BuildingType.MediumHouse]: { unitType: UnitType.Settler, count: 4 },
    [BuildingType.LargeHouse]: { unitType: UnitType.Settler, count: 6 },
};

/**
 * Building footprint size in tiles (width x height).
 * Most buildings are 2x2, some are 3x3, decorations are 1x1.
 */
export interface BuildingSize {
    width: number;
    height: number;
}

/** Building footprint sizes for each building type */
export const BUILDING_SIZE: Record<number, BuildingSize> = {
    // Small buildings (1x1)
    [BuildingType.Decoration]: { width: 1, height: 1 },

    // Medium buildings (2x2) - most production buildings
    [BuildingType.Lumberjack]: { width: 2, height: 2 },
    [BuildingType.Sawmill]: { width: 2, height: 2 },
    [BuildingType.Stonecutter]: { width: 2, height: 2 },
    [BuildingType.Farm]: { width: 2, height: 2 },
    [BuildingType.Windmill]: { width: 2, height: 2 },
    [BuildingType.Bakery]: { width: 2, height: 2 },
    [BuildingType.Fishery]: { width: 2, height: 2 },
    [BuildingType.PigFarm]: { width: 2, height: 2 },
    [BuildingType.Slaughterhouse]: { width: 2, height: 2 },
    [BuildingType.Waterworks]: { width: 2, height: 2 },
    [BuildingType.CoalMine]: { width: 2, height: 2 },
    [BuildingType.IronMine]: { width: 2, height: 2 },
    [BuildingType.GoldMine]: { width: 2, height: 2 },
    [BuildingType.IronSmelter]: { width: 2, height: 2 },
    [BuildingType.GoldSmelter]: { width: 2, height: 2 },
    [BuildingType.WeaponSmith]: { width: 2, height: 2 },
    [BuildingType.ToolSmith]: { width: 2, height: 2 },
    [BuildingType.Forester]: { width: 2, height: 2 },
    [BuildingType.LivingHouse]: { width: 2, height: 2 },
    [BuildingType.Winegrower]: { width: 2, height: 2 },
    [BuildingType.Hunter]: { width: 2, height: 2 },
    [BuildingType.DonkeyFarm]: { width: 2, height: 2 },
    [BuildingType.StoneMine]: { width: 2, height: 2 },
    [BuildingType.SulfurMine]: { width: 2, height: 2 },
    [BuildingType.Healer]: { width: 2, height: 2 },
    [BuildingType.SmallHouse]: { width: 2, height: 2 },
    [BuildingType.MediumHouse]: { width: 2, height: 2 },
    [BuildingType.AmmunitionMaker]: { width: 2, height: 2 },
    [BuildingType.SmallTemple]: { width: 2, height: 2 },
    [BuildingType.WinePress]: { width: 2, height: 2 },

    // Military buildings (2x2)
    [BuildingType.Tower]: { width: 2, height: 2 },
    [BuildingType.Barrack]: { width: 2, height: 2 },
    [BuildingType.ScoutTower]: { width: 2, height: 2 },

    // Large buildings (3x3)
    [BuildingType.Warehouse]: { width: 3, height: 3 },
    [BuildingType.LargeHouse]: { width: 3, height: 3 },
    [BuildingType.LargeTower]: { width: 3, height: 3 },
    [BuildingType.Castle]: { width: 3, height: 3 },
    [BuildingType.LargeTemple]: { width: 3, height: 3 },
    [BuildingType.Shipyard]: { width: 3, height: 3 },
    [BuildingType.SiegeWorkshop]: { width: 3, height: 3 },
    [BuildingType.LargeDecoration]: { width: 3, height: 3 },
};

/** Get building size, defaults to 2x2 if not specified */
export function getBuildingSize(buildingType: BuildingType): BuildingSize {
    return BUILDING_SIZE[buildingType] ?? { width: 2, height: 2 };
}

/**
 * Get all tile coordinates that a building occupies.
 * The input (x, y) is the top-left corner of the building footprint.
 */
export function getBuildingFootprint(x: number, y: number, buildingType: BuildingType): TileCoord[] {
    const size = getBuildingSize(buildingType);
    const tiles: TileCoord[] = [];
    for (let dy = 0; dy < size.height; dy++) {
        for (let dx = 0; dx < size.width; dx++) {
            tiles.push({ x: x + dx, y: y + dy });
        }
    }
    return tiles;
}

export interface Entity {
    id: number;
    type: EntityType;
    x: number;
    y: number;
    player: number;
    subType: number;
    /** Optional animation state for animated entities */
    animationState?: import('./animation').AnimationState;
    /** Whether this entity can be selected by the player. Defaults to true if not specified. */
    selectable?: boolean;
}

export interface UnitState {
    entityId: number;
    path: TileCoord[];
    pathIndex: number;
    moveProgress: number;
    speed: number;
    /** Previous tile position for visual interpolation */
    prevX: number;
    prevY: number;
}

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

/**
 * Maximum items that can be stacked in a single resource pile.
 * This matches Settlers 4 behavior where carriers drop resources in stacks.
 */
export const MAX_RESOURCE_STACK_SIZE = 8;

/**
 * State tracking for stacked resources on the ground.
 * These are mutable - carriers can add to or take from stacks.
 */
export interface StackedResourceState {
    entityId: number;
    /** Number of items in the stack (1 to MAX_RESOURCE_STACK_SIZE) */
    quantity: number;
}
