/**
 * ConstructionSpriteCategory
 *
 * Manages construction-state (D0) sprite entries for building types, keyed by race → buildingType.
 * Separated from completed sprites so construction sprites can be loaded later (deferred).
 *
 * @module renderer/sprite-metadata/categories
 */

import { BuildingType } from '@/game/entity';
import type { SpriteEntry, SerializableSpriteCategory } from '../types';
import { mapToArray, arrayToMap } from '../sprite-metadata-helpers';

export class ConstructionSpriteCategory implements SerializableSpriteCategory {
    /** Construction building sprites keyed by race → buildingType */
    private readonly byRace: Map<number, Map<BuildingType, SpriteEntry>> = new Map();
    private readonly _loadedRaces: Set<number> = new Set();

    get loadedRaces(): ReadonlySet<number> {
        return this._loadedRaces;
    }

    /** Whether construction sprites have been loaded for a given race. */
    isRaceLoaded(race: number): boolean {
        return this._loadedRaces.has(race);
    }

    /** Register the construction sprite for a building type. */
    register(type: BuildingType, sprite: SpriteEntry, race: number): void {
        let raceMap = this.byRace.get(race);
        if (!raceMap) {
            raceMap = new Map();
            this.byRace.set(race, raceMap);
        }
        raceMap.set(type, sprite);
        this._loadedRaces.add(race);
    }

    /**
     * Look up the construction sprite for a building type and race.
     * Throws if the race is loaded but the building type is missing.
     */
    get(type: BuildingType, race: number): SpriteEntry {
        const sprite = this.byRace.get(race)?.get(type);
        if (!sprite) {
            throw new Error(`[ConstructionSpriteCategory] No construction sprite for ${type} (race=${race})`);
        }
        return sprite;
    }

    hasSprites(): boolean {
        return this.byRace.size > 0;
    }

    clear(): void {
        this.byRace.clear();
        this._loadedRaces.clear();
    }

    serialize(): unknown {
        return mapToArray(this.byRace).map(([race, typeMap]) => [race, mapToArray(typeMap)]);
    }

    static deserialize(data: unknown): ConstructionSpriteCategory {
        const category = new ConstructionSpriteCategory();
        const rows = data as Array<[number, Array<[BuildingType, SpriteEntry]>]>;
        for (const [race, typeEntries] of rows) {
            const typeMap = arrayToMap(typeEntries);
            category.byRace.set(race, typeMap);
            category._loadedRaces.add(race);
        }
        return category;
    }
}
