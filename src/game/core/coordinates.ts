/**
 * Core coordinate types used throughout the game.
 * This is a base module with no dependencies to avoid circular imports.
 */

/** Tile-space coordinate (integer grid position on the map). */
export interface Tile {
    x: number;
    y: number;
}

/** Generic 2D coordinate pair for non-tile coordinate spaces (world, screen, pixel). */
export interface Coords {
    x: number;
    y: number;
}

/** Relative tile offset (delta from an anchor position, in tile-space). */
export interface TileOffset {
    dx: number;
    dy: number;
}

/** Generic 2D offset for non-tile spaces (sub-tile rendering, pixel nudges). */
export interface Offset {
    dx: number;
    dy: number;
}

/** Tile position paired with the entity at that tile. */
export type TileWithEntity = Tile & { entityId: number };

/** Tile position with an optional entity reference (e.g. choreo waypoints). */
export type TileWithEntityOpt = Tile & { entityId?: number };

/** Convert tile coordinates to a string key for Map lookups */
export function tileKey(tile: Tile): string {
    return tile.x + ',' + tile.y;
}

/** 4-directional neighbor offsets (right, left, down, up) */
export const CARDINAL_OFFSETS: ReadonlyArray<readonly [number, number]> = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
];

/** Check if tile coordinates are within map bounds. */
export function isInMapBounds(tile: Tile, mapWidth: number, mapHeight: number): boolean {
    return tile.x >= 0 && tile.x < mapWidth && tile.y >= 0 && tile.y < mapHeight;
}

/** 6-directional neighbor offsets (cardinal + two diagonals) */
export const EXTENDED_OFFSETS: ReadonlyArray<readonly [number, number]> = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
    [1, 1],
    [-1, -1],
];
