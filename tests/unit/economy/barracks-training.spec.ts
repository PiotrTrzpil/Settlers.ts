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
    it('each playable race has 10 recipes (7 common + 3 specialist), DarkTribe has 0', () => {
        for (const race of [Race.Roman, Race.Viking, Race.Mayan, Race.Trojan]) {
            const recipes = getTrainingRecipes(race);
            expect(recipes.length, `${Race[race]}`).toBe(10);
        }
        expect(getTrainingRecipes(Race.DarkTribe).length).toBe(0);
    });

    it('common recipes include Swordsman L1-L3, Bowman L1-L3, and SquadLeader for all races', () => {
        for (const race of [Race.Roman, Race.Viking, Race.Mayan, Race.Trojan]) {
            const recipes = getTrainingRecipes(race);
            const specialistType = getSpecialistUnitType(race)!;

            // First 7 are common (no specialist)
            const commonBlock = recipes.slice(0, 7);
            expect(
                commonBlock.every(r => r.unitType !== specialistType),
                `${Race[race]} common block`
            ).toBe(true);
            expect(commonBlock.map(r => r.unitType)).toContain(UnitType.Swordsman);
            expect(commonBlock.map(r => r.unitType)).toContain(UnitType.Bowman);
            expect(commonBlock.map(r => r.unitType)).toContain(UnitType.SquadLeader);

            // Last 3 are specialist levels
            const specialistBlock = recipes.slice(7);
            expect(
                specialistBlock.every(r => r.unitType === specialistType),
                `${Race[race]} specialist block`
            ).toBe(true);
            expect(specialistBlock.map(r => r.level).sort()).toEqual([1, 2, 3]);
        }
    });

    it('Swordsman L1 needs SWORD, L2 needs SWORD+1 GOLDBAR, L3 needs SWORD+2 GOLDBAR', () => {
        const recipes = getTrainingRecipes(Race.Roman);
        const sw1 = recipes.find(r => r.unitType === UnitType.Swordsman && r.level === 1)!;
        const sw2 = recipes.find(r => r.unitType === UnitType.Swordsman && r.level === 2)!;
        const sw3 = recipes.find(r => r.unitType === UnitType.Swordsman && r.level === 3)!;

        expect(sw1.inputs).toEqual([{ material: EMaterialType.SWORD, count: 1 }]);
        expect(sw2.inputs).toEqual([
            { material: EMaterialType.SWORD, count: 1 },
            { material: EMaterialType.GOLDBAR, count: 1 },
        ]);
        expect(sw3.inputs).toEqual([
            { material: EMaterialType.SWORD, count: 1 },
            { material: EMaterialType.GOLDBAR, count: 2 },
        ]);
    });

    it('each race has the correct specialist unit type and weapon', () => {
        const expected: Array<[Race, UnitType, EMaterialType]> = [
            [Race.Roman, UnitType.Medic, EMaterialType.SWORD],
            [Race.Viking, UnitType.AxeWarrior, EMaterialType.BATTLEAXE],
            [Race.Mayan, UnitType.BlowgunWarrior, EMaterialType.BLOWGUN],
            [Race.Trojan, UnitType.BackpackCatapultist, EMaterialType.CATAPULT],
        ];

        for (const [race, unitType, weapon] of expected) {
            expect(getSpecialistUnitType(race), `${Race[race]} specialist`).toBe(unitType);
            expect(getSpecialistWeapon(race), `${Race[race]} weapon`).toBe(weapon);

            // Verify L1 recipe uses the weapon
            const recipes = getTrainingRecipes(race);
            const l1 = recipes.find(r => r.unitType === unitType && r.level === 1)!;
            expect(l1.inputs[0]!.material, `${Race[race]} L1 weapon`).toBe(weapon);
        }

        expect(getSpecialistUnitType(Race.DarkTribe)).toBeUndefined();
        expect(getSpecialistWeapon(Race.DarkTribe)).toBeUndefined();
    });

    it('specialist L2 adds 1 GOLDBAR, L3 adds 2 GOLDBAR on top of weapon', () => {
        const recipes = getTrainingRecipes(Race.Viking);
        const axeL2 = recipes.find(r => r.unitType === UnitType.AxeWarrior && r.level === 2)!;
        const axeL3 = recipes.find(r => r.unitType === UnitType.AxeWarrior && r.level === 3)!;

        expect(axeL2.inputs).toEqual([
            { material: EMaterialType.BATTLEAXE, count: 1 },
            { material: EMaterialType.GOLDBAR, count: 1 },
        ]);
        expect(axeL3.inputs).toEqual([
            { material: EMaterialType.BATTLEAXE, count: 1 },
            { material: EMaterialType.GOLDBAR, count: 2 },
        ]);
    });

    it('getTrainingRecipeSet caches per race', () => {
        const set1 = getTrainingRecipeSet(Race.Roman);
        const set2 = getTrainingRecipeSet(Race.Roman);
        expect(set1).toBe(set2);

        const vikingSet = getTrainingRecipeSet(Race.Viking);
        expect(set1).not.toBe(vikingSet);
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
