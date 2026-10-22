/**
 * Camera-relative volume and stereo pan for sounds placed on the map.
 */

/** What the camera hears: center tile and audible radius (in tiles). */
export interface SoundListener {
    x: number;
    y: number;
    radius: number;
}

/** Volume at the edge of the audible radius (center is 1). */
const EDGE_GAIN = 0.3;
const MAX_PAN = 0.7;

/** Horizontal screen position of a tile (rows are offset by half a tile). */
function screenX(p: { x: number; y: number }): number {
    return p.x - p.y * 0.5;
}

/** Screen-space distance between two tiles, in tiles. */
export function tileDistance(a: { x: number; y: number }, b: { x: number; y: number }): number {
    return Math.hypot(screenX(a) - screenX(b), a.y - b.y);
}

/** Gain and pan for a sound at `pos`, or null if it is outside the audible radius. */
export function positionalMix(
    listener: SoundListener,
    pos: { x: number; y: number }
): { gain: number; pan: number } | null {
    const d = tileDistance(pos, listener);
    if (d > listener.radius) {
        return null;
    }
    const gain = 1 - (1 - EDGE_GAIN) * (d / listener.radius);
    const pan = Math.max(-1, Math.min(1, (screenX(pos) - screenX(listener)) / listener.radius)) * MAX_PAN;
    return { gain, pan };
}
