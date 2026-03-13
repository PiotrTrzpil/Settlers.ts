/**
 * Fulfillment Diagnostics
 *
 * Analyzes why a pending demand cannot currently be fulfilled.
 * Used by the logistics debug panel to show actionable reasons.
 *
 * This is a read-only diagnostic — it mirrors the matching logic in
 * LogisticsDispatcher but returns structured reasons instead of acting.
 */

import type { GameState } from '../../game-state';
import type { BuildingInventoryManager } from '../inventory';
import type { CarrierRegistry } from '../../systems/carrier-registry';
import type { TransportJobStore } from './transport-job-store';
import type { EMaterialType } from '../../economy/material-type';
import { getAvailableSupplies } from './resource-supply';
import { query } from '../../ecs';

/**
 * Minimal interface for a demand/request being diagnosed.
 * Compatible with both DemandEntry and legacy ResourceRequest shapes.
 */
export interface DiagnosticRequest {
    readonly buildingId: number;
    readonly materialType: EMaterialType;
}

/**
 * Reason why a pending demand cannot be fulfilled right now.
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
    /** Supply + idle carriers exist but dispatcher didn't create a job (pathfinding/territory/timing) */
    DispatcherStall = 7,
}

/** Display labels for each reason */
export const UNFULFILLED_REASON_LABELS: Record<UnfulfilledReason, string> = {
    [UnfulfilledReason.NoSupply]: 'No supply',
    [UnfulfilledReason.AllReserved]: 'All reserved',
    [UnfulfilledReason.NoCarrier]: 'No carrier',
    [UnfulfilledReason.CarriersBusy]: 'Carriers busy',
    [UnfulfilledReason.CarriersReserved]: 'Carriers reserved',
    [UnfulfilledReason.DispatcherStall]: 'Dispatcher stall',
};

export interface DiagnosticConfig {
    gameState: GameState;
    inventoryManager: BuildingInventoryManager;
    carrierRegistry: CarrierRegistry;
    jobStore: TransportJobStore;
    /** Returns the active job ID for an entity, or null if idle. */
    getActiveJobId: (entityId: number) => string | null;
    /** Returns true if the carrier is reserved by a feature (barracks, garrison, etc.). */
    isReserved: (entityId: number) => boolean;
}

/**
 * Diagnose why a pending demand cannot be fulfilled.
 *
 * Checks conditions in order from most fundamental to most specific:
 * 1. Does any building have this material? → NoSupply
 * 2. Is anything left after reservations? → AllReserved
 * 3. Is a carrier available? → NoCarrier / CarriersBusy
 */
export function diagnoseUnfulfilledRequest(request: DiagnosticRequest, config: DiagnosticConfig): UnfulfilledReason {
    const { gameState, inventoryManager, jobStore } = config;

    const destBuilding = gameState.getEntityOrThrow(
        request.buildingId,
        'demand destination building in fulfillment diagnostics'
    );

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

    // Step 2: Check if anything remains after reservations (from job store)
    let hasUnreserved = false;
    for (const supply of otherSupplies) {
        const reserved = jobStore.getReservedAmount(supply.buildingId, request.materialType);
        if (supply.availableAmount - reserved > 0) {
            hasUnreserved = true;
            break;
        }
    }

    if (!hasUnreserved) {
        return UnfulfilledReason.AllReserved;
    }

    // Step 3: Check carrier availability
    return diagnoseCarrierAvailability(config, playerId);
}

/** Mirrors IdleCarrierPool.isAvailable checks to classify carrier state. */
function diagnoseCarrierAvailability(config: DiagnosticConfig, playerId: number): UnfulfilledReason {
    const { gameState, carrierRegistry, getActiveJobId, isReserved } = config;
    let hasCarrier = false;
    let hasIdleAndFree = false;
    let hasIdleButReserved = false;

    for (const [id, , entity] of query(carrierRegistry.store, gameState.store)) {
        if (entity.player !== playerId) {
            continue;
        }
        hasCarrier = true;
        if (getActiveJobId(id) !== null) {
            continue;
        }
        if (isReserved(id)) {
            hasIdleButReserved = true;
        } else {
            hasIdleAndFree = true;
        }
    }

    if (!hasCarrier) {
        return UnfulfilledReason.NoCarrier;
    }
    if (hasIdleAndFree) {
        return UnfulfilledReason.DispatcherStall;
    }
    if (hasIdleButReserved) {
        return UnfulfilledReason.CarriersReserved;
    }
    return UnfulfilledReason.CarriersBusy;
}
