import { TileCoord } from '../entity';

/**
 * Six-direction hex grid system based on JSettlers EDirection.
 *
 * The hex grid uses offset coordinates where odd/even rows are
 * shifted. Grid deltas follow the JSettlers convention:
 *
 *   NORTH_EAST = (1, -1)
 *   EAST       = (1,  0)
 *   SOUTH_EAST = (0,  1)
 *   SOUTH_WEST = (-1, 1)
 *   WEST       = (-1, 0)
 *   NORTH_WEST = (0, -1)
 */

export enum EDirection {
    NORTH_EAST = 0,
    EAST = 1,
    SOUTH_EAST = 2,
    SOUTH_WEST = 3,
    WEST = 4,
    NORTH_WEST = 5,
}

export const NUMBER_OF_DIRECTIONS = 6;

/** dx for each EDirection value */
export const GRID_DELTA_X: readonly number[] = [1, 1, 0, -1, -1, 0];

/** dy for each EDirection value */
export const GRID_DELTA_Y: readonly number[] = [-1, 0, 1, 1, 0, -1];

/** Combined [dx, dy] offsets indexed by EDirection */
export const GRID_DELTAS: ReadonlyArray<readonly [number, number]> = [
    [1, -1],   // NORTH_EAST
    [1, 0],    // EAST
    [0, 1],    // SOUTH_EAST
    [-1, 1],   // SOUTH_WEST
    [-1, 0],   // WEST
    [0, -1],   // NORTH_WEST
];

/** Y scale factor for hex grid distance (sqrt(3)/2 * 0.999999) */
export const Y_SCALE = Math.sqrt(3) / 2 * 0.999999;

/**
 * Get the next tile position in the given hex direction.
 */
export function getNextHexPoint(pos: TileCoord, direction: EDirection): TileCoord {
    return {
        x: pos.x + GRID_DELTA_X[direction],
        y: pos.y + GRID_DELTA_Y[direction],
    };
}

/**
 * Get all 6 hex neighbors of a position.
 */
export function getAllNeighbors(pos: TileCoord): TileCoord[] {
    const neighbors: TileCoord[] = [];
    for (let d = 0; d < NUMBER_OF_DIRECTIONS; d++) {
        neighbors.push({
            x: pos.x + GRID_DELTA_X[d],
            y: pos.y + GRID_DELTA_Y[d],
        });
    }
    return neighbors;
}

/**
 * Get the approximate direction from one point to another.
 * Uses cube coordinate decomposition on the hex grid to determine
 * which of the 6 directions best matches the displacement vector.
 *
 * The grid deltas map to cube coordinates (q, r, s) where q=dx, r=dy, s=-(dx+dy).
 * The dominant cube axis determines the direction.
 */
export function getApproxDirection(
    fromX: number,
    fromY: number,
    toX: number,
    toY: number,
): EDirection {
    const q = toX - fromX;
    const r = toY - fromY;
    const s = -(q + r);

    if (q === 0 && r === 0) {
        return EDirection.EAST; // arbitrary default for zero vector
    }

    const absQ = Math.abs(q);
    const absR = Math.abs(r);
    const absS = Math.abs(s);

    if (absQ >= absR && absQ >= absS) {
        // q (x-axis) dominant
        if (q > 0) return r < 0 ? EDirection.NORTH_EAST : EDirection.EAST;
        else return r > 0 ? EDirection.SOUTH_WEST : EDirection.WEST;
    } else if (absR >= absQ && absR >= absS) {
        // r (y-axis) dominant
        if (r > 0) return q >= 0 ? EDirection.SOUTH_EAST : EDirection.SOUTH_WEST;
        else return q > 0 ? EDirection.NORTH_EAST : EDirection.NORTH_WEST;
    } else {
        // s (diagonal axis) dominant
        if (s > 0) return q >= 0 ? EDirection.NORTH_WEST : EDirection.WEST;
        else return q > 0 ? EDirection.EAST : EDirection.SOUTH_EAST;
    }
}

/**
 * Get a neighbor direction by rotating the given direction by `offset` steps.
 * Positive offset = clockwise, negative = counter-clockwise.
 */
export function getNeighbor(direction: EDirection, offset: number): EDirection {
    return (((direction + offset) % NUMBER_OF_DIRECTIONS + NUMBER_OF_DIRECTIONS) % NUMBER_OF_DIRECTIONS) as EDirection;
}

/**
 * Hex grid Manhattan distance using cube coordinates.
 * Always admissible as an A* heuristic (never overestimates when
 * minimum step cost is 1).
 *
 * Cube coords: q = dx, r = dy, s = -(dx + dy).
 * Distance = max(|q|, |r|, |s|).
 */
export function hexDistance(x1: number, y1: number, x2: number, y2: number): number {
    const q = x2 - x1;
    const r = y2 - y1;
    const s = -(q + r);
    return Math.max(Math.abs(q), Math.abs(r), Math.abs(s));
}

/**
 * Squared hex distance (avoids sqrt, useful for comparisons).
 */
export function squaredHexDistance(x1: number, y1: number, x2: number, y2: number): number {
    const dx = (x2 - x1) - (y2 - y1) * 0.5;
    const dy = (y2 - y1) * Y_SCALE;
    return dx * dx + dy * dy;
}
