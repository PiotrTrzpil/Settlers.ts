/**
 * Darkness map computation for the landscape renderer.
 *
 * Produces a 2-channel (RG) per-tile byte array from map terrain/gameplay attributes:
 *   R = dark land intensity (0 or 255)
 *   G = fog of war level (0-252, scaled from raw 0-63)
 *
 * Dark land gaps (beach/river tiles inside dark regions that lack the isDarkLand flag)
 * can optionally be filled via morphological dilation.
 */

import type { MapSize } from '@/utilities/map-size';

/** Extract isDarkLand flags (bit 6) from terrain attributes into a 0/1 array. */
function extractDarkFlags(terrainAttributes: Uint8Array): { flags: Uint8Array; hasDark: boolean } {
    const flags = new Uint8Array(terrainAttributes.length);
    let hasDark = false;
    for (let i = 0; i < terrainAttributes.length; i++) {
        if (terrainAttributes[i]! & 0x40) {
            flags[i] = 1;
            hasDark = true;
        }
    }
    return { flags, hasDark };
}

/**
 * Fill gaps in a dark land flag array: non-dark tiles surrounded by 5+
 * dark neighbors (8-connected) become dark. Multiple passes fill wider
 * gaps (rivers, beaches up to ~3 tiles wide).
 */
function dilateDarkFlags(flags: Uint8Array, w: number, h: number, passes: number): void {
    for (let pass = 0; pass < passes; pass++) {
        const prev = new Uint8Array(flags);
        for (let y = 1; y < h - 1; y++) {
            const row = y * w;
            const rowUp = row - w;
            const rowDown = row + w;
            for (let x = 1; x < w - 1; x++) {
                if (prev[row + x]!) continue;
                const count =
                    prev[rowUp + x - 1]! +
                    prev[rowUp + x]! +
                    prev[rowUp + x + 1]! +
                    prev[row + x - 1]! +
                    prev[row + x + 1]! +
                    prev[rowDown + x - 1]! +
                    prev[rowDown + x]! +
                    prev[rowDown + x + 1]!;
                if (count >= 5) flags[row + x] = 1;
            }
        }
    }
}

/** Write fog of war values into the G channel of the interleaved RG output. */
function writeFogChannel(result: Uint8Array, gameplayAttributes: Uint8Array, len: number): boolean {
    let hasNonZero = false;
    for (let i = 0; i < len; i++) {
        const fog = gameplayAttributes[i]! & 0x3f;
        if (fog > 0) {
            result[i * 2 + 1] = Math.min(fog << 2, 255);
            hasNonZero = true;
        }
    }
    return hasNonZero;
}

/**
 * Compute a 2-channel (RG) per-tile darkness map from raw map attributes.
 *
 * @param mapSize      Map dimensions
 * @param terrainAttrs Byte 2 of each tile (isDarkLand in bit 6). May be null.
 * @param gameplayAttrs Byte 3 of each tile (fogOfWarLevel in bits 0-5). May be null.
 * @param dilate       When true, fill gaps in dark land flags via neighbor dilation.
 * @returns Interleaved Uint8Array [R0, G0, R1, G1, ...] or null if all zeros.
 */
export function computeDarknessMap(
    mapSize: MapSize,
    terrainAttrs: Uint8Array | null,
    gameplayAttrs: Uint8Array | null,
    dilate = true
): Uint8Array | null {
    if (!terrainAttrs && !gameplayAttrs) return null;

    const w = mapSize.width;
    const h = mapSize.height;
    const len = w * h;

    // Read isDarkLand flags and optionally fill gaps
    const { flags: darkFlags, hasDark } = terrainAttrs
        ? extractDarkFlags(terrainAttrs)
        : { flags: new Uint8Array(len), hasDark: false };
    if (hasDark && dilate) {
        dilateDarkFlags(darkFlags, w, h, 3);
    }

    // Build interleaved RG output: R = dark land, G = fog of war
    const result = new Uint8Array(len * 2);
    let hasNonZero = hasDark;

    // Write dark land into R channel
    for (let i = 0; i < len; i++) {
        if (darkFlags[i]) result[i * 2] = 255;
    }

    // Write fog of war into G channel
    if (gameplayAttrs && writeFogChannel(result, gameplayAttrs, len)) {
        hasNonZero = true;
    }

    return hasNonZero ? result : null;
}
