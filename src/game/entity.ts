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

/** Which unit type each building produces (undefined = no auto-spawn) */
export const BUILDING_UNIT_TYPE: Record<number, UnitType | undefined> = {
    [BuildingType.Lumberjack]: UnitType.Settler,
    [BuildingType.Warehouse]: undefined,
};

export interface Entity {
    id: number;
    type: EntityType;
    x: number;
    y: number;
    player: number;
    subType: number;
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
 * State tracking for building construction progress.
 * Similar to UnitState for movement interpolation.
 */
export interface BuildingState {
    entityId: number;
    /** Current construction phase */
    phase: BuildingConstructionPhase;
    /** Progress within current phase (0.0 to 1.0) */
    phaseProgress: number;
    /** Total construction duration in seconds */
    totalDuration: number;
    /** Time elapsed since construction started */
    elapsedTime: number;
}
