import { LogHandler } from '@/utilities/log-handler';

/**
 * Manages a combined GPU palette texture for palettized atlas rendering.
 *
 * Layout: All palettes are concatenated horizontally into a single 1D-ish texture.
 * Each palette's colors occupy a contiguous range of texels.
 *
 * Usage:
 *   1. registerPalette() for each GFX file set — returns the base offset
 *   2. upload() once all palettes are registered
 *   3. bind() before draw calls to make the palette available in shader
 *
 * The sprite atlas stores uint16 indices. For a given pixel:
 *   finalIndex = paletteBaseOffset + paletteOffset + pixelValue
 *   color = texelFetch(u_palette, ivec2(finalIndex, 0), 0)
 *
 * Special indices (stored directly in atlas, no palette lookup):
 *   0 = transparent (discard)
 *   1 = shadow (semi-transparent black)
 */
export class PaletteTextureManager {
    private static log = new LogHandler('PaletteTextureManager');

    private texture: WebGLTexture | null = null;
    private textureUnit: number;

    /** Maps fileId -> base offset in the combined palette texture */
    private fileBaseOffsets = new Map<string, number>();

    /**
     * Total number of colors across all registered palettes.
     * Starts at 2 because indices 0 (transparent) and 1 (shadow)
     * are reserved — no valid palette lookup should produce those values.
     */
    private totalColors = 2;

    /** Combined palette data: 4 bytes (RGBA) per color. May have excess capacity. */
    private paletteBuffer: Uint8Array = new Uint8Array(4096 * 4);

    /** Number of valid bytes in paletteBuffer (= totalColors * 4) */
    private paletteUsedBytes = 2 * 4;

    /** Whether GPU needs re-upload */
    private dirty = false;

    /** GPU texture width (for size tracking) */
    private gpuWidth = 0;

    constructor(textureUnit: number) {
        this.textureUnit = textureUnit;
    }

    /**
     * Register a palette from a GFX file set and return its base offset.
     * The base offset is added to each sprite's (paletteOffset + pixelValue) to
     * get the final index into the combined palette texture.
     *
     * @param fileId Unique file set identifier (e.g. "1", "5", "20")
     * @param paletteData Raw Uint32Array palette data (RGBA packed as uint32)
     * @returns The base offset for this palette in the combined texture
     */
    public registerPalette(fileId: string, paletteData: Uint32Array): number {
        const existing = this.fileBaseOffsets.get(fileId);
        if (existing !== undefined) {
            return existing;
        }

        const colorCount = paletteData.length;
        const baseOffset = this.totalColors;

        // Grow combined palette buffer if needed (capacity doubling)
        const newTotal = this.totalColors + colorCount;
        const neededBytes = newTotal * 4;
        if (neededBytes > this.paletteBuffer.length) {
            const newCapacity = Math.max(neededBytes, this.paletteBuffer.length * 2);
            const grown = new Uint8Array(newCapacity);
            grown.set(this.paletteBuffer.subarray(0, this.paletteUsedBytes));
            this.paletteBuffer = grown;
        }

        // Append new palette data (Uint32Array -> Uint8Array view)
        const newColorsBytes = new Uint8Array(paletteData.buffer, paletteData.byteOffset, colorCount * 4);
        this.paletteBuffer.set(newColorsBytes, this.paletteUsedBytes);

        this.totalColors = newTotal;
        this.paletteUsedBytes = neededBytes;
        this.fileBaseOffsets.set(fileId, baseOffset);
        this.dirty = true;

        PaletteTextureManager.log.debug(
            `Registered palette '${fileId}': ${colorCount} colors at offset ${baseOffset} (total: ${this.totalColors})`
        );

        return baseOffset;
    }

    /**
     * Get the base offset for a file's palette.
     * Returns -1 if the file has not been registered.
     */
    public getBaseOffset(fileId: string): number {
        return this.fileBaseOffsets.get(fileId) ?? -1;
    }

    /** Get total number of colors in the combined palette */
    public get colorCount(): number {
        return this.totalColors;
    }

    /** Check if any palettes have been registered */
    public get hasData(): boolean {
        return this.totalColors > 0;
    }

    /**
     * Upload palette texture to GPU. Call after all palettes are registered,
     * or when new palettes are added.
     */
    public upload(gl: WebGL2RenderingContext): void {
        if (this.totalColors === 0) return;
        if (!this.dirty && this.gpuWidth === this.totalColors) return;

        if (!this.texture) {
            this.texture = gl.createTexture();
        }

        gl.activeTexture(gl.TEXTURE0 + this.textureUnit);
        gl.bindTexture(gl.TEXTURE_2D, this.texture);

        // NEAREST filtering — no interpolation between palette entries
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

        // Upload as a 1-pixel-tall RGBA8 texture (width = totalColors)
        gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
        gl.texImage2D(
            gl.TEXTURE_2D,
            0,
            gl.RGBA8,
            this.totalColors,
            1,
            0,
            gl.RGBA,
            gl.UNSIGNED_BYTE,
            this.paletteBuffer.subarray(0, this.paletteUsedBytes)
        );

        this.gpuWidth = this.totalColors;
        this.dirty = false;

        PaletteTextureManager.log.debug(
            `Uploaded palette texture: ${this.totalColors} colors (${(this.totalColors * 4 / 1024).toFixed(1)}KB)`
        );
    }

    /**
     * Bind the palette texture to its assigned texture unit.
     * Call before draw calls that need palette lookup.
     */
    public bind(gl: WebGL2RenderingContext): void {
        if (!this.texture) return;
        gl.activeTexture(gl.TEXTURE0 + this.textureUnit);
        gl.bindTexture(gl.TEXTURE_2D, this.texture);
    }

    /**
     * Get raw palette data for caching or CPU-side lookups.
     * Returns a view of the used portion only (not excess capacity).
     */
    public getPaletteData(): Uint8Array | null {
        if (this.paletteUsedBytes === 0) return null;
        return this.paletteBuffer.subarray(0, this.paletteUsedBytes);
    }

    /**
     * Get file base offsets for caching.
     */
    public getFileBaseOffsets(): Record<string, number> {
        const result: Record<string, number> = {};
        for (const [key, value] of this.fileBaseOffsets) {
            result[key] = value;
        }
        return result;
    }

    /**
     * Restore palette manager from cached data.
     */
    public restoreFromCache(paletteData: Uint8Array, offsets: Record<string, number>, totalColors: number): void {
        this.paletteBuffer = paletteData;
        this.paletteUsedBytes = totalColors * 4;
        this.totalColors = totalColors;
        this.fileBaseOffsets.clear();
        for (const [key, value] of Object.entries(offsets)) {
            this.fileBaseOffsets.set(key, value);
        }
        this.dirty = true;
        this.gpuWidth = 0;
    }

    /**
     * Clean up GPU resources.
     */
    public destroy(gl: WebGL2RenderingContext): void {
        if (this.texture) {
            gl.deleteTexture(this.texture);
            this.texture = null;
        }
        this.paletteBuffer = new Uint8Array(4096 * 4);
        this.paletteUsedBytes = 2 * 4;
        this.totalColors = 2;
        this.fileBaseOffsets.clear();
        this.dirty = false;
        this.gpuWidth = 0;
    }
}
