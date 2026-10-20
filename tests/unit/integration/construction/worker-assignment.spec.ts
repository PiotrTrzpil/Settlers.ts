/**
 * Integration tests for construction worker assignment ownership.
 *
 * ConstructionSiteDemandSystem is the single owner of which worker is committed to
 * which site. These tests verify the observable commitment stream stays consistent
 * across the digging → building lifecycle and that demands are rebuilt from site
 * state after save/restore (in-flight construction jobs are not persisted).
 */

import { describe, it, expect, afterEach } from 'vitest';
import { createSimulation, cleanupSimulation, type Simulation } from '../../helpers/test-simulation';
import { installRealGameData } from '../../helpers/test-game-data';
import { ConstructionAssignmentTracker } from '../../helpers/construction-assignment-tracker';
import { createSlope } from '../../helpers/test-map';
import { BuildingType } from '@/game/buildings/building-type';
import { UnitType } from '@/game/entity';
import { EMaterialType } from '@/game/economy/material-type';
import { BuildingConstructionPhase } from '@/game/features/building-construction';

installRealGameData();

/** Sloped site (needs digging) with storage materials, tools and pre-spawned specialists. */
function setupSlopedSite(sim: Simulation): number {
    createSlope(sim.map, 55, 60, 75, 70, 0, 40);

    const residenceId = sim.placeBuilding(BuildingType.ResidenceSmall);
    const storageId = sim.placeBuilding(BuildingType.StorageArea);
    sim.injectOutput(storageId, EMaterialType.BOARD, 8);
    sim.injectOutput(storageId, EMaterialType.STONE, 8);
    sim.placeGoods(EMaterialType.SHOVEL, 4);
    sim.placeGoods(EMaterialType.HAMMER, 4);

    sim.spawnUnitNear(residenceId, UnitType.Digger, 3);
    sim.spawnUnitNear(residenceId, UnitType.Builder, 3);
    sim.spawnUnitNear(residenceId, UnitType.Carrier, 4);

    return sim.placeBuilding(BuildingType.WoodcutterHut, 0, false);
}

describe('Construction worker assignment', { timeout: 60_000 }, () => {
    let sim: Simulation;
    let restored: Simulation | undefined;

    afterEach(() => {
        sim?.destroy();
        restored?.destroy();
        restored = undefined;
        cleanupSimulation();
    });

    it('commits diggers then builders consistently and releases them all', () => {
        sim = createSimulation();
        const tracker = new ConstructionAssignmentTracker(sim);
        const siteId = setupSlopedSite(sim);

        const site = sim.services.constructionSiteManager.getSiteOrThrow(siteId, 'test');
        expect(site.terrain.complete).toBe(false);

        sim.waitForPhase(siteId, BuildingConstructionPhase.WaitingForBuilders, 50_000);
        expect(tracker.totalAssignments(siteId, 'digger')).toBeGreaterThan(0);
        expect(tracker.activeWorkers(siteId, 'digger')).toBe(0);

        sim.waitForConstructionComplete(siteId, 80_000);
        expect(tracker.totalAssignments(siteId, 'builder')).toBeGreaterThan(0);

        sim.runUntil(() => tracker.activeWorkers(siteId, 'builder') === 0, {
            maxTicks: 5_000,
            label: 'builders released after completion',
        });
        expect(tracker.violations).toEqual([]);
        expect(sim.errors).toHaveLength(0);
    });

    it('rebuilds digger demands from site state after restore mid-leveling', () => {
        sim = createSimulation();
        const siteId = setupSlopedSite(sim);

        sim.runUntil(
            () => {
                const site = sim.services.constructionSiteManager.getSiteOrThrow(siteId, 'test');
                return site.terrain.progress > 0 && !site.terrain.complete;
            },
            { maxTicks: 50_000, label: 'leveling in progress' }
        );

        restored = sim.saveAndRestore(0);
        const tracker = new ConstructionAssignmentTracker(restored);
        const site = restored.services.constructionSiteManager.getSiteOrThrow(siteId, 'test');
        expect(site.terrain.complete).toBe(false);

        restored.waitForPhase(siteId, BuildingConstructionPhase.WaitingForBuilders, 50_000);
        expect(tracker.totalAssignments(siteId, 'digger')).toBeGreaterThan(0);
        expect(tracker.activeWorkers(siteId, 'digger')).toBe(0);

        restored.waitForConstructionComplete(siteId, 80_000);
        expect(tracker.totalAssignments(siteId, 'builder')).toBeGreaterThan(0);
        expect(tracker.violations).toEqual([]);
        expect(restored.errors).toHaveLength(0);
    });

    it('rebuilds builder demands from site state after restore', () => {
        sim = createSimulation();
        const siteId = setupSlopedSite(sim);

        sim.waitForPhase(siteId, BuildingConstructionPhase.ConstructionRising, 80_000);

        restored = sim.saveAndRestore(0);
        const tracker = new ConstructionAssignmentTracker(restored);

        restored.waitForConstructionComplete(siteId, 80_000);
        expect(tracker.totalAssignments(siteId, 'builder')).toBeGreaterThan(0);
        expect(tracker.totalAssignments(siteId, 'digger')).toBe(0);
        expect(tracker.violations).toEqual([]);
        expect(restored.errors).toHaveLength(0);
    });
});
