/**
 * Logistics Feature Module
 *
 * Provides resource request and fulfillment matching for the carrier system.
 *
 * This module handles:
 * - Resource requests: Buildings request materials they need
 * - Resource supply discovery: Finding buildings with available materials
 * - Request management: Tracking pending/in-progress/fulfilled requests
 * - Fulfillment matching: Matching requests to supplies within service areas
 *
 * Usage:
 * ```typescript
 * import {
 *   RequestManager,
 *   RequestPriority,
 *   matchRequestToSupply,
 * } from '@/game/features/logistics';
 *
 * // Create a request for logs
 * const request = requestManager.addRequest(
 *   sawmillBuildingId,
 *   EMaterialType.LOG,
 *   4,
 *   RequestPriority.Normal,
 * );
 *
 * // Find a supply to fulfill it
 * const match = matchRequestToSupply(request, gameState, serviceAreaManager);
 * if (match) {
 *   // Assign a carrier to pick up from match.sourceBuilding
 * }
 * ```
 */

// Resource request types and helpers
export {
    type ResourceRequest,
    RequestPriority,
    RequestStatus,
    createResourceRequest,
    compareRequests,
    canAssignRequest,
    isRequestActive,
} from './resource-request';

// Resource supply types and helpers
export {
    type ResourceSupply,
    type SupplySearchOptions,
    getAvailableSupplies,
    getSuppliesInServiceArea,
    hasAnySupply,
    getTotalSupply,
} from './resource-supply';

// Request manager
export {
    RequestManager,
    type RequestManagerEvents,
    type RequestEventListener,
} from './request-manager';

// Fulfillment matching
export {
    type FulfillmentMatch,
    type MatchOptions,
    matchRequestToSupply,
    findAllMatches,
    canPotentiallyFulfill,
    estimateFulfillmentDistance,
} from './fulfillment-matcher';

// Inventory reservations (prevents race conditions)
export {
    type InventoryReservation,
    InventoryReservationManager,
} from './inventory-reservation';

// Logistics dispatcher (connects requests to carriers)
export {
    LogisticsDispatcher,
    type LogisticsDispatcherConfig,
} from './logistics-dispatcher';
