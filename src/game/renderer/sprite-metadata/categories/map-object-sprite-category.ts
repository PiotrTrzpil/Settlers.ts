/**
 * MapObjectSpriteCategory
 *
 * Manages sprite entries for map object types (trees, stones, deposits, etc.)
 * with optional variation indices for multi-variant objects.
 *
 * @module renderer/sprite-metadata/categories
 */

import { MapObjectType } from '@/game/types/map-object-types';
import type { SpriteEntry } from '../types';

export class MapObjectSpriteCategory {
    /** Map object sprites keyed by type → variation[] */
    private readonly entries: Map<MapObjectType, SpriteEntry[]> = new Map();

    /**
     * Register a sprite entry for a map object type (with optional variation index).
     */
    register(type: MapObjectType, entry: SpriteEntry, variation: number = 0): void {
        const existing = this.entries.get(type) ?? [];
        if (existing.length <= variation) {
            existing.length = variation + 1;
        }
        existing[variation] = entry;
        this.entries.set(type, existing);
    }

    /**
     * Look up the sprite entry for a map object type (and optional variation).
     * Returns null if no sprite is registered for this type.
     */
    get(type: MapObjectType, variation: number = 0): SpriteEntry | null {
        return this.entries.get(type)?.[variation] ?? null;
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
    getEntries(): Map<MapObjectType, SpriteEntry[]> {
        return this.entries;
    }

    /**
     * Replace the entire entries map (used during deserialization).
     */
    setEntries(entries: Map<MapObjectType, SpriteEntry[]>): void {
        this.entries.clear();
        for (const [k, v] of entries) this.entries.set(k, v);
    }
}
