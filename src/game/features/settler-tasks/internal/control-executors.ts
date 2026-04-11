/**
 * Wait and control flow choreography node executors.
 *
 * Implements ChoreoTaskType nodes: WAIT, WAIT_VIRTUAL, CHECKIN,
 * CHANGE_JOB, CHANGE_JOB_COME_TO_WORK, and military stubs.
 */

import type { Entity } from '../../../entity';
import { createLogger } from '@/utilities/logger';
import { TaskResult } from '../types';
import {
    framesToSeconds,
    tickDuration,
    type ChoreoJobState,
    type ChoreoNode,
    type ControlContext,
} from '../choreo-types';

const log = createLogger('ControlExecutors');

// ─────────────────────────────────────────────────────────────
// Wait executors
// ─────────────────────────────────────────────────────────────

/**
 * Timed wait — settler stands visible for `node.duration` frames.
 *
 * If `node.duration` is -1 or 0 the wait is instant and DONE is returned
 * immediately without consuming a tick.
 */
export function executeWait(
    _settler: Entity,
    job: ChoreoJobState,
    node: ChoreoNode,
    dt: number,
    _ctx: ControlContext
): TaskResult {
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
export function executeCheckin(
    _settler: Entity,
    job: ChoreoJobState,
    _node: ChoreoNode,
    _dt: number,
    _ctx: ControlContext
): TaskResult {
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
export function executeChangeJob(
    settler: Entity,
    job: ChoreoJobState,
    node: ChoreoNode,
    _dt: number,
    _ctx: ControlContext
): TaskResult {
    const newJobId = node.entity;
    if (!newJobId) {
        throw new Error(
            `Settler ${settler.id}: CHANGE_JOB node has no target job ID (node.entity is empty). ` +
                `Current job: '${job.jobId}', node index: ${job.nodeIndex}.`
        );
    }

    job.jobId = newJobId;
    job.nodeIndex = 0;
    job.progress = 0;
    job.workStarted = false;

    return TaskResult.DONE;
}

// ─────────────────────────────────────────────────────────────
// Military executors
// ─────────────────────────────────────────────────────────────

/**
 * Healer work — restore health to a target entity.
 *
 * Duration-based: advances job.progress over node.duration frames (default 2 s).
 * The actual HP mutation will be applied by the health/combat system when it exists;
 * this executor only signals "healer is busy healing" for the correct duration.
 */
export function executeHealEntity(
    settler: Entity,
    job: ChoreoJobState,
    node: ChoreoNode,
    dt: number,
    ctx: ControlContext
): TaskResult {
    if (job.targetId === null) {
        log.debug(`executeHealEntity: settler ${settler.id} has no target`);
        return TaskResult.FAILED;
    }

    // Use nullable getEntity — the target may have been destroyed mid-heal.
    const target = ctx.gameState.getEntity(job.targetId);
    if (!target) {
        log.debug(`executeHealEntity: target ${job.targetId} no longer exists, settler ${settler.id} aborts`);
        return TaskResult.FAILED;
    }

    const duration = node.duration > 0 ? framesToSeconds(node.duration) : 2.0;
    const result = tickDuration(job, dt, duration);
    if (result === TaskResult.DONE) {
        log.warn(
            `executeHealEntity: settler ${settler.id} finished healing target ${job.targetId} — HP mutation not implemented, heal skipped`
        );
    }
    return result;
}

/**
 * Combat response — react to being attacked.
 *
 * Duration-based wait that represents a defensive/reaction animation.
 * Defaults to 0.5 s when node.duration is not set.
 * The actual fight-back or retreat logic will be added by the combat system.
 */
export function executeAttackReaction(
    settler: Entity,
    job: ChoreoJobState,
    node: ChoreoNode,
    dt: number,
    _ctx: ControlContext
): TaskResult {
    const duration = node.duration > 0 ? framesToSeconds(node.duration) : 0.5;
    const result = tickDuration(job, dt, duration);
    if (result === TaskResult.DONE) {
        log.warn(
            `executeAttackReaction: settler ${settler.id} completed reaction — combat logic not implemented, reaction skipped`
        );
    }
    return result;
}
