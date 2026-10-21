/**
 * Transport jobs when the carrier is lost: killed (Transport `onUnitRemoved`), taken over by a player
 * move (`onFailed` 'preempted') — and the one "idle" definition: a carrier on a player move is never
 * picked by logistics.
 *
 * In every case the carrier's active record AND its queued follow-up are cancelled, so no stock stays
 * claimed for a carrier that will never come, nothing throws (a dead carrier's PickedUp record used to
 * make busy-carrier ranking throw), the demand re-opens and material is conserved.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { cleanupSimulation, type Simulation } from '../../helpers/test-simulation';
import { installRealGameData } from '../../helpers/test-game-data';
import { EMaterialType } from '@/game/economy/material-type';
import { UnitType } from '@/game/entity';
import { ChoreoTaskType } from '@/game/systems/choreo';
import { hexDistance } from '@/game/systems/hex-directions';
import { createTransportFixture, runUntilTransportAt, totalMaterial, type TransportFixture } from './transport-fixture';

installRealGameData();

const PHASES: { name: string; task: ChoreoTaskType; started: boolean }[] = [
    {
        name: 'walking to the source',
        task: ChoreoTaskType.TRANSPORT_GO_TO_SOURCE,
        started: false,
    },
    {
        name: 'during the pickup',
        task: ChoreoTaskType.TRANSPORT_PICKUP,
        started: true,
    },
    {
        name: 'walking to the destination',
        task: ChoreoTaskType.TRANSPORT_GO_TO_DEST,
        started: false,
    },
    {
        name: 'during the delivery',
        task: ChoreoTaskType.TRANSPORT_DELIVER,
        started: true,
    },
];

function isOnPlayerMove(sim: Simulation, unitId: number): boolean {
    const commitment = sim.services.unitCommitments.get(unitId);
    return commitment !== undefined && commitment.owner === 'player-move';
}

function recordsOf(sim: Simulation, carrierId: number): number {
    return sim.services.jobStore.byCarrier.get(carrierId).size;
}

/** Spawn a replacement carrier and run until the sawmill received `logs` logs. */
function expectDemandServedAgain(fixture: TransportFixture, logs: number): void {
    const { sim, storageId, sawmillId } = fixture;
    sim.spawnUnitNear(storageId, UnitType.Carrier, 1);
    sim.runUntil(() => sim.getInput(sawmillId, EMaterialType.LOG) >= logs, {
        maxTicks: 30_000,
        label: `sawmill received ${logs} logs`,
    });
}

/** Run until the single busy carrier has a queued follow-up record. */
function runUntilQueued(sim: Simulation, carrierId: number): void {
    sim.runUntil(() => sim.services.jobStore.getQueuedJobForCarrier(carrierId) !== undefined, {
        maxTicks: 2_000,
        label: 'follow-up queued for the busy carrier',
    });
}

describe('Transport: carrier lost mid-job', { timeout: 60_000 }, () => {
    let sim: Simulation;

    afterEach(() => {
        sim?.destroy();
        cleanupSimulation();
    });

    for (const p of PHASES) {
        it(`carrier killed ${p.name}: records cancelled once, stock released, demand re-served`, () => {
            const fixture = createTransportFixture(1);
            sim = fixture.sim;
            const logs = totalMaterial(sim, EMaterialType.LOG);
            const { carrierId } = runUntilTransportAt(sim, p.task, p.started);
            let cancellations = 0;
            sim.eventBus.on('carrier:transportCancelled', ({ unitId }) => {
                cancellations += unitId === carrierId ? 1 : 0;
            });

            sim.killUnit(carrierId);

            expect(recordsOf(sim, carrierId)).toBe(0);
            expect(cancellations).toBe(1);
            expect(sim.services.jobStore.getReservedAmount(fixture.storageId, EMaterialType.LOG)).toBe(0);
            expect(totalMaterial(sim, EMaterialType.LOG)).toBe(logs);
            expectDemandServedAgain(fixture, 2);
            expect(totalMaterial(sim, EMaterialType.LOG)).toBe(logs);
            expect(sim.errors).toHaveLength(0);
        });
    }

    it('carrier killed with a queued follow-up: the follow-up is cancelled too', () => {
        const fixture = createTransportFixture(1);
        sim = fixture.sim;
        const { carrierId } = runUntilTransportAt(sim, ChoreoTaskType.TRANSPORT_GO_TO_DEST, false);
        runUntilQueued(sim, carrierId);

        sim.killUnit(carrierId);

        expect(recordsOf(sim, carrierId)).toBe(0);
        expect(sim.services.jobStore.getReservedAmount(fixture.storageId, EMaterialType.LOG)).toBe(0);
        expectDemandServedAgain(fixture, 2);
        expect(sim.errors).toHaveLength(0);
    });

    it('carrier taken over by a player move with a queued follow-up: both records cancelled', () => {
        const fixture = createTransportFixture(1);
        sim = fixture.sim;
        const logs = totalMaterial(sim, EMaterialType.LOG);
        const { carrierId } = runUntilTransportAt(sim, ChoreoTaskType.TRANSPORT_GO_TO_DEST, false);
        runUntilQueued(sim, carrierId);
        const carrier = sim.state.getEntityOrThrow(carrierId, 'test carrier');

        const moved = sim.execute({
            type: 'move_unit',
            entityId: carrierId,
            targetX: carrier.x + 6,
            targetY: carrier.y,
        });
        expect(moved.success).toBe(true);

        expect(recordsOf(sim, carrierId)).toBe(0);
        expect(sim.services.jobStore.getReservedAmount(fixture.storageId, EMaterialType.LOG)).toBe(0);
        expect(totalMaterial(sim, EMaterialType.LOG)).toBe(logs);
        expect(sim.errors).toHaveLength(0);
    });
});

describe('Transport: idle carriers', { timeout: 60_000 }, () => {
    let sim: Simulation;

    afterEach(() => {
        sim?.destroy();
        cleanupSimulation();
    });

    it('a carrier on a player move is never picked by logistics; it is once the move ends', () => {
        const fixture = createTransportFixture(1, 0);
        sim = fixture.sim;
        const [carrierId] = fixture.carriers;
        const carrier = sim.state.getEntityOrThrow(carrierId!, 'test carrier');
        const target = { x: carrier.x + 12, y: carrier.y };
        const moved = sim.execute({
            type: 'move_unit',
            entityId: carrierId!,
            targetX: target.x,
            targetY: target.y,
        });
        expect(moved.success).toBe(true);
        sim.injectOutput(fixture.storageId, EMaterialType.LOG, 4);

        // Taken over mid-walk ⇒ the move commitment ends far from its target.
        sim.runUntil(() => !isOnPlayerMove(sim, carrierId!), {
            maxTicks: 5_000,
            label: 'player move ends',
        });
        expect(hexDistance(carrier.x, carrier.y, target.x, target.y)).toBeLessThanOrEqual(1);

        sim.runUntil(() => recordsOf(sim, carrierId!) > 0, {
            maxTicks: 2_000,
            label: 'carrier picked after its move',
        });
        expect(sim.errors).toHaveLength(0);
    });
});
