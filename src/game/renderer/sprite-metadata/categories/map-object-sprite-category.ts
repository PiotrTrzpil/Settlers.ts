/**
 * MapObjectSpriteCategory
 *
 * Manages sprite entries for map object types (trees, stones, deposits, etc.)
 * with optional variation indices for multi-variant objects.
 *
 * @module renderer/sprite-metadata/categories
 */

import { MapObjectType } from '@/game/types/map-object-types';
import type { SpriteEntry, SerializableSpriteCategory } from '../types';
import { mapToArray, arrayToMap } from '../sprite-metadata-helpers';

export class MapObjectSpriteCategory implements SerializableSpriteCategory {
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
     * Expose the internal entries map (used by registry for lookups).
     */
    getEntries(): Map<MapObjectType, SpriteEntry[]> {
        return this.entries;
    }

    serialize(): unknown {
        return mapToArray(this.entries);
    }

    static deserialize(data: unknown): MapObjectSpriteCategory {
        const category = new MapObjectSpriteCategory();
        const map = arrayToMap(data as Array<[MapObjectType, SpriteEntry[]]>);
        for (const [k, v] of map) {
            category.entries.set(k, v);
        }
        return category;
    }
}
