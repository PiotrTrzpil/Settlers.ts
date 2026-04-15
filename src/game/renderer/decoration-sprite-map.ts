/**
 * Decoration sprite pool assignment.
 * Maps raw decoration byte values to sprite references by cycling through
 * per-category sprite pools.
 */

import { MAP_OBJECT_SPRITES } from './sprite-metadata/gil-indices';
import { DARK_TRIBE_TREE_JOBS, SEA_ROCK_JOBS } from './sprite-metadata/jil-indices';
import { MapObjectCategory, MapObjectType } from '@/game/types/map-object-types';
import { MAP_OBJECT_TYPE_TO_XML_ID } from '@/game/data/map-object-xml-mapping';
import { RAW_OBJECT_REGISTRY } from '@/resources/map/raw-object-registry';

/** Sprite reference for a decoration — loads via GIL index or JIL job. */
export interface DecorationSpriteRef {
    /** GIL index in file 5. Unused when jilJob is set. */
    gilIndex: number;
    /** JIL job index — when set, sprite is loaded via JIL instead of direct GIL. */
    jilJob?: number;
}

function gilRef(gilIndex: number): DecorationSpriteRef {
    return { gilIndex };
}

function gilAnimRef(range: { start: number }): DecorationSpriteRef {
    return { gilIndex: range.start };
}

function jilRef(job: number): DecorationSpriteRef {
    return { gilIndex: 0, jilJob: job };
}

const S = MAP_OBJECT_SPRITES;

/** Sprite pools per decoration category — cycled across raw values within that category */
const CATEGORY_SPRITE_POOLS: Partial<Record<MapObjectCategory, DecorationSpriteRef[]>> = {
    [MapObjectCategory.Stone]: [
        gilRef(S.ROCK_TALL_A),
        gilRef(S.ROCK_DEBRIS),
        gilRef(S.ROCK_PILE_SMALL),
        gilRef(S.BOULDER_MEDIUM),
        gilRef(S.ROCK_MOSSY_A),
        gilRef(S.ROCK_OUTCROP),
        gilRef(S.BOULDER_ROUND),
        gilRef(S.BOULDER_FLAT_A),
        gilRef(S.BOULDER_FLAT_B),
        gilRef(S.ROCK_POINTED),
        gilRef(S.ROCK_CLIFF),
        gilRef(S.PEBBLE),
        gilRef(S.ROCK_CAVE),
        gilRef(S.ROCK_SPIRE),
    ],
    [MapObjectCategory.Plants]: [
        gilAnimRef(S.BUSH_SMALL_YELLOW),
        gilAnimRef(S.BUSH_LARGE_DARK),
        gilAnimRef(S.BUSH_MEDIUM_BERRY),
        gilAnimRef(S.BUSH_VARIANT_C),
        gilAnimRef(S.BUSH_VARIANT_D),
        gilAnimRef(S.BUSH_VARIANT_E),
        gilAnimRef(S.BUSH_RED_BERRY),
        gilAnimRef(S.BUSH_DARK_GREEN),
        gilAnimRef(S.GRASS_FLOWERS_ORANGE),
        gilAnimRef(S.GRASS_WEEDS_SMALL),
        gilAnimRef(S.GRASS_SMALL_ORANGE),
        gilAnimRef(S.GRASS_PLANT_SMALL),
        gilAnimRef(S.GRASS_FLOWERS_ORANGE),
        gilAnimRef(S.GRASS_WEEDS_SMALL),
        gilAnimRef(S.GRASS_SMALL_ORANGE),
        gilAnimRef(S.GRASS_FLOWERS_YELLOW),
        gilAnimRef(S.GRASS_PLANT_SMALL),
        gilAnimRef(S.GRASS_FLOWERS_YELLOW),
        // Additional sprites to cover expanded raw value count
        gilRef(S.RUBBLE_MEDIUM),
        gilRef(S.RUBBLE_SMALL),
        gilRef(S.DEBRIS_SMALL),
        gilRef(S.BROKEN_PILLAR_C),
        gilRef(S.BROKEN_PILLAR_A),
        gilRef(S.BROKEN_PILLAR_B),
    ],
    [MapObjectCategory.River]: [
        gilAnimRef(S.RIVER_REEDS_TALL),
        gilAnimRef(S.RIVER_FERNS),
        gilAnimRef(S.RIVER_FLOWERS_LARGE),
        gilAnimRef(S.CATTAIL_SINGLE),
        gilAnimRef(S.CATTAIL_DOUBLE),
        gilAnimRef(S.CATTAIL_TRIPLE),
        gilAnimRef(S.GRASS_REEDS_MEDIUM_A),
        gilAnimRef(S.GRASS_REEDS_MEDIUM_B),
        gilAnimRef(S.GRASS_REEDS_LARGE_A),
        gilAnimRef(S.GRASS_REEDS_LARGE_B),
        gilAnimRef(S.GRASS_REEDS_WIDE),
    ],
    [MapObjectCategory.Desert]: [
        gilRef(S.CACTUS),
        gilRef(S.DESERT_CACTUS_LARGE),
        gilRef(S.DESERT_CACTUS_MEDIUM),
        gilRef(S.DESERT_CACTUS_SMALL),
        gilRef(S.ROCK_SPIRE),
        gilRef(S.DESERT_CACTUS_SPROUT),
        gilRef(S.DESERT_PLANT_A),
        gilRef(S.DESERT_PLANT_B),
        gilRef(S.DESERT_PLANT_C),
        gilRef(S.DESERT_PLANT_D),
        gilRef(S.DESERT_PLANT_E),
        gilRef(S.DESERT_PLANT_F),
        gilRef(S.DESERT_PLANT_G),
    ],
    [MapObjectCategory.Sea]: [
        jilRef(SEA_ROCK_JOBS.A),
        jilRef(SEA_ROCK_JOBS.B),
        jilRef(SEA_ROCK_JOBS.C),
        jilRef(SEA_ROCK_JOBS.D),
    ],
    [MapObjectCategory.Beach]: [gilRef(S.SEASHELL), gilRef(S.STARFISH)],
    // Rare variants — distinctive objects that stand out on the landscape
    [MapObjectCategory.PlantsRare]: [
        gilRef(S.SCARECROW),
        gilRef(S.ROMAN_COLUMN_OVERGROWN_A),
        gilRef(S.BROKEN_PILLAR_A),
        gilRef(S.ANCIENT_COLUMN),
        gilAnimRef(S.RUIN1),
        gilRef(S.STONE_STATUE),
        gilRef(S.SMALL_ANIMAL),
        gilRef(S.GRAVE_A),
        gilRef(S.WAGGONDESTR),
        gilRef(S.VINE_GROUND_COVER),
        gilRef(S.RUINED_COLUMN),
        gilRef(S.ROMAN_PILLAR_SMALL),
        gilRef(S.ROMAN_PILLAR_MEDIUM_A),
        gilRef(S.ROMAN_PILLAR_MEDIUM_B),
        gilRef(S.ROMAN_PILLAR_LARGE_A),
        gilRef(S.ROMAN_PILLAR_LARGE_B),
        // Reserved for very rare values only: POND, CELTICCROSS
    ],
    [MapObjectCategory.DesertRare]: [gilRef(S.SKELETONDESERT1), gilRef(S.SKELETONDESERT2), gilRef(S.WAGGONDESTR)],
    [MapObjectCategory.BeachRare]: [gilRef(S.WRECK1)],
    [MapObjectCategory.Lake]: [gilRef(S.LAKE_DECO_A), gilRef(S.LAKE_DECO_B), gilRef(S.LAKE_DECO_C)],
    [MapObjectCategory.Snow]: [gilRef(S.SNOWMAN), gilRef(S.SNOWMAN_B)],
    [MapObjectCategory.StoneRare]: [gilRef(S.ROCK_CAVE), gilRef(S.ROCK_SPIRE)],
    // Dark ground — dark tribe vegetation and volcanic rocks on swamp/dark grass terrain
    [MapObjectCategory.DarkGround]: [
        jilRef(DARK_TRIBE_TREE_JOBS.A),
        jilRef(DARK_TRIBE_TREE_JOBS.B),
        gilRef(S.DARK_TRIBE_BUSH_A),
        gilRef(S.DARK_TRIBE_BUSH_B),
        gilRef(S.DARK_TRIBE_FLOWER),
        gilRef(S.DARK_TRIBE_DEAD_TREE),
        gilRef(S.ORE_ROCK_A),
        gilRef(S.ORE_ROCK_B),
        gilRef(S.VOLCANIC_ROCK_SMALL),
        gilRef(S.VOLCANIC_ROCK_MEDIUM),
        gilRef(S.VINE_GROUND_COVER),
        gilRef(S.DARK_STONE_BLOCK),
    ],
    [MapObjectCategory.DarkGroundRare]: [
        jilRef(DARK_TRIBE_TREE_JOBS.C),
        gilRef(S.VOLCANIC_ROCK_LARGE),
        gilRef(S.VOLCANIC_ROCK_PILLAR),
        gilRef(S.LAVA_ROCK_TALL),
        gilRef(S.LAVA_ROCK_MEDIUM),
        gilRef(S.LAVA_ROCK_SMALL),
        gilRef(S.RED_CRYSTAL_A),
    ],
};

/**
 * Derive sprite from MapObjectType using the XML naming convention.
 * MapObjectType → XML name (via MAP_OBJECT_TYPE_TO_XML_ID) → strip "OBJECT_" → sprite key.
 */
function resolveSpriteFromType(type: MapObjectType): DecorationSpriteRef | null {
    const xmlId = MAP_OBJECT_TYPE_TO_XML_ID[type];
    if (!xmlId) {
        return null;
    }
    // Strip "OBJECT_" prefix to get sprite key
    const spriteKey = xmlId.replace(/^OBJECT_/, '');
    if (!(spriteKey in S)) {
        return null;
    }
    const value = S[spriteKey as keyof typeof S];
    if (typeof value === 'number') {
        return gilRef(value);
    }
    // Animated sprite range — use first frame
    return gilAnimRef(value as { start: number });
}

/**
 * Build a map from raw decoration byte value → sprite reference.
 * Entries with a `type` field derive sprites from MapObjectType → XML name → sprite key.
 * Other entries cycle through the sprite pool for their category.
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

    // First pass: derive sprites from typed entries using MapObjectType → XML → sprite
    // Second pass: collect remaining entries for pool cycling
    const byCategory = new Map<MapObjectCategory, number[]>();
    for (const entry of RAW_OBJECT_REGISTRY) {
        if (LOADER_CATEGORIES.has(entry.category)) {
            continue;
        }
        const entityKey = entry.type ?? entry.raw;

        // Typed entries derive sprite from MapObjectType → XML name → sprite key
        if (entry.type != null) {
            const ref = resolveSpriteFromType(entry.type);
            if (ref) {
                map.set(entityKey, ref);
                continue;
            }
        }

        // No type or sprite not found — add to category for pool cycling
        // eslint-disable-next-line no-restricted-syntax -- accumulator pattern: Map may not yet have an entry for this category
        const list = byCategory.get(entry.category) ?? [];
        list.push(entityKey);
        byCategory.set(entry.category, list);
    }

    // Pool cycling for entries without direct sprites
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
