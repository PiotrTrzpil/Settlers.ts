/**
 * Race/civilization definitions.
 *
 * Shared across the codebase — kept separate from renderer to avoid circular dependencies.
 * Race enum values (10-14) match the GFX file numbers used by the original game.
 */

/**
 * Available races/civilizations with their GFX file numbers.
 */
export enum Race {
    Roman = 10,
    Viking = 11,
    Mayan = 12,
    DarkTribe = 13, // Uses different building mappings
    Trojan = 14,
}

/** Display names for races */
export const RACE_NAMES: Record<Race, string> = {
    [Race.Roman]: 'Roman',
    [Race.Viking]: 'Viking',
    [Race.Mayan]: 'Mayan',
    [Race.DarkTribe]: 'Dark Tribe',
    [Race.Trojan]: 'Trojan',
};

/** List of all available races for UI (excludes DarkTribe which has different mappings) */
export const AVAILABLE_RACES: Race[] = [Race.Roman, Race.Viking, Race.Mayan, Race.Trojan];

/**
 * Convert S4Tribe index (0-4) to Race enum value (10-14).
 * S4Tribe values are the map file format's tribe indices.
 */
export function s4TribeToRace(tribe: number): Race {
    const race = tribe + 10;
    return race as Race;
}
