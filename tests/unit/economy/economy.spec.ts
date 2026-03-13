import { describe, it, expect, afterAll } from 'vitest';
import {
    EMaterialType,
    MATERIAL_CONFIGS,
    DROPPABLE_MATERIALS,
    isMaterialDroppable,
    getMaterialPriority,
    BUILDING_PRODUCTIONS,
    getConstructionCosts,
    getBuildingTypesWithCosts,
    getConstructionCostRaceMap,
    getBuildingTypesRequestingMaterial,
} from '@/game/economy';
import { BuildingType } from '@/game/entity';
import { Race } from '@/game/core/race';
import { installRealGameData, resetTestGameData } from '../helpers/test-game-data';

describe('Material Types', () => {
    it('should have a config for every EMaterialType value', () => {
        const materialValues = Object.values(EMaterialType) as EMaterialType[];

        for (const mat of materialValues) {
            expect(MATERIAL_CONFIGS.has(mat)).toBe(true);
        }
    });

    it('DROPPABLE_MATERIALS excludes NO_MATERIAL and is sorted by priority', () => {
        expect(DROPPABLE_MATERIALS).not.toContain(EMaterialType.NO_MATERIAL);
        expect(isMaterialDroppable(EMaterialType.NO_MATERIAL)).toBe(false);
        expect(isMaterialDroppable(EMaterialType.BOARD)).toBe(true);

        for (let i = 1; i < DROPPABLE_MATERIALS.length; i++) {
            const prevPriority = getMaterialPriority(DROPPABLE_MATERIALS[i - 1]!);
            const currPriority = getMaterialPriority(DROPPABLE_MATERIALS[i]!);
            expect(currPriority).toBeGreaterThanOrEqual(prevPriority);
        }
    });
});

describe('Production Chains', () => {
    it('all production chains have valid materials and include key buildings', () => {
        for (const [buildingType, chain] of BUILDING_PRODUCTIONS) {
            expect(MATERIAL_CONFIGS.has(chain.output), `${buildingType} output`).toBe(true);
            for (const input of chain.inputs) {
                expect(MATERIAL_CONFIGS.has(input), `${buildingType} input`).toBe(true);
            }
            expect(chain.inputs).not.toContain(EMaterialType.NO_MATERIAL);
        }

        expect(BUILDING_PRODUCTIONS.has(BuildingType.WoodcutterHut)).toBe(true);
        expect(BUILDING_PRODUCTIONS.has(BuildingType.Sawmill)).toBe(true);
        expect(BUILDING_PRODUCTIONS.has(BuildingType.IronSmelter)).toBe(true);
    });

    it('IronSmelter produces IRONBAR from IRONORE + COAL', () => {
        const chain = BUILDING_PRODUCTIONS.get(BuildingType.IronSmelter)!;
        expect(chain.output).toBe(EMaterialType.IRONBAR);
        expect(chain.inputs).toContain(EMaterialType.IRONORE);
        expect(chain.inputs).toContain(EMaterialType.COAL);
    });
});

describe('getBuildingTypesRequestingMaterial', () => {
    it('COAL is consumed by smelters and smiths', () => {
        const buildings = getBuildingTypesRequestingMaterial(EMaterialType.COAL);
        expect(buildings).toContain(BuildingType.IronSmelter);
        expect(buildings).toContain(BuildingType.SmeltGold);
        expect(buildings).toContain(BuildingType.WeaponSmith);
        expect(buildings).toContain(BuildingType.ToolSmith);
    });

    it('GOLDBAR is consumed by Barrack (training)', () => {
        expect(getBuildingTypesRequestingMaterial(EMaterialType.GOLDBAR)).toContain(BuildingType.Barrack);
    });

    it('MEAD has no consumers', () => {
        expect(getBuildingTypesRequestingMaterial(EMaterialType.MEAD)).toHaveLength(0);
    });
});

// Construction cost tests require real XML game data (buildingInfo.xml)
installRealGameData();

describe('Construction Costs (XML)', () => {
    afterAll(() => resetTestGameData());

    it('all mapped buildings have valid positive construction costs per race', () => {
        const covered = getBuildingTypesWithCosts();
        expect(covered.length).toBeGreaterThan(30);

        for (const bt of covered) {
            const raceMap = getConstructionCostRaceMap(bt)!;
            expect(raceMap.size, `${bt} has no race data`).toBeGreaterThan(0);
            for (const [race, costs] of raceMap) {
                expect(costs.length, `${bt} (${Race[race]})`).toBeGreaterThan(0);
                const materials = costs.map(c => c.material);
                const usesBuildingMaterials =
                    materials.includes(EMaterialType.BOARD) || materials.includes(EMaterialType.STONE);
                expect(usesBuildingMaterials, `${bt} (${Race[race]}) needs BOARD or STONE`).toBe(true);
                for (const cost of costs) {
                    expect(MATERIAL_CONFIGS.has(cost.material)).toBe(true);
                    expect(cost.count).toBeGreaterThan(0);
                }
            }
        }
    });

    it('different races have different Castle costs', () => {
        const romanCastle = getConstructionCosts(BuildingType.Castle, Race.Roman);
        const vikingCastle = getConstructionCosts(BuildingType.Castle, Race.Viking);
        expect(romanCastle).not.toEqual(vikingCastle);
    });
});
