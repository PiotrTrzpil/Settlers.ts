/**
 * Wait and control flow choreography node executors.
 *
 * Implements ChoreoTaskType nodes: WAIT, WAIT_VIRTUAL, CHECKIN,
 * CHANGE_JOB, CHANGE_JOB_COME_TO_WORK. Domain-free: they need no services.
 * (Military HEAL_ENTITY / ATTACK_REACTION are registered by the combat feature.)
 */

import type { Entity } from '../../../entity';
import { TaskResult } from '../types';
import { JobKind, framesToSeconds, tickDuration, type ChoreoJobState, type ChoreoNode } from '../choreo-types';
import type { WorkJobParams } from '../work-job-kind';

// ─────────────────────────────────────────────────────────────
// Wait executors
// ─────────────────────────────────────────────────────────────

/**
 * Timed wait — settler stands visible for `node.duration` frames.
 *
 * If `node.duration` is -1 or 0 the wait is instant and DONE is returned
 * immediately without consuming a tick.
 */
export function executeWait(_settler: Entity, job: ChoreoJobState, node: ChoreoNode, dt: number): TaskResult {
    if (node.duration <= 0) {
        return TaskResult.DONE;
    }
    return tickDuration(job, dt, framesToSeconds(node.duration));
}

// ─────────────────────────────────────────────────────────────
// Control executors
// ─────────────────────────────────────────────────────────────

/**
 * Return the settler to an idle/checked-in state inside its home building.
 *
 * Hides the settler (they are "inside" the building) and signals the state
 * machine to transition to IDLE on the next tick by completing this node.
 * The actual IDLE transition is handled by the state machine above this layer.
 */
export function executeCheckin(_settler: Entity, job: ChoreoJobState, _node: ChoreoNode, _dt: number): TaskResult {
    job.visible = false;
    return TaskResult.DONE;
}

/**
 * Switch to a different job ID mid-execution.
 *
 * Reads the new job ID from `node.entity`, resets the job state to node 0,
 * and updates `job.jobId`. The state machine will pick up the new job definition
 * on the next tick — the actual job lookup happens there, not here.
 */
export function executeChangeJob(settler: Entity, job: ChoreoJobState, node: ChoreoNode, _dt: number): TaskResult {
    const newJobId = node.entity;
    if (!newJobId) {
        throw new Error(
            `Settler ${settler.id}: CHANGE_JOB node has no target job ID (node.entity is empty). ` +
                `Current job: '${job.jobId}', node index: ${job.nodeIndex}.`
        );
    }

    job.jobId = newJobId;
    // kind stays as-is (XML CHANGE_JOB stays Work); a Work job saves the XML id it switched to.
    if (job.kind === JobKind.Work) {
        const params: WorkJobParams = { choreoJobId: newJobId };
        job.params = params;
    }
    job.nodeIndex = 0;
    job.progress = 0;
    job.workStarted = false;

    return TaskResult.DONE;
}
