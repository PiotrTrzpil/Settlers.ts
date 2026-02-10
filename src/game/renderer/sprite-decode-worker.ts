/**
 * Web Worker for offloading sprite decoding from the main thread.
 * Handles RLE decoding and palette lookups.
 *
 * Supports two modes:
 * - RGBA mode (indexed=false): outputs Uint8ClampedArray of RGBA pixels
 * - Indexed mode (indexed=true): outputs Uint16Array of palette indices
 */

export interface DecodeRequest {
    id: number;
    buffer: ArrayBuffer;
    offset: number;
    width: number;
    height: number;
    imgType: number;
    paletteData: Uint32Array;
    paletteOffset: number;
    /** Rows to skip from the top of the sprite (default 0) */
    trimTop?: number;
    /** Rows to skip from the bottom of the sprite (default 0) */
    trimBottom?: number;
    /**
     * If true, output palette indices (Uint16Array) instead of RGBA pixels.
     * paletteBaseOffset is added to produce the final combined palette index.
     */
    indexed?: boolean;
    /** Base offset into the combined palette texture (for indexed mode) */
    paletteBaseOffset?: number;
}

export interface DecodeResponse {
    id: number;
    /** Decoded RGBA pixels (non-indexed mode) */
    pixels?: Uint8ClampedArray;
    /** Decoded palette indices (indexed mode) */
    indices?: Uint16Array;
    /** Width */
    width: number;
    /** Height */
    height: number;
}

/**
 * Decode with RLE encoding (imgType != 32)
 * Supports trimming: skips writing first trimTop*width pixels, stops after outputLength pixels.
 */
function decodeRLE(
    buffer: Uint8Array,
    pos: number,
    length: number,
    paletteData: Uint32Array,
    paletteOffset: number,
    skipPixels: number,
    outputLength: number
): Uint32Array {
    const imgData = new Uint32Array(outputLength);
    const bufferLength = buffer.length;
    const totalPixels = skipPixels + outputLength;

    let srcIdx = 0; // Position in the logical source (including skipped)
    let dstIdx = 0; // Position in output buffer

    while (srcIdx < totalPixels && pos < bufferLength) {
        const value = buffer[pos];
        pos++;

        if (value <= 1) {
            if (pos >= bufferLength) break;
            const count = buffer[pos];
            pos++;

            // Palette index 0 = transparent, index 1 = shadow
            const color = value === 0 ? 0x00000000 : 0x40000000;
            for (let i = 0; i < count && srcIdx < totalPixels; i++) {
                if (srcIdx >= skipPixels) {
                    imgData[dstIdx++] = color;
                }
                srcIdx++;
            }
        } else {
            if (srcIdx >= skipPixels) {
                const idx = paletteOffset + value;
                imgData[dstIdx++] = idx < paletteData.length ? paletteData[idx] : 0;
            }
            srcIdx++;
        }
    }

    return imgData;
}

/**
 * Decode without RLE encoding (imgType == 32)
 * Supports trimming: skips first skipPixels in buffer, outputs outputLength pixels.
 */
function decodeRaw(
    buffer: Uint8Array,
    pos: number,
    paletteData: Uint32Array,
    paletteOffset: number,
    skipPixels: number,
    outputLength: number
): Uint32Array {
    const imgData = new Uint32Array(outputLength);
    const bufferLength = buffer.length;

    // Skip input bytes for trimmed top rows
    pos += skipPixels;

    let j = 0;
    while (j < outputLength && pos < bufferLength) {
        const value = buffer[pos];
        pos++;
        const idx = paletteOffset + value;
        imgData[j++] = idx < paletteData.length ? paletteData[idx] : 0;
    }

    return imgData;
}

// =============================================================================
// Indexed mode decoders — output Uint16Array of palette indices
// =============================================================================

/**
 * Decode RLE to palette indices (indexed mode).
 * Index 0 = transparent, index 1 = shadow, others = paletteBaseOffset + paletteOffset + value
 */
function decodeRLEIndexed(
    buffer: Uint8Array,
    pos: number,
    _length: number,
    paletteOffset: number,
    paletteBaseOffset: number,
    skipPixels: number,
    outputLength: number
): Uint16Array {
    const indices = new Uint16Array(outputLength);
    const bufferLength = buffer.length;
    const totalPixels = skipPixels + outputLength;

    let srcIdx = 0;
    let dstIdx = 0;

    while (srcIdx < totalPixels && pos < bufferLength) {
        const value = buffer[pos];
        pos++;

        if (value <= 1) {
            if (pos >= bufferLength) break;
            const count = buffer[pos];
            pos++;

            // 0 = transparent, 1 = shadow — stored directly as special indices
            for (let i = 0; i < count && srcIdx < totalPixels; i++) {
                if (srcIdx >= skipPixels) {
                    indices[dstIdx++] = value; // 0 or 1
                }
                srcIdx++;
            }
        } else {
            if (srcIdx >= skipPixels) {
                // Combined index: base + sprite palette offset + pixel value
                indices[dstIdx++] = paletteBaseOffset + paletteOffset + value;
            }
            srcIdx++;
        }
    }

    return indices;
}

/**
 * Decode raw (no RLE) to palette indices (indexed mode).
 */
function decodeRawIndexed(
    buffer: Uint8Array,
    pos: number,
    paletteOffset: number,
    paletteBaseOffset: number,
    skipPixels: number,
    outputLength: number
): Uint16Array {
    const indices = new Uint16Array(outputLength);
    const bufferLength = buffer.length;

    pos += skipPixels;

    let j = 0;
    while (j < outputLength && pos < bufferLength) {
        const value = buffer[pos];
        pos++;
        // Raw mode has no special transparent/shadow handling in original code.
        // Every byte is a palette lookup.
        indices[j++] = paletteBaseOffset + paletteOffset + value;
    }

    return indices;
}

self.onmessage = (e: MessageEvent<DecodeRequest>) => {
    const {
        id, buffer, offset, width, height, imgType,
        paletteData, paletteOffset,
        trimTop = 0, trimBottom = 0,
        indexed = false, paletteBaseOffset = 0
    } = e.data;

    const bufferView = new Uint8Array(buffer);

    // Calculate trimmed output dimensions
    const trimmedHeight = height - trimTop - trimBottom;
    const skipPixels = trimTop * width;
    const outputLength = trimmedHeight * width;

    if (indexed) {
        // Indexed mode — output Uint16Array of palette indices
        let indexData: Uint16Array;
        if (imgType !== 32) {
            indexData = decodeRLEIndexed(
                bufferView, offset, width * height,
                paletteOffset, paletteBaseOffset,
                skipPixels, outputLength
            );
        } else {
            indexData = decodeRawIndexed(
                bufferView, offset,
                paletteOffset, paletteBaseOffset,
                skipPixels, outputLength
            );
        }

        const response: DecodeResponse = { id, indices: indexData, width, height: trimmedHeight };
        self.postMessage(response, { transfer: [indexData.buffer] });
    } else {
        // RGBA mode — existing behavior
        let pixels32: Uint32Array;
        if (imgType !== 32) {
            pixels32 = decodeRLE(bufferView, offset, width * height, paletteData, paletteOffset, skipPixels, outputLength);
        } else {
            pixels32 = decodeRaw(bufferView, offset, paletteData, paletteOffset, skipPixels, outputLength);
        }

        const pixels = new Uint8ClampedArray(pixels32.buffer);
        const response: DecodeResponse = { id, pixels, width, height: trimmedHeight };
        self.postMessage(response, { transfer: [pixels.buffer] });
    }
};
