/**
 * Shared indexed sprite decoders used by both single-sprite and batch-sprite workers.
 *
 * Output encoding:
 * - Index 0 = transparent
 * - Index 1 = shadow
 * - Others = raw byte value + 2 (avoids collision with special indices)
 *
 * paletteOffset + paletteBaseOffset are added per-sprite in the shader via v_paletteBase.
 */

/**
 * Decode RLE-compressed sprite to palette indices.
 * @param skipPixels Number of leading pixels to skip (for top-row trimming)
 * @param outputLength Number of pixels to decode after skipping
 */
// eslint-disable-next-line sonarjs/cognitive-complexity -- RLE decode has inherent branching complexity
export function decodeRLEIndexed(
    buffer: Uint8Array,
    pos: number,
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
            if (pos >= bufferLength) {
                break;
            }
            const count = buffer[pos]!;
            pos++;
            for (let i = 0; i < count && srcIdx < totalPixels; i++) {
                if (srcIdx >= skipPixels) {
                    indices[dstIdx++] = value; // 0 = transparent, 1 = shadow
                }
                srcIdx++;
            }
        } else {
            if (srcIdx >= skipPixels) {
                indices[dstIdx++] = value + 2;
            }
            srcIdx++;
        }
    }

    return indices;
}

/**
 * Decode raw (no RLE) sprite to palette indices.
 * @param skipPixels Number of leading pixels to skip (for top-row trimming)
 * @param outputLength Number of pixels to decode after skipping
 */
export function decodeRawIndexed(
    buffer: Uint8Array,
    pos: number,
    skipPixels: number,
    outputLength: number
): Uint16Array {
    const indices = new Uint16Array(outputLength);
    const bufferLength = buffer.length;

    pos += skipPixels;

    let j = 0;
    while (j < outputLength && pos < bufferLength) {
        indices[j++] = buffer[pos]! + 2;
        pos++;
    }

    return indices;
}
