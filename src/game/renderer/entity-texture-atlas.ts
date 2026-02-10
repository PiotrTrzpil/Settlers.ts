import { LogHandler } from '@/utilities/log-handler';
import { ShaderTexture } from './shader-texture';
import type { CachedSlot } from './sprite-atlas-cache';

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

/** Maximum atlas size (32768x32768 = 2GB at 2 bytes/pixel) - increased to fit all tree textures */
const MAX_ATLAS_SIZE = 32768;

/** Initial atlas size - start at 8192 to avoid expensive grow operations during loading.
 * 8192x8192 = 128MB at 2 bytes/pixel (R16UI), acceptable for modern systems. */
const INITIAL_ATLAS_SIZE = 8192;

/**
 * R16UI palettized texture atlas for entity sprites (buildings, units).
 * Uses slot-based row packing similar to TextureMap16Bit.
 *
 * Each pixel stores a 16-bit unsigned integer palette index.
 * Special indices: 0 = transparent, 1 = shadow.
 * All other indices are looked up in a separate palette texture.
 *
 * Memory: 2 bytes/pixel (vs 4 bytes/pixel for RGBA8) = 2x savings.
 *
 * The atlas starts small and grows automatically when full,
 * reducing initial memory allocation.
 */
export class EntityTextureAtlas extends ShaderTexture {
    private static log = new LogHandler('EntityTextureAtlas');

    private imgData: Uint16Array;
    private atlasWidth: number;
    private atlasHeight: number;
    private slots: Slot[] = [];

    /** Track all reserved regions so we can update UVs when growing */
    private reservedRegions: AtlasRegion[] = [];

    /** Maximum size this atlas can grow to */
    private maxSize: number;

    /** Cached GL context for immediate GPU upload on grow */
    private glContext: WebGL2RenderingContext | null = null;

    /** Dirty region tracking — only upload changed pixels to GPU */
    private dirtyMinX = 0;
    private dirtyMinY = 0;
    private dirtyMaxX = 0;
    private dirtyMaxY = 0;
    private hasDirtyRegion = false;

    constructor(maxSize: number, textureIndex: number) {
        super(textureIndex);

        this.maxSize = Math.min(maxSize, MAX_ATLAS_SIZE);

        // Start with small initial size
        const initialSize = Math.min(INITIAL_ATLAS_SIZE, this.maxSize);
        this.atlasWidth = initialSize;
        this.atlasHeight = initialSize;

        // 2 bytes per pixel (R16UI) — one Uint16 per pixel
        this.imgData = new Uint16Array(initialSize * initialSize);

        // Index 0 = transparent by default (Uint16Array is zero-initialized)
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

        // Bucket height to improve row sharing (reduces waste from slight height variations)
        // Round up to nearest 16 pixels
        const bucketHeight = Math.ceil(paddedHeight / 16) * 16;

        // Find an existing slot with matching bucketed height and enough space
        let slot = this.slots.find(s => s.height === bucketHeight && s.leftSize >= paddedWidth);

        if (!slot) {
            // Need to create a new slot (row)
            const freeY = this.slots.length > 0 ? this.slots[this.slots.length - 1].bottom : 0;

            // Check if we have vertical space (using bucketHeight)
            if (freeY + bucketHeight > this.atlasHeight) {
                // Try to grow the atlas
                if (!this.grow()) {
                    EntityTextureAtlas.log.error(`Atlas full: cannot fit ${width}x${height} sprite (max size reached or alloc failed)`);
                    return null;
                }
                // After growing, retry finding/creating a slot
                return this.reserve(width, height);
            }

            slot = new Slot(freeY, this.atlasWidth, bucketHeight);
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

        // 1 Uint16 per pixel
        const pixelCount = newSize * newSize;
        let newData: Uint16Array;
        try {
            newData = new Uint16Array(pixelCount);
        } catch (e) {
            EntityTextureAtlas.log.error(`Failed to allocate atlas memory ${newSize}x${newSize} (${pixelCount * 2} bytes): ${e}`);
            return false;
        }

        // New data is zero-initialized (index 0 = transparent) — no fill needed

        // Copy existing data row by row
        const oldWidth = this.atlasWidth;
        const oldHeight = this.atlasHeight;
        for (let y = 0; y < oldHeight; y++) {
            const srcStart = y * oldWidth;
            const srcEnd = srcStart + oldWidth;
            const dstStart = y * newSize;
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

        // CRITICAL: Immediately upload to GPU to prevent rendering with
        // mismatched UVs (new size) vs GPU texture (old size)
        if (this.glContext) {
            this.update(this.glContext);
        }

        const elapsed = performance.now() - start;
        console.warn(`[Atlas] grow ${this.atlasWidth / 2} -> ${newSize} took ${elapsed.toFixed(1)}ms (${this.reservedRegions.length} regions)`);

        return true;
    }

    /**
     * Copy palette index data into a reserved region of the atlas.
     * The indices Uint16Array must have (region.width * region.height) elements.
     * Uses row-based copying for better performance.
     */
    public blitIndices(region: AtlasRegion, indices: Uint16Array): void {
        if (indices.length !== region.width * region.height) {
            EntityTextureAtlas.log.error(
                `Blit size mismatch: region ${region.width}x${region.height} (${region.width * region.height} pixels), ` +
                `indices length ${indices.length}`
            );
            return;
        }

        const start = performance.now();

        const dst = this.imgData;
        const atlasW = this.atlasWidth;
        const rowLen = region.width; // Elements per row (Uint16)

        for (let y = 0; y < region.height; y++) {
            const srcRowStart = y * rowLen;
            const dstRowStart = (region.y + y) * atlasW + region.x;
            dst.set(indices.subarray(srcRowStart, srcRowStart + rowLen), dstRowStart);
        }

        // Expand dirty region to include this blit
        this.markDirty(region.x, region.y, region.width, region.height);

        const elapsed = performance.now() - start;
        if (elapsed > SLOW_OP_THRESHOLD_MS) {
            console.warn(`[Atlas] blitIndices ${region.width}x${region.height} took ${elapsed.toFixed(1)}ms`);
        }
    }

    /** Expand the dirty region to include the given rectangle */
    private markDirty(x: number, y: number, w: number, h: number): void {
        if (!this.hasDirtyRegion) {
            this.dirtyMinX = x;
            this.dirtyMinY = y;
            this.dirtyMaxX = x + w;
            this.dirtyMaxY = y + h;
            this.hasDirtyRegion = true;
        } else {
            this.dirtyMinX = Math.min(this.dirtyMinX, x);
            this.dirtyMinY = Math.min(this.dirtyMinY, y);
            this.dirtyMaxX = Math.max(this.dirtyMaxX, x + w);
            this.dirtyMaxY = Math.max(this.dirtyMaxY, y + h);
        }
    }

    private gpuWidth = 0;
    private gpuHeight = 0;

    /**
     * Update the atlas texture on the GPU.
     * Uses dirty-region tracking to only upload changed pixels,
     * reducing GPU transfer from full atlas (128MB+) to just the modified rectangle.
     * Uses R16UI format (unsigned 16-bit integer per pixel).
     */
    public update(gl: WebGL2RenderingContext): void {
        // Cache GL context for immediate upload on grow
        this.glContext = gl;
        super.bind(gl);

        // R16UI requires integer sampling — override filter settings
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);

        gl.pixelStorei(gl.UNPACK_ALIGNMENT, 2);

        // If size changed or not yet uploaded, do full upload
        if (this.atlasWidth !== this.gpuWidth || this.atlasHeight !== this.gpuHeight) {
            gl.texImage2D(
                gl.TEXTURE_2D,
                0,
                gl.R16UI,
                this.atlasWidth,
                this.atlasHeight,
                0,
                gl.RED_INTEGER,
                gl.UNSIGNED_SHORT,
                this.imgData
            );
            this.gpuWidth = this.atlasWidth;
            this.gpuHeight = this.atlasHeight;
            // Full upload covers everything — clear dirty region
            this.hasDirtyRegion = false;
        } else if (this.hasDirtyRegion) {
            // Only upload the dirty sub-rectangle
            const dirtyW = this.dirtyMaxX - this.dirtyMinX;
            const dirtyH = this.dirtyMaxY - this.dirtyMinY;

            // Use UNPACK_ROW_LENGTH to read a sub-rectangle from the full-width buffer
            gl.pixelStorei(gl.UNPACK_ROW_LENGTH, this.atlasWidth);
            const srcOffset = this.dirtyMinY * this.atlasWidth + this.dirtyMinX;

            gl.texSubImage2D(
                gl.TEXTURE_2D,
                0,
                this.dirtyMinX,      // xoffset in texture
                this.dirtyMinY,      // yoffset in texture
                dirtyW,              // width of sub-rectangle
                dirtyH,              // height of sub-rectangle
                gl.RED_INTEGER,
                gl.UNSIGNED_SHORT,
                this.imgData,
                srcOffset            // element offset into source array
            );

            gl.pixelStorei(gl.UNPACK_ROW_LENGTH, 0);
            this.hasDirtyRegion = false;
        }
        // else: no changes, skip upload entirely
    }

    /**
     * Upload the atlas to the GPU as an R16UI texture.
     * Uses NEAREST filtering (required for integer textures).
     */
    public load(gl: WebGL2RenderingContext): void {
        // Calculate utilization before upload
        const usedHeight = this.slots.length > 0 ? this.slots[this.slots.length - 1].bottom : 0;
        const utilization = (usedHeight / this.atlasHeight * 100).toFixed(1);
        const memoryMB = (this.atlasWidth * this.atlasHeight * 2 / 1024 / 1024).toFixed(1);

        EntityTextureAtlas.log.debug(
            `Atlas final: ${this.atlasWidth}x${this.atlasHeight} (${memoryMB}MB), ` +
            `${this.reservedRegions.length} sprites, ${utilization}% height used`
        );

        this.update(gl);
    }

    /**
     * Fill the atlas with a procedural pattern for testing/fallback.
     * Creates a visible checkerboard pattern using index values.
     */
    public fillProceduralPattern(): void {
        const size = this.atlasWidth;
        for (let y = 0; y < size; y++) {
            for (let x = 0; x < size; x++) {
                const idx = y * size + x;
                const checker = ((x >> 4) + (y >> 4)) % 2;
                // Use index 2 and 3 as checkerboard values
                this.imgData[idx] = checker ? 3 : 2;
            }
        }
        this.markDirty(0, 0, size, size);
    }

    /**
     * Extract a region from the atlas and convert from palette indices to RGBA ImageData.
     * Used for generating icon thumbnails (e.g. resource icons in UI).
     *
     * @param region The atlas region to extract
     * @param paletteData Combined palette data (Uint8Array, 4 bytes per color RGBA)
     * @returns ImageData with resolved RGBA pixels, or null if region is invalid
     */
    public extractRegion(region: AtlasRegion, paletteData?: Uint8Array): ImageData | null {
        if (region.x + region.width > this.atlasWidth || region.y + region.height > this.atlasHeight) {
            return null;
        }

        const imageData = new ImageData(region.width, region.height);
        const dst = new Uint32Array(imageData.data.buffer);

        for (let y = 0; y < region.height; y++) {
            const srcRow = (region.y + y) * this.atlasWidth + region.x;
            const dstRow = y * region.width;

            for (let x = 0; x < region.width; x++) {
                const index = this.imgData[srcRow + x];

                if (index === 0) {
                    dst[dstRow + x] = 0x00000000; // transparent
                } else if (index === 1) {
                    dst[dstRow + x] = 0x40000000; // shadow
                } else if (paletteData && index * 4 + 3 < paletteData.length) {
                    const pi = index * 4;
                    const r = paletteData[pi];
                    const g = paletteData[pi + 1];
                    const b = paletteData[pi + 2];
                    const a = paletteData[pi + 3];
                    dst[dstRow + x] = (a << 24) | (b << 16) | (g << 8) | r;
                } else {
                    dst[dstRow + x] = 0xFFFF00FF; // magenta for missing palette
                }
            }
        }

        return imageData;
    }

    /**
     * Get the raw image data for caching (Uint16Array).
     */
    public getImageData(): Uint16Array {
        return this.imgData;
    }

    /**
     * Get the raw image data as bytes for serialization (cache).
     */
    public getImageDataBytes(): Uint8Array {
        return new Uint8Array(this.imgData.buffer, this.imgData.byteOffset, this.imgData.byteLength);
    }

    /**
     * Get the slot layout for caching.
     */
    public getSlots(): CachedSlot[] {
        return this.slots.map(s => ({
            x: s.x,
            y: s.y,
            width: s.width,
            height: s.height,
        }));
    }

    /**
     * Get the maximum size for caching.
     */
    public getMaxSize(): number {
        return this.maxSize;
    }

    /**
     * Restore atlas state from cached data.
     * This allows skipping sprite decoding on HMR by restoring
     * previously decoded atlas data.
     *
     * @param imgData Raw Uint16Array pixel data (palette indices)
     * @param width Atlas width
     * @param height Atlas height
     * @param slots Slot layout for row-based packing
     */
    public restoreFromCache(
        imgData: Uint16Array,
        width: number,
        height: number,
        slots: CachedSlot[]
    ): void {
        const start = performance.now();

        this.imgData = imgData;
        this.atlasWidth = width;
        this.atlasHeight = height;

        // Restore slots
        this.slots = slots.map(s => {
            const slot = new Slot(s.y, s.width, s.height);
            slot.x = s.x;
            return slot;
        });

        // Clear reserved regions - they'll be repopulated via registry
        this.reservedRegions = [];

        // Reset GPU state to force full re-upload
        this.gpuWidth = 0;
        this.gpuHeight = 0;
        this.hasDirtyRegion = false;

        const elapsed = performance.now() - start;
        EntityTextureAtlas.log.debug(
            `Restored atlas from cache: ${width}x${height} in ${elapsed.toFixed(1)}ms`
        );
    }

    /**
     * Create a new atlas instance restored from cached data.
     * Static factory method for cleaner cache restoration.
     */
    public static fromCache(
        imgData: Uint16Array,
        width: number,
        height: number,
        maxSize: number,
        slots: CachedSlot[],
        textureUnit: number
    ): EntityTextureAtlas {
        const atlas = new EntityTextureAtlas(maxSize, textureUnit);
        atlas.restoreFromCache(imgData, width, height, slots);
        return atlas;
    }
}
