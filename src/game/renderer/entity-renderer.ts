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
import { SpriteMetadataRegistry, SpriteEntry, Race, getBuildingSpriteMap, BUILDING_JOB_INDICES, GFX_FILE_NUMBERS, getMapObjectSpriteMap, MapObjectSpriteInfo } from './sprite-metadata';
import { SpriteLoader, LoadedGfxFileSet } from './sprite-loader';
import { MapObjectType } from '../entity';

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
    private spriteLoader: SpriteLoader | null = null;

    // Sprite atlas and metadata (null if sprites not loaded)
    private spriteAtlas: EntityTextureAtlas | null = null;
    private spriteRegistry: SpriteMetadataRegistry | null = null;
    private currentRace: Race = Race.Roman;
    private glContext: WebGL2RenderingContext | null = null;
    private spriteTextureIndex: number = 0;

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
        if (fileManager) {
            this.spriteLoader = new SpriteLoader(fileManager);
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

        // Try to load sprite textures if file manager is available
        if (this.fileManager && this.textureManager) {
            this.spriteTextureIndex = this.textureManager.create('u_spriteAtlas');
            const loaded = await this.loadBuildingSprites(gl, this.spriteTextureIndex, this.currentRace);

            if (loaded) {
                // Initialize sprite shader
                this.initSpriteShader(gl);

                // Allocate batch buffer for sprite rendering
                this.spriteBatchData = new Float32Array(MAX_BATCH_ENTITIES * FLOATS_PER_ENTITY);
                this.spriteBuffer = gl.createBuffer();

                EntityRenderer.log.debug(
                    `Sprite rendering enabled: ${this.spriteRegistry?.getBuildingCount() ?? 0} building sprites loaded for ${Race[this.currentRace]}`
                );
            }
        }

        return true;
    }

    /**
     * Get the current race being used for building sprites.
     */
    public getRace(): Race {
        return this.currentRace;
    }

    /**
     * Switch to a different race and reload building sprites.
     * Returns true if sprites were loaded successfully.
     */
    public async setRace(race: Race): Promise<boolean> {
        EntityRenderer.log.debug(`setRace called: ${Race[race]} (current: ${Race[this.currentRace]})`);
        if (race === this.currentRace) return true;
        if (!this.glContext || !this.fileManager) {
            EntityRenderer.log.debug(`setRace failed: glContext=${!!this.glContext}, fileManager=${!!this.fileManager}`);
            return false;
        }

        this.currentRace = race;

        // Clear existing sprites
        this.spriteRegistry?.clear();
        this.spriteAtlas = null;

        // Reload sprites for the new race
        const loaded = await this.loadBuildingSprites(
            this.glContext,
            this.spriteTextureIndex,
            race
        );

        if (loaded) {
            EntityRenderer.log.debug(
                `Switched to ${Race[race]}: ${this.spriteRegistry?.getBuildingCount() ?? 0} building sprites loaded`
            );
        } else {
            EntityRenderer.log.debug(`Failed to load sprites for ${Race[race]}, using color fallback`);
        }

        return loaded;
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
     * Uses the SpriteLoader service for file loading.
     */
    private async loadBuildingSprites(
        gl: WebGL2RenderingContext,
        textureIndex: number,
        race: Race
    ): Promise<boolean> {
        if (!this.spriteLoader) return false;

        // Get sprite map for the specified race
        const spriteMap = getBuildingSpriteMap(race);

        // Determine which GFX files we need to load based on the sprite map
        const requiredFiles = new Set<number>();
        for (const info of Object.values(spriteMap)) {
            if (info) requiredFiles.add(info.file);
        }

        if (requiredFiles.size === 0) {
            EntityRenderer.log.debug('No building sprites configured');
            return false;
        }

        // Create atlas and registry - 4096 needed for large building sprites
        const atlas = new EntityTextureAtlas(4096, textureIndex);
        const registry = new SpriteMetadataRegistry();

        let loadedAny = false;

        for (const fileNum of requiredFiles) {
            const loaded = await this.loadSpritesFromFile(fileNum, atlas, registry, spriteMap);
            if (loaded) loadedAny = true;
        }

        if (!loadedAny) {
            EntityRenderer.log.debug('No building sprite files found');
        }

        // Also try to load map object sprites (trees, stones, etc.)
        // These go into the same atlas but use different sprite indices
        const mapObjectsLoaded = await this.loadMapObjectSprites(atlas, registry);
        if (mapObjectsLoaded) {
            EntityRenderer.log.debug(`Map object sprites loaded: ${registry.getMapObjectCount()} objects`);
        }

        // Only return false if no sprites were loaded at all
        if (!loadedAny && !mapObjectsLoaded) {
            EntityRenderer.log.debug('No sprite files found, using color fallback');
            return false;
        }

        // Upload atlas to GPU
        atlas.load(gl);
        this.spriteAtlas = atlas;
        this.spriteRegistry = registry;

        return registry.hasBuildingSprites() || registry.hasMapObjectSprites();
    }

    /**
     * Load sprites from a single GFX file set using the SpriteLoader.
     * The index in spriteMap is the JIL job index.
     */
    private async loadSpritesFromFile(
        fileNum: number,
        atlas: EntityTextureAtlas,
        registry: SpriteMetadataRegistry,
        spriteMap: Partial<Record<BuildingType, { file: number; index: number }>>
    ): Promise<boolean> {
        if (!this.spriteLoader) return false;

        const fileId = `${fileNum}`;
        const fileSet = await this.spriteLoader.loadFileSet(fileId);

        if (!fileSet) {
            EntityRenderer.log.debug(`GFX file set ${fileNum} not available`);
            return false;
        }

        // JIL/DIL are required for building sprite lookup
        if (!fileSet.jilReader || !fileSet.dilReader) {
            EntityRenderer.log.debug(`JIL/DIL files not available for ${fileNum}, cannot load building sprites`);
            return false;
        }

        try {
            // Load sprites for each building type that uses this file
            for (const [typeStr, info] of Object.entries(spriteMap)) {
                if (!info || info.file !== fileNum) continue;

                const buildingType = Number(typeStr) as BuildingType;
                const jobIndex = info.index;

                const loadedSprite = this.spriteLoader.loadJobSprite(fileSet, { jobIndex }, atlas);

                if (!loadedSprite) {
                    EntityRenderer.log.debug(`Failed to load sprite for building ${BuildingType[buildingType]} (job ${jobIndex})`);
                    continue;
                }

                registry.registerBuilding(buildingType, loadedSprite.entry);
            }

            EntityRenderer.log.debug(`Loaded sprites from file ${fileNum}.gfx via SpriteLoader`);
            return true;
        } catch (e) {
            EntityRenderer.log.error(`Failed to load GFX file ${fileNum}: ${e}`);
            return false;
        }
    }

    /**
     * Load map object sprites (trees, stones, etc.) into the atlas.
     * Map objects use direct GIL indexing rather than JIL job indexing.
     */
    private async loadMapObjectSprites(
        atlas: EntityTextureAtlas,
        registry: SpriteMetadataRegistry
    ): Promise<boolean> {
        if (!this.spriteLoader) return false;

        const spriteMap = getMapObjectSpriteMap();
        const fileNum = GFX_FILE_NUMBERS.MAP_OBJECTS;
        const fileId = `${fileNum}`;

        const fileSet = await this.spriteLoader.loadFileSet(fileId);
        if (!fileSet) {
            EntityRenderer.log.debug(`Map object GFX file ${fileNum} not available`);
            return false;
        }

        try {
            let loadedCount = 0;

            for (const [typeStr, info] of Object.entries(spriteMap)) {
                if (!info) continue;

                const objectType = Number(typeStr) as MapObjectType;
                const spriteIndex = info.index;
                const paletteIndex = info.paletteIndex ?? 0;

                const loadedSprite = this.spriteLoader.loadDirectSprite(
                    fileSet,
                    spriteIndex,
                    paletteIndex,
                    atlas
                );

                if (!loadedSprite) {
                    EntityRenderer.log.debug(`Failed to load sprite for map object ${MapObjectType[objectType]} (index ${spriteIndex})`);
                    continue;
                }

                registry.registerMapObject(objectType, loadedSprite.entry);
                loadedCount++;
            }

            if (loadedCount > 0) {
                EntityRenderer.log.debug(`Loaded ${loadedCount} map object sprites from file ${fileNum}.gfx`);
                return true;
            }

            return false;
        } catch (e) {
            EntityRenderer.log.error(`Failed to load map object sprites: ${e}`);
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
            let spriteEntry: SpriteEntry | null = null;
            let tint: number[];

            if (entity.type === EntityType.Building) {
                // Buildings: use building sprite registry with player color
                spriteEntry = this.spriteRegistry.getBuilding(entity.subType as BuildingType);
                const isSelected = this.selectedEntityIds.has(entity.id);
                const playerColor = PLAYER_COLORS[entity.player % PLAYER_COLORS.length];
                tint = this.computePlayerTint(playerColor, isSelected);
            } else if (entity.type === EntityType.MapObject) {
                // Map objects (trees, stones): use map object registry with no tint
                spriteEntry = this.spriteRegistry.getMapObject(entity.subType as MapObjectType);
                const isSelected = this.selectedEntityIds.has(entity.id);
                // No player color for map objects, just brightness adjustment if selected
                tint = isSelected ? [1.3, 1.3, 1.3, 1.0] : [1.0, 1.0, 1.0, 1.0];
            } else {
                continue; // Skip units and other entity types for textured rendering
            }

            if (!spriteEntry) continue;

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
