/**
 * Fulfillment Matcher
 *
 * Matches resource requests to available supplies, considering
 * distance optimization.
 */

import { hexDistance } from '../../systems/hex-directions';
import type { GameState } from '../../game-state';
import type { ResourceRequest } from './resource-request';
import { getAvailableSupplies } from './resource-supply';
import type { InventoryReservationManager } from './inventory-reservation';
import type { BuildingInventoryManager } from '../inventory';

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
 * Default distance multiplier for preferring full-supply sources.
 * If a source with full quantity is within this multiple of the nearest source's distance,
 * prefer the full-supply source to avoid multiple trips.
 */
export const DEFAULT_FULL_SUPPLY_DISTANCE_FACTOR = 1.5;

/**
 * Options for matching.
 */
export interface MatchOptions {
    /** Only consider sources owned by this player */
    playerId?: number;
    /**
     * Distance factor for preferring full-supply sources.
     * A source with full quantity is preferred if within this multiple of nearest distance.
     * Default: 1.5 (prefer full supply if within 50% extra distance)
     */
    fullSupplyDistanceFactor?: number;
    /**
     * Reservation manager to account for already-reserved inventory.
     * If provided, reserved amounts are subtracted from available supply.
     */
    reservationManager?: InventoryReservationManager;
}

interface MatchCandidate {
    buildingId: number;
    effectiveAmount: number;
    distance: number;
}

/**
 * Iterate over all valid supply candidates for a request.
 *
 * Filters by: self-reference, entity existence, and reservations.
 * Yields candidates in supply order (unsorted).
 */
function* iterateMatchCandidates(
    request: ResourceRequest,
    gameState: GameState,
    inventoryManager: BuildingInventoryManager,
    options: MatchOptions
): Generator<MatchCandidate> {
    const { playerId, reservationManager } = options;

    const destBuilding = gameState.getEntity(request.buildingId);
    if (!destBuilding) {
        return;
    }

    const supplies = getAvailableSupplies(gameState, inventoryManager, request.materialType, {
        playerId,
        minAmount: 1,
    });

    for (const supply of supplies) {
        if (supply.buildingId === request.buildingId) {
            continue;
        }

        const sourceBuilding = gameState.getEntity(supply.buildingId);
        if (!sourceBuilding) {
            continue;
        }

        let effectiveAmount = supply.availableAmount;
        if (reservationManager) {
            const reserved = reservationManager.getReservedAmount(supply.buildingId, request.materialType);
            effectiveAmount = Math.max(0, effectiveAmount - reserved);
        }

        if (effectiveAmount <= 0) {
            continue;
        }

        const distance = hexDistance(sourceBuilding.x, sourceBuilding.y, destBuilding.x, destBuilding.y);

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
 * Match a resource request to the best available supply.
 *
 * Algorithm:
 * 1. Find all buildings with the requested material in their output slots
 * 2. Return the nearest source with sufficient quantity
 *
 * @param request The resource request to fulfill
 * @param gameState The game state with entities and inventories
 * @param inventoryManager The inventory manager for building inventories
 * @param options Matching options
 * @returns The best match, or null if no suitable source found
 */
export function matchRequestToSupply(
    request: ResourceRequest,
    gameState: GameState,
    inventoryManager: BuildingInventoryManager,
    options: MatchOptions = {}
): FulfillmentMatch | null {
    const fullSupplyDistanceFactor = options.fullSupplyDistanceFactor ?? DEFAULT_FULL_SUPPLY_DISTANCE_FACTOR;
    const candidates = iterateMatchCandidates(request, gameState, inventoryManager, options);
    const sorted = collectSortedMatches(candidates, request.amount);

    if (sorted.length === 0) {
        return null;
    }

    // Find the best candidate: prefer one with sufficient quantity, but accept partial
    let best = sorted[0]!;

    // Look for a candidate with enough material (accounting for reservations)
    for (const match of sorted) {
        if (match.amount >= request.amount) {
            // Prefer full-supply source if within the configured distance factor
            if (match.distance <= best.distance * fullSupplyDistanceFactor) {
                best = match;
                break;
            }
        }
    }

    return best;
}

/**
 * Find all possible matches for a request, sorted by distance.
 *
 * Useful when you want to present options or retry with different sources.
 *
 * @param request The resource request
 * @param gameState The game state
 * @param inventoryManager The inventory manager for building inventories
 * @param options Matching options
 * @returns Array of all possible matches, sorted by distance
 */
export function findAllMatches(
    request: ResourceRequest,
    gameState: GameState,
    inventoryManager: BuildingInventoryManager,
    options: MatchOptions = {}
): FulfillmentMatch[] {
    const candidates = iterateMatchCandidates(request, gameState, inventoryManager, options);
    return collectSortedMatches(candidates, request.amount);
}

/**
 * Check if a request can potentially be fulfilled.
 *
 * This is a quick check that doesn't do full matching -
 * just verifies that there's any supply of the material
 * and that the destination building exists.
 *
 * @param request The resource request
 * @param gameState The game state
 * @param inventoryManager The inventory manager for building inventories
 * @returns True if fulfillment is potentially possible
 */
export function canPotentiallyFulfill(
    request: ResourceRequest,
    gameState: GameState,
    inventoryManager: BuildingInventoryManager
): boolean {
    // Check destination exists
    if (!gameState.getEntity(request.buildingId)) {
        return false;
    }

    // Check there's any supply
    const buildingIds = inventoryManager.getBuildingsWithOutput(request.materialType, 1);

    // Need at least one supply that isn't the destination
    return buildingIds.some((id: number) => id !== request.buildingId);
}

/**
 * Estimate the best distance for fulfilling a request.
 *
 * Returns the distance to the nearest supply.
 * Useful for UI display or rough planning.
 *
 * @param request The resource request
 * @param gameState The game state
 * @param inventoryManager The inventory manager for building inventories
 * @returns The minimum distance, or Infinity if no supply exists
 */
export function estimateFulfillmentDistance(
    request: ResourceRequest,
    gameState: GameState,
    inventoryManager: BuildingInventoryManager
): number {
    const destBuilding = gameState.getEntity(request.buildingId);
    if (!destBuilding) {
        return Infinity;
    }

    const supplies = getAvailableSupplies(gameState, inventoryManager, request.materialType);
    let minDistance = Infinity;

    for (const supply of supplies) {
        if (supply.buildingId === request.buildingId) {
            continue;
        }

        const sourceBuilding = gameState.getEntity(supply.buildingId);
        if (!sourceBuilding) {
            continue;
        }

        const distance = hexDistance(sourceBuilding.x, sourceBuilding.y, destBuilding.x, destBuilding.y);

        if (distance < minDistance) {
            minDistance = distance;
        }
    }

    return minDistance;
}
