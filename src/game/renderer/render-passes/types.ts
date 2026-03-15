/**
 * Shared types and interfaces for render passes.
 *
 * Data is decomposed into focused sub-interfaces so each pass declares exactly
 * the fields it needs, preventing accidental coupling between passes.
 */

import type { IViewPoint } from '../i-view-point';
import type { Entity } from '@/game/entity';
import type {
    UnitStateLookup,
    BuildingOverlayRenderData,
    RenderSettings,
    CircleRenderData,
    TerritoryDotRenderData,
    StackGhostRenderData,
    PlacementPreviewState,
} from '../render-context';
import type { EntityVisualState, DirectionTransition } from '@/game/animation/entity-visual-service';
import type { LayerVisibility } from '../layer-visibility';
import type { TileHighlight } from '@/game/input/render-state';
import type { EntitySpriteResolver } from '../entity-sprite-resolver';
import type { SpriteRenderManager } from '../sprite-render-manager';
import type { SpriteBatchRenderer } from '../sprite-batch-renderer';
import type { IFrameContext } from '../frame-context';
import type { MapSize } from '@/utilities/map-size';

// ============================================================================
// Sub-interfaces — composable building blocks for pass contexts
// ============================================================================

/** Terrain / spatial data — needed by every pass. */
export interface SpatialPassData {
    readonly mapSize: MapSize;
    readonly groundHeight: Uint8Array;
}

/** Color shader attribute locations and reusable dynamic buffer. */
export interface ColorShaderPassData {
    readonly aPosition: number;
    readonly aEntityPos: number;
    readonly aColor: number;
    readonly dynamicBuffer: WebGLBuffer;
}

/** Sprite rendering subsystems (atlas, batch renderer, resolver). */
export interface SpritePassData {
    readonly spriteManager: SpriteRenderManager | null;
    readonly spriteBatchRenderer: SpriteBatchRenderer;
    readonly spriteResolver: EntitySpriteResolver;
}

/** Per-frame depth-sorted entity state (populated after cull + sort). */
export interface EntityFramePassData {
    readonly sortedEntities: Entity[];
    frameContext: IFrameContext | null;
    readonly selectedEntityIds: Set<number>;
    readonly unitStates: UnitStateLookup;
}

// ============================================================================
// Per-pass context interfaces
// ============================================================================

export interface PathIndicatorContext extends SpatialPassData, ColorShaderPassData {
    readonly selectedEntityIds: Set<number>;
    readonly unitStates: UnitStateLookup;
    readonly layerVisibility: LayerVisibility;
}

export interface GroundOverlayContext extends SpatialPassData, ColorShaderPassData, EntityFramePassData {
    readonly renderSettings: RenderSettings;
    readonly workAreaCircles: readonly CircleRenderData[];
}

export interface TerritoryDotContext extends SpatialPassData, SpritePassData {
    readonly territoryDots: readonly TerritoryDotRenderData[];
    readonly workAreaDots: readonly TerritoryDotRenderData[];
    readonly renderSettings: RenderSettings;
}

export interface EntitySpriteContext extends SpatialPassData, SpritePassData, EntityFramePassData {
    readonly renderSettings: RenderSettings;
    readonly getBuildingOverlays: (entityId: number) => readonly BuildingOverlayRenderData[];
    readonly getHealthRatio: (entityId: number) => number | null;
}

export interface TransitionBlendContext extends SpatialPassData, EntityFramePassData {
    readonly spriteManager: SpriteRenderManager | null;
    readonly spriteBatchRenderer: SpriteBatchRenderer;
    readonly renderSettings: RenderSettings;
}

/** Label rendered on the 2D overlay for color-fallback entities */
export interface DebugEntityLabel {
    screenX: number;
    screenY: number;
    type: number;
    hue: number;
    /** Human-readable name (e.g. "Swordsman", "WoodcutterHut"). Falls back to numeric type if absent. */
    name?: string;
}

export interface ColorEntityContext extends SpatialPassData, ColorShaderPassData, EntityFramePassData {
    readonly spriteResolver: EntitySpriteResolver;
    debugDecoLabels: DebugEntityLabel[];
}

export interface SelectionContext extends SpatialPassData, ColorShaderPassData, EntityFramePassData {
    readonly tileHighlights: TileHighlight[];
}

export interface StackGhostContext extends SpatialPassData, SpritePassData {
    readonly stackGhosts: readonly StackGhostRenderData[];
    readonly renderSettings: RenderSettings;
}

export interface PlacementPreviewContext extends SpatialPassData, SpritePassData, ColorShaderPassData {
    readonly placementPreview: PlacementPreviewState | null;
    readonly renderSettings: RenderSettings;
}

// ============================================================================
// IRenderPass — base interface for all passes (draw signature only)
// ============================================================================

/**
 * A single rendering pass. Each pass has its own typed prepare() method;
 * draw() is the common interface used by EntityRenderer.
 */
export interface IRenderPass {
    draw(gl: WebGL2RenderingContext, projection: Float32Array, viewPoint: IViewPoint): void;
}

// ============================================================================
// Pluggable render pass types (feature plugin system)
// ============================================================================

import type { SelectionOverlayRenderer } from '../selection-overlay-renderer';

/**
 * Render ordering layer — determines when a pass runs relative to the
 * core entity rendering pipeline.
 */
export enum RenderLayer {
    BeforeDepthSort = 0,
    BehindEntities = 1,
    Entities = 2,
    AboveEntities = 3,
    Overlay = 4,
}

/**
 * Declares what shared resources a render pass needs.
 * EntityRenderer uses this to provide only the required sub-context.
 */
export interface RenderPassNeeds {
    colorShader?: boolean;
    sprites?: boolean;
    entities?: boolean;
    /** Pass needs the depth-sorted frameContext (only valid after depth sort) */
    frameContext?: boolean;
}

/**
 * Dependencies provided to render pass factories based on their `needs`.
 */
export interface RenderPassDeps {
    selectionOverlayRenderer?: SelectionOverlayRenderer;
    spriteBatchRenderer?: SpriteBatchRenderer;
}

/**
 * Definition of a pluggable render pass.
 * Returned by features in the `renderPasses` hook.
 */
export interface RenderPassDefinition {
    id: string;
    layer: RenderLayer;
    priority?: number;
    needs: RenderPassNeeds;
    create: (deps: RenderPassDeps) => PluggableRenderPass;
}

/**
 * Extended IRenderPass with typed prepare().
 * All pluggable passes use PassContext (the existing full context type).
 */
export interface PluggableRenderPass extends IRenderPass {
    prepare(ctx: PassContext): void;
    lastDrawCalls?: number;
    lastSpriteCount?: number;
}

// ============================================================================
// PassContext — full per-frame data assembled by EntityRenderer
// ============================================================================

/**
 * Complete frame data assembled by EntityRenderer.buildPassContext().
 * Satisfies all per-pass context interfaces via structural subtyping.
 */
export interface PassContext extends SpatialPassData, ColorShaderPassData, SpritePassData, EntityFramePassData {
    // Entity state providers
    readonly getBuildingOverlays: (entityId: number) => readonly BuildingOverlayRenderData[];
    readonly getVisualState: (entityId: number) => EntityVisualState | null;
    readonly getDirectionTransition: (entityId: number) => DirectionTransition | null;
    readonly getHealthRatio: (entityId: number) => number | null;

    // Render parameters
    readonly renderSettings: RenderSettings;
    readonly layerVisibility: LayerVisibility;

    // Overlay / special pass data
    readonly territoryDots: readonly TerritoryDotRenderData[];
    readonly workAreaCircles: readonly CircleRenderData[];
    readonly workAreaDots: readonly TerritoryDotRenderData[];
    readonly stackGhosts: readonly StackGhostRenderData[];
    readonly placementPreview: PlacementPreviewState | null;
    readonly tileHighlights: TileHighlight[];

    // Debug output — passes write labels here during drawColorEntities
    debugDecoLabels: DebugEntityLabel[];
}
