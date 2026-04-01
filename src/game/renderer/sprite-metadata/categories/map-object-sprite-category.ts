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
import { LogHandler } from '@/utilities/log-handler';

const log = new LogHandler('MapObjectSpriteCategory');

export class MapObjectSpriteCategory implements SerializableSpriteCategory {
    /** Map object sprites keyed by type → variation[] */
    private readonly entries: Map<MapObjectType, SpriteEntry[]> = new Map();
    /** Tracks types already warned about to avoid log spam in the render loop. */
    private readonly warnedTypes: Set<number> = new Set();
    /** True once all map object sprite loading has completed. Prevents false "no sprite" warnings during async loading. */
    private loadingComplete = false;

    /** Whether any map object sprites have been loaded. */
    get isLoaded(): boolean {
        return this.entries.size > 0;
    }

    /** Mark sprite loading as complete — enables "no sprite" warnings for genuinely missing types. */
    markLoadingComplete(): void {
        this.loadingComplete = true;
    }

    /**
     * Register a sprite entry for a map object type (with optional variation index).
     */
    register(type: MapObjectType, entry: SpriteEntry, variation: number = 0): void {
        // eslint-disable-next-line no-restricted-syntax -- accumulator pattern: Map may not yet have an entry for this type
        const existing = this.entries.get(type) ?? [];
        if (existing.length <= variation) {
            existing.length = variation + 1;
        }
        existing[variation] = entry;
        this.entries.set(type, existing);
    }

    /**
     * Look up the sprite entry for a map object type (and optional variation).
     * Returns undefined if the type or variation is not registered.
     */
    get(type: MapObjectType, variation: number = 0): SpriteEntry | undefined {
        const variants = this.entries.get(type);
        if (!variants) {
            if (this.loadingComplete && !this.warnedTypes.has(type)) {
                this.warnedTypes.add(type);
                log.info(`No sprite for map object ${type}`);
            }
            return undefined;
        }
        const sprite = variants[variation];
        if (!sprite) {
            const key = type * 1000 + variation;
            if (!this.warnedTypes.has(key)) {
                this.warnedTypes.add(key);
                log.info(`No variation ${variation} for map object ${type}`);
            }
            return undefined;
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
        this.warnedTypes.clear();
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
        category.loadingComplete = true;
        return category;
    }
}
