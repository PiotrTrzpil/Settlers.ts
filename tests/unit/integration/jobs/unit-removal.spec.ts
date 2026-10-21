/**
 * Unit removal reaches the job's owner.
 *
 * `GameState.removeEntity` deletes the entity before emitting `entity:removed`, so before the
 * COMMITMENTS-priority removal handler the job of a killed unit was never interrupted: no
 * `onCancel`, no `settler:taskFailed` — the owners' domain state stayed bound to a dead unit
 * (transport record still claimed, construction / workplace demand still committed).
 *
 * These specs cover the TRANSITIONAL legacy path (owners not migrated yet still learn of the
 * removal through their failure path); owned kinds get `onUnitRemoved` (see each migration's spec).
 */

import { describe, it, expect, afterEach } from 'vitest';
import { createSimulation, createScenario, cleanupSimulation, type Simulation } from '../../helpers/test-simulation';
import { installRealGameData } from '../../helpers/test-game-data';
import { createSlope } from '../../helpers/test-map';
import { BuildingType } from '@/game/buildings/building-type';
import { UnitType } from '@/game/entity';
import { EMaterialType } from '@/game/economy/material-type';
import { BuildingConstructionPhase } from '@/game/features/building-construction';

installRealGameData();

/** Count `settler:taskFailed` notifications per unit. */
function countFailures(sim: Simulation): Map<number, number> {
    const failures = new Map<number, number>();
    sim.eventBus.on('settler:taskFailed', ({ unitId }) => failures.set(unitId, (failures.get(unitId) ?? 0) + 1));
    return failures;
}

describe('Unit removal reaches the job owner', { timeout: 60_000 }, () => {
    let sim: Simulation;

    afterEach(() => {
        sim?.destroy();
        cleanupSimulation();
    });

    it('carrier killed while carrying: its transport is cancelled once and the goods are not lost', () => {
        const scenario = createScenario.constructionSite(BuildingType.WoodcutterHut);
        sim = scenario;
        sim.spawnUnitNear(scenario.storageId, UnitType.Carrier, 3);
        const failures = countFailures(sim);

        let carrierId: number | null = null;
        sim.eventBus.on('carrier:pickupComplete', ({ unitId }) => {
            carrierId ??= unitId;
        });
        sim.runUntil(() => carrierId !== null, { maxTicks: 20_000, label: 'first pickup' });
        const carrier = carrierId!;
        expect(sim.services.jobStore.getActiveJobForCarrier(carrier)).toBeDefined();

        sim.killUnit(carrier);

        expect(sim.services.jobStore.getActiveJobForCarrier(carrier)).toBeUndefined();
        expect(failures.get(carrier)).toBe(1);

        sim.waitForConstructionComplete(scenario.siteId, 80_000);
        expect(sim.services.constructionSiteManager.hasSite(scenario.siteId)).toBe(false);
        expect(sim.errors).toHaveLength(0);
    });

    it('digger killed on its way: the construction site gets a new digger', () => {
        sim = createSimulation();
        createSlope(sim.map, 55, 60, 75, 70, 0, 40);
        const residenceId = sim.placeBuilding(BuildingType.ResidenceSmall);
        const storageId = sim.placeBuilding(BuildingType.StorageArea);
        sim.injectOutput(storageId, EMaterialType.BOARD, 8);
        sim.injectOutput(storageId, EMaterialType.STONE, 8);
        const [digger] = sim.spawnUnitNear(residenceId, UnitType.Digger, 1);
        sim.spawnUnitNear(residenceId, UnitType.Builder, 1);
        const siteId = sim.placeBuilding(BuildingType.WoodcutterHut, 0, false);

        sim.runUntil(() => sim.services.jobRunner.getActiveJobId(digger!) === 'DIG_TILE', {
            maxTicks: 10_000,
            label: 'digger dispatched',
        });
        sim.killUnit(digger!);
        sim.spawnUnitNear(residenceId, UnitType.Digger, 1);

        const site = sim.waitForPhase(siteId, BuildingConstructionPhase.WaitingForBuilders, 50_000);
        expect(site === undefined || site.phase >= BuildingConstructionPhase.WaitingForBuilders).toBe(true);
        expect(sim.errors).toHaveLength(0);
    });

    it('specialist killed walking to its workplace: the building gets another worker', () => {
        sim = createSimulation();
        const hutId = sim.placeBuilding(BuildingType.WoodcutterHut, 0, true, undefined, false);
        const [first] = sim.spawnUnitNear(hutId, UnitType.Woodcutter, 1);

        sim.runUntil(() => sim.services.jobRunner.getActiveJobId(first!) === 'WORKER_DISPATCH', {
            maxTicks: 5_000,
            label: 'woodcutter dispatched to hut',
        });
        sim.killUnit(first!);
        const [second] = sim.spawnUnitNear(hutId, UnitType.Woodcutter, 1);

        sim.runUntil(() => sim.services.workerAssignments.getWorkersForBuilding(hutId).has(second!), {
            maxTicks: 5_000,
            label: 'second woodcutter assigned',
        });
        expect([...sim.services.workerAssignments.getWorkersForBuilding(hutId)]).toEqual([second]);
        expect(sim.errors).toHaveLength(0);
    });
});
