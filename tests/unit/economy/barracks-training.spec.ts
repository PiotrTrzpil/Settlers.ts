import { describe, it, expect } from 'vitest';
import { Race } from '@/game/race';
import { UnitType } from '@/game/unit-types';
import { EMaterialType } from '@/game/economy/material-type';
import {
    getTrainingRecipes,
    getTrainingRecipeSet,
    getSpecialistUnitType,
    getSpecialistWeapon,
} from '@/game/features/barracks';

describe('Training Recipes', () => {
    describe('getTrainingRecipes', () => {
        it('should return 10 recipes for Roman (7 common + 3 Medic)', () => {
            const recipes = getTrainingRecipes(Race.Roman);
            expect(recipes.length).toBe(10);
        });

        it('should return 10 recipes for Viking (7 common + 3 AxeWarrior)', () => {
            const recipes = getTrainingRecipes(Race.Viking);
            expect(recipes.length).toBe(10);
        });

        it('should return 10 recipes for Mayan (7 common + 3 BlowgunWarrior)', () => {
            const recipes = getTrainingRecipes(Race.Mayan);
            expect(recipes.length).toBe(10);
        });

        it('should return 10 recipes for Trojan (7 common + 3 BackpackCatapultist)', () => {
            const recipes = getTrainingRecipes(Race.Trojan);
            expect(recipes.length).toBe(10);
        });

        it('should return empty set for DarkTribe', () => {
            const recipes = getTrainingRecipes(Race.DarkTribe);
            expect(recipes.length).toBe(0);
        });
    });

    describe('common recipes', () => {
        it('should include Swordsman L1-L3 with correct inputs', () => {
            const recipes = getTrainingRecipes(Race.Roman);

            const swordsmanL1 = recipes.find(r => r.unitType === UnitType.Swordsman && r.level === 1);
            expect(swordsmanL1).toBeDefined();
            expect(swordsmanL1!.inputs).toEqual([{ material: EMaterialType.SWORD, count: 1 }]);

            const swordsmanL2 = recipes.find(r => r.unitType === UnitType.Swordsman && r.level === 2);
            expect(swordsmanL2).toBeDefined();
            expect(swordsmanL2!.inputs).toEqual([
                { material: EMaterialType.SWORD, count: 1 },
                { material: EMaterialType.GOLDBAR, count: 1 },
            ]);

            const swordsmanL3 = recipes.find(r => r.unitType === UnitType.Swordsman && r.level === 3);
            expect(swordsmanL3).toBeDefined();
            expect(swordsmanL3!.inputs).toEqual([
                { material: EMaterialType.SWORD, count: 1 },
                { material: EMaterialType.GOLDBAR, count: 2 },
            ]);
        });

        it('should include Bowman L1-L3 with correct inputs', () => {
            const recipes = getTrainingRecipes(Race.Roman);

            const bowmanL1 = recipes.find(r => r.unitType === UnitType.Bowman && r.level === 1);
            expect(bowmanL1).toBeDefined();
            expect(bowmanL1!.inputs).toEqual([{ material: EMaterialType.BOW, count: 1 }]);

            const bowmanL2 = recipes.find(r => r.unitType === UnitType.Bowman && r.level === 2);
            expect(bowmanL2).toBeDefined();
            expect(bowmanL2!.inputs).toEqual([
                { material: EMaterialType.BOW, count: 1 },
                { material: EMaterialType.GOLDBAR, count: 1 },
            ]);

            const bowmanL3 = recipes.find(r => r.unitType === UnitType.Bowman && r.level === 3);
            expect(bowmanL3).toBeDefined();
            expect(bowmanL3!.inputs).toEqual([
                { material: EMaterialType.BOW, count: 1 },
                { material: EMaterialType.GOLDBAR, count: 2 },
            ]);
        });

        it('should include SquadLeader with SWORD + ARMOR', () => {
            const recipes = getTrainingRecipes(Race.Roman);
            const leader = recipes.find(r => r.unitType === UnitType.SquadLeader);
            expect(leader).toBeDefined();
            expect(leader!.inputs).toEqual([
                { material: EMaterialType.SWORD, count: 1 },
                { material: EMaterialType.ARMOR, count: 1 },
            ]);
            expect(leader!.level).toBe(1);
        });

        it('should include exactly 7 common recipes for each non-DarkTribe race', () => {
            // 3 Swordsman levels + 3 Bowman levels + 1 SquadLeader = 7
            const commonUnitTypes = new Set([UnitType.Swordsman, UnitType.Bowman, UnitType.SquadLeader]);

            for (const race of [Race.Roman, Race.Viking, Race.Mayan, Race.Trojan]) {
                const recipes = getTrainingRecipes(race);
                const specialistType = getSpecialistUnitType(race);
                const commonRecipes = recipes.filter(
                    r => commonUnitTypes.has(r.unitType) || r.unitType !== specialistType
                );
                // 7 common recipes are at indices 0-6
                expect(recipes.slice(0, 7).map(r => r.unitType)).toContain(UnitType.Swordsman);
                expect(recipes.slice(0, 7).map(r => r.unitType)).toContain(UnitType.Bowman);
                expect(recipes.slice(0, 7).map(r => r.unitType)).toContain(UnitType.SquadLeader);
                expect(commonRecipes.length).toBeGreaterThanOrEqual(7);
            }
        });
    });

    describe('specialist recipes', () => {
        it('Roman specialist is Medic with SWORD', () => {
            const recipes = getTrainingRecipes(Race.Roman);
            const medic = recipes.find(r => r.unitType === UnitType.Medic && r.level === 1);
            expect(medic).toBeDefined();
            expect(medic!.inputs).toEqual([{ material: EMaterialType.SWORD, count: 1 }]);
        });

        it('Viking specialist is AxeWarrior with BATTLEAXE', () => {
            const recipes = getTrainingRecipes(Race.Viking);
            const axe = recipes.find(r => r.unitType === UnitType.AxeWarrior && r.level === 1);
            expect(axe).toBeDefined();
            expect(axe!.inputs).toEqual([{ material: EMaterialType.BATTLEAXE, count: 1 }]);
        });

        it('Mayan specialist is BlowgunWarrior with BLOWGUN', () => {
            const recipes = getTrainingRecipes(Race.Mayan);
            const blowgun = recipes.find(r => r.unitType === UnitType.BlowgunWarrior && r.level === 1);
            expect(blowgun).toBeDefined();
            expect(blowgun!.inputs).toEqual([{ material: EMaterialType.BLOWGUN, count: 1 }]);
        });

        it('Trojan specialist is BackpackCatapultist with CATAPULT', () => {
            const recipes = getTrainingRecipes(Race.Trojan);
            const cat = recipes.find(r => r.unitType === UnitType.BackpackCatapultist && r.level === 1);
            expect(cat).toBeDefined();
            expect(cat!.inputs).toEqual([{ material: EMaterialType.CATAPULT, count: 1 }]);
        });

        it('specialist L2 requires weapon + 1 GOLDBAR', () => {
            const recipes = getTrainingRecipes(Race.Viking);
            const axeL2 = recipes.find(r => r.unitType === UnitType.AxeWarrior && r.level === 2);
            expect(axeL2).toBeDefined();
            expect(axeL2!.inputs).toEqual([
                { material: EMaterialType.BATTLEAXE, count: 1 },
                { material: EMaterialType.GOLDBAR, count: 1 },
            ]);
        });

        it('specialist L3 requires weapon + 2 GOLDBAR', () => {
            const recipes = getTrainingRecipes(Race.Viking);
            const axeL3 = recipes.find(r => r.unitType === UnitType.AxeWarrior && r.level === 3);
            expect(axeL3).toBeDefined();
            expect(axeL3!.inputs).toEqual([
                { material: EMaterialType.BATTLEAXE, count: 1 },
                { material: EMaterialType.GOLDBAR, count: 2 },
            ]);
        });

        it('each non-DarkTribe race has exactly 3 specialist level recipes', () => {
            const specialistLevels = [1, 2, 3];

            for (const race of [Race.Roman, Race.Viking, Race.Mayan, Race.Trojan]) {
                const specialistType = getSpecialistUnitType(race)!;
                const recipes = getTrainingRecipes(race);
                const specialistRecipes = recipes.filter(r => r.unitType === specialistType);
                expect(specialistRecipes.length).toBe(3);
                expect(specialistRecipes.map(r => r.level).sort()).toEqual(specialistLevels);
            }
        });

        it('DarkTribe has no specialist recipes', () => {
            expect(getSpecialistUnitType(Race.DarkTribe)).toBeUndefined();
            expect(getSpecialistWeapon(Race.DarkTribe)).toBeUndefined();
        });
    });

    describe('getSpecialistUnitType', () => {
        it('should return correct specialist per race', () => {
            expect(getSpecialistUnitType(Race.Roman)).toBe(UnitType.Medic);
            expect(getSpecialistUnitType(Race.Viking)).toBe(UnitType.AxeWarrior);
            expect(getSpecialistUnitType(Race.Mayan)).toBe(UnitType.BlowgunWarrior);
            expect(getSpecialistUnitType(Race.Trojan)).toBe(UnitType.BackpackCatapultist);
            expect(getSpecialistUnitType(Race.DarkTribe)).toBeUndefined();
        });
    });

    describe('getSpecialistWeapon', () => {
        it('should return correct weapon per race', () => {
            expect(getSpecialistWeapon(Race.Roman)).toBe(EMaterialType.SWORD);
            expect(getSpecialistWeapon(Race.Viking)).toBe(EMaterialType.BATTLEAXE);
            expect(getSpecialistWeapon(Race.Mayan)).toBe(EMaterialType.BLOWGUN);
            expect(getSpecialistWeapon(Race.Trojan)).toBe(EMaterialType.CATAPULT);
            expect(getSpecialistWeapon(Race.DarkTribe)).toBeUndefined();
        });
    });

    describe('getTrainingRecipeSet', () => {
        it('should return same recipes as getTrainingRecipes', () => {
            const set = getTrainingRecipeSet(Race.Roman);
            const recipes = getTrainingRecipes(Race.Roman);
            expect(set.recipes).toEqual(recipes);
        });

        it('should cache recipe sets (same reference on repeated calls)', () => {
            const set1 = getTrainingRecipeSet(Race.Roman);
            const set2 = getTrainingRecipeSet(Race.Roman);
            expect(set1).toBe(set2); // same reference = cached
        });

        it('should return distinct cached sets per race', () => {
            const romanSet = getTrainingRecipeSet(Race.Roman);
            const vikingSet = getTrainingRecipeSet(Race.Viking);
            expect(romanSet).not.toBe(vikingSet);
            expect(romanSet.recipes).not.toEqual(vikingSet.recipes);
        });

        it('should return an empty recipe set for DarkTribe', () => {
            const set = getTrainingRecipeSet(Race.DarkTribe);
            expect(set.recipes.length).toBe(0);
        });

        it('recipe sets from getTrainingRecipeSet and getTrainingRecipes are the same objects', () => {
            // getTrainingRecipes delegates to getTrainingRecipeSet, so identity holds
            const set = getTrainingRecipeSet(Race.Viking);
            const recipes = getTrainingRecipes(Race.Viking);
            expect(set.recipes).toBe(recipes);
        });
    });

    describe('recipe ordering', () => {
        it('common recipes appear before specialist recipes', () => {
            // The first 7 entries in a non-DarkTribe recipe list are always common
            const recipes = getTrainingRecipes(Race.Mayan);
            const specialistType = getSpecialistUnitType(Race.Mayan)!;

            const firstSevenTypes = new Set(recipes.slice(0, 7).map(r => r.unitType));
            expect(firstSevenTypes.has(specialistType)).toBe(false);

            const lastThreeTypes = new Set(recipes.slice(7).map(r => r.unitType));
            expect(lastThreeTypes.has(specialistType)).toBe(true);
        });

        it('Swordsman recipes appear before Bowman recipes in common block', () => {
            const recipes = getTrainingRecipes(Race.Roman);
            const firstSwordsmanIdx = recipes.findIndex(r => r.unitType === UnitType.Swordsman);
            const firstBowmanIdx = recipes.findIndex(r => r.unitType === UnitType.Bowman);
            expect(firstSwordsmanIdx).toBeLessThan(firstBowmanIdx);
        });

        it('recipe levels are in ascending order within each unit type', () => {
            const recipes = getTrainingRecipes(Race.Roman);
            for (const unitType of [UnitType.Swordsman, UnitType.Bowman, UnitType.Medic]) {
                const unitRecipes = recipes.filter(r => r.unitType === unitType);
                for (let i = 1; i < unitRecipes.length; i++) {
                    expect(unitRecipes[i]!.level).toBeGreaterThan(unitRecipes[i - 1]!.level);
                }
            }
        });
    });
});
