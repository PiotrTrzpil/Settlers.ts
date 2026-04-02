/**
 * Work handler factory for pioneer territory claiming (TERRAIN search type).
 *
 * Pioneers are activated by a move command. Once activated, they search for
 * unclaimed tiles near their position and claim them for their player.
 * Unlike tower-based territory, pioneer-claimed tiles can be anywhere on the map.
 */

import type { TerritoryManager } from '../territory/territory-manager';
import type { PositionWorkHandler } from '../settler-tasks/types';
import { createActivatedPositionHandler } from '../settler-tasks/activated-position-handler';
import type { GameState } from '@/game/game-state';
import type { TerrainData } from '@/game/terrain';

/** How far from the pioneer's current position to search for unclaimed tiles. */
const PIONEER_SEARCH_RADIUS = 30;

/**
 * Create a position handler for TERRAIN search type (pioneers).
 * Pioneer walks to an unclaimed tile, performs work animation,
 * then claims the tile for their player via TerritoryManager.
 */
export function createPioneerHandler(
    gameState: GameState,
    terrain: TerrainData,
    territoryManager: TerritoryManager
): PositionWorkHandler {
    return createActivatedPositionHandler({
        mapWidth: terrain.width,
        mapHeight: terrain.height,
        searchRadius: PIONEER_SEARCH_RADIUS,
        tilePredicate: (tx, ty) => !territoryManager.isInAnyTerritory(tx, ty),
        onWorkComplete: (posX, posY, settlerId) => {
            const entity = gameState.getEntityOrThrow(settlerId, 'pioneer:claimTile');
            territoryManager.claimTile(posX, posY, entity.player);
        },
    });
}
