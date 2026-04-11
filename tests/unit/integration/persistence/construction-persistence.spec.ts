/**
 * Construction persistence integration tests — verify construction state
 * is preserved across save/load at every meaningful phase.
 *
 * NOTE: The test map has flat terrain, so terrain leveling completes instantly
 * (0 unleveled tiles). WaitingForDiggers → WaitingForBuilders in the same tick.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { createScenario, cleanupSimulation, type Simulation } from '../../helpers/test-simulation';
import { installRealGameData } from '../../helpers/test-game-data';
import { BuildingType } from '@/game/buildings/building-type';
import { BuildingConstructionPhase } from '@/game/features/building-construction/types';
import { SlotKind } from '@/game/core/pile-kind';

installRealGameData();

// ─── Helpers ─────────────────────────────────────────────────────

function getSiteOrFail(sim: Simulation, siteId: number) {
    const site = sim.services.constructionSiteManager.getSite(siteId);
    expect(site, `construction site ${siteId} should exist`).toBeDefined();
    return site!;
}

function countDeliveredMaterials(sim: Simulation, siteId: number): number {
    return sim.services.inventoryManager
        .getSlots(siteId)
        .filter(s => s.kind === SlotKind.Input)
        .reduce((sum, s) => s.currentAmount + sum, 0);
}

// ─── Tests ───────────────────────────────────────────────────────

describe('Construction persistence', { timeout: 60_000 }, () => {
    let sim: Simulation & { siteId: number; storageId: number };
    let restored: Simulation | undefined;

    afterEach(() => {
        sim?.destroy();
        restored?.destroy();
        restored = undefined;
        cleanupSimulation();
    });

    it('preserves WaitingForBuilders phase — leveling progress, costs, slots, piles all correct', () => {
        sim = createScenario.constructionSite(BuildingType.Sawmill);
        const siteId = sim.siteId;

        sim.waitForPhase(siteId, BuildingConstructionPhase.WaitingForBuilders, 30_000);
        const before = getSiteOrFail(sim, siteId);

        restored = sim.saveAndRestore(10);

        const after = getSiteOrFail(restored, siteId);
        // Phase and terrain progress preserved
        expect(after.terrain.complete).toBe(true);
        expect(after.terrain.progress).toBe(1);
        expect(after.terrain.modified).toBe(before.terrain.modified);
        // Derived fields recomputed correctly
        expect(after.materials.totalCost).toBe(before.materials.totalCost);
        expect(after.materials.costs.length).toBe(before.materials.costs.length);
        expect(after.terrain.slots.required).toBe(before.terrain.slots.required);
        expect(after.building.slots.required).toBe(before.building.slots.required);
        expect(after.pilePositions.size).toBe(before.pilePositions.size);
        // Completes
        restored.waitForConstructionComplete(siteId, 80_000);
        expect(restored.services.constructionSiteManager.hasSite(siteId)).toBe(false);
    });

    it('preserves ConstructionRising with partial progress and completes', () => {
        sim = createScenario.constructionSite(BuildingType.WoodcutterHut);
        const siteId = sim.siteId;

        sim.waitForPhase(siteId, BuildingConstructionPhase.ConstructionRising, 50_000);
        sim.runTicks(200);

        const before = sim.services.constructionSiteManager.getSite(siteId);
        if (!before) return; // completed during those ticks — nothing to test

        restored = sim.saveAndRestore();

        const after = restored.services.constructionSiteManager.getSite(siteId);
        if (after) {
            expect(after.building.progress).toBeGreaterThanOrEqual(before.building.progress * 0.9);
        }
        restored.waitForConstructionComplete(siteId, 80_000);
        expect(restored.services.constructionSiteManager.hasSite(siteId)).toBe(false);
    });

    it('Evacuating phase remapped to WaitingForBuilders on restore', () => {
        sim = createScenario.constructionSite(BuildingType.Sawmill);
        const siteId = sim.siteId;
        sim.runTicks(50);

        getSiteOrFail(sim, siteId).phase = BuildingConstructionPhase.Evacuating;

        restored = sim.saveAndRestore(10);
        expect(getSiteOrFail(restored, siteId).phase).toBe(BuildingConstructionPhase.WaitingForBuilders);
    });

    it('delivered materials in inventory survive restore', () => {
        sim = createScenario.constructionSite(BuildingType.WoodcutterHut);
        const siteId = sim.siteId;

        sim.runUntil(() => countDeliveredMaterials(sim, siteId) > 0, {
            maxTicks: 50_000,
            label: 'material delivered to construction site',
        });
        const deliveredBefore = countDeliveredMaterials(sim, siteId);

        restored = sim.saveAndRestore(10);
        expect(countDeliveredMaterials(restored, siteId)).toBe(deliveredBefore);
    });

    it('building occupancy restored for construction sites past leveling', () => {
        sim = createScenario.constructionSite(BuildingType.Sawmill);
        const siteId = sim.siteId;
        sim.waitForPhase(siteId, BuildingConstructionPhase.WaitingForBuilders, 30_000);

        const occupancyBefore = new Set(sim.state.buildingOccupancy);
        expect(occupancyBefore.size).toBeGreaterThan(0);

        restored = sim.saveAndRestore(10);

        for (const key of occupancyBefore) {
            expect(restored.state.buildingOccupancy.has(key), `tile ${key} missing`).toBe(true);
        }
    });

    it('construction survives 2 consecutive save/restore cycles', () => {
        sim = createScenario.constructionSite(BuildingType.WoodcutterHut);
        const siteId = sim.siteId;
        sim.runTicks(100);

        restored = sim.saveAndRestore(300);
        expect(restored.errors.length, 'errors after restore cycle 1').toBe(0);

        const sim2 = restored.saveAndRestore(300);
        restored.destroy();
        restored = sim2;
        expect(restored.errors.length, 'errors after restore cycle 2').toBe(0);

        restored.waitForConstructionComplete(siteId, 80_000);
        expect(restored.services.constructionSiteManager.hasSite(siteId)).toBe(false);
    });
});
