/**
 * Logistics Feature Module
 *
 * Provides demand queuing and transport job fulfillment for the carrier system.
 *
 * This module handles:
 * - Demand queue: Buildings declare material needs (stateless entries)
 * - Resource supply discovery: Finding buildings with available materials
 * - Transport job store: Single source of truth for all active deliveries
 * - Fulfillment matching: Matching demands to supplies by distance
 */

// Resource supply types and helpers
export {
    type ResourceSupply,
    type SupplySearchOptions,
    getAvailableSupplies,
    hasAnySupply,
    getTotalSupply,
} from './resource-supply';

// Demand queue (replaces RequestManager)
export { DemandQueue, type DemandEntry, DemandPriority } from './demand-queue';

// Fulfillment matching
export {
    type FulfillmentMatch,
    type MatchOptions,
    type MatchableRequest,
    matchRequestToSupply,
    findAllMatches,
    canPotentiallyFulfill,
    estimateFulfillmentDistance,
} from './fulfillment-matcher';

// Fulfillment diagnostics (debug panel support)
export {
    type UnfulfilledReason,
    UNFULFILLED_REASON_LABELS,
    type DiagnosticConfig,
    diagnoseUnfulfilledRequest,
} from './fulfillment-diagnostics';

// Transport job record + service (flat data + stateless lifecycle)
export { TransportPhase, type TransportJobRecord } from './transport-job-record';
export * as TransportJobService from './transport-job-service';
export type { TransportJobDeps } from './transport-job-service';

// Transport job store (single source of truth for all active jobs)
export { TransportJobStore } from './transport-job-store';

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
} from './transport-job-builder';

// Stall detector (cancels timed-out in-progress requests)
export { StallDetector, type StallDetectorConfig } from './stall-detector';

// Match diagnostics (throttled logging of unmatched requests)
export { MatchDiagnostics, type MatchDiagnosticsConfig } from './match-diagnostics';

// Logistics dispatcher (connects demands to carriers)
export { LogisticsDispatcher, type LogisticsDispatcherConfig } from './logistics-dispatcher';

// Logistics filter types (pluggable policy enforcement)
export type { LogisticsMatchFilter, CarrierFilter } from './logistics-filter';

// Logistics snapshot (CLI + debug panel data gathering)
export type {
    SnapshotConfig,
    LogisticsStats,
    LogisticsDebugState,
    DemandSummary,
    CarrierSummary,
    ProductionBuildingSummary,
    SlotSummary,
    PileSummary,
    WorkerSummary,
    TransportJobSummary,
    BottleneckDiag,
} from './logistics-snapshot';
export {
    gatherLogisticsSnapshot,
    gatherDemands,
    gatherCarriers,
    gatherProductionBuildings,
    gatherPiles,
    gatherWorkers,
    gatherTransportJobs,
    detectBottlenecks,
    formatMaterial,
    createEmptyState,
} from './logistics-snapshot';

// Feature definitions (self-registering via FeatureRegistry)
export { DemandQueueFeature, type DemandQueueExports } from './demand-queue-feature';
export { LogisticsDispatcherFeature, type LogisticsDispatcherExports } from './logistics-dispatcher-feature';
