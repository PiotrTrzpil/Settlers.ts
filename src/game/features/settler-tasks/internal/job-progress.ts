/**
 * Pure job-progress rules used by JobRunner: the initial state of a self-selected job,
 * which nodes lock the movement controller, how a job's per-node state resets when it
 * moves to the next node, and the unit's home building id.
 */

import type { Tile, TileWithEntity } from '../../../entity';
import { ChoreoTaskType, createChoreoJobState, type ChoreoJob, type ChoreoNode } from '../choreo-types';
import type { JobState } from '../types';
import type { UnitRuntime } from '../unit-runtime';
import { workJobOwner } from '../work-job-kind';

/**
 * Node types whose next node still needs the job's targetPos:
 *  - GO_TO_TARGET / GO_TO_TARGET_ROUGHLY: multi-leg walks sharing the same target
 *    (e.g. Viking JOB_FARMERGRAIN_PLANT)
 *  - WORK / WORK_VIRTUAL / PLANT: callPositionComplete uses targetPos for the completion callback
 */
const KEEPS_TARGET_POS: ReadonlySet<ChoreoTaskType> = new Set([
    ChoreoTaskType.GO_TO_TARGET,
    ChoreoTaskType.GO_TO_TARGET_ROUGHLY,
    ChoreoTaskType.WORK,
    ChoreoTaskType.WORK_VIRTUAL,
    ChoreoTaskType.PLANT,
]);

/**
 * Fresh Work job state for a selected choreography, aimed at the entity target or else the position target.
 * @param ref the unit's home building id, or -1.
 */
export function createTargetedJobState(
    selected: ChoreoJob,
    entityTarget: TileWithEntity | null,
    positionTarget: Tile | null,
    ref: number
): JobState {
    const jobState = createChoreoJobState(selected.id, selected.nodes, false, workJobOwner(selected.id, ref));
    if (entityTarget) {
        jobState.targetId = entityTarget.entityId;
        jobState.targetPos = { x: entityTarget.x, y: entityTarget.y };
    } else if (positionTarget) {
        jobState.targetPos = { x: positionTarget.x, y: positionTarget.y };
    }
    return jobState;
}

/** Home building id of a unit, or null when it has no workplace. */
export function homeBuildingIdOf(runtime: UnitRuntime): number | null {
    // eslint-disable-next-line no-restricted-syntax -- optional chaining; null when source is absent
    return runtime.homeAssignment?.buildingId ?? null;
}

/** Pile pickup / drop-off nodes keep the movement controller busy (no pushes) while they run. */
export function isPileActionNode(node: ChoreoNode): boolean {
    return node.task === ChoreoTaskType.GET_GOOD || node.task === ChoreoTaskType.PUT_GOOD;
}

/**
 * Move the job to its next node and reset per-node state. The target position survives a
 * SEARCH node (it produced the target) and nodes whose successor still walks to / works at it.
 */
export function resetForNextNode(job: JobState): void {
    const completedTask = job.nodes[job.nodeIndex]!.task;
    job.nodeIndex++;
    job.progress = -1;
    job.workStarted = false;
    job.pathRetryCountdown = 0;
    job.pathRetryCount = 0;
    const nextNode = job.nodes[job.nodeIndex];
    const nextNeedsTargetPos = nextNode !== undefined && KEEPS_TARGET_POS.has(nextNode.task);
    if (completedTask !== ChoreoTaskType.SEARCH && !nextNeedsTargetPos) {
        job.targetPos = null;
        job.approachPos = null;
    }
}
