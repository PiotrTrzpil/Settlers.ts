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
    private readonly byRace: Map<number, Map<UnitType, Map<number, SpriteEntry>>> = new Map();
    private readonly _loadedRaces: Set<number> = new Set();
    private readonly _warnedUnits = new Set<string>();

    get loadedRaces(): ReadonlySet<number> {
        return this._loadedRaces;
    }

    /**
     * Register a sprite entry for a unit type and direction.
     * @param direction Sprite direction index (see SpriteDirection enum)
     */
    register(type: UnitType, direction: number, entry: SpriteEntry, race: number): void {
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
     * @param direction Sprite direction index (see SpriteDirection enum) (defaults to 0)
     */
    get(type: UnitType, direction: number = 0, race?: number): SpriteEntry | null {
        let dirMap: Map<number, SpriteEntry> | undefined;
        if (race !== undefined) {
            dirMap = this.byRace.get(race)?.get(type);
            if (!dirMap) {
                this.warnMissing(type, race);
                return null;
            }
        } else {
            // No race specified — find in any loaded race (legacy callers only)
            for (const raceMap of this.byRace.values()) {
                dirMap = raceMap.get(type);
                if (dirMap) {
                    break;
                }
            }
            if (!dirMap) {
                return null;
            }
        }
        return dirMap.get(direction) ?? dirMap.get(0) ?? null;
    }

    private warnMissing(type: UnitType, race: number): void {
        // Don't warn if this race hasn't finished loading yet — the sprite may arrive soon
        if (!this._loadedRaces.has(race)) {
            return;
        }
        const key = `${race}:${type}`;
        if (this._warnedUnits.has(key)) {
            return;
        }
        this._warnedUnits.add(key);
        console.warn(`[SpriteRegistry] No sprite for unit ${type} (race=${Race[race]})`);
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
    getRaceMap(): Map<number, Map<UnitType, Map<number, SpriteEntry>>> {
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
        const raceEntries = data as Array<[number, Array<[UnitType, Array<[number, SpriteEntry]>]>]>;
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
