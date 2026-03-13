import { EntityType } from '../entity';
import { MapObjectCategory, MapObjectType } from '@/game/types/map-object-types';
import { GameState } from '../game-state';
import { MapSize } from '@/utilities/map-size';
import { isBuildable } from '../terrain';
import type { TerrainData } from '../terrain';
import { LogHandler } from '@/utilities/log-handler';
import type { MapObjectData } from '@/resources/map/map-entity-data';
import { lookupRawObject } from '@/resources/map/raw-object-registry';

const log = new LogHandler('MapObjects');

/** Categories that typed MapObjectType entities can belong to. */
export const TYPED_OBJECT_CATEGORIES: readonly MapObjectCategory[] = [
    MapObjectCategory.Trees,
    MapObjectCategory.Goods,
    MapObjectCategory.Crops,
];

/** Mapping from MapObjectType to its category. Partial — not all types have a category yet. */
export const OBJECT_TYPE_CATEGORY: Partial<Record<MapObjectType, MapObjectCategory>> = {
    // Trees
    [MapObjectType.TreeOak]: MapObjectCategory.Trees,
    [MapObjectType.TreeBeech]: MapObjectCategory.Trees,
    [MapObjectType.TreeAsh]: MapObjectCategory.Trees,
    [MapObjectType.TreeLinden]: MapObjectCategory.Trees,
    [MapObjectType.TreeBirch]: MapObjectCategory.Trees,
    [MapObjectType.TreePoplar]: MapObjectCategory.Trees,
    [MapObjectType.TreeChestnut]: MapObjectCategory.Trees,
    [MapObjectType.TreeMaple]: MapObjectCategory.Trees,
    [MapObjectType.TreeFir]: MapObjectCategory.Trees,
    [MapObjectType.TreeSpruce]: MapObjectCategory.Trees,
    [MapObjectType.TreeCoconut]: MapObjectCategory.Trees,
    [MapObjectType.TreeDate]: MapObjectCategory.Trees,
    [MapObjectType.TreeWalnut]: MapObjectCategory.Trees,
    [MapObjectType.TreeCorkOak]: MapObjectCategory.Trees,
    [MapObjectType.TreePine]: MapObjectCategory.Trees,
    [MapObjectType.TreePine2]: MapObjectCategory.Trees,
    [MapObjectType.TreeOliveLarge]: MapObjectCategory.Trees,
    [MapObjectType.TreeOliveSmall]: MapObjectCategory.Trees,
    [MapObjectType.TreeDead]: MapObjectCategory.Trees,
    [MapObjectType.DarkTree1A]: MapObjectCategory.Trees,
    [MapObjectType.DarkTree1B]: MapObjectCategory.Trees,
    [MapObjectType.DarkTree2A]: MapObjectCategory.Trees,
    [MapObjectType.DarkTree2B]: MapObjectCategory.Trees,
    [MapObjectType.DarkTree3A]: MapObjectCategory.Trees,
    [MapObjectType.DarkTree3B]: MapObjectCategory.Trees,
    [MapObjectType.DarkTree4A]: MapObjectCategory.Trees,
    [MapObjectType.DarkTree5A]: MapObjectCategory.Trees,
    // Goods (harvestable resources)
    [MapObjectType.ResourceCoal]: MapObjectCategory.Goods,
    [MapObjectType.ResourceGold]: MapObjectCategory.Goods,
    [MapObjectType.ResourceIron]: MapObjectCategory.Goods,
    [MapObjectType.ResourceStone]: MapObjectCategory.Goods,
    [MapObjectType.ResourceSulfur]: MapObjectCategory.Goods,
    [MapObjectType.ResourceDarkStone]: MapObjectCategory.Goods,
    [MapObjectType.ResourceStone2]: MapObjectCategory.Goods,
    // Crops
    [MapObjectType.Grain]: MapObjectCategory.Crops,
    [MapObjectType.Sunflower]: MapObjectCategory.Crops,
    [MapObjectType.Agave]: MapObjectCategory.Crops,
    [MapObjectType.Beehive]: MapObjectCategory.Crops,
    [MapObjectType.Grape]: MapObjectCategory.Crops,
    [MapObjectType.Wheat2]: MapObjectCategory.Crops,
    // Vegetation (bushes, flowers, grass, etc.)
    [MapObjectType.Bush1]: MapObjectCategory.Plants,
    [MapObjectType.Bush2]: MapObjectCategory.Plants,
    [MapObjectType.Bush3]: MapObjectCategory.Plants,
    [MapObjectType.Bush4]: MapObjectCategory.Plants,
    [MapObjectType.Bush5]: MapObjectCategory.Plants,
    [MapObjectType.Bush6]: MapObjectCategory.Plants,
    [MapObjectType.Bush7]: MapObjectCategory.Plants,
    [MapObjectType.Bush8]: MapObjectCategory.Plants,
    [MapObjectType.Bush9]: MapObjectCategory.Plants,
    [MapObjectType.DarkBush1]: MapObjectCategory.Plants,
    [MapObjectType.DarkBush2]: MapObjectCategory.Plants,
    [MapObjectType.DarkBush3]: MapObjectCategory.Plants,
    [MapObjectType.DarkBush4]: MapObjectCategory.Plants,
    [MapObjectType.DesertBush1]: MapObjectCategory.Desert,
    [MapObjectType.DesertBush2]: MapObjectCategory.Desert,
    [MapObjectType.DesertBush3]: MapObjectCategory.Desert,
    [MapObjectType.Flower1]: MapObjectCategory.Plants,
    [MapObjectType.Flower2]: MapObjectCategory.Plants,
    [MapObjectType.Flower3]: MapObjectCategory.Plants,
    [MapObjectType.Flower4]: MapObjectCategory.Plants,
    [MapObjectType.Flower5]: MapObjectCategory.Plants,
    [MapObjectType.SpecialFlower]: MapObjectCategory.Plants,
    [MapObjectType.Grass1]: MapObjectCategory.Plants,
    [MapObjectType.Grass2]: MapObjectCategory.Plants,
    [MapObjectType.Grass3]: MapObjectCategory.Plants,
    [MapObjectType.Grass4]: MapObjectCategory.Plants,
    [MapObjectType.Grass5]: MapObjectCategory.Plants,
    [MapObjectType.Grass6]: MapObjectCategory.Plants,
    [MapObjectType.Grass7]: MapObjectCategory.Plants,
    [MapObjectType.Grass8]: MapObjectCategory.Plants,
    [MapObjectType.Grass9]: MapObjectCategory.Plants,
    [MapObjectType.Grass10]: MapObjectCategory.Plants,
    [MapObjectType.Foliage1]: MapObjectCategory.Plants,
    [MapObjectType.Foliage2]: MapObjectCategory.Plants,
    [MapObjectType.Foliage3]: MapObjectCategory.Plants,
    [MapObjectType.Branch1]: MapObjectCategory.Plants,
    [MapObjectType.Branch2]: MapObjectCategory.Plants,
    [MapObjectType.Branch3]: MapObjectCategory.Plants,
    [MapObjectType.Branch4]: MapObjectCategory.Plants,
    [MapObjectType.Cactus1]: MapObjectCategory.Desert,
    [MapObjectType.Cactus2]: MapObjectCategory.Desert,
    [MapObjectType.Cactus3]: MapObjectCategory.Desert,
    [MapObjectType.Cactus4]: MapObjectCategory.Desert,
    [MapObjectType.Reed1]: MapObjectCategory.River,
    [MapObjectType.Reed2]: MapObjectCategory.River,
    [MapObjectType.Reed3]: MapObjectCategory.River,
    [MapObjectType.Seaweed1]: MapObjectCategory.Sea,
    [MapObjectType.Seaweed2]: MapObjectCategory.Sea,
    [MapObjectType.Seaweed3]: MapObjectCategory.Sea,
    [MapObjectType.WaterLily1]: MapObjectCategory.Lake,
    [MapObjectType.WaterLily2]: MapObjectCategory.Lake,
    [MapObjectType.WaterLily3]: MapObjectCategory.Lake,
    [MapObjectType.Mushroom1]: MapObjectCategory.Plants,
    [MapObjectType.Mushroom2]: MapObjectCategory.Plants,
    [MapObjectType.Mushroom3]: MapObjectCategory.Plants,
    [MapObjectType.MushroomDark1]: MapObjectCategory.DarkGround,
    [MapObjectType.MushroomDark2]: MapObjectCategory.DarkGround,
    [MapObjectType.MushroomDark3]: MapObjectCategory.DarkGround,
    [MapObjectType.EvilMushroom1]: MapObjectCategory.DarkGround,
    [MapObjectType.EvilMushroom2]: MapObjectCategory.DarkGround,
    [MapObjectType.EvilMushroom3]: MapObjectCategory.DarkGround,
    [MapObjectType.MushroomCycle]: MapObjectCategory.DarkGround,
    [MapObjectType.PalmPlant]: MapObjectCategory.Plants,
    // Decorative stones
    [MapObjectType.StoneBrownish1]: MapObjectCategory.Stone,
    [MapObjectType.StoneBrownish2]: MapObjectCategory.Stone,
    [MapObjectType.StoneBrownish3]: MapObjectCategory.Stone,
    [MapObjectType.StoneBrownish4]: MapObjectCategory.Stone,
    [MapObjectType.StoneBrownish5]: MapObjectCategory.Stone,
    [MapObjectType.StoneBrownish6]: MapObjectCategory.Stone,
    [MapObjectType.StoneBrownish7]: MapObjectCategory.Stone,
    [MapObjectType.StoneBrownish8]: MapObjectCategory.Stone,
    [MapObjectType.StoneBrownish9]: MapObjectCategory.Stone,
    [MapObjectType.StoneBrownish10]: MapObjectCategory.Stone,
    [MapObjectType.StoneDarkish1]: MapObjectCategory.Stone,
    [MapObjectType.StoneDarkish2]: MapObjectCategory.Stone,
    [MapObjectType.StoneDarkish3]: MapObjectCategory.Stone,
    [MapObjectType.StoneDarkish4]: MapObjectCategory.Stone,
    [MapObjectType.StoneDarkish5]: MapObjectCategory.Stone,
    [MapObjectType.StoneDarkish6]: MapObjectCategory.Stone,
    [MapObjectType.StoneDarkish7]: MapObjectCategory.Stone,
    [MapObjectType.StoneDarkish8]: MapObjectCategory.Stone,
    [MapObjectType.StoneDarkish9]: MapObjectCategory.Stone,
    [MapObjectType.StoneDarkish10]: MapObjectCategory.Stone,
    [MapObjectType.StoneDarkishB1]: MapObjectCategory.Stone,
    [MapObjectType.StoneDarkishB2]: MapObjectCategory.Stone,
    [MapObjectType.StoneDarkishB3]: MapObjectCategory.Stone,
    [MapObjectType.StoneDarkishB4]: MapObjectCategory.Stone,
    [MapObjectType.StoneDarkishB5]: MapObjectCategory.Stone,
    [MapObjectType.StoneDarkishB6]: MapObjectCategory.Stone,
    [MapObjectType.StoneDarkishB7]: MapObjectCategory.Stone,
    [MapObjectType.StoneDarkishB8]: MapObjectCategory.Stone,
    [MapObjectType.StoneDarkishB9]: MapObjectCategory.Stone,
    [MapObjectType.StoneDarkishB10]: MapObjectCategory.Stone,
    [MapObjectType.StoneDarkishG1]: MapObjectCategory.Stone,
    [MapObjectType.StoneDarkishG2]: MapObjectCategory.Stone,
    [MapObjectType.StoneDarkishG3]: MapObjectCategory.Stone,
    [MapObjectType.StoneDarkishG4]: MapObjectCategory.Stone,
    [MapObjectType.StoneDarkishG5]: MapObjectCategory.Stone,
    [MapObjectType.StoneDarkishG6]: MapObjectCategory.Stone,
    [MapObjectType.StoneDarkishG7]: MapObjectCategory.Stone,
    [MapObjectType.StoneDarkishG8]: MapObjectCategory.Stone,
    [MapObjectType.StoneDarkishG9]: MapObjectCategory.Stone,
    [MapObjectType.StoneDarkishG10]: MapObjectCategory.Stone,
    [MapObjectType.StoneGreyish1]: MapObjectCategory.Stone,
    [MapObjectType.StoneGreyish2]: MapObjectCategory.Stone,
    [MapObjectType.StoneGreyish3]: MapObjectCategory.Stone,
    [MapObjectType.StoneGreyish4]: MapObjectCategory.Stone,
    [MapObjectType.StoneGreyish5]: MapObjectCategory.Stone,
    [MapObjectType.StoneGreyish6]: MapObjectCategory.Stone,
    [MapObjectType.StoneGreyish7]: MapObjectCategory.Stone,
    [MapObjectType.StoneGreyish8]: MapObjectCategory.Stone,
    [MapObjectType.StoneGreyish9]: MapObjectCategory.Stone,
    [MapObjectType.StoneGreyish10]: MapObjectCategory.Stone,
};

/** Get all MapObjectTypes for a given category */
export function getTypesForCategory(category: MapObjectCategory): MapObjectType[] {
    return Object.entries(OBJECT_TYPE_CATEGORY)
        .filter(([, cat]) => cat === category)
        .map(([type]) => Number(type) as MapObjectType);
}

function isTreeType(type: MapObjectType): boolean {
    return (
        type <= MapObjectType.TreeOliveSmall || (type >= MapObjectType.DarkTree1A && type <= MapObjectType.DarkTree5A)
    );
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
    if (x < 0 || x >= mapSize.width || y < 0 || y >= mapSize.height) {
        return null;
    }
    if (state.getGroundEntityAt(x, y)) {
        return null;
    }

    const entry = lookupRawObject(rawType);
    if (entry?.type != null) {
        if (entry.category === MapObjectCategory.Trees && !isBuildable(groundType[mapSize.toIndex(x, y)]!)) {
            return null;
        }
        state.addEntity(EntityType.MapObject, entry.type, x, y, 0, { variation: entry.variation });
        return isTreeType(entry.type) ? 'tree' : 'deco';
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
        if (result === 'tree') {
            treeCount++;
        } else if (result === 'deco') {
            decoCount++;
        }
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
    category: MapObjectCategory,
    count: number = 50
): number {
    const { groundType, mapSize } = terrain;
    const types = getTypesForCategory(category);
    if (types.length === 0) {
        return 0;
    }

    const w = mapSize.width;
    const h = mapSize.height;
    let spawned = 0;

    for (let i = 0; i < count && spawned < count; i++) {
        // Deterministic pseudo-random positions
        const x = (i * 31 + 17) % w;
        const y = (i * 37 + 23) % h;
        const idx = mapSize.toIndex(x, y);

        // Skip unbuildable or occupied
        if (!isBuildable(groundType[idx]!)) {
            continue;
        }
        if (state.getGroundEntityAt(x, y)) {
            continue;
        }

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
export function clearMapObjects(state: GameState, category?: MapObjectCategory, types?: MapObjectType[]): number {
    // Determine which types to clear
    let allowedTypes: Set<MapObjectType> | null = null;
    if (types) {
        allowedTypes = new Set(types);
    } else if (category) {
        allowedTypes = new Set(getTypesForCategory(category));
    }

    // Find matching entities
    const toRemove = state.entities.filter(e => {
        if (e.type !== EntityType.MapObject) {
            return false;
        }
        if (allowedTypes && !allowedTypes.has(e.subType as MapObjectType)) {
            return false;
        }
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
export function countMapObjectsByCategory(state: GameState): Map<MapObjectCategory, number> {
    const counts = new Map<MapObjectCategory, number>();
    for (const cat of TYPED_OBJECT_CATEGORIES) {
        counts.set(cat, 0);
    }

    for (const entity of state.entities) {
        if (entity.type !== EntityType.MapObject) {
            continue;
        }
        const category = OBJECT_TYPE_CATEGORY[entity.subType as MapObjectType];

        if (category) {
            counts.set(category, (counts.get(category) ?? 0) + 1);
        }
    }

    return counts;
}
