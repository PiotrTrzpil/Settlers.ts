/**
 * Service Area Queries
 *
 * Functions for querying relationships between buildings, positions,
 * and service areas.
 */

import { hexDistance } from '../../systems/hex-directions';
import { EntityType } from '../../entity';
import type { GameState } from '../../game-state';
import type { ServiceArea } from './service-area';
import type { ServiceAreaManager } from './service-area-manager';

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
 * @returns Array of entity IDs of buildings within the service area
 */
export function getBuildingsInServiceArea(
    serviceArea: ServiceArea,
    gameState: GameState,
): number[] {
    const buildingIds: number[] = [];

    for (const entity of gameState.entities) {
        if (entity.type !== EntityType.Building) continue;

        if (isPositionInServiceArea(entity.x, entity.y, serviceArea)) {
            buildingIds.push(entity.id);
        }
    }

    return buildingIds;
}

/**
 * Get all taverns whose service areas cover a given building position.
 *
 * @param buildingX X coordinate of the building
 * @param buildingY Y coordinate of the building
 * @param serviceAreaManager Manager containing all service areas
 * @param gameState The game state (currently unused but included for consistency)
 * @returns Array of tavern entity IDs whose service areas cover this position
 */
export function getTavernsServingBuilding(
    buildingX: number,
    buildingY: number,
    serviceAreaManager: ServiceAreaManager,
    _gameState: GameState,
): number[] {
    const tavernIds: number[] = [];

    for (const serviceArea of serviceAreaManager.getAllServiceAreas()) {
        if (isPositionInServiceArea(buildingX, buildingY, serviceArea)) {
            tavernIds.push(serviceArea.tavernId);
        }
    }

    return tavernIds;
}

/**
 * Get the nearest tavern whose service area covers a given building position.
 *
 * If multiple taverns cover the position, returns the one closest to the building.
 *
 * @param buildingX X coordinate of the building
 * @param buildingY Y coordinate of the building
 * @param serviceAreaManager Manager containing all service areas
 * @param gameState The game state containing entity positions
 * @returns Entity ID of the nearest tavern, or undefined if none covers this position
 */
export function getNearestTavernForBuilding(
    buildingX: number,
    buildingY: number,
    serviceAreaManager: ServiceAreaManager,
    gameState: GameState,
): number | undefined {
    let nearestTavernId: number | undefined;
    let nearestDistance = Infinity;

    for (const serviceArea of serviceAreaManager.getAllServiceAreas()) {
        if (!isPositionInServiceArea(buildingX, buildingY, serviceArea)) {
            continue;
        }

        // Get the actual tavern entity to find its current position
        const tavern = gameState.getEntity(serviceArea.tavernId);
        if (!tavern) continue;

        const distance = hexDistance(buildingX, buildingY, tavern.x, tavern.y);
        if (distance < nearestDistance) {
            nearestDistance = distance;
            nearestTavernId = serviceArea.tavernId;
        }
    }

    return nearestTavernId;
}

/**
 * Check if a position is covered by any service area.
 *
 * @param x X coordinate to check
 * @param y Y coordinate to check
 * @param serviceAreaManager Manager containing all service areas
 * @returns true if the position is within at least one service area
 */
export function isPositionInAnyServiceArea(
    x: number,
    y: number,
    serviceAreaManager: ServiceAreaManager,
): boolean {
    for (const serviceArea of serviceAreaManager.getAllServiceAreas()) {
        if (isPositionInServiceArea(x, y, serviceArea)) {
            return true;
        }
    }
    return false;
}

/**
 * Get all buildings in a service area grouped by distance from the tavern.
 *
 * Useful for prioritizing carrier assignments based on proximity.
 *
 * @param serviceArea The service area to query
 * @param gameState The game state containing all entities
 * @returns Array of {buildingId, distance} sorted by distance (nearest first)
 */
export function getBuildingsInServiceAreaByDistance(
    serviceArea: ServiceArea,
    gameState: GameState,
): Array<{ buildingId: number; distance: number }> {
    const buildings: Array<{ buildingId: number; distance: number }> = [];

    for (const entity of gameState.entities) {
        if (entity.type !== EntityType.Building) continue;

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
 * Find all service areas that cover both a source and destination position.
 *
 * This is useful for finding taverns whose carriers can handle a delivery
 * between two buildings.
 *
 * @param sourceX Source X coordinate
 * @param sourceY Source Y coordinate
 * @param destX Destination X coordinate
 * @param destY Destination Y coordinate
 * @param serviceAreaManager Manager containing all service areas
 * @returns Array of tavern entity IDs whose service areas cover both positions
 */
export function getTavernsServingBothPositions(
    sourceX: number,
    sourceY: number,
    destX: number,
    destY: number,
    serviceAreaManager: ServiceAreaManager,
): number[] {
    const tavernIds: number[] = [];

    for (const serviceArea of serviceAreaManager.getAllServiceAreas()) {
        const coversSource = isPositionInServiceArea(sourceX, sourceY, serviceArea);
        const coversDest = isPositionInServiceArea(destX, destY, serviceArea);

        if (coversSource && coversDest) {
            tavernIds.push(serviceArea.tavernId);
        }
    }

    return tavernIds;
}
