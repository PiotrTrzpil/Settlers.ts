import { EntityType, MapObjectType } from '../entity';
import { GameState } from '../game-state';
import { MapSize } from '@/utilities/map-size';
import { isBuildable } from './placement';
import { LogHandler } from '@/utilities/log-handler';

const log = new LogHandler('MapObjects');

/** Categories of map objects */
export type ObjectCategory = 'trees' | 'stones' | 'resources' | 'plants' | 'other';

/** All available categories */
export const OBJECT_CATEGORIES: readonly ObjectCategory[] = ['trees', 'stones', 'resources', 'plants', 'other'];

/** Mapping from MapObjectType to its category */
export const OBJECT_TYPE_CATEGORY: Record<MapObjectType, ObjectCategory> = {
    // Trees
    [MapObjectType.TreePine]: 'trees',
    [MapObjectType.TreeOak]: 'trees',
    [MapObjectType.TreeBirch]: 'trees',
    [MapObjectType.TreePalm]: 'trees',
    [MapObjectType.TreeCypress]: 'trees',
    [MapObjectType.TreeDead]: 'trees',

    // Stones
    [MapObjectType.StoneSmall]: 'stones',
    [MapObjectType.StoneMedium]: 'stones',
    [MapObjectType.StoneLarge]: 'stones',

    // Resources
    [MapObjectType.IronDeposit]: 'resources',
    [MapObjectType.GoldDeposit]: 'resources',
    [MapObjectType.CoalDeposit]: 'resources',
    [MapObjectType.StoneDeposit]: 'resources',
    [MapObjectType.SulfurDeposit]: 'resources',
    [MapObjectType.GemsDeposit]: 'resources',

    // Plants
    [MapObjectType.Bush]: 'plants',
    [MapObjectType.Mushroom]: 'plants',
    [MapObjectType.Flowers]: 'plants',
    [MapObjectType.Corn]: 'plants',
    [MapObjectType.Wheat]: 'plants',

    // Other
    [MapObjectType.Stump]: 'other',
    [MapObjectType.FallenTree]: 'other',
    [MapObjectType.Pile]: 'other',
};

/**
 * Registry mapping raw landscape byte values to MapObjectType.
 *
 * NOTE: These mappings are placeholders and need verification against actual
 * Settlers 4 map data. Use analyzeObjectTypes() to discover real values.
 *
 * The raw values in Settlers 4 maps likely encode:
 * - Object type (tree species, stone size, etc.)
 * - Object variant/state (growth stage, orientation)
 *
 * TODO: Reverse-engineer actual mappings from real map files.
 */
export const RAW_TO_OBJECT_TYPE: Map<number, MapObjectType> = new Map([
    // Placeholder mappings - adjust based on analyzeObjectTypes() output
    // Trees (guessed range 1-20)
    [1, MapObjectType.TreePine],
    [2, MapObjectType.TreeOak],
    [3, MapObjectType.TreeBirch],
    [4, MapObjectType.TreePalm],
    [5, MapObjectType.TreeCypress],
    [6, MapObjectType.TreeDead],

    // Stones (guessed range 21-30)
    [21, MapObjectType.StoneSmall],
    [22, MapObjectType.StoneMedium],
    [23, MapObjectType.StoneLarge],

    // Resources (guessed range 31-50)
    [31, MapObjectType.IronDeposit],
    [32, MapObjectType.GoldDeposit],
    [33, MapObjectType.CoalDeposit],
    [34, MapObjectType.StoneDeposit],
    [35, MapObjectType.SulfurDeposit],
    [36, MapObjectType.GemsDeposit],

    // Plants (guessed range 51-70)
    [51, MapObjectType.Bush],
    [52, MapObjectType.Mushroom],
    [53, MapObjectType.Flowers],
]);

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
        const val = objectType[i];
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
 * @param groundType - Ground type data (for buildability check)
 * @param mapSize - Map dimensions
 * @param options - Filtering options
 * @returns Number of objects spawned
 */
export function populateMapObjects(
    state: GameState,
    objectType: Uint8Array,
    groundType: Uint8Array,
    mapSize: MapSize,
    options: PopulateOptions = {}
): number {
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
            const rawValue = objectType[idx];

            // Skip empty tiles
            if (rawValue === 0) continue;

            // Skip unbuildable terrain (water, etc.)
            if (!isBuildable(groundType[idx])) continue;

            // Skip already occupied tiles
            if (state.getEntityAt(x, y)) continue;

            // Map raw value to MapObjectType
            const mappedType = RAW_TO_OBJECT_TYPE.get(rawValue);
            if (mappedType === undefined) continue;

            // Filter by allowed types
            if (allowedTypes && !allowedTypes.has(mappedType)) continue;

            // Spawn the object
            state.addEntity(EntityType.MapObject, mappedType, x, y, 0);
            count++;
        }
    }

    log.debug(`Populated ${count} map objects${category ? ` (${category})` : ''}`);
    return count;
}

/**
 * Spawn test objects for a category (when no real map data is available).
 * Distributes objects pseudo-randomly across buildable terrain.
 *
 * @param state - Game state to add entities to
 * @param groundType - Ground type data (for buildability check)
 * @param mapSize - Map dimensions
 * @param category - Category of objects to spawn
 * @param count - Number of objects to spawn
 * @returns Number of objects actually spawned
 */
export function spawnTestObjects(
    state: GameState,
    groundType: Uint8Array,
    mapSize: MapSize,
    category: ObjectCategory,
    count: number = 50
): number {
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
        if (!isBuildable(groundType[idx])) continue;
        if (state.getEntityAt(x, y)) continue;

        // Cycle through types in category
        const objectType = types[i % types.length];
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
export function clearMapObjects(
    state: GameState,
    category?: ObjectCategory,
    types?: MapObjectType[]
): number {
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

    log.debug(`Cleared ${toRemove.length} map objects${category ? ` (${category})` : ''}`);
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
        if (category) {
            counts.set(category, (counts.get(category) ?? 0) + 1);
        }
    }

    return counts;
}
