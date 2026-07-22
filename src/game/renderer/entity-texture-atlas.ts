import { LogHandler } from '@/utilities/log-handler';
import { ShaderTexture } from './shader-texture';
import type { CachedSlot } from './sprite-cache';
import { LAYER_SIZE } from './entity-texture-atlas-constants';
import { AtlasGpuStore } from './atlas-gpu-store';
import { extractAtlasRegion } from './atlas-region-extract';

export { LAYER_SIZE, LAYER_BYTES, MAX_LAYERS_PER_GPU_ARRAY, MAX_GPU_ARRAYS } from './entity-texture-atlas-constants';
export { gpuArrayIndexForLayer, localLayerIndex, requiredGpuArrayCount, nextGpuArrayCapacity } from './atlas-gpu-store';

/**
 * Padding in pixels around each sprite to prevent texture bleeding
 * when sampling near edges with bilinear filtering.
 */
const ATLAS_PADDING = 1;

/** Log slow main-thread operations (threshold in ms) */
const SLOW_OP_THRESHOLD_MS = 20;

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

    /** Fast flag — true when any layer has pending GPU uploads (avoids linear scan) */
    private _hasPendingUploads = false;

    /** Track all reserved regions (for cache serialization) */
    private reservedRegions: AtlasRegion[] = [];

    /** Maximum number of layers (bounded by MAX_ARRAY_TEXTURE_LAYERS) */
    private maxLayers: number;

    /** Cached GL context for GPU operations */
    private glContext: WebGL2RenderingContext | null = null;

    /** Multi-array GPU storage (splits at 1 GiB / 32 layers for ANGLE Metal). */
    private readonly gpuStore: AtlasGpuStore;

    constructor(maxLayers: number, textureIndex: number, skipInitialLayer = false) {
        super(textureIndex);
        this.maxLayers = maxLayers;
        this.gpuStore = new AtlasGpuStore(textureIndex);

        if (!skipInitialLayer) {
            // Start with one layer (skip when restoring from cache)
            this.addLayer();
        }
    }

    /** Total GPU layer capacity across all arrays (debug / tests). */
    public get gpuCapacity(): number {
        return this.gpuStore.totalCapacity;
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

    /**
     * Cyclically shift pixels within a reserved region by (dx, dy).
     * Pixels that move past one edge wrap around to the opposite edge.
     */
    public cyclicShiftRegion(region: AtlasRegion, dx: number, dy: number): void {
        if (dx === 0 && dy === 0) {
            return;
        }

        const { width: w, height: h } = region;
        const layer = this.layers[region.layer]!;

        // Read the region into a temporary buffer
        const tmp = new Uint16Array(w * h);
        for (let y = 0; y < h; y++) {
            const srcRow = (region.y + y) * LAYER_SIZE + region.x;
            tmp.set(layer.subarray(srcRow, srcRow + w), y * w);
        }

        // Write back with cyclic shift
        for (let y = 0; y < h; y++) {
            const srcY = (((y - dy) % h) + h) % h;
            for (let x = 0; x < w; x++) {
                const srcX = (((x - dx) % w) + w) % w;
                layer[(region.y + y) * LAYER_SIZE + region.x + x] = tmp[srcY * w + srcX]!;
            }
        }

        this.markDirty(region.layer, region.x, region.y, w, h);
    }

    /** Expand the dirty region for a specific layer */
    private markDirty(layerIndex: number, x: number, y: number, w: number, h: number): void {
        this._hasPendingUploads = true;
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
    // GPU Upload — multi-array capacity with budgeted uploads
    // =========================================================================
    //
    // ANGLE Metal rejects a single TEXTURE_2D_ARRAY larger than ~1 GiB (32 layers
    // of 4096² R16UI). AtlasGpuStore splits layers across multiple arrays.
    //
    // Two upload modes:
    //   update()          — upload all dirty layers immediately (for SafeLoadBatch)
    //   uploadBudgeted()  — upload N layers per call (for per-frame draining)

    /** Ensure GPU arrays hold all CPU layers; mark invalidated layers fully dirty. */
    private ensureCapacity(gl: WebGL2RenderingContext): boolean {
        const capacityBefore = this.gpuStore.totalCapacity;
        const invalidated = this.gpuStore.ensureCapacity(gl, this.layers.length);
        for (const layer of invalidated) {
            if (layer < this.layers.length) {
                this.dirtyRegions[layer] = { minX: 0, minY: 0, maxX: LAYER_SIZE, maxY: LAYER_SIZE };
            }
        }
        if (invalidated.length > 0) {
            this._hasPendingUploads = true;
        }
        return this.gpuStore.totalCapacity > capacityBefore;
    }

    /** Upload a single layer's dirty sub-region to GPU. */
    private uploadDirtyLayer(gl: WebGL2RenderingContext, layerIndex: number): void {
        const dirty = this.dirtyRegions[layerIndex];
        if (!dirty) {
            return;
        }
        this.gpuStore.uploadDirtyLayer(gl, layerIndex, this.layers[layerIndex]!, dirty);
        this.dirtyRegions[layerIndex] = null;
    }

    private prepareForUpload(gl: WebGL2RenderingContext): boolean {
        this.glContext = gl;
        gl.pixelStorei(gl.UNPACK_ALIGNMENT, 2);
        return this.ensureCapacity(gl);
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
        this._hasPendingUploads = false;
    }

    /**
     * Allocate GPU texture memory without uploading pixel data.
     * Marks all layers as fully dirty so uploadBudgeted() can drain them
     * progressively across frames.
     */
    public allocateDeferred(gl: WebGL2RenderingContext): void {
        this.glContext = gl;
        gl.pixelStorei(gl.UNPACK_ALIGNMENT, 2);
        this.gpuStore.allocateExact(gl, this.layers.length);

        for (let i = 0; i < this.layers.length; i++) {
            this.dirtyRegions[i] = { minX: 0, minY: 0, maxX: LAYER_SIZE, maxY: LAYER_SIZE };
        }
        if (this.layers.length > 0) {
            this._hasPendingUploads = true;
        }
    }

    /**
     * Upload up to `maxLayers` dirty layers, spreading GPU work across frames.
     * Returns true if more uploads remain pending.
     *
     * If ensureCapacity reallocates any GPU array, the budget is bypassed and
     * ALL dirty layers are uploaded (realloc clears that array's GPU data).
     */
    public uploadBudgeted(gl: WebGL2RenderingContext, maxLayers: number): boolean {
        const wasReallocated = this.prepareForUpload(gl);

        let uploaded = 0;
        let remaining = false;
        for (let i = 0; i < this.dirtyRegions.length; i++) {
            if (!this.dirtyRegions[i]) {
                continue;
            }
            if (!wasReallocated && uploaded >= maxLayers) {
                remaining = true;
                break;
            }
            this.uploadDirtyLayer(gl, i);
            uploaded++;
        }
        this._hasPendingUploads = remaining;
        return remaining;
    }

    /** Whether any layers have pending GPU uploads. */
    public get hasPendingUploads(): boolean {
        return this._hasPendingUploads;
    }

    /** Whether a specific layer's data has been uploaded to GPU (no pending dirty region). */
    public isLayerUploaded(layer: number): boolean {
        return !this.dirtyRegions[layer];
    }

    /**
     * Bind all atlas GPU arrays for rendering (multi-sampler fragment shaders).
     */
    public bindForRendering(gl: WebGL2RenderingContext): void {
        this.gpuStore.bindForRendering(gl);
    }

    /** Layers per GPU array — shaders use this to map global layer → local layer. */
    public get layersPerGpuArray(): number {
        return this.gpuStore.maxLayersPerArray;
    }

    /**
     * Override free() — multi-array GPU store owns TEXTURE_2D_ARRAY objects.
     */
    public override free(): void {
        this.gpuStore.free();
        this.texture = null;
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
     * Extract a region from the atlas and convert from palette indices to RGBA ImageData.
     * Used for generating icon thumbnails (e.g. resource icons in UI).
     */
    public extractRegion(
        region: AtlasRegion,
        paletteData?: Uint8Array | null,
        paletteBaseOffset = 0
    ): ImageData | null {
        return extractAtlasRegion(this.layers, region, paletteData, paletteBaseOffset);
    }

    /** Per-layer ArrayBuffers for cache serialization (LAYER_SIZE²×2 bytes each). */
    public getLayerBuffers(): ArrayBuffer[] {
        return this.layers.map(layer => {
            const buf = layer.buffer as ArrayBuffer;
            if (layer.byteOffset === 0 && layer.byteLength === buf.byteLength) {
                return buf;
            }
            return buf.slice(layer.byteOffset, layer.byteOffset + layer.byteLength);
        });
    }

    /** Slot layout for caching (per-layer). */
    public getSlots(): CachedSlot[][] {
        return this.layerSlots.map(slots => slots.map(s => ({ x: s.x, y: s.y, width: s.width, height: s.height })));
    }

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

        // Drop GPU textures — reallocated on next allocateDeferred/update
        this.gpuStore.resetCapacities();

        const elapsed = performance.now() - start;
        EntityTextureAtlas.log.debug(`Restored atlas from cache: ${layerCount} layers in ${elapsed.toFixed(1)}ms`);
    }

    /**
     * Create an atlas shell with empty (zero-filled) layers for progressive streaming.
     * Layers are allocated at full size but contain no pixel data.
     * Use setLayerData() to populate individual layers as they arrive.
     */
    public static fromCacheShell(
        layerCount: number,
        maxLayers: number,
        slots: CachedSlot[][],
        textureUnit: number
    ): EntityTextureAtlas {
        const atlas = new EntityTextureAtlas(maxLayers, textureUnit, true);
        atlas.layers = [];
        atlas.layerSlots = [];
        atlas.dirtyRegions = [];
        atlas.reservedRegions = [];
        atlas.gpuStore.resetCapacities();

        for (let i = 0; i < layerCount; i++) {
            // Zero-filled layer — sprites appear transparent until real data arrives
            atlas.layers.push(new Uint16Array(LAYER_SIZE * LAYER_SIZE));
            const layerSlotData = slots[i] || [];
            atlas.layerSlots.push(
                layerSlotData.map(s => {
                    const slot = new Slot(s.y, s.width, s.height);
                    slot.x = s.x;
                    return slot;
                })
            );
            atlas.dirtyRegions.push(null);
        }
        return atlas;
    }

    /**
     * Set a single layer's pixel data from a cache buffer.
     * Marks the layer fully dirty so it will be uploaded to GPU on next uploadBudgeted().
     */
    public setLayerData(layerIndex: number, buffer: ArrayBuffer): void {
        this.layers[layerIndex] = new Uint16Array(buffer);
        this.markDirty(layerIndex, 0, 0, LAYER_SIZE, LAYER_SIZE);
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
