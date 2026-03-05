/**
 * Integration tests for free pile logistics.
 *
 * Free piles (materials on the ground, not in any building) should be treated
 * as output-only sources by the logistics system. Carriers should pick up from
 * free piles and deliver to buildings that request those materials.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { BuildingType, EntityType, UnitType } from '@/game/entity';
import { EMaterialType } from '@/game/economy';
import { createSimulation, createScenario, cleanupSimulation, type Simulation } from '../../helpers/test-simulation';
import { installRealGameData } from '../../helpers/test-game-data';

const hasRealData = installRealGameData();

describe.skipIf(!hasRealData)('Free pile logistics (real game data)', { timeout: 30_000 }, () => {
    let sim: Simulation;

    afterEach(() => {
        sim?.destroy();
        cleanupSimulation();
    });

    it('free pile is visible as output supply to the logistics system', () => {
        sim = createSimulation();
        sim.placeBuilding(BuildingType.ResidenceSmall);

        const pileId = sim.placeGoods(EMaterialType.LOG, 3);

        // The free pile should be discoverable as output supply
        const inventory = sim.services.inventoryManager.getInventory(pileId);
        expect(inventory).toBeDefined();
        expect(inventory!.outputSlots).toHaveLength(1);
        expect(inventory!.outputSlots[0]!.materialType).toBe(EMaterialType.LOG);
        expect(inventory!.outputSlots[0]!.currentAmount).toBe(3);
    });

    it('free pile inventory is cleaned up when pile entity is removed', () => {
        sim = createSimulation();
        sim.placeBuilding(BuildingType.ResidenceSmall);

        const pileId = sim.placeGoods(EMaterialType.LOG, 3);
        expect(sim.services.inventoryManager.getInventory(pileId)).toBeDefined();

        sim.state.removeEntity(pileId);
        expect(sim.services.inventoryManager.getInventory(pileId)).toBeUndefined();
    });

    it('carrier picks up from free pile and delivers to construction site', () => {
        // Set up: residence (for carriers/service area), construction site, free pile with materials
        const s = createScenario.constructionSite(BuildingType.WoodcutterHut, []);
        sim = s;

        // Place free piles with construction materials near the construction site
        sim.placeGoodsNear(s.siteId, EMaterialType.BOARD, 4);
        sim.placeGoodsNear(s.siteId, EMaterialType.STONE, 4);

        // Run enough ticks for carriers to pick up and deliver
        sim.runUntil(
            () => {
                const site = sim.services.constructionSiteManager.getSite(s.siteId);
                return !!site && site.materials.deliveredAmount > 0;
            },
            { maxTicks: 50_000, label: 'material delivered from free pile' }
        );

        const site = sim.services.constructionSiteManager.getSite(s.siteId)!;
        expect(site.materials.deliveredAmount).toBeGreaterThan(0);
        expect(sim.errors).toHaveLength(0);
    });

    it('full construction completes using only free pile materials', () => {
        const s = createScenario.constructionSite(BuildingType.WoodcutterHut, []);
        sim = s;

        // Place sufficient free piles (WoodcutterHut needs BOARD + STONE)
        sim.placeGoodsNear(s.siteId, EMaterialType.BOARD, 8);
        sim.placeGoodsNear(s.siteId, EMaterialType.STONE, 8);

        sim.waitForConstructionComplete(s.siteId);

        expect(sim.countEntities(EntityType.Unit, UnitType.Woodcutter)).toBe(1);
        expect(sim.errors).toHaveLength(0);
    });

    it('destroyed building piles become free piles with output inventory', () => {
        sim = createSimulation();
        sim.placeBuilding(BuildingType.ResidenceSmall);
        const sawmillId = sim.placeBuilding(BuildingType.Sawmill);

        // Inject output into the sawmill
        sim.injectOutput(sawmillId, EMaterialType.BOARD, 3);

        // Find the pile entity
        const piles = sim.state.entities.filter(
            e => e.type === EntityType.StackedPile && e.subType === EMaterialType.BOARD
        );
        expect(piles).toHaveLength(1);
        const pileId = piles[0]!.id;

        // Destroy the sawmill
        sim.state.removeEntity(sawmillId);

        // Pile entity survives
        expect(sim.state.getEntity(pileId)).toBeDefined();

        // Pile kind is now free
        expect(sim.state.piles.getKind(pileId).kind).toBe('free');

        // Pile has its own output inventory (discoverable by logistics)
        const inventory = sim.services.inventoryManager.getInventory(pileId);
        expect(inventory).toBeDefined();
        expect(inventory!.outputSlots[0]!.materialType).toBe(EMaterialType.BOARD);
        expect(inventory!.outputSlots[0]!.currentAmount).toBe(3);
    });

    it('carrier transport job redirects to free pile when source building destroyed', () => {
        sim = createSimulation();
        sim.placeBuilding(BuildingType.ResidenceSmall);
        const sawmillId = sim.placeBuilding(BuildingType.Sawmill);
        sim.injectOutput(sawmillId, EMaterialType.BOARD, 3);

        // Place a construction site that needs BOARDs
        sim.placeBuilding(BuildingType.WoodcutterHut, 0, false);

        // Run until a carrier is assigned a transport job from the sawmill
        sim.runUntil(
            () => [...sim.services.logisticsDispatcher.activeJobs.values()].some(j => j.sourceBuilding === sawmillId),
            { maxTicks: 50_000, label: 'carrier assigned transport from sawmill' }
        );

        // Get the active job before destroying
        const jobsBefore = [...sim.services.logisticsDispatcher.activeJobs.values()];
        const jobFromSawmill = jobsBefore.find(j => j.sourceBuilding === sawmillId)!;
        const jobId = jobFromSawmill.id;

        // Find the pile entity at the sawmill
        const piles = sim.state.entities.filter(
            e => e.type === EntityType.StackedPile && e.subType === EMaterialType.BOARD
        );
        const pileId = piles[0]!.id;

        // Destroy the sawmill
        sim.state.removeEntity(sawmillId);

        // The transport job should still be active, redirected to the pile entity
        const jobsAfter = [...sim.services.logisticsDispatcher.activeJobs.values()];
        const redirectedJob = jobsAfter.find(j => j.id === jobId);
        expect(redirectedJob).toBeDefined();
        expect(redirectedJob!.sourceBuilding).toBe(pileId);
        expect(redirectedJob!.status).toBe('active');
    });

    it('destroyed building piles are picked up by carriers for pending requests', () => {
        // Build a construction site that needs BOARDs + STONE, with storage providing materials
        const s = createScenario.constructionSite(BuildingType.WoodcutterHut, [
            [EMaterialType.BOARD, 4],
            [EMaterialType.STONE, 4],
        ]);
        sim = s;

        // Let carriers start delivering
        sim.runUntil(
            () => {
                const site = sim.services.constructionSiteManager.getSite(s.siteId);
                return !!site && site.materials.deliveredAmount > 0;
            },
            { maxTicks: 50_000, label: 'first delivery from storage' }
        );

        // Destroy the storage — remaining piles should become free and still get picked up
        sim.state.removeEntity(s.storageId);

        // Place additional free piles to ensure construction can finish
        sim.placeGoodsNear(s.siteId, EMaterialType.BOARD, 4);
        sim.placeGoodsNear(s.siteId, EMaterialType.STONE, 4);

        // Construction should still complete (carriers pick up from free + converted piles)
        sim.waitForConstructionComplete(s.siteId);
        expect(sim.countEntities(EntityType.Unit, UnitType.Woodcutter)).toBe(1);
        expect(sim.errors).toHaveLength(0);
    });
});
