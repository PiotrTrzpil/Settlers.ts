/**
 * Race-specific availability for units and buildings.
 *
 * Centralizes which units/buildings each race can use. Dark Tribe has a
 * completely separate set of both — none of the standard units or buildings.
 * Other races share a common pool with per-race drink/food chain variants.
 */

import { Race } from './race';
import { UnitType, getBaseUnitType } from './unit-types';
import { BuildingType } from './buildings/building-type';
import { EMaterialType } from './economy/material-type';

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
    UnitType.Angel,
    UnitType.ManacopterMaster,
]);

/** Standard military base types that Dark Tribe does NOT have. */
const STANDARD_ONLY_BASE: ReadonlySet<UnitType> = new Set([UnitType.SquadLeader]);

/**
 * Race-specific specialist units — each race has one specialist type that uses the
 * same JIL indices (254/258/262) but with different art in each race's GFX file.
 * Maps base UnitType → Race. Level variants are resolved via getBaseUnitType().
 */
export const SPECIALIST_UNIT_RACE: ReadonlyMap<UnitType, Race> = new Map([
    [UnitType.Medic, Race.Roman],
    [UnitType.AxeWarrior, Race.Viking],
    [UnitType.BlowgunWarrior, Race.Mayan],
    [UnitType.BackpackCatapultist, Race.Trojan],
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
    [BuildingType.LivingHouse]: [Race.Roman, Race.Viking, Race.Mayan],
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
    if (race === Race.DarkTribe) return false; // Dark Tribe has no standard carrier economy
    const allowedRaces = MATERIAL_RACE_AVAILABILITY[materialType];
    return !allowedRaces || allowedRaces.includes(race);
}

// ─── Public API ──────────────────────────────────────────────────────────────

/** Check if a unit type is available for a given race. */
export function isUnitAvailableForRace(unitType: UnitType, race: Race): boolean {
    const base = getBaseUnitType(unitType);
    if (race === Race.DarkTribe) {
        // DarkTribe uses the same job indices as standard races (23.jil has DarkTribe-specific
        // sprites at identical offsets), but some standard units don't exist for Dark Tribe.
        return !STANDARD_ONLY_BASE.has(base) && !SPECIALIST_UNIT_RACE.has(base);
    }
    // Dark Tribe exclusive units not available to other races.
    if (DARK_TRIBE_EXCLUSIVE_BASE.has(base)) return false;
    // Race-specific specialists: only available for their designated race.
    const specialistRace = SPECIALIST_UNIT_RACE.get(base);
    if (specialistRace !== undefined) return specialistRace === race;
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
