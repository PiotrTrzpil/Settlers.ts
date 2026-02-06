/**
 * Web Worker for offloading sprite decoding from the main thread.
 * Handles RLE decoding and palette lookups.
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
}

export interface DecodeResponse {
    id: number;
    /** Decoded pixels */
    pixels?: Uint8ClampedArray;
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

self.onmessage = (e: MessageEvent<DecodeRequest>) => {
    const { id, buffer, offset, width, height, imgType, paletteData, paletteOffset, trimTop = 0, trimBottom = 0 } = e.data;

    const bufferView = new Uint8Array(buffer);

    // Calculate trimmed output dimensions
    const trimmedHeight = height - trimTop - trimBottom;
    const skipPixels = trimTop * width;
    const outputLength = trimmedHeight * width;

    let pixels32: Uint32Array;
    if (imgType !== 32) {
        pixels32 = decodeRLE(bufferView, offset, width * height, paletteData, paletteOffset, skipPixels, outputLength);
    } else {
        pixels32 = decodeRaw(bufferView, offset, paletteData, paletteOffset, skipPixels, outputLength);
    }

    const pixels = new Uint8ClampedArray(pixels32.buffer);
    const response: DecodeResponse = { id, pixels, width, height: trimmedHeight };

    // Transfer the buffer back to avoid copying
    self.postMessage(response, { transfer: [pixels.buffer] });
};
