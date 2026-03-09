/**
 * Serialization helpers for SettlerTaskSystem.
 *
 * Extracts serialize/deserialize logic to keep the main system file under the line limit.
 */

import { JobType, SettlerState } from './types';
import type { ChoreoJobState, ChoreoNode } from './choreo-types';
import type { UnitRuntime } from './unit-state-machine';

export interface SerializedChoreoJob {
    jobId: string;
    nodes: ChoreoNode[];
    nodeIndex: number;
    progress: number;
    visible: boolean;
    activeTrigger: string;
    targetId: number | null;
    targetPos: { x: number; y: number } | null;
    carryingGood: number | null;
    workStarted: boolean;
}

export interface SerializedUnitRuntime {
    entityId: number;
    state: string;
    lastDirection: number;
    homeAssignment: { buildingId: number; hasVisited: boolean } | null;
    job: SerializedChoreoJob | null;
}

export function serializeRuntime(entityId: number, runtime: UnitRuntime): SerializedUnitRuntime {
    const job = runtime.job;
    const hasTransport = job?.transportData !== undefined;
    const hasMoveTask = runtime.moveTask !== null;
    const serializedJob = job && !hasTransport ? serializeJob(job) : null;

    return {
        entityId,
        state: hasTransport || hasMoveTask ? SettlerState.IDLE : runtime.state,
        lastDirection: runtime.lastDirection,
        homeAssignment: runtime.homeAssignment
            ? {
                buildingId: runtime.homeAssignment.buildingId,
                hasVisited: runtime.homeAssignment.hasVisited,
            }
            : null,
        job: serializedJob,
    };
}

export function serializeJob(job: ChoreoJobState): SerializedChoreoJob {
    return {
        jobId: job.jobId,
        nodes: job.nodes,
        nodeIndex: job.nodeIndex,
        progress: job.progress,
        visible: job.visible,
        activeTrigger: job.activeTrigger,
        targetId: job.targetId,
        targetPos: job.targetPos ? { x: job.targetPos.x, y: job.targetPos.y } : null,
        carryingGood: job.carryingGood,
        workStarted: job.workStarted,
    };
}

export function deserializeJob(data: SerializedChoreoJob): ChoreoJobState {
    return {
        type: JobType.CHOREO,
        jobId: data.jobId,
        nodes: data.nodes,
        nodeIndex: data.nodeIndex,
        progress: data.progress,
        visible: data.visible,
        activeTrigger: data.activeTrigger,
        targetId: data.targetId,
        targetPos: data.targetPos ? { x: data.targetPos.x, y: data.targetPos.y } : null,
        carryingGood: data.carryingGood as ChoreoJobState['carryingGood'],
        workStarted: data.workStarted,
        pathRetryCountdown: 0,
    };
}
