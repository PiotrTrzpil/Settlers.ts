import { IRenderer } from './i-renderer';
import { IViewPoint } from './i-view-point';
import { RendererBase } from './renderer-base';
import { Entity, EntityType, StackedResourceState, TileCoord, BuildingType, getBuildingFootprint, UnitType } from '../entity';
import { UnitStateLookup } from '../game-state';
import { getBuildingVisualState, BuildingConstructionPhase, type BuildingState } from '../features/building-construction';
import { MapSize } from '@/utilities/map-size';
import { TilePicker } from '../input/tile-picker';
import { LogHandler } from '@/utilities/log-handler';
import { FileManager } from '@/utilities/file-manager';
import { SpriteEntry, Race } from './sprite-metadata';
import {
    PLAYER_COLORS,
    TINT_NEUTRAL,
    TINT_SELECTED,
    TINT_PREVIEW_VALID,
    TINT_PREVIEW_INVALID,
} from './tint-utils';
import { MapObjectType } from '../entity';
import { EMaterialType } from '../economy';
import { SpriteRenderManager } from './sprite-render-manager';
import { PALETTE_TEXTURE_WIDTH } from './palette-texture';
import { BuildingIndicatorRenderer } from './building-indicator-renderer';
import { SpriteBatchRenderer } from './sprite-batch-renderer';
import { SelectionOverlayRenderer } from './selection-overlay-renderer';
import { getAnimatedSprite, getAnimatedSpriteForDirection } from '../systems/animation';
import type { AnimationService } from '../animation/index';
import type { AnimationState } from '../animation';
import { FrameContext, type IFrameContext } from './frame-context';
import { OptimizedDepthSorter, type OptimizedSortContext } from './optimized-depth-sorter';
import { profiler } from './debug/render-profiler';
import {
    LayerVisibility,
    DEFAULT_LAYER_VISIBILITY,
    isMapObjectVisible,
} from './layer-visibility';
import type { IRenderContext } from './render-context';
import { gameSettings } from '../game-settings';


import vertCode from './shaders/entity-vert.glsl';
import fragCode from './shaders/entity-frag.glsl';

import type { PlacementEntityType } from '../input/render-state';

/**
 * Consolidated placement preview state.
 * Replaces the previous 5 separate preview fields.
 */
export interface PlacementPreviewState {
    /** Tile position for the preview */
    tile: TileCoord;
    /** Whether placement is valid at this position */
    valid: boolean;
    /** Entity type being placed */
    entityType: PlacementEntityType;
    /** Specific subtype (BuildingType or EMaterialType as number) */
    subType: number;
    /** Variation/direction for sprite rendering (0-7 for resources) */
    variation?: number;
}

import {
    TEXTURE_UNIT_SPRITE_ATLAS,
    BASE_QUAD,
    BUILDING_SCALE,
    UNIT_SCALE,
    RESOURCE_SCALE,
    PREVIEW_VALID_COLOR,
    PREVIEW_INVALID_COLOR,
} from './entity-renderer-constants';

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
    public spriteManager: SpriteRenderManager | null = null;
    private animationService: AnimationService | null = null;
    private _onSpritesLoaded: (() => void) | null = null;
    private spriteBatchRenderer: SpriteBatchRenderer;
    private selectionOverlayRenderer: SelectionOverlayRenderer;
    private depthSorter: OptimizedDepthSorter;
    private buildingIndicatorRenderer: BuildingIndicatorRenderer;

    // Frame context for cached per-frame computations (world positions, bounds)
    private frameContext: IFrameContext | null = null;

    // Debug logging state
    private lastViewPointX = 0;
    private lastViewPointY = 0;
    private lastZoom = 0;

    // Entity data to render (set externally each frame)
    public entities: Entity[] = [];
    public selectedEntityId: number | null = null;
    public selectedEntityIds: Set<number> = new Set();

    // Unit states for smooth interpolation and path visualization
    public unitStates: UnitStateLookup = { get: () => undefined };

    // Building states for construction animation
    public buildingStates: Map<number, BuildingState> = new Map();

    // Resource states for stacked resources (quantity tracking)
    public resourceStates: Map<number, StackedResourceState> = new Map();

    // Consolidated placement preview state
    public placementPreview: PlacementPreviewState | null = null;

    // Legacy preview fields - maintained for backward compatibility
    // These map to/from the consolidated placementPreview state
    public get previewTile(): TileCoord | null {
        return this.placementPreview?.tile ?? null;
    }
    public set previewTile(value: TileCoord | null) {
        if (value === null) {
            this.placementPreview = null;
        } else if (this.placementPreview) {
            this.placementPreview.tile = value;
        }
    }

    public get previewValid(): boolean {
        return this.placementPreview?.valid ?? false;
    }
    public set previewValid(value: boolean) {
        if (this.placementPreview) {
            this.placementPreview.valid = value;
        }
    }

    public get previewBuildingType(): BuildingType | null {
        if (this.placementPreview?.entityType === 'building') {
            return this.placementPreview.subType as BuildingType;
        }
        return null;
    }
    public set previewBuildingType(value: BuildingType | null) {
        if (value !== null) {
            this.placementPreview = {
                tile: this.placementPreview?.tile ?? { x: 0, y: 0 },
                valid: this.placementPreview?.valid ?? false,
                entityType: 'building',
                subType: value,
                variation: this.placementPreview?.variation,
            };
        } else if (this.placementPreview?.entityType === 'building') {
            this.placementPreview = null;
        }
    }

    public get previewMaterialType(): EMaterialType | null {
        if (this.placementPreview?.entityType === 'resource') {
            return this.placementPreview.subType as EMaterialType;
        }
        return null;
    }
    public set previewMaterialType(value: EMaterialType | null) {
        if (value !== null) {
            this.placementPreview = {
                tile: this.placementPreview?.tile ?? { x: 0, y: 0 },
                valid: this.placementPreview?.valid ?? false,
                entityType: 'resource',
                subType: value,
                variation: this.placementPreview?.variation,
            };
        } else if (this.placementPreview?.entityType === 'resource') {
            this.placementPreview = null;
        }
    }

    public get previewVariation(): number | null {
        return this.placementPreview?.variation ?? null;
    }
    public set previewVariation(value: number | null) {
        if (this.placementPreview && value !== null) {
            this.placementPreview.variation = value;
        }
    }

    // Building placement indicators mode
    public buildingIndicatorsEnabled = false;

    // Render interpolation alpha for smooth sub-tick movement (0-1)
    public renderAlpha = 0;

    // Layer visibility settings
    public layerVisibility: LayerVisibility = { ...DEFAULT_LAYER_VISIBILITY };

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
    // Reusable occupancy map for building indicators
    private tileOccupancy: Map<string, number> = new Map();

    // Per-frame timing (for debugStats reporting)
    private frameCullSortTime = 0;
    private frameDrawTime = 0;
    private frameDrawCalls = 0;
    private frameSpriteCount = 0;

    // Detailed timing breakdown
    private frameIndicatorsTime = 0;
    private frameTexturedTime = 0;
    private frameColorTime = 0;
    private frameSelectionTime = 0;

    constructor(
        mapSize: MapSize,
        groundHeight: Uint8Array,
        fileManager?: FileManager,
        groundType?: Uint8Array
    ) {
        super();
        this.mapSize = mapSize;
        this.groundHeight = groundHeight;
        this.buildingIndicatorRenderer = new BuildingIndicatorRenderer(
            mapSize,
            groundType ?? new Uint8Array(mapSize.width * mapSize.height),
            groundHeight
        );
        this.spriteBatchRenderer = new SpriteBatchRenderer();
        this.selectionOverlayRenderer = new SelectionOverlayRenderer();
        this.depthSorter = new OptimizedDepthSorter();

        if (fileManager) {
            this.spriteManager = new SpriteRenderManager(fileManager, TEXTURE_UNIT_SPRITE_ATLAS);
        }
    }

    /**
     * Set the animation service for reading animation state.
     */
    public setAnimationService(animationService: AnimationService): void {
        this.animationService = animationService;
    }

    /**
     * Get animation state for an entity from AnimationService.
     */
    private getAnimState(entityId: number): AnimationState | null {
        return this.animationService?.getState(entityId) ?? null;
    }

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

        // Initialize building indicator renderer
        this.buildingIndicatorRenderer.init(gl);

        // Initialize sprite batch renderer and manager if available
        if (this.spriteManager) {
            this.spriteBatchRenderer.init(gl);

            // Start sprite loading in background (don't await)
            this.spriteManager.init(gl).then(loaded => {
                if (loaded) {
                    EntityRenderer.log.debug(
                        `Sprite loading complete: ${this.spriteManager?.spriteRegistry?.getBuildingCount() ?? 0} building sprites for ${Race[this.spriteManager?.currentRace ?? Race.Roman]}`
                    );
                }
                // Notify when sprites are loaded (even if loading failed, animations are ready)
                this._onSpritesLoaded?.();
            });
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
        return this.spriteManager?.currentRace ?? Race.Roman;
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
        this.buildingStates = ctx.buildingStates as Map<number, BuildingState>;
        this.resourceStates = ctx.resourceStates as Map<number, StackedResourceState>;
        this.renderAlpha = ctx.alpha;
        this.layerVisibility = ctx.layerVisibility;
        this.placementPreview = ctx.placementPreview;
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

        // Clean up building indicator renderer
        this.buildingIndicatorRenderer.destroy();

        EntityRenderer.log.debug('EntityRenderer resources cleaned up');
    }

    /**
     * Draw building placement indicators across visible terrain.
     */
    private drawBuildingIndicators(
        gl: WebGL2RenderingContext,
        projection: Float32Array,
        viewPoint: IViewPoint
    ): void {
        // Update indicator renderer state
        this.buildingIndicatorRenderer.enabled = this.buildingIndicatorsEnabled;
        this.buildingIndicatorRenderer.hoveredTile = this.previewTile;
        this.buildingIndicatorRenderer.buildingType = this.previewBuildingType;

        // Skip expensive occupancy map building when indicators are disabled
        if (!this.buildingIndicatorsEnabled) {
            return;
        }

        // Build tile occupancy map including full building footprints
        this.tileOccupancy.clear();
        for (const e of this.entities) {
            if (e.type === EntityType.Building) {
                const footprint = getBuildingFootprint(e.x, e.y, e.subType as BuildingType);
                for (const tile of footprint) {
                    this.tileOccupancy.set(`${tile.x},${tile.y}`, e.id);
                }
            } else {
                this.tileOccupancy.set(`${e.x},${e.y}`, e.id);
            }
        }
        this.buildingIndicatorRenderer.tileOccupancy = this.tileOccupancy;

        this.buildingIndicatorRenderer.draw(gl, projection, viewPoint);
    }

    public draw(gl: WebGL2RenderingContext, projection: Float32Array, viewPoint: IViewPoint): void {
        if (!this.dynamicBuffer) return;
        if (this.entities.length === 0 && !this.previewTile && !this.buildingIndicatorsEnabled) return;

        const frameStart = performance.now();
        profiler.beginFrame();

        // Reset per-frame counters
        this.frameDrawCalls = 0;
        this.frameSpriteCount = 0;

        // Enable blending for semi-transparent entities
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

        // Draw building placement indicators (behind everything)
        const indicatorsStart = performance.now();
        this.drawBuildingIndicators(gl, projection, viewPoint);
        this.frameIndicatorsTime = performance.now() - indicatorsStart;

        // Use color shader for non-textured elements
        super.drawBase(gl, projection);

        // Bind the reusable buffer once
        gl.bindBuffer(gl.ARRAY_BUFFER, this.dynamicBuffer);
        gl.enableVertexAttribArray(this.aPosition);
        gl.vertexAttribPointer(this.aPosition, 2, gl.FLOAT, false, 0, 0);

        // Entity position set per-entity as constant attribute
        gl.disableVertexAttribArray(this.aEntityPos);
        gl.disableVertexAttribArray(this.aColor);

        // Draw path indicators for selected unit (color shader)
        const selectionCtx = {
            mapSize: this.mapSize,
            groundHeight: this.groundHeight,
            viewPoint,
            unitStates: this.unitStates
        };
        this.selectionOverlayRenderer.drawSelectedUnitPath(
            gl, this.dynamicBuffer, this.selectedEntityIds, this.aEntityPos, this.aColor, selectionCtx
        );

        // Sort entities by depth for correct painter's algorithm rendering
        const cullSortStart = performance.now();
        this.sortEntitiesByDepth(viewPoint);
        this.frameCullSortTime = performance.now() - cullSortStart;

        // Draw building footprints BEFORE entities (ground overlay)
        if (gameSettings.state.showBuildingFootprint) {
            // Activate color shader for footprints
            super.drawBase(gl, projection);
            gl.bindBuffer(gl.ARRAY_BUFFER, this.dynamicBuffer!);
            gl.enableVertexAttribArray(this.aPosition);
            gl.vertexAttribPointer(this.aPosition, 2, gl.FLOAT, false, 0, 0);
            gl.disableVertexAttribArray(this.aEntityPos);
            gl.disableVertexAttribArray(this.aColor);

            this.selectionOverlayRenderer.drawBuildingFootprints(
                gl, this.dynamicBuffer!, this.sortedEntities,
                this.aPosition, this.aEntityPos, this.aColor, selectionCtx
            );
        }

        // Draw entities (textured or color fallback)
        const drawStart = performance.now();
        profiler.beginPhase('draw');
        if (this.spriteManager?.hasSprites && this.spriteBatchRenderer.isInitialized) {
            const texturedStart = performance.now();
            this.drawTexturedEntities(gl, projection, viewPoint);
            this.frameTexturedTime = performance.now() - texturedStart;

            const colorStart = performance.now();
            this.drawColorEntities(gl, projection, viewPoint, true);
            this.frameColorTime = performance.now() - colorStart;
        } else {
            this.frameTexturedTime = 0;
            const colorStart = performance.now();
            this.drawColorEntities(gl, projection, viewPoint, false);
            this.frameColorTime = performance.now() - colorStart;
        }
        profiler.endPhase('draw');
        this.frameDrawTime = performance.now() - drawStart;

        const selectionStart = performance.now();

        // Draw selection frames (color shader) - must be after entities
        this.selectionOverlayRenderer.drawSelectionFrames(
            gl, this.dynamicBuffer!, this.sortedEntities, this.selectedEntityIds,
            this.aEntityPos, this.aColor, selectionCtx
        );

        // Draw selection dots for selected units (on top of frames)
        this.selectionOverlayRenderer.drawSelectionDots(
            gl, this.dynamicBuffer!, this.sortedEntities, this.selectedEntityIds,
            this.aEntityPos, this.aColor, selectionCtx
        );
        this.frameSelectionTime = performance.now() - selectionStart;

        // Draw placement preview
        this.drawPlacementPreview(gl, projection, viewPoint);

        gl.disable(gl.BLEND);
        profiler.endFrame();

        // Store entity timing for collection by main Renderer
        this.lastEntityDrawTime = performance.now() - frameStart;
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
        indicators: number;
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
            indicators: this.frameIndicatorsTime,
            textured: this.frameTexturedTime,
            color: this.frameColorTime,
            selection: this.frameSelectionTime,
        };
    }

    /**
     * Get animated sprite for any entity type using AnimationService.
     * Returns the current animation frame or falls back to static sprite.
     */
    private getAnimatedEntitySprite(entity: Entity, fallbackSprite: SpriteEntry | null): SpriteEntry | null {
        if (!this.spriteManager) {
            return fallbackSprite;
        }

        const animState = this.getAnimState(entity.id);
        if (!animState) {
            return fallbackSprite;
        }

        const animatedEntry = this.spriteManager.getAnimatedEntity(entity.type, entity.subType);
        if (!animatedEntry) {
            return fallbackSprite;
        }

        try {
            return getAnimatedSprite(animState, animatedEntry.animationData, animatedEntry.staticSprite);
        } catch (e) {
            // Log details to help debug missing animation sequences
            const typeName = entity.type === EntityType.Unit ? UnitType[entity.subType] : `${EntityType[entity.type]}:${entity.subType}`;
            EntityRenderer.log.error(`Animation error for ${typeName} (id=${entity.id}): seq='${animState.sequenceKey}', available=[${[...animatedEntry.animationData.sequences.keys()].join(', ')}]`);
            throw e;
        }
    }

    /** Get sprite entry for a building entity */
    private getBuildingSprite(entity: Entity): { sprite: SpriteEntry | null; progress: number } {
        if (!this.spriteManager) return { sprite: null, progress: 1 };

        const buildingState = this.buildingStates.get(entity.id);
        const visualState = getBuildingVisualState(buildingState);
        const buildingType = entity.subType as BuildingType;

        let sprite: SpriteEntry | null;
        if (visualState.useConstructionSprite) {
            sprite = this.spriteManager.getBuildingConstruction(buildingType)
                ?? this.spriteManager.getBuilding(buildingType);
        } else {
            const fallback = this.spriteManager.getBuilding(buildingType);
            sprite = this.getAnimatedEntitySprite(entity, fallback);
        }

        return { sprite, progress: visualState.verticalProgress };
    }

    /** Get sprite entry for a map object entity */
    private getMapObjectSprite(entity: Entity): SpriteEntry | null {
        if (!this.spriteManager) return null;

        const mapObjectType = entity.subType as MapObjectType;
        const variation = entity.variation ?? 0;
        const fallback = this.spriteManager.getMapObject(mapObjectType, variation);

        // Only use animated sprite for normal trees (variation 3), others are static
        if (variation === 3) {
            return this.getAnimatedEntitySprite(entity, fallback);
        }
        return fallback;
    }

    /** Get sprite entry for a unit entity (returns null if transitioning) */
    private getUnitSprite(entity: Entity): SpriteEntry | null | 'transitioning' {
        if (!this.spriteManager) return null;

        const animState = this.getAnimState(entity.id);
        if (animState?.directionTransitionProgress !== undefined && animState.previousDirection !== undefined) {
            return 'transitioning';
        }

        const direction = animState?.direction ?? 0;
        const unitType = entity.subType as UnitType;
        const fallback = this.spriteManager.getUnit(unitType, direction);

        return this.getAnimatedEntitySprite(entity, fallback);
    }

    /**
     * Resolve an entity's sprite for rendering.
     */
    private resolveEntitySprite(entity: Entity): {
        skip: boolean;
        transitioning: boolean;
        sprite: SpriteEntry | null;
        progress: number;
    } {
        if (entity.type === EntityType.Building) {
            const result = this.getBuildingSprite(entity);
            return { skip: result.progress <= 0, transitioning: false, sprite: result.sprite, progress: result.progress };
        }
        if (entity.type === EntityType.MapObject) {
            return { skip: false, transitioning: false, sprite: this.getMapObjectSprite(entity), progress: 1 };
        }
        if (entity.type === EntityType.StackedResource) {
            const state = this.resourceStates.get(entity.id);
            const quantity = state?.quantity ?? 1;
            const direction = Math.max(0, Math.min(quantity - 1, 7)); // 1->D0 ... 8->D7

            return {
                skip: false, transitioning: false,
                sprite: this.spriteManager?.getResource(entity.subType as EMaterialType, direction) ?? null, progress: 1
            };
        }
        if (entity.type === EntityType.Unit) {
            const result = this.getUnitSprite(entity);
            if (result === 'transitioning') {
                return { skip: false, transitioning: true, sprite: null, progress: 1 };
            }
            return { skip: false, transitioning: false, sprite: result, progress: 1 };
        }
        return { skip: true, transitioning: false, sprite: null, progress: 1 };
    }

    /**
     * Draw entities using the sprite shader and atlas texture (batched).
     */
    private drawTexturedEntities(
        gl: WebGL2RenderingContext,
        projection: Float32Array,
        viewPoint: IViewPoint
    ): void {
        if (!this.spriteManager?.hasSprites || !this.spriteBatchRenderer.isInitialized) return;

        // Bind atlas and palette textures so shaders can sample them
        this.spriteManager.spriteAtlas!.bindForRendering(gl);
        this.spriteManager.paletteManager.bind(gl);

        const paletteWidth = PALETTE_TEXTURE_WIDTH;
        const rowsPerPlayer = this.spriteManager.paletteManager.textureRowsPerPlayer;
        this.spriteBatchRenderer.beginSpriteBatch(gl, projection, paletteWidth, rowsPerPlayer);
        this.transitioningUnits.length = 0;

        for (const entity of this.sortedEntities) {
            // Handle building construction background
            if (entity.type === EntityType.Building) {
                this.renderConstructionBackground(gl, entity, viewPoint);
            }

            const resolved = this.resolveEntitySprite(entity);
            if (resolved.skip) continue;
            if (resolved.transitioning) { this.transitioningUnits.push(entity); continue }
            if (!resolved.sprite) continue;

            const worldPos = this.getEntityWorldPos(entity, viewPoint);
            const playerRow = (entity.type === EntityType.Building || entity.type === EntityType.Unit) ? this.getPlayerRow(entity) : 0;
            const isSelected = this.selectedEntityIds.has(entity.id);
            const tint = isSelected ? TINT_SELECTED : TINT_NEUTRAL;

            if (resolved.progress < 1.0) {
                this.spriteBatchRenderer.addSpritePartial(
                    gl, worldPos.worldX, worldPos.worldY, resolved.sprite,
                    playerRow, tint[0], tint[1], tint[2], tint[3], resolved.progress
                );
            } else {
                this.spriteBatchRenderer.addSprite(
                    gl, worldPos.worldX, worldPos.worldY, resolved.sprite,
                    playerRow, tint[0], tint[1], tint[2], tint[3]
                );
            }
            this.frameSpriteCount++;
        }

        this.frameDrawCalls += this.spriteBatchRenderer.endSpriteBatch(gl);

        // Draw transitioning units with blend shader
        if (this.transitioningUnits.length > 0) {
            this.drawTransitioningUnits(gl, projection, viewPoint);
        }
    }

    /**
     * Get the palette row for player tinting.
     * Returns 0 (neutral) if player tinting is disabled, otherwise player + 1.
     */
    private getPlayerRow(entity: Entity): number {
        if (gameSettings.state.disablePlayerTinting) {
            return 0;
        }
        return entity.player + 1;
    }

    /** Compute world position for an entity, with MapObject jitter for visual variety. */
    private getEntityWorldPos(entity: Entity, viewPoint: IViewPoint): { worldX: number; worldY: number } {
        const cachedPos = this.frameContext?.getWorldPos(entity);
        const worldPos = cachedPos
            ? { worldX: cachedPos.worldX, worldY: cachedPos.worldY }
            : (entity.type === EntityType.Unit
                ? this.getInterpolatedWorldPos(entity, viewPoint)
                : TilePicker.tileToWorld(entity.x, entity.y, this.groundHeight, this.mapSize, viewPoint.x, viewPoint.y));

        // Add random visual offset for MapObjects (trees, stones) to break up the grid
        // Only apply to normal trees (variation 3, not being cut/growing) to avoid position mismatch with woodcutters
        if (entity.type === EntityType.MapObject && (entity.variation === undefined || entity.variation === 3)) {
            const seed = entity.x * 12.9898 + entity.y * 78.233;
            const offsetX = ((Math.sin(seed) * 43758.5453) % 1) * 0.3 - 0.15;
            const offsetY = ((Math.cos(seed) * 43758.5453) % 1) * 0.3 - 0.15;
            worldPos.worldX += offsetX;
            worldPos.worldY += offsetY;
        }

        return worldPos;
    }

    /** Render construction background sprite during CompletedRising phase */
    private renderConstructionBackground(gl: WebGL2RenderingContext, entity: Entity, viewPoint: IViewPoint): void {
        if (!this.spriteManager) return;

        const buildingState = this.buildingStates.get(entity.id);
        const visualState = getBuildingVisualState(buildingState);

        if (visualState.phase !== BuildingConstructionPhase.CompletedRising) return;

        const constructionSprite = this.spriteManager.getBuildingConstruction(entity.subType as BuildingType);
        if (!constructionSprite) return;

        const worldPos = TilePicker.tileToWorld(entity.x, entity.y, this.groundHeight, this.mapSize, viewPoint.x, viewPoint.y);
        const playerRow = this.getPlayerRow(entity);
        this.spriteBatchRenderer.addSprite(gl, worldPos.worldX, worldPos.worldY, constructionSprite, playerRow, 1, 1, 1, 1);
    }

    /**
     * Get the current animation frame sprite for a unit at a specific direction.
     * Used for direction transitions where we need sprites for two different directions.
     * Uses the unified animation API for O(1) lookup.
     */
    private getUnitSpriteForDirection(unitType: UnitType, animState: AnimationState, direction: number): SpriteEntry | null {
        if (!this.spriteManager) return null;

        const fallback = this.spriteManager.getUnit(unitType, direction);
        const animatedEntry = this.spriteManager.getAnimatedEntity(EntityType.Unit, unitType);

        if (!animatedEntry) {
            return fallback;
        }

        // Use the helper from systems/animation that handles direction lookup
        return getAnimatedSpriteForDirection(animState, animatedEntry.animationData, direction, fallback);
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
            const oldSprite = this.getUnitSpriteForDirection(unitType, animState, oldDir);
            const newSprite = this.getUnitSpriteForDirection(unitType, animState, newDir);

            if (!oldSprite || !newSprite) continue;

            // Use cached world position from frame context
            const cachedPos = this.frameContext?.getWorldPos(entity);
            const worldPos = cachedPos ?? this.getInterpolatedWorldPos(entity, viewPoint);
            const playerRow = this.getPlayerRow(entity);
            const isSelected = this.selectedEntityIds.has(entity.id);
            const tint = isSelected ? TINT_SELECTED : TINT_NEUTRAL;
            this.spriteBatchRenderer.addBlendSprite(
                gl, worldPos.worldX, worldPos.worldY, oldSprite, newSprite, blendFactor,
                playerRow, tint[0], tint[1], tint[2], tint[3]
            );
        }

        this.spriteBatchRenderer.endBlendBatch(gl);
    }

    /** Check if entity has a sprite and should be skipped in color rendering */
    private hasTexturedSprite(entity: Entity): boolean {
        if (!this.spriteManager) return false;

        switch (entity.type) {
        case EntityType.Building:
            return !!this.spriteManager.getBuilding(entity.subType as BuildingType);
        case EntityType.MapObject:
            return !!this.spriteManager.getMapObject(entity.subType as MapObjectType);
        case EntityType.StackedResource:
            return !!this.spriteManager.getResource(entity.subType as EMaterialType);
        case EntityType.Unit:
            return !!this.spriteManager.getUnit(entity.subType as UnitType);
        default:
            return false;
        }
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

        gl.bindBuffer(gl.ARRAY_BUFFER, this.dynamicBuffer!);
        gl.enableVertexAttribArray(this.aPosition);
        gl.vertexAttribPointer(this.aPosition, 2, gl.FLOAT, false, 0, 0);
        gl.disableVertexAttribArray(this.aEntityPos);
        gl.disableVertexAttribArray(this.aColor);

        for (const entity of this.sortedEntities) {
            // Map objects are only rendered via sprite batch (no dot fallback)
            if (entity.type === EntityType.MapObject) {
                continue;
            }

            // Skip entities handled by sprite renderer
            if (texturedBuildingsHandled && this.hasTexturedSprite(entity)) continue;

            const isSelected = this.selectedEntityIds.has(entity.id);
            const playerColor = PLAYER_COLORS[entity.player % PLAYER_COLORS.length];
            const color = isSelected ? [1.0, 1.0, 0.0, 1.0] : playerColor;
            const scale = this.getEntityScale(entity.type);

            // Use cached world position from frame context
            const cachedPos = this.frameContext?.getWorldPos(entity);
            const worldPos = cachedPos ?? (entity.type === EntityType.Unit
                ? this.getInterpolatedWorldPos(entity, viewPoint)
                : TilePicker.tileToWorld(entity.x, entity.y, this.groundHeight, this.mapSize, viewPoint.x, viewPoint.y));

            gl.vertexAttrib2f(this.aEntityPos, worldPos.worldX, worldPos.worldY);
            this.fillQuadVertices(0, 0, scale);
            gl.bufferData(gl.ARRAY_BUFFER, this.vertexData, gl.DYNAMIC_DRAW);
            gl.vertexAttrib4f(this.aColor, color[0], color[1], color[2], color[3]);
            gl.drawArrays(gl.TRIANGLES, 0, 6);
        }
    }

    /** Get the interpolated world position for a unit */
    private getInterpolatedWorldPos(entity: Entity, viewPoint: IViewPoint): { worldX: number; worldY: number } {
        const unitState = this.unitStates.get(entity.id);

        const isStationary = !unitState || (unitState.prevX === entity.x && unitState.prevY === entity.y);

        if (isStationary) {
            return TilePicker.tileToWorld(entity.x, entity.y, this.groundHeight, this.mapSize, viewPoint.x, viewPoint.y);
        }

        const prevPos = TilePicker.tileToWorld(unitState.prevX, unitState.prevY, this.groundHeight, this.mapSize, viewPoint.x, viewPoint.y);
        const currPos = TilePicker.tileToWorld(entity.x, entity.y, this.groundHeight, this.mapSize, viewPoint.x, viewPoint.y);

        const t = Math.max(0, Math.min(unitState.moveProgress, 1));
        return {
            worldX: prevPos.worldX + (currPos.worldX - prevPos.worldX) * t,
            worldY: prevPos.worldY + (currPos.worldY - prevPos.worldY) * t
        };
    }

    /** Sort entities by depth for correct painter's algorithm rendering. */
    private sortEntitiesByDepth(viewPoint: IViewPoint): void {
        // Update camera tracking
        this.lastViewPointX = viewPoint.x;
        this.lastViewPointY = viewPoint.y;
        this.lastZoom = viewPoint.zoom;

        // Create frame context - computes bounds once, caches all world positions
        profiler.beginPhase('cull');
        this.frameContext = FrameContext.create({
            viewPoint,
            entities: this.entities,
            unitStates: this.unitStates,
            groundHeight: this.groundHeight,
            mapSize: this.mapSize,
            alpha: this.renderAlpha,
            isEntityVisible: (entity) => this.isEntityVisible(entity),
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
            getWorldPos: (entity) => this.frameContext!.getWorldPos(entity),
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

        const { tile, valid, entityType, subType, variation } = preview;

        const worldPos = TilePicker.tileToWorld(
            tile.x, tile.y, this.groundHeight, this.mapSize, viewPoint.x, viewPoint.y
        );

        const tint = valid ? TINT_PREVIEW_VALID : TINT_PREVIEW_INVALID;

        // Try to render with sprite based on entity type
        if (this.spriteManager?.hasSprites && this.spriteBatchRenderer.isInitialized) {
            const spriteEntry = this.getPreviewSprite(entityType, subType, variation);
            if (spriteEntry) {
                const paletteWidth = PALETTE_TEXTURE_WIDTH;
                const rowsPerPlayer = this.spriteManager.paletteManager.textureRowsPerPlayer;
                this.spriteBatchRenderer.beginSpriteBatch(gl, projection, paletteWidth, rowsPerPlayer);
                this.spriteBatchRenderer.addSprite(
                    gl, worldPos.worldX, worldPos.worldY, spriteEntry,
                    0, tint[0], tint[1], tint[2], tint[3]
                );
                this.spriteBatchRenderer.endSpriteBatch(gl);
                return;
            }
        }

        // Fallback to color preview
        this.shaderProgram.use();
        gl.bindBuffer(gl.ARRAY_BUFFER, this.dynamicBuffer!);

        const color = valid ? PREVIEW_VALID_COLOR : PREVIEW_INVALID_COLOR;
        gl.vertexAttrib2f(this.aEntityPos, worldPos.worldX, worldPos.worldY);
        this.fillQuadVertices(0, 0, BUILDING_SCALE);
        gl.bufferData(gl.ARRAY_BUFFER, this.vertexData, gl.DYNAMIC_DRAW);
        gl.vertexAttrib4f(this.aColor, color[0], color[1], color[2], color[3]);
        gl.drawArrays(gl.TRIANGLES, 0, 6);
    }

    /**
     * Get the sprite for a placement preview based on entity type.
     * Uses exhaustive switch to ensure all PlacementEntityType values are handled.
     * Adding a new type to PlacementEntityType will cause a compile error here
     * until the case is added.
     */
    private getPreviewSprite(
        entityType: PlacementEntityType,
        subType: number,
        variation?: number
    ): SpriteEntry | null {
        if (!this.spriteManager) return null;

        switch (entityType) {
        case 'building':
            return this.spriteManager.getBuilding(subType as BuildingType);
        case 'resource':
            return this.spriteManager.getResource(subType as EMaterialType, variation ?? 0);
        case 'unit':
            // Units use direction 0 (facing right) for preview
            return this.spriteManager.getUnit(subType as UnitType, 0);
        default: {
            // Exhaustive check: if this errors, a new PlacementEntityType was added
            // but not handled above. Add a case for it.
            const _exhaustive: never = entityType;
            return _exhaustive;
        }
        }
    }

    private fillQuadVertices(worldX: number, worldY: number, scale: number): void {
        const verts = this.vertexData;
        for (let i = 0; i < 6; i++) {
            verts[i * 2] = BASE_QUAD[i * 2] * scale + worldX;
            verts[i * 2 + 1] = BASE_QUAD[i * 2 + 1] * scale + worldY;
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
        default:
            return true;
        }
    }

}
