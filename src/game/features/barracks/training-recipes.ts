/**
 * Per-race training recipe configurations for the barracks.
 *
 * Exports:
 * - COMMON_TRAINING_RECIPES: shared by all non-DarkTribe races
 * - getTrainingRecipes(race): full recipe list for a race
 * - getTrainingRecipeSet(race): wrapped in TrainingRecipeSet
 * - getSpecialistUnitType(race): specialist unit type or undefined
 * - getSpecialistWeapon(race): specialist weapon material or undefined
 */

import { EMaterialType } from '@/game/economy/material-type';
import { UnitType } from '@/game/unit-types';
import { Race } from '@/game/race';
import type { TrainingRecipe, TrainingRecipeSet } from './types';

// ─── Common recipes (all non-DarkTribe races) ─────────────────────

/** Swordsman L1–L3, Bowman L1–L3, SquadLeader — shared by all races. */
export const COMMON_TRAINING_RECIPES: readonly TrainingRecipe[] = [
    // Swordsman L1
    { inputs: [{ material: EMaterialType.SWORD, count: 1 }], unitType: UnitType.Swordsman1, level: 1 },
    // Swordsman L2
    {
        inputs: [
            { material: EMaterialType.SWORD, count: 1 },
            { material: EMaterialType.GOLDBAR, count: 1 },
        ],
        unitType: UnitType.Swordsman1,
        level: 2,
    },
    // Swordsman L3
    {
        inputs: [
            { material: EMaterialType.SWORD, count: 1 },
            { material: EMaterialType.GOLDBAR, count: 2 },
        ],
        unitType: UnitType.Swordsman1,
        level: 3,
    },
    // Bowman L1
    { inputs: [{ material: EMaterialType.BOW, count: 1 }], unitType: UnitType.Bowman1, level: 1 },
    // Bowman L2
    {
        inputs: [
            { material: EMaterialType.BOW, count: 1 },
            { material: EMaterialType.GOLDBAR, count: 1 },
        ],
        unitType: UnitType.Bowman1,
        level: 2,
    },
    // Bowman L3
    {
        inputs: [
            { material: EMaterialType.BOW, count: 1 },
            { material: EMaterialType.GOLDBAR, count: 2 },
        ],
        unitType: UnitType.Bowman1,
        level: 3,
    },
    // SquadLeader
    {
        inputs: [
            { material: EMaterialType.SWORD, count: 1 },
            { material: EMaterialType.ARMOR, count: 1 },
        ],
        unitType: UnitType.SquadLeader,
        level: 1,
    },
];

// ─── Recipe indices ───────────────────────────────────────────────

/**
 * Named indices into the training recipe array. Common indices (0–6)
 * are shared by all non-DarkTribe races; specialist indices (7–9)
 * map to the race-specific unit (Medic, AxeWarrior, BlowgunWarrior,
 * BackpackCatapultist).
 */
export const TrainingRecipeIndex = {
    SwordsmanL1: 0,
    SwordsmanL2: 1,
    SwordsmanL3: 2,
    BowmanL1: 3,
    BowmanL2: 4,
    BowmanL3: 5,
    SquadLeader: 6,
    SpecialistL1: 7,
    SpecialistL2: 8,
    SpecialistL3: 9,
} as const;

export type TrainingRecipeIndexValue = (typeof TrainingRecipeIndex)[keyof typeof TrainingRecipeIndex];

// ─── Race-specific specialist recipes ──────────────────────────────

function makeSpecialistRecipes(unitType: UnitType, weapon: EMaterialType): readonly TrainingRecipe[] {
    return [
        { inputs: [{ material: weapon, count: 1 }], unitType, level: 1 },
        {
            inputs: [
                { material: weapon, count: 1 },
                { material: EMaterialType.GOLDBAR, count: 1 },
            ],
            unitType,
            level: 2,
        },
        {
            inputs: [
                { material: weapon, count: 1 },
                { material: EMaterialType.GOLDBAR, count: 2 },
            ],
            unitType,
            level: 3,
        },
    ];
}

/** Race → specialist L1–L3 recipes. DarkTribe has none. */
const SPECIALIST_RECIPES: ReadonlyMap<Race, readonly TrainingRecipe[]> = new Map([
    [Race.Roman, makeSpecialistRecipes(UnitType.Medic1, EMaterialType.SWORD)],
    [Race.Viking, makeSpecialistRecipes(UnitType.AxeWarrior1, EMaterialType.BATTLEAXE)],
    [Race.Mayan, makeSpecialistRecipes(UnitType.BlowgunWarrior1, EMaterialType.BLOWGUN)],
    [Race.Trojan, makeSpecialistRecipes(UnitType.BackpackCatapultist1, EMaterialType.CATAPULT)],
]);

/** Race → specialist unit type. */
const SPECIALIST_UNIT_TYPES: ReadonlyMap<Race, UnitType> = new Map([
    [Race.Roman, UnitType.Medic1],
    [Race.Viking, UnitType.AxeWarrior1],
    [Race.Mayan, UnitType.BlowgunWarrior1],
    [Race.Trojan, UnitType.BackpackCatapultist1],
]);

/** Race → specialist weapon material. */
const SPECIALIST_WEAPONS: ReadonlyMap<Race, EMaterialType> = new Map([
    [Race.Roman, EMaterialType.SWORD],
    [Race.Viking, EMaterialType.BATTLEAXE],
    [Race.Mayan, EMaterialType.BLOWGUN],
    [Race.Trojan, EMaterialType.CATAPULT],
]);

// ─── Combined recipe cache ─────────────────────────────────────────

const RECIPE_CACHE = new Map<Race, TrainingRecipeSet>();

function buildRecipeSet(race: Race): TrainingRecipeSet {
    if (race === Race.DarkTribe) {
        return { recipes: [] };
    }
    const specialist = SPECIALIST_RECIPES.get(race) ?? [];
    return { recipes: [...COMMON_TRAINING_RECIPES, ...specialist] };
}

// ─── Public API ────────────────────────────────────────────────────

/** Get the full training recipe set for a race's barracks. */
export function getTrainingRecipeSet(race: Race): TrainingRecipeSet {
    let cached = RECIPE_CACHE.get(race);
    if (!cached) {
        cached = buildRecipeSet(race);
        RECIPE_CACHE.set(race, cached);
    }
    return cached;
}

/** Get all training recipes available for a race (convenience alias). */
export function getTrainingRecipes(race: Race): readonly TrainingRecipe[] {
    return getTrainingRecipeSet(race).recipes;
}

/** Get the specialist unit type for a race (undefined for DarkTribe). */
export function getSpecialistUnitType(race: Race): UnitType | undefined {
    return SPECIALIST_UNIT_TYPES.get(race);
}

/** Get the specialist weapon material for a race (undefined for DarkTribe). */
export function getSpecialistWeapon(race: Race): EMaterialType | undefined {
    return SPECIALIST_WEAPONS.get(race);
}
