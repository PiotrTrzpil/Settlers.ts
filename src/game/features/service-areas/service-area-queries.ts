/**
 * Service Area Queries
 *
 * Functions for querying relationships between buildings, positions,
 * and service areas.
 *
 * Design decisions:
 * - Multi-tile buildings: A building is "in range" if its anchor position is within the radius.
 *   This is intentional - we don't want a 3x3 building to be considered "in range" just because
 *   one corner tile touches the service area. The anchor position represents where carriers
 *   would pick up/deliver goods.
 * - Player filtering: Most queries accept an optional playerId parameter to filter results
 *   to only include buildings from a specific player. This is important for logistics
 *   since carriers should only serve their own player's buildings.
 */

import { hexDistance } from '../../systems/hex-directions';
import { EntityType } from '../../entity';
import type { GameState } from '../../game-state';
import type { ServiceArea } from './service-area';
import type { ServiceAreaManager } from './service-area-manager';

/**
 * Options for building queries.
 */
export interface BuildingQueryOptions {
    /** If specified, only include buildings owned by this player */
    playerId?: number;
    /** If true, include the service area's own building in results (default: true) */
    includeSelf?: boolean;
}

/**
 * Check if a position is within a service area.
 *
 * Uses hex grid distance calculation for accurate results.
 *
 * @param x X coordinate to check
 * @param y Y coordinate to check
 * @param serviceArea The service area to check against
 * @returns true if the position is within the service area
 */
export function isPositionInServiceArea(
    x: number,
    y: number,
    serviceArea: ServiceArea,
): boolean {
    const distance = hexDistance(x, y, serviceArea.centerX, serviceArea.centerY);
    return distance <= serviceArea.radius;
}

/**
 * Get all buildings within a service area.
 *
 * @param serviceArea The service area to query
 * @param gameState The game state containing all entities
 * @param options Query options (player filtering, include self)
 * @returns Array of entity IDs of buildings within the service area
 */
export function getBuildingsInServiceArea(
    serviceArea: ServiceArea,
    gameState: GameState,
    options: BuildingQueryOptions = {},
): number[] {
    const { playerId, includeSelf = true } = options;
    const buildingIds: number[] = [];

    for (const entity of gameState.entities) {
        if (entity.type !== EntityType.Building) continue;

        // Filter by player if specified
        if (playerId !== undefined && entity.player !== playerId) continue;

        // Optionally exclude the service area's own building
        if (!includeSelf && entity.id === serviceArea.buildingId) continue;

        if (isPositionInServiceArea(entity.x, entity.y, serviceArea)) {
            buildingIds.push(entity.id);
        }
    }

    return buildingIds;
}

/**
 * Get all service area hubs whose areas cover a given position.
 *
 * @param x X coordinate to check
 * @param y Y coordinate to check
 * @param serviceAreaManager Manager containing all service areas
 * @param options Query options
 * @returns Array of building entity IDs whose service areas cover this position
 */
export function getHubsServingPosition(
    x: number,
    y: number,
    serviceAreaManager: ServiceAreaManager,
    options: BuildingQueryOptions = {},
): number[] {
    const { playerId } = options;
    const hubIds: number[] = [];

    for (const serviceArea of serviceAreaManager.getAllServiceAreas()) {
        // Filter by player if specified
        if (playerId !== undefined && serviceArea.playerId !== playerId) continue;

        if (isPositionInServiceArea(x, y, serviceArea)) {
            hubIds.push(serviceArea.buildingId);
        }
    }

    return hubIds;
}

/**
 * Get the nearest service area hub that covers a given position.
 *
 * If multiple hubs cover the position, returns the one closest to the position.
 *
 * @param x X coordinate to check
 * @param y Y coordinate to check
 * @param serviceAreaManager Manager containing all service areas
 * @param gameState The game state containing entity positions
 * @param options Query options
 * @returns Entity ID of the nearest hub, or undefined if none covers this position
 */
export function getNearestHubForPosition(
    x: number,
    y: number,
    serviceAreaManager: ServiceAreaManager,
    gameState: GameState,
    options: BuildingQueryOptions = {},
): number | undefined {
    const { playerId } = options;
    let nearestHubId: number | undefined;
    let nearestDistance = Infinity;

    for (const serviceArea of serviceAreaManager.getAllServiceAreas()) {
        // Filter by player if specified
        if (playerId !== undefined && serviceArea.playerId !== playerId) continue;

        if (!isPositionInServiceArea(x, y, serviceArea)) {
            continue;
        }

        // Get the actual hub entity to find its current position
        const hub = gameState.getEntity(serviceArea.buildingId);
        if (!hub) continue;

        const distance = hexDistance(x, y, hub.x, hub.y);
        if (distance < nearestDistance) {
            nearestDistance = distance;
            nearestHubId = serviceArea.buildingId;
        }
    }

    return nearestHubId;
}

/**
 * Check if a position is covered by any service area.
 *
 * @param x X coordinate to check
 * @param y Y coordinate to check
 * @param serviceAreaManager Manager containing all service areas
 * @param options Query options (e.g., filter by player)
 * @returns true if the position is within at least one service area
 */
export function isPositionInAnyServiceArea(
    x: number,
    y: number,
    serviceAreaManager: ServiceAreaManager,
    options: BuildingQueryOptions = {},
): boolean {
    const { playerId } = options;

    for (const serviceArea of serviceAreaManager.getAllServiceAreas()) {
        // Filter by player if specified
        if (playerId !== undefined && serviceArea.playerId !== playerId) continue;

        if (isPositionInServiceArea(x, y, serviceArea)) {
            return true;
        }
    }
    return false;
}

/**
 * Result item for distance-based building queries.
 */
export interface BuildingWithDistance {
    buildingId: number;
    distance: number;
}

/**
 * Get all buildings in a service area sorted by distance from the center.
 *
 * Useful for prioritizing carrier assignments based on proximity.
 *
 * @param serviceArea The service area to query
 * @param gameState The game state containing all entities
 * @param options Query options
 * @returns Array of {buildingId, distance} sorted by distance (nearest first)
 */
export function getBuildingsInServiceAreaByDistance(
    serviceArea: ServiceArea,
    gameState: GameState,
    options: BuildingQueryOptions = {},
): BuildingWithDistance[] {
    const { playerId, includeSelf = true } = options;
    const buildings: BuildingWithDistance[] = [];

    for (const entity of gameState.entities) {
        if (entity.type !== EntityType.Building) continue;

        // Filter by player if specified
        if (playerId !== undefined && entity.player !== playerId) continue;

        // Optionally exclude the service area's own building
        if (!includeSelf && entity.id === serviceArea.buildingId) continue;

        const distance = hexDistance(
            entity.x,
            entity.y,
            serviceArea.centerX,
            serviceArea.centerY,
        );

        if (distance <= serviceArea.radius) {
            buildings.push({ buildingId: entity.id, distance });
        }
    }

    // Sort by distance (nearest first)
    buildings.sort((a, b) => a.distance - b.distance);

    return buildings;
}

/**
 * Find all service area hubs that cover both a source and destination position.
 *
 * This is useful for finding hubs whose carriers can handle a delivery
 * between two buildings without needing a handoff.
 *
 * @param sourceX Source X coordinate
 * @param sourceY Source Y coordinate
 * @param destX Destination X coordinate
 * @param destY Destination Y coordinate
 * @param serviceAreaManager Manager containing all service areas
 * @param options Query options
 * @returns Array of hub building IDs whose service areas cover both positions
 */
export function getHubsServingBothPositions(
    sourceX: number,
    sourceY: number,
    destX: number,
    destY: number,
    serviceAreaManager: ServiceAreaManager,
    options: BuildingQueryOptions = {},
): number[] {
    const { playerId } = options;
    const hubIds: number[] = [];

    for (const serviceArea of serviceAreaManager.getAllServiceAreas()) {
        // Filter by player if specified
        if (playerId !== undefined && serviceArea.playerId !== playerId) continue;

        const coversSource = isPositionInServiceArea(sourceX, sourceY, serviceArea);
        const coversDest = isPositionInServiceArea(destX, destY, serviceArea);

        if (coversSource && coversDest) {
            hubIds.push(serviceArea.buildingId);
        }
    }

    return hubIds;
}

// === Legacy aliases for backward compatibility ===
// These will be removed in a future version

/**
 * @deprecated Use getHubsServingPosition instead
 */
export const getTavernsServingBuilding = getHubsServingPosition;

/**
 * @deprecated Use getNearestHubForPosition instead
 */
export const getNearestTavernForBuilding = getNearestHubForPosition;

/**
 * @deprecated Use getHubsServingBothPositions instead
 */
export const getTavernsServingBothPositions = getHubsServingBothPositions;
