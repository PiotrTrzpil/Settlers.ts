/**
 * Integration tests for construction worker top-up and late arrival handling.
 *
 * Verifies that:
 * 1. Construction sites periodically re-check for available diggers/builders
 *    when global cap frees up (top-up mechanism).
 * 2. Workers arriving after their site is already done become idle without errors.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { createSimulation, cleanupSimulation, type Simulation } from '../../helpers/test-simulation';
import { installRealGameData } from '../../helpers/test-game-data';
import { BuildingType } from '@/game/buildings/building-type';
import { EntityType, UnitType } from '@/game/entity';
import { EMaterialType } from '@/game/economy/material-type';
import { BuildingConstructionPhase } from '@/game/features/building-construction';
import { createSlope } from '../../helpers/test-map';

installRealGameData();

// ─── Digger & builder top-up ──────────────────────────────────────

describe('Construction worker top-up – diggers & builders', { timeout: 30_000 }, () => {
    let sim: Simulation;

    afterEach(() => {
        sim?.destroy();
        cleanupSimulation();
    });

    it('site recruits additional diggers when global cap frees up', () => {
        sim = createSimulation();

        sim.placeBuilding(BuildingType.ResidenceSmall);
        sim.placeBuilding(BuildingType.ResidenceMedium);

        const storageId = sim.placeBuilding(BuildingType.StorageArea);
        sim.injectOutput(storageId, EMaterialType.BOARD, 8);
        sim.injectOutput(storageId, EMaterialType.STONE, 8);

        sim.placeGoods(EMaterialType.SHOVEL, 8);
        sim.placeGoods(EMaterialType.HAMMER, 8);

        const site1Id = sim.placeBuilding(BuildingType.WoodcutterHut, 0, false);

        sim.runTicks(60);

        const site2Id = sim.placeBuilding(BuildingType.WoodcutterHut, 0, false);

        sim.waitForPhase(site1Id, BuildingConstructionPhase.WaitingForBuilders, 50_000);

        sim.runTicks(200);

        sim.waitForPhase(site2Id, BuildingConstructionPhase.WaitingForBuilders, 50_000);

        expect(sim.errors).toHaveLength(0);
    });

    it('two sequential construction sites both complete when sharing digger cap', () => {
        sim = createSimulation();

        sim.placeBuilding(BuildingType.ResidenceSmall);
        sim.placeBuilding(BuildingType.ResidenceMedium);

        const storageId = sim.placeBuilding(BuildingType.StorageArea);
        sim.injectOutput(storageId, EMaterialType.BOARD, 8);
        sim.injectOutput(storageId, EMaterialType.STONE, 8);

        sim.placeGoods(EMaterialType.SHOVEL, 8);
        sim.placeGoods(EMaterialType.HAMMER, 8);

        const site1Id = sim.placeBuilding(BuildingType.WoodcutterHut, 0, false);
        const site2Id = sim.placeBuilding(BuildingType.WoodcutterHut, 0, false);

        sim.waitForConstructionComplete(site1Id, 80_000);
        sim.waitForConstructionComplete(site2Id, 80_000);

        expect(sim.countEntities(EntityType.Unit, UnitType.Woodcutter)).toBe(2);
        expect(sim.errors).toHaveLength(0);
    });

    it('site recruits additional builders when global cap frees up', () => {
        sim = createSimulation();

        sim.placeBuilding(BuildingType.ResidenceSmall);
        sim.placeBuilding(BuildingType.ResidenceMedium);

        const storageId = sim.placeBuilding(BuildingType.StorageArea);
        sim.injectOutput(storageId, EMaterialType.BOARD, 8);
        sim.injectOutput(storageId, EMaterialType.STONE, 8);

        sim.placeGoods(EMaterialType.SHOVEL, 8);
        sim.placeGoods(EMaterialType.HAMMER, 8);

        const site1Id = sim.placeBuilding(BuildingType.WoodcutterHut, 0, false);
        const site2Id = sim.placeBuilding(BuildingType.WoodcutterHut, 0, false);

        sim.waitForPhase(site1Id, BuildingConstructionPhase.ConstructionRising, 50_000);
        sim.waitForPhase(site2Id, BuildingConstructionPhase.ConstructionRising, 50_000);

        sim.waitForConstructionComplete(site1Id, 80_000);
        sim.waitForConstructionComplete(site2Id, 80_000);

        expect(sim.countEntities(EntityType.Unit, UnitType.Woodcutter)).toBe(2);
        expect(sim.errors).toHaveLength(0);
    });
});

// ─── Idle specialist assignment ───────────────────────────────────

describe('Construction worker top-up – idle specialist assignment', { timeout: 30_000 }, () => {
    let sim: Simulation;

    afterEach(() => {
        sim?.destroy();
        cleanupSimulation();
    });

    it('manually spawned idle digger is assigned to site even when recruitment cap is full', () => {
        sim = createSimulation({ mapWidth: 256, mapHeight: 256 });

        const residenceId = sim.placeBuilding(BuildingType.ResidenceSmall);

        const storageId = sim.placeBuilding(BuildingType.StorageArea);
        sim.injectOutput(storageId, EMaterialType.BOARD, 8);
        sim.injectOutput(storageId, EMaterialType.STONE, 8);

        sim.placeGoods(EMaterialType.SHOVEL, 8);
        sim.placeGoods(EMaterialType.HAMMER, 8);

        createSlope(sim.map, 110, 125, 150, 135, 0, 40);

        const site1Id = sim.placeBuildingAt(118, 128, BuildingType.WoodcutterHut, 0, false);
        const site2Id = sim.placeBuildingAt(135, 128, BuildingType.WoodcutterHut, 0, false);

        sim.runUntil(() => sim.countEntities(EntityType.Unit, UnitType.Digger) >= 2, {
            maxTicks: 30_000,
            label: 'diggers recruited',
        });

        const s1 = sim.services.constructionSiteManager.getSite(site1Id);
        const s2 = sim.services.constructionSiteManager.getSite(site2Id);
        expect((s1 && !s1.terrain.complete) || (s2 && !s2.terrain.complete)).toBe(true);

        const manualDiggerId = sim.spawnUnitNear(residenceId, UnitType.Digger)[0]!;

        sim.runTicks(60);

        expect(sim.services.settlerTaskSystem.isWorking(manualDiggerId)).toBe(true);
        expect(sim.errors).toHaveLength(0);
    });

    it('manually spawned idle builder is assigned to site even when recruitment cap is full', () => {
        sim = createSimulation();

        sim.placeBuilding(BuildingType.ResidenceSmall);
        sim.placeBuilding(BuildingType.ResidenceMedium);

        const storageId = sim.placeBuilding(BuildingType.StorageArea);
        sim.injectOutput(storageId, EMaterialType.BOARD, 8);
        sim.injectOutput(storageId, EMaterialType.STONE, 8);

        sim.spawnUnitNear(storageId, UnitType.Digger);

        sim.placeGoods(EMaterialType.SHOVEL, 8);
        sim.placeGoods(EMaterialType.HAMMER, 8);

        const siteId = sim.placeBuilding(BuildingType.WoodcutterHut, 0, false);
        sim.placeBuilding(BuildingType.WoodcutterHut, 0, false);

        sim.waitForPhase(siteId, BuildingConstructionPhase.ConstructionRising, 50_000);

        sim.runUntil(() => sim.countEntities(EntityType.Unit, UnitType.Builder) >= 2, {
            maxTicks: 10_000,
            label: 'builders recruited',
        });

        const manualBuilderId = sim.spawnUnitNear(storageId, UnitType.Builder)[0]!;

        sim.runTicks(60);

        expect(sim.services.settlerTaskSystem.isWorking(manualBuilderId)).toBe(true);
        expect(sim.errors).toHaveLength(0);
    });
});

// ─── Recruitment cap enforcement & late arrival ───────────────────

describe('Construction worker top-up – cap enforcement & late arrival', { timeout: 30_000 }, () => {
    let sim: Simulation;

    afterEach(() => {
        sim?.destroy();
        cleanupSimulation();
    });

    it('never auto-recruits more than 4 diggers from carriers across a long simulation', () => {
        sim = createSimulation({ mapWidth: 256, mapHeight: 256 });

        sim.placeBuilding(BuildingType.ResidenceSmall);
        sim.placeBuilding(BuildingType.ResidenceMedium);
        sim.placeBuilding(BuildingType.ResidenceMedium);

        sim.placeGoods(EMaterialType.SHOVEL, 8);
        sim.placeGoods(EMaterialType.HAMMER, 8);

        createSlope(sim.map, 110, 125, 155, 135, 0, 40);

        sim.placeBuildingAt(118, 128, BuildingType.ResidenceBig, 0, false);
        sim.placeBuildingAt(142, 128, BuildingType.ResidenceBig, 0, false);

        let maxDiggersSeen = 0;
        for (let i = 0; i < 50; i++) {
            sim.runTicks(100);
            const diggers = sim.countEntities(EntityType.Unit, UnitType.Digger);
            const pending = sim.services.unitTransformer.getPendingCountByType(UnitType.Digger);
            maxDiggersSeen = Math.max(maxDiggersSeen, diggers + pending);
        }

        expect(maxDiggersSeen).toBeLessThanOrEqual(4);
        expect(sim.errors).toHaveLength(0);
    });

    it('never auto-recruits more than 4 builders from carriers across a long simulation', () => {
        sim = createSimulation({ mapWidth: 256, mapHeight: 256 });

        sim.placeBuilding(BuildingType.ResidenceSmall);
        sim.placeBuilding(BuildingType.ResidenceMedium);
        sim.placeBuilding(BuildingType.ResidenceMedium);

        const storageId = sim.placeBuilding(BuildingType.StorageArea);
        sim.injectOutput(storageId, EMaterialType.BOARD, 8);
        sim.injectOutput(storageId, EMaterialType.STONE, 8);
        sim.injectOutput(storageId, EMaterialType.LOG, 8);

        sim.placeGoods(EMaterialType.SHOVEL, 8);
        sim.placeGoods(EMaterialType.HAMMER, 8);

        createSlope(sim.map, 110, 125, 155, 135, 0, 40);

        const site1Id = sim.placeBuildingAt(118, 128, BuildingType.ResidenceBig, 0, false);
        sim.placeBuildingAt(142, 128, BuildingType.ResidenceBig, 0, false);

        sim.waitForPhase(site1Id, BuildingConstructionPhase.WaitingForBuilders, 50_000);

        let maxBuildersSeen = 0;
        for (let i = 0; i < 50; i++) {
            sim.runTicks(100);
            const builders = sim.countEntities(EntityType.Unit, UnitType.Builder);
            const pending = sim.services.unitTransformer.getPendingCountByType(UnitType.Builder);
            maxBuildersSeen = Math.max(maxBuildersSeen, builders + pending);
        }

        expect(maxBuildersSeen).toBeLessThanOrEqual(4);
        expect(sim.errors).toHaveLength(0);
    });

    it('digger arriving after leveling completes becomes idle without errors', () => {
        sim = createSimulation();

        const residenceId = sim.placeBuilding(BuildingType.ResidenceSmall);

        const storageId = sim.placeBuilding(BuildingType.StorageArea);
        sim.injectOutput(storageId, EMaterialType.BOARD, 8);
        sim.injectOutput(storageId, EMaterialType.STONE, 8);

        sim.placeGoods(EMaterialType.SHOVEL, 4);
        sim.placeGoods(EMaterialType.HAMMER, 4);

        sim.spawnUnitNear(residenceId, UnitType.Digger);

        const siteId = sim.placeBuilding(BuildingType.WoodcutterHut, 0, false);

        sim.waitForConstructionComplete(siteId, 80_000);

        sim.runTicks(500);

        expect(sim.countEntities(EntityType.Unit, UnitType.Woodcutter)).toBe(1);
        expect(sim.errors).toHaveLength(0);
    });

    it('builder arriving after construction completes becomes idle without errors', () => {
        sim = createSimulation();

        const residenceId = sim.placeBuilding(BuildingType.ResidenceSmall);

        const storageId = sim.placeBuilding(BuildingType.StorageArea);
        sim.injectOutput(storageId, EMaterialType.BOARD, 8);
        sim.injectOutput(storageId, EMaterialType.STONE, 8);

        sim.spawnUnitNear(residenceId, UnitType.Digger);
        sim.spawnUnitNear(residenceId, UnitType.Builder, 2);

        sim.placeGoods(EMaterialType.HAMMER, 4);
        sim.placeGoods(EMaterialType.SHOVEL, 4);

        const siteId = sim.placeBuilding(BuildingType.WoodcutterHut, 0, false);

        sim.waitForConstructionComplete(siteId, 80_000);

        sim.runTicks(500);

        expect(sim.countEntities(EntityType.Unit, UnitType.Woodcutter)).toBe(1);
        expect(sim.errors).toHaveLength(0);
    });
});
