import { LogHandler } from '@/utilities/log-handler';
import { ShaderTexture } from './shader-texture';

/**
 * Padding in pixels around each sprite to prevent texture bleeding
 * when sampling near edges with bilinear filtering.
 */
const ATLAS_PADDING = 1;

/** Log slow main-thread operations (threshold in ms) */
const SLOW_OP_THRESHOLD_MS = 2;

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

/** Maximum atlas size (16384x16384 = 1GB) - needed for all sprites with 4 directions */
const MAX_ATLAS_SIZE = 16384;

/** Initial atlas size - start at 8192 to avoid expensive grow operations during loading.
 * 8192x8192 = 256MB which is acceptable for modern systems. */
const INITIAL_ATLAS_SIZE = 8192;

/**
 * RGBA8 texture atlas for entity sprites (buildings, units).
 * Uses slot-based row packing similar to TextureMap16Bit but with
 * 32-bit RGBA format for transparency support.
 *
 * The atlas starts small and grows automatically when full,
 * reducing initial memory allocation.
 */
export class EntityTextureAtlas extends ShaderTexture {
    private static log = new LogHandler('EntityTextureAtlas');

    private imgData: Uint8Array;
    private atlasWidth: number;
    private atlasHeight: number;
    private slots: Slot[] = [];

    /** Track all reserved regions so we can update UVs when growing */
    private reservedRegions: AtlasRegion[] = [];

    /** Maximum size this atlas can grow to */
    private maxSize: number;

    constructor(maxSize: number, textureIndex: number) {
        super(textureIndex);

        this.maxSize = Math.min(maxSize, MAX_ATLAS_SIZE);

        // Start with small initial size
        const initialSize = Math.min(INITIAL_ATLAS_SIZE, this.maxSize);
        this.atlasWidth = initialSize;
        this.atlasHeight = initialSize;

        // 4 bytes per pixel (RGBA)
        const byteLength = initialSize * initialSize * 4;
        this.imgData = new Uint8Array(byteLength);

        // Initialize with transparent magenta for debugging (visible if UV coords are wrong)
        this.fillTransparent(this.imgData, initialSize * initialSize);
    }

    /** Fill array with transparent magenta (debug color) */
    private fillTransparent(data: Uint8Array, pixelCount: number): void {
        for (let i = 0; i < pixelCount; i++) {
            data[i * 4 + 0] = 255; // R
            data[i * 4 + 1] = 0;   // G
            data[i * 4 + 2] = 255; // B
            data[i * 4 + 3] = 0;   // A (transparent)
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
     * Includes padding to prevent texture bleeding.
     * Automatically grows the atlas if needed (up to maxSize).
     * Returns null if the atlas is full and cannot grow.
     */
    public reserve(width: number, height: number): AtlasRegion | null {
        // Account for padding in slot size
        const paddedWidth = width + ATLAS_PADDING * 2;
        const paddedHeight = height + ATLAS_PADDING * 2;

        // Find an existing slot with matching padded height and enough space
        let slot = this.slots.find(s => s.height === paddedHeight && s.leftSize >= paddedWidth);

        if (!slot) {
            // Need to create a new slot (row)
            const freeY = this.slots.length > 0 ? this.slots[this.slots.length - 1].bottom : 0;

            // Check if we have vertical space
            if (freeY + paddedHeight > this.atlasHeight) {
                // Try to grow the atlas
                if (!this.grow()) {
                    EntityTextureAtlas.log.error(`Atlas full: cannot fit ${width}x${height} sprite (max size reached)`);
                    return null;
                }
                // After growing, retry finding/creating a slot
                return this.reserve(width, height);
            }

            slot = new Slot(freeY, this.atlasWidth, paddedHeight);
            this.slots.push(slot);
        }

        // Actual sprite position (inside the padding)
        const x = slot.x + ATLAS_PADDING;
        const y = slot.y + ATLAS_PADDING;

        // Compute normalized UV coordinates with half-pixel inset to prevent bleeding
        const halfPixelU = 0.5 / this.atlasWidth;
        const halfPixelV = 0.5 / this.atlasHeight;
        const u0 = x / this.atlasWidth + halfPixelU;
        const v0 = y / this.atlasHeight + halfPixelV;
        const u1 = (x + width) / this.atlasWidth - halfPixelU;
        const v1 = (y + height) / this.atlasHeight - halfPixelV;

        slot.increase(paddedWidth);

        const region = { x, y, width, height, u0, v0, u1, v1 };
        this.reservedRegions.push(region);
        return region;
    }

    /**
     * Grow the atlas to double its current size (up to maxSize).
     * Copies existing pixel data and updates all reserved region UVs.
     * Returns true if growth succeeded, false if already at max size.
     */
    private grow(): boolean {
        const start = performance.now();
        const newSize = this.atlasWidth * 2;
        if (newSize > this.maxSize) {
            return false;
        }

        EntityTextureAtlas.log.debug(`Growing atlas from ${this.atlasWidth} to ${newSize}`);

        const byteLength = newSize * newSize * 4;
        const newData = new Uint8Array(byteLength);

        this.fillTransparent(newData, newSize * newSize);

        // Copy existing data row by row
        const oldWidth = this.atlasWidth;
        const oldHeight = this.atlasHeight;
        for (let y = 0; y < oldHeight; y++) {
            const srcStart = y * oldWidth * 4;
            const srcEnd = srcStart + oldWidth * 4;
            const dstStart = y * newSize * 4;
            newData.set(this.imgData.subarray(srcStart, srcEnd), dstStart);
        }

        // Update atlas dimensions
        this.atlasWidth = newSize;
        this.atlasHeight = newSize;
        this.imgData = newData;

        // Update slot widths
        for (const slot of this.slots) {
            slot.width = newSize;
        }

        // Update all reserved region UVs (pixel positions stay the same)
        for (const region of this.reservedRegions) {
            const halfPixelU = 0.5 / this.atlasWidth;
            const halfPixelV = 0.5 / this.atlasHeight;
            region.u0 = region.x / this.atlasWidth + halfPixelU;
            region.v0 = region.y / this.atlasHeight + halfPixelV;
            region.u1 = (region.x + region.width) / this.atlasWidth - halfPixelU;
            region.v1 = (region.y + region.height) / this.atlasHeight - halfPixelV;
        }

        const elapsed = performance.now() - start;
        console.warn(`[Atlas] grow ${this.atlasWidth/2} -> ${newSize} took ${elapsed.toFixed(1)}ms (${this.reservedRegions.length} regions)`);

        return true;
    }

    /**
     * Copy sprite pixel data into a reserved region of the atlas.
     * The ImageData must match the region dimensions.
     * Uses row-based copying for better performance.
     */
    public blit(region: AtlasRegion, imageData: ImageData): void {
        if (imageData.width !== region.width || imageData.height !== region.height) {
            EntityTextureAtlas.log.error(
                `Blit size mismatch: region ${region.width}x${region.height}, ` +
                `image ${imageData.width}x${imageData.height}`
            );
            return;
        }

        const start = performance.now();

        const src = imageData.data;
        const dst = this.imgData;
        const atlasW = this.atlasWidth;
        const rowBytes = region.width * 4;

        // Use row-based copying with TypedArray.set() for better performance
        for (let y = 0; y < region.height; y++) {
            const srcRowStart = y * rowBytes;
            const dstRowStart = ((region.y + y) * atlasW + region.x) * 4;

            // Copy entire row at once using subarray view
            dst.set(
                src.subarray(srcRowStart, srcRowStart + rowBytes),
                dstRowStart
            );
        }

        const elapsed = performance.now() - start;
        if (elapsed > SLOW_OP_THRESHOLD_MS) {
            console.warn(`[Atlas] blit ${region.width}x${region.height} took ${elapsed.toFixed(1)}ms`);
        }
    }

    /**
     * Upload the atlas to the GPU as an RGBA8 texture.
     * Uses NEAREST filtering to preserve pixel-art style.
     */
    public load(gl: WebGL2RenderingContext): void {
        // Calculate utilization before upload
        const usedHeight = this.slots.length > 0 ? this.slots[this.slots.length - 1].bottom : 0;
        const utilization = (usedHeight / this.atlasHeight * 100).toFixed(1);
        const memoryMB = (this.atlasWidth * this.atlasHeight * 4 / 1024 / 1024).toFixed(1);

        EntityTextureAtlas.log.debug(
            `Atlas final: ${this.atlasWidth}x${this.atlasHeight} (${memoryMB}MB), ` +
            `${this.reservedRegions.length} sprites, ${utilization}% height used`
        );

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
