/**
 * Placement Validation Feature Module
 *
 * Self-contained module for entity placement validation.
 * External code should only import from this file.
 *
 * Public API:
 * - Types: PlacementStatus, PlacementContext, PlacementResult, PlacementEntityType
 * - Validators: validatePlacement, canPlaceEntity
 * - Factories: createPlacementValidator, createDetailedPlacementValidator
 * - Terrain: isPassable, isBuildable (for movement, pathfinding)
 * - Slope: MAX_SLOPE_DIFF, computeSlopeDifficulty (for indicator renderer)
 * - Convenience: canPlaceBuildingFootprint, canPlaceResource, canPlaceUnit
 */

// Types
export type {
    PlacementContext,
    PlacementResult,
    PlacementEntityType,
    PlacementValidator,
    DetailedPlacementValidator,
} from './types';
export { PlacementStatus } from './types';

// Unified validators and convenience wrappers
export {
    validatePlacement,
    canPlaceEntity,
    createPlacementValidator,
    createDetailedPlacementValidator,
    canPlaceBuildingFootprint,
    canPlaceBuilding,
    canPlaceResource,
    canPlaceUnit,
} from './placement-validator';

// Terrain checks (needed by movement, pathfinding, etc.)
export { isPassable, isBuildable } from './terrain';

// Slope utilities (for indicator renderer)
export { MAX_SLOPE_DIFF, computeSlopeDifficulty } from './slope';
