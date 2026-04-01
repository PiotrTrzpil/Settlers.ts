/**
 * DecorationSpriteCategory
 *
 * Manages sprite entries for decoration-type sprites: flags and territory dots.
 * Flags are keyed by playerIndex → animation frame.
 * Territory dots are keyed by playerIndex (0-7).
 *
 * @module renderer/sprite-metadata/categories
 */

import type { SpriteEntry, AnimatedSpriteEntry, SerializableSpriteCategory } from '../types';
import { ANIMATION_DEFAULTS } from '@/game/animation/animation';
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
    getFlag(playerIndex: number, frame: number): SpriteEntry {
        const frames = this.flags.get(playerIndex);
        if (!frames) {
            throw new Error(`[DecorationSpriteCategory] No flag sprites for player ${playerIndex}`);
        }
        const sprite = frames[frame];
        if (!sprite) {
            throw new Error(`[DecorationSpriteCategory] No flag frame ${frame} for player ${playerIndex}`);
        }
        return sprite;
    }

    /** Get a lowered flag sprite frame for a player index and animation frame. */
    getFlagDown(playerIndex: number, frame: number): SpriteEntry {
        const frames = this.flagsDown.get(playerIndex);
        if (!frames) {
            throw new Error(`[DecorationSpriteCategory] No flag-down sprites for player ${playerIndex}`);
        }
        const sprite = frames[frame];
        if (!sprite) {
            throw new Error(`[DecorationSpriteCategory] No flag-down frame ${frame} for player ${playerIndex}`);
        }
        return sprite;
    }

    /** Number of normal flag animation frames per player color. */
    getFlagFrameCount(playerIndex: number): number {
        // eslint-disable-next-line no-restricted-syntax -- player index may have no flags registered yet; 0 frames is correct
        return this.flags.get(playerIndex)?.length ?? 0;
    }

    /** Number of lowered flag animation frames per player color. */
    getFlagDownFrameCount(playerIndex: number): number {
        // eslint-disable-next-line no-restricted-syntax -- player index may have no flags registered yet; 0 frames is correct
        return this.flagsDown.get(playerIndex)?.length ?? 0;
    }

    hasFlagSprites(): boolean {
        return this.flags.size > 0;
    }

    /** Build an AnimatedSpriteEntry from all normal flag frames for a player. */
    getFlagAnimation(playerIndex: number): AnimatedSpriteEntry {
        return this.buildFlagAnimation(this.flags, playerIndex, 'flag');
    }

    /** Build an AnimatedSpriteEntry from all lowered flag frames for a player. */
    getFlagDownAnimation(playerIndex: number): AnimatedSpriteEntry {
        return this.buildFlagAnimation(this.flagsDown, playerIndex, 'flag-down');
    }

    private buildFlagAnimation(store: Map<number, SpriteEntry[]>, playerIndex: number, label: string): AnimatedSpriteEntry {
        const frames = store.get(playerIndex);
        if (!frames || frames.length === 0) {
            throw new Error(`[DecorationSpriteCategory] No ${label} frames for player ${playerIndex}`);
        }
        const sequence = { frames, frameDurationMs: ANIMATION_DEFAULTS.FRAME_DURATION_MS, loop: true };
        const directionMap = new Map([[0, sequence]]);
        return {
            staticSprite: frames[0]!,
            animationData: { sequences: new Map([['default', directionMap]]), defaultSequence: 'default' },
            isAnimated: true,
        };
    }

    // ---- Territory Dots ----

    /** Register a territory dot sprite for a player index (0-7). */
    registerTerritoryDot(playerIndex: number, entry: SpriteEntry): void {
        this.territoryDots.set(playerIndex, entry);
    }

    /** Get the territory dot sprite for a player index. */
    getTerritoryDot(playerIndex: number): SpriteEntry {
        const sprite = this.territoryDots.get(playerIndex);
        if (!sprite) {
            throw new Error(`[DecorationSpriteCategory] No territory dot for player ${playerIndex}`);
        }
        return sprite;
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
