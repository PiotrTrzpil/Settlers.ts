/**
 * Web Worker for offloading sprite decoding from the main thread.
 * Outputs Uint16Array of palette indices for the palettized R16UI atlas.
 *
 * Special index values: 0 = transparent, 1 = shadow.
 * All other indices = paletteOffset + raw value (relative to file's palette).
 * The paletteBaseOffset is added per-sprite in the shader to avoid Uint16 overflow.
 */

export interface DecodeRequest {
    id: number;
    buffer: ArrayBuffer;
    offset: number;
    width: number;
    height: number;
    imgType: number;
    paletteOffset: number;
    /** Rows to skip from the top of the sprite (default 0) */
    trimTop?: number;
    /** Rows to skip from the bottom of the sprite (default 0) */
    trimBottom?: number;
    /** Base offset into the combined palette texture */
    paletteBaseOffset?: number;
}

export interface DecodeResponse {
    id: number;
    /** Decoded palette indices */
    indices: Uint16Array;
    /** Width */
    width: number;
    /** Height */
    height: number;
}

// =============================================================================
// Indexed mode decoders — output Uint16Array of palette indices
// =============================================================================

/**
 * Decode RLE to palette indices (indexed mode).
 * Index 0 = transparent, index 1 = shadow, others = paletteOffset + value
 * (paletteBaseOffset is added per-sprite in the shader to avoid Uint16 overflow)
 */
function decodeRLEIndexed(
    buffer: Uint8Array,
    pos: number,
    _length: number,
    paletteOffset: number,
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
                // Relative index: sprite palette offset + pixel value
                // paletteBaseOffset will be added in shader
                indices[dstIdx++] = paletteOffset + value;
            }
            srcIdx++;
        }
    }

    return indices;
}

/**
 * Decode raw (no RLE) to palette indices (indexed mode).
 * paletteBaseOffset is added per-sprite in the shader to avoid Uint16 overflow.
 */
function decodeRawIndexed(
    buffer: Uint8Array,
    pos: number,
    paletteOffset: number,
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
        // Every byte is a palette lookup. paletteBaseOffset added in shader.
        indices[j++] = paletteOffset + value;
    }

    return indices;
}

self.onmessage = (e: MessageEvent<DecodeRequest>) => {
    const {
        id, buffer, offset, width, height, imgType,
        paletteOffset,
        trimTop = 0, trimBottom = 0,
    } = e.data;
    // Note: paletteBaseOffset is no longer used here - it's added per-sprite in the shader

    const bufferView = new Uint8Array(buffer);

    // Calculate trimmed output dimensions
    const trimmedHeight = height - trimTop - trimBottom;
    const skipPixels = trimTop * width;
    const outputLength = trimmedHeight * width;

    let indexData: Uint16Array;
    if (imgType !== 32) {
        indexData = decodeRLEIndexed(
            bufferView, offset, width * height,
            paletteOffset,
            skipPixels, outputLength
        );
    } else {
        indexData = decodeRawIndexed(
            bufferView, offset,
            paletteOffset,
            skipPixels, outputLength
        );
    }

    const response: DecodeResponse = { id, indices: indexData, width, height: trimmedHeight };
    self.postMessage(response, { transfer: [indexData.buffer] });
};
