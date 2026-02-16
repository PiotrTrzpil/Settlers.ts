/**
 * Service Area Types
 *
 * Service areas define the operational range of taverns (or similar logistics hubs).
 * Carriers assigned to a tavern can only serve buildings within its service area.
 *
 * Note: The PRD refers to "taverns" but the current BuildingType enum doesn't have
 * a Tavern type yet. For now, any building can have a service area attached to it.
 * The integration step will determine which building types should have service areas.
 */

import { BuildingType } from '../../buildings/types';

/**
 * Default service area radius in tiles.
 * This determines how far from the tavern carriers will travel by default.
 */
export const DEFAULT_SERVICE_RADIUS = 40;

/**
 * Default carrier capacity when not specified by building type.
 */
export const DEFAULT_HUB_CAPACITY = 6;

/**
 * Carrier capacity per hub building type.
 * Determines the maximum number of carriers that can be assigned to each hub.
 */
export const HUB_CARRIER_CAPACITY: Partial<Record<BuildingType, number>> = {
    [BuildingType.ResidenceSmall]: 4, // Spawns 2, can hold 4
    [BuildingType.ResidenceMedium]: 8, // Spawns 4, can hold 8
    [BuildingType.ResidenceBig]: 12, // Spawns 6, can hold 12
};

/**
 * Get the carrier capacity for a building type.
 * Returns the configured capacity or DEFAULT_HUB_CAPACITY if not specified.
 */
export function getHubCapacity(buildingType: BuildingType): number {
    return HUB_CARRIER_CAPACITY[buildingType] ?? DEFAULT_HUB_CAPACITY;
}

/**
 * Minimum allowed service area radius.
 */
export const MIN_SERVICE_RADIUS = 1;

/**
 * Maximum allowed service area radius.
 * Prevents performance issues from extremely large areas.
 */
export const MAX_SERVICE_RADIUS = 50;

/**
 * Service area configuration for a logistics hub (tavern).
 *
 * The service area is a circular region centered on the building (or an offset position).
 * All buildings within this radius can be served by carriers from this hub.
 */
export interface ServiceArea {
    /** Entity ID of the building that owns this service area */
    readonly buildingId: number;
    /** Player ID who owns this service area (for filtering) */
    readonly playerId: number;
    /** X coordinate of the service area center (usually building position) */
    centerX: number;
    /** Y coordinate of the service area center (usually building position) */
    centerY: number;
    /** Radius of the service area in tiles */
    radius: number;
    /** Maximum number of carriers this hub can support */
    readonly capacity: number;
    /** Building type of the hub (used for capacity lookup) */
    readonly buildingType: BuildingType;
}

/**
 * Create a new ServiceArea.
 *
 * @param buildingId Entity ID of the building (tavern) that owns this area
 * @param playerId Player who owns this service area
 * @param centerX X coordinate of the center
 * @param centerY Y coordinate of the center
 * @param buildingType Building type (used for capacity lookup)
 * @param radius Radius in tiles (clamped to MIN/MAX)
 */
export function createServiceArea(
    buildingId: number,
    playerId: number,
    centerX: number,
    centerY: number,
    buildingType: BuildingType,
    radius: number = DEFAULT_SERVICE_RADIUS
): ServiceArea {
    return {
        buildingId,
        playerId,
        centerX,
        centerY,
        radius: clampRadius(radius),
        capacity: getHubCapacity(buildingType),
        buildingType,
    };
}

/**
 * Clamp radius to valid range.
 */
export function clampRadius(radius: number): number {
    return Math.max(MIN_SERVICE_RADIUS, Math.min(MAX_SERVICE_RADIUS, radius));
}
