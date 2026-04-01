/**
 * OverlaySpriteCategory
 *
 * Manages sprite frame arrays for building overlay animations (smoke, wheels, etc.)
 * Keyed by composite string: "gfxFile:jobIndex:directionIndex"
 *
 * @module renderer/sprite-metadata/categories
 */

import type { SpriteEntry, SerializableSpriteCategory } from '../types';
import { mapToArray, arrayToMap } from '../sprite-metadata-helpers';

/** Composite key for overlay sprite lookup */
function overlayKey(gfxFile: number, jobIndex: number, directionIndex: number): string {
    return `${gfxFile}:${jobIndex}:${directionIndex}`;
}

export class OverlaySpriteCategory implements SerializableSpriteCategory {
    /**
     * Overlay sprites keyed by "gfxFile:jobIndex:directionIndex" → frame array.
     */
    private readonly frames: Map<string, SpriteEntry[]>;

    constructor(frames: Map<string, SpriteEntry[]> = new Map()) {
        this.frames = frames;
    }

    /**
     * Register sprite frames for a building overlay.
     * @param gfxFile GFX file number
     * @param jobIndex JIL job index
     * @param directionIndex DIL direction index (usually 0)
     * @param entries All animation frames for this overlay
     */
    register(gfxFile: number, jobIndex: number, directionIndex: number, entries: SpriteEntry[]): void {
        this.frames.set(overlayKey(gfxFile, jobIndex, directionIndex), entries);
    }

    /**
     * Get loaded overlay sprite frames.
     * Returns null if the overlay hasn't been loaded.
     */
    get(gfxFile: number, jobIndex: number, directionIndex: number): readonly SpriteEntry[] | undefined {
        return this.frames.get(overlayKey(gfxFile, jobIndex, directionIndex));
    }

    clear(): void {
        this.frames.clear();
    }

    /**
     * Serialize the frames map to a JSON-safe array of composite-key/frames pairs.
     * Format: Array<[compositeKey, SpriteEntry[]]>
     */
    serialize(): unknown {
        return mapToArray(this.frames);
    }

    /**
     * Reconstruct an OverlaySpriteCategory from its serialized form.
     * The composite keys ("gfxFile:jobIndex:directionIndex") are stored and restored as-is.
     */
    static deserialize(data: unknown): OverlaySpriteCategory {
        const entries = data as Array<[string, SpriteEntry[]]>;
        return new OverlaySpriteCategory(arrayToMap(entries));
    }
}
