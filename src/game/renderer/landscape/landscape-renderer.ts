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
import vertCode from './shaders/landscape-vert.glsl';
import fragCode from './shaders/landscape-frag.glsl';

// Texture unit assignments for landscape renderer (0-2)
const TEXTURE_UNIT_LANDSCAPE = 0;
const TEXTURE_UNIT_LAND_TYPE = 1;
const TEXTURE_UNIT_LAND_HEIGHT = 2;

export class LandscapeRenderer extends RendererBase implements IRenderer {
    private static log = new LogHandler('LandscapeRenderer');
    private numVertices = 0;
    private texture: TextureMap16Bit;
    private mapSize: MapSize;
    private landscapeTextureMap = new LandscapeTextureMap();

    private landTypeBuffer: ShaderDataTexture | null = null;
    private landHeightBuffer: ShaderDataTexture | null = null;
    private fileManager: FileManager;

    private groundTypeMap: Uint8Array;
    private groundHeightMap: Uint8Array;
    public debugGrid: boolean;
    private useProceduralTextures: boolean;

    /** Cached instance position array to avoid allocating a new Int16Array every frame */
    private cachedInstancePos: Int16Array | null = null;
    private cachedInstanceW = 0;
    private cachedInstanceH = 0;
    private cachedInstanceSX = 0;
    private cachedInstanceSY = 0;

    /** Extra Y tile rows needed to cover terrain height displacement at the bottom edge */
    private heightMarginY: number;

    constructor(
        fileManager: FileManager,
        mapSize: MapSize,
        groundTypeMap: Uint8Array,
        groundHeightMap: Uint8Array,
        debugGrid: boolean,
        useProceduralTextures = false
    ) {
        super();

        this.fileManager = fileManager;
        this.mapSize = mapSize;
        this.groundHeightMap = groundHeightMap;
        this.groundTypeMap = groundTypeMap;
        this.debugGrid = debugGrid;
        this.useProceduralTextures = useProceduralTextures;

        this.texture = new TextureMap16Bit(256 * 6, TEXTURE_UNIT_LANDSCAPE);

        // Compute extra Y rows needed for max terrain height displacement.
        // Shader: mapHeight = texel.r * 20.0; screen offset = mapHeight * 0.5.
        // Each tile row covers ~0.5 screen units, so extra rows = ceil(maxHeight).
        let maxH = 0;
        for (let i = 0; i < groundHeightMap.length; i++) {
            if (groundHeightMap[i] > maxH) maxH = groundHeightMap[i];
        }
        this.heightMarginY = Math.ceil(maxH / 255 * 20);

        Object.seal(this);
    }

    /** load the landscape texture from file and push it to a texture map buffer */
    private async createLandscapeTextureMap() {
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
    }

    private createLandHeightBuffer(mapSize: MapSize, textureIndex: number, groundHeightMap: Uint8Array): ShaderDataTexture {
        const result = new ShaderDataTexture(mapSize.width, mapSize.height, 1, textureIndex);

        for (let y = 0; y < mapSize.height; y++) {
            for (let x = 0; x < mapSize.width; x++) {
                const heightValue = groundHeightMap[mapSize.toIndex(x, y)];
                result.update(x, y, heightValue);
            }
        }

        return result;
    }

    private createLandTypeBuffer(mapSize: MapSize, textureIndex: number, groundTypeMap: Uint8Array): ShaderDataTexture {
        const result = new ShaderDataTexture(mapSize.width, mapSize.height, 4, textureIndex);

        const h = mapSize.height;
        const w = mapSize.width;

        const map = this.landscapeTextureMap;

        for (let y = 0; y < h; y++) {
            for (let x = 0; x < w; x++) {
                // map parallelogram
                //     t1       t4
                //     /\\------/
                //    /  \\  B /
                //   /  A \\  /
                //  /------\\/
                // t2       t3

                const t1 = groundTypeMap[mapSize.toIndex(x, y)];
                const t2 = groundTypeMap[mapSize.toIndex(x, y + 1)];
                const t3 = groundTypeMap[mapSize.toIndex(x + 1, y + 1)];
                const t4 = groundTypeMap[mapSize.toIndex(x + 1, y)];

                const a = map.getTextureA(t1, t2, t3, x, y);
                const b = map.getTextureB(t1, t3, t4, x, y);

                result.update(x, y, a[0], a[1], b[0], b[1]);
            }
        }

        return result;
    }

    public async init(gl: WebGL2RenderingContext): Promise<boolean> {
        this.shaderProgram.setDefine('MAP_WIDTH', this.mapSize.width);
        this.shaderProgram.setDefine('MAP_HEIGHT', this.mapSize.height);
        this.shaderProgram.setDefine('LANDSCAPE_TEXTURE_WIDTH_HEIGHT', this.texture.imgWidthHeight);

        super.initShader(gl, vertCode, fragCode);

        await this.createLandscapeTextureMap();
        this.texture.load(gl);

        this.landTypeBuffer = this.createLandTypeBuffer(this.mapSize, TEXTURE_UNIT_LAND_TYPE, this.groundTypeMap);
        this.landHeightBuffer = this.createLandHeightBuffer(this.mapSize, TEXTURE_UNIT_LAND_HEIGHT, this.groundHeightMap);

        this.numVertices = 6;

        return true;
    }

    // create an array with x,y for every parallelogram
    //      /-----/-----/-----/
    //     / 0/0 / 1/0 / 2/0 /
    //    /-----/-----/-----/
    //   / 0/1 / 1/1 / 2/1 /
    //  /-----/-----/-----/
    private getInstancePosArray(width: number, height: number, startX: number, startY: number): Int16Array {
        // Return cached array if dimensions haven't changed
        if (this.cachedInstancePos
            && this.cachedInstanceW === width && this.cachedInstanceH === height
            && this.cachedInstanceSX === startX && this.cachedInstanceSY === startY) {
            return this.cachedInstancePos;
        }

        const r = new Int16Array(width * height * 2);
        let i = 0;
        for (let dy = 0; dy < height; dy++) {
            for (let dx = 0; dx < width; dx++) {
                const iy = startY + dy;
                const ix = startX + dx;
                r[i] = ix + Math.floor(iy / 2);
                i++;
                r[i] = iy;
                i++;
            }
        }

        this.cachedInstancePos = r;
        this.cachedInstanceW = width;
        this.cachedInstanceH = height;
        this.cachedInstanceSX = startX;
        this.cachedInstanceSY = startY;
        return r;
    }

    public rebuildRiverTextures(rc: RiverConfig): void {
        LandscapeRenderer.log.debug('Rebuilding river textures: ' + JSON.stringify(rc));
        this.landscapeTextureMap.updateRiverConfig(rc);
        if (this.landTypeBuffer) {
            const map = this.landscapeTextureMap;
            const h = this.mapSize.height;
            const w = this.mapSize.width;
            for (let y = 0; y < h; y++) {
                for (let x = 0; x < w; x++) {
                    const t1 = this.groundTypeMap[this.mapSize.toIndex(x, y)];
                    const t2 = this.groundTypeMap[this.mapSize.toIndex(x, y + 1)];
                    const t3 = this.groundTypeMap[this.mapSize.toIndex(x + 1, y + 1)];
                    const t4 = this.groundTypeMap[this.mapSize.toIndex(x + 1, y)];
                    const a = map.getTextureA(t1, t2, t3, x, y);
                    const b = map.getTextureB(t1, t3, t4, x, y);
                    this.landTypeBuffer.update(x, y, a[0], a[1], b[0], b[1]);
                }
            }
        }
    }

    public draw(gl: WebGL2RenderingContext, projection: Float32Array, viewPoint: IViewPoint): void {

        super.drawBase(gl, projection);

        const sp = this.shaderProgram;
        if (!sp) {
            return;
        }

        // Calculate how many tile instances are needed to fill the viewport.
        // With the corrected projection, the viewport center maps to world
        // (aspect, 1), so the visible range extends in both directions from
        // there.  We need instances covering negative world coordinates too.
        const canvas = gl.canvas as HTMLCanvasElement;
        const aspect = canvas.width / canvas.height;
        const halfX = Math.ceil(aspect / viewPoint.zoom) + 2;
        const halfY = Math.ceil(2 / viewPoint.zoom) + 2 + this.heightMarginY;
        const startX = -halfX + Math.ceil(aspect);
        const startY = -halfY + 2;
        const numInstancesX = 2 * halfX;
        const numInstancesY = 2 * halfY;

        // ///////////
        // Bind texture uniforms to their assigned texture units
        sp.bindTexture('u_texture', TEXTURE_UNIT_LANDSCAPE);
        sp.bindTexture('u_landTypeBuffer', TEXTURE_UNIT_LAND_TYPE);
        sp.bindTexture('u_landHeightBuffer', TEXTURE_UNIT_LAND_HEIGHT);

        // set view Point – pass as-is (not negated) so that
        // pixelCoord = instancePos + viewPoint falls inside map bounds.
        sp.setVector2('viewPoint', viewPoint.x, viewPoint.y);

        // Toggle debug grid wireframe overlay at runtime
        const debugLoc = sp.getUniformLocation('u_debugGrid');
        gl.uniform1i(debugLoc, this.debugGrid ? 1 : 0);

        // ///////////
        // set vertex index
        //         0 3      5
        //         /\\------/
        //        /  \\  B /
        //       /  A \\  /
        //      /------\\/
        //     1       2 4
        sp.setArrayFloat('baseVerticesIndex', new Float32Array([0, 1, 2, 3, 4, 5]), 1);

        // ///////////
        // update texture data
        if (this.landTypeBuffer) {
            this.landTypeBuffer.create(gl);
        }

        // ///////////
        // update texture data
        if (this.landHeightBuffer) {
            this.landHeightBuffer.create(gl);
        }

        // ///////////
        // instance Position, one per instance
        //      /-----/-----/-----/
        //     / 0/0 / 1/0 / 2/0 /
        //    /-----/-----/-----/
        //   / 0/1 / 1/1 / 2/1 /
        //  /-----/-----/-----/
        sp.setArrayShort('instancePos', this.getInstancePosArray(numInstancesX, numInstancesY, startX, startY), 2, 1);

        // ////////
        // do it! Native WebGL2 instanced draw
        sp.drawArraysInstanced(
            gl.TRIANGLES,
            0, // offset
            this.numVertices, // num vertices per instance
            numInstancesX * numInstancesY // num instances
        );

        const glError = gl.getError();
        if (glError !== 0) {
            LandscapeRenderer.log.error('WebGL error: ' + glError);
        }
    }
}
