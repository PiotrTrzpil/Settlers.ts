/**
 * Transport jobs across save / restore.
 *
 * A carrier's transport is saved as its Transport commitment (`ref` = record id, params
 * `{ recordId }`) plus the raw node index; the record itself is persisted by the TransportJobStore.
 * On load the job is rebuilt from the record and resumed: before the pickup it walks to the source
 * again, after the pickup (irreversible) it never picks up again. Material is conserved.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { cleanupSimulation, type Simulation } from '../../helpers/test-simulation';
import { installRealGameData } from '../../helpers/test-game-data';
import { EMaterialType } from '@/game/economy/material-type';
import { ChoreoTaskType, JobKind } from '@/game/systems/choreo';
import { TransportPhase } from '@/game/features/logistics';
import type { SettlerTaskExports } from '@/game/features/settler-tasks';
import { createTransportFixture, jobOf, runUntilTransportAt, totalMaterial } from './transport-fixture';

installRealGameData();

interface PhaseCase {
    name: string;
    task: ChoreoTaskType;
    started: boolean;
    phase: TransportPhase;
    /** Node the restored job resumes at (full leg: GO_TO_SOURCE, PICKUP, GO_TO_DEST, DELIVER, STAND_UP). */
    resumeTask: ChoreoTaskType;
    /** Pickups the carrier performs after the load, before its delivery. */
    pickupsAfterLoad: number;
}

const CASES: PhaseCase[] = [
    {
        name: 'Reserved, walking to the source',
        task: ChoreoTaskType.TRANSPORT_GO_TO_SOURCE,
        started: false,
        phase: TransportPhase.Reserved,
        resumeTask: ChoreoTaskType.TRANSPORT_GO_TO_SOURCE,
        pickupsAfterLoad: 1,
    },
    {
        name: 'during the pickup',
        task: ChoreoTaskType.TRANSPORT_PICKUP,
        started: true,
        phase: TransportPhase.Reserved,
        resumeTask: ChoreoTaskType.TRANSPORT_GO_TO_SOURCE,
        pickupsAfterLoad: 1,
    },
    {
        name: 'PickedUp, walking to the destination',
        task: ChoreoTaskType.TRANSPORT_GO_TO_DEST,
        started: false,
        phase: TransportPhase.PickedUp,
        resumeTask: ChoreoTaskType.TRANSPORT_GO_TO_DEST,
        pickupsAfterLoad: 0,
    },
    {
        name: 'during the delivery',
        task: ChoreoTaskType.TRANSPORT_DELIVER,
        started: true,
        phase: TransportPhase.PickedUp,
        resumeTask: ChoreoTaskType.TRANSPORT_GO_TO_DEST,
        pickupsAfterLoad: 0,
    },
];

describe('Transport job save / restore', { timeout: 60_000 }, () => {
    let sim: Simulation;
    let restored: Simulation | undefined;

    afterEach(() => {
        sim?.destroy();
        restored?.destroy();
        restored = undefined;
        cleanupSimulation();
    });

    for (const c of CASES) {
        it(`a carrier saved ${c.name} resumes its transport from the record, material conserved`, () => {
            const fixture = createTransportFixture(1);
            sim = fixture.sim;
            const logs = totalMaterial(sim, EMaterialType.LOG);
            const { carrierId, record } = runUntilTransportAt(sim, c.task, c.started);
            expect(record.phase).toBe(c.phase);

            restored = sim.saveAndRestore(0);

            const restoredRecord = restored.services.jobStore.get(record.id)!;
            expect(restoredRecord.phase).toBe(c.phase);
            expect(restored.services.unitCommitments.get(carrierId)).toEqual({
                owner: JobKind.Transport,
                ref: record.id,
                reserved: false,
                hasJob: true,
            });
            const { jobs } = restored.services.getFeature<SettlerTaskExports>('settler-tasks');
            expect(jobs.paramsOf(carrierId)).toEqual({ recordId: record.id });
            const job = jobOf(restored, carrierId)!;
            expect(job.kind).toBe(JobKind.Transport);
            expect(job.nodes[job.nodeIndex]!.task).toBe(c.resumeTask);
            expect(totalMaterial(restored, EMaterialType.LOG)).toBe(logs);

            let pickups = 0;
            let delivered = false;
            restored.eventBus.on('carrier:pickupComplete', ({ unitId }) => {
                if (unitId === carrierId && !delivered) {
                    pickups++;
                }
            });
            restored.eventBus.on('carrier:deliveryComplete', ({ unitId }) => {
                delivered ||= unitId === carrierId;
            });
            restored.runUntil(() => restored!.services.jobStore.get(record.id) === undefined, {
                maxTicks: 10_000,
                label: 'restored transport delivered',
            });

            expect(delivered).toBe(true);
            expect(pickups).toBe(c.pickupsAfterLoad);
            expect(restored.getInput(fixture.sawmillId, EMaterialType.LOG)).toBeGreaterThanOrEqual(1);
            expect(totalMaterial(restored, EMaterialType.LOG)).toBe(logs);
            expect(restored.errors).toHaveLength(0);
        });
    }

    it('a queued follow-up is cancelled on load and its stock claim released', () => {
        const fixture = createTransportFixture(1);
        sim = fixture.sim;
        const { carrierId } = runUntilTransportAt(sim, ChoreoTaskType.TRANSPORT_GO_TO_DEST, false);
        sim.runUntil(() => sim.services.jobStore.getQueuedJobForCarrier(carrierId) !== undefined, {
            maxTicks: 2_000,
            label: 'follow-up queued for the busy carrier',
        });
        const queued = sim.services.jobStore.getQueuedJobForCarrier(carrierId)!;

        restored = sim.saveAndRestore(0);

        expect(restored.services.jobStore.get(queued.id)).toBeUndefined();
        expect(restored.services.jobStore.getReservedAmount(fixture.storageId, EMaterialType.LOG)).toBe(0);
        expect(restored.errors).toHaveLength(0);
    });

    it('records created after a load get fresh ids (the id counter is persisted)', () => {
        const fixture = createTransportFixture(2);
        sim = fixture.sim;
        const { record } = runUntilTransportAt(sim, ChoreoTaskType.TRANSPORT_GO_TO_DEST, false);
        const maxSavedId = Math.max(...[...sim.services.jobStore.jobs.values()].map(r => r.id));

        restored = sim.saveAndRestore(0);
        const seen = new Set(restored.services.jobStore.jobs.keys());
        restored.runUntil(() => [...restored!.services.jobStore.jobs.keys()].some(id => !seen.has(id)), {
            maxTicks: 10_000,
            label: 'a new transport record after load',
        });

        const fresh = [...restored.services.jobStore.jobs.keys()].filter(id => !seen.has(id));
        expect(fresh.every(id => id > maxSavedId)).toBe(true);
        expect(record.id).toBeLessThanOrEqual(maxSavedId);
        expect(restored.errors).toHaveLength(0);
    });
});
