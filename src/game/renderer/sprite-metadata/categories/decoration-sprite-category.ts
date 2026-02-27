/**
 * DecorationSpriteCategory
 *
 * Manages sprite entries for decoration-type sprites: flags and territory dots.
 * Flags are keyed by playerIndex → animation frame.
 * Territory dots are keyed by playerIndex (0-7).
 *
 * @module renderer/sprite-metadata/categories
 */

import type { SpriteEntry } from '../types';

export class DecorationSpriteCategory {
    /** Flag sprites keyed by playerIndex → frame[] */
    private readonly flags: Map<number, SpriteEntry[]> = new Map();
    /** Territory dot sprites keyed by playerIndex (0-7) */
    private readonly territoryDots: Map<number, SpriteEntry> = new Map();

    // ---- Flags ----

    /**
     * Register a flag sprite frame for a player index.
     * @param playerIndex 0-7 (8 team colors)
     * @param frame Animation frame index (0-23)
     */
    registerFlag(playerIndex: number, frame: number, entry: SpriteEntry): void {
        let frames = this.flags.get(playerIndex);
        if (!frames) {
            frames = [];
            this.flags.set(playerIndex, frames);
        }
        frames[frame] = entry;
    }

    /**
     * Get a flag sprite frame for a player index and animation frame.
     */
    getFlag(playerIndex: number, frame: number): SpriteEntry | null {
        return this.flags.get(playerIndex)?.[frame] ?? null;
    }

    /** Number of flag animation frames per player color. */
    getFlagFrameCount(playerIndex: number): number {
        return this.flags.get(playerIndex)?.length ?? 0;
    }

    hasFlagSprites(): boolean {
        return this.flags.size > 0;
    }

    // ---- Territory Dots ----

    /** Register a territory dot sprite for a player index (0-7). */
    registerTerritoryDot(playerIndex: number, entry: SpriteEntry): void {
        this.territoryDots.set(playerIndex, entry);
    }

    /** Get the territory dot sprite for a player index. */
    getTerritoryDot(playerIndex: number): SpriteEntry | null {
        return this.territoryDots.get(playerIndex) ?? null;
    }

    hasTerritoryDotSprites(): boolean {
        return this.territoryDots.size > 0;
    }

    clear(): void {
        this.flags.clear();
        this.territoryDots.clear();
    }

    /**
     * Expose the internal flags map for serialization.
     */
    getFlagsMap(): Map<number, SpriteEntry[]> {
        return this.flags;
    }

    /**
     * Replace the entire flags map (used during deserialization).
     */
    setFlagsMap(flags: Map<number, SpriteEntry[]>): void {
        this.flags.clear();
        for (const [k, v] of flags) this.flags.set(k, v);
    }
}
