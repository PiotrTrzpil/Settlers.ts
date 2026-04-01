import { IRenderer } from './i-renderer';
import { IViewPoint } from './i-view-point';
import { RendererBase } from './renderer-base';
import { Entity, EntityType } from '../entity';
import { MapObjectType } from '@/game/types/map-object-types';
import { MapSize } from '@/utilities/map-size';
import { LogHandler } from '@/utilities/log-handler';
import { FileManager } from '@/utilities/file-manager';
import { Race } from './sprite-metadata';
import { SpriteRenderManager } from './sprite-render-manager';
import { SpriteBatchRenderer } from './sprite-batch-renderer';
import { SelectionOverlayRenderer } from './selection-overlay-renderer';
import { EntitySpriteResolver } from './entity-sprite-resolver';
import { FrameContext, type IFrameContext } from './frame-context';
import { OptimizedDepthSorter, type OptimizedSortContext } from './optimized-depth-sorter';
import { profiler } from './debug/render-profiler';
import { isMapObjectVisible } from './layer-visibility';
import type { TileHighlight } from '../input/render-state';
import type { IRenderContext, PlacementPreviewState } from './render-context';

import vertCode from './shaders/entity-vert.glsl';
import fragCode from './shaders/entity-frag.glsl';

// Re-export PlacementPreviewState from its canonical location
export type { PlacementPreviewState } from './render-context';

import { TEXTURE_UNIT_SPRITE_ATLAS } from './entity-renderer-constants';

import type { PassContext } from './render-passes';
import type { DebugEntityLabel, RenderPassDefinition } from './render-passes/types';
import { RenderLayer } from './render-passes/types';
import { RenderPassRegistry } from './render-pass-registry';
import { PathIndicatorPass } from './render-passes/path-indicator-pass';
import { GroundOverlayPass } from './render-passes/ground-overlay-pass';
import { TerritoryDotPass } from './render-passes/territory-dot-pass';
import { SelectionPass } from './render-passes/selection-pass';
import { StackGhostPass } from './render-passes/stack-ghost-pass';
import { PlacementPreviewPass } from './render-passes/placement-preview-pass';
import { GroundShadowPass } from './render-passes/ground-shadow-pass';
import { EntityLayerOrchestrator } from './render-passes/entity-layer-orchestrator';

/**
 * Renders entities (units and buildings) as colored quads or textured sprites.
 *
 * Acts as a pass coordinator: each rendering concern is handled by a dedicated
 * pass class. EntityRenderer manages initialization, context propagation,
 * depth sorting, and the draw call sequence.
 *
 * The draw loop is registry-driven: all passes are registered in the constructor
 * and executed in layer+priority order. Adding a new pass requires only a new
 * RenderPassDefinition — no changes to draw().
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
    private _spriteResolver: EntitySpriteResolver | null = null;

    /** Current sprite resolver (rebuilt each frame). Null before first setContext(). */
    get spriteResolver(): EntitySpriteResolver | null {
        return this._spriteResolver;
    }

    // Render context — set externally each frame via setContext()
    private renderContext: IRenderContext | null = null;

    // Consolidated placement preview state — set directly by glue layer (not via IRenderContext)
    public placementPreview: PlacementPreviewState | null = null;

    /** Debug: entity labels collected during ColorEntityPass (screen-space) */
    public debugDecoLabels: DebugEntityLabel[] = [];

    /** Tile highlight rings from input modes (e.g., stack-adjust tool). */
    public tileHighlights: TileHighlight[] = [];

    // Cached attribute/uniform locations for color shader
    private aPosition = -1;
    private aEntityPos = -1;
    private aColor = -1;

    // Reusable array for depth-sorted entities
    private sortedEntities: Entity[] = [];

    /** Map objects hidden by layer visibility but needing labels (showDecoLabels mode). */
    private labelOnlyMapObjects: Entity[] = [];

    // Per-frame timing (for debugStats reporting)
    private frameCullSortTime = 0;
    private frameDrawCalls = 0;
    private frameSpriteCount = 0;
    private frameSelectionTime = 0;

    /** Last frame's entity draw time (ms) - for debug stats collection */
    private lastEntityDrawTime = 0;

    /** Skip sprite loading (for testMap or procedural textures mode) */
    public skipSpriteLoading = false;

    /** Dynamic pass registry — all definitions registered in constructor, initialized in init(). */
    private readonly passRegistry = new RenderPassRegistry();

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

        // Register all pass definitions — entity-layer orchestrator wraps the 3 entity-specific passes
        const passDefinitions: RenderPassDefinition[] = [
            {
                id: 'path-indicator',
                layer: RenderLayer.BeforeDepthSort,
                priority: 100,
                needs: { colorShader: true },
                create: deps => new PathIndicatorPass(deps.selectionOverlayRenderer!),
            },
            {
                id: 'ground-shadow',
                layer: RenderLayer.BehindEntities,
                priority: 50,
                needs: { entities: true, frameContext: true },
                create: () => new GroundShadowPass(),
            },
            {
                id: 'ground-overlay',
                layer: RenderLayer.BehindEntities,
                priority: 100,
                needs: { colorShader: true, entities: true },
                create: deps => new GroundOverlayPass(deps.selectionOverlayRenderer!),
            },
            {
                id: 'territory-dot',
                layer: RenderLayer.BehindEntities,
                priority: 200,
                needs: { sprites: true },
                create: () => new TerritoryDotPass(),
            },
            {
                id: 'entity-layer',
                layer: RenderLayer.Entities,
                priority: 100,
                needs: { colorShader: true, sprites: true, entities: true, frameContext: true },
                create: deps =>
                    new EntityLayerOrchestrator(deps, {
                        setupColorShader: (gl, proj) => this.setupColorShader(gl, proj),
                    }),
            },
            {
                id: 'selection',
                layer: RenderLayer.AboveEntities,
                priority: 100,
                needs: { colorShader: true, entities: true },
                create: deps => new SelectionPass(deps.selectionOverlayRenderer!),
            },
            {
                id: 'stack-ghost',
                layer: RenderLayer.AboveEntities,
                priority: 200,
                needs: { sprites: true },
                create: () => new StackGhostPass(),
            },
            {
                id: 'placement-preview',
                layer: RenderLayer.Overlay,
                priority: 100,
                needs: { sprites: true, colorShader: true },
                create: () => new PlacementPreviewPass(),
            },
        ];
        this.passRegistry.registerAll(passDefinitions);
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

        // Initialize the dynamic pass registry (instantiates all registered pass definitions)
        this.passRegistry.init({
            selectionOverlayRenderer: this.selectionOverlayRenderer,
            spriteBatchRenderer: this.spriteBatchRenderer,
        });

        // Initialize sprite batch renderer and manager if available
        if (this.spriteManager && !this.skipSpriteLoading) {
            this.spriteBatchRenderer.init(gl);

            // Wire up essential sprites callback — fires when common sprites near
            // player start are loaded (streaming cache path fires this early,
            // before all layers arrive)
            let essentialFired = false;
            this.spriteManager.onEssentialSpritesReady = () => {
                if (!essentialFired) {
                    essentialFired = true;
                    this._onSpritesLoaded?.();
                }
            };

            // Start sprite loading in background (don't await)
            this.spriteManager
                .init(gl)
                .then(loaded => {
                    if (loaded) {
                        EntityRenderer.log.debug(
                            // eslint-disable-next-line no-restricted-syntax -- optional chain on nullable-by-design lazy-loaded manager; 0 is correct fallback for debug log
                            `Sprite loading complete: ${this.spriteManager?.spriteRegistry?.getBuildingCount() ?? 0} building sprites for ${this.spriteManager?.currentRace != null ? Race[this.spriteManager.currentRace] : 'unknown'}`
                        );
                    }
                    // For cold-load path (no cache): onEssentialSpritesReady was never
                    // called by the cache manager, so fire now as fallback
                    if (!essentialFired) {
                        essentialFired = true;
                        this._onSpritesLoaded?.();
                    }
                })
                .catch((err: unknown) => {
                    EntityRenderer.log.warn(`Sprite loading failed: ${String(err)}`);
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
     * Register feature-provided render pass definitions.
     * Must be called before init() — pass factories are invoked during init().
     */
    public registerPassDefinitions(definitions: readonly RenderPassDefinition[]): void {
        this.passRegistry.registerAll(definitions);
    }

    /** Set the initial race before GL init. Must be called before init(). */
    public setInitialRace(race: Race): void {
        this.spriteManager?.setInitialRace(race);
    }

    public getRace(): Race {
        // eslint-disable-next-line no-restricted-syntax -- optional chaining; null when source is absent
        const race = this.spriteManager?.currentRace ?? null;
        if (race === null) {
            throw new Error('EntityRenderer: no race set — call setInitialRace() before init()');
        }
        return race;
    }

    /**
     * Switch to a different race and reload building sprites.
     */
    public async setRace(race: Race): Promise<boolean> {
        if (!this.spriteManager) {
            return false;
        }
        return this.spriteManager.setRace(race);
    }

    /**
     * Set render context from an IRenderContext interface.
     * Stores the context and rebuilds the sprite resolver for the current frame.
     *
     * @param ctx The render context containing all data needed for rendering
     */
    public setContext(ctx: IRenderContext): void {
        this.renderContext = ctx;

        // Rebuild sprite resolver with current frame's state providers
        this._spriteResolver = new EntitySpriteResolver(
            this.spriteManager,
            ctx.getVisualState,
            ctx.getDirectionTransition,
            ctx.getBuildingRenderState,
            ctx.pileStates,
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
        if (!this.dynamicBuffer) {
            return;
        }
        if (!this._spriteResolver) {
            throw new Error('EntityRenderer.draw() called before setContext() — spriteResolver not initialized');
        }
        const ctx = this.renderContext!;
        if (ctx.entities.length === 0 && !this.placementPreview) {
            return;
        }

        this.spriteManager?.drainPendingUploads(gl);

        const frameStart = performance.now();
        profiler.beginFrame();
        this.frameDrawCalls = 0;
        this.frameSpriteCount = 0;

        gl.enable(gl.BLEND);
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

        // Build the shared pass context for this frame (frameContext=null until depth sort)
        const passCtx = this.buildPassContext();

        // Phase 1: BeforeDepthSort passes
        this.executePassLayer(gl, projection, viewPoint, passCtx, RenderLayer.BeforeDepthSort);

        // Depth sort — populates this.frameContext and this.sortedEntities
        this.frameCullSortTime = this.timedPass(() => this.sortEntitiesByDepth(viewPoint));
        passCtx.frameContext = this.frameContext;

        // Phase 2: Remaining layers (BehindEntities → Entities → AboveEntities → Overlay)
        this.executePostSortPasses(gl, projection, viewPoint, passCtx);

        // Collect debug labels from entity-layer orchestrator
        const entityLayerPass = this.passRegistry.getPass('entity-layer') as EntityLayerOrchestrator | undefined;
        if (entityLayerPass) {
            this.debugDecoLabels = entityLayerPass.debugDecoLabels;
        }

        gl.disable(gl.BLEND);
        profiler.endFrame();
        this.lastEntityDrawTime = performance.now() - frameStart;
    }

    /** Prepare + draw all passes in a single layer. */
    private executePassLayer(
        gl: WebGL2RenderingContext,
        projection: Float32Array,
        viewPoint: IViewPoint,
        passCtx: PassContext,
        layer: RenderLayer
    ): void {
        for (const slot of this.passRegistry.getPassesForLayer(layer)) {
            slot.pass.prepare(passCtx);
            if (slot.needs.colorShader) {
                this.setupColorShader(gl, projection);
            }
            slot.pass.draw(gl, projection, viewPoint);
            // eslint-disable-next-line no-restricted-syntax -- frame stats counters: passes initialise these to undefined until first draw
            this.frameDrawCalls += slot.pass.lastDrawCalls ?? 0;
            // eslint-disable-next-line no-restricted-syntax -- frame stats counters: passes initialise these to undefined until first draw
            this.frameSpriteCount += slot.pass.lastSpriteCount ?? 0;
        }
    }

    /** Prepare and draw all post-depth-sort passes (BehindEntities through Overlay). */
    private executePostSortPasses(
        gl: WebGL2RenderingContext,
        projection: Float32Array,
        viewPoint: IViewPoint,
        passCtx: PassContext
    ): void {
        const layers = [
            RenderLayer.BehindEntities,
            RenderLayer.Entities,
            RenderLayer.AboveEntities,
            RenderLayer.Overlay,
        ];

        const groundOverlayPass = this.passRegistry.getPass('ground-overlay') as GroundOverlayPass | undefined;

        profiler.beginPhase('draw');
        for (const layer of layers) {
            this.executePassLayer(gl, projection, viewPoint, passCtx, layer);
            // Building footprints and unit positions render on top of entity sprites
            if (layer === RenderLayer.Entities && groundOverlayPass) {
                this.setupColorShader(gl, projection);
                groundOverlayPass.drawFootprints(gl, projection, viewPoint);
                groundOverlayPass.drawUnitPositions(gl, projection, viewPoint);
            }
        }
        profiler.endPhase('draw');
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
        // Before init(), passRegistry isn't initialized — return zeros
        if (!this.dynamicBuffer) {
            return {
                cullSort: 0,
                entities: 0,
                visibleCount: 0,
                drawCalls: 0,
                spriteCount: 0,
                textured: 0,
                color: 0,
                selection: 0,
            };
        }
        const entityLayerPass = this.passRegistry.getPass('entity-layer') as EntityLayerOrchestrator | undefined;
        return {
            cullSort: this.frameCullSortTime,
            entities: this.lastEntityDrawTime,
            visibleCount: this.sortedEntities.length,
            drawCalls: this.frameDrawCalls,
            spriteCount: this.frameSpriteCount,
            // Detailed breakdown from entity-layer orchestrator
            // eslint-disable-next-line no-restricted-syntax -- entityLayerPass is nullable-by-design: not registered until after first render
            textured: entityLayerPass?.timings.textured ?? 0,
            // eslint-disable-next-line no-restricted-syntax -- entityLayerPass is nullable-by-design: not registered until after first render
            color: entityLayerPass?.timings.color ?? 0,
            selection: this.frameSelectionTime,
        };
    }

    // =========================================================================
    // Private helpers
    // =========================================================================

    /** Build the PassContext for the current frame. */
    private buildPassContext(): PassContext {
        const rc = this.renderContext!;
        return {
            // Spatial
            mapSize: this.mapSize,
            groundHeight: this.groundHeight,
            // Color shader
            aPosition: this.aPosition,
            aEntityPos: this.aEntityPos,
            aColor: this.aColor,
            dynamicBuffer: this.dynamicBuffer!,
            // Sprite subsystems
            spriteManager: this.spriteManager,
            spriteBatchRenderer: this.spriteBatchRenderer,
            spriteResolver: this._spriteResolver!,
            // Entity frame
            sortedEntities: this.sortedEntities,
            frameContext: this.frameContext,
            selectedEntityIds: rc.selection.ids as Set<number>,
            unitStates: rc.unitStates,
            // Entity state providers
            getBuildingOverlays: rc.getBuildingOverlays,
            getVisualState: rc.getVisualState,
            getDirectionTransition: rc.getDirectionTransition,
            getHealthRatio: rc.getHealthRatio,
            // Render parameters
            renderSettings: rc.settings,
            layerVisibility: rc.layerVisibility,
            // Overlay / special pass data
            territoryDots: rc.territoryDots,
            workAreaCircles: rc.workAreaCircles,
            workAreaDots: rc.workAreaDots,
            stackGhosts: rc.stackGhosts,
            placementPreview: this.placementPreview,
            tileHighlights: this.tileHighlights,
            // Debug
            debugDecoLabels: this.debugDecoLabels,
            labelOnlyMapObjects: this.labelOnlyMapObjects,
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
        const rc = this.renderContext!;
        // Create frame context - computes bounds once, caches all world positions
        this.labelOnlyMapObjects.length = 0;
        profiler.beginPhase('cull');
        this.frameContext = FrameContext.create({
            viewPoint,
            entities: rc.entities as Entity[],
            unitStates: rc.unitStates,
            groundHeight: this.groundHeight,
            mapSize: this.mapSize,
            alpha: rc.alpha,
            isEntityVisible: this.isEntityVisible.bind(this),
        });
        profiler.endPhase('cull');

        // Copy visible entities to sortedEntities array
        this.sortedEntities.length = 0;
        for (const entity of this.frameContext.visibleEntities) {
            this.sortedEntities.push(entity);
        }

        // Record culling metrics
        profiler.recordEntities(
            rc.entities.length,
            this.frameContext.visibleEntities.length,
            this.frameContext.culledCount
        );

        // Sort by depth using optimized sorter
        profiler.beginPhase('sort');
        const frameCtx = this.frameContext;
        const sortCtx: OptimizedSortContext = {
            spriteManager: this.spriteManager,
            getWorldPos: frameCtx.getWorldPos.bind(frameCtx),
            // eslint-disable-next-line no-restricted-syntax -- renderer frame loop: visual state can legitimately be absent between ticks
            getVariation: entityId => rc.getVisualState(entityId)?.variation ?? 0,
        };
        this.depthSorter.sortByDepth(this.sortedEntities, sortCtx);
        profiler.endPhase('sort');
    }

    /**
     * Check if an entity should be rendered based on layer visibility settings.
     */
    private isEntityVisible(entity: Entity): boolean {
        const layerVisibility = this.renderContext!.layerVisibility;
        switch (entity.type) {
            case EntityType.Building:
                return layerVisibility.buildings;
            case EntityType.Unit:
                return layerVisibility.units;
            case EntityType.MapObject: {
                const visible = isMapObjectVisible(layerVisibility, entity.subType as MapObjectType);
                if (!visible && layerVisibility.showDecoLabels) {
                    this.labelOnlyMapObjects.push(entity);
                }
                return visible;
            }
            case EntityType.Decoration:
            case EntityType.StackedPile:
            case EntityType.None:
                return true;
        }
    }
}
