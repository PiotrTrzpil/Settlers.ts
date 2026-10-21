/**
 * Event payloads the job runtime emits for job start / completion / failure / abort and the
 * verbose choreography trace (choreo:nodeStarted / nodeCompleted / animationApplied).
 *
 * `settler:task*` and `settler:jobAborted` are notifications (timeline, debug, tests). Owners of
 * owned jobs learn outcomes through their JobKindHandler; only legacy jobs are still routed by them.
 */

import type { Entity, UnitType } from '../../../entity';
import type { EventBus } from '../../../event-bus';
import type { JobFailureReason } from '../../../systems/choreo';
import { ChoreoTaskType, type ChoreoNode, type JobPartResolution } from '../choreo-types';
import type { JobState } from '../types';

/** Why a job ended without completing or failing (see `settler:jobAborted`). */
export type JobAbortReason = 'unitRemoved' | 'cancelled' | 'restoreFailed';

/** Task type name of the job's current node ('unknown' past the end). */
export function currentStepName(job: JobState): string {
    const node = job.nodes[job.nodeIndex];
    return node ? ChoreoTaskType[node.task] : 'unknown';
}

/** settler:taskStarted — a self-selected job (WorkerAutonomy) begins. */
export function emitTaskStarted(eventBus: EventBus, settler: Entity, job: JobState, homeBuilding: Entity | null): void {
    eventBus.emit('settler:taskStarted', {
        unitId: settler.id,
        unitType: settler.subType as UnitType,
        jobId: job.jobId,
        targetId: job.targetId,
        targetPos: job.targetPos,
        // eslint-disable-next-line no-restricted-syntax -- optional chaining; null when source is absent
        homeBuilding: homeBuilding?.id ?? null,
    });
}

/** settler:taskCompleted — after the job and commitment were cleared and the owner was called. */
export function emitTaskCompleted(eventBus: EventBus, settler: Entity, job: JobState): void {
    eventBus.emit('settler:taskCompleted', {
        unitId: settler.id,
        unitType: settler.subType as UnitType,
        jobId: job.jobId,
        kind: job.kind,
        ref: job.ref,
    });
}

/** settler:taskFailed — after teardown, INTERRUPTED and the owner's onFailed. */
export function emitTaskFailed(eventBus: EventBus, settler: Entity, job: JobState, reason: JobFailureReason): void {
    eventBus.emit('settler:taskFailed', {
        unitId: settler.id,
        unitType: settler.subType as UnitType,
        jobId: job.jobId,
        kind: job.kind,
        ref: job.ref,
        reason,
        nodeIndex: job.nodeIndex,
        failedStep: currentStepName(job),
        // eslint-disable-next-line no-restricted-syntax -- value is nullable by API contract; null coercion
        targetId: job.targetId ?? null,
        workStarted: job.workStarted,
        wasCarrying: !!settler.carrying,
        level: 'warn',
    });
}

/** settler:jobAborted — the job (or pending restored job) ended by unit removal, owner cancel or failed resume. */
export function emitJobAborted(
    eventBus: EventBus,
    unitId: number,
    job: { readonly jobId: string; readonly kind: JobState['kind']; readonly ref: number },
    reason: JobAbortReason
): void {
    eventBus.emit('settler:jobAborted', { unitId, jobId: job.jobId, kind: job.kind, ref: job.ref, reason });
}

export function emitNodeStarted(eventBus: EventBus, settler: Entity, job: JobState, node: ChoreoNode): void {
    eventBus.emit('choreo:nodeStarted', {
        unitId: settler.id,
        jobId: job.jobId,
        nodeIndex: job.nodeIndex,
        nodeCount: job.nodes.length,
        task: ChoreoTaskType[node.task],
        jobPart: node.jobPart,
        duration: node.duration,
    });
}

/** choreo:nodeCompleted for the job's current node (call before advancing). */
export function emitNodeCompleted(eventBus: EventBus, settler: Entity, job: JobState): void {
    const completedNode = job.nodes[job.nodeIndex]!;
    eventBus.emit('choreo:nodeCompleted', {
        unitId: settler.id,
        jobId: job.jobId,
        nodeIndex: job.nodeIndex,
        task: ChoreoTaskType[completedNode.task],
    });
}

export function emitAnimationApplied(
    eventBus: EventBus,
    settler: Entity,
    node: ChoreoNode,
    resolution: JobPartResolution
): void {
    eventBus.emit('choreo:animationApplied', {
        unitId: settler.id,
        jobPart: node.jobPart,
        sequenceKey: resolution.sequenceKey,
        loop: resolution.loop,
    });
}
