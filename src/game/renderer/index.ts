/**
 * Renderer Module
 *
 * WebGL2 rendering system for the game including entity sprites,
 * landscape textures, and visual effects.
 *
 * @module renderer
 */

// ============================================================================
// Core Renderer
// ============================================================================
export { Renderer, type FrameRenderTiming, type RendererOptions } from './renderer';
export { LandscapeRenderer } from './landscape/landscape-renderer';
export { EntityRenderer, type PlacementPreviewState } from './entity-renderer';

// ============================================================================
// View/Camera
// ============================================================================
export { ViewPoint, type ViewPointOptions } from './view-point';
export type { IViewPoint, IViewPointReadonly } from './i-view-point';

// ============================================================================
// Render Context
// ============================================================================
export { type IRenderContext, type SelectionState, RenderContextBuilder, createRenderContext } from './render-context';

// ============================================================================
// Layer Visibility
// ============================================================================
export {
    RenderLayer,
    EnvironmentSubLayer,
    type EnvironmentLayerVisibility,
    type LayerVisibility,
    DEFAULT_LAYER_VISIBILITY,
    getEnvironmentSubLayer,
    isResourceDeposit,
    isEnvironmentSubLayerVisible,
    isMapObjectVisible,
    saveLayerVisibility,
    loadLayerVisibility,
    createLayerVisibility,
    FALLBACK_ENTITY_COLORS,
    getMapObjectFallbackColor,
    getMapObjectDotScale,
} from './layer-visibility';

// ============================================================================
// Sprite Metadata
// ============================================================================
export {
    // Constants
    PIXELS_TO_WORLD,

    // Race enum and data
    Race,
    RACE_NAMES,
    AVAILABLE_RACES,

    // GFX file numbers
    GFX_FILE_NUMBERS,

    // Building data
    BUILDING_ICON_INDICES,
    BUILDING_ICON_FILE_NUMBERS,
    BUILDING_DIRECTION,
    type BuildingSpriteFrames,
    BUILDING_SPRITE_FRAMES,
    type BuildingSpriteInfo,
    BUILDING_JOB_INDICES,
    BUILDING_SPRITE_MAP,
    type BuildingSpriteEntries,
    getBuildingSpriteMap,

    // Unit data
    SETTLER_FILE_NUMBERS,
    UNIT_DIRECTION,
    NUM_UNIT_DIRECTIONS,
    UNIT_JOB_INDICES,
    WORKER_JOB_INDICES,
    type UnitSpriteInfo,
    getUnitSpriteMap,

    // Resource data
    RESOURCE_JOB_INDICES,
    CARRIER_MATERIAL_JOB_INDICES,
    type ResourceSpriteInfo,
    getResourceSpriteMap,

    // Tree/MapObject data
    TREE_JOB_OFFSET,
    TREE_JOBS_PER_TYPE,
    TREE_JOB_INDICES,
    type MapObjectSpriteInfo,
    getMapObjectSpriteMap,

    // Sprite entries
    type SpriteEntry,
    type AnimatedSpriteEntry,

    // Registry
    SpriteMetadataRegistry,
} from './sprite-metadata';

// ============================================================================
// Sprite Cache
// ============================================================================
export {
    type CachedSlot,
    type CachedAtlasData,
    getAtlasCache,
    setAtlasCache,
    clearAtlasCache,
    clearAllAtlasCache,
    getIndexedDBCache,
    setIndexedDBCache,
    clearIndexedDBCache,
    clearAllIndexedDBCache,
    isCacheDisabled,
    clearAllCaches,
    getAtlasCacheStats,
    getBuildVersion,
} from './sprite-atlas-cache';

// ============================================================================
// Tint Utilities
// ============================================================================
export { PLAYER_COLORS, TINT_NEUTRAL, TINT_SELECTED, TINT_PREVIEW_VALID, TINT_PREVIEW_INVALID } from './tint-utils';

// ============================================================================
// Landscape Textures (debug/advanced)
// ============================================================================
export { RIVER_SLOT_PERMS } from './landscape/textures/landscape-texture-map';

// ============================================================================
// Internal Types (needed by external integrations)
// ============================================================================
export type { IRenderer } from './i-renderer';
