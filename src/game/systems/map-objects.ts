/* eslint-disable max-lines -- data-heavy file: decoration type catalogue + sprite pools */
import { EntityType, MapObjectType } from '../entity';
import { GameState } from '../game-state';
import { MapSize } from '@/utilities/map-size';
import { isBuildable } from '../terrain';
import type { TerrainData } from '../terrain';
import { LogHandler } from '@/utilities/log-handler';
import type { MapObjectData } from '@/resources/map/map-entity-data';
import { S4TreeType, S4GroundType } from '@/resources/map/s4-types';
import { MAP_OBJECT_SPRITES } from '@/game/renderer/sprite-metadata/gil-indices';

const log = new LogHandler('MapObjects');

/** Categories of map objects */
export type ObjectCategory = 'trees' | 'stones' | 'resources' | 'plants' | 'other';

/** All available categories */
export const OBJECT_CATEGORIES: readonly ObjectCategory[] = ['trees', 'stones', 'resources', 'plants', 'other'];

/** Mapping from MapObjectType to its category */
export const OBJECT_TYPE_CATEGORY: Record<MapObjectType, ObjectCategory> = {
    // Trees
    [MapObjectType.TreeOak]: 'trees',
    [MapObjectType.TreeBeech]: 'trees',
    [MapObjectType.TreeAsh]: 'trees',
    [MapObjectType.TreeLinden]: 'trees',
    [MapObjectType.TreeBirch]: 'trees',
    [MapObjectType.TreePoplar]: 'trees',
    [MapObjectType.TreeChestnut]: 'trees',
    [MapObjectType.TreeMaple]: 'trees',
    [MapObjectType.TreeFir]: 'trees',
    [MapObjectType.TreeSpruce]: 'trees',
    [MapObjectType.TreeCoconut]: 'trees',
    [MapObjectType.TreeDate]: 'trees',
    [MapObjectType.TreeWalnut]: 'trees',
    [MapObjectType.TreeCorkOak]: 'trees',
    [MapObjectType.TreePine]: 'trees',
    [MapObjectType.TreePine2]: 'trees',
    [MapObjectType.TreeOliveLarge]: 'trees',
    [MapObjectType.TreeOliveSmall]: 'trees',
    [MapObjectType.TreeDead]: 'trees',
    // Resources
    [MapObjectType.ResourceCoal]: 'resources',
    [MapObjectType.ResourceGold]: 'resources',
    [MapObjectType.ResourceIron]: 'resources',
    [MapObjectType.ResourceStone]: 'resources',
    [MapObjectType.ResourceSulfur]: 'resources',
};

/**
 * Registry mapping raw landscape byte values to MapObjectType.
 * Verified against S4ModApi S4_TREE_ENUM
 */
export const RAW_TO_OBJECT_TYPE: Map<number, MapObjectType> = new Map([
    // Trees (S4ModApi S4_TREE_ENUM)
    [1, MapObjectType.TreeOak],
    [2, MapObjectType.TreeBeech],
    [3, MapObjectType.TreeAsh],
    [4, MapObjectType.TreeLinden],
    [5, MapObjectType.TreeBirch],
    [6, MapObjectType.TreePoplar],
    [7, MapObjectType.TreeChestnut],
    [8, MapObjectType.TreeMaple],
    [9, MapObjectType.TreeFir],
    [10, MapObjectType.TreeSpruce],
    [11, MapObjectType.TreeCoconut],
    [12, MapObjectType.TreeDate],
    [13, MapObjectType.TreeWalnut],
    [14, MapObjectType.TreeCorkOak],
    [15, MapObjectType.TreePine],
    [16, MapObjectType.TreePine2],
    [17, MapObjectType.TreeOliveLarge],
    [18, MapObjectType.TreeOliveSmall],

    // Community / Siedler-Portal known values (Secondary / Magic Bytes)
    // Keeping these for now as requested user inputs, but S4ModApi suggests 1-18 is the primary range
    [0xc4, MapObjectType.TreeOak],
    [0xc5, MapObjectType.TreePine],
    [0xc6, MapObjectType.TreeCoconut], // Palm -> Coconut/Date
]);

/**
 * Convert S4TreeType (from map file) to MapObjectType (internal game type).
 * S4TreeType values 1-18 map directly to MapObjectType tree values 0-17.
 */
export function s4TreeTypeToMapObjectType(s4Type: S4TreeType): MapObjectType | null {
    // S4TreeType uses 1-18, MapObjectType uses 0-17 for trees
    if (s4Type >= S4TreeType.OAK && s4Type <= S4TreeType.OLIVE_SMALL) {
        return (s4Type - 1) as MapObjectType;
    }
    return null;
}

// ============================================================
// Decoration types (raw byte values > 18)
// ============================================================

/** Description of a decoration object type observed on the map */
export interface DecorationTypeInfo {
    /** Raw byte value from map file */
    raw: number;
    /** Best guess at what this is */
    label: string;
    /** Category: 'stone', 'plants', 'river', 'desert', 'sea', etc. */
    category: string;
    /** Where it was observed on the map */
    notes: string;
}

/**
 * Observed decoration types — raw byte values > 18 from the map objects chunk.
 * Values 1-18 are trees (mapped above in RAW_TO_OBJECT_TYPE / s4TreeTypeToMapObjectType).
 */
export const DECORATION_TYPES: DecorationTypeInfo[] = [
    // 56-58: Mountain core decorations
    { raw: 56, label: 'MountainEdge56', category: 'stone', notes: 'Near mountain edge' },
    { raw: 57, label: 'Mountain57', category: 'stone', notes: 'On mountain' },
    { raw: 58, label: 'Mountain58', category: 'stone', notes: 'On mountain (inferred from 57)' },

    // 59-75: Mountain edge decorations — rocks/rubble near mountain-grass transitions
    {
        raw: 59,
        label: 'MountainEdge59',
        category: 'stone',
        notes: 'Near mountain edges, mostly on mountain but some on grass',
    },
    { raw: 60, label: 'MountainEdge60', category: 'stone', notes: 'Near mountain edges' },
    { raw: 61, label: 'MountainEdge61', category: 'stone', notes: 'Near mountain edges' },
    { raw: 62, label: 'MountainEdge62', category: 'stone', notes: 'Near mountain edges' },
    { raw: 63, label: 'MountainEdge63', category: 'stone', notes: 'Near mountain edges' },
    { raw: 64, label: 'MountainEdge64', category: 'stone', notes: 'Near mountain edges' },
    { raw: 65, label: 'MountainEdge65', category: 'stone', notes: 'Near mountain edges' },
    { raw: 66, label: 'MountainEdge66', category: 'stone', notes: 'Near mountain edges' },
    { raw: 67, label: 'MountainEdge67', category: 'stone', notes: 'Near mountain edges' },
    { raw: 68, label: 'MountainEdge68', category: 'stone', notes: 'Near mountain edges' },
    { raw: 69, label: 'MountainEdge69', category: 'stone', notes: 'Near mountain edges' },
    { raw: 70, label: 'MountainEdge70', category: 'stone', notes: 'Near mountain edges' },
    { raw: 71, label: 'MountainEdge71', category: 'stone', notes: 'Near mountain edges' },
    { raw: 72, label: 'MountainEdge72', category: 'stone', notes: 'Near mountain edges' },
    { raw: 73, label: 'MountainEdge73', category: 'stone', notes: 'Near mountain edges' },
    { raw: 74, label: 'MountainEdge74', category: 'stone', notes: 'Near mountain edges' },
    { raw: 75, label: 'MountainEdge75', category: 'stone', notes: 'Near mountain edges' },

    // 19-29, 31: Landscape decorations just above tree range (common/uncommon)
    { raw: 19, label: 'Landscape19', category: 'plants', notes: 'Common landscape feature (15k)' },
    { raw: 20, label: 'Landscape20', category: 'plants', notes: 'Common landscape feature (14k)' },
    { raw: 21, label: 'Landscape21', category: 'plants', notes: 'Common landscape feature (12k)' },
    { raw: 22, label: 'Landscape22', category: 'plants', notes: 'Common landscape feature (12k)' },
    { raw: 23, label: 'Landscape23', category: 'plants', notes: 'Uncommon landscape feature (2.6k)' },
    { raw: 24, label: 'Landscape24', category: 'plants', notes: 'Uncommon landscape feature (2k)' },
    { raw: 25, label: 'Landscape25', category: 'plants', notes: 'Uncommon landscape feature (1.8k)' },
    { raw: 26, label: 'Landscape26', category: 'plants', notes: 'Uncommon landscape feature (1.6k)' },
    { raw: 27, label: 'Landscape27', category: 'plants', notes: 'Uncommon landscape feature (1.8k)' },
    { raw: 28, label: 'Landscape28', category: 'plants', notes: 'Uncommon landscape feature (1.8k)' },
    { raw: 29, label: 'Landscape29', category: 'plants', notes: 'Uncommon landscape feature (3k)' },
    { raw: 31, label: 'Landscape31', category: 'plants', notes: 'Uncommon landscape feature (857)' },

    // 43: River decoration
    { raw: 43, label: 'River43', category: 'river', notes: 'Near rivers' },

    // 44-49: Common grass decorations (~35k each across maps)
    { raw: 44, label: 'Grass44', category: 'plants', notes: 'On grass' },
    { raw: 45, label: 'Grass45', category: 'plants', notes: 'On grass' },
    { raw: 46, label: 'Grass46', category: 'plants', notes: 'On grass' },
    { raw: 47, label: 'Grass47', category: 'plants', notes: 'On grass' },
    { raw: 48, label: 'Grass48', category: 'plants', notes: 'On grass' },
    { raw: 49, label: 'Grass49', category: 'plants', notes: 'On grass' },

    // 50-55: Desert / shore decorations
    { raw: 50, label: 'Desert50', category: 'desert', notes: 'On desert terrain' },
    { raw: 51, label: 'Desert51', category: 'desert', notes: 'On desert terrain (possibly)' },
    { raw: 52, label: 'Desert52', category: 'desert', notes: 'On desert terrain' },
    { raw: 53, label: 'Desert53', category: 'desert', notes: 'On desert terrain' },
    { raw: 54, label: 'Desert54', category: 'desert_rare', notes: 'Near desert, very rare' },
    { raw: 55, label: 'Shore55', category: 'sea', notes: 'Near sea / on sea near shore, rare — possibly map data bug' },

    // 76: Common grass decoration (201k across maps)
    { raw: 76, label: 'Grass76', category: 'plants', notes: 'On grass' },

    // 77-84: River decorations — reeds, river stones, etc.
    { raw: 77, label: 'River77', category: 'river', notes: 'Mostly near rivers' },
    { raw: 78, label: 'River78', category: 'river', notes: 'Mostly near rivers' },
    { raw: 79, label: 'Grass79', category: 'plants', notes: 'On grass near rivers' },
    { raw: 80, label: 'Grass80', category: 'plants', notes: 'On grass near rivers' },
    { raw: 81, label: 'Grass81', category: 'plants', notes: 'On grass' },
    { raw: 82, label: 'Grass82', category: 'plants', notes: 'On grass' },
    { raw: 83, label: 'River83', category: 'river', notes: 'Mostly near rivers' },
    { raw: 84, label: 'River84', category: 'river', notes: 'Mostly near rivers' },

    // 85: Common grass decoration (124k), 87: uncommon (672), 86: absent from all maps
    { raw: 85, label: 'Grass85', category: 'plants', notes: 'On grass' },
    { raw: 87, label: 'GrassRare87', category: 'plants_rare', notes: 'On grass, uncommon (672)' },

    // 90-92: Rare grass decorations
    { raw: 90, label: 'GrassRare90', category: 'plants_rare', notes: 'On grass, rare' },
    { raw: 91, label: 'GrassRare91', category: 'plants_rare', notes: 'On grass, rare' },
    { raw: 92, label: 'GrassRare92', category: 'plants_rare', notes: 'On grass, rare' },

    // 107-110, 119: Sea decorations — on water tiles
    { raw: 107, label: 'Sea107', category: 'sea', notes: 'On sea' },
    { raw: 108, label: 'Sea108', category: 'sea', notes: 'On sea' },
    { raw: 109, label: 'Sea109', category: 'sea', notes: 'On sea' },
    { raw: 110, label: 'Sea110', category: 'sea', notes: 'On sea' },

    // 116: Rare grass decoration
    { raw: 116, label: 'GrassRare116', category: 'plants_rare', notes: 'On grass, rare' },

    // 119: Sea
    { raw: 119, label: 'Sea119', category: 'sea', notes: 'On sea' },

    // 120-122: Desert edge decorations
    { raw: 120, label: 'Desert120', category: 'desert', notes: 'On desert or desert edge' },
    { raw: 121, label: 'Desert121', category: 'desert', notes: 'On desert or desert edge' },
    { raw: 122, label: 'Desert122', category: 'desert', notes: 'On desert' },

    // 123: Not seen on test map, may exist on other maps
    // { raw: 123, label: 'Unknown123', category: 'unknown', notes: 'Not present on test map' },

    // 124-135: Harvestable stone — 12 depletion stages (124=lv1 nearly gone, 135=lv12 full).
    // NOT decorations; mapped to ResourceStone in populateMapObjectsFromEntityData.

    // 136, 152, 155-159: Grass decorations
    { raw: 136, label: 'StoneEdge136', category: 'stone', notes: 'Near harvestable stones (22k)' },
    { raw: 152, label: 'GrassRare152', category: 'plants_rare', notes: 'On grass, uncommon (2k)' },
    { raw: 154, label: 'GrassRare154', category: 'plants_rare', notes: 'On grass, rare (210)' },
    { raw: 155, label: 'GrassRare155', category: 'plants_rare', notes: 'On grass, rare (187)' },
    { raw: 156, label: 'GrassRare156', category: 'plants_rare', notes: 'On grass, rare (180)' },
    { raw: 157, label: 'GrassRare157', category: 'plants_rare', notes: 'On grass, rare (185)' },
    { raw: 158, label: 'GrassRare158', category: 'plants_rare', notes: 'On grass, uncommon (1149)' },
    { raw: 159, label: 'GrassRare159', category: 'plants_rare', notes: 'On grass, rare (336)' },

    // 163-164: Sea (shallow)
    { raw: 163, label: 'River163', category: 'river', notes: 'Near rivers' },
    { raw: 164, label: 'Lake164', category: 'lake', notes: 'On lakes (242k)' },

    // 165-168: River decorations
    { raw: 165, label: 'River165', category: 'river', notes: 'Near rivers' },
    { raw: 166, label: 'River166', category: 'river', notes: 'Near rivers' },
    { raw: 167, label: 'Lake167', category: 'lake', notes: 'On lakes (85k)' },
    { raw: 168, label: 'Lake168', category: 'lake', notes: 'On lakes (85k)' },

    // 169-172: Beach decorations
    { raw: 169, label: 'Beach169', category: 'beach', notes: 'On beach' },
    { raw: 170, label: 'Beach170', category: 'beach', notes: 'On beach' },
    { raw: 171, label: 'Beach171', category: 'beach', notes: 'On beach' },
    { raw: 172, label: 'Beach172', category: 'beach', notes: 'On beach' },

    // 173-177: Common beach/shore decorations (27k-37k each)
    { raw: 173, label: 'Beach173', category: 'beach', notes: 'On beach/shore (27k)' },
    { raw: 174, label: 'Beach174', category: 'beach', notes: 'On beach/shore (34k)' },
    { raw: 175, label: 'Beach175', category: 'beach', notes: 'On beach/shore (29k)' },
    { raw: 176, label: 'Beach176', category: 'beach', notes: 'On beach/shore (26k)' },
    { raw: 177, label: 'Beach177', category: 'beach', notes: 'On beach/shore (37k)' },

    // 178: Mountain edge rock (common, 14k across maps)
    { raw: 178, label: 'MountainEdge178', category: 'stone', notes: 'Near mountain edge' },

    // 179-180: Desert
    { raw: 179, label: 'Desert179', category: 'desert', notes: 'On desert' },
    { raw: 180, label: 'Desert180', category: 'desert', notes: 'On desert' },

    // 181: Grass
    { raw: 181, label: 'Grass181', category: 'plants', notes: 'On grass' },

    // 182-183: Mountain edge
    { raw: 182, label: 'MountainEdge182', category: 'stone', notes: 'On some mountain edges' },
    { raw: 183, label: 'MountainEdge183', category: 'stone', notes: 'On mountain edges, similar to 182' },

    // 184-188: River decorations
    { raw: 184, label: 'River184', category: 'river', notes: 'Mostly near rivers' },
    { raw: 185, label: 'River185', category: 'river', notes: 'Mostly near rivers' },
    { raw: 186, label: 'Grass186', category: 'plants', notes: 'On grass' },
    { raw: 187, label: 'Grass187', category: 'plants', notes: 'On grass near rivers' },
    { raw: 188, label: 'River188', category: 'river', notes: 'Mostly near rivers' },

    // 215: Snow terrain decoration
    { raw: 215, label: 'Snow215', category: 'snow', notes: 'On snow terrain (718)' },

    // 218-219: Rare desert decorations
    { raw: 218, label: 'Desert218', category: 'desert_rare', notes: 'On desert, rare' },
    { raw: 219, label: 'Desert219', category: 'desert_rare', notes: 'On desert, rare' },

    // 221-222: Common desert decorations (7.6k-13k)
    { raw: 221, label: 'Desert221', category: 'desert', notes: 'On desert (13k)' },
    { raw: 222, label: 'Desert222', category: 'desert', notes: 'On desert (7.6k)' },

    // 245, 254: Common dark ground decorations
    { raw: 245, label: 'DarkGround245', category: 'dark_ground', notes: 'On dark/swamp terrain' },
    { raw: 254, label: 'DarkGround254', category: 'dark_ground', notes: 'On dark/swamp terrain' },
];

// ============================================================
// Decoration raw value → sprite assignment
// ============================================================

/** Sprite reference for a decoration — either static or animated */
export interface DecorationSpriteRef {
    /** GIL index in file 5 (first frame for animated) */
    gilIndex: number;
    /** Number of animation frames (1 = static) */
    frames: number;
}

function staticRef(gilIndex: number): DecorationSpriteRef {
    return { gilIndex, frames: 1 };
}

function animRef(range: { start: number; count: number }): DecorationSpriteRef {
    return { gilIndex: range.start, frames: range.count };
}

const S = MAP_OBJECT_SPRITES;

/** Sprite pools per decoration category — cycled across raw values within that category */
const CATEGORY_SPRITE_POOLS: Record<string, DecorationSpriteRef[]> = {
    stone: [
        staticRef(S.ROCK_TALL_A),
        staticRef(S.ROCK_DEBRIS),
        staticRef(S.ROCK_PILE_SMALL),
        staticRef(S.BOULDER_MEDIUM),
        staticRef(S.ROCK_MOSSY_A),
        staticRef(S.ROCK_OUTCROP),
        staticRef(S.BOULDER_ROUND),
        staticRef(S.BOULDER_FLAT_A),
        staticRef(S.BOULDER_FLAT_B),
        staticRef(S.ROCK_POINTED),
        staticRef(S.ROCK_CLIFF),
        staticRef(S.PEBBLE),
        staticRef(S.ROCK_CAVE),
        staticRef(S.ROCK_SPIRE),
    ],
    plants: [
        animRef(S.BUSH_SMALL_YELLOW),
        animRef(S.BUSH_LARGE_DARK),
        animRef(S.BUSH_MEDIUM_BERRY),
        animRef(S.BUSH_VARIANT_C),
        animRef(S.BUSH_VARIANT_D),
        animRef(S.BUSH_VARIANT_E),
        animRef(S.BUSH_RED_BERRY),
        animRef(S.BUSH_DARK_GREEN),
        animRef(S.GRASS_FLOWERS_ORANGE),
        animRef(S.GRASS_WEEDS_SMALL),
        animRef(S.GRASS_SMALL_ORANGE),
        animRef(S.GRASS_REEDS_MEDIUM_A),
        animRef(S.GRASS_REEDS_MEDIUM_B),
        animRef(S.GRASS_REEDS_LARGE_A),
        animRef(S.GRASS_REEDS_LARGE_B),
        animRef(S.GRASS_FLOWERS_YELLOW),
        animRef(S.GRASS_PLANT_SMALL),
        animRef(S.GRASS_REEDS_WIDE),
        staticRef(S.DAISIES),
        // Additional sprites to cover expanded raw value count
        staticRef(S.RUBBLE_MEDIUM),
        staticRef(S.RUBBLE_SMALL),
        staticRef(S.DEBRIS_SMALL),
        staticRef(S.BROKEN_PILLAR_C),
        staticRef(S.BROKEN_PILLAR_A),
        staticRef(S.BROKEN_PILLAR_B),
    ],
    river: [
        animRef(S.RIVER_REEDS_TALL),
        animRef(S.RIVER_FERNS),
        animRef(S.RIVER_FLOWERS_LARGE),
        animRef(S.CATTAIL_SINGLE),
        animRef(S.CATTAIL_DOUBLE),
        animRef(S.CATTAIL_TRIPLE),
    ],
    desert: [
        staticRef(S.CACTUS),
        staticRef(S.DESERT_CACTUS_LARGE),
        staticRef(S.DESERT_CACTUS_MEDIUM),
        staticRef(S.DESERT_CACTUS_SMALL),
        staticRef(S.ROCK_SPIRE),
        staticRef(S.DESERT_CACTUS_SPROUT),
        staticRef(S.DESERT_PLANT_A),
        staticRef(S.DESERT_PLANT_B),
        staticRef(S.DESERT_PLANT_C),
        staticRef(S.DESERT_PLANT_D),
        staticRef(S.DESERT_PLANT_E),
        staticRef(S.DESERT_PLANT_F),
        staticRef(S.DESERT_PLANT_G),
    ],
    sea: [animRef(S.SEA_ROCK_A), animRef(S.SEA_ROCK_B), animRef(S.SEA_ROCK_C), animRef(S.SEA_ROCK_D)],
    beach: [
        staticRef(S.SEASHELL),
        staticRef(S.STARFISH),
        staticRef(S.BEACH_DECO_J),
        staticRef(S.BEACH_DECO_K),
        staticRef(S.BEACH_DECO_L),
    ],
    // Rare variants — distinctive objects that stand out on the landscape
    plants_rare: [
        staticRef(S.MUSHROOM_RING),
        staticRef(S.SCARECROW),
        staticRef(S.ROMAN_COLUMN_OVERGROWN_A),
        staticRef(S.BROKEN_PILLAR_A),
        staticRef(S.ANCIENT_COLUMN),
        animRef(S.BUILDING_RUIN_ANIM),
        staticRef(S.STONE_STATUE),
        staticRef(S.SMALL_ANIMAL),
        staticRef(S.GRAVE_A),
        staticRef(S.WAGON_WRECK),
        staticRef(S.VINE_GROUND_COVER),
        staticRef(S.AMANITA_MUSHROOM),
        staticRef(S.RUINED_COLUMN),
        staticRef(S.ROMAN_PILLAR_SMALL),
        staticRef(S.ROMAN_PILLAR_MEDIUM_A),
        staticRef(S.ROMAN_PILLAR_MEDIUM_B),
        staticRef(S.ROMAN_PILLAR_LARGE_A),
        staticRef(S.ROMAN_PILLAR_LARGE_B),
        // Reserved for very rare values only: POND, STONE_CROSS_RUIN
    ],
    desert_rare: [staticRef(S.SKELETON_LARGE), staticRef(S.SKELETON_SMALL), staticRef(S.WAGON_WRECK)],
    beach_rare: [staticRef(S.BOAT_WRECK), staticRef(S.SHIPWRECK)],
    lake: [staticRef(S.LAKE_DECO_A), staticRef(S.LAKE_DECO_B), staticRef(S.LAKE_DECO_C)],
    snow: [staticRef(S.SNOWMAN), staticRef(S.SNOWMAN_B), staticRef(S.DARK_STONE_BLOCK)],
    stone_rare: [staticRef(S.ROCK_CAVE), staticRef(S.ROCK_SPIRE)],
    // Dark ground — dark tribe vegetation and volcanic rocks on swamp/dark grass terrain
    dark_ground: [
        staticRef(S.DARK_TRIBE_TREE_A),
        staticRef(S.DARK_TRIBE_TREE_B),
        staticRef(S.DARK_TRIBE_BUSH_A),
        staticRef(S.DARK_TRIBE_BUSH_B),
        staticRef(S.DARK_TRIBE_FLOWER),
        staticRef(S.DARK_TRIBE_DEAD_TREE),
        staticRef(S.ORE_ROCK_A),
        staticRef(S.ORE_ROCK_B),
        staticRef(S.VOLCANIC_ROCK_SMALL),
        staticRef(S.VOLCANIC_ROCK_MEDIUM),
        staticRef(S.VINE_GROUND_COVER),
        staticRef(S.DARK_STONE_BLOCK),
    ],
    dark_ground_rare: [
        staticRef(S.DARK_TRIBE_TREE_C),
        staticRef(S.VOLCANIC_ROCK_LARGE),
        staticRef(S.VOLCANIC_ROCK_PILLAR),
        staticRef(S.LAVA_ROCK_TALL),
        staticRef(S.LAVA_ROCK_MEDIUM),
        staticRef(S.LAVA_ROCK_SMALL),
        staticRef(S.RED_CRYSTAL_A),
    ],
};

/**
 * Build a map from raw decoration byte value → sprite reference.
 * Cycles through the sprite pool for each category so that
 * different raw values within the same category get different sprites.
 */
export function buildDecorationSpriteMap(): Map<number, DecorationSpriteRef> {
    const map = new Map<number, DecorationSpriteRef>();

    // Group raw values by category (preserving DECORATION_TYPES order)
    const byCategory = new Map<string, number[]>();
    for (const deco of DECORATION_TYPES) {
        const list = byCategory.get(deco.category) ?? [];
        list.push(deco.raw);
        byCategory.set(deco.category, list);
    }

    for (const [category, rawValues] of byCategory) {
        const pool = CATEGORY_SPRITE_POOLS[category];
        if (!pool?.length) continue;
        for (let i = 0; i < rawValues.length; i++) {
            map.set(rawValues[i]!, pool[i % pool.length]!);
        }
    }

    return map;
}

/** Get all MapObjectTypes for a given category */
export function getTypesForCategory(category: ObjectCategory): MapObjectType[] {
    return Object.entries(OBJECT_TYPE_CATEGORY)
        .filter(([, cat]) => cat === category)
        .map(([type]) => Number(type) as MapObjectType);
}

/** Options for populating map objects */
export interface PopulateOptions {
    /** Populate only this category */
    category?: ObjectCategory;
    /** Populate only these specific types */
    types?: MapObjectType[];
    /** Clear existing objects of matching types before populating */
    clearExisting?: boolean;
}

/**
 * Analyze raw object type values in the map data.
 * Useful for reverse-engineering the byte value mappings.
 *
 * @returns Map of raw value -> count
 */
export function analyzeObjectTypes(objectType: Uint8Array): Map<number, number> {
    const counts = new Map<number, number>();

    for (let i = 0; i < objectType.length; i++) {
        const val = objectType[i]!;
        if (val !== 0) {
            counts.set(val, (counts.get(val) ?? 0) + 1);
        }
    }

    // Log distribution
    const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]);
    log.debug(`Object type distribution (${sorted.length} unique values):`);
    for (const [type, count] of sorted.slice(0, 20)) {
        const mapped = RAW_TO_OBJECT_TYPE.get(type);
        const mappedStr = mapped !== undefined ? ` -> ${MapObjectType[mapped]}` : ' (unmapped)';
        log.debug(`  Raw ${type}: ${count} tiles${mappedStr}`);
    }
    if (sorted.length > 20) {
        log.debug(`  ... and ${sorted.length - 20} more values`);
    }

    return counts;
}

/**
 * Populate map objects from landscape object type data.
 *
 * @param state - Game state to add entities to
 * @param objectType - Raw object type data from landscape
 * @param terrain - Terrain data for buildability checks
 * @param options - Filtering options
 * @returns Number of objects spawned
 */
// eslint-disable-next-line sonarjs/cognitive-complexity -- map population loop has multiple filter conditions
export function populateMapObjects(
    state: GameState,
    objectType: Uint8Array,
    terrain: TerrainData,
    options: PopulateOptions = {}
): number {
    const { groundType, mapSize } = terrain;
    const { category, types, clearExisting } = options;

    // Determine which MapObjectTypes to spawn
    let allowedTypes: Set<MapObjectType> | null = null;
    if (types) {
        allowedTypes = new Set(types);
    } else if (category) {
        allowedTypes = new Set(getTypesForCategory(category));
    }

    // Clear existing if requested
    if (clearExisting) {
        clearMapObjects(state, category, types);
    }

    const w = mapSize.width;
    const h = mapSize.height;
    let count = 0;

    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            const idx = mapSize.toIndex(x, y);
            const rawValue = objectType[idx]!;

            // Skip empty tiles
            if (rawValue === 0) continue;

            // Skip unbuildable terrain (water, etc.)
            if (!isBuildable(groundType[idx]!)) continue;

            // Skip already occupied tiles
            if (state.getEntityAt(x, y)) continue;

            // Map raw value to MapObjectType
            const mappedType = RAW_TO_OBJECT_TYPE.get(rawValue);
            if (mappedType === undefined) continue;

            // Filter by allowed types
            if (allowedTypes && !allowedTypes.has(mappedType)) continue;

            state.addEntity(EntityType.MapObject, mappedType, x, y, 0);
            count++;
        }
    }

    const catSuffix = category ? ` (${category})` : '';
    log.debug(`Populated ${count} map objects${catSuffix}`);
    return count;
}

/** Raw value range for harvestable stone: 124 (nearly depleted) to 135 (full). */
const STONE_RAW_MIN = 124;
const STONE_RAW_MAX = 135;

/** Convert raw stone object value to initial depletion level (1-12). */
function rawStoneToLevel(rawType: number): number {
    return rawType - STONE_RAW_MIN + 1;
}

interface ClassifiedObject {
    type: MapObjectType;
    variation?: number;
    /** Whether this object requires buildable terrain. */
    needsBuildable: boolean;
}

/**
 * Classify a raw object type byte from the map file.
 * Returns the mapped MapObjectType + optional initial variation,
 * or null if the raw value should be stored as-is (decoration).
 */
function classifyRawObjectType(rawType: number): ClassifiedObject | null {
    // Trees (raw 1-18 → MapObjectType 0-17)
    const tree = s4TreeTypeToMapObjectType(rawType as S4TreeType);
    if (tree !== null) return { type: tree, needsBuildable: true };

    // Harvestable stone (raw 124-135 → ResourceStone with initial depletion level)
    if (rawType >= STONE_RAW_MIN && rawType <= STONE_RAW_MAX) {
        return { type: MapObjectType.ResourceStone, variation: rawStoneToLevel(rawType), needsBuildable: false };
    }

    return null;
}

function isTreeType(type: MapObjectType): boolean {
    return type <= MapObjectType.TreeOliveSmall;
}

/**
 * Populate map objects from parsed entity data (MapObjects chunk).
 * This is the CORRECT way to load trees - from the MapObjects chunk (type 6),
 * not from landscape byte 2 which contains terrain attributes.
 *
 * For trees (raw type 1-18), converts to MapObjectType (0-17).
 * For harvestable stone (raw 124-135), converts to ResourceStone with initial depletion level.
 * For other values (>18), stores the raw byte value as subType directly (decorations).
 *
 * @param state - Game state to add entities to
 * @param objects - Parsed map object data from MapObjects chunk
 * @param terrain - Terrain data for buildability checks
 * @returns Number of tree objects spawned (non-trees are also added but not counted for expansion)
 */
/** Result of adding a single map object: 'tree', 'deco', or null (skipped). */
function addMapObject(
    state: GameState,
    x: number,
    y: number,
    rawType: number,
    groundType: Uint8Array,
    mapSize: MapSize
): 'tree' | 'deco' | null {
    if (x < 0 || x >= mapSize.width || y < 0 || y >= mapSize.height) return null;
    if (state.getEntityAt(x, y)) return null;

    const classified = classifyRawObjectType(rawType);
    if (classified) {
        if (classified.needsBuildable && !isBuildable(groundType[mapSize.toIndex(x, y)]!)) return null;
        state.addEntity(EntityType.MapObject, classified.type, x, y, 0, undefined, classified.variation);
        return isTreeType(classified.type) ? 'tree' : 'deco';
    }

    state.addEntity(EntityType.MapObject, rawType, x, y, 0);
    return 'deco';
}

export function populateMapObjectsFromEntityData(
    state: GameState,
    objects: MapObjectData[],
    terrain: TerrainData
): number {
    const { groundType, mapSize } = terrain;
    let treeCount = 0;
    let decoCount = 0;

    for (const obj of objects) {
        const result = addMapObject(state, obj.x, obj.y, obj.objectType, groundType, mapSize);
        if (result === 'tree') treeCount++;
        else if (result === 'deco') decoCount++;
    }

    log.debug(`Populated ${treeCount} trees + ${decoCount} decorations from ${objects.length} tile entries`);
    return treeCount;
}

/**
 * Spawn test objects for a category (when no real map data is available).
 * Distributes objects pseudo-randomly across buildable terrain.
 *
 * @param state - Game state to add entities to
 * @param terrain - Terrain data for buildability checks
 * @param category - Category of objects to spawn
 * @param count - Number of objects to spawn
 * @returns Number of objects actually spawned
 */
export function spawnTestObjects(
    state: GameState,
    terrain: TerrainData,
    category: ObjectCategory,
    count: number = 50
): number {
    const { groundType, mapSize } = terrain;
    const types = getTypesForCategory(category);
    if (types.length === 0) return 0;

    const w = mapSize.width;
    const h = mapSize.height;
    let spawned = 0;

    for (let i = 0; i < count && spawned < count; i++) {
        // Deterministic pseudo-random positions
        const x = (i * 31 + 17) % w;
        const y = (i * 37 + 23) % h;
        const idx = mapSize.toIndex(x, y);

        // Skip unbuildable or occupied
        if (!isBuildable(groundType[idx]!)) continue;
        if (state.getEntityAt(x, y)) continue;

        // Cycle through types in category
        const objectType = types[i % types.length]!;
        state.addEntity(EntityType.MapObject, objectType, x, y, 0);
        spawned++;
    }

    log.debug(`Spawned ${spawned} test ${category}`);
    return spawned;
}

/**
 * Clear map objects from the game state.
 *
 * @param state - Game state to remove entities from
 * @param category - Only clear this category (optional)
 * @param types - Only clear these specific types (optional)
 * @returns Number of objects removed
 */
export function clearMapObjects(state: GameState, category?: ObjectCategory, types?: MapObjectType[]): number {
    // Determine which types to clear
    let allowedTypes: Set<MapObjectType> | null = null;
    if (types) {
        allowedTypes = new Set(types);
    } else if (category) {
        allowedTypes = new Set(getTypesForCategory(category));
    }

    // Find matching entities
    const toRemove = state.entities.filter(e => {
        if (e.type !== EntityType.MapObject) return false;
        if (allowedTypes && !allowedTypes.has(e.subType as MapObjectType)) return false;
        return true;
    });

    // Remove them
    for (const entity of toRemove) {
        state.removeEntity(entity.id);
    }

    const catSuffix = category ? ` (${category})` : '';
    log.debug(`Cleared ${toRemove.length} map objects${catSuffix}`);
    return toRemove.length;
}

/**
 * Count map objects by category.
 *
 * @param state - Game state to count entities in
 * @returns Map of category -> count
 */
export function countMapObjectsByCategory(state: GameState): Map<ObjectCategory, number> {
    const counts = new Map<ObjectCategory, number>();
    for (const cat of OBJECT_CATEGORIES) {
        counts.set(cat, 0);
    }

    for (const entity of state.entities) {
        if (entity.type !== EntityType.MapObject) continue;
        const category = OBJECT_TYPE_CATEGORY[entity.subType as MapObjectType];
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- subType may not be a valid MapObjectType at runtime
        if (category) {
            counts.set(category, (counts.get(category) ?? 0) + 1);
        }
    }

    return counts;
}

// ============================================================================
// Tree Expansion (grow forests around existing seed trees)
// ============================================================================

/** Palm tree types (allowed on beach/sand) */
const PALM_TREES = new Set([MapObjectType.TreeCoconut, MapObjectType.TreeDate]);

/** Check if terrain allows trees */
function canHaveTrees(terrain: number): boolean {
    // No trees on water
    if (terrain >= S4GroundType.WATER1 && terrain <= S4GroundType.WATER8) return false;

    // No trees on rivers
    if (terrain >= S4GroundType.RIVER1 && terrain <= S4GroundType.RIVER4) return false;

    // No trees on snow/mountains
    if (terrain === S4GroundType.SNOW || terrain === S4GroundType.SNOW_ROCK) return false;

    // No trees on rock/mountains
    if (terrain === S4GroundType.ROCK || terrain === S4GroundType.ROCK_GRASS || terrain === S4GroundType.ROCK_SNOW)
        return false;

    // No trees on roads
    if (terrain === S4GroundType.SANDYROAD || terrain === S4GroundType.COBBLEDROAD) return false;

    return true;
}

/** Check if terrain is beach/sand (only palms allowed) */
function isBeachTerrain(terrain: number): boolean {
    return terrain === S4GroundType.BEACH || terrain === S4GroundType.DESERT || terrain === S4GroundType.DESERT_GRASS;
}

/** Filter tree type based on terrain */
function isTreeAllowedOnTerrain(treeType: MapObjectType, terrain: number): boolean {
    if (!canHaveTrees(terrain)) return false;

    // On beach/desert, only palms allowed
    if (isBeachTerrain(terrain)) {
        return PALM_TREES.has(treeType);
    }

    return true;
}

/** Simple hash for deterministic randomness */
function hash(x: number, y: number, seed: number): number {
    let h = seed + x * 374761393 + y * 668265263;
    h = (h ^ (h >> 13)) * 1274126177;
    return h ^ (h >> 16);
}

/** Options for expanding trees */
export interface ExpandTreesOptions {
    /** Random seed for reproducible generation */
    seed?: number;
    /** Radius around each seed tree to expand (default 8) */
    radius?: number;
    /** Probability of placing a tree at each valid position (default 0.3) */
    density?: number;
    /** Minimum spacing between trees (default 2) */
    minSpacing?: number;
}

/** Check if position has nearby trees (for spacing) */
function hasNearbyTree(x: number, y: number, occupied: Set<number>, mapSize: MapSize): boolean {
    for (let cy = -1; cy <= 1; cy++) {
        for (let cx = -1; cx <= 1; cx++) {
            if (cx === 0 && cy === 0) continue;
            if (occupied.has(mapSize.toIndex(x + cx, y + cy))) return true;
        }
    }
    return false;
}

/** Select tree type for new tree (seed type with 15% variation) */
function selectTreeTypeForExpansion(
    seedType: MapObjectType,
    terrain: number,
    x: number,
    y: number,
    seed: number
): MapObjectType {
    const varChance = (Math.abs(hash(x, y, seed + 2000)) % 100) / 100;
    if (varChance >= 0.15) {
        return isTreeAllowedOnTerrain(seedType, terrain) ? seedType : MapObjectType.TreeOak;
    }

    const allTreeTypes = getTypesForCategory('trees');
    const allowed = allTreeTypes.filter(t => isTreeAllowedOnTerrain(t, terrain));
    if (allowed.length === 0) return seedType;

    return allowed[Math.abs(hash(x, y, seed + 3000)) % allowed.length]!;
}

/** Smoothstep: 0 at edge, 1 at center, smooth cubic transition */
function smoothstep(t: number): number {
    return t * t * (3 - 2 * t);
}

/** Check if tree should be placed at position */
function shouldPlaceTree(
    dx: number,
    dy: number,
    nx: number,
    ny: number,
    radius: number,
    density: number,
    seed: number
): boolean {
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist > radius) return false;

    // Smooth fade: 1.0 at center, 0.0 at edge
    const distFactor = smoothstep(1 - dist / radius);

    const randVal = (Math.abs(hash(nx, ny, seed)) % 1000) / 1000;

    return randVal <= density * distFactor;
}

/** Collect existing trees from game state */
function collectSeedTrees(
    state: GameState,
    mapSize: MapSize
): {
    seeds: Array<{ x: number; y: number; type: MapObjectType }>;
    occupied: Set<number>;
} {
    const seeds: Array<{ x: number; y: number; type: MapObjectType }> = [];
    const occupied = new Set<number>();

    for (const entity of state.entities) {
        if (entity.type !== EntityType.MapObject) continue;
        const cat = OBJECT_TYPE_CATEGORY[entity.subType as MapObjectType];
        if (cat !== 'trees') continue;
        seeds.push({ x: entity.x, y: entity.y, type: entity.subType as MapObjectType });
        occupied.add(mapSize.toIndex(entity.x, entity.y));
    }
    return { seeds, occupied };
}

/** Try to place a tree at position, returns true if placed */
function tryPlaceTreeAt(
    nx: number,
    ny: number,
    dx: number,
    dy: number,
    seedType: MapObjectType,
    groundType: Uint8Array,
    occupied: Set<number>,
    state: GameState,
    mapSize: MapSize,
    radius: number,
    density: number,
    seed: number,
    minSpacing: number
): boolean {
    const idx = mapSize.toIndex(nx, ny);
    if (occupied.has(idx)) return false;

    const terrain = groundType[idx]!;
    if (!isBuildable(terrain) || !canHaveTrees(terrain)) return false;
    if (!shouldPlaceTree(dx, dy, nx, ny, radius, density, seed)) return false;
    if (minSpacing > 0 && hasNearbyTree(nx, ny, occupied, mapSize)) return false;

    const treeType = selectTreeTypeForExpansion(seedType, terrain, nx, ny, seed);
    if (!isTreeAllowedOnTerrain(treeType, terrain)) return false;

    state.addEntity(EntityType.MapObject, treeType, nx, ny, 0);
    occupied.add(idx);
    return true;
}

/**
 * Expand existing trees by adding more trees around them.
 * Uses seed trees from map data as starting points for forest clusters.
 */
// eslint-disable-next-line complexity, sonarjs/cognitive-complexity -- forest expansion algorithm has many steps
export function expandTrees(state: GameState, terrain: TerrainData, options: ExpandTreesOptions = {}): number {
    const { groundType, mapSize } = terrain;
    const { seed = 12345, radius = 8, density = 0.3, minSpacing = 1 } = options;
    const w = mapSize.width;
    const h = mapSize.height;

    const { seeds: seedTrees, occupied } = collectSeedTrees(state, mapSize);
    if (seedTrees.length === 0) {
        log.debug('No seed trees to expand');
        return 0;
    }

    let count = 0;

    for (const { x: sx, y: sy, type: seedType } of seedTrees) {
        for (let dy = -radius; dy <= radius; dy++) {
            for (let dx = -radius; dx <= radius; dx++) {
                if (dx === 0 && dy === 0) continue;
                const nx = sx + dx;
                const ny = sy + dy;
                if (nx < 0 || nx >= w || ny < 0 || ny >= h) continue;

                if (
                    tryPlaceTreeAt(
                        nx,
                        ny,
                        dx,
                        dy,
                        seedType,
                        groundType,
                        occupied,
                        state,
                        mapSize,
                        radius,
                        density,
                        seed,
                        minSpacing
                    )
                ) {
                    count++;
                }
            }
        }
    }

    log.debug(`Expanded ${seedTrees.length} seed trees into ${count} additional trees`);
    return count;
}
