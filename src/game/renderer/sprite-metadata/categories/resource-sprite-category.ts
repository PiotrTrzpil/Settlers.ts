/**
 * ResourceSpriteCategory
 *
 * Manages sprite entries for resource/material types (dropped goods on the ground),
 * keyed by material type → direction.
 *
 * @module renderer/sprite-metadata/categories
 */

import { EMaterialType } from '@/game/economy';
import type { SpriteEntry } from '../types';

export class ResourceSpriteCategory {
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
        if (!dirMap) return null;
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

    /**
     * Replace the entire entries map (used during deserialization).
     */
    setEntries(entries: Map<EMaterialType, Map<number, SpriteEntry>>): void {
        this.entries.clear();
        for (const [k, v] of entries) this.entries.set(k, v);
    }
}
