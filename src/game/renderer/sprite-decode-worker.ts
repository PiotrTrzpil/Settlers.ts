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
 * Index 0 = transparent, index 1 = shadow, others = raw value + 2.
 * The +2 offset prevents raw values 0/1 from colliding with transparent/shadow.
 * paletteOffset + paletteBaseOffset are added per-sprite in the shader via v_paletteBase.
 */
// eslint-disable-next-line sonarjs/cognitive-complexity -- RLE decode has inherent branching complexity
function decodeRLEIndexed(
    buffer: Uint8Array,
    pos: number,
    _length: number,
    _paletteOffset: number,
    skipPixels: number,
    outputLength: number
): Uint16Array {
    const indices = new Uint16Array(outputLength);
    const bufferLength = buffer.length;
    const totalPixels = skipPixels + outputLength;

    let srcIdx = 0;
    let dstIdx = 0;

    while (srcIdx < totalPixels && pos < bufferLength) {
        const value = buffer[pos]!;
        pos++;

        if (value <= 1) {
            if (pos >= bufferLength) break;
            const count = buffer[pos]!;
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
                // Store raw value + 2 to avoid collision with special indices 0/1
                indices[dstIdx++] = value + 2;
            }
            srcIdx++;
        }
    }

    return indices;
}

/**
 * Decode raw (no RLE) to palette indices (indexed mode).
 * Stores raw value + 2 to avoid collision with special indices 0 (transparent) / 1 (shadow).
 * paletteOffset + paletteBaseOffset are added per-sprite in the shader via v_paletteBase.
 */
function decodeRawIndexed(
    buffer: Uint8Array,
    pos: number,
    _paletteOffset: number,
    skipPixels: number,
    outputLength: number
): Uint16Array {
    const indices = new Uint16Array(outputLength);
    const bufferLength = buffer.length;

    pos += skipPixels;

    let j = 0;
    while (j < outputLength && pos < bufferLength) {
        const value = buffer[pos]!;
        pos++;
        // +2 offset: raw value 0/1 must not be treated as transparent/shadow
        indices[j++] = value + 2;
    }

    return indices;
}

self.onmessage = (e: MessageEvent<DecodeRequest>) => {
    const { id, buffer, offset, width, height, imgType, paletteOffset, trimTop = 0, trimBottom = 0 } = e.data;
    // Note: paletteBaseOffset is no longer used here - it's added per-sprite in the shader

    const bufferView = new Uint8Array(buffer);

    // Calculate trimmed output dimensions
    const trimmedHeight = height - trimTop - trimBottom;
    const skipPixels = trimTop * width;
    const outputLength = trimmedHeight * width;

    let indexData: Uint16Array;
    if (imgType !== 32) {
        indexData = decodeRLEIndexed(bufferView, offset, width * height, paletteOffset, skipPixels, outputLength);
    } else {
        indexData = decodeRawIndexed(bufferView, offset, paletteOffset, skipPixels, outputLength);
    }

    const response: DecodeResponse = { id, indices: indexData, width, height: trimmedHeight };
    self.postMessage(response, { transfer: [indexData.buffer] });
};
