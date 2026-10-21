/**
 * Event payloads JobRunner emits for job start / failure and the verbose choreography
 * trace (choreo:nodeStarted / nodeCompleted / animationApplied).
 */

import type { Entity, UnitType } from '../../../entity';
import type { EventBus } from '../../../event-bus';
import { ChoreoTaskType, type ChoreoNode, type JobPartResolution } from '../choreo-types';
import type { JobState } from '../types';

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

/** settler:taskFailed — emitted after the job was torn down, before the unit turns INTERRUPTED. */
export function emitTaskFailed(eventBus: EventBus, settler: Entity, job: JobState): void {
    const failedNode = job.nodes[job.nodeIndex];
    const failedStep = failedNode ? ChoreoTaskType[failedNode.task] : 'unknown';

    eventBus.emit('settler:taskFailed', {
        unitId: settler.id,
        unitType: settler.subType as UnitType,
        jobId: job.jobId,
        kind: job.kind,
        nodeIndex: job.nodeIndex,
        failedStep,
        // eslint-disable-next-line no-restricted-syntax -- value is nullable by API contract; null coercion
        targetId: job.targetId ?? null,
        workStarted: job.workStarted,
        wasCarrying: !!settler.carrying,
        level: 'warn',
    });
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
