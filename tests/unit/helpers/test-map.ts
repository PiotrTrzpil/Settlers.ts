/**
 * Shared test helpers for creating map/terrain test fixtures.
 *
 * Eliminates duplicate setup code across pathfinding, placement, command,
 * building-construction, building-indicator, and coordinate tests.
 */

import { MapSize } from '@/utilities/map-size';

// ─── Terrain type constants ─────────────────────────────────────────
// Replaces magic numbers scattered across test files.

export const TERRAIN = {
    WATER: 0,
    GRASS: 16,
    ROCK: 32,
    BEACH: 48,
    DESERT: 64,
    SWAMP: 80,
    RIVER_MIN: 96,
    RIVER_MAX: 99,
    SNOW: 128,
} as const;

/** All water terrain types (0-8 are water) */
export const WATER_TYPES = Array.from({ length: 9 }, (_, i) => i);

/** Passable terrain types (> 8 and not rock) */
export const PASSABLE_TYPES = [TERRAIN.GRASS, TERRAIN.BEACH, TERRAIN.DESERT, TERRAIN.SWAMP, TERRAIN.SNOW];

/** Buildable terrain types (only grass and desert) */
export const BUILDABLE_TYPES = [TERRAIN.GRASS, TERRAIN.DESERT];

/** Non-buildable but passable terrain types */
export const NON_BUILDABLE_PASSABLE = [TERRAIN.BEACH, TERRAIN.SWAMP, TERRAIN.SNOW];

// ─── Test map factory ───────────────────────────────────────────────

export interface TestMap {
    mapSize: MapSize;
    groundType: Uint8Array;
    groundHeight: Uint8Array;
    occupancy: Map<string, number>;
}

/**
 * Create a test map with uniform terrain.
 * Default: 64x64 all-grass flat terrain.
 */
export function createTestMap(
    width = 64,
    height = 64,
    options: {
        terrain?: number;
        flatHeight?: number;
    } = {},
): TestMap {
    const mapSize = new MapSize(width, height);
    const groundType = new Uint8Array(width * height).fill(options.terrain ?? TERRAIN.GRASS);
    const groundHeight = new Uint8Array(width * height).fill(options.flatHeight ?? 0);
    const occupancy = new Map<string, number>();
    return { mapSize, groundType, groundHeight, occupancy };
}

// ─── Terrain manipulation helpers ───────────────────────────────────

/** Set terrain type at a specific tile. */
export function setTerrainAt(map: TestMap, x: number, y: number, type: number): void {
    map.groundType[map.mapSize.toIndex(x, y)] = type;
}

/** Set height at a specific tile. */
export function setHeightAt(map: TestMap, x: number, y: number, height: number): void {
    map.groundHeight[map.mapSize.toIndex(x, y)] = height;
}

/** Block an entire column with the given terrain type (for pathfinding walls). */
export function blockColumn(map: TestMap, x: number, type: number = TERRAIN.WATER): void {
    for (let y = 0; y < map.mapSize.height; y++) {
        map.groundType[x + y * map.mapSize.width] = type;
    }
}

/** Block an entire column except for a gap at the given Y. */
export function blockColumnWithGap(map: TestMap, x: number, gapY: number, type: number = TERRAIN.WATER): void {
    for (let y = 0; y < map.mapSize.height; y++) {
        if (y !== gapY) {
            map.groundType[x + y * map.mapSize.width] = type;
        }
    }
}

/** Create a height slope across a region. */
export function createSlope(
    map: TestMap,
    startX: number, startY: number,
    endX: number, endY: number,
    startHeight: number, endHeight: number,
): void {
    for (let y = startY; y <= endY; y++) {
        for (let x = startX; x <= endX; x++) {
            const progress = (endX > startX)
                ? (x - startX) / (endX - startX)
                : (endY > startY)
                    ? (y - startY) / (endY - startY)
                    : 0;
            const h = Math.round(startHeight + (endHeight - startHeight) * progress);
            map.groundHeight[map.mapSize.toIndex(x, y)] = Math.min(255, Math.max(0, h));
        }
    }
}
