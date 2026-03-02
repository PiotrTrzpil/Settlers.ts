/**
 * Production chain data and construction costs for buildings.
 * Adapted from JSettlers MaterialsOfBuildings for Settlers 4.
 */

import { parse as parseYaml } from 'yaml';
import { BuildingType } from '../entity';
import { Race } from '../race';
import { EMaterialType } from './material-type';
import costsYaml from './data/construction-costs.yaml?raw';

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

    // Military — barrack converts weapons to soldiers, no material output
    [BuildingType.Barrack, { inputs: [EMaterialType.SWORD], output: EMaterialType.NO_MATERIAL }],
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

// ── Construction costs loaded from YAML (per building, per race) ──

interface RawCostEntry {
    stone?: number;
    boards?: number;
    gold?: number;
}
type RawCostsYaml = Record<string, Record<string, RawCostEntry>>;

const RACE_NAME_TO_ENUM: Record<string, Race> = {
    Roman: Race.Roman,
    Viking: Race.Viking,
    Mayan: Race.Mayan,
    Trojan: Race.Trojan,
    DarkTribe: Race.DarkTribe,
};

const MATERIAL_KEY_TO_ENUM: Record<string, EMaterialType> = {
    stone: EMaterialType.STONE,
    boards: EMaterialType.BOARD,
    gold: EMaterialType.GOLDBAR,
};

function resolveBuildingType(name: string): BuildingType {
    if (!(name in BuildingType)) throw new Error(`Unknown BuildingType in construction-costs.yaml: ${name}`);
    return BuildingType[name as keyof typeof BuildingType];
}

function parseRaceCosts(entry: RawCostEntry): ConstructionCost[] {
    const materials: ConstructionCost[] = [];
    for (const [key, count] of Object.entries(entry)) {
        const mat = MATERIAL_KEY_TO_ENUM[key];
        if (mat === undefined) throw new Error(`Unknown material key in construction-costs.yaml: ${key}`);
        if (count > 0) materials.push({ material: mat, count });
    }
    return materials;
}

function buildCostTable(): Map<BuildingType, Map<Race, readonly ConstructionCost[]>> {
    const raw = parseYaml(costsYaml) as RawCostsYaml;
    const table = new Map<BuildingType, Map<Race, readonly ConstructionCost[]>>();

    for (const [buildingName, raceCosts] of Object.entries(raw)) {
        const bt = resolveBuildingType(buildingName);
        const raceMap = new Map<Race, readonly ConstructionCost[]>();
        for (const [raceName, costs] of Object.entries(raceCosts)) {
            const race = RACE_NAME_TO_ENUM[raceName];
            if (race === undefined) throw new Error(`Unknown race in construction-costs.yaml: ${raceName}`);
            raceMap.set(race, parseRaceCosts(costs));
        }
        table.set(bt, raceMap);
    }
    return table;
}

const CONSTRUCTION_COST_TABLE = buildCostTable();

/**
 * Get construction costs for a building type and race.
 * Falls back to Roman costs, then to the first available race's costs.
 */
export function getConstructionCosts(buildingType: BuildingType, race: Race): readonly ConstructionCost[] {
    const raceMap = CONSTRUCTION_COST_TABLE.get(buildingType);
    if (!raceMap) throw new Error(`No construction costs for ${BuildingType[buildingType]}`);
    return raceMap.get(race) ?? raceMap.get(Race.Roman) ?? raceMap.values().next().value!;
}

/** All building types that have construction costs defined. */
export function getBuildingTypesWithCosts(): BuildingType[] {
    return [...CONSTRUCTION_COST_TABLE.keys()];
}

/** Get the race map for a building (for tests/inspection). */
export function getConstructionCostRaceMap(
    buildingType: BuildingType
): ReadonlyMap<Race, readonly ConstructionCost[]> | undefined {
    return CONSTRUCTION_COST_TABLE.get(buildingType);
}

/**
 * Returns all building types that consume the given material as a production input.
 * Includes both single-recipe buildings (BUILDING_PRODUCTIONS) and multi-recipe buildings
 * (BUILDING_RECIPE_SETS). Each building type appears at most once in the result.
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
    return result;
}
