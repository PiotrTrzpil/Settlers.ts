/**
 * Spatial search utilities for finding entities and positions on the map.
 *
 * Generic primitives used across the game: finding nearest entities,
 * searching for empty spots, iterating ring perimeters.
 */

import type { GameState } from '../game-state';
import type { Entity, Tile, TileWithEntity } from '../entity';
import type { SeededRng } from '../core/rng';
import { distSq } from '../core/distance';
import { CARDINAL_OFFSETS } from '../core/coordinates';
import { ringTiles } from '../core/tile-iteration';

export { ringTiles };

// ─────────────────────────────────────────────────────────────
// Nearest candidate collection
// ─────────────────────────────────────────────────────────────

type NearCandidate = Tile & { distSq: number };

/**
 * Collect tiles accepted by `isValid` in expanding rings around `center`,
 * keeping each tile's squared euclidean distance.
 *
 * Stops expanding once the next ring can only produce tiles farther than every
 * collected candidate: ring corners (distSq = 2r²) can be farther than the
 * next ring's edge midpoints (distSq = (r+1)²), so expansion continues until
 * the next ring's minimum possible distance exceeds all current candidates.
 */
function collectNearestCandidates(center: Tile, radius: number, isValid: (tile: Tile) => boolean): NearCandidate[] {
    const radiusSq = radius * radius;
    const candidates: NearCandidate[] = [];

    for (let r = 0; r <= radius; r++) {
        for (const tile of ringTiles(center, r)) {
            const d = distSq(tile, center);
            if (d > radiusSq || !isValid(tile)) {
                continue;
            }
            candidates.push({ x: tile.x, y: tile.y, distSq: d });
        }

        if (candidates.length > 0) {
            const nextMinDistSq = (r + 1) * (r + 1);
            const maxCandidateDistSq = candidates.reduce((max, c) => Math.max(max, c.distSq), 0);
            if (nextMinDistSq > maxCandidateDistSq) {
                break;
            }
        }
    }

    return candidates;
}

/** Pick the closest candidate, using RNG as tiebreaker among equidistant spots. */
function pickClosest(candidates: NearCandidate[], rng?: SeededRng): NearCandidate {
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
    center: Tile,
    radius: number,
    filter: (entity: Entity) => boolean
): TileWithEntity | null {
    let nearest: TileWithEntity | null = null;
    let minDistSq = Infinity;
    const radiusSq = radius * radius;

    for (const entity of entities) {
        if (!filter(entity)) {
            continue;
        }
        const d = distSq(entity, center);
        if (d <= radiusSq && d < minDistSq) {
            minDistSq = d;
            nearest = { entityId: entity.id, x: entity.x, y: entity.y };
        }
    }
    return nearest;
}

// ─────────────────────────────────────────────────────────────
// Nearest tile search (terrain-predicate)
// ─────────────────────────────────────────────────────────────

/**
 * Find the nearest tile matching a predicate within a search radius.
 * Uses expanding rings with euclidean distance, same as findEmptySpot.
 */
export function findNearestTile(center: Tile, radius: number, predicate: (tile: Tile) => boolean): Tile | null {
    const candidates = collectNearestCandidates(center, radius, predicate);
    if (candidates.length === 0) {
        return null;
    }
    const pick = pickClosest(candidates);
    return { x: pick.x, y: pick.y };
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
function isValidSpot(tile: Tile, config: FindEmptySpotConfig): boolean {
    if (tile.x < 0 || tile.y < 0) {
        return false;
    }
    if (config.gameState.getGroundEntityAt(tile)) {
        return false;
    }
    if (config.requireFreeNeighbors && !hasFreNeighbors(config.gameState, tile)) {
        return false;
    }
    if (
        config.minDistanceSq > 0 &&
        isTooClose(
            config.proximityEntities ?? config.gameState.entities,
            tile,
            config.minDistanceSq,
            config.proximityFilter
        )
    ) {
        return false;
    }
    return true;
}

/**
 * Find an empty tile nearest to the center, with RNG as tiebreaker among equidistant spots.
 *
 * Scans tiles in expanding rings, collects valid spots with their actual squared distance,
 * then picks the closest one. When multiple spots share the minimum distance, RNG breaks the tie
 * for natural-looking variation.
 */
export function findEmptySpot(center: Tile, config: FindEmptySpotConfig): Tile | null {
    const candidates = collectNearestCandidates(center, config.searchRadius, tile => isValidSpot(tile, config));
    if (candidates.length === 0) {
        return null;
    }

    const pick = pickClosest(candidates, config.rng);
    return { x: pick.x, y: pick.y };
}

function isTooClose(
    entities: Iterable<Entity>,
    tile: Tile,
    minDistanceSq: number,
    filter: (entity: Entity) => boolean
): boolean {
    for (const entity of entities) {
        if (!filter(entity)) {
            continue;
        }

        if (distSq(entity, tile) < minDistanceSq) {
            return true;
        }
    }
    return false;
}

function hasFreNeighbors(gameState: GameState, tile: Tile): boolean {
    for (const [dx, dy] of CARDINAL_OFFSETS) {
        if (gameState.getGroundEntityAt({ x: tile.x + dx, y: tile.y + dy })) {
            return false;
        }
    }
    return true;
}
