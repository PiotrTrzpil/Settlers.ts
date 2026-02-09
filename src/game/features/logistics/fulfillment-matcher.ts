/**
 * Fulfillment Matcher
 *
 * Matches resource requests to available supplies, considering service area
 * constraints and distance optimization.
 */

import { hexDistance } from '../../systems/hex-directions';
import type { GameState } from '../../game-state';
import type { ServiceAreaManager } from '../service-areas/service-area-manager';
import { getHubsServingBothPositions } from '../service-areas/service-area-queries';
import type { ResourceRequest } from './resource-request';
import { getAvailableSupplies, type ResourceSupply } from './resource-supply';
import type { InventoryReservationManager } from './inventory-reservation';

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
    /** Entity IDs of hubs that can service both buildings */
    serviceHubs: number[];
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
    /** Require at least one hub to service both buildings */
    requireServiceArea?: boolean;
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

/**
 * Match a resource request to the best available supply.
 *
 * Algorithm:
 * 1. Find all buildings with the requested material in their output slots
 * 2. Filter to buildings that share a service area with the destination
 * 3. Return the nearest source with sufficient quantity
 *
 * @param request The resource request to fulfill
 * @param gameState The game state with entities and inventories
 * @param serviceAreaManager Manager for service area queries
 * @param options Matching options
 * @returns The best match, or null if no suitable source found
 */
export function matchRequestToSupply(
    request: ResourceRequest,
    gameState: GameState,
    serviceAreaManager: ServiceAreaManager,
    options: MatchOptions = {},
): FulfillmentMatch | null {
    const {
        playerId,
        requireServiceArea = true,
        fullSupplyDistanceFactor = DEFAULT_FULL_SUPPLY_DISTANCE_FACTOR,
        reservationManager,
    } = options;

    // Get the destination building position
    const destBuilding = gameState.getEntity(request.buildingId);
    if (!destBuilding) {
        return null;
    }

    // Find all supplies of this material type
    const supplies = getAvailableSupplies(gameState, request.materialType, {
        playerId,
        minAmount: 1, // We'll take partial fulfillment
    });

    if (supplies.length === 0) {
        return null;
    }

    // Score each supply by distance, filtering by service area reachability
    const candidates: Array<{
        supply: ResourceSupply;
        /** Effective available amount (accounting for reservations) */
        effectiveAmount: number;
        distance: number;
        serviceHubs: number[];
    }> = [];

    for (const supply of supplies) {
        // Skip if source is the same as destination
        if (supply.buildingId === request.buildingId) {
            continue;
        }

        const sourceBuilding = gameState.getEntity(supply.buildingId);
        if (!sourceBuilding) {
            continue;
        }

        // Calculate effective available amount (accounting for reservations)
        let effectiveAmount = supply.availableAmount;
        if (reservationManager) {
            const reserved = reservationManager.getReservedAmount(
                supply.buildingId,
                request.materialType,
            );
            effectiveAmount = Math.max(0, effectiveAmount - reserved);
        }

        // Skip if no effective supply after reservations
        if (effectiveAmount <= 0) {
            continue;
        }

        // Find hubs that can service both buildings
        const serviceHubs = getHubsServingBothPositions(
            sourceBuilding.x,
            sourceBuilding.y,
            destBuilding.x,
            destBuilding.y,
            serviceAreaManager,
            { playerId },
        );

        // If we require service area coverage, skip sources without any hubs
        if (requireServiceArea && serviceHubs.length === 0) {
            continue;
        }

        // Calculate distance
        const distance = hexDistance(
            sourceBuilding.x,
            sourceBuilding.y,
            destBuilding.x,
            destBuilding.y,
        );

        candidates.push({
            supply,
            effectiveAmount,
            distance,
            serviceHubs,
        });
    }

    if (candidates.length === 0) {
        return null;
    }

    // Sort by distance (nearest first)
    candidates.sort((a, b) => a.distance - b.distance);

    // Find the best candidate: prefer one with sufficient quantity, but accept partial
    let bestCandidate = candidates[0];

    // Look for a candidate with enough material (accounting for reservations)
    for (const candidate of candidates) {
        if (candidate.effectiveAmount >= request.amount) {
            // Found one with enough - check if it's close enough to be worth it
            // If this full-supply source is within the configured distance factor, prefer it
            if (candidate.distance <= bestCandidate.distance * fullSupplyDistanceFactor) {
                bestCandidate = candidate;
                break;
            }
        }
    }

    return {
        sourceBuilding: bestCandidate.supply.buildingId,
        amount: Math.min(bestCandidate.effectiveAmount, request.amount),
        distance: bestCandidate.distance,
        serviceHubs: bestCandidate.serviceHubs,
    };
}

/**
 * Find all possible matches for a request, sorted by distance.
 *
 * Useful when you want to present options or retry with different sources.
 *
 * @param request The resource request
 * @param gameState The game state
 * @param serviceAreaManager Service area manager
 * @param options Matching options
 * @returns Array of all possible matches, sorted by distance
 */
export function findAllMatches(
    request: ResourceRequest,
    gameState: GameState,
    serviceAreaManager: ServiceAreaManager,
    options: MatchOptions = {},
): FulfillmentMatch[] {
    const { playerId, requireServiceArea = true, reservationManager } = options;

    const destBuilding = gameState.getEntity(request.buildingId);
    if (!destBuilding) {
        return [];
    }

    const supplies = getAvailableSupplies(gameState, request.materialType, {
        playerId,
        minAmount: 1,
    });

    const matches: FulfillmentMatch[] = [];

    for (const supply of supplies) {
        if (supply.buildingId === request.buildingId) {
            continue;
        }

        const sourceBuilding = gameState.getEntity(supply.buildingId);
        if (!sourceBuilding) {
            continue;
        }

        // Calculate effective available amount (accounting for reservations)
        let effectiveAmount = supply.availableAmount;
        if (reservationManager) {
            const reserved = reservationManager.getReservedAmount(
                supply.buildingId,
                request.materialType,
            );
            effectiveAmount = Math.max(0, effectiveAmount - reserved);
        }

        // Skip if no effective supply
        if (effectiveAmount <= 0) {
            continue;
        }

        const serviceHubs = getHubsServingBothPositions(
            sourceBuilding.x,
            sourceBuilding.y,
            destBuilding.x,
            destBuilding.y,
            serviceAreaManager,
            { playerId },
        );

        if (requireServiceArea && serviceHubs.length === 0) {
            continue;
        }

        const distance = hexDistance(
            sourceBuilding.x,
            sourceBuilding.y,
            destBuilding.x,
            destBuilding.y,
        );

        matches.push({
            sourceBuilding: supply.buildingId,
            amount: Math.min(effectiveAmount, request.amount),
            distance,
            serviceHubs,
        });
    }

    matches.sort((a, b) => a.distance - b.distance);

    return matches;
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
 * @returns True if fulfillment is potentially possible
 */
export function canPotentiallyFulfill(
    request: ResourceRequest,
    gameState: GameState,
): boolean {
    // Check destination exists
    if (!gameState.getEntity(request.buildingId)) {
        return false;
    }

    // Check there's any supply
    const buildingIds = gameState.inventoryManager.getBuildingsWithOutput(
        request.materialType,
        1,
    );

    // Need at least one supply that isn't the destination
    return buildingIds.some(id => id !== request.buildingId);
}

/**
 * Estimate the best distance for fulfilling a request.
 *
 * Returns the distance to the nearest supply, ignoring service area constraints.
 * Useful for UI display or rough planning.
 *
 * @param request The resource request
 * @param gameState The game state
 * @returns The minimum distance, or Infinity if no supply exists
 */
export function estimateFulfillmentDistance(
    request: ResourceRequest,
    gameState: GameState,
): number {
    const destBuilding = gameState.getEntity(request.buildingId);
    if (!destBuilding) {
        return Infinity;
    }

    const supplies = getAvailableSupplies(gameState, request.materialType);
    let minDistance = Infinity;

    for (const supply of supplies) {
        if (supply.buildingId === request.buildingId) {
            continue;
        }

        const sourceBuilding = gameState.getEntity(supply.buildingId);
        if (!sourceBuilding) {
            continue;
        }

        const distance = hexDistance(
            sourceBuilding.x,
            sourceBuilding.y,
            destBuilding.x,
            destBuilding.y,
        );

        if (distance < minDistance) {
            minDistance = distance;
        }
    }

    return minDistance;
}
