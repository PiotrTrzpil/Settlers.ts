/**
 * Work handler factory for geologist prospecting (RESOURCE_POS search type).
 */

import { spiralSearch } from '../../utils/spiral-search';
import type { TerrainData } from '../../terrain';
import type { OreVeinData } from './ore-vein-data';
import type { ResourceSignSystem } from './resource-sign-system';
import { WorkHandlerType, type PositionWorkHandler } from '../settler-tasks/types';

const GEOLOGIST_SEARCH_RADIUS = 20;

/**
 * Create a position handler for RESOURCE_POS search type (geologists).
 * Worker walks to an unprospected rock tile, performs work animation,
 * then marks the tile as prospected and places a resource sign.
 */
export function createGeologistHandler(
    oreVeinData: OreVeinData,
    terrain: TerrainData,
    signSystem: ResourceSignSystem
): PositionWorkHandler {
    // Per-settler: the initial position where they started prospecting.
    // Spiral always originates from this point so prospecting fans out from
    // the mountain the player originally clicked, not the settler's current tile.
    const originBySettler = new Map<number, { x: number; y: number }>();

    return {
        type: WorkHandlerType.POSITION,

        findPosition: (x: number, y: number, settlerId?: number) => {
            // Resolve (or record) the fixed origin for this geologist
            let cx = x;
            let cy = y;
            if (settlerId !== undefined) {
                const stored = originBySettler.get(settlerId);
                if (stored) {
                    cx = stored.x;
                    cy = stored.y;
                } else {
                    originBySettler.set(settlerId, { x, y });
                }
            }

            const result = spiralSearch(cx, cy, terrain.width, terrain.height, (tx, ty) => {
                if (Math.abs(tx - cx) > GEOLOGIST_SEARCH_RADIUS || Math.abs(ty - cy) > GEOLOGIST_SEARCH_RADIUS) {
                    return false;
                }
                return terrain.isRock(tx, ty) && !oreVeinData.isProspected(tx, ty);
            });

            // No more tiles — clear so the geologist can be reassigned to a new area
            if (!result && settlerId !== undefined) {
                originBySettler.delete(settlerId);
            }

            return result;
        },

        onWorkAtPositionComplete: (posX: number, posY: number, _settlerId: number) => {
            oreVeinData.setProspected(posX, posY);
            signSystem.placeSign(posX, posY);
        },

        onSettlerRemoved: (settlerId: number) => {
            originBySettler.delete(settlerId);
        },
    };
}
