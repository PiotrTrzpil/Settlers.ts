/**
 * Extract a region from an R16UI atlas layer into RGBA ImageData (for UI icons).
 */

import { LAYER_SIZE } from './entity-texture-atlas-constants';

/** Minimal region shape needed for extraction (matches AtlasRegion). */
export interface ExtractableRegion {
    x: number;
    y: number;
    width: number;
    height: number;
    layer: number;
}

/** Resolve a single atlas pixel index to an RGBA uint32 (little-endian ABGR in buffer). */
export function resolveAtlasPixel(
    rawIndex: number,
    paletteData: Uint8Array | null | undefined,
    paletteBaseOffset: number
): number {
    if (rawIndex === 0) {
        return 0x00000000; // transparent
    }
    if (rawIndex === 1) {
        return 0x40000000; // shadow
    }

    const index = rawIndex + paletteBaseOffset;
    if (paletteData && index * 4 + 3 < paletteData.length) {
        const pi = index * 4;
        const r = paletteData[pi]!;
        const g = paletteData[pi + 1]!;
        const b = paletteData[pi + 2]!;
        const a = paletteData[pi + 3]!;
        return (a << 24) | (b << 16) | (g << 8) | r;
    }
    return 0xffff00ff; // magenta for missing palette
}

/**
 * Extract a region from atlas layer data and convert palette indices to RGBA ImageData.
 */
export function extractAtlasRegion(
    layers: readonly Uint16Array[],
    region: ExtractableRegion,
    paletteData?: Uint8Array | null,
    paletteBaseOffset = 0
): ImageData | null {
    if (region.layer >= layers.length) {
        return null;
    }
    if (region.x + region.width > LAYER_SIZE || region.y + region.height > LAYER_SIZE) {
        return null;
    }

    const layer = layers[region.layer]!;
    const imageData = new ImageData(region.width, region.height);
    const dst = new Uint32Array(imageData.data.buffer);

    for (let y = 0; y < region.height; y++) {
        const srcRow = (region.y + y) * LAYER_SIZE + region.x;
        const dstRow = y * region.width;

        for (let x = 0; x < region.width; x++) {
            dst[dstRow + x] = resolveAtlasPixel(layer[srcRow + x]!, paletteData, paletteBaseOffset);
        }
    }

    return imageData;
}
