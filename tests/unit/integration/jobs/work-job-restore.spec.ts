/**
 * Work (XML) jobs and player moves across save / restore.
 *
 * Work jobs are saved as `{ kind: work, params: { choreoJobId }, nodeIndex, targets }` under the
 * unit's commitment and rebuilt from the choreography store on load: the job resumes at the last
 * movement / search node at or before the saved node, with the same target, and the unit keeps
 * its Work commitment (ref = its workplace). A player move resumes walking to the same target.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { createSimulation, cleanupSimulation, type Simulation } from '../../helpers/test-simulation';
import { installRealGameData } from '../../helpers/test-game-data';
import { BuildingType } from '@/game/buildings/building-type';
import { UnitType } from '@/game/entity';
import { EMaterialType } from '@/game/economy/material-type';
import { ChoreoTaskType, JobKind } from '@/game/systems/choreo';
import type { JobState, SettlerTaskExports } from '@/game/features/settler-tasks';

installRealGameData();

/** Movement / search task types — where an XML job resumes after load. */
const RESUME_TASKS = new Set([
    ChoreoTaskType.GO_TO_TARGET,
    ChoreoTaskType.GO_TO_TARGET_ROUGHLY,
    ChoreoTaskType.GO_TO_POS,
    ChoreoTaskType.GO_TO_POS_ROUGHLY,
    ChoreoTaskType.GO_TO_SOURCE_PILE,
    ChoreoTaskType.GO_TO_DESTINATION_PILE,
    ChoreoTaskType.GO_HOME,
    ChoreoTaskType.SEARCH,
]);

function lastResumeNodeAtOrBefore(job: JobState, index: number): number {
    for (let i = index; i >= 0; i--) {
        if (RESUME_TASKS.has(job.nodes[i]!.task)) {
            return i;
        }
    }
    return 0;
}

function jobOf(sim: Simulation, unitId: number): JobState | null {
    return sim.services.settlerTaskSystem.runtimes.get(unitId)!.job;
}

/** Woodcutter hut with trees; returns the hut and its woodcutter. */
function setupWoodcutter(sim: Simulation): { hutId: number; woodcutterId: number } {
    sim.placeBuilding(BuildingType.ResidenceSmall);
    const hutId = sim.placeBuilding(BuildingType.WoodcutterHut);
    sim.plantTreesNear(hutId, 4);
    const [woodcutterId] = [...sim.services.workerAssignments.getWorkersForBuilding(hutId)];
    return { hutId, woodcutterId: woodcutterId! };
}

describe('Work job and move restore', { timeout: 60_000 }, () => {
    let sim: Simulation;
    let restored: Simulation | undefined;

    afterEach(() => {
        sim?.destroy();
        restored?.destroy();
        restored = undefined;
        cleanupSimulation();
    });

    it('a woodcutter saved while walking to its tree resumes the same walk under its Work commitment', () => {
        sim = createSimulation();
        const { hutId, woodcutterId } = setupWoodcutter(sim);

        sim.runUntil(
            () => {
                const job = jobOf(sim, woodcutterId);
                return (
                    job !== null && job.nodes[job.nodeIndex]!.task === ChoreoTaskType.GO_TO_TARGET && job.progress >= 0
                );
            },
            { maxTicks: 10_000, label: 'woodcutter walking to a tree' }
        );
        const saved = jobOf(sim, woodcutterId)!;
        expect(saved.nodes[saved.nodeIndex]!.task).toBe(ChoreoTaskType.GO_TO_TARGET);
        expect(sim.services.unitCommitments.get(woodcutterId)).toEqual({
            owner: JobKind.Work,
            ref: hutId,
            reserved: false,
            hasJob: true,
        });

        restored = sim.saveAndRestore(0);

        const resumed = jobOf(restored, woodcutterId)!;
        expect(resumed.jobId).toBe(saved.jobId);
        expect(resumed.kind).toBe(JobKind.Work);
        expect(resumed.nodeIndex).toBe(saved.nodeIndex);
        expect(resumed.targetId).toBe(saved.targetId);
        const { jobs } = restored.services.getFeature<SettlerTaskExports>('settler-tasks');
        expect(jobs.paramsOf(woodcutterId)).toEqual({ choreoJobId: saved.jobId });
        expect(restored.services.unitCommitments.get(woodcutterId)).toEqual({
            owner: JobKind.Work,
            ref: hutId,
            reserved: false,
            hasJob: true,
        });

        restored.runUntil(() => restored!.getOutput(hutId, EMaterialType.LOG) >= 1, {
            maxTicks: 15_000,
            label: 'restored woodcutter produces a LOG',
        });
        expect(restored.getOutput(hutId, EMaterialType.LOG)).toBeGreaterThanOrEqual(1);
        expect(restored.errors).toHaveLength(0);
    });

    it('a woodcutter saved while chopping resumes at the walk before it, at the same tree', () => {
        sim = createSimulation();
        const { hutId, woodcutterId } = setupWoodcutter(sim);

        sim.runUntil(
            () => {
                const job = jobOf(sim, woodcutterId);
                return job !== null && job.workStarted && !RESUME_TASKS.has(job.nodes[job.nodeIndex]!.task);
            },
            { maxTicks: 10_000, label: 'woodcutter chopping' }
        );
        const saved = jobOf(sim, woodcutterId)!;
        expect(RESUME_TASKS.has(saved.nodes[saved.nodeIndex]!.task)).toBe(false);

        restored = sim.saveAndRestore(0);

        const resumed = jobOf(restored, woodcutterId)!;
        expect(resumed.jobId).toBe(saved.jobId);
        expect(resumed.nodeIndex).toBeLessThan(saved.nodeIndex);
        expect(resumed.nodeIndex).toBe(lastResumeNodeAtOrBefore(saved, saved.nodeIndex));
        expect(resumed.targetId).toBe(saved.targetId);

        restored.runUntil(() => restored!.getOutput(hutId, EMaterialType.LOG) >= 1, {
            maxTicks: 15_000,
            label: 'restored woodcutter produces a LOG',
        });
        expect(restored.errors).toHaveLength(0);
    });

    it('a player move saved mid-walk resumes walking to the same target and ends its commitment on arrival', () => {
        sim = createSimulation();
        const residenceId = sim.placeBuilding(BuildingType.ResidenceSmall);
        const [unitId] = sim.spawnUnitNear(residenceId, UnitType.Carrier, 1);
        const unit = sim.state.getEntityOrThrow(unitId!, 'test carrier');
        const target = { x: unit.x + 12, y: unit.y + 6 };
        expect(
            sim.execute({ type: 'move_unit', entityId: unitId!, targetX: target.x, targetY: target.y }).success
        ).toBe(true);
        sim.runTicks(20);
        expect(sim.services.unitCommitments.get(unitId!)!.owner).toBe('player-move');

        restored = sim.saveAndRestore(0);

        const runtime = restored.services.settlerTaskSystem.runtimes.get(unitId!)!;
        expect(runtime.moveTask).toEqual({ type: 'move', targetX: target.x, targetY: target.y });
        expect(restored.services.unitCommitments.get(unitId!)).toEqual({
            owner: 'player-move',
            ref: -1,
            reserved: false,
            hasJob: false,
        });

        restored.runUntil(() => runtime.moveTask === null, { maxTicks: 3_000, label: 'move finished' });
        const moved = restored.state.getEntityOrThrow(unitId!, 'restored carrier');
        expect({ x: moved.x, y: moved.y }).toEqual(target);
        expect(restored.services.unitCommitments.isIdle(unitId!)).toBe(true);
    });
});
