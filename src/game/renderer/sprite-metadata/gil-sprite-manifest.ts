/**
 * GilSpriteManifest — declarative manifest for direct-GIL sprites.
 *
 * Encapsulates which GFX file and GIL indices a subsystem needs,
 * drives the loader (what to load) and the resolver (how to look up).
 * Reusable across any system that loads individual sprites by GIL index
 * rather than JIL job animations (selection indicators, cursors, etc.).
 */

import type { SpriteEntry } from './types';
import type { SpriteMetadataRegistry } from './sprite-metadata';
import type { SpriteTrim } from '../sprite-loader';

/** No trimming — default for HUD sprites where every pixel matters. */
const NO_TRIM: SpriteTrim = { top: 0, bottom: 0 };

export class GilSpriteManifest {
    /** GFX file number these sprites come from. */
    readonly gfxFile: number;

    /** All GIL indices this manifest requires. */
    readonly gilIndices: readonly number[];

    /** Trim config passed to the sprite loader. */
    readonly trim: SpriteTrim;

    constructor(gfxFile: number, gilIndices: readonly number[], trim: SpriteTrim = NO_TRIM) {
        this.gfxFile = gfxFile;
        this.gilIndices = gilIndices;
        this.trim = trim;
    }

    /** Resolve a single sprite from the registry. Returns null if not loaded. */
    resolve(gilIndex: number, registry: SpriteMetadataRegistry): SpriteEntry | null {
        const frames = registry.getOverlayFrames(this.gfxFile, gilIndex, 0);
        return frames?.[0] ?? null;
    }
}
