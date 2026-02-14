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
    type TerrainData,
    BucketPriorityQueue,
    getHexLine,
    cubeRound,
    isHexLinePassable,
    smoothPath,
    type PathSmoothingParams,
} from './pathfinding';

// ============================================================================
// Animation
// ============================================================================
export {
    DEFAULT_ANIMATION_DIRECTION,
    type AnimationDataProvider,
    getAnimatedSprite,
    getAnimatedSpriteForDirection,
} from './animation';

// ============================================================================
// Map Objects
// ============================================================================
export {
    type ObjectCategory,
    OBJECT_CATEGORIES,
    OBJECT_TYPE_CATEGORY,
    RAW_TO_OBJECT_TYPE,
    s4TreeTypeToMapObjectType,
    getTypesForCategory,
    type PopulateOptions,
    analyzeObjectTypes,
    populateMapObjects,
    populateMapObjectsFromEntityData,
    spawnTestObjects,
    clearMapObjects,
    countMapObjectsByCategory,
    type ExpandTreesOptions,
    expandTrees,
} from './map-objects';

// ============================================================================
// Map Buildings
// ============================================================================
export { type PopulateBuildingsOptions, populateMapBuildings, mapS4BuildingType } from './map-buildings';

// ============================================================================
// Map Resources
// ============================================================================
export { analyzeResourceTypes } from './map-resources';

// ============================================================================
// Tree System
// ============================================================================
export { TreeStage, type TreeState, TreeSystem } from './tree-system';

// ============================================================================
// Production System
// ============================================================================
export { type ProductionState, type ProductionSystemConfig, ProductionSystem } from './production-system';

// ============================================================================
// Woodcutting System
// ============================================================================
export { WoodcuttingSystem } from './woodcutting-system';

// ============================================================================
// Settler Tasks (re-exports from settler-tasks/)
// ============================================================================
export * from './settler-tasks';
