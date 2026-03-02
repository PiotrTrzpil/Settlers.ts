/**
 * Fulfillment Diagnostics
 *
 * Analyzes why a pending resource request cannot currently be fulfilled.
 * Used by the logistics debug panel to show actionable reasons.
 *
 * This is a read-only diagnostic — it mirrors the matching logic in
 * LogisticsDispatcher but returns structured reasons instead of acting.
 */

import type { GameState } from '../../game-state';
import type { BuildingInventoryManager } from '../inventory';
import type { ServiceAreaManager } from '../service-areas/service-area-manager';
import { getHubsServingBothPositions, getHubsServingPosition } from '../service-areas/service-area-queries';
import type { CarrierManager } from '../carriers/carrier-manager';
import { CarrierStatus } from '../carriers/carrier-state';
import type { ResourceRequest } from './resource-request';
import type { InventoryReservationManager } from './inventory-reservation';
import { getAvailableSupplies } from './resource-supply';

/**
 * Reason why a pending request cannot be fulfilled right now.
 */
export const enum UnfulfilledReason {
    /** No building produces this material */
    NoSupply = 0,
    /** Supply exists but fully reserved by other carriers */
    AllReserved = 1,
    /** Destination building not covered by any hub */
    NoHubCoversDest = 2,
    /** Supply and destination covered by different hubs (no shared hub) */
    NoSharedHub = 3,
    /** Supply matched but no idle carrier available in valid hubs */
    NoCarrier = 4,
    /** Carriers exist in valid hubs but all busy or exhausted */
    CarriersBusy = 5,
}

/** Display labels for each reason */
export const UNFULFILLED_REASON_LABELS: Record<UnfulfilledReason, string> = {
    [UnfulfilledReason.NoSupply]: 'No supply',
    [UnfulfilledReason.AllReserved]: 'All reserved',
    [UnfulfilledReason.NoHubCoversDest]: 'No hub covers dest',
    [UnfulfilledReason.NoSharedHub]: 'No shared hub',
    [UnfulfilledReason.NoCarrier]: 'No carrier',
    [UnfulfilledReason.CarriersBusy]: 'Carriers busy',
};

export interface DiagnosticConfig {
    gameState: GameState;
    inventoryManager: BuildingInventoryManager;
    serviceAreaManager: ServiceAreaManager;
    carrierManager: CarrierManager;
    reservationManager: InventoryReservationManager;
}

/**
 * Diagnose why a pending request cannot be fulfilled.
 *
 * Checks conditions in order from most fundamental to most specific:
 * 1. Does any building have this material? → NoSupply
 * 2. Is anything left after reservations? → AllReserved
 * 3. Is destination covered by a hub? → NoHubCoversDest
 * 4. Is any supply reachable via shared hub? → NoSharedHub
 * 5. Is a carrier available in valid hubs? → NoCarrier / CarriersBusy
 */
// eslint-disable-next-line complexity, sonarjs/cognitive-complexity -- complex multi-step diagnostic algorithm
export function diagnoseUnfulfilledRequest(request: ResourceRequest, config: DiagnosticConfig): UnfulfilledReason {
    const { gameState, inventoryManager, serviceAreaManager, carrierManager, reservationManager } = config;

    const destBuilding = gameState.getEntity(request.buildingId);
    if (!destBuilding) return UnfulfilledReason.NoSupply;

    const playerId = destBuilding.player;

    // Step 1: Check if any supply exists at all
    const supplies = getAvailableSupplies(gameState, inventoryManager, request.materialType, {
        playerId,
        minAmount: 1,
    });
    const otherSupplies = supplies.filter(s => s.buildingId !== request.buildingId);

    if (otherSupplies.length === 0) {
        return UnfulfilledReason.NoSupply;
    }

    // Step 2: Check if anything remains after reservations
    let hasUnreserved = false;
    for (const supply of otherSupplies) {
        const reserved = reservationManager.getReservedAmount(supply.buildingId, request.materialType);
        if (supply.availableAmount - reserved > 0) {
            hasUnreserved = true;
            break;
        }
    }

    if (!hasUnreserved) {
        return UnfulfilledReason.AllReserved;
    }

    // Step 3: Check if destination is covered by any hub
    const destHubs = getHubsServingPosition(destBuilding.x, destBuilding.y, serviceAreaManager, { playerId });

    if (destHubs.length === 0) {
        return UnfulfilledReason.NoHubCoversDest;
    }

    // Step 4: Check if any unreserved supply shares a hub with destination
    let hasSharedHub = false;

    for (const supply of otherSupplies) {
        const reserved = reservationManager.getReservedAmount(supply.buildingId, request.materialType);
        if (supply.availableAmount - reserved <= 0) continue;

        const sourceBuilding = gameState.getEntity(supply.buildingId);
        if (!sourceBuilding) continue;

        const sharedHubs = getHubsServingBothPositions(
            sourceBuilding.x,
            sourceBuilding.y,
            destBuilding.x,
            destBuilding.y,
            serviceAreaManager,
            { playerId }
        );

        if (sharedHubs.length > 0) {
            hasSharedHub = true;
        }
    }

    if (!hasSharedHub) {
        return UnfulfilledReason.NoSharedHub;
    }

    // Step 5: Check carrier availability
    let hasCarrier = false;

    for (const carrier of carrierManager.getAllCarriers()) {
        const entity = gameState.getEntity(carrier.entityId);
        if (!entity || entity.player !== playerId) continue;

        hasCarrier = true;

        if (carrier.status === CarrierStatus.Idle) {
            return UnfulfilledReason.CarriersBusy;
        }
    }

    if (!hasCarrier) {
        return UnfulfilledReason.NoCarrier;
    }

    return UnfulfilledReason.CarriersBusy;
}
