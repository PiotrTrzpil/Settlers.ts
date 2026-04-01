/**
 * JIL frame skip registry — corrects glitched frames in original game art.
 *
 * Some JIL animation jobs have frames with position glitches, wrong offsets,
 * or other artifacts. This module declares which frames to skip per job
 * and provides a utility to apply the skips after loading.
 *
 * @module renderer/sprite-metadata/jil-frame-skips
 */

/** Declares which frames to skip when loading a JIL job animation. */
export interface JilFrameSkip {
    /** Number of leading frames to discard */
    skipLeading?: number;
    /** Number of trailing frames to discard */
    skipTrailing?: number;
    /** Specific 0-based frame indices to remove */
    skipIndices?: readonly number[];
}

/**
 * Per-job frame skip declarations.
 * Key = JIL job index, value = which frames to skip and why.
 */
const JIL_FRAME_SKIPS: ReadonlyMap<number, JilFrameSkip> = new Map([
    // DarkTree3B (job 248): frames 0-1 have a ~2px horizontal offset glitch in original art
    [248, { skipLeading: 2 }],
]);

/** Apply declared frame skips for a JIL job. Returns the filtered array (or the original if no skip). */
export function applyJilFrameSkips<T>(frames: readonly T[], job: number): T[] {
    const skip = JIL_FRAME_SKIPS.get(job);
    if (!skip) {
        return frames as T[];
    }

    const start = skip.skipLeading ?? 0; // eslint-disable-line no-restricted-syntax -- optional with 0 default
    const end = frames.length - (skip.skipTrailing ?? 0); // eslint-disable-line no-restricted-syntax -- optional with 0 default

    if (start >= end) {
        return frames as T[];
    }

    let result = frames.slice(start, end);

    if (skip.skipIndices?.length) {
        const removeSet = new Set(skip.skipIndices.map(i => i - start));
        result = result.filter((_, i) => !removeSet.has(i));
    }

    return result;
}
