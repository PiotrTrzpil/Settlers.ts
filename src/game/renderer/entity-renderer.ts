import { IRenderer } from './i-renderer';
import { IViewPoint } from './i-view-point';
import { RendererBase } from './renderer-base';
import { ShaderProgram } from './shader-program';
import { Entity, EntityType, UnitState, TileCoord, CARDINAL_OFFSETS, BuildingType } from '../entity';
import { MapSize } from '@/utilities/map-size';
import { TilePicker } from '../input/tile-picker';
import { TerritoryMap, NO_OWNER } from '../systems/territory';
import { LogHandler } from '@/utilities/log-handler';
import { FileManager } from '@/utilities/file-manager';
import { TextureManager } from './texture-manager';
import { EntityTextureAtlas } from './entity-texture-atlas';
import { SpriteMetadataRegistry, SpriteEntry, BUILDING_SPRITE_MAP, PIXELS_TO_WORLD } from './sprite-metadata';
import { GfxFileReader } from '@/resources/gfx/gfx-file-reader';
import { GilFileReader } from '@/resources/gfx/gil-file-reader';
import { JilFileReader } from '@/resources/gfx/jil-file-reader';
import { DilFileReader } from '@/resources/gfx/dil-file-reader';
import { PilFileReader } from '@/resources/gfx/pil-file-reader';
import { PaletteCollection } from '@/resources/gfx/palette-collection';

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
const SPRITE_TINT_NORMAL = [1.0, 1.0, 1.0, 1.0]; // No tint
const SPRITE_TINT_SELECTED = [1.3, 1.3, 1.3, 1.0]; // Bright highlight
const SPRITE_TINT_PREVIEW_VALID = [0.5, 1.0, 0.5, 0.5]; // Green ghost
const SPRITE_TINT_PREVIEW_INVALID = [1.0, 0.5, 0.5, 0.5]; // Red ghost

// Player tint strength (0 = no tint, 1 = full player color)
const PLAYER_TINT_STRENGTH = 0.4;

// eslint-disable-next-line no-multi-spaces
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

    private mapSize: MapSize;
    private groundHeight: Uint8Array;

    // File manager and texture manager for loading sprites
    private fileManager: FileManager | null = null;
    private textureManager: TextureManager | null = null;

    // Sprite atlas and metadata (null if sprites not loaded)
    private spriteAtlas: EntityTextureAtlas | null = null;
    private spriteRegistry: SpriteMetadataRegistry | null = null;

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

    // Building placement preview
    public previewTile: TileCoord | null = null;
    public previewValid = false;
    public previewBuildingType: BuildingType | null = null;

    // Territory visualization
    public territoryMap: TerritoryMap | null = null;
    private territoryBorderCache: { x: number; y: number; player: number }[] = [];
    private lastTerritoryVersion = -1;
    public territoryVersion = 0;

    // Cached attribute/uniform locations for color shader
    private aPosition = -1;
    private aEntityPos = -1;
    private aColor = -1;

    // Reusable vertex buffer to avoid per-frame allocations
    private vertexData = new Float32Array(6 * 2);

    constructor(
        mapSize: MapSize,
        groundHeight: Uint8Array,
        fileManager?: FileManager,
        textureManager?: TextureManager
    ) {
        super();
        this.mapSize = mapSize;
        this.groundHeight = groundHeight;
        this.fileManager = fileManager ?? null;
        this.textureManager = textureManager ?? null;
    }

    public async init(gl: WebGL2RenderingContext): Promise<boolean> {
        // Initialize color shader (always needed for borders, paths, selection rings)
        super.initShader(gl, vertCode, fragCode);

        const sp = this.shaderProgram;

        // Get locations for color shader
        this.aPosition = sp.getAttribLocation('a_position');
        this.aEntityPos = sp.getAttribLocation('a_entityPos');
        this.aColor = sp.getAttribLocation('a_color');

        // Create a single reusable dynamic buffer for color shader
        this.dynamicBuffer = gl.createBuffer();

        // Try to load sprite textures if file manager is available
        if (this.fileManager && this.textureManager) {
            const spriteTextureIndex = this.textureManager.create('u_spriteAtlas');
            const loaded = await this.loadBuildingSprites(gl, spriteTextureIndex);

            if (loaded) {
                // Initialize sprite shader
                this.initSpriteShader(gl);

                // Allocate batch buffer for sprite rendering
                this.spriteBatchData = new Float32Array(MAX_BATCH_ENTITIES * FLOATS_PER_ENTITY);
                this.spriteBuffer = gl.createBuffer();

                EntityRenderer.log.debug(
                    `Sprite rendering enabled: ${this.spriteRegistry?.getBuildingCount() ?? 0} building sprites loaded`
                );
            }
        }

        return true;
    }

    /**
     * Initialize the sprite shader program.
     */
    private initSpriteShader(gl: WebGL2RenderingContext): void {
        this.spriteShaderProgram = new ShaderProgram();
        this.spriteShaderProgram.init(gl);
        this.spriteShaderProgram.attachShaders(spriteVertCode, spriteFragCode);
        this.spriteShaderProgram.create();
    }

    /**
     * Load building sprites from GFX files and pack them into the atlas.
     */
    private async loadBuildingSprites(
        gl: WebGL2RenderingContext,
        textureIndex: number
    ): Promise<boolean> {
        if (!this.fileManager) return false;

        // Determine which GFX files we need to load based on the sprite map
        const requiredFiles = new Set<number>();
        for (const info of Object.values(BUILDING_SPRITE_MAP)) {
            if (info) requiredFiles.add(info.file);
        }

        if (requiredFiles.size === 0) {
            EntityRenderer.log.debug('No building sprites configured');
            return false;
        }

        // Create atlas and registry
        const atlas = new EntityTextureAtlas(1024, textureIndex);
        const registry = new SpriteMetadataRegistry();

        let loadedAny = false;

        for (const fileNum of requiredFiles) {
            const loaded = await this.loadSpritesFromFile(fileNum, atlas, registry);
            if (loaded) loadedAny = true;
        }

        if (!loadedAny) {
            EntityRenderer.log.debug('No sprite files found, using color fallback');
            return false;
        }

        // Upload atlas to GPU
        atlas.load(gl);
        this.spriteAtlas = atlas;
        this.spriteRegistry = registry;

        return registry.hasBuildingSprites();
    }

    /**
     * Load sprites from a single GFX file set.
     */
    private async loadSpritesFromFile(
        fileNum: number,
        atlas: EntityTextureAtlas,
        registry: SpriteMetadataRegistry
    ): Promise<boolean> {
        if (!this.fileManager) return false;

        // Load all required files for this GFX set
        const files = await this.fileManager.readFiles({
            gfx: `${fileNum}.gfx`,
            gil: `${fileNum}.gil`,
            jil: `${fileNum}.jil`,
            dil: `${fileNum}.dil`,
            pa6: `${fileNum}.pa6`,
            pil: `${fileNum}.pil`,
        }, true);

        // Check if we have the minimum required files
        if (!files.gfx?.length || !files.gil?.length || !files.pa6?.length || !files.pil?.length) {
            EntityRenderer.log.debug(`GFX file set ${fileNum} not available`);
            return false;
        }

        try {
            // Build readers
            const gilReader = new GilFileReader(files.gil);
            const jilReader = files.jil?.length ? new JilFileReader(files.jil) : null;
            const dilReader = files.dil?.length ? new DilFileReader(files.dil) : null;
            const pilReader = new PilFileReader(files.pil);
            const paletteCollection = new PaletteCollection(files.pa6, pilReader);
            const gfxReader = new GfxFileReader(
                files.gfx, gilReader, jilReader, dilReader, paletteCollection
            );

            // Load sprites for each building type that uses this file
            for (const [typeStr, info] of Object.entries(BUILDING_SPRITE_MAP)) {
                if (!info || info.file !== fileNum) continue;

                const buildingType = Number(typeStr) as BuildingType;
                const gfxImage = gfxReader.getImage(info.index);

                if (!gfxImage) {
                    EntityRenderer.log.debug(
                        `Sprite index ${info.index} not found in file ${fileNum}`
                    );
                    continue;
                }

                const imageData = gfxImage.getImageData();
                const region = atlas.reserve(imageData.width, imageData.height);

                if (!region) {
                    EntityRenderer.log.error(`Atlas full, cannot fit sprite for building ${buildingType}`);
                    continue;
                }

                atlas.blit(region, imageData);

                registry.registerBuilding(buildingType, {
                    atlasRegion: region,
                    offsetX: gfxImage.left * PIXELS_TO_WORLD,
                    offsetY: -gfxImage.top * PIXELS_TO_WORLD, // Negate Y for screen coords
                    widthWorld: imageData.width * PIXELS_TO_WORLD,
                    heightWorld: imageData.height * PIXELS_TO_WORLD,
                });
            }

            EntityRenderer.log.debug(`Loaded sprites from file ${fileNum}.gfx`);
            return true;
        } catch (e) {
            EntityRenderer.log.error(`Failed to load GFX file ${fileNum}: ${e}`);
            return false;
        }
    }

    public draw(gl: WebGL2RenderingContext, projection: Float32Array, viewPoint: IViewPoint): void {
        if (!this.dynamicBuffer) return;
        if (this.entities.length === 0 && !this.previewTile) return;

        // Enable blending for semi-transparent entities
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

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
        this.drawTerritoryBorders(gl, viewPoint);

        // Draw path indicators for selected unit (color shader)
        this.drawSelectedUnitPath(gl, viewPoint);

        // Draw entities (textured or color fallback)
        if (this.spriteAtlas && this.spriteRegistry && this.spriteShaderProgram) {
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
        if (!this.spriteShaderProgram || !this.spriteAtlas || !this.spriteRegistry ||
            !this.spriteBuffer || !this.spriteBatchData) {
            return;
        }

        const sp = this.spriteShaderProgram;
        sp.use();
        sp.setMatrix('projection', projection);
        sp.bindTexture('u_spriteAtlas', 3); // Use texture unit 3 (0-2 used by landscape)

        let batchOffset = 0;

        for (const entity of this.entities) {
            // Only render buildings with textured sprites here
            if (entity.type !== EntityType.Building) continue;

            const spriteEntry = this.spriteRegistry.getBuilding(entity.subType as BuildingType);
            if (!spriteEntry) continue;

            const isSelected = this.selectedEntityIds.has(entity.id);
            const playerColor = PLAYER_COLORS[entity.player % PLAYER_COLORS.length];

            // Compute tint: blend between white and player color
            const tint = this.computePlayerTint(playerColor, isSelected);

            const worldPos = TilePicker.tileToWorld(
                entity.x, entity.y,
                this.groundHeight, this.mapSize,
                viewPoint.x, viewPoint.y
            );

            batchOffset = this.fillSpriteQuad(
                batchOffset,
                worldPos.worldX,
                worldPos.worldY,
                spriteEntry,
                tint[0], tint[1], tint[2], tint[3]
            );

            // Check batch capacity
            if (batchOffset >= this.spriteBatchData.length) {
                this.flushSpriteBatch(gl, sp, batchOffset);
                batchOffset = 0;
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
        sp: ShaderProgram,
        floatCount: number
    ): void {
        if (!this.spriteBuffer || !this.spriteBatchData || floatCount === 0) return;

        gl.bindBuffer(gl.ARRAY_BUFFER, this.spriteBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, this.spriteBatchData.subarray(0, floatCount), gl.DYNAMIC_DRAW);

        const stride = 8 * 4; // 8 floats * 4 bytes

        const aPos = sp.getAttribLocation('a_position');
        const aTex = sp.getAttribLocation('a_texcoord');
        const aTint = sp.getAttribLocation('a_tint');

        gl.enableVertexAttribArray(aPos);
        gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, stride, 0);

        gl.enableVertexAttribArray(aTex);
        gl.vertexAttribPointer(aTex, 2, gl.FLOAT, false, stride, 8);

        gl.enableVertexAttribArray(aTint);
        gl.vertexAttribPointer(aTint, 4, gl.FLOAT, false, stride, 16);

        const vertexCount = floatCount / 8;
        gl.drawArrays(gl.TRIANGLES, 0, vertexCount);
    }

    /**
     * Fill sprite quad vertices into the batch buffer.
     * Returns the new offset after adding 48 floats (6 vertices * 8 floats).
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

        // Compute quad corners in world space
        const x0 = worldX + offsetX;
        const y0 = worldY + offsetY;
        const x1 = x0 + widthWorld;
        const y1 = y0 + heightWorld;

        const { u0, v0, u1, v1 } = region;

        // 6 vertices for 2 triangles (CCW winding)
        // Triangle 1: top-left, bottom-left, bottom-right
        // Triangle 2: top-left, bottom-right, top-right

        // Vertex 0: top-left
        data[offset++] = x0; data[offset++] = y1;
        data[offset++] = u0; data[offset++] = v0;
        data[offset++] = tintR; data[offset++] = tintG; data[offset++] = tintB; data[offset++] = tintA;

        // Vertex 1: bottom-left
        data[offset++] = x0; data[offset++] = y0;
        data[offset++] = u0; data[offset++] = v1;
        data[offset++] = tintR; data[offset++] = tintG; data[offset++] = tintB; data[offset++] = tintA;

        // Vertex 2: bottom-right
        data[offset++] = x1; data[offset++] = y0;
        data[offset++] = u1; data[offset++] = v1;
        data[offset++] = tintR; data[offset++] = tintG; data[offset++] = tintB; data[offset++] = tintA;

        // Vertex 3: top-left (again)
        data[offset++] = x0; data[offset++] = y1;
        data[offset++] = u0; data[offset++] = v0;
        data[offset++] = tintR; data[offset++] = tintG; data[offset++] = tintB; data[offset++] = tintA;

        // Vertex 4: bottom-right (again)
        data[offset++] = x1; data[offset++] = y0;
        data[offset++] = u1; data[offset++] = v1;
        data[offset++] = tintR; data[offset++] = tintG; data[offset++] = tintB; data[offset++] = tintA;

        // Vertex 5: top-right
        data[offset++] = x1; data[offset++] = y1;
        data[offset++] = u1; data[offset++] = v0;
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

        // Blend between white (no tint) and player colour
        const r = 1.0 + (playerColor[0] - 1.0) * PLAYER_TINT_STRENGTH;
        const g = 1.0 + (playerColor[1] - 1.0) * PLAYER_TINT_STRENGTH;
        const b = 1.0 + (playerColor[2] - 1.0) * PLAYER_TINT_STRENGTH;
        return [r, g, b, 1.0];
    }

    /**
     * Draw entities using the color shader (solid quads).
     * If texturedBuildingsHandled is true, only draws entities without sprites.
     */
    private drawColorEntities(
        gl: WebGL2RenderingContext,
        projection: Float32Array,
        viewPoint: IViewPoint,
        texturedBuildingsHandled: boolean
    ): void {
        // Re-activate color shader with proper projection
        super.drawBase(gl, projection);

        gl.bindBuffer(gl.ARRAY_BUFFER, this.dynamicBuffer!);
        gl.enableVertexAttribArray(this.aPosition);
        gl.vertexAttribPointer(this.aPosition, 2, gl.FLOAT, false, 0, 0);
        gl.disableVertexAttribArray(this.aEntityPos);
        gl.disableVertexAttribArray(this.aColor);

        for (const entity of this.entities) {
            // Skip textured buildings if they're handled by sprite renderer
            if (texturedBuildingsHandled && entity.type === EntityType.Building) {
                const hasSprite = this.spriteRegistry?.getBuilding(entity.subType as BuildingType);
                if (hasSprite) continue;
            }

            const isSelected = this.selectedEntityIds.has(entity.id);
            const playerColor = PLAYER_COLORS[entity.player % PLAYER_COLORS.length];
            const color = isSelected ? SELECTED_COLOR : playerColor;
            const scale = entity.type === EntityType.Building ? BUILDING_SCALE : UNIT_SCALE;

            // Use interpolated position for units, exact position for buildings
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

            // Set entity world position, fill quad centered at origin
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
        // Re-bind color shader state
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

    /** Get the interpolated world position for a unit using lerp between prev and current tile */
    private getInterpolatedWorldPos(entity: Entity, viewPoint: IViewPoint): { worldX: number; worldY: number } {
        const unitState = this.unitStates.get(entity.id);

        // No unit state or not moving: use exact position
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

        // Lerp between previous and current position using moveProgress
        const t = Math.min(unitState.moveProgress, 1);
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

            // Draw a small dot at each remaining waypoint (max 30 per unit)
            const maxDots = Math.min(unitState.path.length, unitState.pathIndex + 30);
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
        if (this.previewBuildingType !== null && this.spriteAtlas && this.spriteRegistry && this.spriteShaderProgram) {
            const spriteEntry = this.spriteRegistry.getBuilding(this.previewBuildingType);
            if (spriteEntry) {
                const tint = this.previewValid ? SPRITE_TINT_PREVIEW_VALID : SPRITE_TINT_PREVIEW_INVALID;

                const sp = this.spriteShaderProgram;
                sp.use();
                sp.setMatrix('projection', projection);
                sp.bindTexture('u_spriteAtlas', 3);

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

    /** Draw small markers at territory border tiles */
    private drawTerritoryBorders(gl: WebGL2RenderingContext, viewPoint: IViewPoint): void {
        if (!this.territoryMap) return;

        // Rebuild border cache when territory changes
        if (this.lastTerritoryVersion !== this.territoryVersion) {
            this.rebuildBorderCache();
            this.lastTerritoryVersion = this.territoryVersion;
        }

        const BORDER_SCALE = 0.15;
        const BORDER_ALPHA = 0.35;

        for (const border of this.territoryBorderCache) {
            const worldPos = TilePicker.tileToWorld(
                border.x, border.y,
                this.groundHeight, this.mapSize,
                viewPoint.x, viewPoint.y
            );

            const playerColor = PLAYER_COLORS[border.player % PLAYER_COLORS.length];
            gl.vertexAttrib2f(this.aEntityPos, worldPos.worldX, worldPos.worldY);
            this.fillQuadVertices(0, 0, BORDER_SCALE);
            gl.bufferData(gl.ARRAY_BUFFER, this.vertexData, gl.DYNAMIC_DRAW);
            gl.vertexAttrib4f(this.aColor, playerColor[0], playerColor[1], playerColor[2], BORDER_ALPHA);
            gl.drawArrays(gl.TRIANGLES, 0, 6);
        }
    }

    /** Compute which tiles are on a territory border (owned with a differently-owned neighbor) */
    private rebuildBorderCache(): void {
        this.territoryBorderCache = [];
        if (!this.territoryMap) return;

        const w = this.mapSize.width;
        const h = this.mapSize.height;

        for (let y = 0; y < h; y++) {
            for (let x = 0; x < w; x++) {
                const owner = this.territoryMap.getOwner(x, y);
                if (owner === NO_OWNER) continue;

                // Check if this is a border tile
                let isBorder = false;
                for (const [dx, dy] of CARDINAL_OFFSETS) {
                    const nx = x + dx;
                    const ny = y + dy;
                    if (nx < 0 || nx >= w || ny < 0 || ny >= h) {
                        isBorder = true;
                        break;
                    }
                    if (this.territoryMap.getOwner(nx, ny) !== owner) {
                        isBorder = true;
                        break;
                    }
                }

                if (isBorder) {
                    this.territoryBorderCache.push({ x, y, player: owner });
                }
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
}
