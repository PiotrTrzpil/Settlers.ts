/**
 * RequestMatcher
 *
 * Wraps the request-to-supply matching algorithm with pluggable policy filtering.
 * Given a pending resource request, finds the best available supply source
 * while respecting service area constraints and optional match filters.
 */

import type { GameState } from '../../game-state';
import type { ServiceAreaManager } from '../service-areas';
import type { BuildingInventoryManager } from '../inventory';
import { matchRequestToSupply, type FulfillmentMatch } from './fulfillment-matcher';
import type { InventoryReservationManager } from './inventory-reservation';
import type { ResourceRequest } from './resource-request';
import type { LogisticsMatchFilter } from './logistics-filter';

export interface RequestMatcherConfig {
    gameState: GameState;
    inventoryManager: BuildingInventoryManager;
    serviceAreaManager: ServiceAreaManager;
    reservationManager: InventoryReservationManager;
    matchFilter?: LogisticsMatchFilter;
}

/**
 * Result of a successful request match, extending FulfillmentMatch with player context.
 */
export interface RequestMatchResult extends FulfillmentMatch {
    /** Player ID of the destination building */
    playerId: number;
}

/**
 * Matches pending resource requests to available supplies.
 *
 * Handles service area constraints, inventory reservations, and optional
 * territory filtering on top of the core matching algorithm.
 */
export class RequestMatcher {
    private readonly gameState: GameState;
    private readonly inventoryManager: BuildingInventoryManager;
    private readonly serviceAreaManager: ServiceAreaManager;
    private readonly reservationManager: InventoryReservationManager;

    /** When false, deliveries are restricted to buildings within a shared service area. */
    globalLogistics = true;

    matchFilter: LogisticsMatchFilter | null;

    constructor(config: RequestMatcherConfig) {
        this.gameState = config.gameState;
        this.inventoryManager = config.inventoryManager;
        this.serviceAreaManager = config.serviceAreaManager;
        this.reservationManager = config.reservationManager;
        this.matchFilter = config.matchFilter ?? null;
    }

    /**
     * Find the best supply match for a pending request.
     *
     * @returns A match result, or null if no suitable supply was found.
     */
    matchRequest(request: ResourceRequest): RequestMatchResult | null {
        const destBuilding = this.gameState.getEntityOrThrow(request.buildingId, 'requesting building');
        const playerId = destBuilding.player;

        const match = matchRequestToSupply(request, this.gameState, this.inventoryManager, this.serviceAreaManager, {
            playerId,
            requireServiceArea: !this.globalLogistics,
            reservationManager: this.reservationManager,
        });

        if (!match) {
            return null;
        }

        // Generic policy filter — replaces hardcoded territory check
        if (this.matchFilter) {
            const sourceEntity = this.gameState.getEntityOrThrow(match.sourceBuilding, 'match filter source');
            if (!this.matchFilter(sourceEntity, destBuilding, playerId)) {
                return null;
            }
        }

        return { ...match, playerId };
    }
}
