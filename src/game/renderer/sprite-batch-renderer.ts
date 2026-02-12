import { ShaderProgram } from './shader-program';
import { SpriteEntry } from './sprite-metadata';
import {
    TEXTURE_UNIT_SPRITE_ATLAS,
    TEXTURE_UNIT_PALETTE,
    MAX_BATCH_ENTITIES,
    FLOATS_PER_ENTITY,
} from './entity-renderer-constants';

import spriteVertCode from './shaders/entity-sprite-vert.glsl';
import spriteFragCode from './shaders/entity-sprite-frag.glsl';
import spriteBlendVertCode from './shaders/entity-sprite-blend-vert.glsl';
import spriteBlendFragCode from './shaders/entity-sprite-blend-frag.glsl';

// Sprite: pos:2 + uvl:3 + playerRow:1 + paletteBase:1 + tint:4 = 11 floats/vertex
const FLOATS_PER_SPRITE_VERTEX = 11;

// Blend: pos:2 + uvl1:3 + uvl2:3 + blend:1 + playerRow:1 + paletteBase:1 + tint:4 = 15 floats/vertex
const FLOATS_PER_BLEND_VERTEX = 15;
const FLOATS_PER_BLEND_ENTITY = 6 * FLOATS_PER_BLEND_VERTEX;
const MAX_BLEND_ENTITIES = 100;

/**
 * Handles batched sprite rendering with both standard and blend shaders.
 * Manages GPU buffers and shader programs for textured entity rendering.
 */
export class SpriteBatchRenderer {
    // Sprite shader
    private spriteShaderProgram: ShaderProgram | null = null;
    private spriteBuffer: WebGLBuffer | null = null;
    private spriteBatchData: Float32Array | null = null;

    // Cached attribute locations for sprite shader
    private aSpritePos = -1;
    private aSpriteTex = -1;
    private aSpritePlayerRow = -1;
    private aSpritePaletteBase = -1;
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
    private aBlendPlayerRow = -1;
    private aBlendPaletteBase = -1;
    private aBlendTint = -1;

    // Current batch offset
    private batchOffset = 0;
    private blendBatchOffset = 0;

    public get isInitialized(): boolean {
        return this.spriteShaderProgram !== null;
    }

    public get spriteShader(): ShaderProgram | null {
        return this.spriteShaderProgram;
    }

    public get blendShader(): ShaderProgram | null {
        return this.spriteBlendShaderProgram;
    }

    /**
     * Initialize sprite and blend shaders with their buffers.
     */
    public init(gl: WebGL2RenderingContext): void {
        // Initialize sprite shader
        this.spriteShaderProgram = new ShaderProgram();
        this.spriteShaderProgram.init(gl);
        this.spriteShaderProgram.attachShaders(spriteVertCode, spriteFragCode);
        this.spriteShaderProgram.create();

        // Cache attribute locations for sprite shader
        this.aSpritePos = this.spriteShaderProgram.getAttribLocation('a_position');
        this.aSpriteTex = this.spriteShaderProgram.getAttribLocation('a_texcoord');
        this.aSpritePlayerRow = this.spriteShaderProgram.getAttribLocation('a_playerRow');
        this.aSpritePaletteBase = this.spriteShaderProgram.getAttribLocation('a_paletteBase');
        this.aSpriteTint = this.spriteShaderProgram.getAttribLocation('a_tint');

        // Allocate sprite batch buffer
        this.spriteBatchData = new Float32Array(MAX_BATCH_ENTITIES * FLOATS_PER_ENTITY);
        this.spriteBuffer = gl.createBuffer();

        // Initialize blend shader
        this.initBlendShader(gl);
    }

    /**
     * Initialize the sprite blend shader for smooth direction transitions.
     */
    private initBlendShader(gl: WebGL2RenderingContext): void {
        this.spriteBlendShaderProgram = new ShaderProgram();
        this.spriteBlendShaderProgram.init(gl);
        this.spriteBlendShaderProgram.attachShaders(spriteBlendVertCode, spriteBlendFragCode);
        this.spriteBlendShaderProgram.create();

        // Cache attribute locations for blend shader
        this.aBlendPos = this.spriteBlendShaderProgram.getAttribLocation('a_position');
        this.aBlendTex1 = this.spriteBlendShaderProgram.getAttribLocation('a_texcoord1');
        this.aBlendTex2 = this.spriteBlendShaderProgram.getAttribLocation('a_texcoord2');
        this.aBlendFactor = this.spriteBlendShaderProgram.getAttribLocation('a_blend');
        this.aBlendPlayerRow = this.spriteBlendShaderProgram.getAttribLocation('a_playerRow');
        this.aBlendPaletteBase = this.spriteBlendShaderProgram.getAttribLocation('a_paletteBase');
        this.aBlendTint = this.spriteBlendShaderProgram.getAttribLocation('a_tint');

        // Allocate blend batch buffer
        this.spriteBlendBatchData = new Float32Array(MAX_BLEND_ENTITIES * FLOATS_PER_BLEND_ENTITY);
        this.spriteBlendBuffer = gl.createBuffer();
    }

    /**
     * Clean up all GPU resources.
     */
    public destroy(gl: WebGL2RenderingContext): void {
        if (this.spriteBuffer) {
            gl.deleteBuffer(this.spriteBuffer);
            this.spriteBuffer = null;
        }
        this.spriteShaderProgram?.free();
        this.spriteShaderProgram = null;
        this.spriteBatchData = null;

        if (this.spriteBlendBuffer) {
            gl.deleteBuffer(this.spriteBlendBuffer);
            this.spriteBlendBuffer = null;
        }
        this.spriteBlendShaderProgram?.free();
        this.spriteBlendShaderProgram = null;
        this.spriteBlendBatchData = null;
    }

    /**
     * Begin a new sprite batch. Call before adding sprites.
     * @param paletteWidth Width of the 2D palette texture (e.g., 2048)
     * @param paletteRowsPerPlayer Number of texture rows per player section
     * @param edgeAA Whether to enable edge anti-aliasing
     */
    public beginSpriteBatch(
        gl: WebGL2RenderingContext,
        projection: Float32Array,
        paletteWidth: number,
        paletteRowsPerPlayer: number,
        edgeAA: boolean
    ): void {
        if (!this.spriteShaderProgram) return;

        this.spriteShaderProgram.use();
        this.spriteShaderProgram.setMatrix('projection', projection);
        this.spriteShaderProgram.bindTexture('u_spriteAtlas', TEXTURE_UNIT_SPRITE_ATLAS);
        this.spriteShaderProgram.bindTexture('u_palette', TEXTURE_UNIT_PALETTE);
        this.spriteShaderProgram.setUniformInt('u_paletteWidth', paletteWidth);
        this.spriteShaderProgram.setUniformInt('u_paletteRowsPerPlayer', paletteRowsPerPlayer);
        this.spriteShaderProgram.setUniformInt('u_edgeAA', edgeAA ? 1 : 0);
        this.batchOffset = 0;
    }

    /**
     * Begin a new blend batch. Call before adding blended sprites.
     * @param paletteWidth Width of the 2D palette texture (e.g., 2048)
     * @param paletteRowsPerPlayer Number of texture rows per player section
     */
    public beginBlendBatch(
        gl: WebGL2RenderingContext,
        projection: Float32Array,
        paletteWidth: number,
        paletteRowsPerPlayer: number
    ): void {
        if (!this.spriteBlendShaderProgram) return;

        this.spriteBlendShaderProgram.use();
        this.spriteBlendShaderProgram.setMatrix('projection', projection);
        this.spriteBlendShaderProgram.bindTexture('u_spriteAtlas', TEXTURE_UNIT_SPRITE_ATLAS);
        this.spriteBlendShaderProgram.bindTexture('u_palette', TEXTURE_UNIT_PALETTE);
        this.spriteBlendShaderProgram.setUniformInt('u_paletteWidth', paletteWidth);
        this.spriteBlendShaderProgram.setUniformInt('u_paletteRowsPerPlayer', paletteRowsPerPlayer);
        this.blendBatchOffset = 0;
    }

    /**
     * Add a sprite to the current batch.
     * @param playerRow Palette row: 0=neutral, 1+=player index+1
     */
    public addSprite(
        gl: WebGL2RenderingContext,
        worldX: number,
        worldY: number,
        entry: SpriteEntry,
        playerRow: number,
        tintR: number,
        tintG: number,
        tintB: number,
        tintA: number
    ): void {
        if (!this.spriteBatchData) return;

        if (this.batchOffset + FLOATS_PER_ENTITY > this.spriteBatchData.length) {
            this.flushSpriteBatch(gl);
        }

        this.batchOffset = this.fillSpriteQuad(
            this.batchOffset, worldX, worldY, entry, playerRow, tintR, tintG, tintB, tintA
        );
    }

    /**
     * Add a partial sprite (for construction rising effect).
     * @param playerRow Palette row: 0=neutral, 1+=player index+1
     */
    public addSpritePartial(
        gl: WebGL2RenderingContext,
        worldX: number,
        worldY: number,
        entry: SpriteEntry,
        playerRow: number,
        tintR: number,
        tintG: number,
        tintB: number,
        tintA: number,
        verticalProgress: number
    ): void {
        if (!this.spriteBatchData) return;

        if (this.batchOffset + FLOATS_PER_ENTITY > this.spriteBatchData.length) {
            this.flushSpriteBatch(gl);
        }

        this.batchOffset = this.fillSpriteQuadPartial(
            this.batchOffset, worldX, worldY, entry, playerRow, tintR, tintG, tintB, tintA, verticalProgress
        );
    }

    /**
     * Add a blended sprite (for direction transitions).
     * @param playerRow Palette row: 0=neutral, 1+=player index+1
     */
    public addBlendSprite(
        gl: WebGL2RenderingContext,
        worldX: number,
        worldY: number,
        oldSprite: SpriteEntry,
        newSprite: SpriteEntry,
        blendFactor: number,
        playerRow: number,
        tintR: number,
        tintG: number,
        tintB: number,
        tintA: number
    ): void {
        if (!this.spriteBlendBatchData) return;

        if (this.blendBatchOffset + FLOATS_PER_BLEND_ENTITY > this.spriteBlendBatchData.length) {
            this.flushBlendBatch(gl);
        }

        this.blendBatchOffset = this.fillBlendSpriteQuad(
            this.blendBatchOffset, worldX, worldY, oldSprite, newSprite,
            blendFactor, playerRow, tintR, tintG, tintB, tintA
        );
    }

    /**
     * End the sprite batch and flush remaining sprites.
     * @returns Number of draw calls made (0 or 1)
     */
    public endSpriteBatch(gl: WebGL2RenderingContext): number {
        if (this.batchOffset > 0) {
            this.flushSpriteBatch(gl);
            return 1;
        }
        return 0;
    }

    /**
     * End the blend batch and flush remaining sprites.
     */
    public endBlendBatch(gl: WebGL2RenderingContext): void {
        if (this.blendBatchOffset > 0) {
            this.flushBlendBatch(gl);
        }
    }

    /**
     * Fill sprite quad vertices into the batch buffer.
     * Vertex format: pos(2) + uvl(3) + playerRow(1) + paletteBase(1) + tint(4) = 11 floats per vertex
     */
    private fillSpriteQuad(
        offset: number,
        worldX: number,
        worldY: number,
        entry: SpriteEntry,
        playerRow: number,
        tintR: number,
        tintG: number,
        tintB: number,
        tintA: number
    ): number {
        if (!this.spriteBatchData) return offset;

        const data = this.spriteBatchData;
        const { atlasRegion: region, offsetX, offsetY, widthWorld, heightWorld, paletteBaseOffset } = entry;

        const x0 = worldX + offsetX;
        const y0 = worldY + offsetY;
        const x1 = x0 + widthWorld;
        const y1 = y0 + heightWorld;

        const { u0, v0, u1, v1, layer } = region;

        // 6 vertices for 2 triangles (CCW winding)
        // Note: V coordinates flipped (v1 at top, v0 at bottom) to correct texture orientation
        // Vertex 0: top-left
        data[offset++] = x0; data[offset++] = y1;
        data[offset++] = u0; data[offset++] = v1; data[offset++] = layer;
        data[offset++] = playerRow; data[offset++] = paletteBaseOffset;
        data[offset++] = tintR; data[offset++] = tintG; data[offset++] = tintB; data[offset++] = tintA;

        // Vertex 1: bottom-left
        data[offset++] = x0; data[offset++] = y0;
        data[offset++] = u0; data[offset++] = v0; data[offset++] = layer;
        data[offset++] = playerRow; data[offset++] = paletteBaseOffset;
        data[offset++] = tintR; data[offset++] = tintG; data[offset++] = tintB; data[offset++] = tintA;

        // Vertex 2: bottom-right
        data[offset++] = x1; data[offset++] = y0;
        data[offset++] = u1; data[offset++] = v0; data[offset++] = layer;
        data[offset++] = playerRow; data[offset++] = paletteBaseOffset;
        data[offset++] = tintR; data[offset++] = tintG; data[offset++] = tintB; data[offset++] = tintA;

        // Vertex 3: top-left (again)
        data[offset++] = x0; data[offset++] = y1;
        data[offset++] = u0; data[offset++] = v1; data[offset++] = layer;
        data[offset++] = playerRow; data[offset++] = paletteBaseOffset;
        data[offset++] = tintR; data[offset++] = tintG; data[offset++] = tintB; data[offset++] = tintA;

        // Vertex 4: bottom-right (again)
        data[offset++] = x1; data[offset++] = y0;
        data[offset++] = u1; data[offset++] = v0; data[offset++] = layer;
        data[offset++] = playerRow; data[offset++] = paletteBaseOffset;
        data[offset++] = tintR; data[offset++] = tintG; data[offset++] = tintB; data[offset++] = tintA;

        // Vertex 5: top-right
        data[offset++] = x1; data[offset++] = y1;
        data[offset++] = u1; data[offset++] = v1; data[offset++] = layer;
        data[offset++] = playerRow; data[offset++] = paletteBaseOffset;
        data[offset++] = tintR; data[offset++] = tintG; data[offset++] = tintB; data[offset++] = tintA;

        return offset;
    }

    /**
     * Fill sprite quad vertices with partial vertical visibility (for "rising from ground" effect).
     * Vertex format: pos(2) + uvl(3) + playerRow(1) + paletteBase(1) + tint(4) = 11 floats per vertex
     */
    private fillSpriteQuadPartial(
        offset: number,
        worldX: number,
        worldY: number,
        entry: SpriteEntry,
        playerRow: number,
        tintR: number,
        tintG: number,
        tintB: number,
        tintA: number,
        verticalProgress: number
    ): number {
        if (!this.spriteBatchData) return offset;

        const data = this.spriteBatchData;
        const { atlasRegion: region, offsetX, offsetY, widthWorld, heightWorld, paletteBaseOffset } = entry;

        const visibleHeight = heightWorld * verticalProgress;

        const x0 = worldX + offsetX;
        const x1 = x0 + widthWorld;

        // y1 is the base (ground level, larger worldY = lower on screen) — stays fixed
        const y1 = worldY + offsetY + heightWorld;
        // Visible top edge rises from y1 (nothing) toward y0 (full building)
        const visibleY0 = y1 - visibleHeight;

        // UV: v1 corresponds to the base (y1), v0 to the roof (y0).
        const { u0, v0, u1, v1, layer } = region;
        const visibleV0 = v1 - (v1 - v0) * verticalProgress;

        // 6 vertices for 2 triangles

        // Vertex 0: base-left (ground level)
        data[offset++] = x0; data[offset++] = y1;
        data[offset++] = u0; data[offset++] = v1; data[offset++] = layer;
        data[offset++] = playerRow; data[offset++] = paletteBaseOffset;
        data[offset++] = tintR; data[offset++] = tintG; data[offset++] = tintB; data[offset++] = tintA;

        // Vertex 1: visible-top-left (rises upward)
        data[offset++] = x0; data[offset++] = visibleY0;
        data[offset++] = u0; data[offset++] = visibleV0; data[offset++] = layer;
        data[offset++] = playerRow; data[offset++] = paletteBaseOffset;
        data[offset++] = tintR; data[offset++] = tintG; data[offset++] = tintB; data[offset++] = tintA;

        // Vertex 2: visible-top-right (rises upward)
        data[offset++] = x1; data[offset++] = visibleY0;
        data[offset++] = u1; data[offset++] = visibleV0; data[offset++] = layer;
        data[offset++] = playerRow; data[offset++] = paletteBaseOffset;
        data[offset++] = tintR; data[offset++] = tintG; data[offset++] = tintB; data[offset++] = tintA;

        // Vertex 3: base-left (again)
        data[offset++] = x0; data[offset++] = y1;
        data[offset++] = u0; data[offset++] = v1; data[offset++] = layer;
        data[offset++] = playerRow; data[offset++] = paletteBaseOffset;
        data[offset++] = tintR; data[offset++] = tintG; data[offset++] = tintB; data[offset++] = tintA;

        // Vertex 4: visible-top-right (again)
        data[offset++] = x1; data[offset++] = visibleY0;
        data[offset++] = u1; data[offset++] = visibleV0; data[offset++] = layer;
        data[offset++] = playerRow; data[offset++] = paletteBaseOffset;
        data[offset++] = tintR; data[offset++] = tintG; data[offset++] = tintB; data[offset++] = tintA;

        // Vertex 5: base-right (ground level)
        data[offset++] = x1; data[offset++] = y1;
        data[offset++] = u1; data[offset++] = v1; data[offset++] = layer;
        data[offset++] = playerRow; data[offset++] = paletteBaseOffset;
        data[offset++] = tintR; data[offset++] = tintG; data[offset++] = tintB; data[offset++] = tintA;

        return offset;
    }

    /**
     * Fill blend sprite quad vertices into the batch buffer.
     * Vertex format: pos(2) + uvl1(3) + uvl2(3) + blend(1) + playerRow(1) + paletteBase(1) + tint(4) = 15 floats per vertex
     */
    private fillBlendSpriteQuad(
        offset: number,
        worldX: number,
        worldY: number,
        oldSprite: SpriteEntry,
        newSprite: SpriteEntry,
        blendFactor: number,
        playerRow: number,
        tintR: number,
        tintG: number,
        tintB: number,
        tintA: number
    ): number {
        if (!this.spriteBlendBatchData) return offset;

        const data = this.spriteBlendBatchData;

        // Use the old sprite's dimensions (they should be similar)
        const { atlasRegion: region1, offsetX, offsetY, widthWorld, heightWorld, paletteBaseOffset } = oldSprite;
        const { atlasRegion: region2 } = newSprite;

        const x0 = worldX + offsetX;
        const y0 = worldY + offsetY;
        const x1 = x0 + widthWorld;
        const y1 = y0 + heightWorld;

        // UV+layer coordinates for both sprites
        const { u0: u0_1, v0: v0_1, u1: u1_1, v1: v1_1, layer: l1 } = region1;
        const { u0: u0_2, v0: v0_2, u1: u1_2, v1: v1_2, layer: l2 } = region2;

        // 6 vertices for 2 triangles (CCW winding)
        // Each vertex: pos(2) + uvl1(3) + uvl2(3) + blend(1) + playerRow(1) + paletteBase(1) + tint(4) = 15 floats

        // Vertex 0: top-left
        data[offset++] = x0; data[offset++] = y1;
        data[offset++] = u0_1; data[offset++] = v1_1; data[offset++] = l1;
        data[offset++] = u0_2; data[offset++] = v1_2; data[offset++] = l2;
        data[offset++] = blendFactor; data[offset++] = playerRow; data[offset++] = paletteBaseOffset;
        data[offset++] = tintR; data[offset++] = tintG; data[offset++] = tintB; data[offset++] = tintA;

        // Vertex 1: bottom-left
        data[offset++] = x0; data[offset++] = y0;
        data[offset++] = u0_1; data[offset++] = v0_1; data[offset++] = l1;
        data[offset++] = u0_2; data[offset++] = v0_2; data[offset++] = l2;
        data[offset++] = blendFactor; data[offset++] = playerRow; data[offset++] = paletteBaseOffset;
        data[offset++] = tintR; data[offset++] = tintG; data[offset++] = tintB; data[offset++] = tintA;

        // Vertex 2: bottom-right
        data[offset++] = x1; data[offset++] = y0;
        data[offset++] = u1_1; data[offset++] = v0_1; data[offset++] = l1;
        data[offset++] = u1_2; data[offset++] = v0_2; data[offset++] = l2;
        data[offset++] = blendFactor; data[offset++] = playerRow; data[offset++] = paletteBaseOffset;
        data[offset++] = tintR; data[offset++] = tintG; data[offset++] = tintB; data[offset++] = tintA;

        // Vertex 3: top-left (again)
        data[offset++] = x0; data[offset++] = y1;
        data[offset++] = u0_1; data[offset++] = v1_1; data[offset++] = l1;
        data[offset++] = u0_2; data[offset++] = v1_2; data[offset++] = l2;
        data[offset++] = blendFactor; data[offset++] = playerRow; data[offset++] = paletteBaseOffset;
        data[offset++] = tintR; data[offset++] = tintG; data[offset++] = tintB; data[offset++] = tintA;

        // Vertex 4: bottom-right (again)
        data[offset++] = x1; data[offset++] = y0;
        data[offset++] = u1_1; data[offset++] = v0_1; data[offset++] = l1;
        data[offset++] = u1_2; data[offset++] = v0_2; data[offset++] = l2;
        data[offset++] = blendFactor; data[offset++] = playerRow; data[offset++] = paletteBaseOffset;
        data[offset++] = tintR; data[offset++] = tintG; data[offset++] = tintB; data[offset++] = tintA;

        // Vertex 5: top-right
        data[offset++] = x1; data[offset++] = y1;
        data[offset++] = u1_1; data[offset++] = v1_1; data[offset++] = l1;
        data[offset++] = u1_2; data[offset++] = v1_2; data[offset++] = l2;
        data[offset++] = blendFactor; data[offset++] = playerRow; data[offset++] = paletteBaseOffset;
        data[offset++] = tintR; data[offset++] = tintG; data[offset++] = tintB; data[offset++] = tintA;

        return offset;
    }

    /**
     * Flush the sprite batch buffer to GPU and draw.
     */
    private flushSpriteBatch(gl: WebGL2RenderingContext): void {
        if (!this.spriteBuffer || !this.spriteBatchData || this.batchOffset === 0) return;

        gl.bindBuffer(gl.ARRAY_BUFFER, this.spriteBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, this.spriteBatchData.subarray(0, this.batchOffset), gl.DYNAMIC_DRAW);

        // Stride: 11 floats * 4 bytes = 44 bytes
        const stride = FLOATS_PER_SPRITE_VERTEX * 4;

        // pos(2) at offset 0
        gl.enableVertexAttribArray(this.aSpritePos);
        gl.vertexAttribPointer(this.aSpritePos, 2, gl.FLOAT, false, stride, 0);

        // texcoord(3) at offset 8
        gl.enableVertexAttribArray(this.aSpriteTex);
        gl.vertexAttribPointer(this.aSpriteTex, 3, gl.FLOAT, false, stride, 8);

        // playerRow(1) at offset 20
        gl.enableVertexAttribArray(this.aSpritePlayerRow);
        gl.vertexAttribPointer(this.aSpritePlayerRow, 1, gl.FLOAT, false, stride, 20);

        // paletteBase(1) at offset 24
        gl.enableVertexAttribArray(this.aSpritePaletteBase);
        gl.vertexAttribPointer(this.aSpritePaletteBase, 1, gl.FLOAT, false, stride, 24);

        // tint(4) at offset 28
        gl.enableVertexAttribArray(this.aSpriteTint);
        gl.vertexAttribPointer(this.aSpriteTint, 4, gl.FLOAT, false, stride, 28);

        const vertexCount = this.batchOffset / FLOATS_PER_SPRITE_VERTEX;
        gl.drawArrays(gl.TRIANGLES, 0, vertexCount);

        this.batchOffset = 0;
    }

    /**
     * Flush the blend sprite batch buffer to GPU and draw.
     */
    private flushBlendBatch(gl: WebGL2RenderingContext): void {
        if (!this.spriteBlendBuffer || !this.spriteBlendBatchData || this.blendBatchOffset === 0) return;

        gl.bindBuffer(gl.ARRAY_BUFFER, this.spriteBlendBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, this.spriteBlendBatchData.subarray(0, this.blendBatchOffset), gl.DYNAMIC_DRAW);

        // Stride: 15 floats * 4 bytes = 60 bytes
        const stride = FLOATS_PER_BLEND_VERTEX * 4;

        // pos(2) at offset 0
        gl.enableVertexAttribArray(this.aBlendPos);
        gl.vertexAttribPointer(this.aBlendPos, 2, gl.FLOAT, false, stride, 0);

        // texcoord1(3) at offset 8
        gl.enableVertexAttribArray(this.aBlendTex1);
        gl.vertexAttribPointer(this.aBlendTex1, 3, gl.FLOAT, false, stride, 8);

        // texcoord2(3) at offset 20
        gl.enableVertexAttribArray(this.aBlendTex2);
        gl.vertexAttribPointer(this.aBlendTex2, 3, gl.FLOAT, false, stride, 20);

        // blend(1) at offset 32
        gl.enableVertexAttribArray(this.aBlendFactor);
        gl.vertexAttribPointer(this.aBlendFactor, 1, gl.FLOAT, false, stride, 32);

        // playerRow(1) at offset 36
        gl.enableVertexAttribArray(this.aBlendPlayerRow);
        gl.vertexAttribPointer(this.aBlendPlayerRow, 1, gl.FLOAT, false, stride, 36);

        // paletteBase(1) at offset 40
        gl.enableVertexAttribArray(this.aBlendPaletteBase);
        gl.vertexAttribPointer(this.aBlendPaletteBase, 1, gl.FLOAT, false, stride, 40);

        // tint(4) at offset 44
        gl.enableVertexAttribArray(this.aBlendTint);
        gl.vertexAttribPointer(this.aBlendTint, 4, gl.FLOAT, false, stride, 44);

        const vertexCount = this.blendBatchOffset / FLOATS_PER_BLEND_VERTEX;
        gl.drawArrays(gl.TRIANGLES, 0, vertexCount);

        this.blendBatchOffset = 0;
    }
}
