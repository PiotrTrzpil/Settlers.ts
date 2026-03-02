/**
 * Service Areas Feature Module
 *
 * Manages the service areas for logistics hubs in the game.
 * Service areas define the operational range of carriers assigned to a hub.
 *
 * In the Settlers.ts design, the following building types can have service areas:
 * - ResidenceSmall, ResidenceMedium, ResidenceBig - Act as taverns/carrier bases
 * - StorageArea - Storage areas that can have their own service areas
 *
 * Public API:
 * - Feature: ServiceAreaFeature (self-registering via FeatureRegistry)
 * - Types: ServiceArea, ServiceAreaExports, ServiceAreaEvents, BuildingQueryOptions, BuildingWithDistance
 * - Constants: DEFAULT_SERVICE_RADIUS, MIN_SERVICE_RADIUS, MAX_SERVICE_RADIUS
 * - Manager: ServiceAreaManager (with event system)
 * - Queries: getBuildingsInServiceArea, getHubsServingPosition,
 *            getNearestHubForPosition, isPositionInAnyServiceArea,
 *            getBuildingsInServiceAreaByDistance, getHubsServingBothPositions
 */

// Types and constants
export type { ServiceArea } from './service-area';
export {
    DEFAULT_SERVICE_RADIUS,
    MIN_SERVICE_RADIUS,
    MAX_SERVICE_RADIUS,
    DEFAULT_HUB_CAPACITY,
    HUB_CARRIER_CAPACITY,
    createServiceArea,
    clampRadius,
    getHubCapacity,
} from './service-area';

// Manager (with events)
export { ServiceAreaManager } from './service-area-manager';
export type { ServiceAreaEvents, ServiceAreaEventListener } from './service-area-manager';

// Query types and functions
export type { BuildingQueryOptions, BuildingWithDistance } from './service-area-queries';
export {
    isPositionInServiceArea,
    getBuildingsInServiceArea,
    getHubsServingPosition,
    getNearestHubForPosition,
    isPositionInAnyServiceArea,
    getBuildingsInServiceAreaByDistance,
    getHubsServingBothPositions,
    // Legacy aliases (deprecated) — intentional backward-compat shims, keep for external callers
    // eslint-disable-next-line @typescript-eslint/no-deprecated -- backward-compat re-export shims
    getTavernsServingBuilding,
    // eslint-disable-next-line @typescript-eslint/no-deprecated -- backward-compat re-export shims
    getNearestTavernForBuilding,
    // eslint-disable-next-line @typescript-eslint/no-deprecated -- backward-compat re-export shims
    getTavernsServingBothPositions,
} from './service-area-queries';

// Feature definition (self-registering via FeatureRegistry)
export { ServiceAreaFeature, type ServiceAreaExports } from './service-area-feature';
