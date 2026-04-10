/**
 * Race/civilization definitions.
 *
 * Shared across the codebase — kept separate from renderer to avoid circular dependencies.
 * String-based enum for type safety; use RACE_GFX_FILE when you need the GFX file number.
 */

/** Available races/civilizations. */
export enum Race {
    Roman = 'roman',
    Viking = 'viking',
    Mayan = 'mayan',
    DarkTribe = 'darkTribe',
    Trojan = 'trojan',
}

/** GFX file numbers for each race (used for loading sprite files). */
export const RACE_GFX_FILE: Record<Race, number> = {
    [Race.Roman]: 10,
    [Race.Viking]: 11,
    [Race.Mayan]: 12,
    [Race.DarkTribe]: 13,
    [Race.Trojan]: 14,
};

/** Display names for races (UI formatting). */
const RACE_NAMES: Record<Race, string> = {
    [Race.Roman]: 'Roman',
    [Race.Viking]: 'Viking',
    [Race.Mayan]: 'Mayan',
    [Race.DarkTribe]: 'Dark Tribe',
    [Race.Trojan]: 'Trojan',
};

/** Format a race for UI display (e.g. 'Dark Tribe' instead of 'darkTribe'). */
export function formatRace(race: Race): string {
    return RACE_NAMES[race];
}

/** All playable races including Dark Tribe. */
export const AVAILABLE_RACES: Race[] = [Race.Roman, Race.Viking, Race.Mayan, Race.Trojan, Race.DarkTribe];

/** Returns true if the race is Dark Tribe (territoryless, siege-less race). */
export function isDarkTribe(race: Race): boolean {
    return race === Race.DarkTribe;
}

/** Lookup from S4Tribe index (0-4) to Race. */
const S4_TRIBE_TO_RACE: Race[] = [Race.Roman, Race.Viking, Race.Mayan, Race.DarkTribe, Race.Trojan];

/**
 * Convert S4Tribe index (0-4) to Race.
 * S4Tribe values are the map file format's tribe indices.
 */
export function s4TribeToRace(tribe: number): Race {
    return S4_TRIBE_TO_RACE[tribe]!;
}

const RACE_STORAGE_KEY = 'settlers_selectedRace';

/** Load saved race from localStorage, falling back to Roman. */
export function loadSavedRace(): Race {
    try {
        const stored = localStorage.getItem(RACE_STORAGE_KEY);
        if (stored !== null && AVAILABLE_RACES.includes(stored as Race)) {
            return stored as Race;
        }
    } catch {
        // localStorage not available
    }
    return Race.Roman;
}

/** Persist selected race to localStorage. */
export function saveSavedRace(race: Race): void {
    try {
        localStorage.setItem(RACE_STORAGE_KEY, race);
    } catch {
        // localStorage not available
    }
}
