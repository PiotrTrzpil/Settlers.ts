/**
 * Spatial search utilities for finding entities and positions on the map.
 *
 * Generic primitives used across the game: finding nearest entities,
 * searching for empty spots, iterating ring perimeters.
 */

import type { GameState } from '../game-state';
import type { Entity } from '../entity';
import type { SeededRng } from '../rng';

// ─────────────────────────────────────────────────────────────
// Ring iteration
// ─────────────────────────────────────────────────────────────

/**
 * Generate tiles on the perimeter of a square ring at the given radius.
 * Yields positions in a deterministic order (top-left to bottom-right along edges).
 */
export function* ringTiles(cx: number, cy: number, radius: number): Generator<{ x: number; y: number }> {
    for (let dy = -radius; dy <= radius; dy++) {
        for (let dx = -radius; dx <= radius; dx++) {
            if (Math.abs(dx) === radius || Math.abs(dy) === radius) {
                yield { x: cx + dx, y: cy + dy };
            }
        }
    }
}

// ─────────────────────────────────────────────────────────────
// Nearest entity search
// ─────────────────────────────────────────────────────────────

/**
 * Find the nearest entity matching a filter within a search radius.
 * Works for any entity type — the caller's filter controls type/subtype checks.
 */
export function findNearestEntity(
    gameState: GameState,
    x: number,
    y: number,
    radius: number,
    filter: (entity: Entity) => boolean
): { entityId: number; x: number; y: number } | null {
    let nearest: { entityId: number; x: number; y: number } | null = null;
    let minDistSq = Infinity;
    const radiusSq = radius * radius;

    for (const entity of gameState.entities) {
        if (!filter(entity)) continue;

        const dx = entity.x - x;
        const dy = entity.y - y;
        const distSq = dx * dx + dy * dy;

        if (distSq < radiusSq && distSq < minDistSq) {
            minDistSq = distSq;
            nearest = { entityId: entity.id, x: entity.x, y: entity.y };
        }
    }

    return nearest;
}

// ─────────────────────────────────────────────────────────────
// Empty spot search (planting, farming, spawning, etc.)
// ─────────────────────────────────────────────────────────────

/**
 * Configuration for finding an empty spot near a position.
 * Used by foresters (planting trees), farmers (planting grain), and similar systems.
 */
export interface FindEmptySpotConfig {
    /** Game state reference */
    gameState: GameState;
    /** Search radius in tiles */
    searchRadius: number;
    /** Minimum starting radius (default: 2) */
    minRadius?: number;
    /** Minimum squared distance to similar entities. 0 to skip proximity check. */
    minDistanceSq: number;
    /** Filter for entities that count as "too close". Only checked when minDistanceSq > 0. */
    proximityFilter: (entity: Entity) => boolean;
    /** If true, all 4 cardinal neighbors must also be free (no entity occupying them). */
    requireFreeNeighbors?: boolean;
    /** When provided, tiles within each ring are shuffled for natural-looking placement. */
    rng?: SeededRng;
}

/**
 * Find an empty tile in expanding rings around a center position.
 * Ensures minimum distance to similar entities (e.g., trees for foresters, grain for farmers).
 *
 * The search expands outward ring-by-ring so nearer spots are preferred.
 */
/** Check whether a tile is a valid empty spot given the config constraints. */
function isValidSpot(tile: { x: number; y: number }, config: FindEmptySpotConfig): boolean {
    if (tile.x < 0 || tile.y < 0) return false;
    if (config.gameState.getEntityAt(tile.x, tile.y)) return false;
    if (config.requireFreeNeighbors && !hasFreNeighbors(config.gameState, tile.x, tile.y)) return false;
    if (
        config.minDistanceSq > 0 &&
        isTooClose(config.gameState, tile.x, tile.y, config.minDistanceSq, config.proximityFilter)
    )
        return false;
    return true;
}

/** Search a single ring for a valid spot, optionally shuffling tile order. */
function searchRing(
    cx: number,
    cy: number,
    radius: number,
    config: FindEmptySpotConfig
): { x: number; y: number } | null {
    if (config.rng) {
        const tiles = Array.from(ringTiles(cx, cy, radius));
        config.rng.shuffle(tiles);
        for (const tile of tiles) {
            if (isValidSpot(tile, config)) return tile;
        }
    } else {
        for (const tile of ringTiles(cx, cy, radius)) {
            if (isValidSpot(tile, config)) return tile;
        }
    }
    return null;
}

export function findEmptySpot(
    cx: number,
    cy: number,
    config: FindEmptySpotConfig
): { entityId: null; x: number; y: number } | null {
    const minRadius = config.minRadius ?? 2;

    for (let radius = minRadius; radius <= config.searchRadius; radius++) {
        const spot = searchRing(cx, cy, radius, config);
        if (spot) return { entityId: null, x: spot.x, y: spot.y };
    }
    return null;
}

function isTooClose(
    gameState: GameState,
    x: number,
    y: number,
    minDistanceSq: number,
    filter: (entity: Entity) => boolean
): boolean {
    for (const entity of gameState.entities) {
        if (!filter(entity)) continue;

        const dx = entity.x - x;
        const dy = entity.y - y;
        if (dx * dx + dy * dy < minDistanceSq) return true;
    }
    return false;
}

const CARDINAL_OFFSETS = [
    { dx: 1, dy: 0 },
    { dx: -1, dy: 0 },
    { dx: 0, dy: 1 },
    { dx: 0, dy: -1 },
];

function hasFreNeighbors(gameState: GameState, x: number, y: number): boolean {
    for (const { dx, dy } of CARDINAL_OFFSETS) {
        if (gameState.getEntityAt(x + dx, y + dy)) return false;
    }
    return true;
}
