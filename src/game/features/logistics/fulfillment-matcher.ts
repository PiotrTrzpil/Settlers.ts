/**
 * Fulfillment Matcher
 *
 * Matches resource requests to available supplies, considering
 * distance optimization.
 */

import { travelCost } from './travel-cost';
import type { GameState } from '../../game-state';
import type { EMaterialType } from '../../economy/material-type';
import { SlotKind } from '../../core/pile-kind';
import { getAvailableSupplies } from './resource-supply';
import type { TransportJobStore } from './transport-job-store';
import type { BuildingInventoryManager } from '../inventory';
import type { StorageFilterManager } from '../../systems/inventory/storage-filter-manager';

/**
 * Minimal request shape needed by the matcher.
 */
export interface MatchableRequest {
    readonly buildingId: number;
    readonly materialType: EMaterialType;
    amount: number;
}

/**
 * Result of a successful match between a request and a supply.
 */
export interface FulfillmentMatch {
    /** Entity ID of the building with the supply */
    sourceBuilding: number;
    /** Amount that can be fulfilled (may be less than requested) */
    amount: number;
    /** Distance from source to destination (hex distance) */
    distance: number;
}

/**
 * Options for matching.
 */
export interface MatchOptions {
    /** Only consider sources owned by this player */
    playerId?: number;
    /**
     * Job store to account for already-reserved inventory.
     * If provided, reserved amounts are subtracted from available supply.
     */
    jobStore?: TransportJobStore;
    /**
     * Storage filter manager for StorageArea export filtering.
     * If provided, StorageArea buildings without export enabled are skipped as sources.
     */
    storageFilterManager?: StorageFilterManager;
}

interface MatchCandidate {
    buildingId: number;
    effectiveAmount: number;
    distance: number;
}

/** Check if a storage source is allowed to supply material. */
function isStorageSourceAllowed(
    sourceId: number,
    destHasStorageSlots: boolean,
    materialType: EMaterialType,
    storageFilterManager: StorageFilterManager | undefined
): boolean {
    // No storage↔storage transfers
    if (destHasStorageSlots) {
        return false;
    }
    // Must have export enabled
    if (storageFilterManager && !storageFilterManager.isExportAllowed(sourceId, materialType)) {
        return false;
    }
    return true;
}

/**
 * Iterate over all valid supply candidates for a request.
 *
 * Filters by: self-reference, entity existence, storage direction, and reservations.
 * Yields candidates in supply order (unsorted).
 */

/** Rejection counters accumulated during candidate iteration. */
export interface MatchRejectionStats {
    suppliesFound: number;
    /** Building IDs that had supply */
    sourceIds: number[];
    self: number;
    storageBlocked: number;
    fullyReserved: number;
    filterRejected: number;
}

function createRejectionStats(): MatchRejectionStats {
    return { suppliesFound: 0, sourceIds: [], self: 0, storageBlocked: 0, fullyReserved: 0, filterRejected: 0 };
}

function* iterateMatchCandidates(
    request: MatchableRequest,
    gameState: GameState,
    inventoryManager: BuildingInventoryManager,
    options: MatchOptions,
    stats: MatchRejectionStats
): Generator<MatchCandidate> {
    const { playerId, jobStore, storageFilterManager } = options;

    const destBuilding = gameState.getEntityOrThrow(
        request.buildingId,
        'demand destination building in fulfillment matching'
    );

    const destHasStorageSlots = inventoryManager.hasStorageSlots(request.buildingId);

    const supplies = getAvailableSupplies(gameState, inventoryManager, request.materialType, {
        playerId,
        minAmount: 1,
    });

    stats.suppliesFound = supplies.length;
    stats.sourceIds = supplies.map(s => s.buildingId);

    for (const supply of supplies) {
        if (supply.buildingId === request.buildingId) {
            stats.self++;
            continue;
        }

        // Storage direction filtering based on slot kind (not building type)
        if (supply.slotKind === SlotKind.Storage) {
            if (
                !isStorageSourceAllowed(
                    supply.buildingId,
                    destHasStorageSlots,
                    request.materialType,
                    storageFilterManager
                )
            ) {
                stats.storageBlocked++;
                continue;
            }
        }

        let effectiveAmount = supply.availableAmount;
        if (jobStore) {
            const reserved = jobStore.getReservedAmount(supply.buildingId, request.materialType);
            effectiveAmount = Math.max(0, effectiveAmount - reserved);
        }

        if (effectiveAmount <= 0) {
            stats.fullyReserved++;
            continue;
        }

        const sourceBuilding = gameState.getEntityOrThrow(
            supply.buildingId,
            'supply source building in fulfillment matching'
        );
        const distance = travelCost(sourceBuilding.x, sourceBuilding.y, destBuilding.x, destBuilding.y);

        yield { buildingId: supply.buildingId, effectiveAmount, distance };
    }
}

/**
 * Collect candidates into a sorted array of FulfillmentMatch.
 */
function collectSortedMatches(candidates: Generator<MatchCandidate>, requestAmount: number): FulfillmentMatch[] {
    const matches: FulfillmentMatch[] = [];
    for (const c of candidates) {
        matches.push({
            sourceBuilding: c.buildingId,
            amount: Math.min(c.effectiveAmount, requestAmount),
            distance: c.distance,
        });
    }
    matches.sort((a, b) => a.distance - b.distance);
    return matches;
}

/**
 * Find all possible matches for a request, sorted by distance.
 * Used by RequestMatcher for joint carrier+supply ranking.
 */
export function findAllMatches(
    request: MatchableRequest,
    gameState: GameState,
    inventoryManager: BuildingInventoryManager,
    options: MatchOptions = {},
    outStats?: MatchRejectionStats
): FulfillmentMatch[] {
    const stats = outStats ?? createRejectionStats();
    const candidates = iterateMatchCandidates(request, gameState, inventoryManager, options, stats);
    return collectSortedMatches(candidates, request.amount);
}
