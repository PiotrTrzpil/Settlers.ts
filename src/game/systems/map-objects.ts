import { EntityType, MapObjectType } from '../entity';
import { GameState } from '../game-state';
import { MapSize } from '@/utilities/map-size';
import { isBuildable } from '../features/placement';
import { LogHandler } from '@/utilities/log-handler';
import type { MapObjectData } from '@/resources/map/map-entity-data';
import { S4TreeType, S4GroundType } from '@/resources/map/s4-types';

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
    [0xC4, MapObjectType.TreeOak],
    [0xC5, MapObjectType.TreePine],
    [0xC6, MapObjectType.TreeCoconut], // Palm -> Coconut/Date
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

            state.addEntity(EntityType.MapObject, mappedType, x, y, 0);
            count++;
        }
    }

    log.debug(`Populated ${count} map objects${category ? ` (${category})` : ''}`);
    return count;
}

/**
 * Populate map objects from parsed entity data (MapObjects chunk).
 * This is the CORRECT way to load trees - from the MapObjects chunk (type 6),
 * not from landscape byte 2 which contains terrain attributes.
 *
 * @param state - Game state to add entities to
 * @param objects - Parsed map object data from MapObjects chunk
 * @param groundType - Ground type data (for buildability check)
 * @param mapSize - Map dimensions
 * @returns Number of objects spawned
 */
export function populateMapObjectsFromEntityData(
    state: GameState,
    objects: MapObjectData[],
    groundType: Uint8Array,
    mapSize: MapSize
): number {
    let count = 0;

    for (const obj of objects) {
        const { x, y, objectType: s4TreeType } = obj;

        // Validate coordinates
        if (x < 0 || x >= mapSize.width || y < 0 || y >= mapSize.height) {
            continue;
        }

        const idx = mapSize.toIndex(x, y);

        // Skip unbuildable terrain (water, etc.)
        if (!isBuildable(groundType[idx])) continue;

        // Skip already occupied tiles
        if (state.getEntityAt(x, y)) continue;

        // Convert S4TreeType to MapObjectType
        const mappedType = s4TreeTypeToMapObjectType(s4TreeType);
        if (mappedType === null) continue;

        state.addEntity(EntityType.MapObject, mappedType, x, y, 0);
        count++;
    }

    log.debug(`Populated ${count} map objects from ${objects.length} tile entries`);
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

// ============================================================================
// Tree Expansion (grow forests around existing seed trees)
// ============================================================================

/** Palm tree types (allowed on beach/sand) */
const PALM_TREES = new Set([
    MapObjectType.TreeCoconut,
    MapObjectType.TreeDate,
]);

/** Check if terrain allows trees */
function canHaveTrees(terrain: number): boolean {
    // No trees on water
    if (terrain >= S4GroundType.WATER1 && terrain <= S4GroundType.WATER8) return false;

    // No trees on rivers
    if (terrain >= S4GroundType.RIVER1 && terrain <= S4GroundType.RIVER4) return false;

    // No trees on snow/mountains
    if (terrain === S4GroundType.SNOW || terrain === S4GroundType.SNOW_ROCK) return false;

    // No trees on rock/mountains
    if (terrain === S4GroundType.ROCK || terrain === S4GroundType.ROCK_GRASS || terrain === S4GroundType.ROCK_SNOW) return false;

    // No trees on roads
    if (terrain === S4GroundType.SANDYROAD || terrain === S4GroundType.COBBLEDROAD) return false;

    return true;
}

/** Check if terrain is beach/sand (only palms allowed) */
function isBeachTerrain(terrain: number): boolean {
    return terrain === S4GroundType.BEACH ||
           terrain === S4GroundType.DESERT ||
           terrain === S4GroundType.DESERT_GRASS;
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

/** Get noise value 0-1 for position (used for density variation) */
function noise(x: number, y: number, seed: number, scale: number): number {
    const sx = Math.floor(x / scale);
    const sy = Math.floor(y / scale);
    const fx = (x / scale) - sx;
    const fy = (y / scale) - sy;

    const v00 = (hash(sx, sy, seed) & 0xFFFF) / 0xFFFF;
    const v10 = (hash(sx + 1, sy, seed) & 0xFFFF) / 0xFFFF;
    const v01 = (hash(sx, sy + 1, seed) & 0xFFFF) / 0xFFFF;
    const v11 = (hash(sx + 1, sy + 1, seed) & 0xFFFF) / 0xFFFF;

    const v0 = v00 + (v10 - v00) * fx;
    const v1 = v01 + (v11 - v01) * fx;
    return v0 + (v1 - v0) * fy;
}

/** Multi-scale noise for natural forest density variation */
function forestDensityNoise(x: number, y: number, seed: number): number {
    // Large scale noise creates big forest regions vs clearings
    return (
        noise(x, y, seed, 128) * 0.5 +
        noise(x, y, seed + 1000, 64) * 0.3 +
        noise(x, y, seed + 2000, 32) * 0.2
    );
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

    return allowed[Math.abs(hash(x, y, seed + 3000)) % allowed.length];
}

/** Check if tree should be placed at position */
function shouldPlaceTree(
    dx: number, dy: number, nx: number, ny: number,
    radius: number, density: number, seed: number
): boolean {
    const dist = Math.sqrt(dx * dx + dy * dy);
    const distFactor = 1 - (dist / (radius + 1));

    const densityNoise = forestDensityNoise(nx, ny, 99999);
    if (densityNoise < 0.4) return false;

    const densityMult = (densityNoise - 0.4) * 5;
    const randVal = (Math.abs(hash(nx, ny, seed)) % 1000) / 1000;

    return randVal <= density * distFactor * densityMult;
}

/** Collect existing trees from game state */
function collectSeedTrees(state: GameState, mapSize: MapSize): {
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
    nx: number, ny: number, dx: number, dy: number,
    seedType: MapObjectType, groundType: Uint8Array, occupied: Set<number>,
    state: GameState, mapSize: MapSize, radius: number, density: number,
    seed: number, minSpacing: number
): boolean {
    const idx = mapSize.toIndex(nx, ny);
    if (occupied.has(idx)) return false;

    const terrain = groundType[idx];
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
// eslint-disable-next-line complexity -- forest expansion algorithm has many steps
export function expandTrees(
    state: GameState,
    groundType: Uint8Array,
    mapSize: MapSize,
    options: ExpandTreesOptions = {}
): number {
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

                if (tryPlaceTreeAt(nx, ny, dx, dy, seedType, groundType, occupied, state, mapSize, radius, density, seed, minSpacing)) {
                    count++;
                }
            }
        }
    }

    log.debug(`Expanded ${seedTrees.length} seed trees into ${count} additional trees`);
    return count;
}
