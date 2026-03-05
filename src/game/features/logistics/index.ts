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
export { RequestManager, type RequestResetReason } from './request-manager';

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
export { type InventoryReservation, InventoryReservationManager } from './inventory-reservation';

// Fulfillment diagnostics (debug panel support)
export {
    type UnfulfilledReason,
    UNFULFILLED_REASON_LABELS,
    type DiagnosticConfig,
    diagnoseUnfulfilledRequest,
} from './fulfillment-diagnostics';

// Transport job (owns reservation + request lifecycle for a single delivery)
export { TransportJob, type TransportJobDeps, type TransportJobStatus } from './transport-job';

// Request matcher (supply matching with territory filtering)
export { RequestMatcher, type RequestMatcherConfig, type RequestMatchResult } from './request-matcher';

// Carrier assigner (finds idle carriers and creates transport jobs)
export {
    CarrierAssigner,
    type CarrierAssignerConfig,
    type AssignmentSuccess,
    type JobAssigner,
} from './carrier-assigner';

// Transport job builder (constructs ChoreoJobState for carrier transport)
export {
    TransportJobBuilder,
    type TransportJobBuilderConfig,
    type TransportPositionResolver,
    type ChoreographyLookup,
} from './transport-job-builder';

// Stall detector (cancels timed-out in-progress requests)
export { StallDetector, type StallDetectorConfig } from './stall-detector';

// Match diagnostics (throttled logging of unmatched requests)
export { MatchDiagnostics, type MatchDiagnosticsConfig } from './match-diagnostics';

// Logistics dispatcher (connects requests to carriers)
export { LogisticsDispatcher, type LogisticsDispatcherConfig } from './logistics-dispatcher';

// Logistics filter types (pluggable policy enforcement)
export type { LogisticsMatchFilter, CarrierFilter } from './logistics-filter';

// Feature definition (self-registering via FeatureRegistry)
export { RequestManagerFeature, type RequestManagerExports } from './request-manager-feature';
