import { BuildingType, MapObjectType, UnitType, EntityType } from '../entity';
import { EMaterialType } from '../economy';
import { AtlasRegion } from './entity-texture-atlas';
import { AnimationSequence, AnimationData, ANIMATION_DEFAULTS, ANIMATION_SEQUENCES } from '../animation';
import { mapToArray, arrayToMap } from './sprite-metadata-helpers';

/** Conversion factor from sprite pixels to world-space units */
export const PIXELS_TO_WORLD = 1.0 / 64.0;

/**
 * Available races/civilizations with their GFX file numbers.
 */
export enum Race {
    Roman = 10,
    Viking = 11,
    Mayan = 12,
    DarkTribe = 13,  // Uses different building mappings
    Trojan = 14,
}

/** Display names for races */
export const RACE_NAMES: Record<Race, string> = {
    [Race.Roman]: 'Roman',
    [Race.Viking]: 'Viking',
    [Race.Mayan]: 'Mayan',
    [Race.DarkTribe]: 'Dark Tribe',
    [Race.Trojan]: 'Trojan',
};

/** List of all available races for UI (excludes DarkTribe which has different mappings) */
export const AVAILABLE_RACES: Race[] = [Race.Roman, Race.Viking, Race.Mayan, Race.Trojan];

/**
 * GFX file numbers for different content types.
 */
export const GFX_FILE_NUMBERS = {
    /** Landscape textures */
    LANDSCAPE: 2,
    /** Resource sprites (logs, piles, goods on ground) */
    RESOURCES: 3,
    /** Map objects (trees, stones, plants, decorations) */
    MAP_OBJECTS: 5,
    /** UI elements including building icons */
    UI: 9,
} as const;

/**
 * Direct GIL indices for building icons in the UI palette, per race.
 * Each entry has [unselected, selected] indices.
 * Mapped from the icon GFX files (9.gfx for Roman, 19.gfx for Viking, etc.)
 */
export const BUILDING_ICON_INDICES: Record<Race, Partial<Record<BuildingType, [number, number]>>> = {
    [Race.Roman]: {
        [BuildingType.WoodcutterHut]: [828, 833],
    },
    [Race.Viking]: {
        [BuildingType.WoodcutterHut]: [772, 773],
    },
    [Race.Mayan]: {
        [BuildingType.WoodcutterHut]: [776, 806],
    },
    [Race.DarkTribe]: {},
    [Race.Trojan]: {},
};

/**
 * GFX file numbers for building icons by race.
 * These contain UI icons for the building palette.
 */
export const BUILDING_ICON_FILE_NUMBERS: Record<Race, number> = {
    [Race.Roman]: 9,
    [Race.Viking]: 19,
    [Race.Mayan]: 29,
    [Race.DarkTribe]: 9,  // Fallback to Roman icons
    [Race.Trojan]: 39,
};

/**
 * GFX file numbers for settler/unit sprites by race.
 * These are separate from building sprites.
 */
export const SETTLER_FILE_NUMBERS: Record<Race, number> = {
    [Race.Roman]: 20,
    [Race.Viking]: 21,
    [Race.Mayan]: 22,
    [Race.DarkTribe]: 23,
    [Race.Trojan]: 24,
};

/**
 * Direction indices for unit sprites in DIL files.
 * Units have 6 directions matching the hex grid.
 */
export const UNIT_DIRECTION = {
    /** Facing north-east (D0) */
    NORTH_EAST: 0,
    /** Facing east (D1) */
    EAST: 1,
    /** Facing south-east (D2) */
    SOUTH_EAST: 2,
    /** Facing south-west (D3) */
    SOUTH_WEST: 3,
    /** Facing west (D4) */
    WEST: 4,
    /** Facing north-west (D5) */
    NORTH_WEST: 5,
} as const;

export const NUM_UNIT_DIRECTIONS = 6;

/**
 * Mapping from UnitType to JIL job index in settler files (20-24.jil).
 * The job index is the same across all race files - only the GFX file number differs.
 * These indices map to unit sprites via JIL -> DIL -> GIL -> GFX.
 *
 * Each job has 6 directions (D0-D5) matching hex grid directions.
 */
export const UNIT_JOB_INDICES: Partial<Record<UnitType, number>> = {
    // Job 0: Unknown/placeholder
    [UnitType.Carrier]: 1,      // Carrier without goods (walk cycle)
    [UnitType.Builder]: 19,     // Construction worker
    [UnitType.Woodcutter]: 5,   // Woodcutter
    [UnitType.Swordsman]: 227,  // Lvl1 swordsman (first of pair 227/228)
    [UnitType.Bowman]: 236,     // Lvl1 bowman standing (236-240 = set1, 242-246 = set2)
    [UnitType.Digger]: 50,      // Digger/Landscaper walk
    [UnitType.Smith]: 52,       // Smith idle
    [UnitType.Miner]: 60,       // Miner walk
    [UnitType.Forester]: 62,    // Forester idle
    [UnitType.Farmer]: 65,      // Farmer idle
    [UnitType.Priest]: 287,     // Priest idle/walk (288 is alternate?)
    [UnitType.Geologist]: 290,  // Geologist idle
    [UnitType.Pioneer]: 298,    // Pioneer idle
    [UnitType.Thief]: -1,       // TODO: Not yet identified
};

/**
 * Additional carrier animation job indices (not walk cycles).
 * Jobs 44-48: Carrier idle animations
 * Job 49: Striking carrier (on strike/protesting)
 */
export const CARRIER_IDLE_JOB_INDICES = [44, 45, 46, 47, 48];
export const CARRIER_STRIKE_JOB_INDEX = 49;

/**
 * Worker job indices for various professions and their animation states.
 * These are in settler files (20-24.jil).
 */
export const WORKER_JOB_INDICES = {
    // Digger/Landscaper (uses shovel)
    digger: {
        walk: 50,
        working: 51,
    },
    // Smithy worker
    smith: {
        idle: 52,
    },
    // Builder
    builder: {
        walk: 53,  // Note: also at job 19
    },
    // Woodcutter
    woodcutter: {
        walk: 54,  // Note: also at job 5
        withLog: 55,
        chopping: 56,
        cuttingLogOnGround: 57,
    },
    // Miner
    miner: {
        idle: 58,
        working: 59,
        walk: 60,
        withStone: 61,
    },
    // Forester
    forester: {
        idle: 62,
        withPlant: 63,
        planting: 64,
    },
    // Farmer
    farmer: {
        idle: 65,
        withGrain: 66,
        seeding1: 67,
        seeding2: 68,
    },
    // Priest
    priest: {
        idle: 287,
        alternate: 288,  // Unknown purpose
    },
    // Geologist
    geologist: {
        idle: 290,
        working: [291, 292, 293, 294, 295, 296, 297],  // Different work phases
    },
    // Pioneer
    pioneer: {
        idle: 298,
        working1: 299,
        working2: 300,
    },
} as const;

/**
 * Soldier unit job indices by type and level.
 * Structure varies by unit type due to different animation needs.
 */
export const SOLDIER_JOB_INDICES = {
    /** Swordsman: 2 variants per level (appear identical) */
    swordsman: {
        lvl1: [227, 228],
        lvl2: [230, 231],
        lvl3: [233, 234],
    },
    /**
     * Bowman: Multiple animation states per level.
     * First index is standing/idle, rest are shooting animation variants.
     */
    bowman: {
        lvl1: [236, 237, 238, 239, 240],
        lvl2: [242, 243, 244, 245, 246],
        lvl3: [248, 249, 250, 251, 252],
    },
    // TODO: Add pikeman indices when identified
    // pikeman: { lvl1: ?, lvl2: ?, lvl3: ? },
} as const;

/**
 * Metadata for a single sprite entry in the atlas.
 * Contains both atlas coordinates and world-space sizing.
 */
export interface SpriteEntry {
    /** UV coordinates and pixel position in the atlas */
    atlasRegion: AtlasRegion;
    /** Drawing offset X from GfxImage.left, in world units */
    offsetX: number;
    /** Drawing offset Y from GfxImage.top, in world units */
    offsetY: number;
    /** Sprite width in world-space units */
    widthWorld: number;
    /** Sprite height in world-space units */
    heightWorld: number;
}

/**
 * Direction indices for building sprites in DIL files.
 * D0 = construction/ghost, D1 = completed building.
 */
export const BUILDING_DIRECTION = {
    /** Partially constructed / ghost preview (D0) */
    CONSTRUCTION: 0,
    /** Completed building (D1) */
    COMPLETED: 1,
} as const;

/**
 * Building sprite info with both construction and completed GIL frame indices.
 * These are looked up via JIL job -> DIL direction -> GIL frame.
 */
export interface BuildingSpriteFrames {
    /** JIL job index for this building */
    job: number;
    /** GIL frame index for construction/ghost state (from DIL D0) */
    construction: number;
    /** GIL frame index for completed state (from DIL D1) */
    completed: number;
}

/**
 * Complete building sprite mappings with both construction and completed frame indices.
 * Job index is the JIL entry, construction/completed are the resolved GIL frame indices.
 */
export const BUILDING_SPRITE_FRAMES: Partial<Record<BuildingType, BuildingSpriteFrames>> = {
    // TODO: Fill in GIL frame indices from JIL viewer
    // Format: { job: JIL_index, construction: D0_GIL_frame, completed: D1_GIL_frame }
};

/**
 * Defines the GFX file and sprite index for a building type.
 */
export interface BuildingSpriteInfo {
    /** GFX file number (e.g., 10 for 10.gfx) */
    file: number;
    /** JIL job index within the GFX file */
    index: number;
}

/**
 * Mapping from BuildingType to JIL job index.
 * The job index is the same across all race files - only the GFX file number differs.
 * These indices map to building sprites via JIL -> DIL -> GIL -> GFX.
 */
export const BUILDING_JOB_INDICES: Partial<Record<BuildingType, number>> = {
    // JIL indices match S4BuildingType values from s4-types.ts
    // Reference: src/resources/map/s4-types.ts S4BuildingType enum
    [BuildingType.WoodcutterHut]: 1,   // S4BuildingType.WOODCUTTERHUT
    [BuildingType.ForesterHut]: 2,     // S4BuildingType.FORESTERHUT
    [BuildingType.Sawmill]: 3,         // S4BuildingType.SAWMILL
    [BuildingType.StonecutterHut]: 4,  // S4BuildingType.STONECUTTERHUT
    [BuildingType.WaterworkHut]: 5,    // S4BuildingType.WATERWORKHUT
    [BuildingType.FisherHut]: 6,       // S4BuildingType.FISHERHUT
    [BuildingType.HunterHut]: 7,       // S4BuildingType.HUNTERHUT
    [BuildingType.Slaughterhouse]: 8,  // S4BuildingType.SLAUGHTERHOUSE
    [BuildingType.Mill]: 9,            // S4BuildingType.MILL
    [BuildingType.Bakery]: 10,         // S4BuildingType.BAKERY
    [BuildingType.GrainFarm]: 11,      // S4BuildingType.GRAINFARM
    [BuildingType.AnimalRanch]: 12,    // S4BuildingType.ANIMALRANCH
    [BuildingType.DonkeyRanch]: 13,    // S4BuildingType.DONKEYRANCH
    [BuildingType.StoneMine]: 14,      // S4BuildingType.STONEMINE
    [BuildingType.IronMine]: 15,       // S4BuildingType.IRONMINE
    [BuildingType.GoldMine]: 16,       // S4BuildingType.GOLDMINE
    [BuildingType.CoalMine]: 17,       // S4BuildingType.COALMINE
    [BuildingType.SulfurMine]: 18,     // S4BuildingType.SULFURMINE
    [BuildingType.SmeltGold]: 19,      // S4BuildingType.SMELTGOLD
    [BuildingType.IronSmelter]: 20,    // S4BuildingType.SMELTIRON
    [BuildingType.ToolSmith]: 21,      // S4BuildingType.TOOLSMITH
    [BuildingType.WeaponSmith]: 22,    // S4BuildingType.WEAPONSMITH
    [BuildingType.SiegeWorkshop]: 23,  // S4BuildingType.VEHICLEHALL
    [BuildingType.Barrack]: 24,        // S4BuildingType.BARRACKS
    // CHARCOALMAKER = 25 (not in BuildingType)
    [BuildingType.LivingHouse]: 26,    // S4BuildingType.TRAININGCENTER
    [BuildingType.HealerHut]: 27,      // S4BuildingType.HEALERHUT
    [BuildingType.AmmunitionMaker]: 28, // S4BuildingType.AMMOMAKERHUT
    // GUNPOWDERMAKERHUT = 29, LANDSCAPEMAKERHUT = 30 (not in BuildingType)
    [BuildingType.Shipyard]: 31,       // S4BuildingType.SHIPYARD
    // PORT = 32, MARKETPLACE = 33 (not in BuildingType)
    [BuildingType.StorageArea]: 34,    // S4BuildingType.STORAGEAREA
    [BuildingType.WinePress]: 35,      // S4BuildingType.VINYARD
    // AGAVEFARMERHUT = 36, TEQUILAMAKERHUT = 37, BEEKEEPERHUT = 38, MEADMAKERHUT = 39 (not in BuildingType)
    [BuildingType.ResidenceSmall]: 40, // S4BuildingType.RESIDENCESMALL
    [BuildingType.ResidenceMedium]: 41, // S4BuildingType.RESIDENCEMEDIUM
    [BuildingType.ResidenceBig]: 42,   // S4BuildingType.RESIDENCEBIG
    [BuildingType.SmallTemple]: 43,    // S4BuildingType.SMALLTEMPLE
    [BuildingType.LargeTemple]: 44,    // S4BuildingType.BIGTEMPLE
    [BuildingType.LookoutTower]: 45,   // S4BuildingType.LOOKOUTTOWER
    [BuildingType.GuardTowerSmall]: 46, // S4BuildingType.GUARDTOWERSMALL
    [BuildingType.GuardTowerBig]: 47,  // S4BuildingType.GUARDTOWERBIG
    [BuildingType.Castle]: 48,         // S4BuildingType.CASTLE
    // MUSHROOMFARM = 49, DARKTEMPLE = 50, FORTRESS = 51 (race-specific)
    // 52-63: Shipyard orientations, 64-75: Decorations
    [BuildingType.Decoration]: 64,
    [BuildingType.LargeDecoration]: 65, // Large decorations start after small
};

/**
 * Mapping from EMaterialType to JIL job index in file 3.jil (resources).
 * JIL indices match S4GoodType values (alphabetically ordered goods).
 * Reference: src/resources/map/s4-types.ts S4GoodType enum.
 */
export const RESOURCE_JOB_INDICES: Partial<Record<EMaterialType, number>> = {
    // S4GoodType values are the JIL job indices (alphabetically ordered)
    [EMaterialType.AGAVE]: 1,      // S4GoodType.AGAVE
    // AMMO = 2 (not in EMaterialType)
    [EMaterialType.ARMOR]: 3,      // S4GoodType.ARMOR
    [EMaterialType.AXE]: 4,        // S4GoodType.AXE
    [EMaterialType.BATTLEAXE]: 5,  // S4GoodType.BATTLEAXE
    [EMaterialType.BLOWGUN]: 6,    // S4GoodType.BLOWGUN
    [EMaterialType.BOARD]: 7,      // S4GoodType.BOARD
    [EMaterialType.BOW]: 8,        // S4GoodType.BOW
    [EMaterialType.BREAD]: 9,      // S4GoodType.BREAD
    [EMaterialType.COAL]: 10,      // S4GoodType.COAL
    [EMaterialType.FISH]: 11,      // S4GoodType.FISH
    [EMaterialType.FLOUR]: 12,     // S4GoodType.FLOUR
    [EMaterialType.GOAT]: 13,      // S4GoodType.GOAT
    [EMaterialType.GOLDBAR]: 14,   // S4GoodType.GOLDBAR
    [EMaterialType.GOLDORE]: 15,   // S4GoodType.GOLDORE
    [EMaterialType.GRAIN]: 16,     // S4GoodType.GRAIN
    // GUNPOWDER = 17 (not in EMaterialType)
    [EMaterialType.HAMMER]: 18,    // S4GoodType.HAMMER
    [EMaterialType.HONEY]: 19,     // S4GoodType.HONEY
    [EMaterialType.IRONBAR]: 20,   // S4GoodType.IRONBAR
    [EMaterialType.IRONORE]: 21,   // S4GoodType.IRONORE
    [EMaterialType.LOG]: 22,       // S4GoodType.LOG
    [EMaterialType.MEAD]: 23,      // S4GoodType.MEAD
    [EMaterialType.MEAT]: 24,      // S4GoodType.MEAT
    [EMaterialType.PICKAXE]: 25,   // S4GoodType.PICKAXE
    [EMaterialType.PIG]: 26,       // S4GoodType.PIG
    [EMaterialType.ROD]: 27,       // S4GoodType.ROD
    [EMaterialType.SAW]: 28,       // S4GoodType.SAW
    [EMaterialType.SCYTHE]: 29,    // S4GoodType.SCYTHE
    [EMaterialType.SHEEP]: 30,     // S4GoodType.SHEEP
    [EMaterialType.SHOVEL]: 31,    // S4GoodType.SHOVEL
    [EMaterialType.STONE]: 32,     // S4GoodType.STONE
    [EMaterialType.SULFUR]: 33,    // S4GoodType.SULFUR
    [EMaterialType.SWORD]: 34,     // S4GoodType.SWORD
    // TEQUILA = 35 (not in EMaterialType)
    [EMaterialType.WATER]: 36,     // S4GoodType.WATER
    [EMaterialType.WINE]: 37,      // S4GoodType.WINE
    [EMaterialType.CATAPULT]: 38,  // Siege ammunition
    [EMaterialType.GOOSE]: 39,     // Livestock (geese)
};

/**
 * JIL job indices for carriers carrying specific materials, in settler files (20-24.jil).
 * Each material a carrier can carry has its own set of 6-direction walk frames.
 *
 * Job 1 is the empty carrier (already in UNIT_JOB_INDICES).
 * Carrier job indices follow the same pattern as resource JIL indices (3.jil) but +1.
 * E.g., AGAVE resource is job #1, carrier with AGAVE is job #2.
 */
export const CARRIER_MATERIAL_JOB_INDICES: Partial<Record<EMaterialType, number>> =
    Object.fromEntries(
        Object.entries(RESOURCE_JOB_INDICES)
            .filter(([, idx]) => idx !== undefined)
            .map(([type, idx]) => [Number(type), idx! + 1])
    ) as Partial<Record<EMaterialType, number>>;

/**
 * Sprite information for a resource type (dropped goods).
 */
export interface ResourceSpriteInfo {
    /** GFX file number (always file 3 for resources) */
    file: number;
    /** JIL job index within the GFX file */
    index: number;
}

/**
 * Get the resource sprite map.
 * Resources use JIL job indices from file 3.gfx.
 */
export function getResourceSpriteMap(): Partial<Record<EMaterialType, ResourceSpriteInfo>> {
    const result: Partial<Record<EMaterialType, ResourceSpriteInfo>> = {};

    for (const [typeStr, jobIndex] of Object.entries(RESOURCE_JOB_INDICES)) {
        if (jobIndex !== undefined) {
            result[Number(typeStr) as EMaterialType] = {
                file: GFX_FILE_NUMBERS.RESOURCES,
                index: jobIndex,
            };
        }
    }

    return result;
}

/**
 * Sprite information for a unit type.
 */
export interface UnitSpriteInfo {
    /** GFX file number (race-specific: 20-24) */
    file: number;
    /** JIL job index within the GFX file */
    index: number;
}

/**
 * Get the unit sprite map for a specific race.
 * Returns a map of UnitType -> { file, index } using the race's settler file number.
 */
export function getUnitSpriteMap(race: Race): Partial<Record<UnitType, UnitSpriteInfo>> {
    const fileNum = SETTLER_FILE_NUMBERS[race];
    const result: Partial<Record<UnitType, UnitSpriteInfo>> = {};

    for (const [typeStr, jobIndex] of Object.entries(UNIT_JOB_INDICES)) {
        // Skip undefined and negative indices (not yet identified)
        if (jobIndex !== undefined && jobIndex >= 0) {
            result[Number(typeStr) as UnitType] = {
                file: fileNum,
                index: jobIndex,
            };
        }
    }

    return result;
}

/**
 * Get the building sprite map for a specific race.
 * Returns a map of BuildingType -> { file, index } using the race's GFX file number.
 */
export function getBuildingSpriteMap(race: Race): Partial<Record<BuildingType, BuildingSpriteInfo>> {
    const fileNum = race as number;
    const result: Partial<Record<BuildingType, BuildingSpriteInfo>> = {};

    for (const [typeStr, jobIndex] of Object.entries(BUILDING_JOB_INDICES)) {
        if (jobIndex !== undefined) {
            result[Number(typeStr) as BuildingType] = {
                file: fileNum,
                index: jobIndex,
            };
        }
    }

    return result;
}

/** Default building sprite map using Roman race */
export const BUILDING_SPRITE_MAP = getBuildingSpriteMap(Race.Roman);

/**
 * Texture offsets for tree map objects.
 * Each tree type has blocks of textures for different states.
 * Structure:
 * 0-2: Zoom levels (Very Small, Small, Medium)
 * 3-19: Normal tree frames (swaying animation?) - 17 frames
 * 20-30: Falling/Cutting animation frames - 11 frames
 */
export const TREE_TEXTURE_OFFSET = {
    ZOOM_VERY_SMALL: 0,
    ZOOM_SMALL: 1,
    ZOOM_MEDIUM: 2,
    NORMAL_1: 3, // Default static
    NORMAL_START: 3,
    NORMAL_END: 19,
    CUT_START: 20,
    CUT_END: 30,
} as const;

/**
 * Number of tree variations to load and use.
 * Max available in GFX is 17 (NORMAL_END - NORMAL_START + 1).
 * Set to 1 to disable variations.
 */
export const TREE_VARIATION_COUNT = 17;

/** Stride between tree types in the GFX file (31 textures per tree) */
export const TREE_SPRITE_STRIDE = 31;

/**
 * Mapping from MapObjectType to GIL sprite index (direct index, not job-based).
 * Map objects use a stride-based layout in 5.gfx starting at index 1.
 */
export const MAP_OBJECT_SPRITE_INDICES: Partial<Record<MapObjectType, number>> = {
    [MapObjectType.TreeOak]: 1 + (0 * TREE_SPRITE_STRIDE),
    [MapObjectType.TreeBeech]: 1 + (1 * TREE_SPRITE_STRIDE),
    [MapObjectType.TreeAsh]: 1 + (2 * TREE_SPRITE_STRIDE),
    [MapObjectType.TreeLinden]: 1 + (3 * TREE_SPRITE_STRIDE),
    [MapObjectType.TreeBirch]: 1 + (4 * TREE_SPRITE_STRIDE),
    [MapObjectType.TreePoplar]: 1 + (5 * TREE_SPRITE_STRIDE),
    [MapObjectType.TreeChestnut]: 1 + (6 * TREE_SPRITE_STRIDE),
    [MapObjectType.TreeMaple]: 1 + (7 * TREE_SPRITE_STRIDE),
    [MapObjectType.TreeFir]: 1 + (8 * TREE_SPRITE_STRIDE),
    [MapObjectType.TreeSpruce]: 1 + (9 * TREE_SPRITE_STRIDE),
    [MapObjectType.TreeCoconut]: 1 + (10 * TREE_SPRITE_STRIDE),
    [MapObjectType.TreeDate]: 1 + (11 * TREE_SPRITE_STRIDE),
    [MapObjectType.TreeWalnut]: 1 + (12 * TREE_SPRITE_STRIDE),
    [MapObjectType.TreeCorkOak]: 1 + (13 * TREE_SPRITE_STRIDE),
    [MapObjectType.TreePine]: 1 + (14 * TREE_SPRITE_STRIDE),
    [MapObjectType.TreePine2]: 1 + (15 * TREE_SPRITE_STRIDE),
    [MapObjectType.TreeOliveLarge]: 1 + (16 * TREE_SPRITE_STRIDE),
    [MapObjectType.TreeOliveSmall]: 1 + (17 * TREE_SPRITE_STRIDE),
    [MapObjectType.TreeDead]: 1 + (18 * TREE_SPRITE_STRIDE),
};

/**
 * Sprite information for a map object type.
 */
export interface MapObjectSpriteInfo {
    /** GFX file number */
    file: number;
    /** Base GIL sprite index (start of the tree block) */
    index: number;
    /** Optional: palette index if different from sprite index */
    paletteIndex?: number;
}

/**
 * Mapping from MapObjectType (Resource) to EMaterialType for sprite lookup.
 * This allows using resource sprites (pile of ore) for map resources.
 */
const RESOURCE_MAP_OBJECTS: Partial<Record<MapObjectType, EMaterialType>> = {
    [MapObjectType.ResourceCoal]: EMaterialType.COAL,
    [MapObjectType.ResourceGold]: EMaterialType.GOLDORE,
    [MapObjectType.ResourceIron]: EMaterialType.IRONORE,
    [MapObjectType.ResourceStone]: EMaterialType.STONE,
    [MapObjectType.ResourceSulfur]: EMaterialType.SULFUR,
};

/**
 * Get the map object sprite map.
 * Includes both landscape objects (trees) and resource deposits.
 */
export function getMapObjectSpriteMap(): Partial<Record<MapObjectType, MapObjectSpriteInfo>> {
    const result: Partial<Record<MapObjectType, MapObjectSpriteInfo>> = {};

    // Standard map objects (Trees, etc.) from file 5
    for (const [typeStr, spriteIndex] of Object.entries(MAP_OBJECT_SPRITE_INDICES)) {
        if (spriteIndex !== undefined) {
            result[Number(typeStr) as MapObjectType] = {
                file: GFX_FILE_NUMBERS.MAP_OBJECTS,
                index: spriteIndex,
            };
        }
    }

    // Resource deposits using resource sprites from file 3
    for (const [moTypeStr, matType] of Object.entries(RESOURCE_MAP_OBJECTS)) {
        const jobIndex = RESOURCE_JOB_INDICES[matType];
        if (jobIndex !== undefined) {
            result[Number(moTypeStr) as MapObjectType] = {
                file: GFX_FILE_NUMBERS.RESOURCES,
                index: jobIndex,
            };
        }
    }

    return result;
}

/**
 * Building sprite entries with both construction and completed states.
 */
export interface BuildingSpriteEntries {
    /** Construction state sprite (D0) */
    construction: SpriteEntry | null;
    /** Completed state sprite (D1) */
    completed: SpriteEntry | null;
}

/**
 * Animation entry containing sequence data for animated sprites.
 */
export interface AnimatedSpriteEntry {
    /** Static sprite (first frame) for non-animated rendering */
    staticSprite: SpriteEntry;
    /** Full animation data with all frames */
    animationData: AnimationData;
    /** Whether this sprite has multiple frames */
    isAnimated: boolean;
}

/**
 * Registry that maps game entity types to their sprite atlas entries.
 * Built during initialization after sprites are loaded and packed into the atlas.
 */
export class SpriteMetadataRegistry {
    private buildings: Map<BuildingType, BuildingSpriteEntries> = new Map();
    private mapObjects: Map<MapObjectType, SpriteEntry[]> = new Map();
    private resources: Map<EMaterialType, Map<number, SpriteEntry>> = new Map();
    /** Unit sprites indexed by type and direction (static, first frame only for fallback) */
    private units: Map<UnitType, Map<number, SpriteEntry>> = new Map();

    /**
     * Unified animated entities storage.
     * Maps EntityType -> subType -> AnimatedSpriteEntry
     * Replaces separate animatedBuildings, animatedMapObjects, animatedUnits maps.
     */
    private animatedEntities: Map<EntityType, Map<number, AnimatedSpriteEntry>> = new Map();

    /**
     * Register sprite entries for a building type (both construction and completed).
     */
    public registerBuilding(type: BuildingType, construction: SpriteEntry | null, completed: SpriteEntry | null): void {
        this.buildings.set(type, { construction, completed });
    }

    /**
     * Look up the completed sprite entry for a building type (legacy/default).
     * Returns null if no sprite is registered for this type.
     */
    public getBuilding(type: BuildingType): SpriteEntry | null {
        return this.buildings.get(type)?.completed ?? null;
    }

    /**
     * Look up the construction sprite entry for a building type.
     * Returns null if no sprite is registered for this type.
     */
    public getBuildingConstruction(type: BuildingType): SpriteEntry | null {
        return this.buildings.get(type)?.construction ?? null;
    }

    /**
     * Get both construction and completed sprites for a building type.
     */
    public getBuildingSprites(type: BuildingType): BuildingSpriteEntries | null {
        return this.buildings.get(type) ?? null;
    }

    /**
     * Register a sprite entry for a map object type.
     */
    /**
     * Register a sprite entry for a map object type (with optional variation index).
     */
    public registerMapObject(type: MapObjectType, entry: SpriteEntry, variation: number = 0): void {
        const entries = this.mapObjects.get(type) ?? [];
        if (entries.length <= variation) {
            entries.length = variation + 1;
        }
        entries[variation] = entry;
        this.mapObjects.set(type, entries);
    }

    /**
     * Look up the sprite entry for a map object type (and optional variation).
     * Returns null if no sprite is registered for this type.
     */
    public getMapObject(type: MapObjectType, variation: number = 0): SpriteEntry | null {
        const entries = this.mapObjects.get(type);
        if (!entries || entries.length === 0) return null;

        // Filter out any potential holes in the array to get only valid loaded sprites
        const available = entries.filter(e => e !== undefined && e !== null);

        if (available.length === 0) return null;

        // Use modulo to cycle through available variations safely
        // This handles cases where we request var 15 but only have 1 or 2 variations loaded
        return available[variation % available.length];
    }

    /**
     * Get the number of variations available for a map object type.
     */
    public getMapObjectVariationCount(type: MapObjectType): number {
        return this.mapObjects.get(type)?.length ?? 0;
    }

    /**
     * Register a sprite entry for a resource/material type.
     */
    public registerResource(type: EMaterialType, direction: number, entry: SpriteEntry): void {
        let dirMap = this.resources.get(type);
        if (!dirMap) {
            dirMap = new Map();
            this.resources.set(type, dirMap);
        }
        dirMap.set(direction, entry);
    }

    /**
     * Look up the sprite entry for a resource/material type.
     * Returns null if no sprite is registered for this type.
     */
    public getResource(type: EMaterialType, direction: number = 0): SpriteEntry | null {
        const dirMap = this.resources.get(type);
        if (!dirMap) return null;
        // Try requested direction, fall back to direction 0 if not found
        return dirMap.get(direction) ?? dirMap.get(0) ?? null;
    }

    /**
     * Register a sprite entry for a unit type and direction.
     * @param direction 0=RIGHT, 1=RIGHT_BOTTOM, 2=LEFT_BOTTOM, 3=LEFT
     */
    public registerUnit(type: UnitType, direction: number, entry: SpriteEntry): void {
        let dirMap = this.units.get(type);
        if (!dirMap) {
            dirMap = new Map();
            this.units.set(type, dirMap);
        }
        dirMap.set(direction, entry);
    }

    /**
     * Look up the sprite entry for a unit type and direction.
     * @param direction 0=RIGHT, 1=RIGHT_BOTTOM, 2=LEFT_BOTTOM, 3=LEFT (defaults to 0)
     * Returns null if no sprite is registered for this type/direction.
     */
    public getUnit(type: UnitType, direction: number = 0): SpriteEntry | null {
        const dirMap = this.units.get(type);
        if (!dirMap) return null;
        // Try requested direction, fall back to direction 0 if not found
        return dirMap.get(direction) ?? dirMap.get(0) ?? null;
    }

    // ========== Unified Animation API ==========

    /**
     * Register an animated entity with multiple directions and frames.
     * This is the unified method that replaces registerAnimatedBuilding,
     * registerAnimatedMapObject, and registerAnimatedUnit.
     *
     * @param entityType The entity type (Building, Unit, MapObject, etc.)
     * @param subType The specific type (BuildingType, UnitType, etc.)
     * @param directionFrames Map of direction index -> array of frames
     * @param frameDurationMs Duration per frame in milliseconds
     * @param loop Whether the animation loops
     */
    public registerAnimatedEntity(
        entityType: EntityType,
        subType: number,
        directionFrames: Map<number, SpriteEntry[]>,
        frameDurationMs: number = ANIMATION_DEFAULTS.FRAME_DURATION_MS,
        loop: boolean = true
    ): void {
        if (directionFrames.size === 0) return;

        // Build direction map for all directions
        const directionMap = new Map<number, AnimationSequence>();
        let firstFrame: SpriteEntry | null = null;

        for (const [direction, frames] of directionFrames) {
            if (frames.length === 0) continue;

            if (!firstFrame) {
                firstFrame = frames[0];
            }

            directionMap.set(direction, {
                frames,
                frameDurationMs,
                loop,
            });
        }

        if (!firstFrame) return;

        const sequences = new Map<string, Map<number, AnimationSequence>>();

        // For units, create separate idle and walk sequences:
        // - Idle (DEFAULT): only frame 0 (standing pose)
        // - Walk: frames 1+ (walk cycle, excluding standing frame)
        if (entityType === EntityType.Unit) {
            // Idle sequence: just frame 0 for each direction
            const idleDirectionMap = new Map<number, AnimationSequence>();
            for (const [direction, frames] of directionFrames) {
                if (frames.length > 0) {
                    idleDirectionMap.set(direction, {
                        frames: [frames[0]],
                        frameDurationMs,
                        loop: false, // Single frame, no loop needed
                    });
                }
            }
            sequences.set(ANIMATION_SEQUENCES.DEFAULT, idleDirectionMap);

            // Walk sequence: frames 1+ (skip standing frame)
            const walkDirectionMap = new Map<number, AnimationSequence>();
            for (const [direction, frames] of directionFrames) {
                if (frames.length > 1) {
                    walkDirectionMap.set(direction, {
                        frames: frames.slice(1), // Skip frame 0
                        frameDurationMs,
                        loop,
                    });
                } else if (frames.length === 1) {
                    // Fallback: if only 1 frame, use it for walk too
                    walkDirectionMap.set(direction, {
                        frames,
                        frameDurationMs,
                        loop,
                    });
                }
            }
            sequences.set(ANIMATION_SEQUENCES.WALK, walkDirectionMap);
        } else {
            // Non-units: use all frames for default sequence
            sequences.set(ANIMATION_SEQUENCES.DEFAULT, directionMap);
        }

        const animationData: AnimationData = {
            sequences,
            defaultSequence: ANIMATION_SEQUENCES.DEFAULT,
        };

        // Get or create the subType map for this entity type
        let subTypeMap = this.animatedEntities.get(entityType);
        if (!subTypeMap) {
            subTypeMap = new Map();
            this.animatedEntities.set(entityType, subTypeMap);
        }

        subTypeMap.set(subType, {
            staticSprite: firstFrame,
            animationData,
            isAnimated: directionFrames.size > 0,
        });
    }

    /**
     * Register an additional animation sequence on an already-registered animated entity.
     * Used to add carry-walk variants for carriers: each material type gets its own
     * sequence key (e.g. 'carry_0' for trunk) with its own set of direction frames.
     *
     * The entity must already be registered via registerAnimatedEntity.
     */
    public registerAnimationSequence(
        entityType: EntityType,
        subType: number,
        sequenceKey: string,
        directionFrames: Map<number, SpriteEntry[]>,
        frameDurationMs: number = ANIMATION_DEFAULTS.FRAME_DURATION_MS,
        loop: boolean = true
    ): void {
        const entry = this.animatedEntities.get(entityType)?.get(subType);
        if (!entry) return;

        const directionMap = new Map<number, AnimationSequence>();
        for (const [direction, frames] of directionFrames) {
            if (frames.length === 0) continue;
            directionMap.set(direction, { frames, frameDurationMs, loop });
        }

        if (directionMap.size > 0) {
            entry.animationData.sequences.set(sequenceKey, directionMap);
        }
    }

    /**
     * Get animated entity data. Unified method for all entity types.
     * O(1) lookup using nested Maps.
     */
    public getAnimatedEntity(entityType: EntityType, subType: number): AnimatedSpriteEntry | null {
        return this.animatedEntities.get(entityType)?.get(subType) ?? null;
    }

    /**
     * Check if an entity type/subtype has animation data.
     * O(1) lookup.
     */
    public hasAnimation(entityType: EntityType, subType: number): boolean {
        const entry = this.animatedEntities.get(entityType)?.get(subType);
        return entry?.isAnimated ?? false;
    }

    // ========== Legacy Wrappers (for backwards compatibility) ==========

    /** @deprecated Use registerAnimatedEntity instead */
    public registerAnimatedUnit(
        type: UnitType,
        directionFrames: Map<number, SpriteEntry[]>,
        frameDurationMs: number = ANIMATION_DEFAULTS.FRAME_DURATION_MS,
        loop: boolean = true
    ): void {
        this.registerAnimatedEntity(EntityType.Unit, type, directionFrames, frameDurationMs, loop);
    }

    /** @deprecated Use getAnimatedEntity instead */
    public getAnimatedUnit(type: UnitType): AnimatedSpriteEntry | null {
        return this.getAnimatedEntity(EntityType.Unit, type);
    }

    /** @deprecated Use hasAnimation instead */
    public hasUnitAnimation(type: UnitType): boolean {
        return this.hasAnimation(EntityType.Unit, type);
    }

    /**
     * Check if any building sprites have been registered.
     */
    public hasBuildingSprites(): boolean {
        return this.buildings.size > 0;
    }

    /**
     * Check if any map object sprites have been registered.
     */
    public hasMapObjectSprites(): boolean {
        return this.mapObjects.size > 0;
    }

    /**
     * Check if any resource sprites have been registered.
     */
    public hasResourceSprites(): boolean {
        return this.resources.size > 0;
    }

    /**
     * Check if any unit sprites have been registered.
     */
    public hasUnitSprites(): boolean {
        return this.units.size > 0;
    }

    /**
     * Get the number of registered building sprites.
     */
    public getBuildingCount(): number {
        return this.buildings.size;
    }

    /**
     * Get the number of registered map object sprites.
     */
    public getMapObjectCount(): number {
        return this.mapObjects.size;
    }

    /**
     * Get the number of registered unit sprites.
     */
    public getUnitCount(): number {
        return this.units.size;
    }

    /** @deprecated Use registerAnimatedEntity instead */
    public registerAnimatedBuilding(
        type: BuildingType,
        frames: SpriteEntry[],
        direction: number = 1,
        frameDurationMs: number = ANIMATION_DEFAULTS.FRAME_DURATION_MS,
        loop: boolean = true
    ): void {
        if (frames.length === 0) return;
        const directionFrames = new Map<number, SpriteEntry[]>();
        directionFrames.set(direction, frames);
        this.registerAnimatedEntity(EntityType.Building, type, directionFrames, frameDurationMs, loop);
    }

    /** @deprecated Use getAnimatedEntity instead */
    public getAnimatedBuilding(type: BuildingType): AnimatedSpriteEntry | null {
        return this.getAnimatedEntity(EntityType.Building, type);
    }

    /** @deprecated Use hasAnimation instead */
    public hasBuildingAnimation(type: BuildingType): boolean {
        return this.hasAnimation(EntityType.Building, type);
    }

    /** @deprecated Use registerAnimatedEntity instead */
    public registerAnimatedMapObject(
        type: MapObjectType,
        frames: SpriteEntry[],
        frameDurationMs: number = ANIMATION_DEFAULTS.SLOW_FRAME_DURATION_MS,
        loop: boolean = true
    ): void {
        if (frames.length === 0) return;
        const directionFrames = new Map<number, SpriteEntry[]>();
        directionFrames.set(0, frames);
        this.registerAnimatedEntity(EntityType.MapObject, type, directionFrames, frameDurationMs, loop);
    }

    /** @deprecated Use getAnimatedEntity instead */
    public getAnimatedMapObject(type: MapObjectType): AnimatedSpriteEntry | null {
        return this.getAnimatedEntity(EntityType.MapObject, type);
    }

    /** @deprecated Use hasAnimation instead */
    public hasMapObjectAnimation(type: MapObjectType): boolean {
        return this.hasAnimation(EntityType.MapObject, type);
    }

    /**
     * Get the number of registered resource sprites.
     */
    public getResourceCount(): number {
        return this.resources.size;
    }

    /**
     * Clear all registered sprites.
     */
    public clear(): void {
        this.buildings.clear();
        this.mapObjects.clear();
        this.animatedEntities.clear();
        this.resources.clear();
        this.units.clear();
    }

    /**
     * Serialize registry data for caching.
     * Converts Maps to arrays for JSON compatibility.
     */
    public serialize(): any {
        // Helper to serialize AnimatedSpriteEntry (nested AnimationData maps)
        const serializeAnimEntry = (entry: AnimatedSpriteEntry) => {
            const sequences = mapToArray(entry.animationData.sequences).map(([seqKey, dirMap]) => {
                return [seqKey, mapToArray(dirMap)] as [string, Array<[number, AnimationSequence]>];
            });
            return {
                ...entry,
                animationData: {
                    ...entry.animationData,
                    sequences
                }
            };
        };

        // Serialize unified animated entities map
        const serializedAnimatedEntities = mapToArray(this.animatedEntities).map(([entityType, subTypeMap]) => {
            return [entityType, mapToArray(subTypeMap).map(([subType, entry]) => [subType, serializeAnimEntry(entry)])];
        });

        return {
            buildings: mapToArray(this.buildings),
            mapObjects: mapToArray(this.mapObjects),
            resources: mapToArray(this.resources).map(([k, v]) => [k, mapToArray(v)]),
            units: mapToArray(this.units).map(([k, v]) => [k, mapToArray(v)]),
            animatedEntities: serializedAnimatedEntities,
        };
    }

    /** Helper to deserialize an AnimatedSpriteEntry from cached data */
    private static deserializeAnimEntry(entryData: any): AnimatedSpriteEntry {
        const sequences = new Map<string, Map<number, AnimationSequence>>();
        if (entryData.animationData?.sequences) {
            for (const [seqKey, dirArr] of entryData.animationData.sequences) {
                sequences.set(seqKey, arrayToMap(dirArr));
            }
        }
        return {
            ...entryData,
            animationData: { ...entryData.animationData, sequences }
        };
    }

    /** Helper to deserialize legacy animated entity format into unified map */
    private static deserializeLegacyAnimated(
        legacyData: Array<[number, any]> | undefined,
        entityType: EntityType,
        targetMap: Map<EntityType, Map<number, AnimatedSpriteEntry>>
    ): void {
        if (!legacyData) return;
        let subTypeMap = targetMap.get(entityType);
        if (!subTypeMap) {
            subTypeMap = new Map();
            targetMap.set(entityType, subTypeMap);
        }
        for (const [type, entryData] of legacyData) {
            subTypeMap.set(type, SpriteMetadataRegistry.deserializeAnimEntry(entryData));
        }
    }

    /**
     * Deserialize registry data from cache.
     */
    public static deserialize(data: any): SpriteMetadataRegistry {
        const registry = new SpriteMetadataRegistry();

        if (data.buildings) registry.buildings = arrayToMap(data.buildings);
        if (data.mapObjects) registry.mapObjects = arrayToMap(data.mapObjects);

        if (data.resources) {
            registry.resources = new Map(
                (data.resources as Array<[EMaterialType, Array<[number, SpriteEntry]>]>)
                    .map(([k, v]) => [k, arrayToMap(v)])
            );
        }

        if (data.units) {
            registry.units = new Map(
                (data.units as Array<[UnitType, Array<[number, SpriteEntry]>]>)
                    .map(([k, v]) => [k, arrayToMap(v)])
            );
        }

        // Deserialize unified animated entities
        if (data.animatedEntities) {
            for (const [entityType, subTypeArr] of data.animatedEntities) {
                const subTypeMap = new Map<number, AnimatedSpriteEntry>();
                for (const [subType, entryData] of subTypeArr) {
                    subTypeMap.set(subType, SpriteMetadataRegistry.deserializeAnimEntry(entryData));
                }
                registry.animatedEntities.set(entityType, subTypeMap);
            }
        }

        // Legacy support: deserialize old format if present
        SpriteMetadataRegistry.deserializeLegacyAnimated(data.animatedBuildings, EntityType.Building, registry.animatedEntities);
        SpriteMetadataRegistry.deserializeLegacyAnimated(data.animatedMapObjects, EntityType.MapObject, registry.animatedEntities);
        SpriteMetadataRegistry.deserializeLegacyAnimated(data.animatedUnits, EntityType.Unit, registry.animatedEntities);

        return registry;
    }
}
