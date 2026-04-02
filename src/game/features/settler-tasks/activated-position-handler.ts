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
import type { Tile } from '@/game/core/coordinates';

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
    /** Returns true if the tile at (x, y) is a valid work target. */
    tilePredicate: (x: number, y: number) => boolean;
    /** Called when work completes at the target position. */
    onWorkComplete: (x: number, y: number, settlerId: number) => void;
    /**
     * Optional gate called on move command — return true to activate the settler.
     * When omitted, every move command activates the settler.
     */
    shouldActivate?: (targetX: number, targetY: number) => boolean;
}

function distSq(ax: number, ay: number, bx: number, by: number): number {
    const dx = ax - bx;
    const dy = ay - by;
    return dx * dx + dy * dy;
}

const DEFAULT_LOCAL_RADIUS = 5;

/**
 * Search locally around (x, y) for a tile matching the predicate,
 * picking the candidate closest to the origin (ox, oy).
 */
function findLocalCandidate(
    x: number,
    y: number,
    ox: number,
    oy: number,
    cfg: ActivatedPositionHandlerConfig
): Tile | null {
    const localRadius = cfg.localRadius ?? DEFAULT_LOCAL_RADIUS;
    const maxOriginDistSq = cfg.searchRadius * cfg.searchRadius;
    let best: Tile | null = null;
    let bestOriginDist = Infinity;

    const x0 = Math.max(0, x - localRadius);
    const x1 = Math.min(cfg.mapWidth - 1, x + localRadius);
    const y0 = Math.max(0, y - localRadius);
    const y1 = Math.min(cfg.mapHeight - 1, y + localRadius);

    for (let ty = y0; ty <= y1; ty++) {
        for (let tx = x0; tx <= x1; tx++) {
            if (!cfg.tilePredicate(tx, ty)) {
                continue;
            }
            const originDist = distSq(tx, ty, ox, oy);
            if (originDist > maxOriginDistSq) {
                continue;
            }
            if (originDist < bestOriginDist) {
                bestOriginDist = originDist;
                best = { x: tx, y: ty };
            }
        }
    }
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

        findPosition: (x: number, y: number, settlerId?: number) => {
            if (settlerId !== undefined && !activatedSettlers.has(settlerId)) {
                return null;
            }

            // Resolve (or record) the fixed origin for this settler
            let ox = x;
            let oy = y;
            if (settlerId !== undefined) {
                const stored = originBySettler.get(settlerId);
                if (stored) {
                    ox = stored.x;
                    oy = stored.y;
                } else {
                    originBySettler.set(settlerId, { x, y });
                }
            }

            // Phase 1: local search — nearby tile closest to origin
            const local = findLocalCandidate(x, y, ox, oy, cfg);
            if (local) {
                return local;
            }

            // Phase 2: fallback — spiral from origin
            const result = spiralSearch(ox, oy, cfg.mapWidth, cfg.mapHeight, cfg.tilePredicate, cfg.searchRadius);

            // No more tiles — deactivate so we don't re-search every cooldown
            if (!result && settlerId !== undefined) {
                originBySettler.delete(settlerId);
                activatedSettlers.delete(settlerId);
            }

            return result;
        },

        onWorkAtPositionComplete: cfg.onWorkComplete,

        onSettlerRemoved: (settlerId: number, targetX?: number, targetY?: number) => {
            originBySettler.delete(settlerId);
            if (targetX !== undefined && targetY !== undefined) {
                if (!cfg.shouldActivate || cfg.shouldActivate(targetX, targetY)) {
                    activatedSettlers.add(settlerId);
                }
            }
        },
    };
}
