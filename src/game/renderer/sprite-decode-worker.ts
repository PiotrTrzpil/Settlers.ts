/**
 * Web Worker for offloading sprite decoding from the main thread.
 * Outputs Uint16Array of palette indices for the palettized R16UI atlas.
 *
 * Special index values: 0 = transparent, 1 = shadow.
 * All other indices = paletteOffset + raw value (relative to file's palette).
 * The paletteBaseOffset is added per-sprite in the shader to avoid Uint16 overflow.
 */

import { decodeRLEIndexed, decodeRawIndexed } from './sprite-decode-indexed';

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
    /** Decoded palette indices (absent on error) */
    indices: Uint16Array;
    /** Width */
    width: number;
    /** Height */
    height: number;
    /** Error message if decode failed */
    error?: string;
}

self.onmessage = (e: MessageEvent<DecodeRequest>) => {
    const { id, buffer, offset, width, height, imgType, trimTop = 0, trimBottom = 0 } = e.data;

    try {
        const bufferView = new Uint8Array(buffer);

        const trimmedHeight = height - trimTop - trimBottom;
        const skipPixels = trimTop * width;
        const outputLength = trimmedHeight * width;

        let indexData: Uint16Array;
        if (imgType !== 32) {
            indexData = decodeRLEIndexed(bufferView, offset, skipPixels, outputLength);
        } else {
            indexData = decodeRawIndexed(bufferView, offset, skipPixels, outputLength);
        }

        const response: DecodeResponse = { id, indices: indexData, width, height: trimmedHeight };
        self.postMessage(response, { transfer: [indexData.buffer] });
    } catch (err) {
        const error = err instanceof Error ? err.message : String(err);
        self.postMessage({ id, error, indices: new Uint16Array(0), width: 0, height: 0 } satisfies DecodeResponse);
    }
};
