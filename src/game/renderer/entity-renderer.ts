import { IRenderer } from './i-renderer';
import { IViewPoint } from './i-view-point';
import { RendererBase } from './renderer-base';
import { ShaderProgram } from './shader-program';
import { Entity, EntityType, UnitState, BuildingState, TileCoord, BuildingType, getBuildingFootprint } from '../entity';
import { getBuildingVisualState } from '../systems/building-construction';
import { MapSize } from '@/utilities/map-size';
import { TilePicker } from '../input/tile-picker';
import { TerritoryMap } from '../systems/territory';
import { LogHandler } from '@/utilities/log-handler';
import { FileManager } from '@/utilities/file-manager';
import { SpriteEntry, Race } from './sprite-metadata';
import { MapObjectType } from '../entity';
import { TerritoryBorderRenderer } from './territory-border-renderer';
import { SpriteRenderManager } from './sprite-render-manager';
import { BuildingIndicatorRenderer } from './building-indicator-renderer';
import { getAnimatedSprite } from '../systems/animation';
import { BuildingConstructionPhase } from '../entity';

import vertCode from './shaders/entity-vert.glsl';
import fragCode from './shaders/entity-frag.glsl';
import spriteVertCode from './shaders/entity-sprite-vert.glsl';
import spriteFragCode from './shaders/entity-sprite-frag.glsl';

// Player colors (RGBA, 0-1 range)
const PLAYER_COLORS = [
    [0.2, 0.6, 1.0, 0.9], // Player 0: Blue
    [1.0, 0.3, 0.3, 0.9], // Player 1: Red
    [0.3, 1.0, 0.3, 0.9], // Player 2: Green
    [1.0, 1.0, 0.3, 0.9] // Player 3: Yellow
];

const SELECTED_COLOR = [1.0, 1.0, 1.0, 1.0]; // White highlight
const RING_COLOR = [1.0, 1.0, 0.0, 0.5]; // Yellow selection ring
const PATH_COLOR = [0.3, 1.0, 0.6, 0.4]; // Green path indicator
const PREVIEW_VALID_COLOR = [0.3, 1.0, 0.3, 0.5]; // Green ghost building
const PREVIEW_INVALID_COLOR = [1.0, 0.3, 0.3, 0.5]; // Red ghost building

// Sprite tint colors (multiplicative, so 1.0 = no change)
const SPRITE_TINT_SELECTED = [1.3, 1.3, 1.3, 1.0]; // Bright highlight
const SPRITE_TINT_PREVIEW_VALID = [0.5, 1.0, 0.5, 0.5]; // Green ghost
const SPRITE_TINT_PREVIEW_INVALID = [1.0, 0.5, 0.5, 0.5]; // Red ghost

// Player tint strength (0 = no tint, 1 = full player color)
const PLAYER_TINT_STRENGTH = 0.4;

// Texture unit assignments (landscape uses 0-2)
const TEXTURE_UNIT_SPRITE_ATLAS = 3;

// Maximum path dots to show per selected unit
const MAX_PATH_DOTS = 30;

const BASE_QUAD = new Float32Array([
    -0.5, -0.5, 0.5, -0.5,
    -0.5, 0.5, -0.5, 0.5,
    0.5, -0.5, 0.5, 0.5
]);

const BUILDING_SCALE = 0.5;
const UNIT_SCALE = 0.3;
const RING_SCALE_FACTOR = 1.4;
const PATH_DOT_SCALE = 0.12;

// Maximum entities for batch buffer allocation
const MAX_BATCH_ENTITIES = 500;
// 6 vertices per quad, 8 floats per vertex (posX, posY, texU, texV, r, g, b, a)
const FLOATS_PER_ENTITY = 6 * 8;

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
    public unitStates: Map<number, UnitState> = new Map();

    // Building states for construction animation
    public buildingStates: Map<number, BuildingState> = new Map();

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

    // Cached attribute/uniform locations for color shader
    private aPosition = -1;
    private aEntityPos = -1;
    private aColor = -1;

    // Cached attribute locations for sprite shader
    private aSpritePos = -1;
    private aSpriteTex = -1;
    private aSpriteTint = -1;

    // Reusable vertex buffer to avoid per-frame allocations
    private vertexData = new Float32Array(6 * 2);

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

        // Initialize sprite manager if available
        if (this.spriteManager) {
            const loaded = await this.spriteManager.init(gl);

            if (loaded) {
                // Initialize sprite shader
                this.initSpriteShader(gl);

                // Allocate batch buffer for sprite rendering
                this.spriteBatchData = new Float32Array(MAX_BATCH_ENTITIES * FLOATS_PER_ENTITY);
                this.spriteBuffer = gl.createBuffer();

                EntityRenderer.log.debug(
                    `Sprite rendering enabled: ${this.spriteManager.spriteRegistry?.getBuildingCount() ?? 0} building sprites loaded for ${Race[this.spriteManager.currentRace]}`
                );
            }
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
        const occupancy = new Map<string, number>();
        for (const e of this.entities) {
            if (e.type === EntityType.Building) {
                // Add all tiles in building footprint
                const footprint = getBuildingFootprint(e.x, e.y, e.subType as BuildingType);
                for (const tile of footprint) {
                    occupancy.set(`${tile.x},${tile.y}`, e.id);
                }
            } else {
                // Single tile for non-buildings
                occupancy.set(`${e.x},${e.y}`, e.id);
            }
        }
        this.buildingIndicatorRenderer.tileOccupancy = occupancy;

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

        // Draw entities (textured or color fallback)
        if (this.spriteManager?.hasSprites && this.spriteShaderProgram) {
            this.drawTexturedEntities(gl, projection, viewPoint);
            this.drawColorEntities(gl, projection, viewPoint, true); // Only units without sprites
        } else {
            this.drawColorEntities(gl, projection, viewPoint, false); // All entities
        }

        // Draw selection rings (color shader) - must be after entities
        this.drawSelectionRings(gl, viewPoint);

        // Draw placement preview
        this.drawPlacementPreview(gl, projection, viewPoint);

        gl.disable(gl.BLEND);
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

        for (const entity of this.entities) {
            let spriteEntry: SpriteEntry | null = null;
            let tint: number[];
            let verticalProgress = 1.0; // Full visibility by default

            if (entity.type === EntityType.Building) {
                const isSelected = this.selectedEntityIds.has(entity.id);
                const playerColor = PLAYER_COLORS[entity.player % PLAYER_COLORS.length];
                tint = this.computePlayerTint(playerColor, isSelected);

                // Get building construction state
                const buildingState = this.buildingStates.get(entity.id);
                const visualState = getBuildingVisualState(buildingState);

                // Choose sprite based on construction state
                if (visualState.useConstructionSprite) {
                    spriteEntry = this.spriteManager.getBuildingConstruction(entity.subType as BuildingType);
                    // Fall back to completed sprite if no construction sprite
                    if (!spriteEntry) {
                        spriteEntry = this.spriteManager.getBuilding(entity.subType as BuildingType);
                    }
                } else {
                    // For completed buildings, check for animation
                    const buildingType = entity.subType as BuildingType;
                    const animatedEntry = this.spriteManager.getAnimatedBuilding(buildingType);

                    if (animatedEntry && entity.animationState) {
                        // Use animated sprite based on current frame
                        spriteEntry = getAnimatedSprite(
                            entity.animationState,
                            animatedEntry.animationData,
                            animatedEntry.staticSprite
                        );
                    } else {
                        // Use static sprite
                        spriteEntry = this.spriteManager.getBuilding(buildingType);
                    }
                }

                verticalProgress = visualState.verticalProgress;

                // Skip rendering if building is not visible yet (verticalProgress is 0)
                if (verticalProgress <= 0) {
                    continue;
                }
            } else if (entity.type === EntityType.MapObject) {
                const mapObjectType = entity.subType as MapObjectType;
                const animatedEntry = this.spriteManager.getAnimatedMapObject(mapObjectType);

                if (animatedEntry && entity.animationState) {
                    // Use animated sprite based on current frame
                    spriteEntry = getAnimatedSprite(
                        entity.animationState,
                        animatedEntry.animationData,
                        animatedEntry.staticSprite
                    );
                } else {
                    // Use static sprite
                    spriteEntry = this.spriteManager.getMapObject(mapObjectType);
                }

                const isSelected = this.selectedEntityIds.has(entity.id);
                tint = isSelected ? [1.3, 1.3, 1.3, 1.0] : [1.0, 1.0, 1.0, 1.0];
            } else {
                continue;
            }

            if (!spriteEntry) continue;

            // Check batch capacity BEFORE adding to avoid buffer overflow
            if (batchOffset + FLOATS_PER_ENTITY > this.spriteBatchData.length) {
                this.flushSpriteBatch(gl, sp, batchOffset);
                batchOffset = 0;
            }

            const worldPos = TilePicker.tileToWorld(
                entity.x, entity.y,
                this.groundHeight, this.mapSize,
                viewPoint.x, viewPoint.y
            );

            // Use partial sprite rendering for construction animation
            if (verticalProgress < 1.0) {
                batchOffset = this.fillSpriteQuadPartial(
                    batchOffset,
                    worldPos.worldX,
                    worldPos.worldY,
                    spriteEntry,
                    tint[0], tint[1], tint[2], tint[3],
                    verticalProgress
                );
            } else {
                batchOffset = this.fillSpriteQuad(
                    batchOffset,
                    worldPos.worldX,
                    worldPos.worldY,
                    spriteEntry,
                    tint[0], tint[1], tint[2], tint[3]
                );
            }
        }

        // Flush remaining sprites
        if (batchOffset > 0) {
            this.flushSpriteBatch(gl, sp, batchOffset);
        }
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
     * Fill sprite quad vertices with partial vertical visibility (for "rising from bottom" effect).
     * Only renders the bottom portion of the sprite based on verticalProgress (0.0 to 1.0).
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

        // Calculate visible portion of sprite
        // verticalProgress 0.0 = nothing visible, 1.0 = fully visible
        const visibleHeight = heightWorld * verticalProgress;

        // Position: start at the base (ground level) and only show the bottom portion
        const x0 = worldX + offsetX;
        const y0 = worldY + offsetY;  // Bottom of sprite (ground level)
        const x1 = x0 + widthWorld;
        const y1 = y0 + visibleHeight;  // Only show up to visible height

        // UV coordinates: show bottom portion of texture
        // v0 = bottom of texture, v1 = top of texture
        // We want to show from v0 up to v0 + (v1-v0) * verticalProgress
        const { u0, v0, u1, v1 } = region;
        const visibleV1 = v0 + (v1 - v0) * verticalProgress;

        // 6 vertices for 2 triangles (CCW winding)
        // Note: V coordinates - v0 at bottom, visibleV1 at the visible top
        // Vertex 0: top-left (visible top)
        data[offset++] = x0; data[offset++] = y1;
        data[offset++] = u0; data[offset++] = visibleV1;
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
        data[offset++] = u0; data[offset++] = visibleV1;
        data[offset++] = tintR; data[offset++] = tintG; data[offset++] = tintB; data[offset++] = tintA;

        // Vertex 4: bottom-right (again)
        data[offset++] = x1; data[offset++] = y0;
        data[offset++] = u1; data[offset++] = v0;
        data[offset++] = tintR; data[offset++] = tintG; data[offset++] = tintB; data[offset++] = tintA;

        // Vertex 5: top-right (visible top)
        data[offset++] = x1; data[offset++] = y1;
        data[offset++] = u1; data[offset++] = visibleV1;
        data[offset++] = tintR; data[offset++] = tintG; data[offset++] = tintB; data[offset++] = tintA;

        return offset;
    }

    /**
     * Compute player tint color blended with white.
     */
    private computePlayerTint(playerColor: number[], isSelected: boolean): number[] {
        if (isSelected) {
            return SPRITE_TINT_SELECTED;
        }

        const r = 1.0 + (playerColor[0] - 1.0) * PLAYER_TINT_STRENGTH;
        const g = 1.0 + (playerColor[1] - 1.0) * PLAYER_TINT_STRENGTH;
        const b = 1.0 + (playerColor[2] - 1.0) * PLAYER_TINT_STRENGTH;
        return [r, g, b, 1.0];
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

        for (const entity of this.entities) {
            // Skip textured buildings if they're handled by sprite renderer
            if (texturedBuildingsHandled && entity.type === EntityType.Building) {
                const hasSprite = this.spriteManager?.getBuilding(entity.subType as BuildingType);
                if (hasSprite) continue;
            }

            // Skip textured map objects
            if (texturedBuildingsHandled && entity.type === EntityType.MapObject) {
                const hasSprite = this.spriteManager?.getMapObject(entity.subType as MapObjectType);
                if (hasSprite) continue;
            }

            const isSelected = this.selectedEntityIds.has(entity.id);
            const playerColor = PLAYER_COLORS[entity.player % PLAYER_COLORS.length];
            const color = isSelected ? SELECTED_COLOR : playerColor;
            const scale = entity.type === EntityType.Building ? BUILDING_SCALE : UNIT_SCALE;

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
            this.fillQuadVertices(0, 0, scale);
            gl.bufferData(gl.ARRAY_BUFFER, this.vertexData, gl.DYNAMIC_DRAW);
            gl.vertexAttrib4f(this.aColor, color[0], color[1], color[2], color[3]);
            gl.drawArrays(gl.TRIANGLES, 0, 6);
        }
    }

    /**
     * Draw selection rings for selected entities.
     */
    private drawSelectionRings(gl: WebGL2RenderingContext, viewPoint: IViewPoint): void {
        gl.bindBuffer(gl.ARRAY_BUFFER, this.dynamicBuffer!);

        for (const entity of this.entities) {
            if (!this.selectedEntityIds.has(entity.id)) continue;

            const scale = entity.type === EntityType.Building ? BUILDING_SCALE : UNIT_SCALE;

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
            this.fillQuadVertices(0, 0, scale * RING_SCALE_FACTOR);
            gl.bufferData(gl.ARRAY_BUFFER, this.vertexData, gl.DYNAMIC_DRAW);
            gl.vertexAttrib4f(this.aColor, RING_COLOR[0], RING_COLOR[1], RING_COLOR[2], RING_COLOR[3]);
            gl.drawArrays(gl.TRIANGLES, 0, 6);
        }
    }

    /** Get the interpolated world position for a unit */
    private getInterpolatedWorldPos(entity: Entity, viewPoint: IViewPoint): { worldX: number; worldY: number } {
        const unitState = this.unitStates.get(entity.id);

        if (!unitState || unitState.pathIndex >= unitState.path.length) {
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

        const tickProgress = unitState.speed * (1 / 30);
        const t = Math.min(unitState.moveProgress + this.renderAlpha * tickProgress, 1);
        return {
            worldX: prevPos.worldX + (currPos.worldX - prevPos.worldX) * t,
            worldY: prevPos.worldY + (currPos.worldY - prevPos.worldY) * t
        };
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
                const tint = this.previewValid ? SPRITE_TINT_PREVIEW_VALID : SPRITE_TINT_PREVIEW_INVALID;

                sp.use();
                sp.setMatrix('projection', projection);
                sp.bindTexture('u_spriteAtlas', TEXTURE_UNIT_SPRITE_ATLAS);

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
}
