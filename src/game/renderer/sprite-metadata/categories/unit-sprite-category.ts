/**
 * UnitSpriteCategory
 *
 * Manages sprite entries for unit types, keyed by race → unitType → direction.
 *
 * @module renderer/sprite-metadata/categories
 */

import { UnitType } from '@/game/entity';
import { Race } from '@/game/race';
import type { SpriteEntry } from '../types';

export class UnitSpriteCategory {
    /** Unit sprites keyed by race → unitType → direction */
    private readonly byRace: Map<number, Map<UnitType, Map<number, SpriteEntry>>> = new Map();
    private readonly _loadedRaces: Set<number> = new Set();
    private readonly _warnedUnits = new Set<string>();

    get loadedRaces(): ReadonlySet<number> {
        return this._loadedRaces;
    }

    /**
     * Register a sprite entry for a unit type and direction.
     * @param direction 0=RIGHT, 1=RIGHT_BOTTOM, 2=LEFT_BOTTOM, 3=LEFT
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
     * @param direction 0=RIGHT, 1=RIGHT_BOTTOM, 2=LEFT_BOTTOM, 3=LEFT (defaults to 0)
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
                if (dirMap) break;
            }
            if (!dirMap) return null;
        }
        return dirMap.get(direction) ?? dirMap.get(0) ?? null;
    }

    private warnMissing(type: UnitType, race: number): void {
        // Don't warn if this race hasn't finished loading yet — the sprite may arrive soon
        if (!this._loadedRaces.has(race)) return;
        const key = `${race}:${type}`;
        if (this._warnedUnits.has(key)) return;
        this._warnedUnits.add(key);
        console.warn(`[SpriteRegistry] No sprite for unit ${UnitType[type]} (race=${Race[race]})`);
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
    getRaceMap(): Map<number, Map<UnitType, Map<number, SpriteEntry>>> {
        return this.byRace;
    }

    /**
     * Set race map directly (used during deserialization).
     */
    setRaceEntry(race: number, typeMap: Map<UnitType, Map<number, SpriteEntry>>): void {
        this.byRace.set(race, typeMap);
        this._loadedRaces.add(race);
    }
}
