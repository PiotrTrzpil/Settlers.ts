/**
 * Work executor functions for choreography task nodes.
 *
 * Implements all work-related ChoreoTaskType handlers:
 *   - Phase 2C: WORK, WORK_ON_ENTITY, PLANT (visible, positional/entity work)
 *   - Phase 2D: WORK_VIRTUAL, WORK_ON_ENTITY_VIRTUAL, PRODUCE_VIRTUAL (settler invisible)
 *
 * All executors conform to WorkExecutorFn and must not throw — handler
 * errors are caught and reported via ctx.handlerErrorLogger.
 */

import { createLogger } from '@/utilities/logger';
import { TaskResult } from '../types';
import { framesToSeconds, tickDuration, type ChoreoJobState, type ChoreoNode, type WorkContext } from '../choreo-types';
import type { Entity } from '../../../entity';
import type { EntityWorkHandler } from '../types';
import { safeCall } from '../safe-call';

const log = createLogger('WorkExecutors');

// ─────────────────────────────────────────────────────
// Internal helpers
// ─────────────────────────────────────────────────────

/**
 * Default work-cycle length for nodes with duration=0 (one animation cycle).
 * In the original S4, duration=0 means "play one full work animation", not "instant".
 */
const DEFAULT_WORK_CYCLE_FRAMES = 10; // 1.0 seconds at CHOREO_FPS

/** Compute effective duration in seconds. Returns Infinity when duration === -1. */
function resolveDurationSeconds(node: ChoreoNode): number {
    if (node.duration === -1) {
        return Infinity;
    }
    if (node.duration === 0) {
        return framesToSeconds(DEFAULT_WORK_CYCLE_FRAMES);
    }
    return framesToSeconds(node.duration);
}

/** Apply direction constraint on first tick (progress === 0). No-op when dir === -1. */
function applyDirectionConstraint(settler: Entity, node: ChoreoNode, job: ChoreoJobState, ctx: WorkContext): void {
    if (node.dir !== -1 && job.progress === 0) {
        const controller = ctx.gameState.movement.getController(settler.id);
        controller?.setDirection(node.dir);
    }
}

/** Fire the node trigger once (guarded by !workStarted). */
function fireTriggerOnStart(settler: Entity, node: ChoreoNode, job: ChoreoJobState, ctx: WorkContext): void {
    if (node.trigger && !job.workStarted) {
        const buildingId = ctx.getWorkerHomeBuilding(settler.id);
        if (buildingId !== null) {
            ctx.triggerSystem.fireTrigger(buildingId, node.trigger);
        } else {
            log.warn(`fireTrigger: settler ${settler.id} has no home — '${node.trigger}' skipped`);
        }
    }
}

/** Call positionHandler.onWorkAtPositionComplete with error handling. */
function callPositionComplete(settler: Entity, job: ChoreoJobState, ctx: WorkContext, label: string): void {
    if (!ctx.positionHandler) {
        return;
    }
    // Use targetPos if available; fall back to settler's current position
    // (targetPos may have been cleared between nodes, but the settler is already at the target)
    const { positionHandler, handlerErrorLogger } = ctx;
    const x = job.targetPos?.x ?? settler.x;
    const y = job.targetPos?.y ?? settler.y;
    safeCall(
        () => positionHandler.onWorkAtPositionComplete(x, y, settler.id),
        handlerErrorLogger,
        `${label} failed for settler ${settler.id}`
    );
}

/** Run entity work handler onWorkTick + handle completion. Returns DONE/CONTINUE/FAILED. */
function tickEntityWork(
    settler: Entity,
    job: ChoreoJobState,
    node: ChoreoNode,
    dt: number,
    handler: EntityWorkHandler,
    ctx: WorkContext,
    label: string
): TaskResult {
    const durationSeconds = resolveDurationSeconds(node);
    // For domain-controlled work (duration=-1), still advance progress using the
    // default animation cycle so the work animation plays at least one full cycle
    // before the handler's completion signal takes effect.
    const effectiveDuration =
        durationSeconds === Infinity ? framesToSeconds(DEFAULT_WORK_CYCLE_FRAMES) : durationSeconds;
    job.progress += dt / effectiveDuration;

    const domainDone = safeCall(
        () => handler.onWorkTick(job.targetId!, job.progress),
        ctx.handlerErrorLogger,
        `onWorkTick ${label} failed for target ${job.targetId}`
    );
    if (domainDone === undefined) {
        return TaskResult.FAILED;
    }

    // Domain-controlled (duration=-1): handler decides when work ends, but animation
    // must play at least one full cycle (progress >= 1) before completion takes effect.
    // Duration-controlled: animation must play for full duration regardless of handler.
    const complete = durationSeconds === Infinity ? domainDone && job.progress >= 1 : job.progress >= 1;

    if (complete) {
        safeCall(
            () => handler.onWorkComplete?.(job.targetId!, settler.x, settler.y, settler.id),
            ctx.handlerErrorLogger,
            `onWorkComplete ${label} failed for target ${job.targetId}`
        );
        return TaskResult.DONE;
    }
    return TaskResult.CONTINUE;
}

/** Start entity work on first tick. Returns FAILED on error. */
function startEntityWork(
    settler: Entity,
    job: ChoreoJobState,
    handler: EntityWorkHandler,
    ctx: WorkContext,
    label: string
): boolean {
    if (job.workStarted) {
        return true;
    }
    const ok = safeCall(
        () => {
            handler.onWorkStart?.(job.targetId!, settler.id);
            return true;
        },
        ctx.handlerErrorLogger,
        `onWorkStart ${label} failed for target ${job.targetId}`
    );
    if (!ok) {
        return false;
    }
    job.workStarted = true;
    return true;
}

// ─────────────────────────────────────────────────────
// Phase 2C — Regular (visible) work executors
// ─────────────────────────────────────────────────────

/**
 * WORK — generic work at the settler's current location.
 *
 * Delegates to entity handler (onWorkStart/onWorkTick/onWorkComplete) when
 * an entity handler and targetId are present (digger/builder construction work).
 * Otherwise falls back to duration-based position work (original behavior).
 *
 * Duration from node.duration (frames→seconds). Direction locked on first tick.
 * Building overlay trigger fired once at start.
 */
export function executeWork(
    settler: Entity,
    job: ChoreoJobState,
    node: ChoreoNode,
    dt: number,
    ctx: WorkContext
): TaskResult {
    applyDirectionConstraint(settler, node, job, ctx);
    fireTriggerOnStart(settler, node, job, ctx);

    // Entity handler path (digger/builder construction work)
    if (ctx.entityHandler && job.targetId !== null) {
        if (!startEntityWork(settler, job, ctx.entityHandler, ctx, '')) {
            return TaskResult.FAILED;
        }
        return tickEntityWork(settler, job, node, dt, ctx.entityHandler, ctx, '');
    }

    // Position handler path
    if (!job.workStarted) {
        job.workStarted = true;
    }

    const result = tickDuration(job, dt, resolveDurationSeconds(node));
    if (result === TaskResult.DONE) {
        callPositionComplete(settler, job, ctx, 'onWorkAtPositionComplete');
    }
    return result;
}

/**
 * WORK_ON_ENTITY — entity-targeted work (tree, stone, crop, …).
 *
 * Lifecycle: onWorkStart → onWorkTick each tick → onWorkComplete on finish.
 */
export function executeWorkOnEntity(
    settler: Entity,
    job: ChoreoJobState,
    node: ChoreoNode,
    dt: number,
    ctx: WorkContext
): TaskResult {
    if (!ctx.entityHandler) {
        log.warn(`executeWorkOnEntity: no entityHandler for settler ${settler.id}`);
        return TaskResult.FAILED;
    }
    if (job.targetId === null) {
        log.warn(`executeWorkOnEntity: settler ${settler.id} has no targetId`);
        return TaskResult.FAILED;
    }

    applyDirectionConstraint(settler, node, job, ctx);
    fireTriggerOnStart(settler, node, job, ctx);

    if (!startEntityWork(settler, job, ctx.entityHandler, ctx, '')) {
        return TaskResult.FAILED;
    }
    return tickEntityWork(settler, job, node, dt, ctx.entityHandler, ctx, '');
}

// ─────────────────────────────────────────────────────
// Phase 2D — Virtual (invisible) work executors
// ─────────────────────────────────────────────────────

/**
 * WORK_VIRTUAL — interior work; settler hidden inside the building.
 *
 * Same progress/trigger mechanics as WORK, settler invisible from first tick.
 */
export function executeWorkVirtual(
    settler: Entity,
    job: ChoreoJobState,
    node: ChoreoNode,
    dt: number,
    ctx: WorkContext
): TaskResult {
    if (!job.workStarted) {
        job.visible = false;
    }

    applyDirectionConstraint(settler, node, job, ctx);
    fireTriggerOnStart(settler, node, job, ctx);
    if (!job.workStarted) {
        job.workStarted = true;
    }

    const result = tickDuration(job, dt, resolveDurationSeconds(node));
    if (result === TaskResult.DONE) {
        callPositionComplete(settler, job, ctx, 'onWorkAtPositionComplete (virtual)');
    }
    return result;
}

/**
 * WORK_ON_ENTITY_VIRTUAL — entity-targeted interior work; settler invisible.
 */
export function executeWorkOnEntityVirtual(
    settler: Entity,
    job: ChoreoJobState,
    node: ChoreoNode,
    dt: number,
    ctx: WorkContext
): TaskResult {
    if (!ctx.entityHandler) {
        log.warn(`executeWorkOnEntityVirtual: no entityHandler for settler ${settler.id}`);
        return TaskResult.FAILED;
    }
    if (job.targetId === null) {
        log.warn(`executeWorkOnEntityVirtual: settler ${settler.id} has no targetId`);
        return TaskResult.FAILED;
    }

    if (!job.workStarted) {
        job.visible = false;
    }

    applyDirectionConstraint(settler, node, job, ctx);
    fireTriggerOnStart(settler, node, job, ctx);

    if (!startEntityWork(settler, job, ctx.entityHandler, ctx, '(virtual)')) {
        return TaskResult.FAILED;
    }
    return tickEntityWork(settler, job, node, dt, ctx.entityHandler, ctx, '(virtual)');
}

/**
 * PRODUCE_VIRTUAL — virtual production cycle; settler invisible.
 *
 * Pure duration timer for internal building production. Inventory changes
 * handled by adjacent GET_GOOD_VIRTUAL / PUT_GOOD_VIRTUAL nodes.
 */
export function executeProduceVirtual(
    settler: Entity,
    job: ChoreoJobState,
    node: ChoreoNode,
    dt: number,
    ctx: WorkContext
): TaskResult {
    if (!job.workStarted) {
        job.visible = false;
        fireTriggerOnStart(settler, node, job, ctx);
        job.workStarted = true;
    }
    return tickDuration(job, dt, resolveDurationSeconds(node));
}
