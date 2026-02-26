import { IRenderer } from './i-renderer';
import { IViewPoint } from './i-view-point';
import { RendererBase } from './renderer-base';
import { Entity, EntityType, StackedResourceState, UnitType, MapObjectType } from '../entity';
import { MapSize } from '@/utilities/map-size';
import { TilePicker } from '../input/tile-picker';
import { TILE_CENTER_X, TILE_CENTER_Y } from '../systems/coordinate-system';
import { LogHandler } from '@/utilities/log-handler';
import { FileManager } from '@/utilities/file-manager';
import { SpriteEntry, Race } from './sprite-metadata';
import { PLAYER_COLORS, TINT_NEUTRAL, TINT_SELECTED, TINT_PREVIEW_VALID, TINT_PREVIEW_INVALID } from './tint-utils';
import { SpriteRenderManager } from './sprite-render-manager';
import { PALETTE_TEXTURE_WIDTH } from './palette-texture';
import { SpriteBatchRenderer } from './sprite-batch-renderer';
import { SelectionOverlayRenderer } from './selection-overlay-renderer';
import type { AnimationState } from '../animation';
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
    PlacementPreviewState,
    UnitStateLookup,
    BuildingRenderState,
    BuildingOverlayRenderData,
    RenderSettings,
} from './render-context';
import { OverlayRenderLayer } from './render-context';

import vertCode from './shaders/entity-vert.glsl';
import fragCode from './shaders/entity-frag.glsl';

// Re-export PlacementPreviewState from its canonical location
export type { PlacementPreviewState } from './render-context';

import {
    TEXTURE_UNIT_SPRITE_ATLAS,
    BASE_QUAD,
    BUILDING_SCALE,
    UNIT_SCALE,
    RESOURCE_SCALE,
    PREVIEW_VALID_COLOR,
    PREVIEW_INVALID_COLOR,
    decoHueToRgb,
    decoTypeToHue,
    scaleSprite,
    getSpriteScale,
} from './entity-renderer-constants';

const EMPTY_OVERLAYS: readonly BuildingOverlayRenderData[] = [];

/**
 * Renders entities (units and buildings) as colored quads or textured sprites.
 * Supports smooth unit interpolation, path visualization, and placement preview.
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

    // Animation state provider (from context)
    private getAnimState: (entityId: number) => AnimationState | null = () => null;

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

    /** Debug: decoration labels collected during drawColorEntities (screen-space) */
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

    // Cached attribute/uniform locations for color shader
    private aPosition = -1;
    private aEntityPos = -1;
    private aColor = -1;

    // Reusable vertex buffer to avoid per-frame allocations
    private vertexData = new Float32Array(6 * 2);

    // Reusable array for depth-sorted entities
    private sortedEntities: Entity[] = [];
    // Reusable array for units with direction transitions
    private transitioningUnits: Entity[] = [];

    // Per-frame timing (for debugStats reporting)
    private frameCullSortTime = 0;
    private frameDrawTime = 0;
    private frameDrawCalls = 0;
    private frameSpriteCount = 0;

    // Detailed timing breakdown
    private frameTexturedTime = 0;
    private frameColorTime = 0;
    private frameSelectionTime = 0;

    /** Skip sprite loading (for testMap or procedural textures mode) */
    public skipSpriteLoading = false;

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
        this.getAnimState = ctx.getAnimationState;
        this.resourceStates = ctx.resourceStates as Map<number, StackedResourceState>;
        this.renderAlpha = ctx.alpha;
        this.layerVisibility = ctx.layerVisibility;
        this.renderSettings = ctx.settings;
        this.placementPreview = ctx.placementPreview;
        this.selectedServiceAreas = ctx.selectedServiceAreas;
        this.territoryDots = ctx.territoryDots;

        // Rebuild sprite resolver with current frame's state providers
        this.spriteResolver = new EntitySpriteResolver(
            this.spriteManager,
            ctx.getAnimationState,
            ctx.getBuildingRenderState,
            ctx.resourceStates,
            ctx.layerVisibility
        );
    }

    /**
     * Clean up all GPU resources.
     */
    public destroy(): void {
        const gl = this.glContext;
        if (!gl) return;

        // Clean up color shader resources
        if (this.dynamicBuffer) {
            gl.deleteBuffer(this.dynamicBuffer);
            this.dynamicBuffer = null;
        }

        // Clean up sprite batch renderer
        this.spriteBatchRenderer.destroy(gl);

        // Clean up sprite manager
        this.spriteManager?.destroy();

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

        const selectionCtx = {
            mapSize: this.mapSize,
            groundHeight: this.groundHeight,
            viewPoint,
            unitStates: this.unitStates,
        };

        // Pass 1: Path indicators + depth sort + ground overlays
        this.setupColorShader(gl, projection);
        this.drawPathIndicators(gl, selectionCtx);
        this.frameCullSortTime = this.timedPass(() => this.sortEntitiesByDepth(viewPoint));
        this.drawGroundOverlays(gl, projection, selectionCtx);
        this.drawTerritoryDotSprites(gl, projection, viewPoint);

        // Pass 2: Entity rendering (textured sprites + color fallback)
        this.frameDrawTime = this.timedPass(() => this.drawEntityPass(gl, projection, viewPoint));

        // Pass 3: Selection overlays (frames, dots, highlights)
        this.frameSelectionTime = this.timedPass(() => this.drawSelectionPass(gl, selectionCtx));

        // Pass 4: Placement preview ghost
        this.drawPlacementPreview(gl, projection, viewPoint);

        gl.disable(gl.BLEND);
        profiler.endFrame();
        this.lastEntityDrawTime = performance.now() - frameStart;
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

    /** Draw path indicators for selected units. */
    private drawPathIndicators(
        gl: WebGL2RenderingContext,
        selectionCtx: { mapSize: MapSize; groundHeight: Uint8Array; viewPoint: IViewPoint; unitStates: UnitStateLookup }
    ): void {
        if (!this.layerVisibility.showPathfinding) return;
        this.selectionOverlayRenderer.drawSelectedUnitPath(
            gl,
            this.dynamicBuffer!,
            this.selectedEntityIds,
            this.aEntityPos,
            this.aColor,
            selectionCtx
        );
    }

    /** Draw entities using textured sprites and color fallback. */
    private drawEntityPass(gl: WebGL2RenderingContext, projection: Float32Array, viewPoint: IViewPoint): void {
        profiler.beginPhase('draw');
        const hasSprites = this.spriteManager?.hasSprites && this.spriteBatchRenderer.isInitialized;
        if (hasSprites) {
            this.frameTexturedTime = this.timedPass(() => this.drawTexturedEntities(gl, projection, viewPoint));
            this.frameColorTime = this.timedPass(() => this.drawColorEntities(gl, projection, viewPoint, true));
        } else {
            this.frameTexturedTime = 0;
            this.frameColorTime = this.timedPass(() => this.drawColorEntities(gl, projection, viewPoint, false));
        }
        profiler.endPhase('draw');
    }

    /** Draw selection frames, dots, and tile highlights. */
    private drawSelectionPass(
        gl: WebGL2RenderingContext,
        selectionCtx: { mapSize: MapSize; groundHeight: Uint8Array; viewPoint: IViewPoint; unitStates: UnitStateLookup }
    ): void {
        const buf = this.dynamicBuffer!;
        this.selectionOverlayRenderer.drawSelectionFrames(
            gl,
            buf,
            this.sortedEntities,
            this.selectedEntityIds,
            this.aEntityPos,
            this.aColor,
            selectionCtx
        );
        this.selectionOverlayRenderer.drawSelectionDots(
            gl,
            buf,
            this.sortedEntities,
            this.selectedEntityIds,
            this.aEntityPos,
            this.aColor,
            selectionCtx
        );
        if (this.tileHighlights.length > 0) {
            this.selectionOverlayRenderer.drawTileHighlights(
                gl,
                buf,
                this.tileHighlights,
                this.aEntityPos,
                this.aColor,
                selectionCtx
            );
        }
    }

    /** Draw ground overlays: building footprints and service area circles. */
    private drawGroundOverlays(
        gl: WebGL2RenderingContext,
        projection: Float32Array,
        ctx: { mapSize: MapSize; groundHeight: Uint8Array; viewPoint: IViewPoint; unitStates: UnitStateLookup }
    ): void {
        const hasFootprints = this.renderSettings.showBuildingFootprint;
        const hasServiceAreas = this.selectedServiceAreas.length > 0;
        if (!hasFootprints && !hasServiceAreas) return;

        super.drawBase(gl, projection);
        gl.bindBuffer(gl.ARRAY_BUFFER, this.dynamicBuffer);
        gl.enableVertexAttribArray(this.aPosition);
        gl.vertexAttribPointer(this.aPosition, 2, gl.FLOAT, false, 0, 0);
        gl.disableVertexAttribArray(this.aEntityPos);
        gl.disableVertexAttribArray(this.aColor);

        const buf = this.dynamicBuffer!;
        if (hasFootprints)
            this.selectionOverlayRenderer.drawBuildingFootprints(
                gl,
                buf,
                this.sortedEntities,
                this.aPosition,
                this.aEntityPos,
                this.aColor,
                ctx
            );
        if (hasServiceAreas)
            this.selectionOverlayRenderer.drawServiceAreaCircles(
                gl,
                buf,
                this.selectedServiceAreas,
                this.aEntityPos,
                this.aColor,
                ctx
            );
    }

    /** Draw territory boundary dots as sprites using the sprite batch renderer. */
    private drawTerritoryDotSprites(gl: WebGL2RenderingContext, projection: Float32Array, viewPoint: IViewPoint): void {
        if (this.territoryDots.length === 0) return;
        if (!this.spriteManager?.hasSprites || !this.spriteBatchRenderer.isInitialized) return;

        this.spriteManager.spriteAtlas!.bindForRendering(gl);
        this.spriteManager.paletteManager.bind(gl);

        const paletteWidth = PALETTE_TEXTURE_WIDTH;
        const rowsPerPlayer = this.spriteManager.paletteManager.textureRowsPerPlayer;
        this.spriteBatchRenderer.beginSpriteBatch(
            gl,
            projection,
            paletteWidth,
            rowsPerPlayer,
            this.renderSettings.antialias
        );

        for (const dot of this.territoryDots) {
            const sprite = this.spriteManager.getTerritoryDot(dot.player);
            if (!sprite) continue;

            const worldPos = TilePicker.tileToWorld(
                dot.x,
                dot.y,
                this.groundHeight,
                this.mapSize,
                viewPoint.x,
                viewPoint.y
            );

            const scaled = scaleSprite(sprite, 2.25);
            this.spriteBatchRenderer.addSprite(gl, worldPos.worldX, worldPos.worldY, scaled, 0, 1, 1, 1, 1);
        }

        this.frameDrawCalls += this.spriteBatchRenderer.endSpriteBatch(gl);
    }

    /** Last frame's entity draw time (ms) - for debug stats collection */
    private lastEntityDrawTime = 0;

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

    /** Enable alpha-to-coverage if MSAA is active, return whether it was enabled */
    private enableAlphaToCoverageIfMSAA(gl: WebGL2RenderingContext): boolean {
        const samples = gl.getParameter(gl.SAMPLES) as number;
        if (samples > 1) {
            gl.enable(gl.SAMPLE_ALPHA_TO_COVERAGE);
            return true;
        }
        return false;
    }

    /**
     * Draw entities using the sprite shader and atlas texture (batched).
     */
    private drawTexturedEntities(gl: WebGL2RenderingContext, projection: Float32Array, viewPoint: IViewPoint): void {
        if (!this.spriteManager?.hasSprites || !this.spriteBatchRenderer.isInitialized) return;

        // Enable alpha-to-coverage for smooth sprite edges when MSAA is active
        const useAlphaToCoverage = this.enableAlphaToCoverageIfMSAA(gl);

        // Bind atlas and palette textures so shaders can sample them
        this.spriteManager.spriteAtlas!.bindForRendering(gl);
        this.spriteManager.paletteManager.bind(gl);

        const paletteWidth = PALETTE_TEXTURE_WIDTH;
        const rowsPerPlayer = this.spriteManager.paletteManager.textureRowsPerPlayer;
        this.spriteBatchRenderer.beginSpriteBatch(
            gl,
            projection,
            paletteWidth,
            rowsPerPlayer,
            this.renderSettings.antialias
        );
        this.transitioningUnits.length = 0;

        for (const entity of this.sortedEntities) {
            const resolved = this.spriteResolver!.resolve(entity);
            if (resolved.skip) continue;
            if (resolved.transitioning) {
                this.transitioningUnits.push(entity);
                continue;
            }
            if (!resolved.sprite) continue;

            const worldPos = this.getEntityWorldPos(entity, viewPoint);
            this.emitEntitySprite(gl, entity, resolved, worldPos);
        }

        this.frameDrawCalls += this.spriteBatchRenderer.endSpriteBatch(gl);

        // Draw transitioning units with blend shader
        if (this.transitioningUnits.length > 0) {
            this.drawTransitioningUnits(gl, projection, viewPoint);
        }

        // Disable alpha-to-coverage
        if (useAlphaToCoverage) {
            gl.disable(gl.SAMPLE_ALPHA_TO_COVERAGE);
        }
    }

    /** Emit sprite batch data for a single entity (and its overlays if it's a building). */
    private emitEntitySprite(
        gl: WebGL2RenderingContext,
        entity: Entity,
        resolved: { sprite: SpriteEntry | null; progress: number },
        worldPos: { worldX: number; worldY: number }
    ): void {
        const playerRow =
            entity.type === EntityType.Building || entity.type === EntityType.Unit ? this.getPlayerRow(entity) : 0;
        const isSelected = this.selectedEntityIds.has(entity.id);
        const tint = isSelected ? TINT_SELECTED : TINT_NEUTRAL;
        const scale = getSpriteScale(entity);

        // Building overlays: draw BehindBuilding layer (includes construction background during CompletedRising)
        const overlays = entity.type === EntityType.Building ? this.getBuildingOverlays(entity.id) : EMPTY_OVERLAYS;
        if (overlays.length > 0) {
            this.emitOverlaysForLayer(gl, overlays, worldPos, playerRow, OverlayRenderLayer.BehindBuilding);
        }

        // Draw the main entity sprite
        const sprite = scaleSprite(resolved.sprite!, scale);

        if (resolved.progress < 1.0) {
            this.spriteBatchRenderer.addSpritePartial(
                gl,
                worldPos.worldX,
                worldPos.worldY,
                sprite,
                playerRow,
                tint[0]!,
                tint[1]!,
                tint[2]!,
                tint[3]!,
                resolved.progress
            );
        } else {
            this.spriteBatchRenderer.addSprite(
                gl,
                worldPos.worldX,
                worldPos.worldY,
                sprite,
                playerRow,
                tint[0]!,
                tint[1]!,
                tint[2]!,
                tint[3]!
            );
        }
        this.frameSpriteCount++;

        // Building overlays: draw remaining layers (AboveBuilding, Flag, AboveFlag)
        if (overlays.length > 0) {
            this.emitOverlaysForLayer(gl, overlays, worldPos, playerRow, OverlayRenderLayer.AboveBuilding);
            this.emitOverlaysForLayer(gl, overlays, worldPos, playerRow, OverlayRenderLayer.Flag);
            this.emitOverlaysForLayer(gl, overlays, worldPos, playerRow, OverlayRenderLayer.AboveFlag);
        }
    }

    /** Draw all building overlays matching a given render layer. */
    private emitOverlaysForLayer(
        gl: WebGL2RenderingContext,
        overlays: readonly BuildingOverlayRenderData[],
        buildingWorldPos: { worldX: number; worldY: number },
        playerRow: number,
        layer: OverlayRenderLayer
    ): void {
        for (const overlay of overlays) {
            if (overlay.layer !== layer) continue;
            const x = buildingWorldPos.worldX + overlay.worldOffsetX;
            const y = buildingWorldPos.worldY + overlay.worldOffsetY;
            const row = overlay.teamColored ? playerRow : 0;
            if (overlay.verticalProgress < 1.0) {
                this.spriteBatchRenderer.addSpritePartial(
                    gl,
                    x,
                    y,
                    overlay.sprite,
                    row,
                    1,
                    1,
                    1,
                    1,
                    overlay.verticalProgress
                );
            } else {
                this.spriteBatchRenderer.addSprite(gl, x, y, overlay.sprite, row, 1, 1, 1, 1);
            }
            this.frameSpriteCount++;
        }
    }

    /**
     * Get the palette row for player tinting.
     * Returns 0 (neutral) if player tinting is disabled, otherwise player + 1.
     */
    private getPlayerRow(entity: Entity): number {
        if (this.renderSettings.disablePlayerTinting) {
            return 0;
        }
        return entity.player + 1;
    }

    /** Compute world position for an entity, with MapObject jitter for visual variety. */
    private getEntityWorldPos(entity: Entity, viewPoint: IViewPoint): { worldX: number; worldY: number } {
        const cachedPos = this.frameContext?.getWorldPos(entity);
        let worldPos: { worldX: number; worldY: number };
        if (cachedPos) {
            worldPos = { worldX: cachedPos.worldX, worldY: cachedPos.worldY };
        } else if (entity.type === EntityType.Unit) {
            worldPos = this.getInterpolatedWorldPos(entity, viewPoint);
        } else {
            worldPos = TilePicker.tileToWorld(
                entity.x,
                entity.y,
                this.groundHeight,
                this.mapSize,
                viewPoint.x,
                viewPoint.y
            );
        }

        // Buildings: render at tile top vertex instead of parallelogram center.
        // GFX sprite offsets (left/top) are authored relative to the tile vertex,
        // not the center, so undo the TILE_CENTER shift.
        if (entity.type === EntityType.Building) {
            worldPos.worldX -= TILE_CENTER_X;
            worldPos.worldY -= TILE_CENTER_Y * 0.5;
        }

        // Add random visual offset for MapObjects (trees, stones) to break up the grid.
        // Applied to all tree variations so the position stays consistent through growth/cutting/stump stages.
        if (entity.type === EntityType.MapObject) {
            const seed = entity.x * 12.9898 + entity.y * 78.233;
            const offsetX = ((Math.sin(seed) * 43758.5453) % 1) * 0.3 - 0.15;
            const offsetY = ((Math.cos(seed) * 43758.5453) % 1) * 0.3 - 0.15;
            worldPos.worldX += offsetX;
            worldPos.worldY += offsetY;
        }

        return worldPos;
    }

    /**
     * Draw units that are transitioning between directions using the blend shader.
     */
    private drawTransitioningUnits(gl: WebGL2RenderingContext, projection: Float32Array, viewPoint: IViewPoint): void {
        if (!this.spriteManager) return;

        const paletteWidth = PALETTE_TEXTURE_WIDTH;
        const rowsPerPlayer = this.spriteManager.paletteManager.textureRowsPerPlayer;
        this.spriteBatchRenderer.beginBlendBatch(gl, projection, paletteWidth, rowsPerPlayer);

        for (const entity of this.transitioningUnits) {
            const animState = this.getAnimState(entity.id);
            if (!animState?.previousDirection || animState.directionTransitionProgress === undefined) continue;

            const oldDir = animState.previousDirection;
            const newDir = animState.direction;
            const blendFactor = animState.directionTransitionProgress;
            const unitType = entity.subType as UnitType;

            // Get animated sprites for both directions at current frame
            const oldSprite = this.spriteResolver!.getUnitSpriteForDirection(unitType, animState, oldDir);
            const newSprite = this.spriteResolver!.getUnitSpriteForDirection(unitType, animState, newDir);

            if (!oldSprite || !newSprite) continue;

            const scaledOld = scaleSprite(oldSprite);
            const scaledNew = scaleSprite(newSprite);

            // Use cached world position from frame context
            const cachedPos = this.frameContext?.getWorldPos(entity);
            const worldPos = cachedPos ?? this.getInterpolatedWorldPos(entity, viewPoint);
            const playerRow = this.getPlayerRow(entity);
            const isSelected = this.selectedEntityIds.has(entity.id);
            const tint = isSelected ? TINT_SELECTED : TINT_NEUTRAL;
            this.spriteBatchRenderer.addBlendSprite(
                gl,
                worldPos.worldX,
                worldPos.worldY,
                scaledOld,
                scaledNew,
                blendFactor,
                playerRow,
                tint[0]!,
                tint[1]!,
                tint[2]!,
                tint[3]!
            );
        }

        this.spriteBatchRenderer.endBlendBatch(gl);
    }

    /** Get scale for entity type */
    private getEntityScale(entityType: EntityType): number {
        if (entityType === EntityType.Building) return BUILDING_SCALE;
        if (entityType === EntityType.StackedResource) return RESOURCE_SCALE;
        return UNIT_SCALE;
    }

    /**
     * Draw entities using the color shader (solid quads).
     */
    private drawColorEntities(
        gl: WebGL2RenderingContext,
        projection: Float32Array,
        viewPoint: IViewPoint,
        texturedBuildingsHandled: boolean
    ): void {
        super.drawBase(gl, projection);

        gl.bindBuffer(gl.ARRAY_BUFFER, this.dynamicBuffer);
        gl.enableVertexAttribArray(this.aPosition);
        gl.vertexAttribPointer(this.aPosition, 2, gl.FLOAT, false, 0, 0);
        gl.disableVertexAttribArray(this.aEntityPos);
        gl.disableVertexAttribArray(this.aColor);

        const canvasW = gl.canvas.width;
        const canvasH = gl.canvas.height;
        this.debugDecoLabels.length = 0;

        for (const entity of this.sortedEntities) {
            if (this.shouldSkipColorEntity(entity, texturedBuildingsHandled)) continue;

            const appearance = this.getColorEntityAppearance(entity);
            const worldPos = this.getEntityWorldPos(entity, viewPoint);

            gl.vertexAttrib2f(this.aEntityPos, worldPos.worldX, worldPos.worldY);
            this.fillQuadVertices(0, 0, appearance.scale);
            gl.bufferData(gl.ARRAY_BUFFER, this.vertexData, gl.DYNAMIC_DRAW);
            gl.vertexAttrib4f(
                this.aColor,
                appearance.color[0]!,
                appearance.color[1]!,
                appearance.color[2]!,
                appearance.color[3]!
            );
            gl.drawArrays(gl.TRIANGLES, 0, 6);

            if (appearance.isDecoration) {
                this.collectDecoDebugLabel(entity, worldPos, projection, canvasW, canvasH);
            }
        }
    }

    /** Check if an entity should be skipped in color rendering (already handled by sprite batch or is a tree). */
    private shouldSkipColorEntity(entity: Entity, texturedBuildingsHandled: boolean): boolean {
        // Map objects with sprites (trees, subType <= 17) are rendered via sprite batch
        if (entity.type === EntityType.MapObject && entity.subType <= 17) return true;
        // Skip entities already rendered by the textured sprite pass
        return texturedBuildingsHandled && this.spriteResolver!.hasTexturedSprite(entity);
    }

    /** Determine color and scale for an entity in the color fallback pass. */
    private getColorEntityAppearance(entity: Entity): {
        color: readonly number[];
        scale: number;
        isDecoration: boolean;
    } {
        const isSelected = this.selectedEntityIds.has(entity.id);
        const isDecoration = entity.type === EntityType.MapObject && entity.subType > 17;
        if (isSelected)
            return {
                color: [1.0, 1.0, 0.0, 1.0],
                scale: isDecoration ? 0.8 : this.getEntityScale(entity.type),
                isDecoration,
            };
        const baseColor = isDecoration
            ? decoHueToRgb(entity.subType)
            : PLAYER_COLORS[entity.player % PLAYER_COLORS.length]!;
        const scale = isDecoration ? 0.8 : this.getEntityScale(entity.type);
        return { color: baseColor, scale, isDecoration };
    }

    /** Collect a debug label for a decoration entity (screen-space position + type info). */
    private collectDecoDebugLabel(
        entity: Entity,
        worldPos: { worldX: number; worldY: number },
        projection: Float32Array,
        canvasW: number,
        canvasH: number
    ): void {
        const clipX = projection[0]! * worldPos.worldX + projection[12]!;
        const clipY = projection[5]! * worldPos.worldY + projection[13]!;
        this.debugDecoLabels.push({
            screenX: (clipX * 0.5 + 0.5) * canvasW,
            screenY: (-clipY * 0.5 + 0.5) * canvasH,
            type: entity.subType,
            hue: decoTypeToHue(entity.subType),
        });
    }

    /** Get the interpolated world position for a unit */
    private getInterpolatedWorldPos(entity: Entity, viewPoint: IViewPoint): { worldX: number; worldY: number } {
        const unitState = this.unitStates.get(entity.id);

        const isStationary = !unitState || (unitState.prevX === entity.x && unitState.prevY === entity.y);

        if (isStationary) {
            return TilePicker.tileToWorld(
                entity.x,
                entity.y,
                this.groundHeight,
                this.mapSize,
                viewPoint.x,
                viewPoint.y
            );
        }

        const prevPos = TilePicker.tileToWorld(
            unitState.prevX,
            unitState.prevY,
            this.groundHeight,
            this.mapSize,
            viewPoint.x,
            viewPoint.y
        );
        const currPos = TilePicker.tileToWorld(
            entity.x,
            entity.y,
            this.groundHeight,
            this.mapSize,
            viewPoint.x,
            viewPoint.y
        );

        const t = Math.max(0, Math.min(unitState.moveProgress, 1));
        return {
            worldX: prevPos.worldX + (currPos.worldX - prevPos.worldX) * t,
            worldY: prevPos.worldY + (currPos.worldY - prevPos.worldY) * t,
        };
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
        };
        this.depthSorter.sortByDepth(this.sortedEntities, sortCtx);
        profiler.endPhase('sort');
    }

    /**
     * Draw a ghost entity at the preview tile when in placement mode.
     * Supports buildings, resources, and can be extended for other entity types.
     */
    private drawPlacementPreview(gl: WebGL2RenderingContext, projection: Float32Array, viewPoint: IViewPoint): void {
        const preview = this.placementPreview;
        if (!preview) return;

        const { tile, valid, entityType, subType, race, variation } = preview;

        const worldPos = TilePicker.tileToWorld(
            tile.x,
            tile.y,
            this.groundHeight,
            this.mapSize,
            viewPoint.x,
            viewPoint.y
        );

        // Apply building tile vertex offset (same as getEntityWorldPos for buildings)
        if (entityType === 'building') {
            worldPos.worldX -= TILE_CENTER_X;
            worldPos.worldY -= TILE_CENTER_Y * 0.5;
        }

        const tint = valid ? TINT_PREVIEW_VALID : TINT_PREVIEW_INVALID;

        // Try to render with sprite based on entity type
        if (this.spriteManager?.hasSprites && this.spriteBatchRenderer.isInitialized) {
            const rawSprite = this.spriteResolver!.getPreviewSprite(entityType, subType, variation, race);
            if (rawSprite) {
                const spriteEntry = scaleSprite(rawSprite);
                const paletteWidth = PALETTE_TEXTURE_WIDTH;
                const rowsPerPlayer = this.spriteManager.paletteManager.textureRowsPerPlayer;
                this.spriteBatchRenderer.beginSpriteBatch(
                    gl,
                    projection,
                    paletteWidth,
                    rowsPerPlayer,
                    this.renderSettings.antialias
                );
                this.spriteBatchRenderer.addSprite(
                    gl,
                    worldPos.worldX,
                    worldPos.worldY,
                    spriteEntry,
                    0,
                    tint[0]!,
                    tint[1]!,
                    tint[2]!,
                    tint[3]!
                );
                this.spriteBatchRenderer.endSpriteBatch(gl);
                return;
            }
        }

        // Fallback to color preview
        this.shaderProgram.use();
        gl.bindBuffer(gl.ARRAY_BUFFER, this.dynamicBuffer);

        const color = valid ? PREVIEW_VALID_COLOR : PREVIEW_INVALID_COLOR;
        gl.vertexAttrib2f(this.aEntityPos, worldPos.worldX, worldPos.worldY);
        this.fillQuadVertices(0, 0, BUILDING_SCALE);
        gl.bufferData(gl.ARRAY_BUFFER, this.vertexData, gl.DYNAMIC_DRAW);
        gl.vertexAttrib4f(this.aColor, color[0]!, color[1]!, color[2]!, color[3]!);
        gl.drawArrays(gl.TRIANGLES, 0, 6);
    }

    private fillQuadVertices(worldX: number, worldY: number, scale: number): void {
        const verts = this.vertexData;
        for (let i = 0; i < 6; i++) {
            verts[i * 2] = BASE_QUAD[i * 2]! * scale + worldX;
            verts[i * 2 + 1] = BASE_QUAD[i * 2 + 1]! * scale + worldY;
        }
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
