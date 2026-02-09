/**
 * Service Areas Feature Module
 *
 * Manages the service areas for logistics hubs in the game.
 * Service areas define the operational range of carriers assigned to a hub.
 *
 * In the Settlers.ts design, the following building types can have service areas:
 * - ResidenceSmall, ResidenceMedium, ResidenceBig - Act as taverns/carrier bases
 * - StorageArea - Warehouses that can have their own service areas
 *
 * Public API:
 * - Types: ServiceArea, ServiceAreaEvents, BuildingQueryOptions, BuildingWithDistance
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
    createServiceArea,
    clampRadius,
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
    // Legacy aliases (deprecated)
    getTavernsServingBuilding,
    getNearestTavernForBuilding,
    getTavernsServingBothPositions,
} from './service-area-queries';
