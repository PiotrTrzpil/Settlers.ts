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
 * - Legacy: canPlaceBuildingFootprint, canPlaceResource (backward compatibility)
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

// Unified validators
export {
    validatePlacement,
    canPlaceEntity,
    createPlacementValidator,
    createDetailedPlacementValidator,
} from './placement-validator';

// Terrain checks (needed by movement, pathfinding, etc.)
export { isPassable, isBuildable } from './internal/terrain';

// Legacy/convenience exports (backward compatibility)
export { canPlaceBuildingFootprint, canPlaceBuilding } from './internal/building-validator';
export { canPlaceResource } from './internal/resource-validator';
export { canPlaceUnit } from './internal/unit-validator';

// Slope utilities (for indicator renderer)
export { MAX_SLOPE_DIFF, computeSlopeDifficulty } from './internal/slope';
