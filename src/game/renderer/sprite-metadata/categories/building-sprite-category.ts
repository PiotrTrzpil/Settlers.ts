/**
 * BuildingSpriteCategory
 *
 * Manages completed-state (D1) sprite entries for building types, keyed by race → buildingType.
 * Construction sprites are in ConstructionSpriteCategory (separate, deferrable).
 *
 * @module renderer/sprite-metadata/categories
 */

import { BuildingType } from '@/game/entity';
import { Race } from '@/game/core/race';
import type { SpriteEntry, SerializableSpriteCategory } from '../types';
import { mapToArray, arrayToMap } from '../sprite-metadata-helpers';

export class BuildingSpriteCategory implements SerializableSpriteCategory {
    /** Completed building sprites keyed by race → buildingType */
    private readonly byRace: Map<Race, Map<BuildingType, SpriteEntry>> = new Map();
    private readonly _loadedRaces: Set<Race> = new Set();

    get loadedRaces(): ReadonlySet<Race> {
        return this._loadedRaces;
    }

    /** Whether sprites have been loaded for a given race. */
    isRaceLoaded(race: Race): boolean {
        return this._loadedRaces.has(race);
    }

    /** Register the completed sprite for a building type. */
    register(type: BuildingType, sprite: SpriteEntry, race: Race): void {
        let raceMap = this.byRace.get(race);
        if (!raceMap) {
            raceMap = new Map();
            this.byRace.set(race, raceMap);
        }
        raceMap.set(type, sprite);
        this._loadedRaces.add(race);
    }

    /**
     * Look up the completed sprite for a building type and race.
     * Throws if the race is loaded but the building type is missing.
     */
    get(type: BuildingType, race: Race): SpriteEntry {
        const sprite = this.byRace.get(race)?.get(type);
        if (!sprite) {
            throw new Error(`[BuildingSpriteCategory] No completed sprite for ${type} (race=${race})`);
        }
        return sprite;
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

    /** Expose the internal map for layer analysis. */
    getRaceMap(): ReadonlyMap<Race, ReadonlyMap<BuildingType, SpriteEntry>> {
        return this.byRace;
    }

    serialize(): unknown {
        return mapToArray(this.byRace).map(([race, typeMap]) => [race, mapToArray(typeMap)]);
    }

    static deserialize(data: unknown): BuildingSpriteCategory {
        const category = new BuildingSpriteCategory();
        const rows = data as Array<[Race, Array<[BuildingType, SpriteEntry]>]>;
        for (const [race, typeEntries] of rows) {
            const typeMap = arrayToMap(typeEntries);
            category.byRace.set(race, typeMap);
            category._loadedRaces.add(race);
        }
        return category;
    }
}
