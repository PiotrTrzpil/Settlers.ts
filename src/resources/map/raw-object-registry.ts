/**
 * Central registry mapping raw map byte values (MapObjects chunk, type 6)
 * to our internal types.
 *
 * Data is stored as a compact typed array, with O(1) lookups by raw byte value.
 * Entries are sorted by raw byte value. Gaps (unobserved bytes) are omitted —
 * the lookup table fills those slots with null.
 */

import { MapObjectCategory, MapObjectType } from '@/game/types/map-object-types';

// ============================================================
// Data types
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
    /** Blocks movement on the object's tile. For typed objects this comes from objectInfo.xml instead. */
    blocking?: boolean;
}

// ============================================================
// Registry data (compact one-entry-per-line format)
// ============================================================

// prettier-ignore
export const RAW_OBJECT_REGISTRY: readonly RawObjectEntry[] = [
    // ---- Trees: raw 1-18 (S4ModApi S4_TREE_ENUM, verified) ----
    { raw: 1, label: 'Oak', category: MapObjectCategory.Trees, notes: 'S4TreeType.OAK', type: MapObjectType.TreeOak },
    { raw: 2, label: 'Beech', category: MapObjectCategory.Trees, notes: 'S4TreeType.BEECH', type: MapObjectType.TreeBeech },
    { raw: 3, label: 'Ash', category: MapObjectCategory.Trees, notes: 'S4TreeType.ASH', type: MapObjectType.TreeAsh },
    { raw: 4, label: 'Linden', category: MapObjectCategory.Trees, notes: 'S4TreeType.LINDEN', type: MapObjectType.TreeLinden },
    { raw: 5, label: 'Birch', category: MapObjectCategory.Trees, notes: 'S4TreeType.BIRCH', type: MapObjectType.TreeBirch },
    { raw: 6, label: 'Poplar', category: MapObjectCategory.Trees, notes: 'S4TreeType.POPLAR', type: MapObjectType.TreePoplar },
    { raw: 7, label: 'Chestnut', category: MapObjectCategory.Trees, notes: 'S4TreeType.CHESTNUT', type: MapObjectType.TreeChestnut },
    { raw: 8, label: 'Maple', category: MapObjectCategory.Trees, notes: 'S4TreeType.MAPLE', type: MapObjectType.TreeMaple },
    { raw: 9, label: 'Fir', category: MapObjectCategory.Trees, notes: 'S4TreeType.FIR', type: MapObjectType.TreeFir },
    { raw: 10, label: 'Spruce', category: MapObjectCategory.Trees, notes: 'S4TreeType.SPRUCE', type: MapObjectType.TreeSpruce },
    { raw: 11, label: 'Coconut', category: MapObjectCategory.Trees, notes: 'S4TreeType.COCONUT (palm)', type: MapObjectType.TreeCoconut },
    { raw: 12, label: 'Date', category: MapObjectCategory.Trees, notes: 'S4TreeType.DATE (palm)', type: MapObjectType.TreeDate },
    { raw: 13, label: 'Walnut', category: MapObjectCategory.Trees, notes: 'S4TreeType.WALNUT', type: MapObjectType.TreeWalnut },
    { raw: 14, label: 'CorkOak', category: MapObjectCategory.Trees, notes: 'S4TreeType.CORKOAK', type: MapObjectType.TreeCorkOak },
    { raw: 15, label: 'Pine', category: MapObjectCategory.Trees, notes: 'S4TreeType.PINE', type: MapObjectType.TreePine },
    { raw: 16, label: 'Pine2', category: MapObjectCategory.Trees, notes: 'S4TreeType.PINE2', type: MapObjectType.TreePine2 },
    { raw: 17, label: 'OliveLarge', category: MapObjectCategory.Trees, notes: 'S4TreeType.OLIVE_LARGE', type: MapObjectType.TreeOliveLarge },
    { raw: 18, label: 'OliveSmall', category: MapObjectCategory.Trees, notes: 'S4TreeType.OLIVE_SMALL', type: MapObjectType.TreeOliveSmall },

    // ---- Landscape plants: raw 19-22 (common, 0% dark) ----
    { raw: 19, label: 'Bush1', category: MapObjectCategory.Plants, notes: 'Common (15k); guessed Bush1', type: MapObjectType.Bush1 },
    { raw: 20, label: 'Bush2', category: MapObjectCategory.Plants, notes: 'Common (14k); guessed Bush2', type: MapObjectType.Bush2 },
    { raw: 21, label: 'Bush3', category: MapObjectCategory.Plants, notes: 'Common (12k); guessed Bush3', type: MapObjectType.Bush3 },
    { raw: 22, label: 'Bush4', category: MapObjectCategory.Plants, notes: 'Common (12k); guessed Bush4', type: MapObjectType.Bush4 },
    // ---- Dark Tribe trees: raw 23-29, 31 (96-98% dark, most common dark objects) ----
    // 9 raw bytes: 6 animated sway types (23-28) + 2 static (29 pine, 30 palm) + 1 shared (31).
    { raw: 23, label: 'DarkTree1A', category: MapObjectCategory.Trees, notes: '96% dark, 2652 total; guessed DarkTree1A', type: MapObjectType.DarkTree1A },
    { raw: 24, label: 'DarkTree1B', category: MapObjectCategory.Trees, notes: '96% dark, 2062 total; guessed DarkTree1B', type: MapObjectType.DarkTree1B },
    { raw: 25, label: 'DarkTree2A', category: MapObjectCategory.Trees, notes: '97% dark, 1802 total; guessed DarkTree2A', type: MapObjectType.DarkTree2A },
    { raw: 26, label: 'DarkTree2B', category: MapObjectCategory.Trees, notes: '97% dark, 1674 total; guessed DarkTree2B', type: MapObjectType.DarkTree2B },
    { raw: 27, label: 'DarkTree3A', category: MapObjectCategory.Trees, notes: '98% dark, 1868 total; guessed DarkTree3A', type: MapObjectType.DarkTree3A },
    { raw: 28, label: 'DarkTree3B', category: MapObjectCategory.Trees, notes: '97% dark, 1868 total; guessed DarkTree3B', type: MapObjectType.DarkTree3B },
    { raw: 29, label: 'DarkTree4A', category: MapObjectCategory.Trees, notes: '97% dark, 3063 total; dark pine (static)', type: MapObjectType.DarkTree4A },
    { raw: 30, label: 'DarkTree4B', category: MapObjectCategory.Trees, notes: 'dark palm (static)', type: MapObjectType.DarkTree4B },
    { raw: 31, label: 'DarkTree5A', category: MapObjectCategory.Trees, notes: '98% dark, 857 total; shares dark pine sprite', type: MapObjectType.DarkTree5A },
    // raw 32-42: not observed on any map

    // ---- River: raw 43 ----
    // Guessed: Reed1 (river-edge plant). XML: REED1-3 are blocking=0, version=1.
    { raw: 43, label: 'Reed1', category: MapObjectCategory.River, notes: 'Near rivers; guessed Reed1', type: MapObjectType.Reed1 },

    // ---- Common grass: raw 44-49 (~35k each across maps) ----
    // Guessed: Grass1-6 (XML has GRASS1-10, first 6 match the 6 common raw values)
    { raw: 44, label: 'Grass1', category: MapObjectCategory.Plants, notes: 'On grass (~35k); guessed Grass1', type: MapObjectType.Grass1 },
    { raw: 45, label: 'Grass2', category: MapObjectCategory.Plants, notes: 'On grass (~35k); guessed Grass2', type: MapObjectType.Grass2 },
    { raw: 46, label: 'Grass3', category: MapObjectCategory.Plants, notes: 'On grass (~35k); guessed Grass3', type: MapObjectType.Grass3 },
    { raw: 47, label: 'Grass4', category: MapObjectCategory.Plants, notes: 'On grass (~35k); guessed Grass4', type: MapObjectType.Grass4 },
    { raw: 48, label: 'Grass5', category: MapObjectCategory.Plants, notes: 'On grass (~35k); guessed Grass5', type: MapObjectType.Grass5 },
    { raw: 49, label: 'Grass6', category: MapObjectCategory.Plants, notes: 'On grass (~35k); guessed Grass6', type: MapObjectType.Grass6 },

    // ---- Desert / shore: raw 50-55 ----
    // Guessed: DesertBush1-3 for 50-52 (non-blocking desert plants), Cactus1 for 53.
    // Cactus in XML is blocking=1 — but raw 53 is in non-blocking Desert category, so maybe DesertBush instead.
    { raw: 50, label: 'DesertBush1', category: MapObjectCategory.Desert, notes: 'On desert; guessed DesertBush1', type: MapObjectType.DesertBush1 },
    { raw: 51, label: 'DesertBush2', category: MapObjectCategory.Desert, notes: 'On desert (possibly); guessed DesertBush2', type: MapObjectType.DesertBush2 },
    { raw: 52, label: 'DesertBush3', category: MapObjectCategory.Desert, notes: 'On desert; guessed DesertBush3', type: MapObjectType.DesertBush3 },
    // Pool index 0 → CACTUS sprite; confident mapping
    { raw: 53, label: 'Cactus1', category: MapObjectCategory.Desert, notes: 'On desert; pool→CACTUS sprite', type: MapObjectType.Cactus1 },
    // DesertRare pool index 0 → SKELETONDESERT1
    { raw: 54, label: 'SkeletonDesert1', category: MapObjectCategory.DesertRare, notes: 'Near desert, very rare; pool→SKELETONDESERT1', type: MapObjectType.SkeletonDesert1 },
    { raw: 55, label: 'Shore55', category: MapObjectCategory.Sea, notes: 'Near sea / on sea near shore, rare — possibly map data bug' },

    // ---- Mountain / stone: raw 56-75 ----
    { raw: 56, label: 'MountainEdge56', category: MapObjectCategory.Stone, notes: 'Near mountain edge', blocking: true },
    { raw: 57, label: 'Mountain57', category: MapObjectCategory.Stone, notes: 'On mountain', blocking: true },
    { raw: 58, label: 'Mountain58', category: MapObjectCategory.Stone, notes: 'On mountain (inferred from 57)', blocking: true },
    // 59-75: Mountain edge decorations — rocks/rubble near mountain-grass transitions
    { raw: 59, label: 'MountainEdge59', category: MapObjectCategory.Stone, notes: 'Near mountain edges, mostly on mountain but some on grass', blocking: true },
    { raw: 60, label: 'MountainEdge60', category: MapObjectCategory.Stone, notes: 'Near mountain edges', blocking: true },
    { raw: 61, label: 'MountainEdge61', category: MapObjectCategory.Stone, notes: 'Near mountain edges', blocking: true },
    { raw: 62, label: 'MountainEdge62', category: MapObjectCategory.Stone, notes: 'Near mountain edges', blocking: true },
    { raw: 63, label: 'MountainEdge63', category: MapObjectCategory.Stone, notes: 'Near mountain edges', blocking: true },
    { raw: 64, label: 'MountainEdge64', category: MapObjectCategory.Stone, notes: 'Near mountain edges', blocking: true },
    { raw: 65, label: 'MountainEdge65', category: MapObjectCategory.Stone, notes: 'Near mountain edges', blocking: true },
    { raw: 66, label: 'MountainEdge66', category: MapObjectCategory.Stone, notes: 'Near mountain edges', blocking: true },
    { raw: 67, label: 'MountainEdge67', category: MapObjectCategory.Stone, notes: 'Near mountain edges', blocking: true },
    { raw: 68, label: 'MountainEdge68', category: MapObjectCategory.Stone, notes: 'Near mountain edges', blocking: true },
    { raw: 69, label: 'MountainEdge69', category: MapObjectCategory.Stone, notes: 'Near mountain edges', blocking: true },
    { raw: 70, label: 'MountainEdge70', category: MapObjectCategory.Stone, notes: 'Near mountain edges', blocking: true },
    { raw: 71, label: 'MountainEdge71', category: MapObjectCategory.Stone, notes: 'Near mountain edges', blocking: true },
    { raw: 72, label: 'MountainEdge72', category: MapObjectCategory.Stone, notes: 'Near mountain edges', blocking: true },
    { raw: 73, label: 'MountainEdge73', category: MapObjectCategory.Stone, notes: 'Near mountain edges', blocking: true },
    { raw: 74, label: 'MountainEdge74', category: MapObjectCategory.Stone, notes: 'Near mountain edges', blocking: true },
    { raw: 75, label: 'MountainEdge75', category: MapObjectCategory.Stone, notes: 'Near mountain edges', blocking: true },

    // ---- Grass / river: raw 76-85 ----
    // 76 is extremely common (201k) — could be Grass7 or a generic ground fill
    { raw: 76, label: 'Grass7', category: MapObjectCategory.Plants, notes: 'On grass (201k); guessed Grass7', type: MapObjectType.Grass7 },
    // 77-78, 83-84 are river-adjacent — guessed Reed2-3, then remaining river decorations
    { raw: 77, label: 'Reed2', category: MapObjectCategory.River, notes: 'Near rivers; guessed Reed2', type: MapObjectType.Reed2 },
    { raw: 78, label: 'Reed3', category: MapObjectCategory.River, notes: 'Near rivers; guessed Reed3', type: MapObjectType.Reed3 },
    { raw: 79, label: 'Grass79', category: MapObjectCategory.Plants, notes: 'On grass near rivers' },
    { raw: 80, label: 'Grass80', category: MapObjectCategory.Plants, notes: 'On grass near rivers' },
    { raw: 81, label: 'Grass8', category: MapObjectCategory.Plants, notes: 'On grass; guessed Grass8', type: MapObjectType.Grass8 },
    { raw: 82, label: 'Grass9', category: MapObjectCategory.Plants, notes: 'On grass; guessed Grass9', type: MapObjectType.Grass9 },
    { raw: 83, label: 'Flower3', category: MapObjectCategory.Plants, notes: '120k total; 88% Grass — guessed Flower3', type: MapObjectType.Flower3 },
    { raw: 84, label: 'Flower4', category: MapObjectCategory.Plants, notes: '122k total; 87% Grass — guessed Flower4', type: MapObjectType.Flower4 },
    { raw: 85, label: 'Grass10', category: MapObjectCategory.Plants, notes: 'On grass (124k); guessed Grass10', type: MapObjectType.Grass10 },
    // raw 86: absent from all maps

    // ---- Rare grass: raw 87, 90-92 ----
    // PlantsRare pool cycling: [87,90,91,92,116,152,154,155,156,157,158,159]
    // Pool: MUSHROOMCYCLE, SCARECROW, ROMAN_COLUMN_OVERGROWN_A, BROKEN_PILLAR_A, ANCIENT_COLUMN, ...
    { raw: 87, label: 'Well', category: MapObjectCategory.PlantsRare, notes: 'Uncommon (672)', type: MapObjectType.Well },
    // raw 88: not observed on any map
    { raw: 89, label: 'Plant89', category: MapObjectCategory.Plants, notes: '373-map: 172 across 43 maps, Grass:90%, DarkGrass:9%, avgH 25' },
    { raw: 90, label: 'Scarecrow', category: MapObjectCategory.PlantsRare, notes: 'Rare; pool→SCARECROW', type: MapObjectType.Scarecrow },
    { raw: 91, label: 'ColumnRuinsA1', category: MapObjectCategory.PlantsRare, notes: 'Rare; pool→ROMAN_COLUMN_OVERGROWN_A', type: MapObjectType.ColumnRuinsA1 },
    { raw: 92, label: 'ColumnRuinsA2', category: MapObjectCategory.PlantsRare, notes: 'Rare; pool→BROKEN_PILLAR_A', type: MapObjectType.ColumnRuinsA2 },

    // ---- Grass plants: raw 93-106 (373-map scan: all >85% grass, rare-uncommon) ----
    { raw: 93, label: 'MushroomDark1', category: MapObjectCategory.DarkGround, notes: 'dark:93%, 532 across 44 maps; near water/dark — guessed MushroomDark1', type: MapObjectType.MushroomDark1 },
    // raw 94-98: not observed on any map
    { raw: 99, label: 'MushroomDark2', category: MapObjectCategory.DarkGround, notes: 'dark:95%, 465 across 40 maps; neighbors: 93,100 — guessed MushroomDark2', type: MapObjectType.MushroomDark2 },
    { raw: 100, label: 'MushroomDark3', category: MapObjectCategory.DarkGround, notes: 'dark:95%, 402 across 44 maps; neighbors: 93,99 — guessed MushroomDark3', type: MapObjectType.MushroomDark3 },
    { raw: 101, label: 'DarkPlant101', category: MapObjectCategory.DarkGround, notes: 'dark-land:91%, 156 across 38 maps; was Plants' },
    // raw 102: not observed on any map
    { raw: 103, label: 'Plant103', category: MapObjectCategory.Plants, notes: '373-map: 697 across 57 maps, Grass:89%, Rock:6%' },
    { raw: 104, label: 'DarkPlant104', category: MapObjectCategory.DarkGround, notes: 'dark-land:97%, 877 across 49 maps; was Plants' },
    { raw: 105, label: 'DarkPlant105', category: MapObjectCategory.DarkGround, notes: 'dark-land:98%, 829 across 50 maps; was Plants' },
    { raw: 106, label: 'DarkPlant106', category: MapObjectCategory.DarkGround, notes: 'dark-land:98%, 759 across 50 maps; was Plants' },

    // ---- Sea: raw 107-110, 119 ----
    // Guessed: Seaweed1-3 for 107-109 (XML: SEEWEED1-3, version=2), Wave for 110
    { raw: 107, label: 'Seaweed1', category: MapObjectCategory.Sea, notes: 'On sea; guessed Seaweed1', type: MapObjectType.Seaweed1 },
    { raw: 108, label: 'Seaweed2', category: MapObjectCategory.Sea, notes: 'On sea; guessed Seaweed2', type: MapObjectType.Seaweed2 },
    { raw: 109, label: 'Seaweed3', category: MapObjectCategory.Sea, notes: 'On sea; guessed Seaweed3', type: MapObjectType.Seaweed3 },
    { raw: 110, label: 'Wave', category: MapObjectCategory.Sea, notes: 'On sea; guessed Wave', type: MapObjectType.Wave },

    // ---- Grass plants: raw 111-114 (373-map scan: all >90% grass) ----
    { raw: 111, label: 'DarkBush3', category: MapObjectCategory.DarkGround, notes: 'dark:96%, 1879 across 49 maps; most common dark — guessed DarkBush3', type: MapObjectType.DarkBush3 },
    { raw: 112, label: 'DarkBush4', category: MapObjectCategory.DarkGround, notes: 'dark:96%, 1100 across 47 maps; second most common dark — guessed DarkBush4', type: MapObjectType.DarkBush4 },
    { raw: 113, label: 'DarkPlant113', category: MapObjectCategory.DarkGround, notes: 'dark-land:94%, 917 across 45 maps; was Plants' },
    { raw: 114, label: 'DarkPlant114', category: MapObjectCategory.DarkGround, notes: 'dark-land:94%, 617 across 46 maps; was Plants' },
    // raw 115: not observed on any map

    // ---- Rare grass: raw 116 ----
    // PlantsRare pool index 4 → ANCIENT_COLUMN
    { raw: 116, label: 'CelticCross', category: MapObjectCategory.PlantsRare, notes: 'Rare; pool→ANCIENT_COLUMN', type: MapObjectType.CelticCross },
    // raw 117-118: not observed

    // ---- Sea: raw 119 ----
    { raw: 119, label: 'Unknown119', category: MapObjectCategory.Unknown, notes: 'NOT OBSERVED on any of 373 maps' },

    // ---- Desert edge: raw 120-122 ----
    // Desert pool indices 1-3 → DESERT_CACTUS_LARGE/MEDIUM/SMALL
    { raw: 120, label: 'Cactus2', category: MapObjectCategory.Desert, notes: 'On desert edge; pool→DESERT_CACTUS_LARGE', type: MapObjectType.Cactus2 },
    { raw: 121, label: 'Cactus3', category: MapObjectCategory.Desert, notes: 'On desert edge; pool→DESERT_CACTUS_MEDIUM', type: MapObjectType.Cactus3 },
    { raw: 122, label: 'Cactus4', category: MapObjectCategory.Desert, notes: 'On desert; pool→DESERT_CACTUS_SMALL', type: MapObjectType.Cactus4 },
    { raw: 123, label: 'Plant123', category: MapObjectCategory.Plants, notes: '373-map: 105 across 8 maps, Grass:100%' },

    // ---- Harvestable stone: raw 124-135 ----
    // 12 depletion levels: 124 = nearly depleted, 135 = full.
    // Each raw byte is its own MapObjectType (ResourceStone1-12). No type/variation conversion.
    { raw: 124, label: 'ResourceStone1', category: MapObjectCategory.HarvestableStone, notes: 'Level 1 of 12 (nearly depleted)', type: MapObjectType.ResourceStone1 },
    { raw: 125, label: 'ResourceStone2', category: MapObjectCategory.HarvestableStone, notes: 'Level 2 of 12', type: MapObjectType.ResourceStone2 },
    { raw: 126, label: 'ResourceStone3', category: MapObjectCategory.HarvestableStone, notes: 'Level 3 of 12', type: MapObjectType.ResourceStone3 },
    { raw: 127, label: 'ResourceStone4', category: MapObjectCategory.HarvestableStone, notes: 'Level 4 of 12', type: MapObjectType.ResourceStone4 },
    { raw: 128, label: 'ResourceStone5', category: MapObjectCategory.HarvestableStone, notes: 'Level 5 of 12', type: MapObjectType.ResourceStone5 },
    { raw: 129, label: 'ResourceStone6', category: MapObjectCategory.HarvestableStone, notes: 'Level 6 of 12', type: MapObjectType.ResourceStone6 },
    { raw: 130, label: 'ResourceStone7', category: MapObjectCategory.HarvestableStone, notes: 'Level 7 of 12', type: MapObjectType.ResourceStone7 },
    { raw: 131, label: 'ResourceStone8', category: MapObjectCategory.HarvestableStone, notes: 'Level 8 of 12', type: MapObjectType.ResourceStone8 },
    { raw: 132, label: 'ResourceStone9', category: MapObjectCategory.HarvestableStone, notes: 'Level 9 of 12', type: MapObjectType.ResourceStone9 },
    { raw: 133, label: 'ResourceStone10', category: MapObjectCategory.HarvestableStone, notes: 'Level 10 of 12', type: MapObjectType.ResourceStone10 },
    { raw: 134, label: 'ResourceStone11', category: MapObjectCategory.HarvestableStone, notes: 'Level 11 of 12', type: MapObjectType.ResourceStone11 },
    { raw: 135, label: 'ResourceStone12', category: MapObjectCategory.HarvestableStone, notes: 'Level 12 of 12 (full)', type: MapObjectType.ResourceStone12 },

    // ---- Stone / rare grass: raw 136-159 ----
    { raw: 136, label: 'StoneEdge136', category: MapObjectCategory.Stone, notes: 'Near harvestable stones (22k)', blocking: true },

    // ---- Desert transition: raw 137-148 (373-map scan: 40-70% desert, grass/desert edges) ----
    { raw: 137, label: 'DarkPlant137', category: MapObjectCategory.DarkGround, notes: 'dark-land:98%, 72 across 18 maps; was Desert' },
    { raw: 138, label: 'DarkPlant138', category: MapObjectCategory.DarkGround, notes: 'dark-land:100%, 74 across 17 maps; was Desert' },
    { raw: 139, label: 'DarkPlant139', category: MapObjectCategory.DarkGround, notes: 'dark-land:100%, 59 across 16 maps; was Desert' },
    { raw: 140, label: 'DarkPlant140', category: MapObjectCategory.DarkGround, notes: 'dark-land:100%, 60 across 17 maps; was Desert' },
    { raw: 141, label: 'DarkPlant141', category: MapObjectCategory.DarkGround, notes: 'dark-land:98%, 84 across 22 maps; was Desert' },
    { raw: 142, label: 'DarkPlant142', category: MapObjectCategory.DarkGround, notes: 'dark-land:100%, 36 across 9 maps; was Desert' },
    { raw: 143, label: 'DarkPlant143', category: MapObjectCategory.DarkGround, notes: 'dark-land:100%, 43 across 12 maps; was Desert' },
    { raw: 144, label: 'DarkPlant144', category: MapObjectCategory.DarkGround, notes: 'dark-land:98%, 69 across 17 maps; was Desert' },
    { raw: 145, label: 'DarkPlant145', category: MapObjectCategory.DarkGround, notes: 'dark-land:98%, 51 across 15 maps; was Desert' },
    { raw: 146, label: 'DarkPlant146', category: MapObjectCategory.DarkGround, notes: 'dark-land:100%, 70 across 15 maps; was Desert' },
    { raw: 147, label: 'DarkPlant147', category: MapObjectCategory.DarkGround, notes: 'dark-land:98%, 76 across 19 maps; was Desert' },
    { raw: 148, label: 'DarkPlant148', category: MapObjectCategory.DarkGround, notes: 'dark-land:98%, 57 across 16 maps; was Desert' },

    // ---- Grass plants: raw 149-150 ----
    { raw: 149, label: 'DarkPlant149', category: MapObjectCategory.DarkGround, notes: 'dark-land:98%, 295 across 22 maps; was Plants' },
    { raw: 150, label: 'DarkPond', category: MapObjectCategory.DarkGround, notes: 'dark:100%, only 12 across 7 maps — very rare, guessed DarkPond', type: MapObjectType.DarkPond },
    // raw 151: not observed on any map
    // PlantsRare pool indices 5-11 (continuing from 87,90,91,92,116 = indices 0-4)
    { raw: 152, label: 'Ruin', category: MapObjectCategory.PlantsRare, notes: 'Uncommon (2k); pool→RUIN1', type: MapObjectType.Ruin },
    { raw: 153, label: 'Plant153', category: MapObjectCategory.PlantsRare, notes: '373-map: 161 across 60 maps, Grass:89%, Rock:4%, avgH 41' },
    { raw: 154, label: 'RuneStone', category: MapObjectCategory.PlantsRare, notes: 'Rare (210); pool→STONE_STATUE', type: MapObjectType.RuneStone },
    { raw: 155, label: 'GrassRare155', category: MapObjectCategory.PlantsRare, notes: 'Rare (187); pool→SMALL_ANIMAL — no clear XML match' },
    { raw: 156, label: 'Grave1', category: MapObjectCategory.PlantsRare, notes: 'Rare (180); pool→GRAVE_A', type: MapObjectType.Grave1 },
    { raw: 157, label: 'WaggonDestroyed', category: MapObjectCategory.PlantsRare, notes: 'Rare (185); pool→WAGGONDESTR', type: MapObjectType.WaggonDestroyed },
    { raw: 158, label: 'PalmPlant', category: MapObjectCategory.PlantsRare, notes: 'Uncommon (1149); pool→VINE_GROUND_COVER', type: MapObjectType.PalmPlant },
    { raw: 159, label: 'Mushroom1', category: MapObjectCategory.PlantsRare, notes: 'Rare (336)', type: MapObjectType.Mushroom1 },

    // ---- Grass plants: raw 160-162 (373-map scan) ----
    { raw: 160, label: 'Plant160', category: MapObjectCategory.Plants, notes: '373-map: 2548 across 70 maps, Grass:85%, Rock:14%' },
    { raw: 161, label: 'Plant161', category: MapObjectCategory.Plants, notes: '373-map: 1675 across 171 maps, Grass:96% — very widespread' },
    { raw: 162, label: 'Plant162', category: MapObjectCategory.Plants, notes: '373-map: 34 across 11 maps, Grass:97%, avgH 46' },

    // ---- River / lake: raw 163-168 ----
    { raw: 163, label: 'River163', category: MapObjectCategory.River, notes: 'Near rivers' },
    // 163-165: sea-shore decorations (88% near sea, 4% near river). Not water lilies.
    { raw: 164, label: 'Shore164', category: MapObjectCategory.Beach, notes: '242k; 82% near sea — sea-shore decoration, not a lily' },
    { raw: 165, label: 'Shore165', category: MapObjectCategory.Beach, notes: '164k; 88% near sea — sea-shore decoration' },
    // 166-168: freshwater/mixed (25% near river, 10% near pond) — guessed WaterLily1-3
    { raw: 166, label: 'WaterLily1', category: MapObjectCategory.Lake, notes: '79k; 26% river, 10% pond — guessed WaterLily1', type: MapObjectType.WaterLily1 },
    { raw: 167, label: 'WaterLily2', category: MapObjectCategory.Lake, notes: '86k; 25% river, 10% pond — guessed WaterLily2', type: MapObjectType.WaterLily2 },
    { raw: 168, label: 'WaterLily3', category: MapObjectCategory.Lake, notes: '85k; 26% river, 10% pond — guessed WaterLily3', type: MapObjectType.WaterLily3 },

    // ---- Beach: raw 169-177 ----
    // Guessed: Mussel1-2 for first two (XML: MUSSEL1-2, version=1). Rest unclear.
    { raw: 169, label: 'Mussel1', category: MapObjectCategory.Beach, notes: 'On beach; guessed Mussel1', type: MapObjectType.Mussel1 },
    { raw: 170, label: 'Mussel2', category: MapObjectCategory.Beach, notes: 'On beach; guessed Mussel2', type: MapObjectType.Mussel2 },
    { raw: 171, label: 'Beach171', category: MapObjectCategory.Beach, notes: 'On beach' },
    { raw: 172, label: 'Beach172', category: MapObjectCategory.Beach, notes: 'On beach' },
    { raw: 173, label: 'Beach173', category: MapObjectCategory.Beach, notes: 'On beach/shore (27k)' },
    { raw: 174, label: 'Beach174', category: MapObjectCategory.Beach, notes: 'On beach/shore (34k)' },
    { raw: 175, label: 'Beach175', category: MapObjectCategory.Beach, notes: 'On beach/shore (29k)' },
    { raw: 176, label: 'Beach176', category: MapObjectCategory.Beach, notes: 'On beach/shore (26k)' },
    { raw: 177, label: 'Beach177', category: MapObjectCategory.Beach, notes: 'On beach/shore (37k)' },

    // ---- Mountain edge / desert / grass / river: raw 178-188 ----
    { raw: 178, label: 'MountainEdge178', category: MapObjectCategory.Stone, notes: 'Near mountain edge (14k)', blocking: true },
    { raw: 179, label: 'Desert179', category: MapObjectCategory.Desert, notes: 'On desert' },
    { raw: 180, label: 'Desert180', category: MapObjectCategory.Desert, notes: 'On desert' },
    { raw: 181, label: 'Mushroom1', category: MapObjectCategory.PlantsRare, notes: 'On grass; same as raw 159', type: MapObjectType.Mushroom1 },
    { raw: 182, label: 'Mushroom2', category: MapObjectCategory.PlantsRare, notes: 'On grass', type: MapObjectType.Mushroom2 },
    { raw: 183, label: 'MountainEdge183', category: MapObjectCategory.Stone, notes: 'On mountain edges, similar to 182', blocking: true },
    { raw: 184, label: 'River184', category: MapObjectCategory.River, notes: 'Mostly near rivers' },
    { raw: 185, label: 'Flower2', category: MapObjectCategory.Plants, notes: 'Mostly near rivers', type: MapObjectType.Flower2 },
    { raw: 186, label: 'Flower3', category: MapObjectCategory.Plants, notes: 'On grass', type: MapObjectType.Flower3 },
    { raw: 187, label: 'Grass187', category: MapObjectCategory.Plants, notes: 'On grass near rivers' },
    { raw: 188, label: 'Flower5', category: MapObjectCategory.Plants, notes: 'Mostly near rivers', type: MapObjectType.Flower5 },

    // ---- Grass decorations: raw 189-192 (373-map scan: common, 80-85% grass) ----
    { raw: 189, label: 'Plant189', category: MapObjectCategory.Plants, notes: '373-map: 2210 across 130 maps, Grass:85%, Rock:8%, DarkGrass:8%' },
    { raw: 190, label: 'Plant190', category: MapObjectCategory.Plants, notes: '373-map: 2186 across 105 maps, Grass:80%, DarkGrass:13%' },
    { raw: 191, label: 'Plant191', category: MapObjectCategory.Plants, notes: '373-map: 4277 across 93 maps, Grass:85%, Rock:12% — very common' },
    { raw: 192, label: 'Plant192', category: MapObjectCategory.Plants, notes: '373-map: 311 across 76 maps, Grass:82%, Desert:9%, Rock:7%' },
    // raw 193-195: not observed on any map

    // ---- Magic byte trees: 0xc4-0xc6 / raw 196-198 (community / Siedler-Portal) ----
    // S4ModApi suggests raw 1-18 is the primary range; these are secondary values
    // found via community research. Kept for compatibility with maps that use them.
    // raw 196-198 (0xc4-0xc6): NOT OBSERVED on any of 373 maps.
    // Community sources (Siedler-Portal) claim these are secondary tree values, unverified.
    { raw: 0xc4, label: 'Unknown196', category: MapObjectCategory.Unknown, notes: 'NOT OBSERVED; Siedler-Portal claims Oak tree (unverified)' },
    { raw: 0xc5, label: 'Unknown197', category: MapObjectCategory.Unknown, notes: 'NOT OBSERVED; Siedler-Portal claims Pine tree (unverified)' },
    { raw: 0xc6, label: 'Unknown198', category: MapObjectCategory.Unknown, notes: 'NOT OBSERVED; Siedler-Portal claims Coconut tree (unverified)' },
    // raw 199-211: not observed on any map

    // ---- DarkGrass-affinity decorations: raw 212-214 (373-map scan: 13-24% DarkGrass) ----
    { raw: 212, label: 'DarkPlant212', category: MapObjectCategory.DarkGround, notes: '373-map: 859 across 28 maps, Grass:86%, DarkGrass:13%' },
    { raw: 213, label: 'DarkPlant213', category: MapObjectCategory.DarkGround, notes: '373-map: 383 across 20 maps, Grass:75%, DarkGrass:24%' },
    { raw: 214, label: 'DarkPlant214', category: MapObjectCategory.DarkGround, notes: '373-map: 528 across 20 maps, Grass:84%, DarkGrass:16%' },

    // ---- Snow: raw 215 ----
    // Snow pool has only 3 entries: SNOWMAN, SNOWMAN_B, DARK_STONE_BLOCK. Index 0 → SNOWMAN.
    { raw: 215, label: 'Snowman', category: MapObjectCategory.Snow, notes: 'On snow (718); pool→SNOWMAN', type: MapObjectType.Snowman },
    // raw 216-217: not observed

    // ---- Desert rare: raw 218-219 ----
    // DesertRare pool: [SKELETONDESERT1, SKELETONDESERT2, WAGGONDESTR] — indices 1,2
    { raw: 218, label: 'SkeletonDesert2', category: MapObjectCategory.DesertRare, notes: 'On desert, rare; pool→SKELETONDESERT2', type: MapObjectType.SkeletonDesert2 },
    { raw: 219, label: 'DesertWreck219', category: MapObjectCategory.DesertRare, notes: 'On desert, rare; pool→WAGGONDESTR — same visual as raw 157 but distinct raw byte' },
    { raw: 220, label: 'Plant220', category: MapObjectCategory.Plants, notes: '373-map: 316 across 58 maps, Grass:86%, Rock:6%' },

    // ---- Desert: raw 221-222 ----
    { raw: 221, label: 'Desert221', category: MapObjectCategory.Desert, notes: 'On desert (13k)' },
    { raw: 222, label: 'Desert222', category: MapObjectCategory.Desert, notes: 'On desert (7.6k)' },
    // raw 223-229: not observed on any map

    // ---- Grass/landscape decorations: raw 230-244 (373-map scan) ----
    { raw: 230, label: 'Plant230', category: MapObjectCategory.Plants, notes: '373-map: 4732 across 48 maps, Grass:93%, Rock:7% — very common' },
    { raw: 231, label: 'Plant231', category: MapObjectCategory.Plants, notes: '373-map: 541 across 103 maps, Grass:89%, DarkGrass:6%' },
    { raw: 232, label: 'StoneEdge232', category: MapObjectCategory.Stone, notes: '373-map: 298 across 16 maps, Grass:57%, Rock:42% — rock-edge decoration', blocking: true },
    { raw: 233, label: 'DarkPlant233', category: MapObjectCategory.DarkGround, notes: 'dark-land:98%, 238 across 39 maps; was Plants' },
    { raw: 234, label: 'DarkPlant234', category: MapObjectCategory.DarkGround, notes: 'dark-land:99%, 148 across 26 maps; was Plants' },
    { raw: 235, label: 'DarkPlant235', category: MapObjectCategory.DarkGround, notes: 'dark-land:99%, 145 across 30 maps; was Plants' },
    { raw: 236, label: 'DarkPlant236', category: MapObjectCategory.DarkGround, notes: 'dark-land:99%, 154 across 32 maps; was Plants' },
    { raw: 237, label: 'DarkPlant237', category: MapObjectCategory.DarkGround, notes: 'dark-land:96%, 165 across 36 maps; was Plants' },
    { raw: 238, label: 'DarkPlant238', category: MapObjectCategory.DarkGround, notes: 'dark-land:100%, 71 across 23 maps; was Plants' },
    { raw: 239, label: 'DarkPlant239', category: MapObjectCategory.DarkGround, notes: 'dark-land:100%, 126 across 28 maps; was Plants' },
    { raw: 240, label: 'DarkPlant240', category: MapObjectCategory.DarkGround, notes: 'dark-land:97%, 141 across 29 maps; was Plants' },
    { raw: 241, label: 'DarkPlant241', category: MapObjectCategory.DarkGround, notes: 'dark-land:98%, 182 across 33 maps; was Plants' },
    { raw: 242, label: 'DarkPlant242', category: MapObjectCategory.DarkGround, notes: 'dark-land:100%, 78 across 13 maps; was Plants' },
    { raw: 243, label: 'DarkPlant243', category: MapObjectCategory.DarkGround, notes: 'dark-land:97%, 79 across 29 maps; was Plants' },
    { raw: 244, label: 'DarkPlant244', category: MapObjectCategory.DarkGround, notes: 'dark-land:98%, 317 across 31 maps; was Plants' },

    // ---- Dark ground: raw 245, 254 ----
    // DarkGround pool: [DARK_TRIBE_TREE_A, DARK_TRIBE_TREE_B, ...] — dark tribe vegetation
    { raw: 245, label: 'DarkBush1', category: MapObjectCategory.DarkGround, notes: 'On dark/swamp terrain; pool→DARK_TRIBE_TREE_A', type: MapObjectType.DarkBush1 },

    // ---- Mixed landscape: raw 246-252 (373-map scan: grass/desert/dark mixes) ----
    { raw: 246, label: 'DarkPlant246', category: MapObjectCategory.DarkGround, notes: 'dark-land:88%, 125 across 33 maps; was Plants' },
    { raw: 247, label: 'DarkPlant247', category: MapObjectCategory.DarkGround, notes: 'dark-land:97%, 137 across 35 maps; was Plants' },
    { raw: 248, label: 'DarkPlant248', category: MapObjectCategory.DarkGround, notes: 'dark-land:88%, 162 across 37 maps; was Plants' },
    { raw: 249, label: 'DarkPlant249', category: MapObjectCategory.DarkGround, notes: 'dark-land:94%, 459 across 32 maps; was Plants' },
    { raw: 250, label: 'DarkPlant250', category: MapObjectCategory.DarkGround, notes: '373-map: 177 across 35 maps, Grass:71%, DarkGrass:19%, Desert:9%' },
    { raw: 251, label: 'DarkPlant251', category: MapObjectCategory.DarkGround, notes: 'dark-land:97%, 289 across 33 maps; was Plants' },
    { raw: 252, label: 'DarkPlant252', category: MapObjectCategory.DarkGround, notes: 'dark-land:97%, 89 across 27 maps; was Plants' },
    // raw 253: not observed on any map
    { raw: 254, label: 'DarkBush2', category: MapObjectCategory.DarkGround, notes: 'On dark/swamp terrain; pool→DARK_TRIBE_TREE_B', type: MapObjectType.DarkBush2 },
];
// ============================================================
// O(1) lookup array indexed by raw byte (0-255)
// ============================================================

const LOOKUP_BY_RAW: ReadonlyArray<RawObjectEntry | null> = (() => {
    const table: (RawObjectEntry | null)[] = Array.from<RawObjectEntry | null>({ length: 256 }).fill(null);
    for (const entry of RAW_OBJECT_REGISTRY) {
        table[entry.raw] = entry;
    }
    return table;
})();

/** Look up a raw byte value in the registry. Returns the entry or undefined if unknown. */
export function lookupRawObject(raw: number): RawObjectEntry | undefined {
    if (raw < 0 || raw > 255) {
        return undefined;
    }
    return LOOKUP_BY_RAW[raw] ?? undefined;
}
