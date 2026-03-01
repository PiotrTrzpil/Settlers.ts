import { LogHandler } from '@/utilities/log-handler';
import { RendererBase } from '../renderer-base';
import { IRenderer } from '../i-renderer';
import { LandscapeTextureMap, type RiverConfig } from './textures/landscape-texture-map';
import { MapSize } from '@/utilities/map-size';
import { ShaderDataTexture } from '../shader-data-texture';
import { IViewPoint } from '../i-view-point';
import { FileManager } from '@/utilities/file-manager';
import { TextureMap16Bit } from '../texture-map-16bit';
import { GhFileReader } from '@/resources/gfx/gh-file-reader';
import { GfxImage16Bit } from '@/resources/gfx/gfx-image-16bit';
import { ImageType } from '@/resources/gfx/image-type';
import { TILE_HEIGHT_SCALE } from '@/game/systems/coordinate-system';
import { computeDarknessMap } from './darkness-map';
import vertCode from './shaders/landscape-vert.glsl';
import fragCode from './shaders/landscape-frag.glsl';

// ── Texture unit assignments (0-3) ──────────────────────────────────
const TEXTURE_UNIT_LANDSCAPE = 0;
const TEXTURE_UNIT_LAND_TYPE = 1;
const TEXTURE_UNIT_LAND_HEIGHT = 2;
const TEXTURE_UNIT_DARKNESS = 3;

// Pre-allocated static arrays to avoid per-frame allocations
const BASE_VERTICES_INDEX = new Float32Array([0, 1, 2, 3, 4, 5]);

export class LandscapeRenderer extends RendererBase implements IRenderer {
    private static log = new LogHandler('LandscapeRenderer');

    // ── Map data ────────────────────────────────────────────────────
    private mapSize: MapSize;
    private groundTypeMap: Uint8Array;
    private groundHeightMap: Uint8Array;
    private terrainAttributes: Uint8Array | null;
    private gameplayAttributes: Uint8Array | null;

    // ── GPU buffers ─────────────────────────────────────────────────
    private texture: TextureMap16Bit;
    private landTypeBuffer: ShaderDataTexture | null = null;
    private landHeightBuffer: ShaderDataTexture | null = null;
    private darknessBuffer: ShaderDataTexture | null = null;

    // ── Texture / buffer helpers ────────────────────────────────────
    private fileManager: FileManager;
    private landscapeTextureMap = new LandscapeTextureMap();
    private darknessMap: Uint8Array | null = null;
    private useProceduralTextures: boolean;

    // ── Dirty flags ─────────────────────────────────────────────────
    private terrainDirty = false;
    private darknessDirty = false;

    // ── Runtime toggles ─────────────────────────────────────────────
    public debugGrid: boolean;
    private _darkLandDilation: boolean = true;

    // ── Viewport instance cache ─────────────────────────────────────
    private numVertices = 0;
    private heightMarginY: number;
    private cachedInstancePos: Int16Array<ArrayBuffer> | null = null;
    private cachedInstanceW = 0;
    private cachedInstanceH = 0;
    private cachedInstanceSX = 0;
    private cachedInstanceSY = 0;

    // ── Constructor ─────────────────────────────────────────────────

    constructor(
        fileManager: FileManager,
        mapSize: MapSize,
        groundTypeMap: Uint8Array,
        groundHeightMap: Uint8Array,
        debugGrid: boolean,
        useProceduralTextures = false,
        terrainAttributes: Uint8Array | null = null,
        gameplayAttributes: Uint8Array | null = null
    ) {
        super();

        this.fileManager = fileManager;
        this.mapSize = mapSize;
        this.groundTypeMap = groundTypeMap;
        this.groundHeightMap = groundHeightMap;
        this.debugGrid = debugGrid;
        this.useProceduralTextures = useProceduralTextures;
        this.terrainAttributes = terrainAttributes;
        this.gameplayAttributes = gameplayAttributes;
        this.darknessMap = computeDarknessMap(mapSize, terrainAttributes, gameplayAttributes, this._darkLandDilation);
        this.texture = new TextureMap16Bit(256 * 6, TEXTURE_UNIT_LANDSCAPE);

        // Extra Y rows for max terrain height displacement
        let maxH = 0;
        for (let i = 0; i < groundHeightMap.length; i++) {
            if (groundHeightMap[i]! > maxH) maxH = groundHeightMap[i]!;
        }
        this.heightMarginY = Math.ceil((maxH / 255) * TILE_HEIGHT_SCALE);

        Object.seal(this);
    }

    // ── Public API ──────────────────────────────────────────────────

    /** Toggle dark land gap filling (dilation). Recomputes the darkness buffer when changed. */
    public set darkLandDilation(value: boolean) {
        if (value === this._darkLandDilation) return;
        this._darkLandDilation = value;
        this.darknessMap = computeDarknessMap(this.mapSize, this.terrainAttributes, this.gameplayAttributes, value);
        this.darknessDirty = true;
    }

    public get darkLandDilation(): boolean {
        return this._darkLandDilation;
    }

    /** Mark terrain as dirty, requiring buffer rebuild on next draw. */
    public markTerrainDirty(): void {
        this.terrainDirty = true;
    }

    public rebuildRiverTextures(rc: RiverConfig): void {
        LandscapeRenderer.log.debug('Rebuilding river textures: ' + JSON.stringify(rc));
        this.landscapeTextureMap.updateRiverConfig(rc);
        this.rebuildLandTypeBuffer();
    }

    // ── Lifecycle ───────────────────────────────────────────────────

    public async init(gl: WebGL2RenderingContext): Promise<boolean> {
        this.shaderProgram.setDefine('MAP_WIDTH', this.mapSize.width);
        this.shaderProgram.setDefine('MAP_HEIGHT', this.mapSize.height);
        this.shaderProgram.setDefine('LANDSCAPE_TEXTURE_WIDTH_HEIGHT', this.texture.imgWidthHeight);
        if (this.darknessMap) {
            this.shaderProgram.setDefine('HAS_DARKNESS', 1);
        }

        super.initShader(gl, vertCode, fragCode);

        await this.loadLandscapeTexture();
        this.texture.load(gl);

        this.landTypeBuffer = this.buildLandTypeBuffer();
        this.landHeightBuffer = this.buildLandHeightBuffer();
        if (this.darknessMap) {
            this.darknessBuffer = this.buildDarknessBuffer(this.darknessMap);
        }

        this.numVertices = 6;
        return true;
    }

    public destroy(): void {
        this.landTypeBuffer?.free();
        this.landTypeBuffer = null;
        this.landHeightBuffer?.free();
        this.landHeightBuffer = null;
        this.darknessBuffer?.free();
        this.darknessBuffer = null;
        this.texture.free();
        this.cachedInstancePos = null;
        LandscapeRenderer.log.debug('LandscapeRenderer resources cleaned up');
    }

    public draw(gl: WebGL2RenderingContext, projection: Float32Array, viewPoint: IViewPoint): void {
        super.drawBase(gl, projection);

        if (this.terrainDirty) this.rebuildTerrainBuffers();
        if (this.darknessDirty) this.rebuildDarknessBuffer(gl);

        const { numInstancesX, numInstancesY, startX, startY } = this.computeViewportInstances(gl, viewPoint);
        const sp = this.shaderProgram;

        // Bind textures
        sp.bindTexture('u_texture', TEXTURE_UNIT_LANDSCAPE);
        sp.bindTexture('u_landTypeBuffer', TEXTURE_UNIT_LAND_TYPE);
        sp.bindTexture('u_landHeightBuffer', TEXTURE_UNIT_LAND_HEIGHT);
        if (this.darknessBuffer) sp.bindTexture('u_darknessBuffer', TEXTURE_UNIT_DARKNESS);

        // Uniforms
        sp.setVector2('viewPoint', viewPoint.x, viewPoint.y);
        gl.uniform1i(sp.getUniformLocation('u_debugGrid'), this.debugGrid ? 1 : 0);

        // Vertex attributes
        sp.setArrayFloat('baseVerticesIndex', BASE_VERTICES_INDEX, 1);

        // Upload GPU data
        this.landTypeBuffer?.create(gl);
        this.landHeightBuffer?.create(gl);
        this.darknessBuffer?.create(gl);

        // Instance positions
        sp.setArrayShort('instancePos', this.getInstancePosArray(numInstancesX, numInstancesY, startX, startY), 2, 1);

        // Draw
        sp.drawArraysInstanced(gl.TRIANGLES, 0, this.numVertices, numInstancesX * numInstancesY);

        const glError = gl.getError();
        if (glError !== 0) {
            LandscapeRenderer.log.error('WebGL error: ' + glError);
        }
    }

    // ── Texture loading ─────────────────────────────────────────────

    private async loadLandscapeTexture(): Promise<void> {
        if (this.useProceduralTextures) {
            LandscapeRenderer.log.debug('Using procedural textures (flag set)');
            this.texture.fillProceduralColors();
            return;
        }

        const imgFile = await this.fileManager.readFile('2.gh6', true);
        if (!imgFile) {
            LandscapeRenderer.log.error('Unable to load texture file "2.gh6" – using procedural fallback');
            this.texture.fillProceduralColors();
            return;
        }

        const reader = new GhFileReader(imgFile);
        const img = reader.findImageByType<GfxImage16Bit>(ImageType.Image16Bit);
        if (!img) {
            LandscapeRenderer.log.error('No 16-bit image in "2.gh6" – using procedural fallback');
            this.texture.fillProceduralColors();
            return;
        }

        this.landscapeTextureMap.copyTexture(img, this.texture);
        this.texture.patchTransparencyKey();
    }

    // ── Buffer builders ─────────────────────────────────────────────

    private buildLandHeightBuffer(): ShaderDataTexture {
        const buf = new ShaderDataTexture(this.mapSize.width, this.mapSize.height, 1, TEXTURE_UNIT_LAND_HEIGHT);
        for (let y = 0; y < this.mapSize.height; y++) {
            for (let x = 0; x < this.mapSize.width; x++) {
                buf.update(x, y, this.groundHeightMap[this.mapSize.toIndex(x, y)]!);
            }
        }
        return buf;
    }

    private buildLandTypeBuffer(): ShaderDataTexture {
        const buf = new ShaderDataTexture(this.mapSize.width, this.mapSize.height, 4, TEXTURE_UNIT_LAND_TYPE);
        this.fillLandTypeBuffer(buf);
        return buf;
    }

    private buildDarknessBuffer(darknessMap: Uint8Array): ShaderDataTexture {
        const buf = new ShaderDataTexture(this.mapSize.width, this.mapSize.height, 2, TEXTURE_UNIT_DARKNESS);
        for (let y = 0; y < this.mapSize.height; y++) {
            for (let x = 0; x < this.mapSize.width; x++) {
                const i = this.mapSize.toIndex(x, y) * 2;
                buf.update(x, y, darknessMap[i] ?? 0, darknessMap[i + 1] ?? 0);
            }
        }
        return buf;
    }

    /** Populate a land type buffer from current terrain data and texture map. */
    private fillLandTypeBuffer(buf: ShaderDataTexture): void {
        const map = this.landscapeTextureMap;
        const ms = this.mapSize;
        for (let y = 0; y < ms.height; y++) {
            for (let x = 0; x < ms.width; x++) {
                //     t1       t4
                //     /\\------/
                //    /  \\  B /
                //   /  A \\  /
                //  /------\\/
                // t2       t3
                const t1 = this.groundTypeMap[ms.toIndex(x, y)]!;
                const t2 = this.groundTypeMap[ms.toIndex(x, y + 1)]!;
                const t3 = this.groundTypeMap[ms.toIndex(x + 1, y + 1)]!;
                const t4 = this.groundTypeMap[ms.toIndex(x + 1, y)]!;
                const a = map.getTextureA(t1, t2, t3, x, y);
                const b = map.getTextureB(t1, t3, t4, x, y);
                buf.update(x, y, a[0], a[1], b[0], b[1]);
            }
        }
    }

    // ── Buffer rebuilds ─────────────────────────────────────────────

    private rebuildTerrainBuffers(): void {
        if (!this.landTypeBuffer || !this.landHeightBuffer) return;

        this.fillLandTypeBuffer(this.landTypeBuffer);

        for (let y = 0; y < this.mapSize.height; y++) {
            for (let x = 0; x < this.mapSize.width; x++) {
                this.landHeightBuffer.update(x, y, this.groundHeightMap[this.mapSize.toIndex(x, y)]!);
            }
        }

        this.terrainDirty = false;
        LandscapeRenderer.log.debug('Terrain buffers rebuilt');
    }

    private rebuildLandTypeBuffer(): void {
        if (!this.landTypeBuffer) return;
        this.fillLandTypeBuffer(this.landTypeBuffer);
    }

    private rebuildDarknessBuffer(gl: WebGL2RenderingContext): void {
        this.darknessDirty = false;

        if (!this.darknessBuffer && this.darknessMap) {
            this.darknessBuffer = this.buildDarknessBuffer(this.darknessMap);
            this.darknessBuffer.create(gl);
            return;
        }
        if (!this.darknessBuffer) return;

        const map = this.darknessMap;
        for (let y = 0; y < this.mapSize.height; y++) {
            for (let x = 0; x < this.mapSize.width; x++) {
                const i = this.mapSize.toIndex(x, y) * 2;
                this.darknessBuffer.update(x, y, map ? (map[i] ?? 0) : 0, map ? (map[i + 1] ?? 0) : 0);
            }
        }
    }

    // ── Viewport helpers ────────────────────────────────────────────

    private computeViewportInstances(
        gl: WebGL2RenderingContext,
        viewPoint: IViewPoint
    ): { numInstancesX: number; numInstancesY: number; startX: number; startY: number } {
        const canvas = gl.canvas as HTMLCanvasElement;
        const aspect = canvas.width / canvas.height;
        const halfX = Math.ceil(aspect / viewPoint.zoom) + 2;
        const halfY = Math.ceil(2 / viewPoint.zoom) + 2 + this.heightMarginY;
        return {
            numInstancesX: 2 * halfX,
            numInstancesY: 2 * halfY,
            startX: -halfX + Math.ceil(aspect),
            startY: -halfY + 2,
        };
    }

    private getInstancePosArray(
        width: number,
        height: number,
        startX: number,
        startY: number
    ): Int16Array<ArrayBuffer> {
        if (
            this.cachedInstancePos &&
            this.cachedInstanceW === width &&
            this.cachedInstanceH === height &&
            this.cachedInstanceSX === startX &&
            this.cachedInstanceSY === startY
        ) {
            return this.cachedInstancePos;
        }

        const r = new Int16Array(width * height * 2);
        let i = 0;
        for (let dy = 0; dy < height; dy++) {
            for (let dx = 0; dx < width; dx++) {
                const iy = startY + dy;
                r[i++] = startX + dx + Math.floor(iy / 2);
                r[i++] = iy;
            }
        }

        this.cachedInstancePos = r;
        this.cachedInstanceW = width;
        this.cachedInstanceH = height;
        this.cachedInstanceSX = startX;
        this.cachedInstanceSY = startY;
        return r;
    }
}
