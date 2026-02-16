/**
 * Spatial search utilities for finding entities and positions on the map.
 *
 * Generic primitives used across the game: finding nearest entities,
 * searching for empty spots, iterating ring perimeters.
 */

import type { GameState } from '../game-state';
import type { Entity } from '../entity';

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
}

/**
 * Find an empty tile in expanding rings around a center position.
 * Ensures minimum distance to similar entities (e.g., trees for foresters, grain for farmers).
 *
 * The search expands outward ring-by-ring so nearer spots are preferred.
 */
export function findEmptySpot(
    cx: number,
    cy: number,
    config: FindEmptySpotConfig
): { entityId: null; x: number; y: number } | null {
    const { gameState, searchRadius, minDistanceSq, proximityFilter } = config;
    const minRadius = config.minRadius ?? 2;

    for (let radius = minRadius; radius <= searchRadius; radius++) {
        for (const tile of ringTiles(cx, cy, radius)) {
            if (tile.x < 0 || tile.y < 0) continue;

            // Tile must be empty
            if (gameState.getEntityAt(tile.x, tile.y)) continue;

            // Must not be too close to similar entities
            if (minDistanceSq > 0 && isTooClose(gameState, tile.x, tile.y, minDistanceSq, proximityFilter)) continue;

            return { entityId: null, x: tile.x, y: tile.y };
        }
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
