/**
 * Service Area Types
 *
 * Service areas define the operational range of taverns.
 * Carriers assigned to a tavern can only serve buildings within its service area.
 */

/**
 * Default service area radius in tiles.
 * This determines how far from the tavern carriers will travel by default.
 */
export const DEFAULT_SERVICE_RADIUS = 15;

/**
 * Service area configuration for a tavern.
 *
 * The service area is a circular region centered on the tavern (or an offset position).
 * All buildings within this radius can be served by carriers from this tavern.
 */
export interface ServiceArea {
    /** Entity ID of the tavern that owns this service area */
    readonly tavernId: number;
    /** X coordinate of the service area center (usually tavern position) */
    centerX: number;
    /** Y coordinate of the service area center (usually tavern position) */
    centerY: number;
    /** Radius of the service area in tiles */
    radius: number;
}

/**
 * Create a new ServiceArea.
 */
export function createServiceArea(
    tavernId: number,
    centerX: number,
    centerY: number,
    radius: number = DEFAULT_SERVICE_RADIUS,
): ServiceArea {
    return {
        tavernId,
        centerX,
        centerY,
        radius,
    };
}
