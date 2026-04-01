/**
 * RequestMatcher
 *
 * Wraps the request-to-supply matching algorithm with pluggable policy filtering.
 * Given a pending resource request, finds the best available supply source
 * while respecting optional match filters.
 */

import type { GameState } from '../../game-state';
import type { BuildingInventoryManager } from '../inventory';
import {
    matchRequestToSupply,
    findAllMatches,
    type FulfillmentMatch,
    type MatchableRequest,
} from './fulfillment-matcher';
import type { TransportJobStore } from './transport-job-store';
import type { StorageFilterManager } from '../../systems/inventory/storage-filter-manager';
import type { LogisticsMatchFilter } from './logistics-filter';

export interface RequestMatcherConfig {
    gameState: GameState;
    inventoryManager: BuildingInventoryManager;
    jobStore: TransportJobStore;
    storageFilterManager?: StorageFilterManager;
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
 * Handles inventory reservations and optional territory filtering
 * on top of the core matching algorithm.
 */
export class RequestMatcher {
    private readonly gameState: GameState;
    private readonly inventoryManager: BuildingInventoryManager;
    private readonly jobStore: TransportJobStore;
    private readonly storageFilterManager: StorageFilterManager | null;

    matchFilter: LogisticsMatchFilter | null;

    constructor(config: RequestMatcherConfig) {
        this.gameState = config.gameState;
        this.inventoryManager = config.inventoryManager;
        this.jobStore = config.jobStore;
        // eslint-disable-next-line no-restricted-syntax -- optional config/prop with sensible default
        this.storageFilterManager = config.storageFilterManager ?? null;
        // eslint-disable-next-line no-restricted-syntax -- optional config/prop with sensible default
        this.matchFilter = config.matchFilter ?? null;
    }

    /**
     * Find the best supply match for a pending request.
     *
     * @returns A match result, or null if no suitable supply was found.
     */
    matchRequest(request: MatchableRequest): RequestMatchResult | null {
        const destBuilding = this.gameState.getEntityOrThrow(request.buildingId, 'requesting building');
        const playerId = destBuilding.player;

        const match = matchRequestToSupply(request, this.gameState, this.inventoryManager, {
            playerId,
            jobStore: this.jobStore,
            storageFilterManager: this.storageFilterManager ?? undefined,
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

    /**
     * Find the top N supply candidates for a pending request, sorted by source→dest distance.
     * Used for joint carrier+supply optimization (total trip distance).
     *
     * @param maxCandidates Maximum number of candidates to return.
     * @returns Array of match results (may be empty), filtered by policy.
     */
    matchRequestCandidates(request: MatchableRequest, maxCandidates: number): RequestMatchResult[] {
        const destBuilding = this.gameState.getEntityOrThrow(request.buildingId, 'requesting building');
        const playerId = destBuilding.player;

        const allMatches = findAllMatches(request, this.gameState, this.inventoryManager, {
            playerId,
            jobStore: this.jobStore,
            storageFilterManager: this.storageFilterManager ?? undefined,
        });

        const results: RequestMatchResult[] = [];
        for (const match of allMatches) {
            if (results.length >= maxCandidates) {
                break;
            }

            if (this.matchFilter) {
                const sourceEntity = this.gameState.getEntityOrThrow(match.sourceBuilding, 'match filter source');
                if (!this.matchFilter(sourceEntity, destBuilding, playerId)) {
                    continue;
                }
            }

            results.push({ ...match, playerId });
        }
        return results;
    }
}
