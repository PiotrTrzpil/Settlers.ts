/**
 * DecorationSpriteCategory
 *
 * Manages sprite entries for decoration-type sprites: flags and territory dots.
 * Flags are keyed by playerIndex → animation frame.
 * Territory dots are keyed by playerIndex (0-7).
 *
 * @module renderer/sprite-metadata/categories
 */

import type { SpriteEntry, SerializableSpriteCategory } from '../types';
import { mapToArray, arrayToMap } from '../sprite-metadata-helpers';

interface SerializedDecorationData {
    flags: Array<[number, SpriteEntry[]]>;
    flagsDown: Array<[number, SpriteEntry[]]>;
    territoryDots: Array<[number, SpriteEntry]>;
}

export class DecorationSpriteCategory implements SerializableSpriteCategory {
    /** Normal (upright) flag sprites: playerIndex → frame[] */
    private readonly flags: Map<number, SpriteEntry[]> = new Map();
    /** Lowered (paused) flag sprites: playerIndex → frame[] */
    private readonly flagsDown: Map<number, SpriteEntry[]> = new Map();
    /** Territory dot sprites keyed by playerIndex (0-7) */
    private readonly territoryDots: Map<number, SpriteEntry> = new Map();

    // ---- Flags ----

    /**
     * Register a normal (upright) flag sprite frame for a player index.
     * @param playerIndex 0-7 (8 team colors)
     * @param frame Animation frame index (0-11)
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
     * Register a lowered (paused) flag sprite frame for a player index.
     * @param playerIndex 0-7 (8 team colors)
     * @param frame Animation frame index (0-11)
     */
    registerFlagDown(playerIndex: number, frame: number, entry: SpriteEntry): void {
        let frames = this.flagsDown.get(playerIndex);
        if (!frames) {
            frames = [];
            this.flagsDown.set(playerIndex, frames);
        }
        frames[frame] = entry;
    }

    /** Get a normal flag sprite frame for a player index and animation frame. */
    getFlag(playerIndex: number, frame: number): SpriteEntry | null {
        return this.flags.get(playerIndex)?.[frame] ?? null;
    }

    /** Get a lowered flag sprite frame for a player index and animation frame. */
    getFlagDown(playerIndex: number, frame: number): SpriteEntry | null {
        return this.flagsDown.get(playerIndex)?.[frame] ?? null;
    }

    /** Number of normal flag animation frames per player color. */
    getFlagFrameCount(playerIndex: number): number {
        return this.flags.get(playerIndex)?.length ?? 0;
    }

    /** Number of lowered flag animation frames per player color. */
    getFlagDownFrameCount(playerIndex: number): number {
        return this.flagsDown.get(playerIndex)?.length ?? 0;
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
        this.flagsDown.clear();
        this.territoryDots.clear();
    }

    serialize(): unknown {
        const data: SerializedDecorationData = {
            flags: mapToArray(this.flags),
            flagsDown: mapToArray(this.flagsDown),
            territoryDots: mapToArray(this.territoryDots),
        };
        return data;
    }

    static deserialize(data: unknown): DecorationSpriteCategory {
        const typed = data as SerializedDecorationData;
        const category = new DecorationSpriteCategory();
        const flagsMap = arrayToMap(typed.flags);
        const flagsDownMap = arrayToMap(typed.flagsDown);
        const territoryDotsMap = arrayToMap(typed.territoryDots);
        for (const [k, v] of flagsMap) {
            category.flags.set(k, v);
        }
        for (const [k, v] of flagsDownMap) {
            category.flagsDown.set(k, v);
        }
        for (const [k, v] of territoryDotsMap) {
            category.territoryDots.set(k, v);
        }
        return category;
    }
}
