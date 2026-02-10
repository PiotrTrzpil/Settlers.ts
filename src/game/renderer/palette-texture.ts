import { LogHandler } from '@/utilities/log-handler';

/**
 * Manages a combined GPU palette texture for palettized atlas rendering.
 *
 * Layout: A 2D RGBA8 texture with width = totalColors, height = 1 + numPlayers.
 *   Row 0: neutral palette (no player tinting)
 *   Row 1: player 0 palette (tinted with player 0's color)
 *   Row 2: player 1 palette (tinted with player 1's color)
 *   ...
 *
 * Usage:
 *   1. registerPalette() for each GFX file set — returns the base offset
 *   2. createPlayerPalettes(playerTints) — creates per-player tinted rows
 *   3. upload() to push texture to GPU
 *   4. bind() before draw calls
 *
 * The sprite atlas stores uint16 indices. For a given pixel:
 *   color = texelFetch(u_palette, ivec2(int(index), playerRow), 0)
 *
 * Special indices (handled in shader, not looked up):
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
     * Total number of colors across all registered palettes (= texture width).
     * Starts at 2 because indices 0 (transparent) and 1 (shadow)
     * are reserved — no valid palette lookup should produce those values.
     */
    private totalColors = 2;

    /** Neutral palette data (row 0): 4 bytes (RGBA) per color. May have excess capacity. */
    private paletteBuffer: Uint8Array = new Uint8Array(4096 * 4);

    /** Number of valid bytes in paletteBuffer (= totalColors * 4) */
    private paletteUsedBytes = 2 * 4;

    /** Full 2D palette data (all rows concatenated): set by createPlayerPalettes() */
    private fullPaletteBuffer: Uint8Array | null = null;

    /** Number of rows in the texture (1 = neutral only, 5 = neutral + 4 players) */
    private paletteRows = 1;

    /** Whether GPU needs re-upload */
    private dirty = false;

    /** GPU texture width (for size tracking) */
    private gpuWidth = 0;
    private gpuHeight = 0;

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
        // Invalidate full palette (player rows need regeneration)
        this.fullPaletteBuffer = null;

        PaletteTextureManager.log.debug(
            `Registered palette '${fileId}': ${colorCount} colors at offset ${baseOffset} (total: ${this.totalColors})`
        );

        return baseOffset;
    }

    /**
     * Create per-player tinted palette rows.
     * Call after all palettes are registered.
     *
     * @param playerTints Array of [r, g, b, a] multiplicative tints per player.
     *   Values are typically close to 1.0 (e.g. [0.68, 0.84, 1.0, 1.0] for blue player).
     */
    public createPlayerPalettes(playerTints: readonly (readonly number[])[]): void {
        const width = this.totalColors;
        const numPlayers = playerTints.length;
        this.paletteRows = 1 + numPlayers; // row 0 = neutral, rows 1..N = players

        const rowBytes = width * 4;
        const totalBytes = this.paletteRows * rowBytes;
        this.fullPaletteBuffer = new Uint8Array(totalBytes);

        // Row 0: copy neutral palette
        const neutralData = this.paletteBuffer.subarray(0, this.paletteUsedBytes);
        this.fullPaletteBuffer.set(neutralData, 0);

        // Rows 1..N: create tinted copies
        for (let p = 0; p < numPlayers; p++) {
            const tint = playerTints[p];
            const rowOffset = (p + 1) * rowBytes;

            // Copy reserved indices 0,1 untinted (transparent/shadow)
            this.fullPaletteBuffer.set(neutralData.subarray(0, 2 * 4), rowOffset);

            // Tint all real palette colors (indices 2+)
            for (let i = 2; i < width; i++) {
                const srcOff = i * 4;
                const dstOff = rowOffset + i * 4;
                // Multiplicative tint: clamp to [0, 255]
                this.fullPaletteBuffer[dstOff + 0] = Math.min(255, Math.round(neutralData[srcOff + 0] * tint[0]));
                this.fullPaletteBuffer[dstOff + 1] = Math.min(255, Math.round(neutralData[srcOff + 1] * tint[1]));
                this.fullPaletteBuffer[dstOff + 2] = Math.min(255, Math.round(neutralData[srcOff + 2] * tint[2]));
                this.fullPaletteBuffer[dstOff + 3] = neutralData[srcOff + 3]; // keep original alpha
            }
        }

        this.dirty = true;

        PaletteTextureManager.log.debug(
            `Created player palettes: ${this.paletteRows} rows x ${width} colors ` +
            `(${(totalBytes / 1024).toFixed(1)}KB)`
        );
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

    /** Get the number of palette rows (1 = neutral only, 5 = neutral + 4 players) */
    public get rowCount(): number {
        return this.paletteRows;
    }

    /** Check if any palettes have been registered */
    public get hasData(): boolean {
        return this.totalColors > 0;
    }

    /**
     * Upload palette texture to GPU. Call after all palettes are registered
     * and createPlayerPalettes() has been called.
     */
    public upload(gl: WebGL2RenderingContext): void {
        if (this.totalColors === 0) return;
        if (!this.dirty && this.gpuWidth === this.totalColors && this.gpuHeight === this.paletteRows) return;

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

        gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);

        if (this.fullPaletteBuffer) {
            // Upload multi-row palette (neutral + player tinted rows)
            gl.texImage2D(
                gl.TEXTURE_2D, 0, gl.RGBA8,
                this.totalColors, this.paletteRows,
                0, gl.RGBA, gl.UNSIGNED_BYTE,
                this.fullPaletteBuffer
            );
        } else {
            // Upload single-row neutral palette
            gl.texImage2D(
                gl.TEXTURE_2D, 0, gl.RGBA8,
                this.totalColors, 1,
                0, gl.RGBA, gl.UNSIGNED_BYTE,
                this.paletteBuffer.subarray(0, this.paletteUsedBytes)
            );
        }

        this.gpuWidth = this.totalColors;
        this.gpuHeight = this.paletteRows;
        this.dirty = false;

        PaletteTextureManager.log.debug(
            `Uploaded palette texture: ${this.totalColors}x${this.paletteRows} ` +
            `(${((this.totalColors * this.paletteRows * 4) / 1024).toFixed(1)}KB)`
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
     * Returns the full multi-row buffer if available, otherwise neutral only.
     */
    public getPaletteData(): Uint8Array | null {
        if (this.fullPaletteBuffer) {
            return this.fullPaletteBuffer;
        }
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
    public restoreFromCache(
        paletteData: Uint8Array,
        offsets: Record<string, number>,
        totalColors: number,
        paletteRows?: number
    ): void {
        this.totalColors = totalColors;
        this.paletteUsedBytes = totalColors * 4;
        this.fileBaseOffsets.clear();
        for (const [key, value] of Object.entries(offsets)) {
            this.fileBaseOffsets.set(key, value);
        }

        if (paletteRows && paletteRows > 1) {
            // Multi-row palette (includes player tinted rows)
            this.paletteRows = paletteRows;
            this.fullPaletteBuffer = new Uint8Array(paletteData.length);
            this.fullPaletteBuffer.set(paletteData);
            // Extract neutral row (row 0) into paletteBuffer
            this.paletteBuffer = new Uint8Array(this.paletteUsedBytes);
            this.paletteBuffer.set(paletteData.subarray(0, this.paletteUsedBytes));
        } else {
            // Single-row neutral palette
            this.paletteRows = 1;
            this.fullPaletteBuffer = null;
            this.paletteBuffer = new Uint8Array(paletteData.length);
            this.paletteBuffer.set(paletteData);
        }

        this.dirty = true;
        this.gpuWidth = 0;
        this.gpuHeight = 0;
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
        this.fullPaletteBuffer = null;
        this.paletteRows = 1;
        this.dirty = false;
        this.gpuWidth = 0;
        this.gpuHeight = 0;
    }
}
