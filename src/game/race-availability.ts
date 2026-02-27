/**
 * Race-specific availability for units and buildings.
 *
 * Centralizes which units/buildings each race can use. Dark Tribe has a
 * completely separate set of both — none of the standard units or buildings.
 * Other races share a common pool with per-race drink/food chain variants.
 */

import { Race } from './race';
import { UnitType } from './unit-types';
import { BuildingType } from './buildings/types';
import { EMaterialType } from './economy';

// ─── Dark Tribe ──────────────────────────────────────────────────────────────
// Dark Tribe uses an entirely separate unit and building set.
// They have no standard economy — instead relying on mushrooms, shamans,
// captured settlers (via temples), and mana copters.

/** Units exclusive to Dark Tribe — no other race can use these. */
export const DARK_TRIBE_EXCLUSIVE_UNITS: ReadonlySet<UnitType> = new Set([
    UnitType.DarkGardener,
    UnitType.Shaman,
    UnitType.MushroomFarmer,
    UnitType.Angel,
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
    // DarkTribe uses the same job indices as standard races (23.jil has DarkTribe-specific
    // sprites at identical offsets), so all unit types are valid for sprite loading.
    if (race === Race.DarkTribe) return true;
    // Other races cannot use DarkTribe-exclusive units.
    return !DARK_TRIBE_EXCLUSIVE_UNITS.has(unitType);
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
