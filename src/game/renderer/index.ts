/**
 * Renderer Module
 *
 * WebGL2 rendering system for the game including entity sprites,
 * landscape textures, and visual effects.
 *
 * Sub-modules with their own barrels:
 * - `renderer/sprite-metadata` — sprite coordinate data, animation maps, race definitions
 * - `renderer/sprite-cache` — two-tier atlas caching (memory + IndexedDB)
 *
 * @module renderer
 */

// ============================================================================
// Core Renderer
// ============================================================================
export { Renderer, type FrameRenderTiming, type RendererOptions } from './renderer';
export { LandscapeRenderer } from './landscape/landscape-renderer';
export { EntityRenderer } from './entity-renderer';
export type { IRenderer } from './i-renderer';
export type { PlacementPreviewState } from './render-context';

// ============================================================================
// View/Camera
// ============================================================================
export { ViewPoint, type ViewPointOptions } from './view-point';
export type { IViewPoint, IViewPointReadonly } from './i-view-point';

// ============================================================================
// Render Context
// ============================================================================
export {
    type IRenderContext,
    type SelectionState,
    type PlacementEntityType,
    type UnitStateLookup,
    type UnitRenderState,
    type BuildingRenderState,
    type RenderSettings,
    type ServiceAreaRenderData,
    RenderContextBuilder,
    createRenderContext,
} from './render-context';

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
