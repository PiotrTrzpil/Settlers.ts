/**
 * Reusable factory for move-command-activated position work handlers.
 *
 * Encapsulates the common pattern shared by geologists and pioneers:
 * - Idle after spawn until player issues a move command
 * - Track a fixed origin per settler (locked at activation point)
 * - Two-phase tile search: local scan near current position, then spiral from origin
 * - Deactivate when area is exhausted (re-activated on next move)
 */

import { spiralSearch } from '../../utils/spiral-search';
import { WorkHandlerType, type PositionWorkHandler } from './types';
import { asSelf } from './choreo-types';
import type { Tile } from '@/game/core/coordinates';
import { distSq } from '@/game/core/distance';
import { scanRect } from '@/game/core/tile-search';

/** Configuration for the activated position handler factory. */
export interface ActivatedPositionHandlerConfig {
    /** Map width (tile count). */
    mapWidth: number;
    /** Map height (tile count). */
    mapHeight: number;
    /** Maximum search distance from the origin. */
    searchRadius: number;
    /** Local scan radius around the settler's current position (default: 5). */
    localRadius?: number;
    /** Returns true if the given tile is a valid work target. */
    tilePredicate: (tile: Tile) => boolean;
    /** Called when work completes at the target position. */
    onWorkComplete: (tile: Tile, settlerId: number) => void;
    /**
     * Optional gate called on move command — return true to activate the settler.
     * When omitted, every move command activates the settler.
     */
    shouldActivate?: (target: Tile) => boolean;
}

const DEFAULT_LOCAL_RADIUS = 5;

/**
 * Search locally around `tile` for a tile matching the predicate,
 * picking the candidate closest to `origin`.
 */
function findLocalCandidate(tile: Tile, origin: Tile, cfg: ActivatedPositionHandlerConfig): Tile | null {
    const maxOriginDistSq = cfg.searchRadius * cfg.searchRadius;
    let best: Tile | null = null;
    let bestOriginDist = Infinity;

    scanRect(tile, cfg.localRadius ?? DEFAULT_LOCAL_RADIUS, cfg.mapWidth, cfg.mapHeight, scanTile => {
        if (!cfg.tilePredicate(scanTile)) {
            return;
        }
        const originDist = distSq(scanTile, origin);
        if (originDist > maxOriginDistSq) {
            return;
        }
        if (originDist < bestOriginDist) {
            bestOriginDist = originDist;
            best = scanTile;
        }
    });
    return best;
}

/**
 * Create a PositionWorkHandler that activates on move commands and uses
 * a two-phase search (local scan + spiral fallback) to find work tiles.
 */
export function createActivatedPositionHandler(cfg: ActivatedPositionHandlerConfig): PositionWorkHandler {
    const originBySettler = new Map<number, Tile>();
    const activatedSettlers = new Set<number>();

    return {
        type: WorkHandlerType.POSITION,
        shouldWaitForWork: true,

        findPosition: (area, settlerId) => {
            if (!activatedSettlers.has(settlerId)) {
                return null;
            }

            const selfOrigin = asSelf(area).origin;

            // Resolve (or record) the fixed origin for this settler
            const origin = originBySettler.get(settlerId) ?? selfOrigin;
            if (!originBySettler.has(settlerId)) {
                originBySettler.set(settlerId, selfOrigin);
            }

            // Phase 1: local search — nearby tile closest to origin
            const local = findLocalCandidate(selfOrigin, origin, cfg);
            if (local) {
                return local;
            }

            // Phase 2: fallback — spiral from origin
            const result = spiralSearch(
                origin,
                cfg.mapWidth,
                cfg.mapHeight,
                tile => cfg.tilePredicate(tile),
                cfg.searchRadius
            );

            // No more tiles — deactivate so we don't re-search every cooldown
            if (!result) {
                originBySettler.delete(settlerId);
                activatedSettlers.delete(settlerId);
            }

            return result;
        },

        onWorkAtPositionComplete: cfg.onWorkComplete,

        onSettlerRemoved: (settlerId: number, targetX?: number, targetY?: number) => {
            originBySettler.delete(settlerId);
            if (targetX !== undefined && targetY !== undefined) {
                if (!cfg.shouldActivate || cfg.shouldActivate({ x: targetX, y: targetY })) {
                    activatedSettlers.add(settlerId);
                }
            }
        },
    };
}
