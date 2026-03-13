/**
 * Web Worker for combined parse + decode of multiple sprites from a GFX file.
 *
 * Instead of the main thread calling readImage() per sprite and then sending
 * individual decode requests, this worker receives the raw GFX file buffer
 * plus a manifest of sprite descriptors. It parses GFX headers and decodes
 * all sprites in one pass — eliminating thousands of synchronous readImage()
 * calls on the main thread and reducing postMessage overhead to a single
 * round-trip per batch.
 *
 * Output format: same palette-indexed Uint16Array as sprite-decode-worker.
 * Special indices: 0 = transparent, 1 = shadow, others = raw + 2.
 */

import { decodeRLEIndexed, decodeRawIndexed } from './sprite-decode-indexed';

// ---------------------------------------------------------------------------
// Message types
// ---------------------------------------------------------------------------

/** Descriptor for one sprite to parse+decode from the GFX buffer. */
export interface BatchSpriteDescriptor {
    /** GFX file byte offset where the image header starts */
    gfxOffset: number;
    /** Palette offset resolved from PIL (already computed on main thread) */
    paletteOffset: number;
    /** Rows to skip from top (default 0) */
    trimTop: number;
    /** Rows to skip from bottom (default 0) */
    trimBottom: number;
}

export interface BatchDecodeRequest {
    id: number;
    /** Raw GFX file bytes */
    gfxBuffer: ArrayBuffer;
    /** Sprite descriptors to process */
    manifest: BatchSpriteDescriptor[];
}

/** Result for a single decoded sprite. */
export interface BatchSpriteResult {
    /** Width in pixels */
    width: number;
    /** Height after trimming */
    height: number;
    /** x offset from GFX header */
    left: number;
    /** y offset from GFX header */
    top: number;
    /** Per-sprite palette offset */
    paletteOffset: number;
    /** Byte offset into the concatenated indices buffer where this sprite's data starts */
    indicesOffset: number;
    /** Number of Uint16 elements for this sprite */
    indicesLength: number;
}

export interface BatchDecodeResponse {
    id: number;
    /** Per-sprite metadata */
    results: BatchSpriteResult[];
    /** Concatenated palette indices for all sprites */
    allIndices: Uint16Array;
    /** Error message if batch decode failed */
    error?: string;
}

// ---------------------------------------------------------------------------
// GFX header parsing (ported from GfxFileReader.readImage)
// ---------------------------------------------------------------------------

interface ParsedHeader {
    width: number;
    height: number;
    left: number;
    top: number;
    imgType: number;
    dataOffset: number;
}

function parseGfxHeader(view: DataView, offset: number): ParsedHeader {
    const firstWord = view.getUint16(offset, true);

    if (firstWord > 860) {
        // Word header (4 bytes for dimensions)
        return {
            width: view.getUint8(offset),
            height: view.getUint8(offset + 1),
            left: view.getUint8(offset + 2),
            top: view.getUint8(offset + 3),
            imgType: 0,
            dataOffset: offset + 8,
        };
    }
    // Standard header (10 bytes for dimensions + type)
    return {
        width: view.getUint16(offset, true),
        height: view.getUint16(offset + 2, true),
        left: view.getUint16(offset + 4, true),
        top: view.getUint16(offset + 6, true),
        imgType: view.getUint8(offset + 8),
        dataOffset: offset + 12,
    };
}

// ---------------------------------------------------------------------------
// Batch processing helpers
// ---------------------------------------------------------------------------

interface ParsedSprite extends ParsedHeader {
    trimTop: number;
    trimBottom: number;
    paletteOffset: number;
}

function decodeSprite(p: ParsedSprite, gfxBytes: Uint8Array): Uint16Array | null {
    const trimmedHeight = p.height - p.trimTop - p.trimBottom;
    if (trimmedHeight <= 0) {
        return null;
    }

    const skipPixels = p.trimTop * p.width;
    const outputLength = trimmedHeight * p.width;

    if (p.imgType !== 32) {
        return decodeRLEIndexed(gfxBytes, p.dataOffset, skipPixels, outputLength);
    }
    return decodeRawIndexed(gfxBytes, p.dataOffset, skipPixels, outputLength);
}

// ---------------------------------------------------------------------------
// Worker message handler
// ---------------------------------------------------------------------------

self.onmessage = (e: MessageEvent<BatchDecodeRequest>) => {
    const { id, gfxBuffer, manifest } = e.data;

    try {
        const gfxBytes = new Uint8Array(gfxBuffer);
        const gfxView = new DataView(gfxBuffer);

        // First pass: parse headers and calculate total output size
        const parsed: ParsedSprite[] = [];
        let totalOutputLength = 0;

        for (const desc of manifest) {
            const header = parseGfxHeader(gfxView, desc.gfxOffset);
            const trimmedHeight = header.height - desc.trimTop - desc.trimBottom;
            totalOutputLength += trimmedHeight > 0 ? trimmedHeight * header.width : 0;
            parsed.push({
                ...header,
                trimTop: desc.trimTop,
                trimBottom: desc.trimBottom,
                paletteOffset: desc.paletteOffset,
            });
        }

        // Allocate one big output buffer for all sprites
        const allIndices = new Uint16Array(totalOutputLength);
        const results: BatchSpriteResult[] = new Array(manifest.length);

        // Second pass: decode all sprites into the output buffer
        let offset = 0;

        for (let i = 0; i < parsed.length; i++) {
            const p = parsed[i]!;
            const trimmedHeight = Math.max(0, p.height - p.trimTop - p.trimBottom);
            const decoded = decodeSprite(p, gfxBytes);
            const length = trimmedHeight * p.width;

            if (decoded) {
                allIndices.set(decoded, offset);
            }

            results[i] = {
                width: p.width,
                height: trimmedHeight,
                left: p.left,
                top: p.top,
                paletteOffset: p.paletteOffset,
                indicesOffset: offset,
                indicesLength: length,
            };
            offset += length;
        }

        const response: BatchDecodeResponse = { id, results, allIndices };
        self.postMessage(response, { transfer: [allIndices.buffer] });
    } catch (err) {
        const error = err instanceof Error ? err.message : String(err);
        self.postMessage({ id, error, results: [], allIndices: new Uint16Array(0) } satisfies BatchDecodeResponse);
    }
};
