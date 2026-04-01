/**
 * ResourceSpriteCategory
 *
 * Manages sprite entries for resource/material types (dropped goods on the ground),
 * keyed by material type → direction.
 *
 * @module renderer/sprite-metadata/categories
 */

import { EMaterialType } from '@/game/economy';
import type { SpriteEntry, SerializableSpriteCategory } from '../types';
import { mapToArray, arrayToMap } from '../sprite-metadata-helpers';

export class GoodSpriteCategory implements SerializableSpriteCategory {
    /** Resource sprites keyed by material type → direction */
    private readonly entries: Map<EMaterialType, Map<number, SpriteEntry>> = new Map();

    /** Whether any good sprites have been loaded. */
    get isLoaded(): boolean {
        return this.entries.size > 0;
    }

    /**
     * Register a sprite entry for a resource/material type.
     */
    register(type: EMaterialType, direction: number, entry: SpriteEntry): void {
        let dirMap = this.entries.get(type);
        if (!dirMap) {
            dirMap = new Map();
            this.entries.set(type, dirMap);
        }
        dirMap.set(direction, entry);
    }

    /**
     * Look up the sprite entry for a resource/material type.
     * Throws if the type is not registered (sprite map bug).
     * Falls back to direction 0 if the requested direction is not found.
     */
    get(type: EMaterialType, direction: number = 0): SpriteEntry {
        const dirMap = this.entries.get(type);
        if (!dirMap) {
            throw new Error(`[GoodSpriteCategory] No sprite for material ${type}`);
        }
        const sprite = dirMap.get(direction) ?? dirMap.get(0);
        if (!sprite) {
            throw new Error(`[GoodSpriteCategory] No direction ${direction} for material ${type}`);
        }
        return sprite;
    }

    hasSprites(): boolean {
        return this.entries.size > 0;
    }

    getCount(): number {
        return this.entries.size;
    }

    clear(): void {
        this.entries.clear();
    }

    /**
     * Expose the internal map for serialization.
     */
    getEntries(): Map<EMaterialType, Map<number, SpriteEntry>> {
        return this.entries;
    }

    serialize(): unknown {
        return mapToArray(this.entries).map(([type, dirMap]) => [type, mapToArray(dirMap)]);
    }

    static deserialize(data: unknown): GoodSpriteCategory {
        const category = new GoodSpriteCategory();
        const outer = data as Array<[EMaterialType, Array<[number, SpriteEntry]>]>;
        for (const [type, dirEntries] of outer) {
            category.entries.set(type, arrayToMap(dirEntries));
        }
        return category;
    }
}
