/**
 * Game Systems Module
 *
 * Core systems for game logic including coordinate transforms,
 * pathfinding, animation, and entity management.
 *
 * @module systems
 */

// ============================================================================
// Coordinate System
// ============================================================================
export {
    // Constants
    TILE_HEIGHT_SCALE,
    TILE_CENTER_X,
    TILE_CENTER_Y,
    MAX_HEIGHT_ITERATIONS,
    MAX_SCREEN_TO_TILE_ITERATIONS,

    // Conversion functions
    heightToWorld,
    worldToHeight,
    splitViewPoint,
    screenToNdc,
    ndcToScreen,
    ndcToWorld,
    worldToNdc,
    tileToWorld,
    worldToTileFractional,
    screenToTile,
    tileToScreen,
    tileToWorldPos,

    // Types
    type ScreenToTileParams,
    type TileToScreenParams,
} from './coordinate-system';

// ============================================================================
// Hex Directions
// ============================================================================
export {
    EDirection,
    NUMBER_OF_DIRECTIONS,
    GRID_DELTA_X,
    GRID_DELTA_Y,
    GRID_DELTAS,
    Y_SCALE,
    getNextHexPoint,
    getAllNeighbors,
    getApproxDirection,
    rotateDirection,
    hexDistance,
    squaredHexDistance,
} from './hex-directions';

// ============================================================================
// Pathfinding (re-exports from pathfinding/)
// ============================================================================
export {
    findPath,
    findPathAStar,
    type PathfindingTerrain,
    BucketPriorityQueue,
    getHexLine,
    isHexLinePassable,
    smoothPath,
    type PathSmoothingParams,
} from './pathfinding';

// ============================================================================
// Map Objects
// ============================================================================
export {
    TYPED_OBJECT_CATEGORIES,
    OBJECT_TYPE_CATEGORY,
    getTypesForCategory,
    populateMapObjectsFromEntityData,
    spawnTestObjects,
    clearMapObjects,
    countMapObjectsByCategory,
} from './map-objects';

// ============================================================================
// Map Resources
// ============================================================================
export { analyzeResourceTypes } from './map-resources';

// ============================================================================
// Spatial Search
// ============================================================================
export { findNearestEntity, findEmptySpot, ringTiles, type FindEmptySpotConfig } from './spatial-search';

// ============================================================================
// Entity Cleanup Registry
// ============================================================================
export { EntityCleanupRegistry, CLEANUP_PRIORITY, type CleanupPriority } from './entity-cleanup-registry';

// ============================================================================
// Unit Reservation Registry
// ============================================================================
export { UnitReservationRegistry } from './unit-reservation';
