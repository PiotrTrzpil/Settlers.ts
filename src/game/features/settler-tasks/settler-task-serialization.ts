/**
 * Serialization helpers for SettlerTaskSystem.
 *
 * Extracts serialize/deserialize logic to keep the main system file under the line limit.
 */

import { JobType, SettlerState } from './types';
import type { ChoreoJobState, ChoreoNode, TransportData } from './choreo-types';
import type { UnitRuntime } from './unit-state-machine';

export interface SerializedTransportData {
    jobId: number;
    sourceBuildingId: number;
    destBuildingId: number;
    material: number;
    amount: number;
    sourcePos: { x: number; y: number };
    destPos: { x: number; y: number };
    slotId: number;
}

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
    transportData?: SerializedTransportData;
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
    const hasMoveTask = runtime.moveTask !== null;
    // Serialize ALL jobs including transport — "persist everything, reconstruct nothing"
    const serializedJob = job ? serializeJob(job) : null;

    return {
        entityId,
        // moveTask (player-issued move command) is not persisted — carrier goes idle for that case only
        state: hasMoveTask ? SettlerState.IDLE : runtime.state,
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
    const result: SerializedChoreoJob = {
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
    if (job.transportData) {
        result.transportData = {
            jobId: job.transportData.jobId,
            sourceBuildingId: job.transportData.sourceBuildingId,
            destBuildingId: job.transportData.destBuildingId,
            material: job.transportData.material,
            amount: job.transportData.amount,
            sourcePos: { x: job.transportData.sourcePos.x, y: job.transportData.sourcePos.y },
            destPos: { x: job.transportData.destPos.x, y: job.transportData.destPos.y },
            slotId: job.transportData.slotId,
        };
    }
    return result;
}

function deserializeTransportData(data: SerializedTransportData): TransportData {
    return {
        jobId: data.jobId,
        sourceBuildingId: data.sourceBuildingId,
        destBuildingId: data.destBuildingId,
        material: data.material,
        amount: data.amount,
        sourcePos: { x: data.sourcePos.x, y: data.sourcePos.y },
        destPos: { x: data.destPos.x, y: data.destPos.y },
        slotId: data.slotId,
    };
}

export function deserializeJob(data: SerializedChoreoJob): ChoreoJobState {
    const job: ChoreoJobState = {
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
    if (data.transportData) {
        job.transportData = deserializeTransportData(data.transportData);
    }
    return job;
}
