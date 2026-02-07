import { IRenderer } from './i-renderer';
import { IViewPoint } from './i-view-point';
import { RendererBase } from './renderer-base';
import { ShaderProgram } from './shader-program';
import { Entity, EntityType, BuildingState, StackedResourceState, TileCoord, BuildingType, BuildingConstructionPhase, getBuildingFootprint, UnitType } from '../entity';
import { UnitStateLookup } from '../game-state';
import { getBuildingVisualState } from '../buildings/construction';
import { MapSize } from '@/utilities/map-size';
import { TilePicker } from '../input/tile-picker';
import { TerritoryMap } from '../buildings/territory';
import { LogHandler } from '@/utilities/log-handler';
import { FileManager } from '@/utilities/file-manager';
import { SpriteEntry, Race } from './sprite-metadata';
import {
    PLAYER_COLORS,
    TINT_PREVIEW_VALID,
    TINT_PREVIEW_INVALID,
} from './tint-utils';
import { MapObjectType } from '../entity';
import { EMaterialType } from '../economy/material-type';
import { TerritoryBorderRenderer } from './territory-border-renderer';
import { SpriteRenderManager } from './sprite-render-manager';
import { BuildingIndicatorRenderer } from './building-indicator-renderer';
import { getAnimatedSprite } from '../systems/animation';
import {
    LayerVisibility,
    DEFAULT_LAYER_VISIBILITY,
    isMapObjectVisible,
    getMapObjectFallbackColor,
    getMapObjectDotScale,
} from './layer-visibility';


import vertCode from './shaders/entity-vert.glsl';
import fragCode from './shaders/entity-frag.glsl';
import spriteVertCode from './shaders/entity-sprite-vert.glsl';
import spriteFragCode from './shaders/entity-sprite-frag.glsl';
import spriteBlendVertCode from './shaders/entity-sprite-blend-vert.glsl';
import spriteBlendFragCode from './shaders/entity-sprite-blend-frag.glsl';

import {
    SELECTED_COLOR,
    FRAME_COLOR,
    FRAME_CORNER_COLOR,
    PATH_COLOR,
    PREVIEW_VALID_COLOR,
    PREVIEW_INVALID_COLOR,
    TEXTURE_UNIT_SPRITE_ATLAS,
    MAX_PATH_DOTS,
    BASE_QUAD,
    BUILDING_SCALE,
    UNIT_SCALE,
    RESOURCE_SCALE,
    PATH_DOT_SCALE,
    DEPTH_FACTOR_BUILDING,
    DEPTH_FACTOR_MAP_OBJECT,
    DEPTH_FACTOR_UNIT,
    DEPTH_FACTOR_RESOURCE,
    FRAME_PADDING,
    FRAME_THICKNESS,
    FRAME_CORNER_LENGTH,
    MAX_BATCH_ENTITIES,
    FLOATS_PER_ENTITY,
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

    // Extracted managers
    private spriteManager: SpriteRenderManager | null = null;
    private territoryBorderRenderer: TerritoryBorderRenderer;
    private buildingIndicatorRenderer: BuildingIndicatorRenderer;

    // Sprite shader program (separate from color shader)
    private spriteShaderProgram: ShaderProgram | null = null;
    private spriteBuffer: WebGLBuffer | null = null;
    private spriteBatchData: Float32Array | null = null;

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

    // Building placement preview
    public previewTile: TileCoord | null = null;
    public previewValid = false;
    public previewBuildingType: BuildingType | null = null;

    // Territory visualization
    public territoryMap: TerritoryMap | null = null;
    public territoryVersion = 0;

    // Building placement indicators mode
    public buildingIndicatorsEnabled = false;
    public buildingIndicatorsPlayer = 0;
    public buildingIndicatorsHasBuildings = false;

    // Render interpolation alpha for smooth sub-tick movement (0-1)
    public renderAlpha = 0;

    // Layer visibility settings
    public layerVisibility: LayerVisibility = { ...DEFAULT_LAYER_VISIBILITY };

    // Cached attribute/uniform locations for color shader
    private aPosition = -1;
    private aEntityPos = -1;
    private aColor = -1;

    // Cached attribute locations for sprite shader
    private aSpritePos = -1;
    private aSpriteTex = -1;
    private aSpriteTint = -1;

    // Blend shader for direction transitions
    private spriteBlendShaderProgram: ShaderProgram | null = null;
    private spriteBlendBuffer: WebGLBuffer | null = null;
    private spriteBlendBatchData: Float32Array | null = null;

    // Cached attribute locations for blend shader
    private aBlendPos = -1;
    private aBlendTex1 = -1;
    private aBlendTex2 = -1;
    private aBlendFactor = -1;
    private aBlendTint = -1;

    // Reusable vertex buffer to avoid per-frame allocations
    private vertexData = new Float32Array(6 * 2);

    // Reusable array for depth-sorted entities (avoids per-frame allocations)
    private sortedEntities: Entity[] = [];
    // Cached depth keys for sorting (parallel array with sortedEntities)
    private depthKeys: number[] = [];
    // Reusable index array for sorting (avoids per-frame allocations)
    private sortIndices: number[] = [];
    // Temporary array for in-place reordering
    private sortTempEntities: Entity[] = [];
    // Reusable array for units with direction transitions
    private transitioningUnits: Entity[] = [];
    // Reusable occupancy map for building indicators (avoids per-frame Map allocation)
    private tileOccupancy: Map<string, number> = new Map();

    constructor(
        mapSize: MapSize,
        groundHeight: Uint8Array,
        fileManager?: FileManager,
        groundType?: Uint8Array
    ) {
        super();
        this.mapSize = mapSize;
        this.groundHeight = groundHeight;
        this.territoryBorderRenderer = new TerritoryBorderRenderer(mapSize, groundHeight);
        this.buildingIndicatorRenderer = new BuildingIndicatorRenderer(
            mapSize,
            groundType ?? new Uint8Array(mapSize.width * mapSize.height),
            groundHeight
        );

        if (fileManager) {
            this.spriteManager = new SpriteRenderManager(fileManager, TEXTURE_UNIT_SPRITE_ATLAS);
        }
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

        // Initialize sprite manager if available - NON-BLOCKING
        // Sprites load in background, camera controls work immediately
        if (this.spriteManager) {
            // Pre-allocate sprite shader and buffers (cheap, no data yet)
            this.initSpriteShader(gl);
            this.spriteBatchData = new Float32Array(MAX_BATCH_ENTITIES * FLOATS_PER_ENTITY);
            this.spriteBuffer = gl.createBuffer();

            // Start sprite loading in background (don't await)
            this.spriteManager.init(gl).then(loaded => {
                if (loaded) {
                    EntityRenderer.log.debug(
                        `Sprite loading complete: ${this.spriteManager?.spriteRegistry?.getBuildingCount() ?? 0} building sprites for ${Race[this.spriteManager?.currentRace ?? Race.Roman]}`
                    );
                }
            });
        }

        return true;
    }

    /**
     * Get the current race being used for building sprites.
     */
    public getRace(): Race {
        return this.spriteManager?.currentRace ?? Race.Roman;
    }

    /**
     * Switch to a different race and reload building sprites.
     * Returns true if sprites were loaded successfully.
     */
    public async setRace(race: Race): Promise<boolean> {
        if (!this.spriteManager) return false;
        return this.spriteManager.setRace(race);
    }

    /**
     * Get the animation data provider for use with the animation system.
     * Returns null if sprite manager is not available.
     */
    public getAnimationProvider(): import('../systems/animation').AnimationDataProvider | null {
        return this.spriteManager?.asAnimationProvider() ?? null;
    }

    /**
     * Clean up all GPU resources. Call when destroying the renderer.
     */
    public destroy(): void {
        const gl = this.glContext;
        if (!gl) return;

        // Clean up color shader resources
        if (this.dynamicBuffer) {
            gl.deleteBuffer(this.dynamicBuffer);
            this.dynamicBuffer = null;
        }

        // Clean up sprite shader resources
        if (this.spriteBuffer) {
            gl.deleteBuffer(this.spriteBuffer);
            this.spriteBuffer = null;
        }
        this.spriteShaderProgram?.free();
        this.spriteShaderProgram = null;
        this.spriteBatchData = null;

        // Clean up blend shader resources
        if (this.spriteBlendBuffer) {
            gl.deleteBuffer(this.spriteBlendBuffer);
            this.spriteBlendBuffer = null;
        }
        this.spriteBlendShaderProgram?.free();
        this.spriteBlendShaderProgram = null;
        this.spriteBlendBatchData = null;

        // Clean up sprite manager
        this.spriteManager?.destroy();

        // Clean up building indicator renderer
        this.buildingIndicatorRenderer.destroy();

        EntityRenderer.log.debug('EntityRenderer resources cleaned up');
    }

    /**
     * Initialize the sprite shader program.
     */
    private initSpriteShader(gl: WebGL2RenderingContext): void {
        this.spriteShaderProgram = new ShaderProgram();
        this.spriteShaderProgram.init(gl);
        this.spriteShaderProgram.attachShaders(spriteVertCode, spriteFragCode);
        this.spriteShaderProgram.create();

        // Cache attribute locations for sprite shader
        this.aSpritePos = this.spriteShaderProgram.getAttribLocation('a_position');
        this.aSpriteTex = this.spriteShaderProgram.getAttribLocation('a_texcoord');
        this.aSpriteTint = this.spriteShaderProgram.getAttribLocation('a_tint');

        // Initialize blend shader for direction transitions
        this.initSpriteBlendShader(gl);
    }

    /**
     * Initialize the sprite blend shader for smooth direction transitions.
     */
    private initSpriteBlendShader(gl: WebGL2RenderingContext): void {
        this.spriteBlendShaderProgram = new ShaderProgram();
        this.spriteBlendShaderProgram.init(gl);
        this.spriteBlendShaderProgram.attachShaders(spriteBlendVertCode, spriteBlendFragCode);
        this.spriteBlendShaderProgram.create();

        // Cache attribute locations for blend shader
        this.aBlendPos = this.spriteBlendShaderProgram.getAttribLocation('a_position');
        this.aBlendTex1 = this.spriteBlendShaderProgram.getAttribLocation('a_texcoord1');
        this.aBlendTex2 = this.spriteBlendShaderProgram.getAttribLocation('a_texcoord2');
        this.aBlendFactor = this.spriteBlendShaderProgram.getAttribLocation('a_blend');
        this.aBlendTint = this.spriteBlendShaderProgram.getAttribLocation('a_tint');

        // Allocate blend batch buffer
        // 6 vertices per quad, 11 floats per vertex (pos:2 + uv1:2 + uv2:2 + blend:1 + tint:4)
        const FLOATS_PER_BLEND_ENTITY = 6 * 11;
        const MAX_BLEND_ENTITIES = 100; // Fewer needed since only transitioning units use this
        this.spriteBlendBatchData = new Float32Array(MAX_BLEND_ENTITIES * FLOATS_PER_BLEND_ENTITY);
        this.spriteBlendBuffer = gl.createBuffer();
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
        this.buildingIndicatorRenderer.player = this.buildingIndicatorsPlayer;
        this.buildingIndicatorRenderer.hasBuildings = this.buildingIndicatorsHasBuildings;
        this.buildingIndicatorRenderer.territory = this.territoryMap;
        this.buildingIndicatorRenderer.buildingType = this.previewBuildingType;

        // Build tile occupancy map including full building footprints
        // Reuse Map object to avoid per-frame allocation
        this.tileOccupancy.clear();
        for (const e of this.entities) {
            if (e.type === EntityType.Building) {
                // Add all tiles in building footprint
                const footprint = getBuildingFootprint(e.x, e.y, e.subType as BuildingType);
                for (const tile of footprint) {
                    this.tileOccupancy.set(`${tile.x},${tile.y}`, e.id);
                }
            } else {
                // Single tile for non-buildings
                this.tileOccupancy.set(`${e.x},${e.y}`, e.id);
            }
        }
        this.buildingIndicatorRenderer.tileOccupancy = this.tileOccupancy;

        // Draw the indicators
        this.buildingIndicatorRenderer.draw(gl, projection, viewPoint, this.territoryVersion);
    }

    public draw(gl: WebGL2RenderingContext, projection: Float32Array, viewPoint: IViewPoint): void {
        if (!this.dynamicBuffer) return;
        if (this.entities.length === 0 && !this.previewTile && !this.territoryMap && !this.buildingIndicatorsEnabled) return;

        // Enable blending for semi-transparent entities
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

        // Draw building placement indicators (behind everything)
        this.drawBuildingIndicators(gl, projection, viewPoint);

        // Use color shader for non-textured elements
        super.drawBase(gl, projection);

        // Bind the reusable buffer once
        gl.bindBuffer(gl.ARRAY_BUFFER, this.dynamicBuffer);
        gl.enableVertexAttribArray(this.aPosition);
        gl.vertexAttribPointer(this.aPosition, 2, gl.FLOAT, false, 0, 0);

        // Entity position set per-entity as constant attribute
        gl.disableVertexAttribArray(this.aEntityPos);

        // Color set per-entity as constant attribute
        gl.disableVertexAttribArray(this.aColor);

        // Draw territory borders (color shader)
        this.territoryBorderRenderer.draw(
            gl, viewPoint, this.territoryMap, this.territoryVersion,
            this.aEntityPos, this.aColor
        );

        // Draw path indicators for selected unit (color shader)
        this.drawSelectedUnitPath(gl, viewPoint);

        // Sort entities by depth for correct painter's algorithm rendering
        this.sortEntitiesByDepth(viewPoint);

        // Draw entities (textured or color fallback)
        if (this.spriteManager?.hasSprites && this.spriteShaderProgram) {
            this.drawTexturedEntities(gl, projection, viewPoint);
            this.drawColorEntities(gl, projection, viewPoint, true); // Only units without sprites
        } else {
            this.drawColorEntities(gl, projection, viewPoint, false); // All entities
        }

        // Draw selection frames (color shader) - must be after entities
        this.drawSelectionFrames(gl, viewPoint);

        // Draw placement preview
        this.drawPlacementPreview(gl, projection, viewPoint);

        gl.disable(gl.BLEND);
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
            const animatedEntry = this.spriteManager.getAnimatedBuilding(buildingType);
            sprite = (animatedEntry && entity.animationState)
                ? getAnimatedSprite(entity.animationState, animatedEntry.animationData, animatedEntry.staticSprite)
                : this.spriteManager.getBuilding(buildingType);
        }

        return { sprite, progress: visualState.verticalProgress };
    }

    /** Get sprite entry for a map object entity */
    private getMapObjectSprite(entity: Entity): SpriteEntry | null {
        if (!this.spriteManager) return null;

        const mapObjectType = entity.subType as MapObjectType;
        const animatedEntry = this.spriteManager.getAnimatedMapObject(mapObjectType);

        if (animatedEntry && entity.animationState) {
            return getAnimatedSprite(entity.animationState, animatedEntry.animationData, animatedEntry.staticSprite);
        }
        return this.spriteManager.getMapObject(mapObjectType);
    }

    /** Get sprite entry for a unit entity (returns null if transitioning) */
    private getUnitSprite(entity: Entity): SpriteEntry | null | 'transitioning' {
        if (!this.spriteManager) return null;

        const animState = entity.animationState;
        if (animState?.directionTransitionProgress !== undefined && animState.previousDirection !== undefined) {
            return 'transitioning';
        }

        const direction = animState?.direction ?? 0;
        return this.spriteManager.getUnit(entity.subType as UnitType, direction);
    }

    /**
     * Result of resolving an entity's sprite for rendering.
     */
    private resolveEntitySprite(entity: Entity): {
        skip: boolean;
        transitioning: boolean;
        sprite: SpriteEntry | null;
        progress: number;
    } {
        if (entity.type === EntityType.Building) {
            const result = this.getBuildingSprite(entity);
            return {
                skip: result.progress <= 0,
                transitioning: false,
                sprite: result.sprite,
                progress: result.progress
            };
        }
        if (entity.type === EntityType.MapObject) {
            return {
                skip: false,
                transitioning: false,
                sprite: this.getMapObjectSprite(entity),
                progress: 1
            };
        }
        if (entity.type === EntityType.StackedResource) {
            return {
                skip: false,
                transitioning: false,
                sprite: this.spriteManager?.getResource(entity.subType as EMaterialType) ?? null,
                progress: 1
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

    /** Render construction background sprite during CompletedRising phase */
    private renderConstructionBackground(
        gl: WebGL2RenderingContext,
        sp: ShaderProgram,
        entity: Entity,
        viewPoint: IViewPoint,
        batchOffset: number
    ): number {
        if (!this.spriteManager || !this.spriteBatchData) return batchOffset;

        const buildingState = this.buildingStates.get(entity.id);
        const visualState = getBuildingVisualState(buildingState);

        if (visualState.phase !== BuildingConstructionPhase.CompletedRising) return batchOffset;

        const constructionSprite = this.spriteManager.getBuildingConstruction(entity.subType as BuildingType);
        if (!constructionSprite) return batchOffset;

        if (batchOffset + FLOATS_PER_ENTITY > this.spriteBatchData.length) {
            this.flushSpriteBatch(gl, sp, batchOffset);
            batchOffset = 0;
        }

        const worldPos = TilePicker.tileToWorld(
            entity.x, entity.y, this.groundHeight, this.mapSize, viewPoint.x, viewPoint.y
        );
        return this.fillSpriteQuad(batchOffset, worldPos.worldX, worldPos.worldY, constructionSprite, 1, 1, 1, 1);
    }

    /**
     * Draw entities using the sprite shader and atlas texture (batched).
     */
    private drawTexturedEntities(
        gl: WebGL2RenderingContext,
        projection: Float32Array,
        viewPoint: IViewPoint
    ): void {
        if (!this.spriteShaderProgram || !this.spriteManager?.hasSprites ||
            !this.spriteBuffer || !this.spriteBatchData) {
            return;
        }

        const sp = this.spriteShaderProgram;
        sp.use();
        sp.setMatrix('projection', projection);
        sp.bindTexture('u_spriteAtlas', TEXTURE_UNIT_SPRITE_ATLAS);

        let batchOffset = 0;
        this.transitioningUnits.length = 0;

        for (const entity of this.sortedEntities) {
            // Handle building construction background before sprite resolution
            if (entity.type === EntityType.Building) {
                batchOffset = this.renderConstructionBackground(gl, sp, entity, viewPoint, batchOffset);
            }

            const resolved = this.resolveEntitySprite(entity);
            if (resolved.skip) continue;
            if (resolved.transitioning) { this.transitioningUnits.push(entity); continue }
            if (!resolved.sprite) continue;

            if (batchOffset + FLOATS_PER_ENTITY > this.spriteBatchData.length) {
                this.flushSpriteBatch(gl, sp, batchOffset);
                batchOffset = 0;
            }

            const worldPos = entity.type === EntityType.Unit
                ? this.getInterpolatedWorldPos(entity, viewPoint)
                : TilePicker.tileToWorld(entity.x, entity.y, this.groundHeight, this.mapSize, viewPoint.x, viewPoint.y);

            batchOffset = resolved.progress < 1.0
                ? this.fillSpriteQuadPartial(batchOffset, worldPos.worldX, worldPos.worldY, resolved.sprite, 1, 1, 1, 1, resolved.progress)
                : this.fillSpriteQuad(batchOffset, worldPos.worldX, worldPos.worldY, resolved.sprite, 1, 1, 1, 1);
        }

        if (batchOffset > 0) this.flushSpriteBatch(gl, sp, batchOffset);
        if (this.transitioningUnits.length > 0) this.drawTransitioningUnits(gl, projection, viewPoint, this.transitioningUnits);
    }

    /**
     * Draw units that are transitioning between directions using the blend shader.
     */
    private drawTransitioningUnits(
        gl: WebGL2RenderingContext,
        projection: Float32Array,
        viewPoint: IViewPoint,
        units: Entity[]
    ): void {
        if (!this.spriteBlendShaderProgram || !this.spriteBlendBuffer ||
            !this.spriteBlendBatchData || !this.spriteManager) {
            return;
        }

        const sp = this.spriteBlendShaderProgram;
        sp.use();
        sp.setMatrix('projection', projection);
        sp.bindTexture('u_spriteAtlas', TEXTURE_UNIT_SPRITE_ATLAS);

        let batchOffset = 0;
        const FLOATS_PER_BLEND_VERTEX = 11; // pos:2 + uv1:2 + uv2:2 + blend:1 + tint:4
        const FLOATS_PER_BLEND_ENTITY = 6 * FLOATS_PER_BLEND_VERTEX;

        for (const entity of units) {
            const animState = entity.animationState!;
            const oldDir = animState.previousDirection!;
            const newDir = animState.direction;
            const blendFactor = animState.directionTransitionProgress!;

            const oldSprite = this.spriteManager.getUnit(entity.subType as UnitType, oldDir);
            const newSprite = this.spriteManager.getUnit(entity.subType as UnitType, newDir);

            if (!oldSprite || !newSprite) continue;

            const worldPos = this.getInterpolatedWorldPos(entity, viewPoint);

            // Check batch capacity
            if (batchOffset + FLOATS_PER_BLEND_ENTITY > this.spriteBlendBatchData.length) {
                this.flushBlendBatch(gl, batchOffset);
                batchOffset = 0;
            }

            batchOffset = this.fillBlendSpriteQuad(
                batchOffset,
                worldPos.worldX,
                worldPos.worldY,
                oldSprite,
                newSprite,
                blendFactor,
                1.0, 1.0, 1.0, 1.0
            );
        }

        // Flush remaining blend sprites
        if (batchOffset > 0) {
            this.flushBlendBatch(gl, batchOffset);
        }
    }

    /**
     * Fill blend sprite quad vertices into the batch buffer.
     */
    private fillBlendSpriteQuad(
        offset: number,
        worldX: number,
        worldY: number,
        oldSprite: SpriteEntry,
        newSprite: SpriteEntry,
        blendFactor: number,
        tintR: number,
        tintG: number,
        tintB: number,
        tintA: number
    ): number {
        if (!this.spriteBlendBatchData) return offset;

        const data = this.spriteBlendBatchData;

        // Use the old sprite's dimensions (they should be similar)
        const { atlasRegion: region1, offsetX, offsetY, widthWorld, heightWorld } = oldSprite;
        const { atlasRegion: region2 } = newSprite;

        const x0 = worldX + offsetX;
        const y0 = worldY + offsetY;
        const x1 = x0 + widthWorld;
        const y1 = y0 + heightWorld;

        // UV coordinates for both sprites
        const { u0: u0_1, v0: v0_1, u1: u1_1, v1: v1_1 } = region1;
        const { u0: u0_2, v0: v0_2, u1: u1_2, v1: v1_2 } = region2;

        // 6 vertices for 2 triangles (CCW winding)
        // Each vertex: pos(2) + uv1(2) + uv2(2) + blend(1) + tint(4) = 11 floats

        // Vertex 0: top-left
        data[offset++] = x0; data[offset++] = y1;
        data[offset++] = u0_1; data[offset++] = v1_1;
        data[offset++] = u0_2; data[offset++] = v1_2;
        data[offset++] = blendFactor;
        data[offset++] = tintR; data[offset++] = tintG; data[offset++] = tintB; data[offset++] = tintA;

        // Vertex 1: bottom-left
        data[offset++] = x0; data[offset++] = y0;
        data[offset++] = u0_1; data[offset++] = v0_1;
        data[offset++] = u0_2; data[offset++] = v0_2;
        data[offset++] = blendFactor;
        data[offset++] = tintR; data[offset++] = tintG; data[offset++] = tintB; data[offset++] = tintA;

        // Vertex 2: bottom-right
        data[offset++] = x1; data[offset++] = y0;
        data[offset++] = u1_1; data[offset++] = v0_1;
        data[offset++] = u1_2; data[offset++] = v0_2;
        data[offset++] = blendFactor;
        data[offset++] = tintR; data[offset++] = tintG; data[offset++] = tintB; data[offset++] = tintA;

        // Vertex 3: top-left (again)
        data[offset++] = x0; data[offset++] = y1;
        data[offset++] = u0_1; data[offset++] = v1_1;
        data[offset++] = u0_2; data[offset++] = v1_2;
        data[offset++] = blendFactor;
        data[offset++] = tintR; data[offset++] = tintG; data[offset++] = tintB; data[offset++] = tintA;

        // Vertex 4: bottom-right (again)
        data[offset++] = x1; data[offset++] = y0;
        data[offset++] = u1_1; data[offset++] = v0_1;
        data[offset++] = u1_2; data[offset++] = v0_2;
        data[offset++] = blendFactor;
        data[offset++] = tintR; data[offset++] = tintG; data[offset++] = tintB; data[offset++] = tintA;

        // Vertex 5: top-right
        data[offset++] = x1; data[offset++] = y1;
        data[offset++] = u1_1; data[offset++] = v1_1;
        data[offset++] = u1_2; data[offset++] = v1_2;
        data[offset++] = blendFactor;
        data[offset++] = tintR; data[offset++] = tintG; data[offset++] = tintB; data[offset++] = tintA;

        return offset;
    }

    /**
     * Flush the blend sprite batch buffer to GPU and draw.
     */
    private flushBlendBatch(gl: WebGL2RenderingContext, floatCount: number): void {
        if (!this.spriteBlendBuffer || !this.spriteBlendBatchData || floatCount === 0) return;

        gl.bindBuffer(gl.ARRAY_BUFFER, this.spriteBlendBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, this.spriteBlendBatchData.subarray(0, floatCount), gl.DYNAMIC_DRAW);

        // Stride: 11 floats * 4 bytes = 44 bytes
        // Layout: pos(2) + uv1(2) + uv2(2) + blend(1) + tint(4)
        const stride = 11 * 4;

        gl.enableVertexAttribArray(this.aBlendPos);
        gl.vertexAttribPointer(this.aBlendPos, 2, gl.FLOAT, false, stride, 0);

        gl.enableVertexAttribArray(this.aBlendTex1);
        gl.vertexAttribPointer(this.aBlendTex1, 2, gl.FLOAT, false, stride, 8);

        gl.enableVertexAttribArray(this.aBlendTex2);
        gl.vertexAttribPointer(this.aBlendTex2, 2, gl.FLOAT, false, stride, 16);

        gl.enableVertexAttribArray(this.aBlendFactor);
        gl.vertexAttribPointer(this.aBlendFactor, 1, gl.FLOAT, false, stride, 24);

        gl.enableVertexAttribArray(this.aBlendTint);
        gl.vertexAttribPointer(this.aBlendTint, 4, gl.FLOAT, false, stride, 28);

        const vertexCount = floatCount / 11;
        gl.drawArrays(gl.TRIANGLES, 0, vertexCount);
    }

    /**
     * Flush the sprite batch buffer to GPU and draw.
     */
    private flushSpriteBatch(
        gl: WebGL2RenderingContext,
        _sp: ShaderProgram,
        floatCount: number
    ): void {
        if (!this.spriteBuffer || !this.spriteBatchData || floatCount === 0) return;

        gl.bindBuffer(gl.ARRAY_BUFFER, this.spriteBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, this.spriteBatchData.subarray(0, floatCount), gl.DYNAMIC_DRAW);

        const stride = 8 * 4; // 8 floats * 4 bytes

        gl.enableVertexAttribArray(this.aSpritePos);
        gl.vertexAttribPointer(this.aSpritePos, 2, gl.FLOAT, false, stride, 0);

        gl.enableVertexAttribArray(this.aSpriteTex);
        gl.vertexAttribPointer(this.aSpriteTex, 2, gl.FLOAT, false, stride, 8);

        gl.enableVertexAttribArray(this.aSpriteTint);
        gl.vertexAttribPointer(this.aSpriteTint, 4, gl.FLOAT, false, stride, 16);

        const vertexCount = floatCount / 8;
        gl.drawArrays(gl.TRIANGLES, 0, vertexCount);
    }

    /**
     * Fill sprite quad vertices into the batch buffer.
     */
    private fillSpriteQuad(
        offset: number,
        worldX: number,
        worldY: number,
        entry: SpriteEntry,
        tintR: number,
        tintG: number,
        tintB: number,
        tintA: number
    ): number {
        if (!this.spriteBatchData) return offset;

        const data = this.spriteBatchData;
        const { atlasRegion: region, offsetX, offsetY, widthWorld, heightWorld } = entry;

        const x0 = worldX + offsetX;
        const y0 = worldY + offsetY;
        const x1 = x0 + widthWorld;
        const y1 = y0 + heightWorld;

        const { u0, v0, u1, v1 } = region;

        // 6 vertices for 2 triangles (CCW winding)
        // Note: V coordinates flipped (v1 at top, v0 at bottom) to correct texture orientation
        // Vertex 0: top-left
        data[offset++] = x0; data[offset++] = y1;
        data[offset++] = u0; data[offset++] = v1;
        data[offset++] = tintR; data[offset++] = tintG; data[offset++] = tintB; data[offset++] = tintA;

        // Vertex 1: bottom-left
        data[offset++] = x0; data[offset++] = y0;
        data[offset++] = u0; data[offset++] = v0;
        data[offset++] = tintR; data[offset++] = tintG; data[offset++] = tintB; data[offset++] = tintA;

        // Vertex 2: bottom-right
        data[offset++] = x1; data[offset++] = y0;
        data[offset++] = u1; data[offset++] = v0;
        data[offset++] = tintR; data[offset++] = tintG; data[offset++] = tintB; data[offset++] = tintA;

        // Vertex 3: top-left (again)
        data[offset++] = x0; data[offset++] = y1;
        data[offset++] = u0; data[offset++] = v1;
        data[offset++] = tintR; data[offset++] = tintG; data[offset++] = tintB; data[offset++] = tintA;

        // Vertex 4: bottom-right (again)
        data[offset++] = x1; data[offset++] = y0;
        data[offset++] = u1; data[offset++] = v0;
        data[offset++] = tintR; data[offset++] = tintG; data[offset++] = tintB; data[offset++] = tintA;

        // Vertex 5: top-right
        data[offset++] = x1; data[offset++] = y1;
        data[offset++] = u1; data[offset++] = v1;
        data[offset++] = tintR; data[offset++] = tintG; data[offset++] = tintB; data[offset++] = tintA;

        return offset;
    }

    /**
     * Fill sprite quad vertices with partial vertical visibility (for "rising from ground" effect).
     * Shows the bottom portion of the sprite, growing upward as verticalProgress increases.
     *
     * Coordinate system: smaller worldY = higher on screen (roof), larger worldY = lower (ground).
     * The base of the sprite (y1 = y0 + heightWorld) stays fixed at ground level.
     * The visible top edge moves from y1 toward y0 as the building rises.
     */
    private fillSpriteQuadPartial(
        offset: number,
        worldX: number,
        worldY: number,
        entry: SpriteEntry,
        tintR: number,
        tintG: number,
        tintB: number,
        tintA: number,
        verticalProgress: number
    ): number {
        if (!this.spriteBatchData) return offset;

        const data = this.spriteBatchData;
        const { atlasRegion: region, offsetX, offsetY, widthWorld, heightWorld } = entry;

        const visibleHeight = heightWorld * verticalProgress;

        const x0 = worldX + offsetX;
        const x1 = x0 + widthWorld;

        // y1 is the base (ground level, larger worldY = lower on screen) — stays fixed
        const y1 = worldY + offsetY + heightWorld;
        // Visible top edge rises from y1 (nothing) toward y0 (full building)
        const visibleY0 = y1 - visibleHeight;

        // UV: v1 corresponds to the base (y1), v0 to the roof (y0).
        // Show the bottom portion of the texture, expanding upward.
        const { u0, v0, u1, v1 } = region;
        const visibleV0 = v1 - (v1 - v0) * verticalProgress;

        // 6 vertices for 2 triangles — same winding as fillSpriteQuad
        // but with y0/v0 replaced by visibleY0/visibleV0

        // Vertex 0: base-left (ground level)
        data[offset++] = x0; data[offset++] = y1;
        data[offset++] = u0; data[offset++] = v1;
        data[offset++] = tintR; data[offset++] = tintG; data[offset++] = tintB; data[offset++] = tintA;

        // Vertex 1: visible-top-left (rises upward)
        data[offset++] = x0; data[offset++] = visibleY0;
        data[offset++] = u0; data[offset++] = visibleV0;
        data[offset++] = tintR; data[offset++] = tintG; data[offset++] = tintB; data[offset++] = tintA;

        // Vertex 2: visible-top-right (rises upward)
        data[offset++] = x1; data[offset++] = visibleY0;
        data[offset++] = u1; data[offset++] = visibleV0;
        data[offset++] = tintR; data[offset++] = tintG; data[offset++] = tintB; data[offset++] = tintA;

        // Vertex 3: base-left (again)
        data[offset++] = x0; data[offset++] = y1;
        data[offset++] = u0; data[offset++] = v1;
        data[offset++] = tintR; data[offset++] = tintG; data[offset++] = tintB; data[offset++] = tintA;

        // Vertex 4: visible-top-right (again)
        data[offset++] = x1; data[offset++] = visibleY0;
        data[offset++] = u1; data[offset++] = visibleV0;
        data[offset++] = tintR; data[offset++] = tintG; data[offset++] = tintB; data[offset++] = tintA;

        // Vertex 5: base-right (ground level)
        data[offset++] = x1; data[offset++] = y1;
        data[offset++] = u1; data[offset++] = v1;
        data[offset++] = tintR; data[offset++] = tintG; data[offset++] = tintB; data[offset++] = tintA;

        return offset;
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
            // Handle map objects specially - draw dot fallback if no sprite
            if (entity.type === EntityType.MapObject) {
                if (!texturedBuildingsHandled || !this.hasTexturedSprite(entity)) {
                    this.drawMapObjectDot(gl, entity, viewPoint);
                }
                continue;
            }

            // Skip entities handled by sprite renderer
            if (texturedBuildingsHandled && this.hasTexturedSprite(entity)) continue;

            const isSelected = this.selectedEntityIds.has(entity.id);
            const playerColor = PLAYER_COLORS[entity.player % PLAYER_COLORS.length];
            const color = isSelected ? SELECTED_COLOR : playerColor;
            const scale = this.getEntityScale(entity.type);

            const worldPos = entity.type === EntityType.Unit
                ? this.getInterpolatedWorldPos(entity, viewPoint)
                : TilePicker.tileToWorld(entity.x, entity.y, this.groundHeight, this.mapSize, viewPoint.x, viewPoint.y);

            gl.vertexAttrib2f(this.aEntityPos, worldPos.worldX, worldPos.worldY);
            this.fillQuadVertices(0, 0, scale);
            gl.bufferData(gl.ARRAY_BUFFER, this.vertexData, gl.DYNAMIC_DRAW);
            gl.vertexAttrib4f(this.aColor, color[0], color[1], color[2], color[3]);
            gl.drawArrays(gl.TRIANGLES, 0, 6);
        }
    }

    /**
     * Draw selection frames (rectangular borders) around selected entities.
     * Each frame consists of 4 border quads forming a rectangle outline,
     * plus 4 corner accent pieces for visual clarity.
     */
    private drawSelectionFrames(gl: WebGL2RenderingContext, viewPoint: IViewPoint): void {
        gl.bindBuffer(gl.ARRAY_BUFFER, this.dynamicBuffer!);

        // Use depth-sorted entities for consistent ordering
        for (const entity of this.sortedEntities) {
            if (!this.selectedEntityIds.has(entity.id)) continue;

            let scale = UNIT_SCALE;
            if (entity.type === EntityType.Building) {
                scale = BUILDING_SCALE;
            } else if (entity.type === EntityType.StackedResource) {
                scale = RESOURCE_SCALE;
            }

            let worldPos: { worldX: number; worldY: number };
            if (entity.type === EntityType.Unit) {
                worldPos = this.getInterpolatedWorldPos(entity, viewPoint);
            } else {
                worldPos = TilePicker.tileToWorld(
                    entity.x, entity.y,
                    this.groundHeight, this.mapSize,
                    viewPoint.x, viewPoint.y
                );
            }

            gl.vertexAttrib2f(this.aEntityPos, worldPos.worldX, worldPos.worldY);

            const halfSize = scale * FRAME_PADDING * 0.5;
            const t = FRAME_THICKNESS;

            // Draw 4 border sides as thin quads
            // Top edge
            this.fillRectVertices(-halfSize, halfSize - t, halfSize, halfSize);
            gl.bufferData(gl.ARRAY_BUFFER, this.vertexData, gl.DYNAMIC_DRAW);
            gl.vertexAttrib4f(this.aColor, FRAME_COLOR[0], FRAME_COLOR[1], FRAME_COLOR[2], FRAME_COLOR[3]);
            gl.drawArrays(gl.TRIANGLES, 0, 6);

            // Bottom edge
            this.fillRectVertices(-halfSize, -halfSize, halfSize, -halfSize + t);
            gl.bufferData(gl.ARRAY_BUFFER, this.vertexData, gl.DYNAMIC_DRAW);
            gl.drawArrays(gl.TRIANGLES, 0, 6);

            // Left edge
            this.fillRectVertices(-halfSize, -halfSize, -halfSize + t, halfSize);
            gl.bufferData(gl.ARRAY_BUFFER, this.vertexData, gl.DYNAMIC_DRAW);
            gl.drawArrays(gl.TRIANGLES, 0, 6);

            // Right edge
            this.fillRectVertices(halfSize - t, -halfSize, halfSize, halfSize);
            gl.bufferData(gl.ARRAY_BUFFER, this.vertexData, gl.DYNAMIC_DRAW);
            gl.drawArrays(gl.TRIANGLES, 0, 6);

            // Draw corner accents (brighter, slightly thicker)
            const cornerLen = halfSize * FRAME_CORNER_LENGTH;
            const ct = t * 1.8; // Corner thickness
            gl.vertexAttrib4f(this.aColor, FRAME_CORNER_COLOR[0], FRAME_CORNER_COLOR[1], FRAME_CORNER_COLOR[2], FRAME_CORNER_COLOR[3]);

            // Top-left corner (horizontal + vertical)
            this.fillRectVertices(-halfSize, halfSize - ct, -halfSize + cornerLen, halfSize);
            gl.bufferData(gl.ARRAY_BUFFER, this.vertexData, gl.DYNAMIC_DRAW);
            gl.drawArrays(gl.TRIANGLES, 0, 6);
            this.fillRectVertices(-halfSize, halfSize - cornerLen, -halfSize + ct, halfSize);
            gl.bufferData(gl.ARRAY_BUFFER, this.vertexData, gl.DYNAMIC_DRAW);
            gl.drawArrays(gl.TRIANGLES, 0, 6);

            // Top-right corner
            this.fillRectVertices(halfSize - cornerLen, halfSize - ct, halfSize, halfSize);
            gl.bufferData(gl.ARRAY_BUFFER, this.vertexData, gl.DYNAMIC_DRAW);
            gl.drawArrays(gl.TRIANGLES, 0, 6);
            this.fillRectVertices(halfSize - ct, halfSize - cornerLen, halfSize, halfSize);
            gl.bufferData(gl.ARRAY_BUFFER, this.vertexData, gl.DYNAMIC_DRAW);
            gl.drawArrays(gl.TRIANGLES, 0, 6);

            // Bottom-left corner
            this.fillRectVertices(-halfSize, -halfSize, -halfSize + cornerLen, -halfSize + ct);
            gl.bufferData(gl.ARRAY_BUFFER, this.vertexData, gl.DYNAMIC_DRAW);
            gl.drawArrays(gl.TRIANGLES, 0, 6);
            this.fillRectVertices(-halfSize, -halfSize, -halfSize + ct, -halfSize + cornerLen);
            gl.bufferData(gl.ARRAY_BUFFER, this.vertexData, gl.DYNAMIC_DRAW);
            gl.drawArrays(gl.TRIANGLES, 0, 6);

            // Bottom-right corner
            this.fillRectVertices(halfSize - cornerLen, -halfSize, halfSize, -halfSize + ct);
            gl.bufferData(gl.ARRAY_BUFFER, this.vertexData, gl.DYNAMIC_DRAW);
            gl.drawArrays(gl.TRIANGLES, 0, 6);
            this.fillRectVertices(halfSize - ct, -halfSize, halfSize, -halfSize + cornerLen);
            gl.bufferData(gl.ARRAY_BUFFER, this.vertexData, gl.DYNAMIC_DRAW);
            gl.drawArrays(gl.TRIANGLES, 0, 6);
        }
    }

    /**
     * Fill vertex data for an axis-aligned rectangle.
     * Used for selection frame border segments.
     */
    private fillRectVertices(x0: number, y0: number, x1: number, y1: number): void {
        const verts = this.vertexData;
        // Triangle 1: top-left, bottom-left, bottom-right
        verts[0] = x0; verts[1] = y1;
        verts[2] = x0; verts[3] = y0;
        verts[4] = x1; verts[5] = y0;
        // Triangle 2: top-left, bottom-right, top-right
        verts[6] = x0; verts[7] = y1;
        verts[8] = x1; verts[9] = y0;
        verts[10] = x1; verts[11] = y1;
    }

    /** Get the interpolated world position for a unit */
    private getInterpolatedWorldPos(entity: Entity, viewPoint: IViewPoint): { worldX: number; worldY: number } {
        const unitState = this.unitStates.get(entity.id);

        // Check if unit is stationary: no unit state, or prev == curr position
        // Use prev != curr to determine if interpolation is needed, not path state
        // This ensures smooth movement even when path completes mid-transition
        const isStationary = !unitState ||
            (unitState.prevX === entity.x && unitState.prevY === entity.y);

        if (isStationary) {
            return TilePicker.tileToWorld(
                entity.x, entity.y,
                this.groundHeight, this.mapSize,
                viewPoint.x, viewPoint.y
            );
        }

        const prevPos = TilePicker.tileToWorld(
            unitState.prevX, unitState.prevY,
            this.groundHeight, this.mapSize,
            viewPoint.x, viewPoint.y
        );
        const currPos = TilePicker.tileToWorld(
            entity.x, entity.y,
            this.groundHeight, this.mapSize,
            viewPoint.x, viewPoint.y
        );

        // Use moveProgress directly for interpolation (0 to 1)
        // This gives smooth, predictable movement at tick rate (30 Hz)
        // Clamp to ensure valid range even during edge cases
        const t = Math.max(0, Math.min(unitState.moveProgress, 1));
        return {
            worldX: prevPos.worldX + (currPos.worldX - prevPos.worldX) * t,
            worldY: prevPos.worldY + (currPos.worldY - prevPos.worldY) * t
        };
    }

    /**
     * Compute the depth key for an entity for painter's algorithm sorting.
     * Larger depth = drawn later = appears in front.
     * The depth point is adjusted based on entity type and sprite dimensions.
     */
    private computeDepthKey(entity: Entity, worldY: number, spriteEntry: SpriteEntry | null): number {
        // Base depth is the world Y coordinate (larger = lower on screen = in front)
        let depth = worldY;

        // Adjust depth based on sprite dimensions and entity-specific depth factor
        if (spriteEntry) {
            const { offsetY, heightWorld } = spriteEntry;
            let depthFactor: number;

            switch (entity.type) {
            case EntityType.Building:
                depthFactor = DEPTH_FACTOR_BUILDING;
                break;
            case EntityType.MapObject:
                depthFactor = DEPTH_FACTOR_MAP_OBJECT;
                break;
            case EntityType.Unit:
                depthFactor = DEPTH_FACTOR_UNIT;
                break;
            case EntityType.StackedResource:
                depthFactor = DEPTH_FACTOR_RESOURCE;
                break;
            default:
                depthFactor = 1.0;
            }

            // Depth point = base position + offset to the depth line within sprite
            // offsetY is typically negative (sprite extends upward from anchor)
            // heightWorld is the full sprite height
            // depthFactor=0 means top of sprite, depthFactor=1 means bottom
            depth = worldY + offsetY + heightWorld * depthFactor;
        }

        return depth;
    }

    /**
     * Sort entities by depth for correct painter's algorithm rendering.
     * Populates sortedEntities array with visible entities sorted back-to-front.
     */
    private sortEntitiesByDepth(viewPoint: IViewPoint): void {
        // Clear and populate sortedEntities with visible entities
        this.sortedEntities.length = 0;
        this.depthKeys.length = 0;

        for (const entity of this.entities) {
            if (!this.isEntityVisible(entity)) continue;

            // Get world position
            let worldPos: { worldX: number; worldY: number };
            if (entity.type === EntityType.Unit) {
                worldPos = this.getInterpolatedWorldPos(entity, viewPoint);
            } else {
                worldPos = TilePicker.tileToWorld(
                    entity.x, entity.y,
                    this.groundHeight, this.mapSize,
                    viewPoint.x, viewPoint.y
                );
            }

            // Get sprite for depth calculation (if available)
            let spriteEntry: SpriteEntry | null = null;
            if (this.spriteManager) {
                switch (entity.type) {
                case EntityType.Building:
                    spriteEntry = this.spriteManager.getBuilding(entity.subType as BuildingType);
                    break;
                case EntityType.MapObject:
                    spriteEntry = this.spriteManager.getMapObject(entity.subType as MapObjectType);
                    break;
                case EntityType.Unit:
                    spriteEntry = this.spriteManager.getUnit(entity.subType as UnitType);
                    break;
                case EntityType.StackedResource:
                    spriteEntry = this.spriteManager.getResource(entity.subType as EMaterialType);
                    break;
                }
            }

            const depthKey = this.computeDepthKey(entity, worldPos.worldY, spriteEntry);
            this.sortedEntities.push(entity);
            this.depthKeys.push(depthKey);
        }

        // Sort by depth key (smaller = behind = drawn first)
        // Reuse index array to avoid per-frame allocations
        const count = this.sortedEntities.length;

        // Resize reusable arrays if needed (grows but never shrinks)
        if (this.sortIndices.length < count) {
            this.sortIndices.length = count;
            this.sortTempEntities.length = count;
        }

        // Populate indices
        for (let i = 0; i < count; i++) {
            this.sortIndices[i] = i;
        }

        // Sort indices by depth key
        const depthKeys = this.depthKeys;
        this.sortIndices.length = count; // Truncate to actual count for sort
        this.sortIndices.sort((a, b) => depthKeys[a] - depthKeys[b]);

        // Reorder entities using temp array (avoids allocating new array)
        for (let i = 0; i < count; i++) {
            this.sortTempEntities[i] = this.sortedEntities[this.sortIndices[i]];
        }
        for (let i = 0; i < count; i++) {
            this.sortedEntities[i] = this.sortTempEntities[i];
        }
    }

    /** Draw dots along the remaining path of all selected units */
    private drawSelectedUnitPath(gl: WebGL2RenderingContext, viewPoint: IViewPoint): void {
        if (this.selectedEntityIds.size === 0) return;

        gl.vertexAttrib4f(this.aColor, PATH_COLOR[0], PATH_COLOR[1], PATH_COLOR[2], PATH_COLOR[3]);

        for (const entityId of this.selectedEntityIds) {
            const unitState = this.unitStates.get(entityId);
            if (!unitState || unitState.pathIndex >= unitState.path.length) continue;

            const maxDots = Math.min(unitState.path.length, unitState.pathIndex + MAX_PATH_DOTS);
            for (let i = unitState.pathIndex; i < maxDots; i++) {
                const wp = unitState.path[i];
                const worldPos = TilePicker.tileToWorld(
                    wp.x, wp.y,
                    this.groundHeight, this.mapSize,
                    viewPoint.x, viewPoint.y
                );

                gl.vertexAttrib2f(this.aEntityPos, worldPos.worldX, worldPos.worldY);
                this.fillQuadVertices(0, 0, PATH_DOT_SCALE);
                gl.bufferData(gl.ARRAY_BUFFER, this.vertexData, gl.DYNAMIC_DRAW);
                gl.drawArrays(gl.TRIANGLES, 0, 6);
            }
        }
    }

    /** Draw a ghost building at the preview tile when in placement mode */
    private drawPlacementPreview(
        gl: WebGL2RenderingContext,
        projection: Float32Array,
        viewPoint: IViewPoint
    ): void {
        if (!this.previewTile) return;

        // Get world position of the anchor tile (where the building will be placed)
        const worldPos = TilePicker.tileToWorld(
            this.previewTile.x, this.previewTile.y,
            this.groundHeight, this.mapSize,
            viewPoint.x, viewPoint.y
        );

        // Try to use sprite preview if available
        const sp = this.spriteShaderProgram;
        if (this.previewBuildingType !== null && this.spriteManager?.hasSprites && sp) {
            const spriteEntry = this.spriteManager.getBuilding(this.previewBuildingType);
            if (spriteEntry) {
                const tint = this.previewValid ? TINT_PREVIEW_VALID : TINT_PREVIEW_INVALID;

                sp.use();
                sp.setMatrix('projection', projection);
                sp.bindTexture('u_spriteAtlas', TEXTURE_UNIT_SPRITE_ATLAS);

                // Draw sprite at anchor position with normal offset (matches placed buildings)
                const offset = this.fillSpriteQuad(
                    0,
                    worldPos.worldX,
                    worldPos.worldY,
                    spriteEntry,
                    tint[0], tint[1], tint[2], tint[3]
                );

                this.flushSpriteBatch(gl, sp, offset);
                return;
            }
        }

        // Fallback to color preview
        this.shaderProgram.use();
        gl.bindBuffer(gl.ARRAY_BUFFER, this.dynamicBuffer!);

        const color = this.previewValid ? PREVIEW_VALID_COLOR : PREVIEW_INVALID_COLOR;
        gl.vertexAttrib2f(this.aEntityPos, worldPos.worldX, worldPos.worldY);
        this.fillQuadVertices(0, 0, BUILDING_SCALE);
        gl.bufferData(gl.ARRAY_BUFFER, this.vertexData, gl.DYNAMIC_DRAW);
        gl.vertexAttrib4f(this.aColor, color[0], color[1], color[2], color[3]);
        gl.drawArrays(gl.TRIANGLES, 0, 6);
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

    /**
     * Draw a colored dot for a map object without sprite texture.
     */
    private drawMapObjectDot(
        gl: WebGL2RenderingContext,
        entity: Entity,
        viewPoint: IViewPoint
    ): void {
        const objectType = entity.subType as MapObjectType;
        const color = getMapObjectFallbackColor(objectType);
        const scale = getMapObjectDotScale(objectType);

        const worldPos = TilePicker.tileToWorld(
            entity.x, entity.y,
            this.groundHeight, this.mapSize,
            viewPoint.x, viewPoint.y
        );

        gl.vertexAttrib2f(this.aEntityPos, worldPos.worldX, worldPos.worldY);
        this.fillQuadVertices(0, 0, scale);
        gl.bufferData(gl.ARRAY_BUFFER, this.vertexData, gl.DYNAMIC_DRAW);
        gl.vertexAttrib4f(this.aColor, color[0], color[1], color[2], color[3]);
        gl.drawArrays(gl.TRIANGLES, 0, 6);
    }
}
