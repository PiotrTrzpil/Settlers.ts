import { LogHandler } from '@/utilities/log-handler';

/**
 * Fixed palette texture width for 2D layout.
 * Must be a power of 2 and within WebGL max texture size.
 * 2048 is a safe choice that works on all WebGL2 implementations.
 */
export const PALETTE_TEXTURE_WIDTH = 2048;

/**
 * Manages a combined GPU palette texture for palettized atlas rendering.
 *
 * Layout: A 2D RGBA8 texture with:
 *   - Width = PALETTE_TEXTURE_WIDTH (fixed, e.g., 2048)
 *   - Height = ceil(totalColors / width) * numPlayerRows
 *
 * For each player row, colors are laid out left-to-right, top-to-bottom:
 *   Row 0 of player 0: colors 0..2047
 *   Row 1 of player 0: colors 2048..4095
 *   ...
 *   Row 0 of player 1: colors 0..2047 (tinted)
 *   ...
 *
 * Usage:
 *   1. registerPalette() for each GFX file set — returns the base offset
 *   2. createPlayerPalettes(playerTints) — creates per-player tinted rows
 *   3. upload() to push texture to GPU
 *   4. bind() before draw calls
 *
 * The sprite atlas stores uint16 indices. For a given pixel:
 *   localX = index % PALETTE_TEXTURE_WIDTH
 *   localY = index / PALETTE_TEXTURE_WIDTH
 *   color = texelFetch(u_palette, ivec2(localX, playerRow * rowsPerPlayer + localY), 0)
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
     * Total number of colors across all registered palettes.
     * Starts at 2 because indices 0 (transparent) and 1 (shadow)
     * are reserved — no valid palette lookup should produce those values.
     */
    private totalColors = 2;

    /** Neutral palette data: 4 bytes (RGBA) per color. May have excess capacity. */
    private paletteBuffer: Uint8Array = new Uint8Array(4096 * 4);

    /** Number of valid bytes in paletteBuffer (= totalColors * 4) */
    private paletteUsedBytes = 2 * 4;

    /** Full 2D palette data (all player rows): set by createPlayerPalettes() */
    private fullPaletteBuffer: Uint8Array | null = null;

    /** Number of player rows (1 = neutral only, 5 = neutral + 4 players) */
    private numPlayerRows = 1;

    /** Number of texture rows needed per player (ceil(totalColors / width)) */
    private rowsPerPlayer = 1;

    /** Whether GPU needs re-upload */
    private dirty = false;

    /** GPU texture dimensions (for change detection) */
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
        // Update rowsPerPlayer immediately so shaders get correct value even before createPlayerPalettes
        this.rowsPerPlayer = Math.ceil(this.totalColors / PALETTE_TEXTURE_WIDTH);

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
        const numPlayers = playerTints.length;
        this.numPlayerRows = 1 + numPlayers; // row 0 = neutral, rows 1..N = players

        // Calculate 2D layout dimensions
        const width = PALETTE_TEXTURE_WIDTH;
        this.rowsPerPlayer = Math.ceil(this.totalColors / width);
        const textureHeight = this.rowsPerPlayer * this.numPlayerRows;

        // Allocate buffer for all player rows
        const bytesPerRow = width * 4;
        const totalBytes = textureHeight * bytesPerRow;
        this.fullPaletteBuffer = new Uint8Array(totalBytes);

        const neutralData = this.paletteBuffer.subarray(0, this.paletteUsedBytes);

        // Fill all player rows
        for (let p = 0; p < this.numPlayerRows; p++) {
            const tint = p === 0 ? [1, 1, 1, 1] : playerTints[p - 1];
            const playerBaseRow = p * this.rowsPerPlayer;

            // Copy colors into 2D layout
            for (let i = 0; i < this.totalColors; i++) {
                const localRow = Math.floor(i / width);
                const localCol = i % width;
                const dstOff = ((playerBaseRow + localRow) * width + localCol) * 4;
                const srcOff = i * 4;

                if (i < 2 || p === 0) {
                    // Reserved indices (0,1) or neutral row: copy directly
                    if (srcOff + 3 < neutralData.length) {
                        this.fullPaletteBuffer[dstOff + 0] = neutralData[srcOff + 0];
                        this.fullPaletteBuffer[dstOff + 1] = neutralData[srcOff + 1];
                        this.fullPaletteBuffer[dstOff + 2] = neutralData[srcOff + 2];
                        this.fullPaletteBuffer[dstOff + 3] = neutralData[srcOff + 3];
                    }
                } else {
                    // Apply player tint
                    if (srcOff + 3 < neutralData.length) {
                        this.fullPaletteBuffer[dstOff + 0] = Math.min(255, Math.round(neutralData[srcOff + 0] * tint[0]));
                        this.fullPaletteBuffer[dstOff + 1] = Math.min(255, Math.round(neutralData[srcOff + 1] * tint[1]));
                        this.fullPaletteBuffer[dstOff + 2] = Math.min(255, Math.round(neutralData[srcOff + 2] * tint[2]));
                        this.fullPaletteBuffer[dstOff + 3] = neutralData[srcOff + 3];
                    }
                }
            }
        }

        this.dirty = true;

        PaletteTextureManager.log.debug(
            `Created player palettes: ${this.numPlayerRows} players x ${this.rowsPerPlayer} rows ` +
            `(texture: ${width}x${textureHeight}, totalColors: ${this.totalColors}, ${(totalBytes / 1024).toFixed(1)}KB)`
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
        return this.numPlayerRows;
    }

    /** Get the number of texture rows per player (for shader uniform) */
    public get textureRowsPerPlayer(): number {
        return this.rowsPerPlayer;
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

        const width = PALETTE_TEXTURE_WIDTH;
        const height = this.rowsPerPlayer * this.numPlayerRows;

        if (!this.dirty && this.gpuWidth === width && this.gpuHeight === height) return;

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
            // Upload 2D palette layout (width x height)
            gl.texImage2D(
                gl.TEXTURE_2D, 0, gl.RGBA8,
                width, height,
                0, gl.RGBA, gl.UNSIGNED_BYTE,
                this.fullPaletteBuffer
            );
        } else {
            // Single-row neutral palette (before createPlayerPalettes called)
            // Still use 2D layout for consistency
            const singleRowHeight = Math.ceil(this.totalColors / width);
            const tempBuffer = new Uint8Array(width * singleRowHeight * 4);
            tempBuffer.set(this.paletteBuffer.subarray(0, this.paletteUsedBytes));
            gl.texImage2D(
                gl.TEXTURE_2D, 0, gl.RGBA8,
                width, singleRowHeight,
                0, gl.RGBA, gl.UNSIGNED_BYTE,
                tempBuffer
            );
        }

        this.gpuWidth = width;
        this.gpuHeight = height;
        this.dirty = false;

        PaletteTextureManager.log.debug(
            `Uploaded palette texture: ${width}x${height} ` +
            `(${this.totalColors} colors, ${this.numPlayerRows} players, ${((width * height * 4) / 1024).toFixed(1)}KB)`
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
        numPlayerRows?: number,
        rowsPerPlayer?: number
    ): void {
        this.totalColors = totalColors;
        this.paletteUsedBytes = totalColors * 4;
        this.rowsPerPlayer = rowsPerPlayer ?? Math.ceil(totalColors / PALETTE_TEXTURE_WIDTH);
        this.fileBaseOffsets.clear();
        for (const [key, value] of Object.entries(offsets)) {
            this.fileBaseOffsets.set(key, value);
        }

        if (numPlayerRows && numPlayerRows > 1) {
            // Multi-row palette (includes player tinted rows)
            this.numPlayerRows = numPlayerRows;
            this.fullPaletteBuffer = new Uint8Array(paletteData.length);
            this.fullPaletteBuffer.set(paletteData);
            // Extract neutral row (row 0) into paletteBuffer
            this.paletteBuffer = new Uint8Array(this.paletteUsedBytes);
            this.paletteBuffer.set(paletteData.subarray(0, this.paletteUsedBytes));
        } else {
            // Single-row neutral palette
            this.numPlayerRows = 1;
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
        this.numPlayerRows = 1;
        this.dirty = false;
        this.gpuWidth = 0;
        this.gpuHeight = 0;
    }
}
