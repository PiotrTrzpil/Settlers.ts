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
import { SlotKind } from '@/game/core/pile-kind';
import { createSimulation, createScenario, cleanupSimulation, type Simulation } from '../../helpers/test-simulation';
import { installRealGameData } from '../../helpers/test-game-data';

installRealGameData();

describe('Free pile logistics (real game data)', { timeout: 30_000 }, () => {
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
        expect(sim.services.inventoryManager.hasSlots(pileId)).toBe(true);
        const slots = sim.services.inventoryManager.getSlots(pileId);
        const freeSlots = slots.filter(s => s.kind === SlotKind.Free);
        expect(freeSlots).toHaveLength(1);
        expect(freeSlots[0]!.materialType).toBe(EMaterialType.LOG);
        expect(freeSlots[0]!.currentAmount).toBe(3);
    });

    it('free pile inventory is cleaned up when pile entity is removed', () => {
        sim = createSimulation();
        sim.placeBuilding(BuildingType.ResidenceSmall);

        const pileId = sim.placeGoods(EMaterialType.LOG, 3);
        expect(sim.services.inventoryManager.hasSlots(pileId)).toBe(true);

        sim.state.removeEntity(pileId);
        expect(sim.services.inventoryManager.hasSlots(pileId)).toBe(false);
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
                return (
                    !!site &&
                    sim.services.inventoryManager
                        .getSlots(s.siteId)
                        .filter(slot => slot.kind === SlotKind.Input)
                        .some(slot => slot.currentAmount > 0)
                );
            },
            { maxTicks: 50_000, label: 'material delivered from free pile' }
        );

        expect(
            sim.services.inventoryManager
                .getSlots(s.siteId)
                .filter(slot => slot.kind === SlotKind.Input)
                .some(slot => slot.currentAmount > 0)
        ).toBe(true);
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
        expect(sim.services.inventoryManager.hasSlots(pileId)).toBe(true);
        const slots = sim.services.inventoryManager.getSlots(pileId);
        const freeSlot = slots.find(s => s.kind === SlotKind.Free)!;
        expect(freeSlot).toBeDefined();
        expect(freeSlot.materialType).toBe(EMaterialType.BOARD);
        expect(freeSlot.currentAmount).toBe(3);
    });

    it('destroyed building piles become free and carriers create new jobs from them', () => {
        sim = createSimulation();
        sim.placeBuilding(BuildingType.ResidenceSmall);
        const sawmillId = sim.placeBuilding(BuildingType.Sawmill);
        sim.injectOutput(sawmillId, EMaterialType.BOARD, 3);

        // Place a construction site that needs BOARDs
        const siteId = sim.placeBuilding(BuildingType.WoodcutterHut, 0, false);

        // Run until a carrier is assigned a transport job from the sawmill
        sim.runUntil(
            () =>
                [...sim.services.logisticsDispatcher.jobStore.jobs.raw.values()].some(
                    j => j.sourceBuilding === sawmillId
                ),
            { maxTicks: 50_000, label: 'carrier assigned transport from sawmill' }
        );

        // Find the pile entity at the sawmill
        const piles = sim.state.entities.filter(
            e => e.type === EntityType.StackedPile && e.subType === EMaterialType.BOARD
        );
        const pileId = piles[0]!.id;

        // Destroy the sawmill — old job is cancelled, pile becomes free
        sim.state.removeEntity(sawmillId);

        // Pile should still exist as a free pile
        expect(sim.state.getEntity(pileId)).toBeDefined();
        expect(sim.state.piles.getKind(pileId).kind).toBe('free');

        // Logistics should create a new job from the free pile to the construction site
        sim.runUntil(() => sim.services.inventoryManager.getSlots(siteId).some(s => s.currentAmount > 0), {
            maxTicks: 50_000,
            label: 'material delivered from free pile after building destroyed',
        });
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
                return (
                    !!site &&
                    sim.services.inventoryManager
                        .getSlots(s.siteId)
                        .filter(slot => slot.kind === SlotKind.Input)
                        .some(slot => slot.currentAmount > 0)
                );
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
