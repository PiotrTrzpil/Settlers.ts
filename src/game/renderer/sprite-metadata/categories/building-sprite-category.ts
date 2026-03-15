/**
 * BuildingSpriteCategory
 *
 * Manages sprite entries for building types, keyed by race → buildingType.
 * Stores both construction (D0) and completed (D1) state sprites.
 *
 * @module renderer/sprite-metadata/categories
 */

import { BuildingType } from '@/game/entity';
import type { SpriteEntry, SerializableSpriteCategory } from '../types';
import { mapToArray, arrayToMap } from '../sprite-metadata-helpers';

/**
 * Building sprite entries with both construction and completed states.
 */
export interface BuildingSpriteEntries {
    /** Construction state sprite (D0) */
    construction: SpriteEntry | null;
    /** Completed state sprite (D1) */
    completed: SpriteEntry | null;
}

export class BuildingSpriteCategory implements SerializableSpriteCategory {
    /** Building sprites keyed by race → buildingType */
    private readonly byRace: Map<number, Map<BuildingType, BuildingSpriteEntries>> = new Map();
    private readonly _loadedRaces: Set<number> = new Set();

    get loadedRaces(): ReadonlySet<number> {
        return this._loadedRaces;
    }

    /**
     * Register sprite entries for a building type (both construction and completed).
     */
    register(type: BuildingType, construction: SpriteEntry | null, completed: SpriteEntry | null, race: number): void {
        let raceMap = this.byRace.get(race);
        if (!raceMap) {
            raceMap = new Map();
            this.byRace.set(race, raceMap);
        }
        raceMap.set(type, { construction, completed });
        this._loadedRaces.add(race);
    }

    /**
     * Look up the completed sprite entry for a building type and race.
     * Falls back to any loaded race if the requested race has no sprites.
     */
    getCompleted(type: BuildingType, race: number): SpriteEntry | null {
        return this.byRace.get(race)?.get(type)?.completed ?? this.getFallback(type)?.completed ?? null;
    }

    /**
     * Look up the construction sprite entry for a building type and race.
     */
    getConstruction(type: BuildingType, race: number): SpriteEntry | null {
        return this.byRace.get(race)?.get(type)?.construction ?? this.getFallback(type)?.construction ?? null;
    }

    /**
     * Get both construction and completed sprites for a building type and race.
     */
    getSprites(type: BuildingType, race: number): BuildingSpriteEntries | null {
        return this.byRace.get(race)?.get(type) ?? this.getFallback(type) ?? null;
    }

    /** Fallback: find building in any loaded race */
    private getFallback(type: BuildingType): BuildingSpriteEntries | null {
        for (const raceMap of this.byRace.values()) {
            const entry = raceMap.get(type);
            if (entry) {
                return entry;
            }
        }
        return null;
    }

    hasSprites(): boolean {
        return this.byRace.size > 0;
    }

    getCount(): number {
        let count = 0;
        for (const raceMap of this.byRace.values()) {
            count += raceMap.size;
        }
        return count;
    }

    clear(): void {
        this.byRace.clear();
        this._loadedRaces.clear();
    }

    /**
     * Expose the internal map for use by SpriteMetadataRegistry.getLayersForBuildings().
     */
    getRaceMap(): Map<number, Map<BuildingType, BuildingSpriteEntries>> {
        return this.byRace;
    }

    /**
     * Produce a JSON-safe representation of the category's data.
     * Format: Array<[race, Array<[BuildingType, BuildingSpriteEntries]>]>
     */
    serialize(): unknown {
        return mapToArray(this.byRace).map(([race, typeMap]) => [race, mapToArray(typeMap)]);
    }

    /**
     * Reconstruct a BuildingSpriteCategory from serialized data.
     * Expects the format produced by serialize().
     */
    static deserialize(data: unknown): BuildingSpriteCategory {
        const category = new BuildingSpriteCategory();
        const rows = data as Array<[number, Array<[BuildingType, BuildingSpriteEntries]>]>;
        for (const [race, typeEntries] of rows) {
            const typeMap = arrayToMap(typeEntries);
            category.byRace.set(race, typeMap);
            category._loadedRaces.add(race);
        }
        return category;
    }
}
