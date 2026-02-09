import { describe, it, expect } from 'vitest';
import {
    EMaterialType,
    MATERIAL_CONFIGS,
    DROPPABLE_MATERIALS,
    isMaterialDroppable,
    getMaterialPriority,
    BUILDING_PRODUCTIONS,
    CONSTRUCTION_COSTS,
    getBuildingTypesRequestingMaterial,
} from '@/game/economy';
import { BuildingType } from '@/game/entity';

describe('Material Types', () => {
    it('should have a config for every EMaterialType value', () => {
        const materialValues = Object.values(EMaterialType).filter(
            (v) => typeof v === 'number'
        ) as EMaterialType[];

        for (const mat of materialValues) {
            expect(MATERIAL_CONFIGS.has(mat)).toBe(true);
        }
    });

    it('should mark NO_MATERIAL as not droppable', () => {
        expect(isMaterialDroppable(EMaterialType.NO_MATERIAL)).toBe(false);
    });

    it('should mark standard materials as droppable', () => {
        expect(isMaterialDroppable(EMaterialType.PLANK)).toBe(true);
        expect(isMaterialDroppable(EMaterialType.STONE)).toBe(true);
        expect(isMaterialDroppable(EMaterialType.TRUNK)).toBe(true);
        expect(isMaterialDroppable(EMaterialType.SWORD)).toBe(true);
        expect(isMaterialDroppable(EMaterialType.BREAD)).toBe(true);
    });

    // Note: getMaterialPriority values are verified by game-session flow test.

    it('should not include NO_MATERIAL in DROPPABLE_MATERIALS', () => {
        expect(DROPPABLE_MATERIALS).not.toContain(EMaterialType.NO_MATERIAL);
    });

    it.skip('should have DROPPABLE_MATERIALS sorted by default priority index', () => {
        for (let i = 1; i < DROPPABLE_MATERIALS.length; i++) {
            const prevPriority = getMaterialPriority(DROPPABLE_MATERIALS[i - 1]);
            const currPriority = getMaterialPriority(DROPPABLE_MATERIALS[i]);
            expect(currPriority).toBeGreaterThan(prevPriority);
        }
    });

    it.skip('should have unique priority indices for all droppable materials', () => {
        const priorities = DROPPABLE_MATERIALS.map((m) => getMaterialPriority(m));
        const uniquePriorities = new Set(priorities);
        expect(uniquePriorities.size).toBe(priorities.length);
    });
});

describe('Production Chains', () => {
    it('should have valid output material for every production chain', () => {
        for (const [buildingType, chain] of BUILDING_PRODUCTIONS) {
            const config = MATERIAL_CONFIGS.get(chain.output);
            expect(
                config,
                `Building ${BuildingType[buildingType]} has invalid output ${EMaterialType[chain.output]}`
            ).toBeDefined();
        }
    });

    it('should have valid input materials for every production chain', () => {
        for (const [buildingType, chain] of BUILDING_PRODUCTIONS) {
            for (const input of chain.inputs) {
                const config = MATERIAL_CONFIGS.get(input);
                expect(
                    config,
                    `Building ${BuildingType[buildingType]} has invalid input ${EMaterialType[input]}`
                ).toBeDefined();
            }
        }
    });

    it('should not use NO_MATERIAL as an input', () => {
        for (const [, chain] of BUILDING_PRODUCTIONS) {
            expect(chain.inputs).not.toContain(EMaterialType.NO_MATERIAL);
        }
    });

    it('should include key production buildings', () => {
        expect(BUILDING_PRODUCTIONS.has(BuildingType.WoodcutterHut)).toBe(true);
        expect(BUILDING_PRODUCTIONS.has(BuildingType.Sawmill)).toBe(true);
        expect(BUILDING_PRODUCTIONS.has(BuildingType.StonecutterHut)).toBe(true);
        expect(BUILDING_PRODUCTIONS.has(BuildingType.GrainFarm)).toBe(true);
        expect(BUILDING_PRODUCTIONS.has(BuildingType.CoalMine)).toBe(true);
        expect(BUILDING_PRODUCTIONS.has(BuildingType.IronSmelter)).toBe(true);
        expect(BUILDING_PRODUCTIONS.has(BuildingType.WeaponSmith)).toBe(true);
    });

    // Note: Lumberjack→TRUNK and Sawmill→PLANK chain tests are covered by
    // game-session flow test.

    it('should map IronSmelter to IRON output with IRONORE and COAL inputs', () => {
        const chain = BUILDING_PRODUCTIONS.get(BuildingType.IronSmelter)!;
        expect(chain.output).toBe(EMaterialType.IRON);
        expect(chain.inputs).toContain(EMaterialType.IRONORE);
        expect(chain.inputs).toContain(EMaterialType.COAL);
    });
});

describe('getBuildingTypesRequestingMaterial', () => {
    // Note: TRUNK→Sawmill lookup is covered by game-session flow test.

    it('should return multiple buildings for COAL', () => {
        const buildings = getBuildingTypesRequestingMaterial(EMaterialType.COAL);
        expect(buildings).toContain(BuildingType.IronSmelter);
        expect(buildings).toContain(BuildingType.SmeltGold);
        expect(buildings).toContain(BuildingType.WeaponSmith);
        expect(buildings).toContain(BuildingType.ToolSmith);
    });

    it('should return Windmill and PigFarm for CROP', () => {
        const buildings = getBuildingTypesRequestingMaterial(EMaterialType.CROP);
        expect(buildings).toContain(BuildingType.Mill);
        expect(buildings).toContain(BuildingType.AnimalRanch);
    });

    it('should return empty array for materials not consumed by any building', () => {
        const buildings = getBuildingTypesRequestingMaterial(EMaterialType.GOLD);
        expect(buildings).toHaveLength(0);
    });

    it('should return Barrack for SWORD', () => {
        const buildings = getBuildingTypesRequestingMaterial(EMaterialType.SWORD);
        expect(buildings).toContain(BuildingType.Barrack);
    });
});

describe('Construction Costs', () => {
    it('should have construction costs defined for all BuildingType values', () => {
        const buildingValues = Object.values(BuildingType).filter(
            (v) => typeof v === 'number'
        ) as BuildingType[];

        for (const bt of buildingValues) {
            expect(
                CONSTRUCTION_COSTS.has(bt),
                `Missing construction costs for ${BuildingType[bt]}`
            ).toBe(true);
        }
    });

    it('should have at least one material cost per building', () => {
        for (const [buildingType, costs] of CONSTRUCTION_COSTS) {
            expect(
                costs.length,
                `${BuildingType[buildingType]} has no construction costs`
            ).toBeGreaterThan(0);
        }
    });

    it('should only use valid material types in construction costs', () => {
        for (const [buildingType, costs] of CONSTRUCTION_COSTS) {
            for (const cost of costs) {
                expect(
                    MATERIAL_CONFIGS.has(cost.material),
                    `${BuildingType[buildingType]} uses invalid material ${EMaterialType[cost.material]}`
                ).toBe(true);
            }
        }
    });

    it('should have positive counts for all materials', () => {
        for (const [, costs] of CONSTRUCTION_COSTS) {
            for (const cost of costs) {
                expect(cost.count).toBeGreaterThan(0);
            }
        }
    });

    it('should use PLANK and/or STONE as construction materials', () => {
        for (const [, costs] of CONSTRUCTION_COSTS) {
            const materials = costs.map((c) => c.material);
            const usesBuildingMaterials =
                materials.includes(EMaterialType.PLANK) ||
                materials.includes(EMaterialType.STONE);
            expect(usesBuildingMaterials).toBe(true);
        }
    });
});
