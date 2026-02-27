import { IRenderer } from './i-renderer';
import { IViewPoint } from './i-view-point';
import { RendererBase } from './renderer-base';
import { Entity, EntityType, StackedResourceState } from '../entity';
import { MapObjectType } from '@/game/types/map-object-types';
import { MapSize } from '@/utilities/map-size';
import { LogHandler } from '@/utilities/log-handler';
import { FileManager } from '@/utilities/file-manager';
import { Race } from './sprite-metadata';
import { SpriteRenderManager } from './sprite-render-manager';
import { SpriteBatchRenderer } from './sprite-batch-renderer';
import { SelectionOverlayRenderer } from './selection-overlay-renderer';
import type { EntityVisualState, DirectionTransition } from '../animation/entity-visual-service';
import { EntitySpriteResolver } from './entity-sprite-resolver';
import { FrameContext, type IFrameContext } from './frame-context';
import { OptimizedDepthSorter, type OptimizedSortContext } from './optimized-depth-sorter';
import { profiler } from './debug/render-profiler';
import { LayerVisibility, DEFAULT_LAYER_VISIBILITY, isMapObjectVisible } from './layer-visibility';
import type { TileHighlight } from '../input/render-state';
import type {
    IRenderContext,
    ServiceAreaRenderData,
    TerritoryDotRenderData,
    StackGhostRenderData,
    PlacementPreviewState,
    UnitStateLookup,
    BuildingRenderState,
    BuildingOverlayRenderData,
    RenderSettings,
} from './render-context';

import vertCode from './shaders/entity-vert.glsl';
import fragCode from './shaders/entity-frag.glsl';

// Re-export PlacementPreviewState from its canonical location
export type { PlacementPreviewState } from './render-context';

import { TEXTURE_UNIT_SPRITE_ATLAS } from './entity-renderer-constants';

import type { PassContext } from './render-passes/types';
import { PathIndicatorPass } from './render-passes/path-indicator-pass';
import { GroundOverlayPass } from './render-passes/ground-overlay-pass';
import { TerritoryDotPass } from './render-passes/territory-dot-pass';
import { EntitySpritePass } from './render-passes/entity-sprite-pass';
import { TransitionBlendPass } from './render-passes/transition-blend-pass';
import { ColorEntityPass } from './render-passes/color-entity-pass';
import { SelectionPass } from './render-passes/selection-pass';
import { StackGhostPass } from './render-passes/stack-ghost-pass';
import { PlacementPreviewPass } from './render-passes/placement-preview-pass';

const EMPTY_OVERLAYS: readonly BuildingOverlayRenderData[] = [];

/**
 * Renders entities (units and buildings) as colored quads or textured sprites.
 *
 * Acts as a pass coordinator: each rendering concern is handled by a dedicated
 * pass class. EntityRenderer manages initialization, context propagation,
 * depth sorting, and the draw call sequence.
 */
export class EntityRenderer extends RendererBase implements IRenderer {
    private static log = new LogHandler('EntityRenderer');

    private dynamicBuffer: WebGLBuffer | null = null;
    private glContext: WebGL2RenderingContext | null = null;

    private mapSize: MapSize;
    private groundHeight: Uint8Array;

    // Extracted managers and renderers
    // OK: nullable - procedural rendering works without sprites (testMap mode)
    public spriteManager: SpriteRenderManager | null = null;
    // OK: optional callback for sprite load completion
    private _onSpritesLoaded: (() => void) | null = null;
    private spriteBatchRenderer: SpriteBatchRenderer;
    private selectionOverlayRenderer: SelectionOverlayRenderer;
    private depthSorter: OptimizedDepthSorter;

    // OK: nullable - per-frame cache, created at render start, allows fallback computation
    private frameContext: IFrameContext | null = null;

    // Sprite resolution (animation, construction state, resource quantity)
    // Rebuilt each frame in setContext() with current state providers. Null before first setContext() call.
    private spriteResolver: EntitySpriteResolver | null = null;

    // Entity data to render (set externally each frame)
    public entities: Entity[] = [];
    public selectedEntityId: number | null = null;
    public selectedEntityIds: Set<number> = new Set();

    // Unit states for smooth interpolation and path visualization
    public unitStates: UnitStateLookup = { get: () => undefined };

    // Building render state provider (pre-computed in glue layer)
    private getBuildingRenderState: (entityId: number) => BuildingRenderState = () => ({
        useConstructionSprite: false,
        verticalProgress: 1.0,
    });

    // Visual state providers (from context)
    private getVisualState: (entityId: number) => EntityVisualState | null = () => null;
    private getDirectionTransition: (entityId: number) => DirectionTransition | null = () => null;

    // Building overlay provider (from context, pre-computed in glue layer)
    private getBuildingOverlays: (entityId: number) => readonly BuildingOverlayRenderData[] = () => EMPTY_OVERLAYS;

    // Resource states for stacked resources (quantity tracking)
    public resourceStates: Map<number, StackedResourceState> = new Map();

    // Rendering-relevant settings (from context)
    private renderSettings: RenderSettings = {
        showBuildingFootprint: false,
        disablePlayerTinting: false,
        antialias: false,
    };

    // Consolidated placement preview state
    public placementPreview: PlacementPreviewState | null = null;

    /** Debug: decoration labels collected during ColorEntityPass (screen-space) */
    public debugDecoLabels: Array<{ screenX: number; screenY: number; type: number; hue: number }> = [];

    /** Tile highlight rings from input modes (e.g., stack-adjust tool). */
    public tileHighlights: TileHighlight[] = [];

    // Render interpolation alpha for smooth sub-tick movement (0-1)
    public renderAlpha = 0;

    // Layer visibility settings
    public layerVisibility: LayerVisibility = { ...DEFAULT_LAYER_VISIBILITY };

    // Service areas to render for selected hub buildings
    public selectedServiceAreas: readonly ServiceAreaRenderData[] = [];

    // Territory boundary dots to render
    private territoryDots: readonly TerritoryDotRenderData[] = [];

    // Work area circles to render during work-area editing (debug mode: line circles)
    private workAreaCircles: readonly ServiceAreaRenderData[] = [];

    // Work area boundary dots to render as sprites (gameplay mode: dot sprites)
    private workAreaDots: readonly TerritoryDotRenderData[] = [];

    // Ghost resource stacks to render during stack-adjust mode
    private stackGhosts: readonly StackGhostRenderData[] = [];

    // Cached attribute/uniform locations for color shader
    private aPosition = -1;
    private aEntityPos = -1;
    private aColor = -1;

    // Reusable array for depth-sorted entities
    private sortedEntities: Entity[] = [];

    // Per-frame timing (for debugStats reporting)
    private frameCullSortTime = 0;
    private frameDrawTime = 0;
    private frameDrawCalls = 0;
    private frameSpriteCount = 0;

    // Detailed timing breakdown
    private frameTexturedTime = 0;
    private frameColorTime = 0;
    private frameSelectionTime = 0;

    /** Last frame's entity draw time (ms) - for debug stats collection */
    private lastEntityDrawTime = 0;

    /** Skip sprite loading (for testMap or procedural textures mode) */
    public skipSpriteLoading = false;

    // =========================================================================
    // Render passes
    // =========================================================================

    private passTransitionBlend: TransitionBlendPass;
    private passPathIndicator: PathIndicatorPass;
    private passGroundOverlay: GroundOverlayPass;
    private passTerritoryDot: TerritoryDotPass;
    private passEntitySprite: EntitySpritePass;
    private passColorEntity: ColorEntityPass;
    private passSelection: SelectionPass;
    private passStackGhost: StackGhostPass;
    private passPlacementPreview: PlacementPreviewPass;

    constructor(mapSize: MapSize, groundHeight: Uint8Array, fileManager?: FileManager) {
        super();
        this.mapSize = mapSize;
        this.groundHeight = groundHeight;
        this.spriteBatchRenderer = new SpriteBatchRenderer();
        this.selectionOverlayRenderer = new SelectionOverlayRenderer();
        this.depthSorter = new OptimizedDepthSorter();

        if (fileManager) {
            this.spriteManager = new SpriteRenderManager(fileManager, TEXTURE_UNIT_SPRITE_ATLAS);
        }

        // Build pass instances (blend pass first — sprite pass holds a reference to it)
        this.passTransitionBlend = new TransitionBlendPass();
        this.passPathIndicator = new PathIndicatorPass(this.selectionOverlayRenderer);
        this.passGroundOverlay = new GroundOverlayPass(this.selectionOverlayRenderer);
        this.passTerritoryDot = new TerritoryDotPass();
        this.passEntitySprite = new EntitySpritePass(this.passTransitionBlend);
        this.passColorEntity = new ColorEntityPass();
        this.passSelection = new SelectionPass(this.selectionOverlayRenderer);
        this.passStackGhost = new StackGhostPass();
        this.passPlacementPreview = new PlacementPreviewPass();
    }

    // eslint-disable-next-line @typescript-eslint/require-await -- sprite loading is fire-and-forget
    public async init(gl: WebGL2RenderingContext): Promise<boolean> {
        this.glContext = gl;

        // Initialize color shader (always needed for borders, paths, selection rings)
        super.initShader(gl, vertCode, fragCode);

        const sp = this.shaderProgram;

        // Get locations for color shader
        this.aPosition = sp.getAttribLocation('a_position');
        this.aEntityPos = sp.getAttribLocation('a_entityPos');
        this.aColor = sp.getAttribLocation('a_color');

        // Create a single reusable dynamic buffer for color shader
        this.dynamicBuffer = gl.createBuffer();

        // Initialize sprite batch renderer and manager if available
        if (this.spriteManager && !this.skipSpriteLoading) {
            this.spriteBatchRenderer.init(gl);

            // Start sprite loading in background (don't await)
            this.spriteManager
                .init(gl)
                .then(loaded => {
                    if (loaded) {
                        EntityRenderer.log.debug(
                            `Sprite loading complete: ${this.spriteManager!.spriteRegistry?.getBuildingCount() ?? 0} building sprites for ${Race[this.spriteManager!.currentRace]}`
                        );
                    }
                    // Notify when sprites are loaded (even if loading failed, animations are ready)
                    this._onSpritesLoaded?.();
                })
                .catch((err: unknown) => {
                    EntityRenderer.log.warn(`Sprite loading failed: ${err}`);
                    // Still notify - procedural rendering can continue without sprites
                    this._onSpritesLoaded?.();
                });
        } else {
            // No sprite manager or skip flag set (testMap/procedural textures) - enable ticks immediately
            this._onSpritesLoaded?.();
        }

        return true;
    }

    /**
     * Set callback to be called when sprites finish loading.
     * Used to enable game ticks after animations are available.
     */
    public set onSpritesLoaded(callback: (() => void) | null) {
        this._onSpritesLoaded = callback;
    }

    /**
     * Get the current race being used for building sprites.
     */
    public getRace(): Race {
        if (!this.spriteManager?.currentRace) {
            throw new Error('EntityRenderer: no race set — spriteManager must be initialized before calling getRace');
        }
        return this.spriteManager.currentRace;
    }

    /**
     * Switch to a different race and reload building sprites.
     */
    public async setRace(race: Race): Promise<boolean> {
        if (!this.spriteManager) return false;
        return this.spriteManager.setRace(race);
    }

    /**
     * Set render context from an IRenderContext interface.
     * This is the preferred way to update renderer state, providing a clean
     * separation between game state and rendering.
     *
     * @param ctx The render context containing all data needed for rendering
     */
    public setContext(ctx: IRenderContext): void {
        this.entities = ctx.entities as Entity[];
        this.selectedEntityId = ctx.selection.primaryId;
        this.selectedEntityIds = ctx.selection.ids as Set<number>;
        this.unitStates = ctx.unitStates;
        this.getBuildingRenderState = ctx.getBuildingRenderState;
        this.getBuildingOverlays = ctx.getBuildingOverlays;
        this.getVisualState = ctx.getVisualState;
        this.getDirectionTransition = ctx.getDirectionTransition;
        this.resourceStates = ctx.resourceStates as Map<number, StackedResourceState>;
        this.renderAlpha = ctx.alpha;
        this.layerVisibility = ctx.layerVisibility;
        this.renderSettings = ctx.settings;
        this.placementPreview = ctx.placementPreview;
        this.selectedServiceAreas = ctx.selectedServiceAreas;
        this.territoryDots = ctx.territoryDots;
        this.workAreaCircles = ctx.workAreaCircles;
        this.workAreaDots = ctx.workAreaDots;
        this.stackGhosts = ctx.stackGhosts;

        // Rebuild sprite resolver with current frame's state providers
        this.spriteResolver = new EntitySpriteResolver(
            this.spriteManager,
            ctx.getVisualState,
            ctx.getDirectionTransition,
            ctx.getBuildingRenderState,
            ctx.resourceStates,
            ctx.layerVisibility
        );
    }

    /**
     * Clean up all GPU resources.
     * Always cleans up SpriteRenderManager (created in constructor) even if
     * init() hasn't been called yet — prevents 1+ GB leak on early teardown.
     */
    public destroy(): void {
        const gl = this.glContext;

        if (gl) {
            // Clean up color shader resources
            if (this.dynamicBuffer) {
                gl.deleteBuffer(this.dynamicBuffer);
                this.dynamicBuffer = null;
            }

            // Clean up sprite batch renderer (GPU resources only exist after init)
            this.spriteBatchRenderer.destroy(gl);
        }

        // Clean up sprite manager — created in constructor, must always be freed
        this.spriteManager?.destroy();
        this.spriteManager = null;
        this.glContext = null;

        EntityRenderer.log.debug('EntityRenderer resources cleaned up');
    }

    public draw(gl: WebGL2RenderingContext, projection: Float32Array, viewPoint: IViewPoint): void {
        if (!this.dynamicBuffer) return;
        if (!this.spriteResolver) {
            throw new Error('EntityRenderer.draw() called before setContext() — spriteResolver not initialized');
        }
        if (this.entities.length === 0 && !this.placementPreview) return;

        this.spriteManager?.drainPendingUploads(gl);

        const frameStart = performance.now();
        profiler.beginFrame();
        this.frameDrawCalls = 0;
        this.frameSpriteCount = 0;

        gl.enable(gl.BLEND);
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

        // Build the shared pass context for this frame
        const passCtx = this.buildPassContext();

        // --- Execute passes in order ---

        // Pass 1: Path indicators (color shader) — uses unitStates only, no frameContext needed
        this.passPathIndicator.prepare(passCtx);
        this.setupColorShader(gl, projection);
        this.passPathIndicator.draw(gl, projection, viewPoint);

        // Depth sort — populates this.frameContext and this.sortedEntities
        this.frameCullSortTime = this.timedPass(() => this.sortEntitiesByDepth(viewPoint));

        // Re-build passCtx now that frameContext is populated (sortedEntities is same array, already updated)
        passCtx.frameContext = this.frameContext;

        // --- Prepare remaining passes (after depth sort so frameContext is valid) ---
        this.passGroundOverlay.prepare(passCtx);
        this.passTerritoryDot.prepare(passCtx);
        this.passEntitySprite.prepare(passCtx);
        this.passTransitionBlend.prepare(passCtx);
        this.passColorEntity.prepare(passCtx);
        this.passSelection.prepare(passCtx);
        this.passStackGhost.prepare(passCtx);
        this.passPlacementPreview.prepare(passCtx);

        // Pass 2: Ground overlays (footprints, service/work area circles)
        this.setupColorShader(gl, projection);
        this.passGroundOverlay.draw(gl, projection, viewPoint);

        // Pass 3: Territory/work area dot sprites
        this.passTerritoryDot.draw(gl, projection, viewPoint);
        this.frameDrawCalls += this.passTerritoryDot.lastDrawCalls;

        // Pass 4: Entity rendering (textured sprites + blend + color fallback)
        this.frameDrawTime = this.timedPass(() => {
            const hasSprites = this.spriteManager?.hasSprites && this.spriteBatchRenderer.isInitialized;
            profiler.beginPhase('draw');
            if (hasSprites) {
                this.frameTexturedTime = this.timedPass(() => this.passEntitySprite.draw(gl, projection, viewPoint));
                // Re-setup color shader before color pass
                this.setupColorShader(gl, projection);
                this.frameColorTime = this.timedPass(() => {
                    this.passColorEntity.texturedBuildingsHandled = true;
                    this.passColorEntity.draw(gl, projection, viewPoint);
                });
            } else {
                this.frameTexturedTime = 0;
                this.setupColorShader(gl, projection);
                this.frameColorTime = this.timedPass(() => {
                    this.passColorEntity.texturedBuildingsHandled = false;
                    this.passColorEntity.draw(gl, projection, viewPoint);
                });
            }
            profiler.endPhase('draw');
        });

        // Accumulate debug deco labels from color pass
        this.debugDecoLabels = passCtx.debugDecoLabels;

        // Pass 5: Selection overlays (frames, dots, tile highlights)
        this.setupColorShader(gl, projection);
        this.frameSelectionTime = this.timedPass(() => this.passSelection.draw(gl, projection, viewPoint));

        // Pass 6: Stack ghost sprites
        this.passStackGhost.draw(gl, projection, viewPoint);
        this.frameDrawCalls += this.passStackGhost.lastDrawCalls;

        // Pass 7: Placement preview ghost (setupColorShader needed for color fallback path)
        this.setupColorShader(gl, projection);
        this.passPlacementPreview.draw(gl, projection, viewPoint);

        // Accumulate draw-call and sprite counts from sprite pass
        this.frameDrawCalls += this.passEntitySprite.lastDrawCalls;
        this.frameSpriteCount += this.passEntitySprite.lastSpriteCount;

        gl.disable(gl.BLEND);
        profiler.endFrame();
        this.lastEntityDrawTime = performance.now() - frameStart;
    }

    /** Get timing data from the last frame for debug stats */
    public getLastFrameTiming(): {
        cullSort: number;
        entities: number;
        visibleCount: number;
        drawCalls: number;
        spriteCount: number;
        // Detailed breakdown
        textured: number;
        color: number;
        selection: number;
        } {
        return {
            cullSort: this.frameCullSortTime,
            entities: this.lastEntityDrawTime,
            visibleCount: this.sortedEntities.length,
            drawCalls: this.frameDrawCalls,
            spriteCount: this.frameSpriteCount,
            // Detailed breakdown
            textured: this.frameTexturedTime,
            color: this.frameColorTime,
            selection: this.frameSelectionTime,
        };
    }

    // =========================================================================
    // Private helpers
    // =========================================================================

    /** Build the PassContext for the current frame. */
    private buildPassContext(): PassContext {
        return {
            entities: this.entities,
            selectedEntityIds: this.selectedEntityIds,
            unitStates: this.unitStates,
            resourceStates: this.resourceStates,
            getBuildingRenderState: this.getBuildingRenderState,
            getBuildingOverlays: this.getBuildingOverlays,
            getVisualState: this.getVisualState,
            getDirectionTransition: this.getDirectionTransition,
            renderSettings: this.renderSettings,
            layerVisibility: this.layerVisibility,
            renderAlpha: this.renderAlpha,
            mapSize: this.mapSize,
            groundHeight: this.groundHeight,
            selectedServiceAreas: this.selectedServiceAreas,
            territoryDots: this.territoryDots,
            workAreaCircles: this.workAreaCircles,
            workAreaDots: this.workAreaDots,
            stackGhosts: this.stackGhosts,
            placementPreview: this.placementPreview,
            tileHighlights: this.tileHighlights,
            spriteManager: this.spriteManager,
            spriteBatchRenderer: this.spriteBatchRenderer,
            spriteResolver: this.spriteResolver!,
            frameContext: this.frameContext,
            sortedEntities: this.sortedEntities,
            aPosition: this.aPosition,
            aEntityPos: this.aEntityPos,
            aColor: this.aColor,
            dynamicBuffer: this.dynamicBuffer!,
            debugDecoLabels: this.debugDecoLabels,
        };
    }

    /** Run a callback and return elapsed time in ms. */
    private timedPass(fn: () => void): number {
        const start = performance.now();
        fn();
        return performance.now() - start;
    }

    /** Setup color shader and bind the reusable dynamic buffer. */
    private setupColorShader(gl: WebGL2RenderingContext, projection: Float32Array): void {
        super.drawBase(gl, projection);
        gl.bindBuffer(gl.ARRAY_BUFFER, this.dynamicBuffer);
        gl.enableVertexAttribArray(this.aPosition);
        gl.vertexAttribPointer(this.aPosition, 2, gl.FLOAT, false, 0, 0);
        gl.disableVertexAttribArray(this.aEntityPos);
        gl.disableVertexAttribArray(this.aColor);
    }

    /** Sort entities by depth for correct painter's algorithm rendering. */
    private sortEntitiesByDepth(viewPoint: IViewPoint): void {
        // Create frame context - computes bounds once, caches all world positions
        profiler.beginPhase('cull');
        this.frameContext = FrameContext.create({
            viewPoint,
            entities: this.entities,
            unitStates: this.unitStates,
            groundHeight: this.groundHeight,
            mapSize: this.mapSize,
            alpha: this.renderAlpha,
            isEntityVisible: entity => this.isEntityVisible(entity),
        });
        profiler.endPhase('cull');

        // Copy visible entities to sortedEntities array
        this.sortedEntities.length = 0;
        for (const entity of this.frameContext.visibleEntities) {
            this.sortedEntities.push(entity);
        }

        // Record culling metrics
        profiler.recordEntities(
            this.entities.length,
            this.frameContext.visibleEntities.length,
            this.frameContext.culledCount
        );

        // Sort by depth using optimized sorter
        profiler.beginPhase('sort');
        const sortCtx: OptimizedSortContext = {
            spriteManager: this.spriteManager,
            getWorldPos: entity => this.frameContext!.getWorldPos(entity),
            getVariation: entityId => this.getVisualState(entityId)?.variation ?? 0,
        };
        this.depthSorter.sortByDepth(this.sortedEntities, sortCtx);
        profiler.endPhase('sort');
    }

    /**
     * Check if an entity should be rendered based on layer visibility settings.
     */
    private isEntityVisible(entity: Entity): boolean {
        switch (entity.type) {
        case EntityType.Building:
            return this.layerVisibility.buildings;
        case EntityType.Unit:
            return this.layerVisibility.units;
        case EntityType.MapObject:
            return isMapObjectVisible(this.layerVisibility, entity.subType as MapObjectType);
        case EntityType.Decoration:
        case EntityType.StackedResource:
        case EntityType.None:
            return true;
        }
    }
}
