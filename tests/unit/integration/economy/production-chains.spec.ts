/**
 * Headless economy simulation — runs the full production pipeline
 * without a browser using real XML game data. Asserts on observable
 * outcomes only: inventory counts, entity existence, material flow.
 *
 * See original file for full economy rules documentation.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { createSimulation, cleanupSimulation, type Simulation } from '../../helpers/test-simulation';
import { installRealGameData } from '../../helpers/test-game-data';
import { BuildingType } from '@/game/buildings/building-type';
import { EntityType, UnitType } from '@/game/entity';
import { EMaterialType } from '@/game/economy/material-type';
import { Race } from '@/game/core/race';
import { OreType } from '@/game/features/ore-veins/ore-type';
import { TrainingRecipeIndex } from '@/game/features/barracks';
import { ProductionMode } from '@/game/features/production-control';
import { buildAllSettlerConfigs } from '@/game/data/settler-data-access';

installRealGameData();

// ─── Gatherer & production chains ─────────────────────────────────

describe('Economy – gatherer & production chains', { timeout: 5000 }, () => {
    let sim: Simulation;

    afterEach(() => {
        sim?.destroy();
        cleanupSimulation();
    });

    it('woodcutter cuts only nearby trees, ignores far ones', () => {
        sim = createSimulation();

        sim.placeBuilding(BuildingType.ResidenceSmall);
        const woodcutterId = sim.placeBuilding(BuildingType.WoodcutterHut);

        sim.plantTreesNear(woodcutterId, 3);
        sim.plantTreesFar(woodcutterId, 5);

        sim.runUntil(() => sim.getOutput(woodcutterId, EMaterialType.LOG) >= 3, { maxTicks: 300 * 30 });
        sim.runTicks(60 * 30);
        expect(sim.getOutput(woodcutterId, EMaterialType.LOG)).toBe(3);
    });

    it('full production chain: trees → woodcutter → carrier → sawmill → boards', () => {
        sim = createSimulation();

        sim.placeBuilding(BuildingType.ResidenceSmall);
        const woodcutterId = sim.placeBuilding(BuildingType.WoodcutterHut);
        const sawmillId = sim.placeBuilding(BuildingType.Sawmill);

        expect(sim.countEntities(EntityType.Unit)).toBeGreaterThanOrEqual(3);

        sim.plantTreesNear(woodcutterId, 5);

        sim.runUntil(() => sim.getOutput(sawmillId, EMaterialType.BOARD) >= 5, { maxTicks: 300 * 30 });
        sim.runTicks(30 * 30);
        expect(sim.getOutput(sawmillId, EMaterialType.BOARD)).toBe(5);
    });

    it('worker loops back to cut all nearby trees', () => {
        sim = createSimulation();

        sim.placeBuilding(BuildingType.ResidenceSmall);
        const woodcutterId = sim.placeBuilding(BuildingType.WoodcutterHut);

        sim.plantTreesNear(woodcutterId, 5);

        sim.runUntil(() => sim.getOutput(woodcutterId, EMaterialType.LOG) >= 5, { maxTicks: 500 * 30 });
        sim.runTicks(60 * 30);
        expect(sim.getOutput(woodcutterId, EMaterialType.LOG)).toBe(5);
    });

    it('viking woodcutter cuts trees without teleporting into building', () => {
        sim = createSimulation({ race: Race.Viking });

        sim.placeBuilding(BuildingType.ResidenceSmall);
        const woodcutterId = sim.placeBuilding(BuildingType.WoodcutterHut);

        sim.plantTreesNear(woodcutterId, 3);

        sim.runUntil(() => sim.getOutput(woodcutterId, EMaterialType.LOG) >= 3, { maxTicks: 300 * 30 });
        expect(sim.getOutput(woodcutterId, EMaterialType.LOG)).toBe(3);
    });

    it('full chain: farm → grain → mill → flour + waterwork → water → bakery → bread', () => {
        sim = createSimulation({ mapWidth: 256, mapHeight: 256 });

        let planted = 0;
        let matured = 0;
        let harvested = 0;
        sim.eventBus.on('crop:planted', () => planted++);
        sim.eventBus.on('crop:matured', () => matured++);
        sim.eventBus.on('crop:harvested', () => harvested++);

        sim.placeBuilding(BuildingType.ResidenceSmall);
        sim.placeBuilding(BuildingType.GrainFarm);
        const waterworkId = sim.placeBuilding(BuildingType.WaterworkHut);
        sim.placeBuilding(BuildingType.Mill);
        const bakeryId = sim.placeBuilding(BuildingType.Bakery);

        sim.placeRiverNear(waterworkId, 3);

        sim.runUntil(() => sim.getOutput(bakeryId, EMaterialType.BREAD) >= 1, { maxTicks: 3000 * 30 });
        expect(sim.getOutput(bakeryId, EMaterialType.BREAD)).toBeGreaterThanOrEqual(1);

        expect(planted).toBeGreaterThanOrEqual(1);
        expect(matured).toBeGreaterThanOrEqual(1);
        expect(harvested).toBeGreaterThanOrEqual(1);
        expect(matured).toBeGreaterThanOrEqual(harvested);
        expect(planted).toBeGreaterThanOrEqual(matured);
    });

    it('stonecutter mines only nearby rocks, ignores far ones', () => {
        sim = createSimulation();

        sim.placeBuilding(BuildingType.ResidenceSmall);
        const stonecutterId = sim.placeBuilding(BuildingType.StonecutterHut);

        sim.placeStonesNear(stonecutterId, 2);
        sim.placeStonesFar(stonecutterId, 3);

        let lastCount = 0;
        let stableTicks = 0;
        sim.runUntil(
            () => {
                const count = sim.getOutput(stonecutterId, EMaterialType.STONE);
                if (count > lastCount) {
                    lastCount = count;
                    stableTicks = 0;
                } else {
                    stableTicks++;
                }
                return stableTicks >= 60 * 30;
            },
            { maxTicks: 500 * 30 }
        );
        const stonesFromNearby = sim.getOutput(stonecutterId, EMaterialType.STONE);
        expect(stonesFromNearby).toBeGreaterThan(0);

        sim.runTicks(60 * 30);
        expect(sim.getOutput(stonecutterId, EMaterialType.STONE)).toBe(stonesFromNearby);
    });

    it('forester plants trees, woodcutter harvests them (no initial trees)', () => {
        sim = createSimulation({ mapWidth: 256, mapHeight: 256 });

        let treesPlanted = 0;
        let treesMatured = 0;
        let treesCut = 0;
        sim.eventBus.on('tree:planted', () => treesPlanted++);
        sim.eventBus.on('tree:matured', () => treesMatured++);
        sim.eventBus.on('tree:cut', () => treesCut++);

        sim.placeBuilding(BuildingType.ResidenceSmall);
        const foresterId = sim.placeBuilding(BuildingType.ForesterHut);
        const woodcutterId = sim.placeBuilding(BuildingType.WoodcutterHut);

        sim.runUntil(() => sim.getOutput(woodcutterId, EMaterialType.LOG) >= 2, { maxTicks: 3000 * 30 });
        expect(sim.getOutput(woodcutterId, EMaterialType.LOG)).toBeGreaterThanOrEqual(2);

        expect(sim.getOutput(foresterId, EMaterialType.LOG)).toBe(0);

        expect(treesPlanted).toBeGreaterThanOrEqual(2);
        expect(treesMatured).toBeGreaterThanOrEqual(2);
        expect(treesCut).toBeGreaterThanOrEqual(2);
        expect(treesMatured).toBeGreaterThanOrEqual(treesCut);
        expect(treesPlanted).toBeGreaterThanOrEqual(treesMatured);
    });
});

// ─── Mine chains ──────────────────────────────────────────────────

describe('Economy – mine & smelting chains', { timeout: 5000 }, () => {
    let sim: Simulation;

    afterEach(() => {
        sim?.destroy();
        cleanupSimulation();
    });

    it('mine chain: coal mine + iron mine → iron smelter → iron bars (with injected bread)', () => {
        sim = createSimulation({ mapWidth: 256, mapHeight: 256 });

        const failures: string[] = [];
        sim.eventBus.on('carrier:assignmentFailed', e => {
            failures.push(
                `${e.reason} req=${e.requestId} src=${e.sourceBuilding} dst=${e.destBuilding} mat=${EMaterialType[e.material]}`
            );
        });

        sim.placeBuilding(BuildingType.ResidenceSmall);
        const coalMineId = sim.placeMineBuilding(BuildingType.CoalMine, OreType.Coal);
        const ironMineId = sim.placeMineBuilding(BuildingType.IronMine, OreType.Iron);
        const smelterId = sim.placeBuilding(BuildingType.IronSmelter);

        sim.injectInput(coalMineId, EMaterialType.BREAD, 8);
        sim.injectInput(ironMineId, EMaterialType.BREAD, 8);

        sim.runUntil(() => sim.getOutput(smelterId, EMaterialType.IRONBAR) >= 1, { maxTicks: 300 * 30 });
        if (sim.getOutput(smelterId, EMaterialType.IRONBAR) === 0 && failures.length > 0) {
            console.log('ASSIGNMENT FAILURES (first 10):', failures.slice(0, 10));
        }
        expect(sim.getOutput(smelterId, EMaterialType.IRONBAR)).toBeGreaterThanOrEqual(1);
    });

    it('tool & weapon chain: mines → smelter → iron bars → toolsmith → axes + weaponsmith → swords', () => {
        sim = createSimulation({ mapWidth: 256, mapHeight: 256 });

        sim.eventBus.on('inventory:changed', e => {
            if (e.slotType === 'output') {
                console.log(
                    `[output] building=${e.buildingId} mat=${EMaterialType[e.materialType]} ${e.previousAmount}->${e.newAmount}`
                );
            }
        });

        sim.placeBuilding(BuildingType.ResidenceSmall);
        const coalMineId = sim.placeMineBuilding(BuildingType.CoalMine, OreType.Coal);
        const ironMineId = sim.placeMineBuilding(BuildingType.IronMine, OreType.Iron);
        const smelterId = sim.placeBuilding(BuildingType.IronSmelter);
        const toolSmithId = sim.placeBuilding(BuildingType.ToolSmith);
        const weaponSmithId = sim.placeBuilding(BuildingType.WeaponSmith);

        sim.injectInput(coalMineId, EMaterialType.BREAD, 8);
        sim.injectInput(ironMineId, EMaterialType.BREAD, 8);
        sim.injectInput(smelterId, EMaterialType.IRONORE, 8);
        sim.injectInput(smelterId, EMaterialType.COAL, 8);
        sim.injectInput(toolSmithId, EMaterialType.COAL, 8);
        sim.injectInput(toolSmithId, EMaterialType.IRONBAR, 4);
        sim.injectInput(weaponSmithId, EMaterialType.COAL, 8);
        sim.injectInput(weaponSmithId, EMaterialType.IRONBAR, 4);

        sim.runUntil(
            () =>
                sim.getOutput(toolSmithId, EMaterialType.AXE) >= 1 &&
                sim.getOutput(weaponSmithId, EMaterialType.SWORD) >= 1,
            { maxTicks: 600 * 30 }
        );
        expect(sim.getOutput(toolSmithId, EMaterialType.AXE)).toBeGreaterThanOrEqual(1);
        expect(sim.getOutput(weaponSmithId, EMaterialType.SWORD)).toBeGreaterThanOrEqual(1);
    });
});

// ─── Dual-input & single-input transformers ───────────────────────

describe('Economy – transformer buildings', { timeout: 5000 }, () => {
    let sim: Simulation;

    afterEach(() => {
        sim?.destroy();
        cleanupSimulation();
    });

    it('iron smelter: IRONORE + COAL → IRONBAR (isolated)', () => {
        sim = createSimulation();

        sim.placeBuilding(BuildingType.ResidenceSmall);
        const smelterId = sim.placeBuilding(BuildingType.IronSmelter);

        sim.injectInput(smelterId, EMaterialType.IRONORE, 3);
        sim.injectInput(smelterId, EMaterialType.COAL, 3);

        sim.runUntil(() => sim.getOutput(smelterId, EMaterialType.IRONBAR) >= 3, { maxTicks: 300 * 30 });
        expect(sim.getOutput(smelterId, EMaterialType.IRONBAR)).toBe(3);

        expect(sim.getInput(smelterId, EMaterialType.IRONORE)).toBe(0);
        expect(sim.getInput(smelterId, EMaterialType.COAL)).toBe(0);
    });

    it('toolsmith: IRONBAR + COAL → AXE (isolated, no input material in output)', () => {
        sim = createSimulation();

        sim.placeBuilding(BuildingType.ResidenceSmall);
        const toolSmithId = sim.placeBuilding(BuildingType.ToolSmith);

        sim.injectInput(toolSmithId, EMaterialType.IRONBAR, 2);
        sim.injectInput(toolSmithId, EMaterialType.COAL, 2);

        sim.runUntil(() => sim.getOutput(toolSmithId, EMaterialType.AXE) >= 2, { maxTicks: 300 * 30 });
        expect(sim.getOutput(toolSmithId, EMaterialType.AXE)).toBe(2);

        expect(sim.getInput(toolSmithId, EMaterialType.IRONBAR)).toBe(0);
        expect(sim.getInput(toolSmithId, EMaterialType.COAL)).toBe(0);
    });

    it('weaponsmith: IRONBAR + COAL → SWORD (isolated)', () => {
        sim = createSimulation();

        sim.placeBuilding(BuildingType.ResidenceSmall);
        const weaponSmithId = sim.placeBuilding(BuildingType.WeaponSmith);

        sim.injectInput(weaponSmithId, EMaterialType.IRONBAR, 2);
        sim.injectInput(weaponSmithId, EMaterialType.COAL, 2);

        sim.runUntil(() => sim.getOutput(weaponSmithId, EMaterialType.SWORD) >= 2, { maxTicks: 300 * 30 });
        expect(sim.getOutput(weaponSmithId, EMaterialType.SWORD)).toBe(2);
    });

    it('multi-building workers: buildingJobs map separates jobs by building type', () => {
        sim = createSimulation();
        const configs = buildAllSettlerConfigs();

        const smelterConfig = configs.get(UnitType.Smelter)!;
        expect(smelterConfig.buildingJobs).toBeDefined();
        expect(smelterConfig.buildingJobs!.get(BuildingType.IronSmelter)).toContain('JOB_SMELTERIRON_WORK');
        expect(smelterConfig.buildingJobs!.get(BuildingType.SmeltGold)).toContain('JOB_SMELTERGOLD_WORK');
        expect(smelterConfig.buildingJobs!.get(BuildingType.SmeltGold)).not.toContain('JOB_SMELTERIRON_WORK');

        const smithConfig = configs.get(UnitType.Smith)!;
        expect(smithConfig.buildingJobs).toBeDefined();
        expect(smithConfig.buildingJobs!.get(BuildingType.ToolSmith)).toContain('JOB_TOOLSMITH_WORK');
        expect(smithConfig.buildingJobs!.get(BuildingType.WeaponSmith)).toContain('JOB_WEAPONSMITH_WORK');
        expect(smithConfig.buildingJobs!.get(BuildingType.WeaponSmith)).not.toContain('JOB_TOOLSMITH_WORK');
    });

    it('gold smelter: GOLDORE + COAL → GOLDBAR (isolated)', () => {
        sim = createSimulation();

        sim.placeBuilding(BuildingType.ResidenceSmall);
        const goldSmelterId = sim.placeBuilding(BuildingType.SmeltGold);

        sim.injectInput(goldSmelterId, EMaterialType.GOLDORE, 2);
        sim.injectInput(goldSmelterId, EMaterialType.COAL, 2);

        sim.runUntil(() => sim.getOutput(goldSmelterId, EMaterialType.GOLDBAR) >= 2, { maxTicks: 300 * 30 });
        expect(sim.getOutput(goldSmelterId, EMaterialType.GOLDBAR)).toBe(2);

        expect(sim.getInput(goldSmelterId, EMaterialType.GOLDORE)).toBe(0);
        expect(sim.getInput(goldSmelterId, EMaterialType.COAL)).toBe(0);
    });

    it('bakery: FLOUR + WATER → BREAD (isolated)', () => {
        sim = createSimulation();

        sim.placeBuilding(BuildingType.ResidenceSmall);
        const bakeryId = sim.placeBuilding(BuildingType.Bakery);

        sim.injectInput(bakeryId, EMaterialType.FLOUR, 2);
        sim.injectInput(bakeryId, EMaterialType.WATER, 2);

        sim.runUntil(() => sim.getOutput(bakeryId, EMaterialType.BREAD) >= 2, { maxTicks: 300 * 30 });
        expect(sim.getOutput(bakeryId, EMaterialType.BREAD)).toBe(2);
    });

    it('sawmill: LOG → BOARD (single-input, explicit output material)', () => {
        sim = createSimulation();

        sim.placeBuilding(BuildingType.ResidenceSmall);
        const sawmillId = sim.placeBuilding(BuildingType.Sawmill);

        sim.injectInput(sawmillId, EMaterialType.LOG, 3);

        sim.runUntil(() => sim.getOutput(sawmillId, EMaterialType.BOARD) >= 3, { maxTicks: 300 * 30 });
        expect(sim.getOutput(sawmillId, EMaterialType.BOARD)).toBe(3);
        expect(sim.getInput(sawmillId, EMaterialType.LOG)).toBe(0);
    });

    it('mill: GRAIN → FLOUR (single-input transformer)', () => {
        sim = createSimulation();

        sim.placeBuilding(BuildingType.ResidenceSmall);
        const millId = sim.placeBuilding(BuildingType.Mill);

        sim.injectInput(millId, EMaterialType.GRAIN, 2);

        sim.runUntil(() => sim.getOutput(millId, EMaterialType.FLOUR) >= 2, { maxTicks: 300 * 30 });
        expect(sim.getOutput(millId, EMaterialType.FLOUR)).toBe(2);
    });
});

// ─── Barracks training ────────────────────────────────────────────

describe('Economy – barracks training', { timeout: 5000 }, () => {
    let sim: Simulation;

    afterEach(() => {
        sim?.destroy();
        cleanupSimulation();
    });

    it('barracks training: weapons + carriers → soldiers', () => {
        sim = createSimulation({ mapWidth: 256, mapHeight: 256 });

        let trainingStarted = 0;
        let trainingCompleted = 0;
        sim.eventBus.on('barracks:trainingStarted', () => trainingStarted++);
        sim.eventBus.on('barracks:trainingCompleted', () => trainingCompleted++);

        sim.placeBuilding(BuildingType.StorageArea);
        sim.placeBuilding(BuildingType.ResidenceSmall);
        const barracksId = sim.placeBuilding(BuildingType.Barrack);

        sim.execute({ type: 'set_production_mode', buildingId: barracksId, mode: ProductionMode.Manual });
        sim.execute({
            type: 'add_to_production_queue',
            buildingId: barracksId,
            recipeIndex: TrainingRecipeIndex.SwordsmanL1,
        });
        sim.execute({
            type: 'add_to_production_queue',
            buildingId: barracksId,
            recipeIndex: TrainingRecipeIndex.SwordsmanL1,
        });

        sim.injectInput(barracksId, EMaterialType.SWORD, 2);

        sim.runUntil(() => trainingCompleted >= 2, { maxTicks: 600 * 30 });

        expect(trainingStarted).toBe(2);
        expect(trainingCompleted).toBe(2);

        const carriers = sim.state.entities.filter(e => e.type === EntityType.Unit && e.subType === UnitType.Carrier);
        expect(carriers).toHaveLength(0);
    });

    it('barracks training: manual mode queues specific soldier types', () => {
        sim = createSimulation({ mapWidth: 256, mapHeight: 256 });

        const trained: { unitType: number; level: number }[] = [];
        sim.eventBus.on('barracks:trainingCompleted', e => {
            trained.push({ unitType: e.unitType, level: e.soldierLevel });
        });

        const storageId = sim.placeBuilding(BuildingType.StorageArea);
        sim.placeBuilding(BuildingType.ResidenceMedium);
        const barracksId = sim.placeBuilding(BuildingType.Barrack);

        sim.execute({ type: 'set_production_mode', buildingId: barracksId, mode: ProductionMode.Manual });

        sim.execute({
            type: 'add_to_production_queue',
            buildingId: barracksId,
            recipeIndex: TrainingRecipeIndex.BowmanL1,
        });
        sim.execute({
            type: 'add_to_production_queue',
            buildingId: barracksId,
            recipeIndex: TrainingRecipeIndex.SwordsmanL2,
        });
        sim.execute({
            type: 'add_to_production_queue',
            buildingId: barracksId,
            recipeIndex: TrainingRecipeIndex.SquadLeader,
        });

        sim.injectOutput(storageId, EMaterialType.BOW, 8);
        sim.injectOutput(storageId, EMaterialType.SWORD, 8);
        sim.injectOutput(storageId, EMaterialType.GOLDBAR, 8);
        sim.injectOutput(storageId, EMaterialType.ARMOR, 8);

        sim.runUntil(() => trained.length >= 3, { maxTicks: 6000 });

        expect(trained).toHaveLength(3);
        expect(trained[0]).toEqual({ unitType: UnitType.Bowman1, level: 1 });
        expect(trained[1]).toEqual({ unitType: UnitType.Swordsman1, level: 2 });
        expect(trained[2]).toEqual({ unitType: UnitType.SquadLeader, level: 1 });

        expect(sim.countEntities(EntityType.Unit, UnitType.Bowman1)).toBe(1);
        expect(sim.countEntities(EntityType.Unit, UnitType.Swordsman2)).toBe(1);
        expect(sim.countEntities(EntityType.Unit, UnitType.SquadLeader)).toBe(1);

        sim.runTicks(60 * 30);
        expect(trained).toHaveLength(3);
    });
});
