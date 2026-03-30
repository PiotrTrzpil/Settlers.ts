/**
 * Decoration sprite pool assignment.
 * Maps raw decoration byte values to sprite references by cycling through
 * per-category sprite pools.
 */

import { MAP_OBJECT_SPRITES } from './sprite-metadata/gil-indices';
import { MapObjectCategory } from '@/game/types/map-object-types';
import { RAW_OBJECT_REGISTRY } from '@/resources/map/raw-object-registry';

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
const CATEGORY_SPRITE_POOLS: Partial<Record<MapObjectCategory, DecorationSpriteRef[]>> = {
    [MapObjectCategory.Stone]: [
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
    [MapObjectCategory.Plants]: [
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
        animRef(S.GRASS_PLANT_SMALL),
        animRef(S.GRASS_FLOWERS_ORANGE),
        animRef(S.GRASS_WEEDS_SMALL),
        animRef(S.GRASS_SMALL_ORANGE),
        animRef(S.GRASS_FLOWERS_YELLOW),
        staticRef(S.DAISIES),
        animRef(S.GRASS_PLANT_SMALL),
        animRef(S.GRASS_FLOWERS_YELLOW),
        // Additional sprites to cover expanded raw value count
        staticRef(S.RUBBLE_MEDIUM),
        staticRef(S.RUBBLE_SMALL),
        staticRef(S.DEBRIS_SMALL),
        staticRef(S.BROKEN_PILLAR_C),
        staticRef(S.BROKEN_PILLAR_A),
        staticRef(S.BROKEN_PILLAR_B),
    ],
    [MapObjectCategory.River]: [
        animRef(S.RIVER_REEDS_TALL),
        animRef(S.RIVER_FERNS),
        animRef(S.RIVER_FLOWERS_LARGE),
        animRef(S.CATTAIL_SINGLE),
        animRef(S.CATTAIL_DOUBLE),
        animRef(S.CATTAIL_TRIPLE),
        animRef(S.GRASS_REEDS_MEDIUM_A),
        animRef(S.GRASS_REEDS_MEDIUM_B),
        animRef(S.GRASS_REEDS_LARGE_A),
        animRef(S.GRASS_REEDS_LARGE_B),
        animRef(S.GRASS_REEDS_WIDE),
    ],
    [MapObjectCategory.Desert]: [
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
    [MapObjectCategory.Sea]: [
        animRef(S.SEA_ROCK_A),
        animRef(S.SEA_ROCK_B),
        animRef(S.SEA_ROCK_C),
        animRef(S.SEA_ROCK_D),
    ],
    [MapObjectCategory.Beach]: [
        staticRef(S.SEASHELL),
        staticRef(S.STARFISH),
        staticRef(S.BEACH_DECO_J),
        staticRef(S.BEACH_DECO_K),
        staticRef(S.BEACH_DECO_L),
    ],
    // Rare variants — distinctive objects that stand out on the landscape
    [MapObjectCategory.PlantsRare]: [
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
    [MapObjectCategory.DesertRare]: [
        staticRef(S.SKELETON_LARGE),
        staticRef(S.SKELETON_SMALL),
        staticRef(S.WAGON_WRECK),
    ],
    [MapObjectCategory.BeachRare]: [staticRef(S.BOAT_WRECK), staticRef(S.SHIPWRECK)],
    [MapObjectCategory.Lake]: [staticRef(S.LAKE_DECO_A), staticRef(S.LAKE_DECO_B), staticRef(S.LAKE_DECO_C)],
    [MapObjectCategory.Snow]: [staticRef(S.SNOWMAN), staticRef(S.SNOWMAN_B)],
    [MapObjectCategory.StoneRare]: [staticRef(S.ROCK_CAVE), staticRef(S.ROCK_SPIRE)],
    // Dark ground — dark tribe vegetation and volcanic rocks on swamp/dark grass terrain
    [MapObjectCategory.DarkGround]: [
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
    [MapObjectCategory.DarkGroundRare]: [
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

    // Categories with dedicated sprite loaders — skip these, they don't use pool cycling
    const LOADER_CATEGORIES: ReadonlySet<MapObjectCategory> = new Set([
        MapObjectCategory.Trees,
        MapObjectCategory.Goods,
        MapObjectCategory.Crops,
        MapObjectCategory.HarvestableStone,
    ]);

    // Group entity keys by category, skipping only categories handled by dedicated loaders.
    // For typed entries, use the MapObjectType enum value (matches entity.subType at runtime).
    // For untyped entries, use the raw byte value (also matches entity.subType).
    const byCategory = new Map<MapObjectCategory, number[]>();
    for (const entry of RAW_OBJECT_REGISTRY) {
        if (LOADER_CATEGORIES.has(entry.category)) {
            continue;
        }
        const list = byCategory.get(entry.category) ?? [];
        list.push(entry.type ?? entry.raw);
        byCategory.set(entry.category, list);
    }

    for (const [category, rawValues] of byCategory) {
        const pool = CATEGORY_SPRITE_POOLS[category];
        if (!pool?.length) {
            continue;
        }
        for (let i = 0; i < rawValues.length; i++) {
            map.set(rawValues[i]!, pool[i % pool.length]!);
        }
    }

    return map;
}
