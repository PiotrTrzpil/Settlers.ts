import { LogHandler } from '@/utilities/log-handler';
import { ShaderTexture } from './shader-texture';
import type { CachedSlot } from './sprite-cache';

/**
 * Padding in pixels around each sprite to prevent texture bleeding
 * when sampling near edges with bilinear filtering.
 */
const ATLAS_PADDING = 1;

/** Log slow main-thread operations (threshold in ms) */
const SLOW_OP_THRESHOLD_MS = 20;

/** Fixed layer size — each layer is LAYER_SIZE x LAYER_SIZE pixels.
 *  4096x4096 = 32MB per layer at 2 bytes/pixel (R16UI). */
export const LAYER_SIZE = 4096;

/**
 * Minimum initial GPU texture capacity (layers).
 * Avoids frequent early reallocs when the atlas is being populated.
 * With doubling growth: 8 → 16 → 32 → ... so a typical 15-layer atlas
 * triggers at most 2 reallocs instead of 15.
 */
const MIN_GPU_CAPACITY = 8;

/**
 * Defines a region within the texture atlas, with both pixel coordinates,
 * a layer index, and normalized UV coordinates for shader use.
 */
export interface AtlasRegion {
    /** Pixel X position in layer */
    x: number;
    /** Pixel Y position in layer */
    y: number;
    /** Region width in pixels */
    width: number;
    /** Region height in pixels */
    height: number;
    /** Layer index in the texture array */
    layer: number;
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
 * Internal slot for row-based packing within a single layer.
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

/** Dirty rectangle for per-layer tracking */
interface DirtyRect {
    minX: number;
    minY: number;
    maxX: number;
    maxY: number;
}

/**
 * R16UI palettized texture array atlas for entity sprites (buildings, units).
 * Uses TEXTURE_2D_ARRAY with fixed-size layers instead of a growable single texture.
 *
 * Each layer is LAYER_SIZE x LAYER_SIZE (4096x4096 = 32MB at 2 bytes/pixel).
 * When a layer fills up, a new layer is added — no expensive grow/copy/UV-update.
 *
 * Each pixel stores a 16-bit unsigned integer palette index.
 * Special indices: 0 = transparent, 1 = shadow.
 * All other indices are looked up in a separate palette texture.
 */
export class EntityTextureAtlas extends ShaderTexture {
    private static log = new LogHandler('EntityTextureAtlas');

    /** Per-layer pixel data (Uint16Array of LAYER_SIZE*LAYER_SIZE each) */
    private layers: Uint16Array[] = [];

    /** Per-layer slot packing state */
    private layerSlots: Slot[][] = [];

    /** Per-layer dirty region tracking */
    private dirtyRegions: (DirtyRect | null)[] = [];

    /** Track all reserved regions (for cache serialization) */
    private reservedRegions: AtlasRegion[] = [];

    /** Maximum number of layers (bounded by MAX_ARRAY_TEXTURE_LAYERS) */
    private maxLayers: number;

    /** Cached GL context for GPU operations */
    private glContext: WebGL2RenderingContext | null = null;

    /**
     * Number of layers allocated on the GPU texture (may exceed layers.length).
     * When layers.length exceeds this, texImage3D reallocation is needed.
     * Grows with a doubling strategy to minimize expensive reallocs.
     */
    private gpuCapacity = 0;

    constructor(maxLayers: number, textureIndex: number, skipInitialLayer = false) {
        super(textureIndex);
        this.maxLayers = maxLayers;

        if (!skipInitialLayer) {
            // Start with one layer (skip when restoring from cache)
            this.addLayer();
        }
    }

    public get width(): number {
        return LAYER_SIZE;
    }

    public get height(): number {
        return LAYER_SIZE;
    }

    public get layerCount(): number {
        return this.layers.length;
    }

    /** Add a new empty layer. Returns the layer index. */
    private addLayer(): number {
        const layerIndex = this.layers.length;
        // 2 bytes per pixel (R16UI), zero-initialized (index 0 = transparent)
        this.layers.push(new Uint16Array(LAYER_SIZE * LAYER_SIZE));
        this.layerSlots.push([]);
        this.dirtyRegions.push(null);
        return layerIndex;
    }

    /**
     * Reserve a region in the atlas for a sprite of the given dimensions.
     * Uses row-based slot packing within layers.
     * If the current layer is full, a new layer is added.
     * Returns null if maximum layers are exhausted.
     */
    public reserve(width: number, height: number): AtlasRegion | null {
        const paddedWidth = width + ATLAS_PADDING * 2;
        const paddedHeight = height + ATLAS_PADDING * 2;

        // Bucket height to improve row sharing (round up to nearest 16 pixels)
        const bucketHeight = Math.ceil(paddedHeight / 16) * 16;

        // Try to fit in the last layer first
        let layerIndex = this.layers.length - 1;
        let slots = this.layerSlots[layerIndex]!;

        // Find an existing slot with matching height and enough space
        let slot = slots.find(s => s.height === bucketHeight && s.leftSize >= paddedWidth);

        if (!slot) {
            // Need a new row — check if we have vertical space in current layer
            const freeY = slots.length > 0 ? slots[slots.length - 1]!.bottom : 0;

            if (freeY + bucketHeight > LAYER_SIZE) {
                // Current layer is full — add a new layer
                if (this.layers.length >= this.maxLayers) {
                    EntityTextureAtlas.log.error(
                        `Atlas full: max layers (${this.maxLayers}) reached, cannot fit ${width}x${height}`
                    );
                    return null;
                }

                layerIndex = this.addLayer();
                slots = this.layerSlots[layerIndex]!;

                // New layer always has space at Y=0
                slot = new Slot(0, LAYER_SIZE, bucketHeight);
                slots.push(slot);
            } else {
                slot = new Slot(freeY, LAYER_SIZE, bucketHeight);
                slots.push(slot);
            }
        }

        // Actual sprite position (inside the padding)
        const x = slot.x + ATLAS_PADDING;
        const y = slot.y + ATLAS_PADDING;

        // Compute normalized UV coordinates with half-pixel inset
        const halfPixelU = 0.5 / LAYER_SIZE;
        const halfPixelV = 0.5 / LAYER_SIZE;
        const u0 = x / LAYER_SIZE + halfPixelU;
        const v0 = y / LAYER_SIZE + halfPixelV;
        const u1 = (x + width) / LAYER_SIZE - halfPixelU;
        const v1 = (y + height) / LAYER_SIZE - halfPixelV;

        slot.increase(paddedWidth);

        const region: AtlasRegion = { x, y, width, height, layer: layerIndex, u0, v0, u1, v1 };
        this.reservedRegions.push(region);
        return region;
    }

    /**
     * Copy palette index data into a reserved region of the atlas.
     * The indices Uint16Array must have (region.width * region.height) elements.
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

        const dst = this.layers[region.layer]!;

        if (region.x === 0 && region.width === LAYER_SIZE) {
            // Rows are contiguous in the destination — single memcpy
            dst.set(indices, region.y * LAYER_SIZE);
        } else {
            // Row-by-row copy (source is contiguous, destination has stride)
            const rowLen = region.width;
            for (let y = 0; y < region.height; y++) {
                dst.set(indices.subarray(y * rowLen, y * rowLen + rowLen), (region.y + y) * LAYER_SIZE + region.x);
            }
        }

        // Expand dirty region for this layer
        this.markDirty(region.layer, region.x, region.y, region.width, region.height);

        const elapsed = performance.now() - start;
        if (elapsed > SLOW_OP_THRESHOLD_MS) {
            console.warn(
                `[Atlas] blitIndices L${region.layer} ${region.width}x${region.height} took ${elapsed.toFixed(1)}ms`
            );
        }
    }

    /** Expand the dirty region for a specific layer */
    private markDirty(layerIndex: number, x: number, y: number, w: number, h: number): void {
        const existing = this.dirtyRegions[layerIndex];
        if (!existing) {
            this.dirtyRegions[layerIndex] = {
                minX: x,
                minY: y,
                maxX: x + w,
                maxY: y + h,
            };
        } else {
            existing.minX = Math.min(existing.minX, x);
            existing.minY = Math.min(existing.minY, y);
            existing.maxX = Math.max(existing.maxX, x + w);
            existing.maxY = Math.max(existing.maxY, y + h);
        }
    }

    // =========================================================================
    // GPU Upload — capacity-based allocation with budgeted uploads
    // =========================================================================
    //
    // The GPU texture array is managed with a doubling capacity strategy:
    //   - texImage3D (realloc) only happens when layers exceed capacity
    //   - Realloc invalidates ALL GPU data, so all layers are marked fully dirty
    //   - Dirty sub-regions are uploaded via texSubImage3D (the fast, common path)
    //
    // Two upload modes:
    //   update()          — upload all dirty layers immediately (for SafeLoadBatch)
    //   uploadBudgeted()  — upload N layers per call (for per-frame draining)

    /**
     * Ensure GPU texture has capacity for all current CPU layers.
     * Uses doubling growth factor to minimize expensive texImage3D reallocs.
     *
     * Must be called with the atlas texture already bound (via bindAsArray).
     */
    private ensureCapacity(gl: WebGL2RenderingContext): void {
        if (this.layers.length <= this.gpuCapacity) return;

        const newCapacity = Math.min(
            Math.max(this.layers.length, this.gpuCapacity * 2, MIN_GPU_CAPACITY),
            this.maxLayers
        );

        gl.texImage3D(
            gl.TEXTURE_2D_ARRAY,
            0,
            gl.R16UI,
            LAYER_SIZE,
            LAYER_SIZE,
            newCapacity,
            0,
            gl.RED_INTEGER,
            gl.UNSIGNED_SHORT,
            null
        );

        const prevCapacity = this.gpuCapacity;
        this.gpuCapacity = newCapacity;

        // texImage3D invalidates all GPU data — mark every existing layer fully dirty
        for (let i = 0; i < this.layers.length; i++) {
            this.dirtyRegions[i] = { minX: 0, minY: 0, maxX: LAYER_SIZE, maxY: LAYER_SIZE };
        }

        EntityTextureAtlas.log.debug(
            `GPU realloc: ${prevCapacity} → ${newCapacity} layers ` +
                `(${this.layers.length} used, ${((newCapacity * LAYER_SIZE * LAYER_SIZE * 2) / 1024 / 1024).toFixed(0)}MB)`
        );
    }

    /** Upload a single layer's dirty sub-region to GPU. */
    private uploadDirtyLayer(gl: WebGL2RenderingContext, layerIndex: number): void {
        const dirty = this.dirtyRegions[layerIndex];
        if (!dirty) return;

        const isFullLayer =
            dirty.minX === 0 && dirty.minY === 0 && dirty.maxX === LAYER_SIZE && dirty.maxY === LAYER_SIZE;

        if (isFullLayer) {
            // Full-layer upload — no UNPACK_ROW_LENGTH needed
            gl.texSubImage3D(
                gl.TEXTURE_2D_ARRAY,
                0,
                0,
                0,
                layerIndex,
                LAYER_SIZE,
                LAYER_SIZE,
                1,
                gl.RED_INTEGER,
                gl.UNSIGNED_SHORT,
                this.layers[layerIndex]!
            );
        } else {
            // Sub-region upload
            gl.pixelStorei(gl.UNPACK_ROW_LENGTH, LAYER_SIZE);

            gl.texSubImage3D(
                gl.TEXTURE_2D_ARRAY,
                0,
                dirty.minX,
                dirty.minY,
                layerIndex,
                dirty.maxX - dirty.minX,
                dirty.maxY - dirty.minY,
                1,
                gl.RED_INTEGER,
                gl.UNSIGNED_SHORT,
                this.layers[layerIndex]!,
                dirty.minY * LAYER_SIZE + dirty.minX
            );

            gl.pixelStorei(gl.UNPACK_ROW_LENGTH, 0);
        }

        this.dirtyRegions[layerIndex] = null;
    }

    /** Bind the texture and set pixel store alignment for upload operations. */
    private prepareForUpload(gl: WebGL2RenderingContext): void {
        this.glContext = gl;
        this.bindAsArray(gl);
        gl.pixelStorei(gl.UNPACK_ALIGNMENT, 2);
        this.ensureCapacity(gl);
    }

    /**
     * Upload all dirty regions to GPU immediately.
     * Ensures capacity, then flushes every pending dirty layer.
     */
    public update(gl: WebGL2RenderingContext): void {
        this.prepareForUpload(gl);

        for (let i = 0; i < this.dirtyRegions.length; i++) {
            this.uploadDirtyLayer(gl, i);
        }
    }

    /**
     * Upload all layers from a contiguous Uint16Array in a single gl.texImage3D call.
     * Faster than update() for cache restores: one DMA transfer instead of N sub-region uploads.
     * Sets gpuCapacity to layerCount and clears all dirty flags.
     */
    public uploadContiguous(gl: WebGL2RenderingContext, data: Uint16Array, layerCount: number): void {
        this.glContext = gl;
        this.bindAsArray(gl);
        gl.pixelStorei(gl.UNPACK_ALIGNMENT, 2);
        gl.texImage3D(
            gl.TEXTURE_2D_ARRAY,
            0,
            gl.R16UI,
            LAYER_SIZE,
            LAYER_SIZE,
            layerCount,
            0,
            gl.RED_INTEGER,
            gl.UNSIGNED_SHORT,
            data
        );
        this.gpuCapacity = layerCount;
        for (let i = 0; i < this.dirtyRegions.length; i++) {
            this.dirtyRegions[i] = null;
        }
    }

    /**
     * Allocate GPU texture memory without uploading pixel data.
     * Marks all layers as fully dirty so uploadBudgeted() can drain them
     * progressively across frames. Pre-sets gpuCapacity so uploadBudgeted()
     * won't trigger a realloc (which would bypass the per-frame budget).
     */
    public allocateDeferred(gl: WebGL2RenderingContext): void {
        this.glContext = gl;
        this.bindAsArray(gl);
        gl.pixelStorei(gl.UNPACK_ALIGNMENT, 2);

        const capacity = Math.min(Math.max(this.layers.length, MIN_GPU_CAPACITY), this.maxLayers);
        gl.texImage3D(
            gl.TEXTURE_2D_ARRAY,
            0,
            gl.R16UI,
            LAYER_SIZE,
            LAYER_SIZE,
            capacity,
            0,
            gl.RED_INTEGER,
            gl.UNSIGNED_SHORT,
            null
        );
        this.gpuCapacity = capacity;

        // Mark all layers fully dirty for progressive upload
        for (let i = 0; i < this.layers.length; i++) {
            this.dirtyRegions[i] = { minX: 0, minY: 0, maxX: LAYER_SIZE, maxY: LAYER_SIZE };
        }
    }

    /**
     * Upload up to `maxLayers` dirty layers, spreading GPU work across frames.
     * Returns true if more uploads remain pending.
     *
     * Sprites on un-uploaded layers appear transparent (palette index 0)
     * until their layer is uploaded in a subsequent frame.
     *
     * If `ensureCapacity` triggers a GPU reallocation, the budget is bypassed and
     * ALL dirty layers are uploaded immediately. A realloc calls texImage3D(null)
     * which clears all existing GPU data — deferring re-upload would cause every
     * already-visible sprite to disappear until the budget fully drained.
     */
    public uploadBudgeted(gl: WebGL2RenderingContext, maxLayers: number): boolean {
        const capacityBefore = this.gpuCapacity;
        this.prepareForUpload(gl);
        const wasReallocated = this.gpuCapacity > capacityBefore;

        let uploaded = 0;
        for (let i = 0; i < this.dirtyRegions.length; i++) {
            if (!this.dirtyRegions[i]) continue;
            if (!wasReallocated && uploaded >= maxLayers) return true;
            this.uploadDirtyLayer(gl, i);
            uploaded++;
        }
        return false;
    }

    /** Whether any layers have pending GPU uploads. */
    public get hasPendingUploads(): boolean {
        for (let i = 0; i < this.dirtyRegions.length; i++) {
            if (this.dirtyRegions[i]) return true;
        }
        return false;
    }

    /**
     * Bind as TEXTURE_2D_ARRAY with full parameter setup (for upload).
     */
    private bindAsArray(gl: WebGL2RenderingContext): void {
        if (!this.texture) {
            this.texture = gl.createTexture();
        }
        gl.activeTexture(gl.TEXTURE0 + this.textureIndex);
        gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.texture);

        // R16UI requires NEAREST filtering (integer textures)
        gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    }

    /**
     * Bind the atlas texture for rendering (lightweight, no param setup).
     * Call before draw calls to ensure the atlas is on the correct texture unit.
     */
    public bindForRendering(gl: WebGL2RenderingContext): void {
        if (!this.texture) return;
        gl.activeTexture(gl.TEXTURE0 + this.textureIndex);
        gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.texture);
    }

    /**
     * Override free() since we use TEXTURE_2D_ARRAY (parent uses TEXTURE_2D).
     */
    public override free(): void {
        if (this.glContext && this.texture) {
            this.glContext.deleteTexture(this.texture);
            this.texture = null;
        }
    }

    /**
     * Upload the atlas to the GPU. Log utilization stats.
     */
    public load(gl: WebGL2RenderingContext): void {
        const totalPixels = this.layers.length * LAYER_SIZE * LAYER_SIZE;
        const memoryMB = ((totalPixels * 2) / 1024 / 1024).toFixed(1);

        EntityTextureAtlas.log.debug(
            `Atlas final: ${this.layers.length} layers @ ${LAYER_SIZE}x${LAYER_SIZE} (${memoryMB}MB), ` +
                `${this.reservedRegions.length} sprites`
        );

        this.update(gl);
    }

    /**
     * Fill the first layer with a procedural pattern for testing/fallback.
     */
    public fillProceduralPattern(): void {
        const layer = this.layers[0]!;
        for (let y = 0; y < LAYER_SIZE; y++) {
            for (let x = 0; x < LAYER_SIZE; x++) {
                const idx = y * LAYER_SIZE + x;
                const checker = ((x >> 4) + (y >> 4)) % 2;
                layer[idx] = checker ? 3 : 2;
            }
        }
        this.markDirty(0, 0, 0, LAYER_SIZE, LAYER_SIZE);
    }

    /**
     * Extract a region from the atlas and convert from palette indices to RGBA ImageData.
     * Used for generating icon thumbnails (e.g. resource icons in UI).
     */
    public extractRegion(region: AtlasRegion, paletteData?: Uint8Array, paletteBaseOffset = 0): ImageData | null {
        if (region.layer >= this.layers.length) return null;
        if (region.x + region.width > LAYER_SIZE || region.y + region.height > LAYER_SIZE) {
            return null;
        }

        const layer = this.layers[region.layer]!;
        const imageData = new ImageData(region.width, region.height);
        const dst = new Uint32Array(imageData.data.buffer);

        for (let y = 0; y < region.height; y++) {
            const srcRow = (region.y + y) * LAYER_SIZE + region.x;
            const dstRow = y * region.width;

            for (let x = 0; x < region.width; x++) {
                dst[dstRow + x] = this.resolvePixel(layer[srcRow + x]!, paletteData, paletteBaseOffset);
            }
        }

        return imageData;
    }

    /** Resolve a single atlas pixel index to an RGBA uint32 value. */
    private resolvePixel(rawIndex: number, paletteData: Uint8Array | undefined, paletteBaseOffset: number): number {
        if (rawIndex === 0) return 0x00000000; // transparent
        if (rawIndex === 1) return 0x40000000; // shadow

        const index = rawIndex + paletteBaseOffset;
        if (paletteData && index * 4 + 3 < paletteData.length) {
            const pi = index * 4;
            const r = paletteData[pi]!;
            const g = paletteData[pi + 1]!;
            const b = paletteData[pi + 2]!;
            const a = paletteData[pi + 3]!;
            return (a << 24) | (b << 16) | (g << 8) | r;
        }
        return 0xffff00ff; // magenta for missing palette
    }

    /**
     * Get per-layer ArrayBuffers for cache serialization.
     * Each buffer is exactly LAYER_SIZE*LAYER_SIZE*2 bytes.
     * Returns owned copies so the atlas can be modified independently.
     */
    public getLayerBuffers(): ArrayBuffer[] {
        return this.layers.map(layer => {
            const buf = layer.buffer as ArrayBuffer;
            if (layer.byteOffset === 0 && layer.byteLength === buf.byteLength) {
                return buf;
            }
            // Layer is a subarray view — slice to get an owned copy
            return buf.slice(layer.byteOffset, layer.byteOffset + layer.byteLength);
        });
    }

    /**
     * Get the slot layout for caching (per-layer).
     */
    public getSlots(): CachedSlot[][] {
        return this.layerSlots.map(slots =>
            slots.map(s => ({
                x: s.x,
                y: s.y,
                width: s.width,
                height: s.height,
            }))
        );
    }

    /**
     * Get the maximum layer count for caching.
     */
    public getMaxLayers(): number {
        return this.maxLayers;
    }

    /**
     * Restore atlas state from per-layer buffers.
     * Each ArrayBuffer is exactly LAYER_SIZE*LAYER_SIZE*2 bytes (one layer's pixel data).
     */
    public restoreFromCache(layerBuffers: ArrayBuffer[], layerCount: number, slots: CachedSlot[][]): void {
        const start = performance.now();

        this.layers = [];
        this.layerSlots = [];
        this.dirtyRegions = [];

        for (let i = 0; i < layerCount; i++) {
            // Wrap each buffer as Uint16Array — zero-copy (each buffer is already layer-sized)
            this.layers.push(new Uint16Array(layerBuffers[i]!));

            // Restore slots for this layer
            const layerSlotData = slots[i] || [];
            this.layerSlots.push(
                layerSlotData.map(s => {
                    const slot = new Slot(s.y, s.width, s.height);
                    slot.x = s.x;
                    return slot;
                })
            );

            this.dirtyRegions.push(null);
        }

        // Clear reserved regions - they'll be repopulated via registry
        this.reservedRegions = [];

        // Reset GPU capacity to force reallocation on next upload
        this.gpuCapacity = 0;

        const elapsed = performance.now() - start;
        EntityTextureAtlas.log.debug(`Restored atlas from cache: ${layerCount} layers in ${elapsed.toFixed(1)}ms`);
    }

    /**
     * Create a new atlas instance restored from per-layer buffers.
     */
    public static fromCache(
        layerBuffers: ArrayBuffer[],
        layerCount: number,
        maxLayers: number,
        slots: CachedSlot[][],
        textureUnit: number
    ): EntityTextureAtlas {
        const atlas = new EntityTextureAtlas(maxLayers, textureUnit, true);
        atlas.restoreFromCache(layerBuffers, layerCount, slots);
        return atlas;
    }
}
