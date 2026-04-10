/**
 * Territory-based filter implementations.
 * Factory functions that create filter callbacks from TerritoryManager.
 * These are pure closures — no class, no state beyond the captured manager.
 */

import type { TerritoryManager } from './territory-manager';
import type { PlacementFilter } from '../../systems/placement/types';
import type { Tile } from '../../core/coordinates';
import type { LogisticsMatchFilter, CarrierFilter } from '../logistics/logistics-filter';
import { PlacementStatus } from '../../systems/placement/types';
import type { Race } from '../../core/race';
import { isDarkTribe } from '../../core/race';

/**
 * Reject placement outside player's territory.
 * Dark Tribe is exempt — they have no territory and can place anywhere.
 */
export function createTerritoryPlacementFilter(
    tm: TerritoryManager,
    playerRaces: ReadonlyMap<number, Race>
): PlacementFilter {
    return (tile: Tile, player) => {
        if (isDarkTribe(playerRaces.get(player)!)) {
            return null;
        }
        return tm.isInTerritory(tile, player) ? null : PlacementStatus.OutOfTerritory;
    };
}

/** Reject logistics matches where source and dest are not in the same connected territory pocket. */
export function createTerritoryMatchFilter(tm: TerritoryManager): LogisticsMatchFilter {
    return (src, dst, playerId) => tm.areConnected(src, dst, playerId);
}

/** Reject carriers not connected to the destination within the player's territory. */
export function createTerritoryCarrierFilter(tm: TerritoryManager): CarrierFilter {
    return (carrier, playerId, nearX?, nearY?) =>
        nearX !== undefined && nearY !== undefined
            ? tm.areConnected(carrier, { x: nearX, y: nearY }, playerId)
            : tm.isInTerritory(carrier, playerId);
}
