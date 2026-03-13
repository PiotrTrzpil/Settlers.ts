/**
 * Race-specific availability for units and buildings.
 *
 * Centralizes which units/buildings each race can use. Dark Tribe has a
 * completely separate set of both — none of the standard units or buildings.
 * Other races share a common pool with per-race drink/food chain variants.
 */

import { Race } from '../core/race';
import { UnitType, getBaseUnitType } from '../core/unit-types';
import { BuildingType } from '../buildings/building-type';
import { EMaterialType } from '../economy/material-type';

// ─── Dark Tribe ──────────────────────────────────────────────────────────────
// Dark Tribe uses an entirely separate unit and building set.
// They have no standard economy — instead relying on mushrooms, shamans,
// captured settlers (via temples), and mana copters.

/** Base unit types exclusive to Dark Tribe — no other race can use these. */
const DARK_TRIBE_EXCLUSIVE_BASE: ReadonlySet<UnitType> = new Set([
    UnitType.DarkGardener,
    UnitType.Shaman,
    UnitType.MushroomFarmer,
    UnitType.SlavedSettler,
    UnitType.ManacopterMaster,
]);

/** Exact (non-base) unit types that Dark Tribe does not have — L2/L3 military missing from 23.jil. */
const DARK_TRIBE_EXCLUDED_EXACT: ReadonlySet<UnitType> = new Set([
    UnitType.Swordsman2,
    UnitType.Swordsman3,
    UnitType.Bowman2,
    UnitType.Bowman3,
]);

/**
 * Race-specific economy worker units — each race has unique drink/food production workers
 * whose sprites only exist in that race's settler GFX file.
 * Workers NOT listed here are shared by all non-Dark-Tribe races.
 */
const WORKER_UNIT_RACE: Partial<Record<UnitType, readonly Race[]>> = {
    [UnitType.Winemaker]: [Race.Roman],
    [UnitType.Beekeeper]: [Race.Viking],
    [UnitType.Meadmaker]: [Race.Viking],
    [UnitType.AgaveFarmer]: [Race.Mayan],
    [UnitType.Tequilamaker]: [Race.Mayan],
    [UnitType.SunflowerFarmer]: [Race.Trojan],
    [UnitType.SunflowerOilMaker]: [Race.Trojan],
};

/**
 * Race-specific specialist units — each race has one specialist type that uses the
 * same JIL indices (254/258/262) but with different art in each race's GFX file.
 * Maps base UnitType → Race. Level variants are resolved via getBaseUnitType().
 */
export const SPECIALIST_UNIT_RACE: ReadonlyMap<UnitType, Race> = new Map([
    [UnitType.Medic1, Race.Roman],
    [UnitType.AxeWarrior1, Race.Viking],
    [UnitType.BlowgunWarrior1, Race.Mayan],
    [UnitType.BackpackCatapultist1, Race.Trojan],
]);

/** The only buildings Dark Tribe can construct. */
export const DARK_TRIBE_BUILDINGS: ReadonlySet<BuildingType> = new Set([
    BuildingType.MushroomFarm,
    BuildingType.DarkTemple,
    BuildingType.Fortress,
    BuildingType.ManaCopterHall,
]);

// ─── Per-race building restrictions (non-Dark-Tribe) ─────────────────────────
// Each race has a unique drink/food production chain. Some buildings are
// exclusive to one or a few races. Buildings NOT listed here are shared by
// all non-Dark-Tribe races.

export const BUILDING_RACE_AVAILABILITY: Partial<Record<BuildingType, readonly Race[]>> = {
    // Race-exclusive drink/food chains
    [BuildingType.Vinyard]: [Race.Roman],
    [BuildingType.BeekeeperHut]: [Race.Viking],
    [BuildingType.MeadMakerHut]: [Race.Viking],
    [BuildingType.AgaveFarmerHut]: [Race.Mayan],
    [BuildingType.TequilaMakerHut]: [Race.Mayan],
    [BuildingType.SunflowerFarmerHut]: [Race.Trojan],
    [BuildingType.SunflowerOilMakerHut]: [Race.Trojan],
    // AmmunitionMaker not available to Vikings in original game
    [BuildingType.AmmunitionMaker]: [Race.Roman, Race.Mayan, Race.Trojan],
};

// ─── Per-race material restrictions ──────────────────────────────────────────
// Materials NOT listed here are shared by all non-Dark-Tribe races.
// Materials with carrier sprites only in specific race GFX files.

export const MATERIAL_RACE_AVAILABILITY: Partial<Record<EMaterialType, readonly Race[]>> = {
    [EMaterialType.WINE]: [Race.Roman],
    [EMaterialType.HONEY]: [Race.Viking],
    [EMaterialType.MEAD]: [Race.Viking],
    [EMaterialType.AGAVE]: [Race.Mayan],
    [EMaterialType.BLOWGUN]: [Race.Mayan],
    [EMaterialType.TEQUILA]: [Race.Mayan],
    [EMaterialType.SUNFLOWER]: [Race.Trojan],
    [EMaterialType.SUNFLOWEROIL]: [Race.Trojan],
    [EMaterialType.CATAPULT]: [Race.Trojan],
    [EMaterialType.GOOSE]: [Race.Trojan],
};

/** Check if a material has carrier sprites for the given race. */
export function isMaterialAvailableForRace(materialType: EMaterialType, race: Race): boolean {
    if (race === Race.DarkTribe) {
        return false;
    } // Dark Tribe has no standard carrier economy
    const allowedRaces = MATERIAL_RACE_AVAILABILITY[materialType];
    return !allowedRaces || allowedRaces.includes(race);
}

// ─── Public API ──────────────────────────────────────────────────────────────

/** Check if a unit type is available for a given race. */
export function isUnitAvailableForRace(unitType: UnitType, race: Race): boolean {
    const base = getBaseUnitType(unitType);
    if (race === Race.DarkTribe) {
        // Dark Tribe has their exclusive units, Angels, plus basic L1 military (swordsman, bowman)
        if (DARK_TRIBE_EXCLUSIVE_BASE.has(base)) {
            return true;
        }
        if (base === UnitType.Angel) {
            return true;
        }
        if (base === UnitType.Swordsman1 || base === UnitType.Bowman1) {
            return !DARK_TRIBE_EXCLUDED_EXACT.has(unitType);
        }
        return false;
    }
    // Dark Tribe exclusive units not available to other races.
    if (DARK_TRIBE_EXCLUSIVE_BASE.has(base)) {
        return false;
    }
    // Race-specific specialists: only available for their designated race.
    const specialistRace = SPECIALIST_UNIT_RACE.get(base);
    if (specialistRace !== undefined) {
        return specialistRace === race;
    }
    // Race-specific economy workers: only available for their designated races.
    const workerRaces = WORKER_UNIT_RACE[unitType];
    if (workerRaces) {
        return workerRaces.includes(race);
    }
    return true;
}

/** Check if a building type is available for a given race. */
export function isBuildingAvailableForRace(buildingType: BuildingType, race: Race): boolean {
    if (race === Race.DarkTribe) {
        return DARK_TRIBE_BUILDINGS.has(buildingType);
    }
    // Dark Tribe exclusive buildings are not available to other races
    if (DARK_TRIBE_BUILDINGS.has(buildingType)) {
        return false;
    }
    const allowedRaces = BUILDING_RACE_AVAILABILITY[buildingType];
    return !allowedRaces || allowedRaces.includes(race);
}
