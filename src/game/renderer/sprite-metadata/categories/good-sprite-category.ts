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
     * Returns null if no sprite is registered for this type.
     * Falls back to direction 0 if the requested direction is not found.
     */
    get(type: EMaterialType, direction: number = 0): SpriteEntry | null {
        const dirMap = this.entries.get(type);
        if (!dirMap) {
            return null;
        }
        return dirMap.get(direction) ?? dirMap.get(0) ?? null;
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
