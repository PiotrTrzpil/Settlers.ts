import { TileCoord } from '../entity';

/**
 * Six-direction isometric diamond grid.
 *
 * Settlers 4 uses an isometric diamond tile grid (NOT a hex grid). Each tile
 * is a diamond/rhombus with 4 edges and 4 vertices. Of the 8 surrounding tiles,
 * 6 are reachable in one step — 4 share an edge, 2 share only a vertex.
 *
 * The vertex-sharing directions (+1,+1) and (-1,-1) correspond to tiles that touch
 * at a single corner point (no shared edge). The OTHER two corners (+1,-1) and (-1,+1)
 * are NOT neighbors — those tiles are 2 steps apart.
 *
 * EDirection names match VISUAL screen directions (worldY increases downward):
 *
 * | EDirection   | tileDx,tileDy | screenDx | screenDy | type           |
 * |--------------|---------------|----------|----------|----------------|
 * | SOUTH_EAST   |  (+1, +1)     |  +0.5    |  +0.5   | vertex-sharing |
 * | EAST         |  (+1,  0)     |  +1.0    |   0.0   | edge-sharing   |
 * | SOUTH_WEST   |  ( 0, +1)     |  -0.5    |  +0.5   | edge-sharing   |
 * | NORTH_WEST   |  (-1, -1)     |  -0.5    |  -0.5   | vertex-sharing |
 * | WEST         |  (-1,  0)     |  -1.0    |   0.0   | edge-sharing   |
 * | NORTH_EAST   |  ( 0, -1)     |  +0.5    |  -0.5   | edge-sharing   |
 *
 */

export enum EDirection {
    SOUTH_EAST = 0,
    EAST = 1,
    SOUTH_WEST = 2,
    NORTH_WEST = 3,
    WEST = 4,
    NORTH_EAST = 5,
}

export const NUMBER_OF_DIRECTIONS = 6;

/** dx for each EDirection value */
export const GRID_DELTA_X: readonly number[] = [1, 1, 0, -1, -1, 0];

/** dy for each EDirection value */
export const GRID_DELTA_Y: readonly number[] = [1, 0, 1, -1, 0, -1];

/** Combined [dx, dy] offsets indexed by EDirection */
export const GRID_DELTAS: ReadonlyArray<readonly [number, number]> = [
    [1, 1], // SOUTH_EAST (vertex-sharing)
    [1, 0], // EAST (edge-sharing)
    [0, 1], // SOUTH_WEST (edge-sharing)
    [-1, -1], // NORTH_WEST (vertex-sharing)
    [-1, 0], // WEST (edge-sharing)
    [0, -1], // NORTH_EAST (edge-sharing)
];

/**
 * Normalized grid direction vectors for unbiased dot-product comparisons.
 * Diagonal directions [1,1] and [-1,-1] have magnitude √2 in GRID_DELTAS;
 * without normalization, getDirectionToward is biased toward those two.
 */
const NORM_DELTA_X: readonly number[] = GRID_DELTAS.map(([x, y]) => x / Math.sqrt(x * x + y * y));
const NORM_DELTA_Y: readonly number[] = GRID_DELTAS.map(([x, y]) => y / Math.sqrt(x * x + y * y));

/** Y scale factor for hex grid distance (sqrt(3)/2 * 0.999999) */
export const Y_SCALE = (Math.sqrt(3) / 2) * 0.999999;

/**
 * Get the next tile position in the given hex direction.
 */
export function getNextHexPoint(pos: TileCoord, direction: EDirection): TileCoord {
    return {
        x: pos.x + GRID_DELTA_X[direction]!,
        y: pos.y + GRID_DELTA_Y[direction]!,
    };
}

/**
 * Get all 6 hex neighbors of a position.
 */
export function getAllNeighbors(pos: TileCoord): TileCoord[] {
    const neighbors: TileCoord[] = [];
    for (let d = 0; d < NUMBER_OF_DIRECTIONS; d++) {
        neighbors.push({
            x: pos.x + GRID_DELTA_X[d]!,
            y: pos.y + GRID_DELTA_Y[d]!,
        });
    }
    return neighbors;
}

/**
 * Get the exact EDirection for a single tile step (dx, dy).
 * Returns EDirection.EAST as fallback for zero or unrecognized deltas.
 */
export function getStepDirection(dx: number, dy: number): EDirection {
    for (let d = 0; d < NUMBER_OF_DIRECTIONS; d++) {
        if (GRID_DELTA_X[d]! === dx && GRID_DELTA_Y[d]! === dy) {
            return d as EDirection;
        }
    }
    return EDirection.EAST;
}

/**
 * Get the approximate direction from one point to another.
 * For single-step deltas, returns the exact direction.
 * For multi-tile displacements, picks the closest direction via dot product.
 */
export function getDirectionToward(fromX: number, fromY: number, toX: number, toY: number): EDirection {
    const dx = toX - fromX;
    const dy = toY - fromY;

    if (dx === 0 && dy === 0) {
        return EDirection.EAST;
    }

    let bestDir = 0;
    let bestDot = -Infinity;
    for (let d = 0; d < NUMBER_OF_DIRECTIONS; d++) {
        const dot = dx * NORM_DELTA_X[d]! + dy * NORM_DELTA_Y[d]!;
        if (dot > bestDot) {
            bestDot = dot;
            bestDir = d;
        }
    }
    return bestDir as EDirection;
}

/**
 * Get a neighbor direction by rotating the given direction by `offset` steps.
 * Positive offset = clockwise, negative = counter-clockwise.
 */
export function rotateDirection(direction: EDirection, offset: number): EDirection {
    return ((((direction + offset) % NUMBER_OF_DIRECTIONS) + NUMBER_OF_DIRECTIONS) %
        NUMBER_OF_DIRECTIONS) as EDirection;
}

/**
 * Grid distance (minimum number of steps) on the isometric diamond grid.
 *
 * The 6 directions include 4 axis-aligned moves (±x, ±y) and 2 diagonal
 * moves (+1,+1) and (-1,-1). The diagonal moves let you cover both axes
 * simultaneously when dx and dy have the same sign:
 *
 *   same sign:      max(|dx|, |dy|)   — diagonals shorten the path
 *   different sign:  |dx| + |dy|       — no useful diagonal exists
 *
 * This is exact (not just admissible) and never overestimates.
 */
export function hexDistance(x1: number, y1: number, x2: number, y2: number): number {
    const dx = x2 - x1;
    const dy = y2 - y1;
    // When dx and dy have the same sign, diagonal moves (+1,+1) or (-1,-1)
    // cover both axes at once → distance = max of the two magnitudes.
    // When they differ, no diagonal helps → distance = sum.
    if ((dx >= 0 && dy >= 0) || (dx <= 0 && dy <= 0)) {
        return Math.max(Math.abs(dx), Math.abs(dy));
    }
    return Math.abs(dx) + Math.abs(dy);
}

/**
 * Grid distance between two positioned objects (entities, coords, etc.).
 * Convenience wrapper over hexDistance that accepts {x,y} objects.
 */
export function hexDistanceTo(a: TileCoord, b: TileCoord): number {
    return hexDistance(a.x, a.y, b.x, b.y);
}

/**
 * Find the nearest item to `origin` from a list of candidates, by hex distance.
 * Returns null if candidates is empty.
 */
export function findNearestByHexDistance<T extends TileCoord>(origin: TileCoord, candidates: Iterable<T>): T | null {
    let best: T | null = null;
    let bestDist = Infinity;
    for (const c of candidates) {
        const dist = hexDistance(origin.x, origin.y, c.x, c.y);
        if (dist < bestDist) {
            bestDist = dist;
            best = c;
        }
    }
    return best;
}

/**
 * Squared hex distance (avoids sqrt, useful for comparisons).
 */
export function squaredHexDistance(x1: number, y1: number, x2: number, y2: number): number {
    const dx = x2 - x1 - (y2 - y1) * 0.5;
    const dy = (y2 - y1) * Y_SCALE;
    return dx * dx + dy * dy;
}

/**
 * World-space distance for each direction.
 *
 * Derived from the isometric tile-to-world transform:
 *   worldDx = tileDx - tileDy × 0.5
 *   worldDy = tileDy × 0.5
 *
 * See the direction table in the module header comment for full derivation.
 * Edge-sharing moves (EAST/WEST) have distance 1.0.
 * All other moves (SOUTH, NORTH, vertex-sharing diagonals) have distance √0.5.
 *
 * Used by movement to normalize visual speed across directions.
 */
export const WORLD_DISTANCE_PER_DIRECTION: readonly number[] = [
    Math.sqrt(0.5), // SOUTH_EAST (+1,+1)
    1.0, // EAST (+1,0)
    Math.sqrt(0.5), // SOUTH_WEST (0,+1)
    Math.sqrt(0.5), // NORTH_WEST (-1,-1)
    1.0, // WEST (-1,0)
    Math.sqrt(0.5), // NORTH_EAST (0,-1)
];

/**
 * Get the world-space distance factor for a tile step (dx, dy).
 * Returns the ratio of world-space distance to the baseline (EAST = 1.0).
 * Falls back to 1.0 for zero or unrecognized steps.
 */
export function getStepDistanceFactor(dx: number, dy: number): number {
    for (let d = 0; d < NUMBER_OF_DIRECTIONS; d++) {
        if (GRID_DELTA_X[d]! === dx && GRID_DELTA_Y[d]! === dy) {
            return WORLD_DISTANCE_PER_DIRECTION[d]!;
        }
    }
    return 1.0;
}
