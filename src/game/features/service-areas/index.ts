/**
 * Service Areas Feature Module
 *
 * Manages the service areas for taverns in the logistics system.
 * Service areas define the operational range of carriers assigned to a tavern.
 *
 * Public API:
 * - Types: ServiceArea
 * - Constants: DEFAULT_SERVICE_RADIUS
 * - Manager: ServiceAreaManager
 * - Queries: getBuildingsInServiceArea, getTavernsServingBuilding,
 *            getNearestTavernForBuilding, isPositionInAnyServiceArea,
 *            getBuildingsInServiceAreaByDistance, getTavernsServingBothPositions
 */

// Types and constants
export type { ServiceArea } from './service-area';
export { DEFAULT_SERVICE_RADIUS, createServiceArea } from './service-area';

// Manager
export { ServiceAreaManager } from './service-area-manager';

// Query functions
export {
    isPositionInServiceArea,
    getBuildingsInServiceArea,
    getTavernsServingBuilding,
    getNearestTavernForBuilding,
    isPositionInAnyServiceArea,
    getBuildingsInServiceAreaByDistance,
    getTavernsServingBothPositions,
} from './service-area-queries';
