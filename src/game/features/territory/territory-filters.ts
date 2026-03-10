/**
 * Territory-based filter implementations.
 * Factory functions that create filter callbacks from TerritoryManager.
 * These are pure closures — no class, no state beyond the captured manager.
 */

import type { TerritoryManager } from './territory-manager';
import type { PlacementFilter } from '../../systems/placement/types';
import type { LogisticsMatchFilter, CarrierFilter } from '../logistics/logistics-filter';
import { PlacementStatus } from '../../systems/placement/types';

/** Reject placement outside player's territory. */
export function createTerritoryPlacementFilter(tm: TerritoryManager): PlacementFilter {
    return (x, y, player) => (tm.isInTerritory(x, y, player) ? null : PlacementStatus.OutOfTerritory);
}

/** Reject logistics matches where source or dest is outside player territory. */
export function createTerritoryMatchFilter(tm: TerritoryManager): LogisticsMatchFilter {
    return (src, dst, playerId) => tm.isInTerritory(src.x, src.y, playerId) && tm.isInTerritory(dst.x, dst.y, playerId);
}

/** Reject carriers outside player territory. */
export function createTerritoryCarrierFilter(tm: TerritoryManager): CarrierFilter {
    return (carrier, playerId) => tm.isInTerritory(carrier.x, carrier.y, playerId);
}
