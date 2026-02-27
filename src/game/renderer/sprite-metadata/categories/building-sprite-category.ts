/**
 * BuildingSpriteCategory
 *
 * Manages sprite entries for building types, keyed by race → buildingType.
 * Stores both construction (D0) and completed (D1) state sprites.
 *
 * @module renderer/sprite-metadata/categories
 */

import { BuildingType } from '@/game/entity';
import type { SpriteEntry } from '../types';

/**
 * Building sprite entries with both construction and completed states.
 */
export interface BuildingSpriteEntries {
    /** Construction state sprite (D0) */
    construction: SpriteEntry | null;
    /** Completed state sprite (D1) */
    completed: SpriteEntry | null;
}

export class BuildingSpriteCategory {
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
            if (entry) return entry;
        }
        return null;
    }

    hasSprites(): boolean {
        return this.byRace.size > 0;
    }

    getCount(): number {
        let count = 0;
        for (const raceMap of this.byRace.values()) count += raceMap.size;
        return count;
    }

    clear(): void {
        this.byRace.clear();
        this._loadedRaces.clear();
    }

    /**
     * Expose the internal map for serialization.
     */
    getRaceMap(): Map<number, Map<BuildingType, BuildingSpriteEntries>> {
        return this.byRace;
    }

    /**
     * Set race map directly (used during deserialization).
     */
    setRaceEntry(race: number, typeMap: Map<BuildingType, BuildingSpriteEntries>): void {
        this.byRace.set(race, typeMap);
        this._loadedRaces.add(race);
    }
}
