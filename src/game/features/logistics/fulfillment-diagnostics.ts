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
import type { CarrierRegistry } from '../../systems/carrier-registry';
import type { ResourceRequest } from './resource-request';
import type { InventoryReservationManager } from './inventory-reservation';
import { getAvailableSupplies } from './resource-supply';
import { query } from '../../ecs';

/**
 * Reason why a pending request cannot be fulfilled right now.
 */
export const enum UnfulfilledReason {
    /** No building produces this material */
    NoSupply = 0,
    /** Supply exists but fully reserved by other carriers */
    AllReserved = 1,
    /** No idle carrier available */
    NoCarrier = 4,
    /** Carriers exist but all busy with transport jobs */
    CarriersBusy = 5,
    /** Carriers exist and idle, but reserved by another feature (barracks, garrison, etc.) */
    CarriersReserved = 6,
}

/** Display labels for each reason */
export const UNFULFILLED_REASON_LABELS: Record<UnfulfilledReason, string> = {
    [UnfulfilledReason.NoSupply]: 'No supply',
    [UnfulfilledReason.AllReserved]: 'All reserved',
    [UnfulfilledReason.NoCarrier]: 'No carrier',
    [UnfulfilledReason.CarriersBusy]: 'Carriers busy',
    [UnfulfilledReason.CarriersReserved]: 'Carriers reserved',
};

export interface DiagnosticConfig {
    gameState: GameState;
    inventoryManager: BuildingInventoryManager;
    carrierRegistry: CarrierRegistry;
    reservationManager: InventoryReservationManager;
    /** Returns the active job ID for an entity, or null if idle. */
    getActiveJobId: (entityId: number) => string | null;
    /** Returns true if the carrier is reserved by a feature (barracks, garrison, etc.). */
    isReserved: (entityId: number) => boolean;
}

/**
 * Diagnose why a pending request cannot be fulfilled.
 *
 * Checks conditions in order from most fundamental to most specific:
 * 1. Does any building have this material? → NoSupply
 * 2. Is anything left after reservations? → AllReserved
 * 3. Is a carrier available? → NoCarrier / CarriersBusy
 */
export function diagnoseUnfulfilledRequest(request: ResourceRequest, config: DiagnosticConfig): UnfulfilledReason {
    const { gameState, inventoryManager, carrierRegistry, reservationManager, getActiveJobId, isReserved } = config;

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

    // Step 3: Check carrier availability (mirrors IdleCarrierPool.isAvailable checks)
    let hasCarrier = false;
    let hasIdleButReserved = false;

    for (const [id, , entity] of query(carrierRegistry.store, gameState.store)) {
        if (entity.player !== playerId) continue;

        hasCarrier = true;

        const hasJob = getActiveJobId(id) !== null;
        if (!hasJob && isReserved(id)) {
            hasIdleButReserved = true;
        }
    }

    if (!hasCarrier) {
        return UnfulfilledReason.NoCarrier;
    }

    if (hasIdleButReserved) {
        return UnfulfilledReason.CarriersReserved;
    }

    return UnfulfilledReason.CarriersBusy;
}
