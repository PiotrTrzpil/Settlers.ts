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

describe('Construction worker top-up', { timeout: 30_000 }, () => {
    let sim: Simulation;

    afterEach(() => {
        sim?.destroy();
        cleanupSimulation();
    });

    // ─── Digger top-up ────────────────────────────────────────────

    it('site recruits additional diggers when global cap frees up', () => {
        sim = createSimulation();

        // Residence for carriers
        sim.placeBuilding(BuildingType.ResidenceSmall);
        sim.placeBuilding(BuildingType.ResidenceMedium); // More carriers

        // Storage with construction materials for two buildings
        const storageId = sim.placeBuilding(BuildingType.StorageArea);
        sim.injectOutput(storageId, EMaterialType.BOARD, 8);
        sim.injectOutput(storageId, EMaterialType.STONE, 8);

        // Tools: enough shovels + hammers for multiple workers
        sim.placeGoods(EMaterialType.SHOVEL, 8);
        sim.placeGoods(EMaterialType.HAMMER, 8);

        // Place first building as construction site
        const site1Id = sim.placeBuilding(BuildingType.WoodcutterHut, 0, false);

        // Tick enough for initial demand creation + first drain cycle
        sim.runTicks(60);

        // Place a second site — cap may limit its initial digger demands
        const site2Id = sim.placeBuilding(BuildingType.WoodcutterHut, 0, false);

        // Wait for first site to complete leveling
        sim.waitForPhase(site1Id, BuildingConstructionPhase.WaitingForBuilders, 50_000);

        // Now run enough ticks for the top-up timer (100 ticks) to fire
        // and for new diggers to be recruited for site 2
        sim.runTicks(200);

        // Second site should also eventually complete leveling
        sim.waitForPhase(site2Id, BuildingConstructionPhase.WaitingForBuilders, 50_000);

        expect(sim.errors).toHaveLength(0);
    });

    it('two sequential construction sites both complete when sharing digger cap', () => {
        sim = createSimulation();

        // Residence for carriers
        sim.placeBuilding(BuildingType.ResidenceSmall);
        sim.placeBuilding(BuildingType.ResidenceMedium); // More carriers

        // Storage with lots of materials
        const storageId = sim.placeBuilding(BuildingType.StorageArea);
        sim.injectOutput(storageId, EMaterialType.BOARD, 8);
        sim.injectOutput(storageId, EMaterialType.STONE, 8);

        // Plenty of tools
        sim.placeGoods(EMaterialType.SHOVEL, 8);
        sim.placeGoods(EMaterialType.HAMMER, 8);

        // Place two construction sites simultaneously
        const site1Id = sim.placeBuilding(BuildingType.WoodcutterHut, 0, false);
        const site2Id = sim.placeBuilding(BuildingType.WoodcutterHut, 0, false);

        // Both should eventually complete construction
        sim.waitForConstructionComplete(site1Id, 80_000);
        sim.waitForConstructionComplete(site2Id, 80_000);

        // Both woodcutters should have spawned
        expect(sim.countEntities(EntityType.Unit, UnitType.Woodcutter)).toBe(2);
        expect(sim.errors).toHaveLength(0);
    });

    // ─── Builder top-up ────────────────────────────────────────────

    it('site recruits additional builders when global cap frees up', () => {
        sim = createSimulation();

        // Residence for carriers
        sim.placeBuilding(BuildingType.ResidenceSmall);
        sim.placeBuilding(BuildingType.ResidenceMedium);

        // Storage with lots of materials
        const storageId = sim.placeBuilding(BuildingType.StorageArea);
        sim.injectOutput(storageId, EMaterialType.BOARD, 8);
        sim.injectOutput(storageId, EMaterialType.STONE, 8);

        // Plenty of tools
        sim.placeGoods(EMaterialType.SHOVEL, 8);
        sim.placeGoods(EMaterialType.HAMMER, 8);

        // Place two sites, both should share builders via cap
        const site1Id = sim.placeBuilding(BuildingType.WoodcutterHut, 0, false);
        const site2Id = sim.placeBuilding(BuildingType.WoodcutterHut, 0, false);

        // Wait for both to reach building phase
        sim.waitForPhase(site1Id, BuildingConstructionPhase.ConstructionRising, 50_000);
        sim.waitForPhase(site2Id, BuildingConstructionPhase.ConstructionRising, 50_000);

        // Both should eventually complete — builders freed from site1 should top-up site2
        sim.waitForConstructionComplete(site1Id, 80_000);
        sim.waitForConstructionComplete(site2Id, 80_000);

        expect(sim.countEntities(EntityType.Unit, UnitType.Woodcutter)).toBe(2);
        expect(sim.errors).toHaveLength(0);
    });

    // ─── Idle specialist assignment ignores recruitment cap ─────────

    it('manually spawned idle digger is assigned to site even when recruitment cap is full', () => {
        sim = createSimulation({ mapWidth: 256, mapHeight: 256 });

        // Residence for carriers (placed before slope so auto-placer finds flat ground)
        const residenceId = sim.placeBuilding(BuildingType.ResidenceSmall);

        // Storage with materials
        const storageId = sim.placeBuilding(BuildingType.StorageArea);
        sim.injectOutput(storageId, EMaterialType.BOARD, 8);
        sim.injectOutput(storageId, EMaterialType.STONE, 8);

        // Tools for recruitment
        sim.placeGoods(EMaterialType.SHOVEL, 8);
        sim.placeGoods(EMaterialType.HAMMER, 8);

        // Create uneven terrain so digging takes multiple tiles and doesn't finish instantly
        createSlope(sim.map, 20, 20, 50, 50, 0, 40);

        // Place two construction sites ON the slope so they have many unleveled tiles
        const site1Id = sim.placeBuildingAt(30, 30, BuildingType.WoodcutterHut, 0, false);
        const site2Id = sim.placeBuildingAt(40, 40, BuildingType.WoodcutterHut, 0, false);

        // Run until recruited diggers are actually working (carriers transformed)
        sim.runUntil(() => sim.countEntities(EntityType.Unit, UnitType.Digger) >= 2, {
            maxTicks: 30_000,
            label: 'diggers recruited',
        });

        // Both sites should still be in digging phase (slope terrain = many tiles)
        const s1 = sim.services.constructionSiteManager.getSite(site1Id);
        const s2 = sim.services.constructionSiteManager.getSite(site2Id);
        expect((s1 && !s1.terrain.complete) || (s2 && !s2.terrain.complete)).toBe(true);

        // Now manually spawn an idle digger — it should be assigned to
        // whichever site still needs diggers, regardless of recruitment cap.
        const manualDiggerId = sim.spawnUnitNear(residenceId, UnitType.Digger)[0]!;

        // Let the demand system pick up the idle specialist (runs every ~1s)
        sim.runTicks(60);

        // The digger should have been assigned a job (not idle)
        expect(sim.services.settlerTaskSystem.isWorking(manualDiggerId)).toBe(true);

        expect(sim.errors).toHaveLength(0);
    });

    it('manually spawned idle builder is assigned to site even when recruitment cap is full', () => {
        sim = createSimulation();

        // Residence for carriers
        sim.placeBuilding(BuildingType.ResidenceSmall);
        sim.placeBuilding(BuildingType.ResidenceMedium);

        // Storage with materials
        const storageId = sim.placeBuilding(BuildingType.StorageArea);
        sim.injectOutput(storageId, EMaterialType.BOARD, 8);
        sim.injectOutput(storageId, EMaterialType.STONE, 8);

        // Pre-spawn digger so leveling completes quickly
        sim.spawnUnitNear(storageId, UnitType.Digger);

        // Tools
        sim.placeGoods(EMaterialType.SHOVEL, 8);
        sim.placeGoods(EMaterialType.HAMMER, 8);

        // Place two construction sites
        const siteId = sim.placeBuilding(BuildingType.WoodcutterHut, 0, false);
        sim.placeBuilding(BuildingType.WoodcutterHut, 0, false);

        // Wait for at least one to reach building phase
        sim.waitForPhase(siteId, BuildingConstructionPhase.ConstructionRising, 50_000);

        // Run until builders get recruited
        sim.runUntil(() => sim.countEntities(EntityType.Unit, UnitType.Builder) >= 2, {
            maxTicks: 10_000,
            label: 'builders recruited',
        });

        // Now manually spawn an idle builder
        const manualBuilderId = sim.spawnUnitNear(storageId, UnitType.Builder)[0]!;

        // Let the demand system pick it up
        sim.runTicks(60);

        // The builder should have been assigned a job
        expect(sim.services.settlerTaskSystem.isWorking(manualBuilderId)).toBe(true);

        expect(sim.errors).toHaveLength(0);
    });

    // ─── Recruitment cap enforcement ─────────────────────────────────

    it('never auto-recruits more than 4 diggers from carriers across a long simulation', () => {
        sim = createSimulation({ mapWidth: 256, mapHeight: 256 });

        // Plenty of carriers via residences
        sim.placeBuilding(BuildingType.ResidenceSmall);
        sim.placeBuilding(BuildingType.ResidenceMedium);
        sim.placeBuilding(BuildingType.ResidenceMedium);

        // Plenty of tools
        sim.placeGoods(EMaterialType.SHOVEL, 8);
        sim.placeGoods(EMaterialType.HAMMER, 8);

        // Create uneven terrain so digging takes many tiles across many drain cycles
        createSlope(sim.map, 20, 20, 80, 80, 0, 40);

        // Place TWO large buildings on slope — total digger demand far exceeds cap of 4
        sim.placeBuildingAt(30, 30, BuildingType.ResidenceBig, 0, false);
        sim.placeBuildingAt(50, 50, BuildingType.ResidenceBig, 0, false);

        // Track the max digger count seen across many drain cycles.
        // The bug: as diggers finish tiles and their demands are removed,
        // remainingRecruitmentCap under-counts and recruits more carriers,
        // eventually exceeding the cap of 4.
        let maxDiggersSeen = 0;
        for (let i = 0; i < 50; i++) {
            sim.runTicks(100);
            const diggers = sim.countEntities(EntityType.Unit, UnitType.Digger);
            const pending = sim.services.unitTransformer.getPendingCountByType(UnitType.Digger);
            maxDiggersSeen = Math.max(maxDiggersSeen, diggers + pending);
        }

        // The cap is 4 — we should never see more than 4 diggers (real + pending)
        expect(maxDiggersSeen).toBeLessThanOrEqual(4);
        expect(sim.errors).toHaveLength(0);
    });

    it('never auto-recruits more than 4 builders from carriers across a long simulation', () => {
        sim = createSimulation({ mapWidth: 256, mapHeight: 256 });

        // Plenty of carriers via residences
        sim.placeBuilding(BuildingType.ResidenceSmall);
        sim.placeBuilding(BuildingType.ResidenceMedium);
        sim.placeBuilding(BuildingType.ResidenceMedium);

        // Storage with materials
        const storageId = sim.placeBuilding(BuildingType.StorageArea);
        sim.injectOutput(storageId, EMaterialType.BOARD, 8);
        sim.injectOutput(storageId, EMaterialType.STONE, 8);
        sim.injectOutput(storageId, EMaterialType.LOG, 8);

        // Plenty of tools
        sim.placeGoods(EMaterialType.SHOVEL, 8);
        sim.placeGoods(EMaterialType.HAMMER, 8);

        // Create uneven terrain
        createSlope(sim.map, 20, 20, 80, 80, 0, 40);

        // Place TWO large buildings — total builder demand far exceeds cap of 4
        const site1Id = sim.placeBuildingAt(30, 30, BuildingType.ResidenceBig, 0, false);
        sim.placeBuildingAt(50, 50, BuildingType.ResidenceBig, 0, false);

        // Wait for at least one site to enter building phase
        sim.waitForPhase(site1Id, BuildingConstructionPhase.WaitingForBuilders, 50_000);

        // Track max builder count across many drain cycles
        let maxBuildersSeen = 0;
        for (let i = 0; i < 50; i++) {
            sim.runTicks(100);
            const builders = sim.countEntities(EntityType.Unit, UnitType.Builder);
            const pending = sim.services.unitTransformer.getPendingCountByType(UnitType.Builder);
            maxBuildersSeen = Math.max(maxBuildersSeen, builders + pending);
        }

        // The cap is 4 — we should never see more than 4 builders (real + pending)
        expect(maxBuildersSeen).toBeLessThanOrEqual(4);
        expect(sim.errors).toHaveLength(0);
    });

    // ─── Late arrival handling ─────────────────────────────────────

    it('digger arriving after leveling completes becomes idle without errors', () => {
        sim = createSimulation();

        const residenceId = sim.placeBuilding(BuildingType.ResidenceSmall);

        // Storage with materials
        const storageId = sim.placeBuilding(BuildingType.StorageArea);
        sim.injectOutput(storageId, EMaterialType.BOARD, 8);
        sim.injectOutput(storageId, EMaterialType.STONE, 8);

        // Place tools far away so the recruited digger takes longer to arrive
        sim.placeGoods(EMaterialType.SHOVEL, 4);
        sim.placeGoods(EMaterialType.HAMMER, 4);

        // Also spawn an idle digger nearby that will finish fast
        sim.spawnUnitNear(residenceId, UnitType.Digger);

        // Place construction site (flat terrain → leveling completes on first digger cycle)
        const siteId = sim.placeBuilding(BuildingType.WoodcutterHut, 0, false);

        // Run until construction completes — recruited carrier-turned-digger
        // may still be walking to the site after leveling is done
        sim.waitForConstructionComplete(siteId, 80_000);

        // Run extra ticks to let late-arriving workers settle
        sim.runTicks(500);

        expect(sim.countEntities(EntityType.Unit, UnitType.Woodcutter)).toBe(1);
        expect(sim.errors).toHaveLength(0);
    });

    it('builder arriving after construction completes becomes idle without errors', () => {
        sim = createSimulation();

        const residenceId = sim.placeBuilding(BuildingType.ResidenceSmall);

        // Storage with materials
        const storageId = sim.placeBuilding(BuildingType.StorageArea);
        sim.injectOutput(storageId, EMaterialType.BOARD, 8);
        sim.injectOutput(storageId, EMaterialType.STONE, 8);

        // Spawn idle specialists for fast completion
        sim.spawnUnitNear(residenceId, UnitType.Digger);
        sim.spawnUnitNear(residenceId, UnitType.Builder, 2);

        // Tools far away for slower carrier recruitment path
        sim.placeGoods(EMaterialType.HAMMER, 4);
        sim.placeGoods(EMaterialType.SHOVEL, 4);

        const siteId = sim.placeBuilding(BuildingType.WoodcutterHut, 0, false);

        sim.waitForConstructionComplete(siteId, 80_000);

        // Run extra ticks to let any late-arriving recruited builders settle
        sim.runTicks(500);

        expect(sim.countEntities(EntityType.Unit, UnitType.Woodcutter)).toBe(1);
        expect(sim.errors).toHaveLength(0);
    });
});
