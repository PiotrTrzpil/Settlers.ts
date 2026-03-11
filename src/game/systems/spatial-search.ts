/**
 * Spatial search utilities for finding entities and positions on the map.
 *
 * Generic primitives used across the game: finding nearest entities,
 * searching for empty spots, iterating ring perimeters.
 */

import type { GameState } from '../game-state';
import type { Entity } from '../entity';
import type { SeededRng } from '../core/rng';

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
 *
 * @param entities Candidate entities to search (e.g. from `gameState.entityIndex`).
 */
export function findNearestEntity(
    entities: Iterable<Entity>,
    x: number,
    y: number,
    radius: number,
    filter: (entity: Entity) => boolean
): { entityId: number; x: number; y: number } | null {
    let nearest: { entityId: number; x: number; y: number } | null = null;
    let minDistSq = Infinity;
    const radiusSq = radius * radius;

    for (const entity of entities) {
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
    /**
     * Pre-filtered entity iterable for proximity checks (e.g. from SpatialGrid.nearby).
     * Falls back to gameState.entities when not provided.
     */
    proximityEntities?: Iterable<Entity>;
    /** If true, all 4 cardinal neighbors must also be free (no entity occupying them). */
    requireFreeNeighbors?: boolean;
    /** When provided, used as tiebreaker among equidistant valid spots. */
    rng?: SeededRng;
}

/** Check whether a tile is a valid empty spot given the config constraints. */
function isValidSpot(tile: { x: number; y: number }, config: FindEmptySpotConfig): boolean {
    if (tile.x < 0 || tile.y < 0) return false;
    if (config.gameState.getGroundEntityAt(tile.x, tile.y)) return false;
    if (config.requireFreeNeighbors && !hasFreNeighbors(config.gameState, tile.x, tile.y)) return false;
    if (
        config.minDistanceSq > 0 &&
        isTooClose(
            config.proximityEntities ?? config.gameState.entities,
            tile.x,
            tile.y,
            config.minDistanceSq,
            config.proximityFilter
        )
    )
        return false;
    return true;
}

type SpotCandidate = { x: number; y: number; distSq: number };

/** Collect valid spots in expanding rings, stopping once no closer spots are possible. */
function collectCandidates(cx: number, cy: number, config: FindEmptySpotConfig): SpotCandidate[] {
    const minRadius = config.minRadius ?? 2;
    const candidates: SpotCandidate[] = [];

    for (let radius = minRadius; radius <= config.searchRadius; radius++) {
        for (const tile of ringTiles(cx, cy, radius)) {
            if (!isValidSpot(tile, config)) continue;
            const dx = tile.x - cx;
            const dy = tile.y - cy;
            candidates.push({ x: tile.x, y: tile.y, distSq: dx * dx + dy * dy });
        }

        // Early exit: ring corners (distSq = 2r²) can be farther than next ring's
        // edge midpoints (distSq = (r+1)²). Continue expanding until the next ring
        // can only produce spots farther than all current candidates.
        if (candidates.length > 0) {
            const nextMinDistSq = (radius + 1) * (radius + 1);
            const maxCandidateDistSq = candidates.reduce((max, c) => Math.max(max, c.distSq), 0);
            if (nextMinDistSq > maxCandidateDistSq) break;
        }
    }

    return candidates;
}

/** Pick the closest candidate, using RNG as tiebreaker among equidistant spots. */
function pickClosest(candidates: SpotCandidate[], rng?: SeededRng): SpotCandidate {
    candidates.sort((a, b) => a.distSq - b.distSq);

    if (rng) {
        const minDist = candidates[0]!.distSq;
        let tieCount = 1;
        while (tieCount < candidates.length && candidates[tieCount]!.distSq === minDist) {
            tieCount++;
        }
        return candidates[rng.nextInt(tieCount)]!;
    }

    return candidates[0]!;
}

/**
 * Find an empty tile nearest to the center, with RNG as tiebreaker among equidistant spots.
 *
 * Scans tiles in expanding rings, collects valid spots with their actual squared distance,
 * then picks the closest one. When multiple spots share the minimum distance, RNG breaks the tie
 * for natural-looking variation.
 */
export function findEmptySpot(
    cx: number,
    cy: number,
    config: FindEmptySpotConfig
): { entityId: null; x: number; y: number } | null {
    const candidates = collectCandidates(cx, cy, config);
    if (candidates.length === 0) return null;

    const pick = pickClosest(candidates, config.rng);
    return { entityId: null, x: pick.x, y: pick.y };
}

function isTooClose(
    entities: Iterable<Entity>,
    x: number,
    y: number,
    minDistanceSq: number,
    filter: (entity: Entity) => boolean
): boolean {
    for (const entity of entities) {
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
        if (gameState.getGroundEntityAt(x + dx, y + dy)) return false;
    }
    return true;
}
