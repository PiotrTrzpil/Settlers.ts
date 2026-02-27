/**
 * OverlaySpriteCategory
 *
 * Manages sprite frame arrays for building overlay animations (smoke, wheels, etc.)
 * Keyed by composite string: "gfxFile:jobIndex:directionIndex"
 *
 * @module renderer/sprite-metadata/categories
 */

import type { SpriteEntry } from '../types';

/** Composite key for overlay sprite lookup */
function overlayKey(gfxFile: number, jobIndex: number, directionIndex: number): string {
    return `${gfxFile}:${jobIndex}:${directionIndex}`;
}

export class OverlaySpriteCategory {
    /**
     * Overlay sprites keyed by "gfxFile:jobIndex:directionIndex" → frame array.
     */
    private readonly frames: Map<string, SpriteEntry[]> = new Map();

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
    get(gfxFile: number, jobIndex: number, directionIndex: number): readonly SpriteEntry[] | null {
        return this.frames.get(overlayKey(gfxFile, jobIndex, directionIndex)) ?? null;
    }

    clear(): void {
        this.frames.clear();
    }

    /**
     * Expose the internal map for serialization.
     */
    getFramesMap(): Map<string, SpriteEntry[]> {
        return this.frames;
    }
}
