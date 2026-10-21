/**
 * Commitment lifecycle — every unit has at most one owner, and the runtime tells owners what
 * happened to their units:
 * - a preempted job is reported (`settler:taskFailed`, reason 'preempted') and the unit is
 *   committed to its new owner;
 * - an owner-initiated cancel is NOT reported as a failure (only `settler:jobAborted 'cancelled'`);
 * - unit removal reaches the owner exactly once, before material-transfer drops carried goods;
 * - a job assigned from a completion handler sticks (commitment of the follow-up job survives).
 */

import { describe, it, expect, afterEach } from 'vitest';
import { createSimulation, createScenario, cleanupSimulation, type Simulation } from '../../helpers/test-simulation';
import { installRealGameData } from '../../helpers/test-game-data';
import { createSlope } from '../../helpers/test-map';
import { BuildingType } from '@/game/buildings/building-type';
import { UnitType } from '@/game/entity';
import { EMaterialType } from '@/game/economy/material-type';
import { JobKind } from '@/game/systems/choreo';
import type { UnitCommitment } from '@/game/systems/unit-commitment';
import { BuildingConstructionPhase } from '@/game/features/building-construction';
import type { SettlerTaskExports } from '@/game/features/settler-tasks';

installRealGameData();

/** Woodcutter hut with trees; runs until the woodcutter is out working. Returns hut + woodcutter. */
function woodcutterAtWork(sim: Simulation): { hutId: number; woodcutterId: number } {
    sim.placeBuilding(BuildingType.ResidenceSmall);
    const hutId = sim.placeBuilding(BuildingType.WoodcutterHut);
    sim.plantTreesNear(hutId, 4);
    const [woodcutterId] = [...sim.services.workerAssignments.getWorkersForBuilding(hutId)];
    sim.runUntil(() => sim.services.jobRunner.getActiveJobId(woodcutterId!) !== null, {
        maxTicks: 10_000,
        label: 'woodcutter starts a job',
    });
    return { hutId, woodcutterId: woodcutterId! };
}

/** Ordered notification log for one unit. */
function recordNotifications(sim: Simulation, unitId: () => number | null): string[] {
    const log: string[] = [];
    sim.eventBus.on('settler:taskFailed', e => e.unitId === unitId() && log.push(`failed:${e.reason}`));
    sim.eventBus.on('settler:jobAborted', e => e.unitId === unitId() && log.push(`aborted:${e.reason}`));
    sim.eventBus.on('pile:freePilePlaced', () => log.push('pile'));
    return log;
}

describe('Commitment lifecycle', { timeout: 60_000 }, () => {
    let sim: Simulation;

    afterEach(() => {
        sim?.destroy();
        cleanupSimulation();
    });

    it('a working unit is committed to its job; a player move preempts it and is reported once', () => {
        sim = createSimulation();
        const { hutId, woodcutterId } = woodcutterAtWork(sim);
        expect(sim.services.unitCommitments.get(woodcutterId)).toEqual<UnitCommitment>({
            owner: JobKind.Work,
            ref: hutId,
            reserved: false,
            hasJob: true,
        });
        const log = recordNotifications(sim, () => woodcutterId);

        const unit = sim.state.getEntityOrThrow(woodcutterId, 'woodcutter');
        const target = { x: unit.x + 6, y: unit.y + 3 };
        expect(
            sim.execute({ type: 'move_unit', entityId: woodcutterId, targetX: target.x, targetY: target.y }).success
        ).toBe(true);

        expect(log).toEqual(['failed:preempted']);
        expect(sim.services.unitCommitments.get(woodcutterId)!.owner).toBe('player-move');

        const runtime = sim.services.settlerTaskSystem.runtimes.get(woodcutterId)!;
        sim.runUntil(() => runtime.moveTask === null, { maxTicks: 3_000, label: 'move finished' });
        expect(sim.services.unitCommitments.isIdle(woodcutterId)).toBe(true);
    });

    it('an owner-initiated cancel is not reported as a failure; the unit is idle and works again', () => {
        sim = createSimulation();
        const { woodcutterId } = woodcutterAtWork(sim);
        const log = recordNotifications(sim, () => woodcutterId);
        const { jobs } = sim.services.getFeature<SettlerTaskExports>('settler-tasks');

        jobs.cancel(woodcutterId, JobKind.Transport); // not the owner — no-op
        expect(sim.services.unitCommitments.get(woodcutterId)!.owner).toBe(JobKind.Work);

        jobs.cancel(woodcutterId, JobKind.Work);

        expect(log).toEqual(['aborted:cancelled']);
        expect(sim.services.unitCommitments.isIdle(woodcutterId)).toBe(true);
        expect(sim.services.jobRunner.getActiveJobId(woodcutterId)).toBeNull();

        sim.runUntil(() => sim.services.jobRunner.getActiveJobId(woodcutterId) !== null, {
            maxTicks: 5_000,
            label: 'woodcutter works again',
        });
        expect(sim.services.unitCommitments.get(woodcutterId)!.owner).toBe(JobKind.Work);
    });

    it('a killed carrier reaches its owner exactly once, before its carried goods are dropped', () => {
        const scenario = createScenario.constructionSite(BuildingType.WoodcutterHut);
        sim = scenario;
        sim.spawnUnitNear(scenario.storageId, UnitType.Carrier, 3);
        let carrierId: number | null = null;
        sim.eventBus.on('carrier:pickupComplete', ({ unitId }) => {
            carrierId ??= unitId;
        });
        sim.runUntil(() => carrierId !== null, { maxTicks: 20_000, label: 'first pickup' });
        const log = recordNotifications(sim, () => carrierId);

        sim.killUnit(carrierId!);

        // Transport is owned: onUnitRemoved (no legacy taskFailed), then material-transfer drops the goods.
        expect(log).toEqual(['aborted:unitRemoved', 'pile']);
        expect(sim.services.jobStore.byCarrier.get(carrierId!).size).toBe(0);
        expect(sim.services.unitCommitments.get(carrierId!)).toBeUndefined();
        expect(sim.services.settlerTaskSystem.runtimes.has(carrierId!)).toBe(false);
    });

    it('a unit killed during a player move leaves no commitment behind', () => {
        sim = createSimulation();
        const residenceId = sim.placeBuilding(BuildingType.ResidenceSmall);
        const [unitId] = sim.spawnUnitNear(residenceId, UnitType.Carrier, 1);
        const unit = sim.state.getEntityOrThrow(unitId!, 'carrier');
        sim.execute({ type: 'move_unit', entityId: unitId!, targetX: unit.x + 10, targetY: unit.y });
        sim.runTicks(10);
        expect(sim.services.unitCommitments.get(unitId!)!.owner).toBe('player-move');

        sim.killUnit(unitId!);
        sim.runTicks(30);

        expect(sim.services.unitCommitments.get(unitId!)).toBeUndefined();
        expect(sim.services.unitCommitments.unitsOwnedBy('player-move')).toEqual([]);
        expect(sim.errors).toHaveLength(0);
    });

    it('a job assigned from a completion handler sticks: the digger stays committed between tiles', () => {
        sim = createSimulation();
        createSlope(sim.map, 55, 60, 75, 70, 0, 40);
        const residenceId = sim.placeBuilding(BuildingType.ResidenceSmall);
        const storageId = sim.placeBuilding(BuildingType.StorageArea);
        sim.injectOutput(storageId, EMaterialType.BOARD, 8);
        sim.injectOutput(storageId, EMaterialType.STONE, 8);
        const [digger] = sim.spawnUnitNear(residenceId, UnitType.Digger, 1);
        const siteId = sim.placeBuilding(BuildingType.WoodcutterHut, 0, false);

        // After each completed DIG_TILE the construction listener assigns the next tile immediately.
        const afterCompletion: (string | null)[] = [];
        sim.eventBus.on('settler:taskCompleted', ({ unitId, jobId }) => {
            if (unitId === digger && jobId === 'DIG_TILE') {
                afterCompletion.push(sim.services.unitCommitments.get(digger)?.owner ?? null);
            }
        });

        sim.waitForPhase(siteId, BuildingConstructionPhase.WaitingForBuilders, 50_000);

        expect(afterCompletion.length).toBeGreaterThan(1);
        // Every tile but the last chains straight into the next DIG_TILE job.
        expect(afterCompletion.slice(0, -1).every(owner => owner === JobKind.Construction)).toBe(true);
        expect(sim.errors).toHaveLength(0);
    });
});
