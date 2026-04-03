/**
 * Core coordinate types used throughout the game.
 * This is a base module with no dependencies to avoid circular imports.
 */

export interface Tile {
    x: number;
    y: number;
}

/** Convert tile coordinates to a string key for Map lookups */
export function tileKey(x: number, y: number): string {
    return x + ',' + y;
}

/** 4-directional neighbor offsets (right, left, down, up) */
export const CARDINAL_OFFSETS: ReadonlyArray<readonly [number, number]> = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
];

/** Check if tile coordinates are within map bounds. */
export function isInMapBounds(x: number, y: number, mapWidth: number, mapHeight: number): boolean {
    return x >= 0 && x < mapWidth && y >= 0 && y < mapHeight;
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
