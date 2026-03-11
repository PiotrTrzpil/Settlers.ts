/**
 * Tree Expansion — grow forests around existing seed trees.
 *
 * Uses seed trees from map data as starting points for forest clusters,
 * expanding outward with smooth density falloff and terrain constraints.
 */

import { EntityType } from '../../entity';
import { MapObjectCategory, MapObjectType } from '@/game/types/map-object-types';
import { GameState } from '../../game-state';
import { MapSize } from '@/utilities/map-size';
import { isBuildable } from '../../terrain';
import type { TerrainData } from '../../terrain';
import { createLogger } from '@/utilities/logger';
import { S4GroundType } from '@/resources/map/s4-types';
import { OBJECT_TYPE_CATEGORY, getTypesForCategory } from '../../systems/map-objects';

const log = createLogger('TreeExpansion');

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

    const allTreeTypes = getTypesForCategory(MapObjectCategory.Trees);
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
        // Track ALL ground-layer entities as occupied (MapObjects, StackedPiles, Buildings)
        // so tree expansion never tries to place on an occupied tile.
        occupied.add(mapSize.toIndex(entity.x, entity.y));

        if (entity.type !== EntityType.MapObject) continue;
        const cat = OBJECT_TYPE_CATEGORY[entity.subType as MapObjectType];
        if (cat !== MapObjectCategory.Trees) continue;
        seeds.push({ x: entity.x, y: entity.y, type: entity.subType as MapObjectType });
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
