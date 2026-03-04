/**
 * Shared types and interfaces for render passes.
 *
 * Each pass handles a specific rendering concern and can be composed by
 * EntityRenderer acting as a coordinator.
 */

import type { IViewPoint } from '../i-view-point';
import type { Entity, StackedPileState } from '@/game/entity';
import type {
    UnitStateLookup,
    BuildingRenderState,
    BuildingOverlayRenderData,
    RenderSettings,
    ServiceAreaRenderData,
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
// IRenderPass
// ============================================================================

/**
 * A single rendering pass. Passes are prepared once with context data each
 * frame, then drawn in order by the EntityRenderer coordinator.
 */
export interface IRenderPass {
    /**
     * Called once per frame before any drawing to supply the shared pass context.
     */
    prepare(ctx: PassContext): void;

    /**
     * Execute the pass's WebGL draw calls.
     */
    draw(gl: WebGL2RenderingContext, projection: Float32Array, viewPoint: IViewPoint): void;
}

// ============================================================================
// PassContext — shared per-frame data supplied to all passes
// ============================================================================

/**
 * All data that passes may need for a frame.
 * Assembled by EntityRenderer.setContext() and passed to each pass's prepare().
 */
export interface PassContext {
    // Core entity data
    readonly entities: Entity[];
    readonly selectedEntityIds: Set<number>;
    readonly unitStates: UnitStateLookup;
    readonly pileStates: Map<number, StackedPileState>;

    // Building state providers
    readonly getBuildingRenderState: (entityId: number) => BuildingRenderState;
    readonly getBuildingOverlays: (entityId: number) => readonly BuildingOverlayRenderData[];
    readonly getVisualState: (entityId: number) => EntityVisualState | null;
    readonly getDirectionTransition: (entityId: number) => DirectionTransition | null;
    readonly getHealthRatio: (entityId: number) => number | null;

    // Render parameters
    readonly renderSettings: RenderSettings;
    readonly layerVisibility: LayerVisibility;
    readonly renderAlpha: number;

    // Spatial / terrain
    readonly mapSize: MapSize;
    readonly groundHeight: Uint8Array;

    // Overlay / special passes data
    readonly selectedServiceAreas: readonly ServiceAreaRenderData[];
    readonly territoryDots: readonly TerritoryDotRenderData[];
    readonly workAreaCircles: readonly ServiceAreaRenderData[];
    readonly workAreaDots: readonly TerritoryDotRenderData[];
    readonly stackGhosts: readonly StackGhostRenderData[];
    readonly placementPreview: PlacementPreviewState | null;
    readonly tileHighlights: TileHighlight[];

    // Renderer subsystems (nullable — unavailable in testMap/procedural mode)
    readonly spriteManager: SpriteRenderManager | null;
    readonly spriteBatchRenderer: SpriteBatchRenderer;
    readonly spriteResolver: EntitySpriteResolver;

    // Per-frame computed state (set by EntityRenderer after depth sort)
    // frameContext is mutable: EntityRenderer writes it after sortEntitiesByDepth()
    frameContext: IFrameContext | null;
    readonly sortedEntities: Entity[];

    // Color shader attribute locations
    readonly aPosition: number;
    readonly aEntityPos: number;
    readonly aColor: number;
    readonly dynamicBuffer: WebGLBuffer;

    // Debug output — passes write labels here during drawColorEntities
    debugDecoLabels: Array<{ screenX: number; screenY: number; type: number; hue: number }>;
}

// ============================================================================
// Selection context (subset used by selection/path passes)
// ============================================================================

export interface SelectionPassContext {
    readonly mapSize: MapSize;
    readonly groundHeight: Uint8Array;
    readonly viewPoint: IViewPoint;
    readonly unitStates: UnitStateLookup;
}
