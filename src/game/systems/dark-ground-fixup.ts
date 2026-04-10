/**
 * Dark ground fixup — remap normal map objects to their dark variants
 * when they sit on dark land tiles.
 *
 * The original S4 map data sometimes places normal trees/bushes on dark
 * terrain. This module converts them to the corresponding dark variant
 * during map loading so the visuals match the terrain.
 */

import { MapObjectType } from '@/game/types/map-object-types';
import type { Tile } from '@/game/core/coordinates';

/**
 * Mapping from normal tree types to dark tree variants.
 *
 * There are 18 normal tree types but only 9 dark tree raw slots.
 * We cycle through the dark variants deterministically based on
 * tile position so the distribution looks natural.
 */
const DARK_TREE_VARIANTS: readonly MapObjectType[] = [
    MapObjectType.DarkTree1A,
    MapObjectType.DarkTree1B,
    MapObjectType.DarkTree2A,
    MapObjectType.DarkTree2B,
    MapObjectType.DarkTree3A,
    MapObjectType.DarkTree3B,
    MapObjectType.DarkTree4A,
    MapObjectType.DarkTree4B,
    MapObjectType.DarkTree5A,
];

/** Normal bush → dark bush mapping. */
const BUSH_TO_DARK: Readonly<Record<number, MapObjectType>> = {
    [MapObjectType.Bush1]: MapObjectType.DarkBush1,
    [MapObjectType.Bush2]: MapObjectType.DarkBush2,
    [MapObjectType.Bush3]: MapObjectType.DarkBush3,
    [MapObjectType.Bush4]: MapObjectType.DarkBush4,
};

/** Normal mushroom → dark mushroom mapping. */
const MUSHROOM_TO_DARK: Readonly<Record<number, MapObjectType>> = {
    [MapObjectType.Mushroom1]: MapObjectType.MushroomDark1,
    [MapObjectType.Mushroom2]: MapObjectType.MushroomDark2,
    [MapObjectType.Mushroom3]: MapObjectType.MushroomDark3,
};

function isNormalTree(type: MapObjectType): boolean {
    return type >= MapObjectType.TreeOak && type <= MapObjectType.TreeOliveSmall;
}

/**
 * If the given type is a normal (non-dark) object that has a dark variant,
 * return the dark variant. Otherwise return the type unchanged.
 *
 * @param type  The MapObjectType from the registry
 * @param x     Tile x (used for deterministic dark tree variant selection)
 * @param y     Tile y (used for deterministic dark tree variant selection)
 */
export function toDarkVariant(type: MapObjectType, tile: Tile): MapObjectType {
    if (isNormalTree(type)) {
        return DARK_TREE_VARIANTS[(tile.x * 7 + tile.y * 13) % DARK_TREE_VARIANTS.length]!;
    }
    return BUSH_TO_DARK[type] ?? MUSHROOM_TO_DARK[type] ?? type;
}
