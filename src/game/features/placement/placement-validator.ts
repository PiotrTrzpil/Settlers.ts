/**
 * Unified placement validation for any entity type.
 * Delegates to type-specific validators while providing a consistent API.
 */

import type { BuildingType } from '../../entity';
import type {
    PlacementContext,
    PlacementResult,
    PlacementEntityType,
    PlacementValidator,
    DetailedPlacementValidator,
} from './types';
import { PlacementStatus } from './types';
import { validateBuildingPlacement } from './internal/building-validator';
import { validateResourcePlacement } from './internal/resource-validator';
import { validateUnitPlacement } from './internal/unit-validator';

/**
 * Validate entity placement with detailed status.
 * Routes to the appropriate validator based on entity type.
 *
 * @param entityType The type of entity being placed
 * @param subType The specific subtype (BuildingType, EMaterialType, etc)
 * @param x X coordinate
 * @param y Y coordinate
 * @param ctx Game context for validation
 * @returns Placement result with canPlace and detailed status
 */
export function validatePlacement(
    entityType: PlacementEntityType,
    subType: number,
    x: number,
    y: number,
    ctx: PlacementContext
): PlacementResult {
    switch (entityType) {
    case 'building':
        return validateBuildingPlacement(x, y, subType as BuildingType, ctx);

    case 'resource':
        return validateResourcePlacement(x, y, ctx);

    case 'unit':
        return validateUnitPlacement(x, y, ctx);

    default:
        // Unknown entity type - reject
        return { canPlace: false, status: PlacementStatus.InvalidTerrain };
    }
}

/**
 * Simple boolean check for entity placement.
 * Use validatePlacement for detailed status.
 */
export function canPlaceEntity(
    entityType: PlacementEntityType,
    subType: number,
    x: number,
    y: number,
    ctx: PlacementContext
): boolean {
    return validatePlacement(entityType, subType, x, y, ctx).canPlace;
}

/**
 * Create a simple placement validator function for use with placement modes.
 * Captures game context and returns a function matching the mode's validator signature.
 *
 * @param entityType The entity type being validated
 * @param getContext Function to get current game context
 * @returns Validator function for the placement mode
 */
export function createPlacementValidator(
    entityType: PlacementEntityType,
    getContext: () => PlacementContext | null
): PlacementValidator {
    return (x: number, y: number, subType: number) => {
        const ctx = getContext();
        if (!ctx) return false;
        return canPlaceEntity(entityType, subType, x, y, ctx);
    };
}

/**
 * Create a detailed placement validator that returns status information.
 * Useful for visual feedback (indicator colors, status messages).
 *
 * @param entityType The entity type being validated
 * @param getContext Function to get current game context
 * @returns Detailed validator function
 */
export function createDetailedPlacementValidator(
    entityType: PlacementEntityType,
    getContext: () => PlacementContext | null
): DetailedPlacementValidator {
    return (x: number, y: number, subType: number) => {
        const ctx = getContext();
        if (!ctx) {
            return { canPlace: false, status: PlacementStatus.InvalidTerrain };
        }
        return validatePlacement(entityType, subType, x, y, ctx);
    };
}
