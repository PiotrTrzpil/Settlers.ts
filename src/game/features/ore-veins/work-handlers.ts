/**
 * Work handler factory for geologist prospecting (RESOURCE_POS search type).
 */

import { spiralSearch } from '../../utils/spiral-search';
import type { TerrainData } from '../../terrain';
import type { OreVeinData } from './ore-vein-data';
import type { ResourceSignSystem } from './resource-sign-system';
import { WorkHandlerType, type PositionWorkHandler } from '../settler-tasks/types';

const GEOLOGIST_SEARCH_RADIUS = 20;

/** Local search radius — how far from current position to look for nearby candidates. */
const LOCAL_SEARCH_RADIUS = 5;

function distSq(ax: number, ay: number, bx: number, by: number): number {
    const dx = ax - bx;
    const dy = ay - by;
    return dx * dx + dy * dy;
}

/** Predicate for unprospected rock tiles. */
function isUnprospectedRock(oreVeinData: OreVeinData, terrain: TerrainData, tx: number, ty: number): boolean {
    return terrain.isRock(tx, ty) && !oreVeinData.isProspected(tx, ty);
}

/** Max Chebyshev distance from the move target to a rock tile for activation. */
const MOUNTAIN_PROXIMITY = 5;

/** Check if there is any rock tile within MOUNTAIN_PROXIMITY of (x, y). */
function isNearMountain(x: number, y: number, terrain: TerrainData): boolean {
    const x0 = Math.max(0, x - MOUNTAIN_PROXIMITY);
    const x1 = Math.min(terrain.width - 1, x + MOUNTAIN_PROXIMITY);
    const y0 = Math.max(0, y - MOUNTAIN_PROXIMITY);
    const y1 = Math.min(terrain.height - 1, y + MOUNTAIN_PROXIMITY);
    for (let ty = y0; ty <= y1; ty++) {
        for (let tx = x0; tx <= x1; tx++) {
            if (terrain.isRock(tx, ty)) {
                return true;
            }
        }
    }
    return false;
}

/**
 * Search locally around the geologist's current position for unprospected rock,
 * picking the candidate closest to the origin. This produces a ring-sweep pattern:
 * the geologist works nearby tiles but gravitates along the current distance ring
 * before moving outward.
 *
 * Returns null if no candidates found within LOCAL_SEARCH_RADIUS that are also
 * within GEOLOGIST_SEARCH_RADIUS of the origin.
 */
function findLocalCandidate(
    x: number,
    y: number,
    ox: number,
    oy: number,
    oreVeinData: OreVeinData,
    terrain: TerrainData
): { x: number; y: number } | null {
    const maxOriginDistSq = GEOLOGIST_SEARCH_RADIUS * GEOLOGIST_SEARCH_RADIUS;
    let best: { x: number; y: number } | null = null;
    let bestOriginDist = Infinity;

    const x0 = Math.max(0, x - LOCAL_SEARCH_RADIUS);
    const x1 = Math.min(terrain.width - 1, x + LOCAL_SEARCH_RADIUS);
    const y0 = Math.max(0, y - LOCAL_SEARCH_RADIUS);
    const y1 = Math.min(terrain.height - 1, y + LOCAL_SEARCH_RADIUS);

    for (let ty = y0; ty <= y1; ty++) {
        for (let tx = x0; tx <= x1; tx++) {
            if (!isUnprospectedRock(oreVeinData, terrain, tx, ty)) {
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
 * Create a position handler for RESOURCE_POS search type (geologists).
 * Worker walks to an unprospected rock tile, performs work animation,
 * then marks the tile as prospected and places a resource sign.
 *
 * Tile selection uses a two-phase search:
 * 1. Local phase — scan a small area around the geologist's current position,
 *    pick the candidate closest to the origin. This produces a natural ring sweep.
 * 2. Fallback phase — spiral from origin to find the nearest remaining tile
 *    (jumps to the next ring when the local area is exhausted).
 */
export function createGeologistHandler(
    oreVeinData: OreVeinData,
    terrain: TerrainData,
    signSystem: ResourceSignSystem
): PositionWorkHandler {
    const originBySettler = new Map<number, { x: number; y: number }>();
    /**
     * Settlers activated by a move command. Geologists idle after spawn until the
     * player issues a move command, which triggers `onSettlerRemoved` and adds
     * them here. Removed when they exhaust their area (re-activated on next move).
     */
    const activatedSettlers = new Set<number>();

    return {
        type: WorkHandlerType.POSITION,
        shouldWaitForWork: true,

        findPosition: (x: number, y: number, settlerId?: number) => {
            // Geologists require a move command before they start prospecting.
            if (settlerId !== undefined && !activatedSettlers.has(settlerId)) {
                return null;
            }

            // Resolve (or record) the fixed origin for this geologist
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
            const local = findLocalCandidate(x, y, ox, oy, oreVeinData, terrain);
            if (local) {
                return local;
            }

            // Phase 2: fallback — spiral from origin to jump to next ring
            const result = spiralSearch(
                ox,
                oy,
                terrain.width,
                terrain.height,
                (tx, ty) => isUnprospectedRock(oreVeinData, terrain, tx, ty),
                GEOLOGIST_SEARCH_RADIUS
            );

            // No more tiles — deactivate so we don't re-search every cooldown
            if (!result && settlerId !== undefined) {
                originBySettler.delete(settlerId);
                activatedSettlers.delete(settlerId);
            }

            return result;
        },

        onWorkAtPositionComplete: (posX: number, posY: number, _settlerId: number) => {
            oreVeinData.setProspected(posX, posY);
            signSystem.placeSign(posX, posY);
        },

        onSettlerRemoved: (settlerId: number, targetX?: number, targetY?: number) => {
            originBySettler.delete(settlerId);
            // Only activate if the move target is on or near a mountain (within 5 tiles of rock).
            // Moves to grass far from any mountain are ignored — geologist stays idle.
            if (targetX !== undefined && targetY !== undefined && isNearMountain(targetX, targetY, terrain)) {
                activatedSettlers.add(settlerId);
            }
        },
    };
}
