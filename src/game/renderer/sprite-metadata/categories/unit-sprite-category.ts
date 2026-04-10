/**
 * UnitSpriteCategory
 *
 * Manages sprite entries for unit types, keyed by race → unitType → direction.
 *
 * @module renderer/sprite-metadata/categories
 */

import { UnitType } from '@/game/entity';
import { Race } from '@/game/core/race';
import type { SpriteEntry, SerializableSpriteCategory } from '../types';
import { mapToArray, arrayToMap } from '../sprite-metadata-helpers';

export class UnitSpriteCategory implements SerializableSpriteCategory {
    /** Unit sprites keyed by race → unitType → direction */
    private readonly byRace: Map<Race, Map<UnitType, Map<number, SpriteEntry>>> = new Map();
    private readonly _loadedRaces: Set<Race> = new Set();

    get loadedRaces(): ReadonlySet<Race> {
        return this._loadedRaces;
    }

    /** Whether sprites have been loaded for a given race. */
    isRaceLoaded(race: Race): boolean {
        return this._loadedRaces.has(race);
    }

    /**
     * Register a sprite entry for a unit type and direction.
     * @param direction Sprite direction index (see SpriteDirection enum)
     */
    register(type: UnitType, direction: number, entry: SpriteEntry, race: Race): void {
        let raceMap = this.byRace.get(race);
        if (!raceMap) {
            raceMap = new Map();
            this.byRace.set(race, raceMap);
        }
        let dirMap = raceMap.get(type);
        if (!dirMap) {
            dirMap = new Map();
            raceMap.set(type, dirMap);
        }
        dirMap.set(direction, entry);
        this._loadedRaces.add(race);
    }

    /**
     * Look up the sprite entry for a unit type, direction, and race.
     * Throws if the race is loaded but the unit type is missing.
     * @param direction Sprite direction index (see SpriteDirection enum) (defaults to RIGHT)
     */
    get(type: UnitType, direction: number = 0, race: Race): SpriteEntry {
        const dirMap = this.byRace.get(race)?.get(type);
        if (!dirMap) {
            throw new Error(`[UnitSpriteCategory] No sprite for unit ${type} (race=${race})`);
        }
        return dirMap.get(direction) ?? dirMap.get(0)!;
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
     * Expose the internal map for SpriteMetadataRegistry.getLayersForUnits().
     */
    getRaceMap(): Map<Race, Map<UnitType, Map<number, SpriteEntry>>> {
        return this.byRace;
    }

    serialize(): unknown {
        return mapToArray(
            new Map(
                Array.from(this.byRace.entries()).map(([race, typeMap]) => [
                    race,
                    mapToArray(
                        new Map(
                            Array.from(typeMap.entries()).map(([unitType, dirMap]) => [unitType, mapToArray(dirMap)])
                        )
                    ),
                ])
            )
        );
    }

    static deserialize(data: unknown): UnitSpriteCategory {
        const category = new UnitSpriteCategory();
        const raceEntries = data as Array<[Race, Array<[UnitType, Array<[number, SpriteEntry]>]>]>;
        for (const [race, typeEntries] of raceEntries) {
            const typeMap = arrayToMap(
                typeEntries.map(
                    ([unitType, dirEntries]) =>
                        [unitType, arrayToMap(dirEntries)] as [UnitType, Map<number, SpriteEntry>]
                )
            );
            category.byRace.set(race, typeMap);
            category._loadedRaces.add(race);
        }
        return category;
    }
}
