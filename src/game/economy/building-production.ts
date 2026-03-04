/**
 * Production chain data and construction costs for buildings.
 * Adapted from JSettlers MaterialsOfBuildings for Settlers 4.
 */

import { BuildingType } from '../entity';
import { Race, AVAILABLE_RACES } from '../race';
import { EMaterialType } from './material-type';
import { getBuildingInfo, hasBuildingXmlMapping } from '../game-data-access';
import type { BuildingInfo } from '@/resources/game-data';

export interface ProductionChain {
    /** Materials consumed per production cycle */
    inputs: EMaterialType[];
    /** Material produced per cycle (NO_MATERIAL if none, e.g. barracks) */
    output: EMaterialType;
}

export interface Recipe {
    /** Materials consumed per production cycle */
    inputs: EMaterialType[];
    /** Material produced per cycle */
    output: EMaterialType;
}

export interface RecipeSet {
    /** All possible recipes this building can produce */
    recipes: Recipe[];
    /** True if all recipes share the same inputs (e.g., ToolSmith: all use IRONBAR + COAL) */
    sharedInputs: boolean;
}

export interface ConstructionCost {
    material: EMaterialType;
    count: number;
}

/**
 * Maps each production building to its input/output materials.
 * Only buildings that participate in the economy are included.
 */
export const BUILDING_PRODUCTIONS: ReadonlyMap<BuildingType, ProductionChain> = new Map([
    // Wood industry
    [BuildingType.WoodcutterHut, { inputs: [], output: EMaterialType.LOG }],
    [BuildingType.Sawmill, { inputs: [EMaterialType.LOG], output: EMaterialType.BOARD }],
    [BuildingType.ForesterHut, { inputs: [], output: EMaterialType.NO_MATERIAL }],

    // Stone
    [BuildingType.StonecutterHut, { inputs: [], output: EMaterialType.STONE }],

    // Food industry
    [BuildingType.GrainFarm, { inputs: [], output: EMaterialType.GRAIN }],
    [BuildingType.Mill, { inputs: [EMaterialType.GRAIN], output: EMaterialType.FLOUR }],
    [BuildingType.Bakery, { inputs: [EMaterialType.FLOUR, EMaterialType.WATER], output: EMaterialType.BREAD }],
    [BuildingType.FisherHut, { inputs: [], output: EMaterialType.FISH }],
    [BuildingType.AnimalRanch, { inputs: [EMaterialType.GRAIN], output: EMaterialType.PIG }],
    [BuildingType.Slaughterhouse, { inputs: [EMaterialType.PIG], output: EMaterialType.MEAT }],
    [BuildingType.WaterworkHut, { inputs: [], output: EMaterialType.WATER }],
    [BuildingType.HunterHut, { inputs: [], output: EMaterialType.MEAT }],

    // Mining (mines consume food — BREAD is the canonical food input)
    [BuildingType.CoalMine, { inputs: [EMaterialType.BREAD], output: EMaterialType.COAL }],
    [BuildingType.IronMine, { inputs: [EMaterialType.BREAD], output: EMaterialType.IRONORE }],
    [BuildingType.GoldMine, { inputs: [EMaterialType.BREAD], output: EMaterialType.GOLDORE }],
    [BuildingType.StoneMine, { inputs: [EMaterialType.BREAD], output: EMaterialType.STONE }],
    [BuildingType.SulfurMine, { inputs: [EMaterialType.BREAD], output: EMaterialType.SULFUR }],

    // Metal industry
    [BuildingType.IronSmelter, { inputs: [EMaterialType.IRONORE, EMaterialType.COAL], output: EMaterialType.IRONBAR }],
    [BuildingType.SmeltGold, { inputs: [EMaterialType.GOLDORE, EMaterialType.COAL], output: EMaterialType.GOLDBAR }],
    [BuildingType.WeaponSmith, { inputs: [EMaterialType.IRONBAR, EMaterialType.COAL], output: EMaterialType.SWORD }],
    [BuildingType.ToolSmith, { inputs: [EMaterialType.IRONBAR, EMaterialType.COAL], output: EMaterialType.AXE }],

    // Drink production (race-specific)
    [BuildingType.Vinyard, { inputs: [], output: EMaterialType.WINE }],
    [BuildingType.BeekeeperHut, { inputs: [], output: EMaterialType.HONEY }],
    [BuildingType.MeadMakerHut, { inputs: [EMaterialType.HONEY], output: EMaterialType.MEAD }],
    [BuildingType.AgaveFarmerHut, { inputs: [], output: EMaterialType.AGAVE }],
    [BuildingType.TequilaMakerHut, { inputs: [EMaterialType.AGAVE], output: EMaterialType.TEQUILA }],
    [BuildingType.SunflowerFarmerHut, { inputs: [], output: EMaterialType.SUNFLOWER }],
    [BuildingType.SunflowerOilMakerHut, { inputs: [EMaterialType.SUNFLOWER], output: EMaterialType.SUNFLOWEROIL }],
]);

/**
 * Recipe sets for buildings that can produce multiple different outputs from the same or
 * varying inputs. Buildings listed here support recipe selection by the player or AI.
 */
export const BUILDING_RECIPE_SETS: ReadonlyMap<BuildingType, RecipeSet> = new Map([
    [
        BuildingType.ToolSmith,
        {
            recipes: [
                { inputs: [EMaterialType.IRONBAR, EMaterialType.COAL], output: EMaterialType.AXE },
                { inputs: [EMaterialType.IRONBAR, EMaterialType.COAL], output: EMaterialType.HAMMER },
                { inputs: [EMaterialType.IRONBAR, EMaterialType.COAL], output: EMaterialType.ROD },
                { inputs: [EMaterialType.IRONBAR, EMaterialType.COAL], output: EMaterialType.PICKAXE },
                { inputs: [EMaterialType.IRONBAR, EMaterialType.COAL], output: EMaterialType.SAW },
                { inputs: [EMaterialType.IRONBAR, EMaterialType.COAL], output: EMaterialType.SCYTHE },
                { inputs: [EMaterialType.IRONBAR, EMaterialType.COAL], output: EMaterialType.SHOVEL },
            ],
            sharedInputs: true,
        },
    ],
    [
        BuildingType.WeaponSmith,
        {
            // Common outputs shared by all races. Race-specific weapons
            // (Viking=BATTLEAXE, Maya=BLOWGUN, Trojan=CATAPULT) to be added later.
            recipes: [
                { inputs: [EMaterialType.IRONBAR, EMaterialType.COAL], output: EMaterialType.SWORD },
                { inputs: [EMaterialType.IRONBAR, EMaterialType.COAL], output: EMaterialType.BOW },
                { inputs: [EMaterialType.IRONBAR, EMaterialType.COAL], output: EMaterialType.ARMOR },
            ],
            sharedInputs: true,
        },
    ],
]);

/** Get the recipe set for a multi-recipe building, or undefined for single-recipe buildings. */
export function getRecipeSet(buildingType: BuildingType): RecipeSet | undefined {
    return BUILDING_RECIPE_SETS.get(buildingType);
}

/** Check if a building type has multiple recipes. */
export function hasMultipleRecipes(buildingType: BuildingType): boolean {
    return BUILDING_RECIPE_SETS.has(buildingType);
}

// ── Construction costs from XML game data (per building, per race) ──

function buildingInfoToCosts(info: BuildingInfo): readonly ConstructionCost[] {
    const costs: ConstructionCost[] = [];
    if (info.stone > 0) costs.push({ material: EMaterialType.STONE, count: info.stone });
    if (info.boards > 0) costs.push({ material: EMaterialType.BOARD, count: info.boards });
    if (info.gold > 0) costs.push({ material: EMaterialType.GOLDBAR, count: info.gold });
    return costs;
}

/**
 * Get construction costs for a building type and race from XML game data.
 * Throws if building has no XML mapping or no costs defined.
 */
export function getConstructionCosts(buildingType: BuildingType, race: Race): readonly ConstructionCost[] {
    const info = getBuildingInfo(race, buildingType);
    if (!info) throw new Error(`No BuildingInfo for ${BuildingType[buildingType]} / ${Race[race]}`);
    return buildingInfoToCosts(info);
}

/** All building types that have construction costs defined in XML game data (for any race). */
export function getBuildingTypesWithCosts(): BuildingType[] {
    const result: BuildingType[] = [];
    for (const val of Object.values(BuildingType)) {
        if (typeof val !== 'number') continue;
        const bt = val as BuildingType;
        if (!hasBuildingXmlMapping(bt)) continue;
        const hasCosts = AVAILABLE_RACES.some(race => {
            const info = getBuildingInfo(race, bt);
            return info && (info.stone > 0 || info.boards > 0 || info.gold > 0);
        });
        if (hasCosts) result.push(bt);
    }
    return result;
}

/** Get the race cost map for a building (for tests/inspection). */
export function getConstructionCostRaceMap(
    buildingType: BuildingType
): ReadonlyMap<Race, readonly ConstructionCost[]> | undefined {
    if (!hasBuildingXmlMapping(buildingType)) return undefined;
    const raceMap = new Map<Race, readonly ConstructionCost[]>();
    for (const race of AVAILABLE_RACES) {
        const info = getBuildingInfo(race, buildingType);
        if (info) {
            const costs = buildingInfoToCosts(info);
            if (costs.length > 0) raceMap.set(race, costs);
        }
    }
    return raceMap.size > 0 ? raceMap : undefined;
}

/**
 * Materials accepted by the barracks as training inputs.
 * Logistics must be able to deliver these to barracks buildings.
 */
const BARRACKS_INPUT_MATERIALS: ReadonlySet<EMaterialType> = new Set([
    EMaterialType.SWORD,
    EMaterialType.BOW,
    EMaterialType.GOLDBAR,
    EMaterialType.ARMOR,
    EMaterialType.BATTLEAXE,
    EMaterialType.BLOWGUN,
    EMaterialType.CATAPULT,
]);

/**
 * Returns all building types that consume the given material as a production input.
 * Includes both single-recipe buildings (BUILDING_PRODUCTIONS) and multi-recipe buildings
 * (BUILDING_RECIPE_SETS). Barracks are also included when the material is a training input.
 * Each building type appears at most once in the result.
 */
export function getBuildingTypesRequestingMaterial(material: EMaterialType): BuildingType[] {
    const result: BuildingType[] = [];
    for (const [buildingType, chain] of BUILDING_PRODUCTIONS) {
        if (chain.inputs.includes(material)) {
            result.push(buildingType);
        }
    }
    for (const [buildingType, recipeSet] of BUILDING_RECIPE_SETS) {
        if (result.includes(buildingType)) continue;
        if (recipeSet.recipes.some(r => r.inputs.includes(material))) {
            result.push(buildingType);
        }
    }
    // Barracks accept weapons, gold, and armor for soldier training
    if (BARRACKS_INPUT_MATERIALS.has(material) && !result.includes(BuildingType.Barrack)) {
        result.push(BuildingType.Barrack);
    }
    return result;
}
