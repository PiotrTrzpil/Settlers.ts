/* eslint-disable max-lines -- data registry: one entry per raw object value, not meaningfully splittable */
/**
 * Central registry mapping raw map byte values (MapObjects chunk, type 6)
 * to our internal types.
 *
 * All knowledge about "what does raw byte X mean?" lives here:
 * trees, harvestable stone, decorations, and community-discovered magic bytes.
 *
 * Consumers that need to *use* the classified types (categories, sprites,
 * terrain constraints) import from their respective modules instead.
 */

import { MapObjectCategory, MapObjectType } from '@/game/types/map-object-types';

// ============================================================
// Unified entry type
// ============================================================

/** A single entry in the raw object registry. */
export interface RawObjectEntry {
    /** Raw byte value from the MapObjects chunk. */
    raw: number;
    /** Human-readable name. */
    label: string;
    /** Classification category. */
    category: MapObjectCategory;
    /** Observation notes: where seen, frequency, confidence. */
    notes: string;
    /** If set, this raw value maps to a typed MapObjectType entity. If absent, stored as raw decoration. */
    type?: MapObjectType;
    /** Optional initial variation (e.g., stone depletion level 1-12). */
    variation?: number;
}

// ============================================================
// The registry — every known raw byte value, sorted by raw value
// ============================================================

export const RAW_OBJECT_REGISTRY: readonly RawObjectEntry[] = [
    // ---- Trees: raw 1-18 (S4ModApi S4_TREE_ENUM, verified) ----
    { raw: 1, label: 'Oak', category: MapObjectCategory.Trees, notes: 'S4TreeType.OAK', type: MapObjectType.TreeOak },
    {
        raw: 2,
        label: 'Beech',
        category: MapObjectCategory.Trees,
        notes: 'S4TreeType.BEECH',
        type: MapObjectType.TreeBeech,
    },
    { raw: 3, label: 'Ash', category: MapObjectCategory.Trees, notes: 'S4TreeType.ASH', type: MapObjectType.TreeAsh },
    {
        raw: 4,
        label: 'Linden',
        category: MapObjectCategory.Trees,
        notes: 'S4TreeType.LINDEN',
        type: MapObjectType.TreeLinden,
    },
    {
        raw: 5,
        label: 'Birch',
        category: MapObjectCategory.Trees,
        notes: 'S4TreeType.BIRCH',
        type: MapObjectType.TreeBirch,
    },
    {
        raw: 6,
        label: 'Poplar',
        category: MapObjectCategory.Trees,
        notes: 'S4TreeType.POPLAR',
        type: MapObjectType.TreePoplar,
    },
    {
        raw: 7,
        label: 'Chestnut',
        category: MapObjectCategory.Trees,
        notes: 'S4TreeType.CHESTNUT',
        type: MapObjectType.TreeChestnut,
    },
    {
        raw: 8,
        label: 'Maple',
        category: MapObjectCategory.Trees,
        notes: 'S4TreeType.MAPLE',
        type: MapObjectType.TreeMaple,
    },
    { raw: 9, label: 'Fir', category: MapObjectCategory.Trees, notes: 'S4TreeType.FIR', type: MapObjectType.TreeFir },
    {
        raw: 10,
        label: 'Spruce',
        category: MapObjectCategory.Trees,
        notes: 'S4TreeType.SPRUCE',
        type: MapObjectType.TreeSpruce,
    },
    {
        raw: 11,
        label: 'Coconut',
        category: MapObjectCategory.Trees,
        notes: 'S4TreeType.COCONUT (palm)',
        type: MapObjectType.TreeCoconut,
    },
    {
        raw: 12,
        label: 'Date',
        category: MapObjectCategory.Trees,
        notes: 'S4TreeType.DATE (palm)',
        type: MapObjectType.TreeDate,
    },
    {
        raw: 13,
        label: 'Walnut',
        category: MapObjectCategory.Trees,
        notes: 'S4TreeType.WALNUT',
        type: MapObjectType.TreeWalnut,
    },
    {
        raw: 14,
        label: 'CorkOak',
        category: MapObjectCategory.Trees,
        notes: 'S4TreeType.CORKOAK',
        type: MapObjectType.TreeCorkOak,
    },
    {
        raw: 15,
        label: 'Pine',
        category: MapObjectCategory.Trees,
        notes: 'S4TreeType.PINE',
        type: MapObjectType.TreePine,
    },
    {
        raw: 16,
        label: 'Pine2',
        category: MapObjectCategory.Trees,
        notes: 'S4TreeType.PINE2',
        type: MapObjectType.TreePine2,
    },
    {
        raw: 17,
        label: 'OliveLarge',
        category: MapObjectCategory.Trees,
        notes: 'S4TreeType.OLIVE_LARGE',
        type: MapObjectType.TreeOliveLarge,
    },
    {
        raw: 18,
        label: 'OliveSmall',
        category: MapObjectCategory.Trees,
        notes: 'S4TreeType.OLIVE_SMALL',
        type: MapObjectType.TreeOliveSmall,
    },

    // ---- Landscape plants: raw 19-29, 31 (just above tree range) ----
    // Guessed: 19-22 = Bush1-4 (common, ~12-15k), 23-27 = Bush5-9 (uncommon, ~1.6-2.6k)
    // 28-29 = Flower1-2, 31 = Foliage1. Needs visual verification.
    {
        raw: 19,
        label: 'Bush1',
        category: MapObjectCategory.Plants,
        notes: 'Common (15k); guessed Bush1',
        type: MapObjectType.Bush1,
    },
    {
        raw: 20,
        label: 'Bush2',
        category: MapObjectCategory.Plants,
        notes: 'Common (14k); guessed Bush2',
        type: MapObjectType.Bush2,
    },
    {
        raw: 21,
        label: 'Bush3',
        category: MapObjectCategory.Plants,
        notes: 'Common (12k); guessed Bush3',
        type: MapObjectType.Bush3,
    },
    {
        raw: 22,
        label: 'Bush4',
        category: MapObjectCategory.Plants,
        notes: 'Common (12k); guessed Bush4',
        type: MapObjectType.Bush4,
    },
    {
        raw: 23,
        label: 'Bush5',
        category: MapObjectCategory.Plants,
        notes: 'Uncommon (2.6k); guessed Bush5',
        type: MapObjectType.Bush5,
    },
    {
        raw: 24,
        label: 'Bush6',
        category: MapObjectCategory.Plants,
        notes: 'Uncommon (2k); guessed Bush6',
        type: MapObjectType.Bush6,
    },
    {
        raw: 25,
        label: 'Bush7',
        category: MapObjectCategory.Plants,
        notes: 'Uncommon (1.8k); guessed Bush7',
        type: MapObjectType.Bush7,
    },
    {
        raw: 26,
        label: 'Bush8',
        category: MapObjectCategory.Plants,
        notes: 'Uncommon (1.6k); guessed Bush8',
        type: MapObjectType.Bush8,
    },
    {
        raw: 27,
        label: 'Bush9',
        category: MapObjectCategory.Plants,
        notes: 'Uncommon (1.8k); guessed Bush9',
        type: MapObjectType.Bush9,
    },
    {
        raw: 28,
        label: 'Flower1',
        category: MapObjectCategory.Plants,
        notes: 'Uncommon (1.8k); guessed Flower1',
        type: MapObjectType.Flower1,
    },
    {
        raw: 29,
        label: 'Flower2',
        category: MapObjectCategory.Plants,
        notes: 'Uncommon (3k); guessed Flower2',
        type: MapObjectType.Flower2,
    },
    // raw 30: not observed on any map
    {
        raw: 31,
        label: 'Foliage1',
        category: MapObjectCategory.Plants,
        notes: 'Uncommon (857); guessed Foliage1',
        type: MapObjectType.Foliage1,
    },
    // raw 32-42: not observed on any map

    // ---- River: raw 43 ----
    // Guessed: Reed1 (river-edge plant). XML: REED1-3 are blocking=0, version=1.
    {
        raw: 43,
        label: 'Reed1',
        category: MapObjectCategory.River,
        notes: 'Near rivers; guessed Reed1',
        type: MapObjectType.Reed1,
    },

    // ---- Common grass: raw 44-49 (~35k each across maps) ----
    // Guessed: Grass1-6 (XML has GRASS1-10, first 6 match the 6 common raw values)
    {
        raw: 44,
        label: 'Grass1',
        category: MapObjectCategory.Plants,
        notes: 'On grass (~35k); guessed Grass1',
        type: MapObjectType.Grass1,
    },
    {
        raw: 45,
        label: 'Grass2',
        category: MapObjectCategory.Plants,
        notes: 'On grass (~35k); guessed Grass2',
        type: MapObjectType.Grass2,
    },
    {
        raw: 46,
        label: 'Grass3',
        category: MapObjectCategory.Plants,
        notes: 'On grass (~35k); guessed Grass3',
        type: MapObjectType.Grass3,
    },
    {
        raw: 47,
        label: 'Grass4',
        category: MapObjectCategory.Plants,
        notes: 'On grass (~35k); guessed Grass4',
        type: MapObjectType.Grass4,
    },
    {
        raw: 48,
        label: 'Grass5',
        category: MapObjectCategory.Plants,
        notes: 'On grass (~35k); guessed Grass5',
        type: MapObjectType.Grass5,
    },
    {
        raw: 49,
        label: 'Grass6',
        category: MapObjectCategory.Plants,
        notes: 'On grass (~35k); guessed Grass6',
        type: MapObjectType.Grass6,
    },

    // ---- Desert / shore: raw 50-55 ----
    // Guessed: DesertBush1-3 for 50-52 (non-blocking desert plants), Cactus1 for 53.
    // Cactus in XML is blocking=1 — but raw 53 is in non-blocking Desert category, so maybe DesertBush instead.
    {
        raw: 50,
        label: 'DesertBush1',
        category: MapObjectCategory.Desert,
        notes: 'On desert; guessed DesertBush1',
        type: MapObjectType.DesertBush1,
    },
    {
        raw: 51,
        label: 'DesertBush2',
        category: MapObjectCategory.Desert,
        notes: 'On desert (possibly); guessed DesertBush2',
        type: MapObjectType.DesertBush2,
    },
    {
        raw: 52,
        label: 'DesertBush3',
        category: MapObjectCategory.Desert,
        notes: 'On desert; guessed DesertBush3',
        type: MapObjectType.DesertBush3,
    },
    // Pool index 0 → CACTUS sprite; confident mapping
    {
        raw: 53,
        label: 'Cactus1',
        category: MapObjectCategory.Desert,
        notes: 'On desert; pool→CACTUS sprite',
        type: MapObjectType.Cactus1,
    },
    // DesertRare pool index 0 → SKELETON_LARGE
    {
        raw: 54,
        label: 'SkeletonDesert1',
        category: MapObjectCategory.DesertRare,
        notes: 'Near desert, very rare; pool→SKELETON_LARGE',
        type: MapObjectType.SkeletonDesert1,
    },
    {
        raw: 55,
        label: 'Shore55',
        category: MapObjectCategory.Sea,
        notes: 'Near sea / on sea near shore, rare — possibly map data bug',
    },

    // ---- Mountain / stone: raw 56-75 ----
    { raw: 56, label: 'MountainEdge56', category: MapObjectCategory.Stone, notes: 'Near mountain edge' },
    { raw: 57, label: 'Mountain57', category: MapObjectCategory.Stone, notes: 'On mountain' },
    { raw: 58, label: 'Mountain58', category: MapObjectCategory.Stone, notes: 'On mountain (inferred from 57)' },
    // 59-75: Mountain edge decorations — rocks/rubble near mountain-grass transitions
    {
        raw: 59,
        label: 'MountainEdge59',
        category: MapObjectCategory.Stone,
        notes: 'Near mountain edges, mostly on mountain but some on grass',
    },
    { raw: 60, label: 'MountainEdge60', category: MapObjectCategory.Stone, notes: 'Near mountain edges' },
    { raw: 61, label: 'MountainEdge61', category: MapObjectCategory.Stone, notes: 'Near mountain edges' },
    { raw: 62, label: 'MountainEdge62', category: MapObjectCategory.Stone, notes: 'Near mountain edges' },
    { raw: 63, label: 'MountainEdge63', category: MapObjectCategory.Stone, notes: 'Near mountain edges' },
    { raw: 64, label: 'MountainEdge64', category: MapObjectCategory.Stone, notes: 'Near mountain edges' },
    { raw: 65, label: 'MountainEdge65', category: MapObjectCategory.Stone, notes: 'Near mountain edges' },
    { raw: 66, label: 'MountainEdge66', category: MapObjectCategory.Stone, notes: 'Near mountain edges' },
    { raw: 67, label: 'MountainEdge67', category: MapObjectCategory.Stone, notes: 'Near mountain edges' },
    { raw: 68, label: 'MountainEdge68', category: MapObjectCategory.Stone, notes: 'Near mountain edges' },
    { raw: 69, label: 'MountainEdge69', category: MapObjectCategory.Stone, notes: 'Near mountain edges' },
    { raw: 70, label: 'MountainEdge70', category: MapObjectCategory.Stone, notes: 'Near mountain edges' },
    { raw: 71, label: 'MountainEdge71', category: MapObjectCategory.Stone, notes: 'Near mountain edges' },
    { raw: 72, label: 'MountainEdge72', category: MapObjectCategory.Stone, notes: 'Near mountain edges' },
    { raw: 73, label: 'MountainEdge73', category: MapObjectCategory.Stone, notes: 'Near mountain edges' },
    { raw: 74, label: 'MountainEdge74', category: MapObjectCategory.Stone, notes: 'Near mountain edges' },
    { raw: 75, label: 'MountainEdge75', category: MapObjectCategory.Stone, notes: 'Near mountain edges' },

    // ---- Grass / river mix: raw 76-85 ----
    // 76 is extremely common (201k) — could be Grass7 or a generic ground fill
    {
        raw: 76,
        label: 'Grass7',
        category: MapObjectCategory.Plants,
        notes: 'On grass (201k); guessed Grass7',
        type: MapObjectType.Grass7,
    },
    // 77-78, 83-84 are river-adjacent — guessed Reed2-3, then remaining river decorations
    {
        raw: 77,
        label: 'Reed2',
        category: MapObjectCategory.River,
        notes: 'Near rivers; guessed Reed2',
        type: MapObjectType.Reed2,
    },
    {
        raw: 78,
        label: 'Reed3',
        category: MapObjectCategory.River,
        notes: 'Near rivers; guessed Reed3',
        type: MapObjectType.Reed3,
    },
    { raw: 79, label: 'Grass79', category: MapObjectCategory.Plants, notes: 'On grass near rivers' },
    { raw: 80, label: 'Grass80', category: MapObjectCategory.Plants, notes: 'On grass near rivers' },
    {
        raw: 81,
        label: 'Grass8',
        category: MapObjectCategory.Plants,
        notes: 'On grass; guessed Grass8',
        type: MapObjectType.Grass8,
    },
    {
        raw: 82,
        label: 'Grass9',
        category: MapObjectCategory.Plants,
        notes: 'On grass; guessed Grass9',
        type: MapObjectType.Grass9,
    },
    { raw: 83, label: 'River83', category: MapObjectCategory.River, notes: 'Mostly near rivers' },
    { raw: 84, label: 'River84', category: MapObjectCategory.River, notes: 'Mostly near rivers' },
    {
        raw: 85,
        label: 'Grass10',
        category: MapObjectCategory.Plants,
        notes: 'On grass (124k); guessed Grass10',
        type: MapObjectType.Grass10,
    },
    // raw 86: absent from all maps

    // ---- Rare grass: raw 87, 90-92 ----
    // PlantsRare pool cycling: [87,90,91,92,116,152,154,155,156,157,158,159]
    // Pool: MUSHROOM_RING, SCARECROW, ROMAN_COLUMN_OVERGROWN_A, BROKEN_PILLAR_A, ANCIENT_COLUMN, ...
    {
        raw: 87,
        label: 'MushroomCycle',
        category: MapObjectCategory.PlantsRare,
        notes: 'Uncommon (672); pool→MUSHROOM_RING',
        type: MapObjectType.MushroomCycle,
    },
    // raw 88: not observed on any map
    {
        raw: 89,
        label: 'Plant89',
        category: MapObjectCategory.Plants,
        notes: '373-map: 172 across 43 maps, Grass:90%, DarkGrass:9%, avgH 25',
    },
    {
        raw: 90,
        label: 'Scarecrow',
        category: MapObjectCategory.PlantsRare,
        notes: 'Rare; pool→SCARECROW',
        type: MapObjectType.Scarecrow,
    },
    {
        raw: 91,
        label: 'ColumnRuinsA1',
        category: MapObjectCategory.PlantsRare,
        notes: 'Rare; pool→ROMAN_COLUMN_OVERGROWN_A',
        type: MapObjectType.ColumnRuinsA1,
    },
    {
        raw: 92,
        label: 'ColumnRuinsA2',
        category: MapObjectCategory.PlantsRare,
        notes: 'Rare; pool→BROKEN_PILLAR_A',
        type: MapObjectType.ColumnRuinsA2,
    },
    // ---- Grass plants: raw 93-106 (373-map scan: all >85% grass, rare-uncommon) ----
    {
        raw: 93,
        label: 'DarkPlant93',
        category: MapObjectCategory.DarkGround,
        notes: 'dark-land:93%, 532 across 44 maps; was Plants',
    },
    // raw 94-98: not observed on any map
    {
        raw: 99,
        label: 'DarkPlant99',
        category: MapObjectCategory.DarkGround,
        notes: 'dark-land:95%, 465 across 40 maps; was Plants',
    },
    {
        raw: 100,
        label: 'DarkPlant100',
        category: MapObjectCategory.DarkGround,
        notes: 'dark-land:95%, 402 across 44 maps; was Plants',
    },
    {
        raw: 101,
        label: 'DarkPlant101',
        category: MapObjectCategory.DarkGround,
        notes: 'dark-land:91%, 156 across 38 maps; was Plants',
    },
    // raw 102: not observed on any map
    {
        raw: 103,
        label: 'Plant103',
        category: MapObjectCategory.Plants,
        notes: '373-map: 697 across 57 maps, Grass:89%, Rock:6%',
    },
    {
        raw: 104,
        label: 'DarkPlant104',
        category: MapObjectCategory.DarkGround,
        notes: 'dark-land:97%, 877 across 49 maps; was Plants',
    },
    {
        raw: 105,
        label: 'DarkPlant105',
        category: MapObjectCategory.DarkGround,
        notes: 'dark-land:98%, 829 across 50 maps; was Plants',
    },
    {
        raw: 106,
        label: 'DarkPlant106',
        category: MapObjectCategory.DarkGround,
        notes: 'dark-land:98%, 759 across 50 maps; was Plants',
    },

    // ---- Sea: raw 107-110, 119 ----
    // Guessed: Seaweed1-3 for 107-109 (XML: SEEWEED1-3, version=2), Wave for 110
    {
        raw: 107,
        label: 'Seaweed1',
        category: MapObjectCategory.Sea,
        notes: 'On sea; guessed Seaweed1',
        type: MapObjectType.Seaweed1,
    },
    {
        raw: 108,
        label: 'Seaweed2',
        category: MapObjectCategory.Sea,
        notes: 'On sea; guessed Seaweed2',
        type: MapObjectType.Seaweed2,
    },
    {
        raw: 109,
        label: 'Seaweed3',
        category: MapObjectCategory.Sea,
        notes: 'On sea; guessed Seaweed3',
        type: MapObjectType.Seaweed3,
    },
    {
        raw: 110,
        label: 'Wave',
        category: MapObjectCategory.Sea,
        notes: 'On sea; guessed Wave',
        type: MapObjectType.Wave,
    },
    // ---- Grass plants: raw 111-114 (373-map scan: all >90% grass) ----
    {
        raw: 111,
        label: 'DarkPlant111',
        category: MapObjectCategory.DarkGround,
        notes: 'dark-land:95%, 1879 across 49 maps; was Plants',
    },
    {
        raw: 112,
        label: 'DarkPlant112',
        category: MapObjectCategory.DarkGround,
        notes: 'dark-land:95%, 1100 across 47 maps; was Plants',
    },
    {
        raw: 113,
        label: 'DarkPlant113',
        category: MapObjectCategory.DarkGround,
        notes: 'dark-land:94%, 917 across 45 maps; was Plants',
    },
    {
        raw: 114,
        label: 'DarkPlant114',
        category: MapObjectCategory.DarkGround,
        notes: 'dark-land:94%, 617 across 46 maps; was Plants',
    },
    // raw 115: not observed on any map

    // ---- Rare grass: raw 116 ----
    // PlantsRare pool index 4 → ANCIENT_COLUMN
    {
        raw: 116,
        label: 'CelticCross',
        category: MapObjectCategory.PlantsRare,
        notes: 'Rare; pool→ANCIENT_COLUMN',
        type: MapObjectType.CelticCross,
    },
    // raw 117-118: not observed

    // ---- Sea: raw 119 ----
    { raw: 119, label: 'Sea119', category: MapObjectCategory.Sea, notes: 'On sea' },

    // ---- Desert edge: raw 120-122 ----
    // Desert pool indices 1-3 → DESERT_CACTUS_LARGE/MEDIUM/SMALL
    {
        raw: 120,
        label: 'Cactus2',
        category: MapObjectCategory.Desert,
        notes: 'On desert edge; pool→DESERT_CACTUS_LARGE',
        type: MapObjectType.Cactus2,
    },
    {
        raw: 121,
        label: 'Cactus3',
        category: MapObjectCategory.Desert,
        notes: 'On desert edge; pool→DESERT_CACTUS_MEDIUM',
        type: MapObjectType.Cactus3,
    },
    {
        raw: 122,
        label: 'Cactus4',
        category: MapObjectCategory.Desert,
        notes: 'On desert; pool→DESERT_CACTUS_SMALL',
        type: MapObjectType.Cactus4,
    },
    {
        raw: 123,
        label: 'Plant123',
        category: MapObjectCategory.Plants,
        notes: '373-map: 105 across 8 maps, Grass:100%',
    },

    // ---- Harvestable stone: raw 124-135 ----
    // 12 depletion stages: 124 = level 1 (nearly depleted), 135 = level 12 (full).
    // These map to MapObjectType.ResourceStone with variation encoding the level.
    {
        raw: 124,
        label: 'HarvestableStone',
        category: MapObjectCategory.HarvestableStone,
        notes: 'Level 1 of 12 (nearly depleted)',
        type: MapObjectType.ResourceStone,
        variation: 1,
    },
    {
        raw: 125,
        label: 'HarvestableStone',
        category: MapObjectCategory.HarvestableStone,
        notes: 'Level 2 of 12',
        type: MapObjectType.ResourceStone,
        variation: 2,
    },
    {
        raw: 126,
        label: 'HarvestableStone',
        category: MapObjectCategory.HarvestableStone,
        notes: 'Level 3 of 12',
        type: MapObjectType.ResourceStone,
        variation: 3,
    },
    {
        raw: 127,
        label: 'HarvestableStone',
        category: MapObjectCategory.HarvestableStone,
        notes: 'Level 4 of 12',
        type: MapObjectType.ResourceStone,
        variation: 4,
    },
    {
        raw: 128,
        label: 'HarvestableStone',
        category: MapObjectCategory.HarvestableStone,
        notes: 'Level 5 of 12',
        type: MapObjectType.ResourceStone,
        variation: 5,
    },
    {
        raw: 129,
        label: 'HarvestableStone',
        category: MapObjectCategory.HarvestableStone,
        notes: 'Level 6 of 12',
        type: MapObjectType.ResourceStone,
        variation: 6,
    },
    {
        raw: 130,
        label: 'HarvestableStone',
        category: MapObjectCategory.HarvestableStone,
        notes: 'Level 7 of 12',
        type: MapObjectType.ResourceStone,
        variation: 7,
    },
    {
        raw: 131,
        label: 'HarvestableStone',
        category: MapObjectCategory.HarvestableStone,
        notes: 'Level 8 of 12',
        type: MapObjectType.ResourceStone,
        variation: 8,
    },
    {
        raw: 132,
        label: 'HarvestableStone',
        category: MapObjectCategory.HarvestableStone,
        notes: 'Level 9 of 12',
        type: MapObjectType.ResourceStone,
        variation: 9,
    },
    {
        raw: 133,
        label: 'HarvestableStone',
        category: MapObjectCategory.HarvestableStone,
        notes: 'Level 10 of 12',
        type: MapObjectType.ResourceStone,
        variation: 10,
    },
    {
        raw: 134,
        label: 'HarvestableStone',
        category: MapObjectCategory.HarvestableStone,
        notes: 'Level 11 of 12',
        type: MapObjectType.ResourceStone,
        variation: 11,
    },
    {
        raw: 135,
        label: 'HarvestableStone',
        category: MapObjectCategory.HarvestableStone,
        notes: 'Level 12 of 12 (full)',
        type: MapObjectType.ResourceStone,
        variation: 12,
    },

    // ---- Stone / rare grass: raw 136-159 ----
    { raw: 136, label: 'StoneEdge136', category: MapObjectCategory.Stone, notes: 'Near harvestable stones (22k)' },

    // ---- Desert transition: raw 137-148 (373-map scan: 40-70% desert, grass/desert edges) ----
    {
        raw: 137,
        label: 'DarkPlant137',
        category: MapObjectCategory.DarkGround,
        notes: 'dark-land:98%, 72 across 18 maps; was Desert',
    },
    {
        raw: 138,
        label: 'DarkPlant138',
        category: MapObjectCategory.DarkGround,
        notes: 'dark-land:100%, 74 across 17 maps; was Desert',
    },
    {
        raw: 139,
        label: 'DarkPlant139',
        category: MapObjectCategory.DarkGround,
        notes: 'dark-land:100%, 59 across 16 maps; was Desert',
    },
    {
        raw: 140,
        label: 'DarkPlant140',
        category: MapObjectCategory.DarkGround,
        notes: 'dark-land:100%, 60 across 17 maps; was Desert',
    },
    {
        raw: 141,
        label: 'DarkPlant141',
        category: MapObjectCategory.DarkGround,
        notes: 'dark-land:98%, 84 across 22 maps; was Desert',
    },
    {
        raw: 142,
        label: 'DarkPlant142',
        category: MapObjectCategory.DarkGround,
        notes: 'dark-land:100%, 36 across 9 maps; was Desert',
    },
    {
        raw: 143,
        label: 'DarkPlant143',
        category: MapObjectCategory.DarkGround,
        notes: 'dark-land:100%, 43 across 12 maps; was Desert',
    },
    {
        raw: 144,
        label: 'DarkPlant144',
        category: MapObjectCategory.DarkGround,
        notes: 'dark-land:98%, 69 across 17 maps; was Desert',
    },
    {
        raw: 145,
        label: 'DarkPlant145',
        category: MapObjectCategory.DarkGround,
        notes: 'dark-land:98%, 51 across 15 maps; was Desert',
    },
    {
        raw: 146,
        label: 'DarkPlant146',
        category: MapObjectCategory.DarkGround,
        notes: 'dark-land:100%, 70 across 15 maps; was Desert',
    },
    {
        raw: 147,
        label: 'DarkPlant147',
        category: MapObjectCategory.DarkGround,
        notes: 'dark-land:98%, 76 across 19 maps; was Desert',
    },
    {
        raw: 148,
        label: 'DarkPlant148',
        category: MapObjectCategory.DarkGround,
        notes: 'dark-land:98%, 57 across 16 maps; was Desert',
    },
    // ---- Grass plants: raw 149-150 ----
    {
        raw: 149,
        label: 'DarkPlant149',
        category: MapObjectCategory.DarkGround,
        notes: 'dark-land:98%, 295 across 22 maps; was Plants',
    },
    {
        raw: 150,
        label: 'DarkPlant150',
        category: MapObjectCategory.DarkGround,
        notes: 'dark-land:100%, 12 across 7 maps; was Plants',
    },
    // raw 151: not observed on any map
    // PlantsRare pool indices 5-11 (continuing from 87,90,91,92,116 = indices 0-4)
    {
        raw: 152,
        label: 'Ruin',
        category: MapObjectCategory.PlantsRare,
        notes: 'Uncommon (2k); pool→BUILDING_RUIN_ANIM',
        type: MapObjectType.Ruin,
    },
    {
        raw: 153,
        label: 'Plant153',
        category: MapObjectCategory.PlantsRare,
        notes: '373-map: 161 across 60 maps, Grass:89%, Rock:4%, avgH 41',
    },
    {
        raw: 154,
        label: 'RuneStone',
        category: MapObjectCategory.PlantsRare,
        notes: 'Rare (210); pool→STONE_STATUE',
        type: MapObjectType.RuneStone,
    },
    {
        raw: 155,
        label: 'GrassRare155',
        category: MapObjectCategory.PlantsRare,
        notes: 'Rare (187); pool→SMALL_ANIMAL — no clear XML match',
    },
    {
        raw: 156,
        label: 'Grave1',
        category: MapObjectCategory.PlantsRare,
        notes: 'Rare (180); pool→GRAVE_A',
        type: MapObjectType.Grave1,
    },
    {
        raw: 157,
        label: 'WaggonDestroyed',
        category: MapObjectCategory.PlantsRare,
        notes: 'Rare (185); pool→WAGON_WRECK',
        type: MapObjectType.WaggonDestroyed,
    },
    {
        raw: 158,
        label: 'PalmPlant',
        category: MapObjectCategory.PlantsRare,
        notes: 'Uncommon (1149); pool→VINE_GROUND_COVER',
        type: MapObjectType.PalmPlant,
    },
    {
        raw: 159,
        label: 'Mushroom1',
        category: MapObjectCategory.PlantsRare,
        notes: 'Rare (336); pool→AMANITA_MUSHROOM',
        type: MapObjectType.Mushroom1,
    },
    // ---- Grass plants: raw 160-162 (373-map scan) ----
    {
        raw: 160,
        label: 'Plant160',
        category: MapObjectCategory.Plants,
        notes: '373-map: 2548 across 70 maps, Grass:85%, Rock:14%',
    },
    {
        raw: 161,
        label: 'Plant161',
        category: MapObjectCategory.Plants,
        notes: '373-map: 1675 across 171 maps, Grass:96% — very widespread',
    },
    {
        raw: 162,
        label: 'Plant162',
        category: MapObjectCategory.Plants,
        notes: '373-map: 34 across 11 maps, Grass:97%, avgH 46',
    },

    // ---- River / lake: raw 163-168 ----
    { raw: 163, label: 'River163', category: MapObjectCategory.River, notes: 'Near rivers' },
    // Guessed: WaterLily1-3 for lake objects (XML: WATERLILY1-3, version=1).
    // 164 is the most abundant (242k), 167-168 at 85k each.
    {
        raw: 164,
        label: 'WaterLily1',
        category: MapObjectCategory.Lake,
        notes: 'On lakes (242k); guessed WaterLily1',
        type: MapObjectType.WaterLily1,
    },
    { raw: 165, label: 'River165', category: MapObjectCategory.River, notes: 'Near rivers' },
    { raw: 166, label: 'River166', category: MapObjectCategory.River, notes: 'Near rivers' },
    {
        raw: 167,
        label: 'WaterLily2',
        category: MapObjectCategory.Lake,
        notes: 'On lakes (85k); guessed WaterLily2',
        type: MapObjectType.WaterLily2,
    },
    {
        raw: 168,
        label: 'WaterLily3',
        category: MapObjectCategory.Lake,
        notes: 'On lakes (85k); guessed WaterLily3',
        type: MapObjectType.WaterLily3,
    },

    // ---- Beach: raw 169-177 ----
    // Guessed: Mussel1-2 for first two (XML: MUSSEL1-2, version=1). Rest unclear.
    {
        raw: 169,
        label: 'Mussel1',
        category: MapObjectCategory.Beach,
        notes: 'On beach; guessed Mussel1',
        type: MapObjectType.Mussel1,
    },
    {
        raw: 170,
        label: 'Mussel2',
        category: MapObjectCategory.Beach,
        notes: 'On beach; guessed Mussel2',
        type: MapObjectType.Mussel2,
    },
    { raw: 171, label: 'Beach171', category: MapObjectCategory.Beach, notes: 'On beach' },
    { raw: 172, label: 'Beach172', category: MapObjectCategory.Beach, notes: 'On beach' },
    { raw: 173, label: 'Beach173', category: MapObjectCategory.Beach, notes: 'On beach/shore (27k)' },
    { raw: 174, label: 'Beach174', category: MapObjectCategory.Beach, notes: 'On beach/shore (34k)' },
    { raw: 175, label: 'Beach175', category: MapObjectCategory.Beach, notes: 'On beach/shore (29k)' },
    { raw: 176, label: 'Beach176', category: MapObjectCategory.Beach, notes: 'On beach/shore (26k)' },
    { raw: 177, label: 'Beach177', category: MapObjectCategory.Beach, notes: 'On beach/shore (37k)' },

    // ---- Mountain edge / desert / grass / river: raw 178-188 ----
    { raw: 178, label: 'MountainEdge178', category: MapObjectCategory.Stone, notes: 'Near mountain edge (14k)' },
    { raw: 179, label: 'Desert179', category: MapObjectCategory.Desert, notes: 'On desert' },
    { raw: 180, label: 'Desert180', category: MapObjectCategory.Desert, notes: 'On desert' },
    { raw: 181, label: 'Grass181', category: MapObjectCategory.Plants, notes: 'On grass' },
    { raw: 182, label: 'MountainEdge182', category: MapObjectCategory.Stone, notes: 'On some mountain edges' },
    {
        raw: 183,
        label: 'MountainEdge183',
        category: MapObjectCategory.Stone,
        notes: 'On mountain edges, similar to 182',
    },
    { raw: 184, label: 'River184', category: MapObjectCategory.River, notes: 'Mostly near rivers' },
    { raw: 185, label: 'River185', category: MapObjectCategory.River, notes: 'Mostly near rivers' },
    { raw: 186, label: 'Grass186', category: MapObjectCategory.Plants, notes: 'On grass' },
    { raw: 187, label: 'Grass187', category: MapObjectCategory.Plants, notes: 'On grass near rivers' },
    { raw: 188, label: 'River188', category: MapObjectCategory.River, notes: 'Mostly near rivers' },
    // ---- Grass decorations: raw 189-192 (373-map scan: common, 80-85% grass) ----
    {
        raw: 189,
        label: 'Plant189',
        category: MapObjectCategory.Plants,
        notes: '373-map: 2210 across 130 maps, Grass:85%, Rock:8%, DarkGrass:8%',
    },
    {
        raw: 190,
        label: 'Plant190',
        category: MapObjectCategory.Plants,
        notes: '373-map: 2186 across 105 maps, Grass:80%, DarkGrass:13%',
    },
    {
        raw: 191,
        label: 'Plant191',
        category: MapObjectCategory.Plants,
        notes: '373-map: 4277 across 93 maps, Grass:85%, Rock:12% — very common',
    },
    {
        raw: 192,
        label: 'Plant192',
        category: MapObjectCategory.Plants,
        notes: '373-map: 311 across 76 maps, Grass:82%, Desert:9%, Rock:7%',
    },
    // raw 193-195: not observed on any map

    // ---- Magic byte trees: 0xc4-0xc6 / raw 196-198 (community / Siedler-Portal) ----
    // S4ModApi suggests raw 1-18 is the primary range; these are secondary values
    // found via community research. Kept for compatibility with maps that use them.
    {
        raw: 0xc4,
        label: 'Oak (magic)',
        category: MapObjectCategory.Trees,
        notes: 'Secondary value (Siedler-Portal)',
        type: MapObjectType.TreeOak,
    },
    {
        raw: 0xc5,
        label: 'Pine (magic)',
        category: MapObjectCategory.Trees,
        notes: 'Secondary value (Siedler-Portal)',
        type: MapObjectType.TreePine,
    },
    {
        raw: 0xc6,
        label: 'Coconut (magic)',
        category: MapObjectCategory.Trees,
        notes: 'Secondary value (Siedler-Portal); Palm → Coconut/Date',
        type: MapObjectType.TreeCoconut,
    },
    // raw 199-211: not observed on any map
    // ---- DarkGrass-affinity decorations: raw 212-214 (373-map scan: 13-24% DarkGrass) ----
    {
        raw: 212,
        label: 'DarkPlant212',
        category: MapObjectCategory.DarkGround,
        notes: '373-map: 859 across 28 maps, Grass:86%, DarkGrass:13%',
    },
    {
        raw: 213,
        label: 'DarkPlant213',
        category: MapObjectCategory.DarkGround,
        notes: '373-map: 383 across 20 maps, Grass:75%, DarkGrass:24%',
    },
    {
        raw: 214,
        label: 'DarkPlant214',
        category: MapObjectCategory.DarkGround,
        notes: '373-map: 528 across 20 maps, Grass:84%, DarkGrass:16%',
    },

    // ---- Snow: raw 215 ----
    // Snow pool has only 3 entries: SNOWMAN, SNOWMAN_B, DARK_STONE_BLOCK. Index 0 → SNOWMAN.
    {
        raw: 215,
        label: 'Snowman',
        category: MapObjectCategory.Snow,
        notes: 'On snow (718); pool→SNOWMAN',
        type: MapObjectType.Snowman,
    },
    // raw 216-217: not observed

    // ---- Desert rare: raw 218-219 ----
    // DesertRare pool: [SKELETON_LARGE, SKELETON_SMALL, WAGON_WRECK] — indices 1,2
    {
        raw: 218,
        label: 'SkeletonDesert2',
        category: MapObjectCategory.DesertRare,
        notes: 'On desert, rare; pool→SKELETON_SMALL',
        type: MapObjectType.SkeletonDesert2,
    },
    {
        raw: 219,
        label: 'WaggonDestroyed',
        category: MapObjectCategory.DesertRare,
        notes: 'On desert, rare; pool→WAGON_WRECK',
        type: MapObjectType.WaggonDestroyed,
    },
    {
        raw: 220,
        label: 'Plant220',
        category: MapObjectCategory.Plants,
        notes: '373-map: 316 across 58 maps, Grass:86%, Rock:6%',
    },

    // ---- Desert: raw 221-222 ----
    { raw: 221, label: 'Desert221', category: MapObjectCategory.Desert, notes: 'On desert (13k)' },
    { raw: 222, label: 'Desert222', category: MapObjectCategory.Desert, notes: 'On desert (7.6k)' },
    // raw 223-229: not observed on any map
    // ---- Grass/landscape decorations: raw 230-244 (373-map scan) ----
    {
        raw: 230,
        label: 'Plant230',
        category: MapObjectCategory.Plants,
        notes: '373-map: 4732 across 48 maps, Grass:93%, Rock:7% — very common',
    },
    {
        raw: 231,
        label: 'Plant231',
        category: MapObjectCategory.Plants,
        notes: '373-map: 541 across 103 maps, Grass:89%, DarkGrass:6%',
    },
    {
        raw: 232,
        label: 'StoneEdge232',
        category: MapObjectCategory.Stone,
        notes: '373-map: 298 across 16 maps, Grass:57%, Rock:42% — rock-edge decoration',
    },
    {
        raw: 233,
        label: 'DarkPlant233',
        category: MapObjectCategory.DarkGround,
        notes: 'dark-land:98%, 238 across 39 maps; was Plants',
    },
    {
        raw: 234,
        label: 'DarkPlant234',
        category: MapObjectCategory.DarkGround,
        notes: 'dark-land:99%, 148 across 26 maps; was Plants',
    },
    {
        raw: 235,
        label: 'DarkPlant235',
        category: MapObjectCategory.DarkGround,
        notes: 'dark-land:99%, 145 across 30 maps; was Plants',
    },
    {
        raw: 236,
        label: 'DarkPlant236',
        category: MapObjectCategory.DarkGround,
        notes: 'dark-land:99%, 154 across 32 maps; was Plants',
    },
    {
        raw: 237,
        label: 'DarkPlant237',
        category: MapObjectCategory.DarkGround,
        notes: 'dark-land:96%, 165 across 36 maps; was Plants',
    },
    {
        raw: 238,
        label: 'DarkPlant238',
        category: MapObjectCategory.DarkGround,
        notes: 'dark-land:100%, 71 across 23 maps; was Plants',
    },
    {
        raw: 239,
        label: 'DarkPlant239',
        category: MapObjectCategory.DarkGround,
        notes: 'dark-land:100%, 126 across 28 maps; was Plants',
    },
    {
        raw: 240,
        label: 'DarkPlant240',
        category: MapObjectCategory.DarkGround,
        notes: 'dark-land:97%, 141 across 29 maps; was Plants',
    },
    {
        raw: 241,
        label: 'DarkPlant241',
        category: MapObjectCategory.DarkGround,
        notes: 'dark-land:98%, 182 across 33 maps; was Plants',
    },
    {
        raw: 242,
        label: 'DarkPlant242',
        category: MapObjectCategory.DarkGround,
        notes: 'dark-land:100%, 78 across 13 maps; was Plants',
    },
    {
        raw: 243,
        label: 'DarkPlant243',
        category: MapObjectCategory.DarkGround,
        notes: 'dark-land:97%, 79 across 29 maps; was Plants',
    },
    {
        raw: 244,
        label: 'DarkPlant244',
        category: MapObjectCategory.DarkGround,
        notes: 'dark-land:98%, 317 across 31 maps; was Plants',
    },

    // ---- Dark ground: raw 245, 254 ----
    // DarkGround pool: [DARK_TRIBE_TREE_A, DARK_TRIBE_TREE_B, ...] — dark tribe vegetation
    {
        raw: 245,
        label: 'DarkBush1',
        category: MapObjectCategory.DarkGround,
        notes: 'On dark/swamp terrain; pool→DARK_TRIBE_TREE_A',
        type: MapObjectType.DarkBush1,
    },
    // ---- Mixed landscape: raw 246-252 (373-map scan: grass/desert/dark mixes) ----
    {
        raw: 246,
        label: 'DarkPlant246',
        category: MapObjectCategory.DarkGround,
        notes: 'dark-land:88%, 125 across 33 maps; was Plants',
    },
    {
        raw: 247,
        label: 'DarkPlant247',
        category: MapObjectCategory.DarkGround,
        notes: 'dark-land:97%, 137 across 35 maps; was Plants',
    },
    {
        raw: 248,
        label: 'DarkPlant248',
        category: MapObjectCategory.DarkGround,
        notes: 'dark-land:88%, 162 across 37 maps; was Plants',
    },
    {
        raw: 249,
        label: 'DarkPlant249',
        category: MapObjectCategory.DarkGround,
        notes: 'dark-land:94%, 459 across 32 maps; was Plants',
    },
    {
        raw: 250,
        label: 'DarkPlant250',
        category: MapObjectCategory.DarkGround,
        notes: '373-map: 177 across 35 maps, Grass:71%, DarkGrass:19%, Desert:9%',
    },
    {
        raw: 251,
        label: 'DarkPlant251',
        category: MapObjectCategory.DarkGround,
        notes: 'dark-land:97%, 289 across 33 maps; was Plants',
    },
    {
        raw: 252,
        label: 'DarkPlant252',
        category: MapObjectCategory.DarkGround,
        notes: 'dark-land:97%, 89 across 27 maps; was Plants',
    },
    // raw 253: not observed on any map
    {
        raw: 254,
        label: 'DarkBush2',
        category: MapObjectCategory.DarkGround,
        notes: 'On dark/swamp terrain; pool→DARK_TRIBE_TREE_B',
        type: MapObjectType.DarkBush2,
    },
];

// ============================================================
// Lookup map (built once from the registry)
// ============================================================

const RAW_OBJECT_MAP: ReadonlyMap<number, RawObjectEntry> = new Map(RAW_OBJECT_REGISTRY.map(e => [e.raw, e]));

/** Look up a raw byte value in the registry. Returns the entry or undefined if unknown. */
export function lookupRawObject(raw: number): RawObjectEntry | undefined {
    return RAW_OBJECT_MAP.get(raw);
}
