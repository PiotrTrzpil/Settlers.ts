import { LogHandler } from '@/utilities/log-handler';
import { ShaderTexture } from './shader-texture';

/**
 * Defines a region within the texture atlas, with both pixel coordinates
 * and normalized UV coordinates for shader use.
 */
export interface AtlasRegion {
    /** Pixel X position in atlas */
    x: number;
    /** Pixel Y position in atlas */
    y: number;
    /** Region width in pixels */
    width: number;
    /** Region height in pixels */
    height: number;
    /** Normalized U coordinate (top-left) */
    u0: number;
    /** Normalized V coordinate (top-left) */
    v0: number;
    /** Normalized U coordinate (bottom-right) */
    u1: number;
    /** Normalized V coordinate (bottom-right) */
    v1: number;
}

/**
 * Internal slot for row-based packing within the atlas.
 */
class Slot {
    public x = 0;
    public y: number;
    public height: number;
    public width: number;

    /** Returns the remaining width available in this slot */
    public get leftSize(): number {
        return this.width - this.x;
    }

    /** Returns the bottom Y position of the slot */
    public get bottom(): number {
        return this.y + this.height;
    }

    constructor(y: number, width: number, height: number) {
        this.y = y;
        this.width = width;
        this.height = height;
    }

    /** Reserve some width within the slot */
    public increase(width: number): void {
        this.x += width;
    }
}

/**
 * RGBA8 texture atlas for entity sprites (buildings, units).
 * Uses slot-based row packing similar to TextureMap16Bit but with
 * 32-bit RGBA format for transparency support.
 */
export class EntityTextureAtlas extends ShaderTexture {
    private static log = new LogHandler('EntityTextureAtlas');

    private imgData: Uint8Array;
    private atlasWidth: number;
    private atlasHeight: number;
    private slots: Slot[] = [];

    constructor(size: number, textureIndex: number) {
        super(textureIndex);

        this.atlasWidth = size;
        this.atlasHeight = size;
        // 4 bytes per pixel (RGBA)
        this.imgData = new Uint8Array(size * size * 4);

        // Initialize with transparent magenta for debugging (visible if UV coords are wrong)
        for (let i = 0; i < size * size; i++) {
            this.imgData[i * 4 + 0] = 255; // R
            this.imgData[i * 4 + 1] = 0;   // G
            this.imgData[i * 4 + 2] = 255; // B
            this.imgData[i * 4 + 3] = 0;   // A (transparent)
        }
    }

    public get width(): number {
        return this.atlasWidth;
    }

    public get height(): number {
        return this.atlasHeight;
    }

    /**
     * Reserve a region in the atlas for a sprite of the given dimensions.
     * Uses row-based slot packing: sprites of the same height share a row.
     * Returns null if the atlas is full.
     */
    public reserve(width: number, height: number): AtlasRegion | null {
        // Find an existing slot with matching height and enough space
        let slot = this.slots.find(s => s.height === height && s.leftSize >= width);

        if (!slot) {
            // Need to create a new slot (row)
            const freeY = this.slots.length > 0 ? this.slots[this.slots.length - 1].bottom : 0;

            // Check if we have vertical space
            if (freeY + height > this.atlasHeight) {
                EntityTextureAtlas.log.error(`Atlas full: cannot fit ${width}x${height} sprite`);
                return null;
            }

            slot = new Slot(freeY, this.atlasWidth, height);
            this.slots.push(slot);
        }

        const x = slot.x;
        const y = slot.y;

        // Compute normalized UV coordinates
        const u0 = x / this.atlasWidth;
        const v0 = y / this.atlasHeight;
        const u1 = (x + width) / this.atlasWidth;
        const v1 = (y + height) / this.atlasHeight;

        slot.increase(width);

        return { x, y, width, height, u0, v0, u1, v1 };
    }

    /**
     * Copy sprite pixel data into a reserved region of the atlas.
     * The ImageData must match the region dimensions.
     */
    public blit(region: AtlasRegion, imageData: ImageData): void {
        if (imageData.width !== region.width || imageData.height !== region.height) {
            EntityTextureAtlas.log.error(
                `Blit size mismatch: region ${region.width}x${region.height}, ` +
                `image ${imageData.width}x${imageData.height}`
            );
            return;
        }

        const src = imageData.data;
        const dst = this.imgData;
        const atlasW = this.atlasWidth;

        for (let y = 0; y < region.height; y++) {
            const srcRow = y * region.width * 4;
            const dstRow = ((region.y + y) * atlasW + region.x) * 4;

            for (let x = 0; x < region.width; x++) {
                const srcIdx = srcRow + x * 4;
                const dstIdx = dstRow + x * 4;
                dst[dstIdx + 0] = src[srcIdx + 0]; // R
                dst[dstIdx + 1] = src[srcIdx + 1]; // G
                dst[dstIdx + 2] = src[srcIdx + 2]; // B
                dst[dstIdx + 3] = src[srcIdx + 3]; // A
            }
        }
    }

    /**
     * Upload the atlas to the GPU as an RGBA8 texture.
     * Uses NEAREST filtering to preserve pixel-art style.
     */
    public load(gl: WebGL2RenderingContext): void {
        super.bind(gl);

        gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
        gl.texImage2D(
            gl.TEXTURE_2D,
            0,
            gl.RGBA8,
            this.atlasWidth,
            this.atlasHeight,
            0,
            gl.RGBA,
            gl.UNSIGNED_BYTE,
            this.imgData
        );

        EntityTextureAtlas.log.debug(
            `Uploaded ${this.atlasWidth}x${this.atlasHeight} RGBA8 atlas to GPU`
        );
    }

    /**
     * Fill the atlas with a procedural pattern for testing/fallback.
     * Creates a visible checkerboard pattern.
     */
    public fillProceduralPattern(): void {
        const size = this.atlasWidth;
        for (let y = 0; y < size; y++) {
            for (let x = 0; x < size; x++) {
                const idx = (y * size + x) * 4;
                const checker = ((x >> 4) + (y >> 4)) % 2;
                this.imgData[idx + 0] = checker ? 200 : 100; // R
                this.imgData[idx + 1] = checker ? 200 : 100; // G
                this.imgData[idx + 2] = checker ? 200 : 100; // B
                this.imgData[idx + 3] = 255; // A
            }
        }
    }
}
