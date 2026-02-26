/**
 * Task executor functions extracted from SettlerTaskSystem.
 *
 * Each function implements one TaskType from the YAML job sequences.
 * The main system passes a TaskContext to provide access to services.
 */

import { UnitType, type Entity, setCarrying, clearCarrying } from '../../entity';
import { LogHandler } from '@/utilities/log-handler';
import type { ThrottledLogger } from '@/utilities/throttled-logger';
import { hexDistance, getAllNeighbors, getApproxDirection } from '../../systems/hex-directions';
import type { GameState } from '../../game-state';
import type { EventBus } from '../../event-bus';
import type { BuildingInventoryManager, InventoryVisualizer } from '../inventory';
import type { CarrierManager } from '../carriers';
import {
    TaskType,
    TaskResult,
    type TaskNode,
    type JobState,
    type EntityWorkHandler,
    type PositionWorkHandler,
} from './types';
import { executeCarrierTask } from './carrier-task-executors';

const log = new LogHandler('TaskExecutors');

/**
 * Services and callbacks needed by task executors.
 * Built by SettlerTaskSystem and passed into executeTask().
 */
export interface TaskContext {
    gameState: GameState;
    inventoryManager: BuildingInventoryManager;
    inventoryVisualizer: InventoryVisualizer;
    carrierManager: CarrierManager;
    eventBus: EventBus;
    handlerErrorLogger: ThrottledLogger;
    /** Resolve the home building ID for a worker settler (from occupancy tracking). */
    getWorkerHomeBuilding: (settlerId: number) => number | null;
}

// ─────────────────────────────────────────────────────────────
// Dispatcher
// ─────────────────────────────────────────────────────────────

/**
 * Dispatch a task to the appropriate executor function.
 */
// eslint-disable-next-line complexity -- switch dispatcher over all task types
export function executeTask(
    settler: Entity,
    job: JobState,
    task: TaskNode,
    dt: number,
    ctx: TaskContext,
    entityHandler?: EntityWorkHandler,
    positionHandler?: PositionWorkHandler
): TaskResult {
    // Carrier-specific tasks are handled by the carrier executor
    if (job.type === 'carrier') {
        const result = executeCarrierTask(settler, job, task, ctx);
        if (result !== null) return result;
        // Fall through to generic tasks (GO_HOME, WAIT, STAY, etc.)
    }

    switch (task.task) {
    case TaskType.GO_TO_TARGET:
        return executeGoToTarget(settler, job, ctx);

    case TaskType.WAIT_FOR_WORK:
        return executeWaitForWork(settler, job, ctx, entityHandler);

    case TaskType.WORK_ON_ENTITY:
        return executeWorkOnEntity(settler, job, task, dt, ctx, entityHandler);

    case TaskType.PICKUP:
        return executePickup(settler, job, task);

    case TaskType.GO_HOME:
        return executeGoHome(settler, job, ctx);

    case TaskType.STAY:
        return TaskResult.CONTINUE;

    case TaskType.DROPOFF:
        return executeDropoff(settler, job, ctx);

    case TaskType.WORK:
        return executeWork(settler, job, task, dt, ctx, positionHandler);

    case TaskType.SEARCH_POS:
        return executeSearchPos(settler, job, ctx, positionHandler);

    case TaskType.GO_TO_POS:
        return executeGoToPos(settler, job, ctx);

    case TaskType.GO_ADJACENT_POS:
        return executeGoAdjacentPos(settler, job, ctx);

    case TaskType.FACE_POS:
        return executeFacePos(settler, job, ctx);

    case TaskType.WAIT:
        return executeWait(job, task, dt);

    case TaskType.GO_TO_SOURCE:
    case TaskType.GO_TO_DEST:
        throw new Error(`Task ${task.task} is carrier-only but job type is '${job.type}' (settler ${settler.id}).`);

    default:
        throw new Error(
            `Unhandled task type: ${task.task} in job ${job.jobId} (settler ${settler.id}). ` +
                    `Add implementation in executeTask() or remove from jobs.yaml.`
        );
    }
}

// ─────────────────────────────────────────────────────────────
// Movement helper
// ─────────────────────────────────────────────────────────────

export function moveToPosition(settler: Entity, targetX: number, targetY: number, ctx: TaskContext): TaskResult {
    const controller = ctx.gameState.movement.getController(settler.id);
    if (!controller) return TaskResult.FAILED;

    const dist = hexDistance(settler.x, settler.y, targetX, targetY);

    if (dist <= 1 && controller.state === 'idle') {
        return TaskResult.DONE;
    }

    if (controller.state === 'idle') {
        const moved = ctx.gameState.movement.moveUnit(settler.id, targetX, targetY);
        if (!moved) return TaskResult.FAILED;
    }

    return TaskResult.CONTINUE;
}

// ─────────────────────────────────────────────────────────────
// Movement tasks
// ─────────────────────────────────────────────────────────────

function executeGoToTarget(settler: Entity, job: JobState, ctx: TaskContext): TaskResult {
    if (job.type !== 'worker') return TaskResult.FAILED;
    if (!job.data.targetId) return TaskResult.FAILED;
    const target = ctx.gameState.getEntity(job.data.targetId);
    if (!target) return TaskResult.FAILED;
    return moveToPosition(settler, target.x, target.y, ctx);
}

/** Resolve home building ID: carriers use job data, workers use occupancy tracking. */
function resolveHomeId(settler: Entity, job: JobState, ctx: TaskContext): number | null {
    if (job.type === 'carrier') return job.data.homeId;
    return ctx.getWorkerHomeBuilding(settler.id);
}

function executeGoHome(settler: Entity, job: JobState, ctx: TaskContext): TaskResult {
    const homeId = resolveHomeId(settler, job, ctx);
    if (!homeId) return TaskResult.FAILED;
    const building = ctx.gameState.getEntityOrThrow(homeId, 'home building');
    return moveToPosition(settler, building.x, building.y, ctx);
}

function executeGoToPos(settler: Entity, job: JobState, ctx: TaskContext): TaskResult {
    if (job.type !== 'worker') return TaskResult.FAILED;
    if (!job.data.targetPos) {
        throw new Error(
            `Settler ${settler.id} (${UnitType[settler.subType]}): GO_TO_POS requires targetPos from a preceding SEARCH_POS task. Check job YAML.`
        );
    }
    return moveToPosition(settler, job.data.targetPos.x, job.data.targetPos.y, ctx);
}

/**
 * Move to a walkable tile adjacent to targetPos (not onto the target itself).
 * Picks the closest unoccupied neighbor. Generic — usable by any unit that
 * works on an adjacent tile (forester, farmer, etc.).
 */
function executeGoAdjacentPos(settler: Entity, job: JobState, ctx: TaskContext): TaskResult {
    if (job.type !== 'worker') return TaskResult.FAILED;
    if (!job.data.targetPos) {
        throw new Error(
            `Settler ${settler.id} (${UnitType[settler.subType]}): GO_ADJACENT_POS requires targetPos. Check job YAML.`
        );
    }

    const { x: targetX, y: targetY } = job.data.targetPos;
    const controller = ctx.gameState.movement.getController(settler.id);
    if (!controller) return TaskResult.FAILED;

    const dist = hexDistance(settler.x, settler.y, targetX, targetY);

    // Already on an adjacent tile and idle — done
    if (dist === 1 && controller.state === 'idle') {
        return TaskResult.DONE;
    }

    // Need to start (or restart) movement
    if (controller.state === 'idle') {
        const neighbor = findBestAdjacentTile(settler.x, settler.y, targetX, targetY, ctx);
        if (!neighbor) return TaskResult.FAILED;

        const moved = ctx.gameState.movement.moveUnit(settler.id, neighbor.x, neighbor.y);
        if (!moved) return TaskResult.FAILED;
    }

    return TaskResult.CONTINUE;
}

/** Pick the unoccupied neighbor of (targetX, targetY) closest to the settler. */
function findBestAdjacentTile(
    settlerX: number,
    settlerY: number,
    targetX: number,
    targetY: number,
    ctx: TaskContext
): { x: number; y: number } | null {
    const neighbors = getAllNeighbors({ x: targetX, y: targetY });
    let best: { x: number; y: number } | null = null;
    let bestDist = Infinity;

    for (const n of neighbors) {
        if (ctx.gameState.getEntityAt(n.x, n.y)) continue;
        const d = hexDistance(settlerX, settlerY, n.x, n.y);
        if (d < bestDist) {
            bestDist = d;
            best = n;
        }
    }
    return best;
}

/** Face the settler toward targetPos without moving. */
function executeFacePos(settler: Entity, job: JobState, ctx: TaskContext): TaskResult {
    if (job.type !== 'worker') return TaskResult.FAILED;
    if (!job.data.targetPos) {
        throw new Error(
            `Settler ${settler.id} (${UnitType[settler.subType]}): FACE_POS requires targetPos. Check job YAML.`
        );
    }

    const controller = ctx.gameState.movement.getController(settler.id);
    if (!controller) return TaskResult.FAILED;

    const dir = getApproxDirection(settler.x, settler.y, job.data.targetPos.x, job.data.targetPos.y);
    controller.setDirection(dir);
    return TaskResult.DONE;
}

// ─────────────────────────────────────────────────────────────
// Work tasks
// ─────────────────────────────────────────────────────────────

/**
 * Wait until canWork() passes, then advance to WORK_ON_ENTITY.
 * Separated from WORK_ON_ENTITY so animation can be derived from task type alone.
 */
function executeWaitForWork(settler: Entity, job: JobState, ctx: TaskContext, handler?: EntityWorkHandler): TaskResult {
    if (job.type !== 'worker') return TaskResult.FAILED;
    if (!job.data.targetId || !handler) return TaskResult.FAILED;

    const targetId = job.data.targetId;

    try {
        if (handler.canWork(targetId)) {
            return TaskResult.DONE;
        }
    } catch (e) {
        const err = e instanceof Error ? e : new Error(String(e));
        ctx.handlerErrorLogger.error(`canWork failed for target ${targetId}`, err);
        return TaskResult.FAILED;
    }

    if (handler.shouldWaitForWork) {
        return TaskResult.CONTINUE;
    }
    return TaskResult.FAILED;
}

/**
 * Work on target entity. Always starts immediately — canWork() gating
 * is handled by the preceding WAIT_FOR_WORK task.
 */
// eslint-disable-next-line complexity, sonarjs/cognitive-complexity -- handler boundary requires per-call guards
function executeWorkOnEntity(
    settler: Entity,
    job: JobState,
    task: TaskNode,
    dt: number,
    ctx: TaskContext,
    handler?: EntityWorkHandler
): TaskResult {
    if (job.type !== 'worker') return TaskResult.FAILED;
    if (!job.data.targetId || !handler) return TaskResult.FAILED;

    const targetId = job.data.targetId;

    // Start work on first tick
    if (!job.workStarted) {
        try {
            handler.onWorkStart?.(targetId);
        } catch (e) {
            const err = e instanceof Error ? e : new Error(String(e));
            ctx.handlerErrorLogger.error(`onWorkStart failed for target ${targetId}`, err);
            return TaskResult.FAILED;
        }
        job.workStarted = true;
        job.progress = 0;
    }

    // Update progress
    const duration = task.duration ?? 1.0;
    job.progress += dt / duration;

    // Update domain system
    let complete: boolean;
    try {
        complete = handler.onWorkTick(targetId, job.progress);
    } catch (e) {
        const err = e instanceof Error ? e : new Error(String(e));
        ctx.handlerErrorLogger.error(`onWorkTick failed for target ${targetId}`, err);
        return TaskResult.FAILED;
    }

    if (complete || job.progress >= 1) {
        try {
            handler.onWorkComplete?.(targetId, settler.x, settler.y);
        } catch (e) {
            const err = e instanceof Error ? e : new Error(String(e));
            ctx.handlerErrorLogger.error(`onWorkComplete failed for target ${targetId}`, err);
            // Work is done regardless — don't leave settler stuck
        }
        return TaskResult.DONE;
    }

    return TaskResult.CONTINUE;
}

function executeWork(
    settler: Entity,
    job: JobState,
    task: TaskNode,
    dt: number,
    ctx: TaskContext,
    handler?: PositionWorkHandler
): TaskResult {
    const duration = task.duration ?? 1.0;
    job.progress += dt / duration;

    if (job.progress >= 1) {
        if (handler && job.type === 'worker' && job.data.targetPos) {
            try {
                handler.onWorkAtPositionComplete(job.data.targetPos.x, job.data.targetPos.y, settler.id);
            } catch (e) {
                const err = e instanceof Error ? e : new Error(String(e));
                ctx.handlerErrorLogger.error(`onWorkAtPositionComplete failed for settler ${settler.id}`, err);
            }
        }
        return TaskResult.DONE;
    }

    return TaskResult.CONTINUE;
}

function executeSearchPos(settler: Entity, job: JobState, ctx: TaskContext, handler?: PositionWorkHandler): TaskResult {
    if (job.type !== 'worker') return TaskResult.FAILED;
    if (!handler) {
        throw new Error(
            `Settler ${settler.id} (${UnitType[settler.subType]}): SEARCH_POS task requires a position work handler`
        );
    }

    let position: ReturnType<PositionWorkHandler['findPosition']>;
    try {
        position = handler.findPosition(settler.x, settler.y, settler.id);
    } catch (e) {
        const err = e instanceof Error ? e : new Error(String(e));
        ctx.handlerErrorLogger.error(`findPosition (SEARCH_POS) failed for settler ${settler.id}`, err);
        return TaskResult.FAILED;
    }
    if (!position) {
        if (handler.shouldWaitForWork) {
            return TaskResult.CONTINUE;
        }
        log.debug(`Settler ${settler.id}: no position found for SEARCH_POS`);
        return TaskResult.FAILED;
    }

    job.data.targetPos = { x: position.x, y: position.y };

    log.debug(`Settler ${settler.id}: found position (${position.x}, ${position.y}) for SEARCH_POS`);
    return TaskResult.DONE;
}

function executeWait(job: JobState, task: TaskNode, dt: number): TaskResult {
    const duration = task.duration ?? 1.0;
    job.progress += dt / duration;

    if (job.progress >= 1) {
        return TaskResult.DONE;
    }

    return TaskResult.CONTINUE;
}

// ─────────────────────────────────────────────────────────────
// Pickup / Dropoff tasks
// ─────────────────────────────────────────────────────────────

function executePickup(settler: Entity, job: JobState, task: TaskNode): TaskResult {
    const material = task.good;
    if (material != null) {
        setCarrying(settler, material, 1);
        job.data.carryingGood = material;
    }
    return TaskResult.DONE;
}

function executeDropoff(settler: Entity, job: JobState, ctx: TaskContext): TaskResult {
    const carryingGood = job.data.carryingGood;
    if (carryingGood == null) return TaskResult.DONE;

    const homeId = resolveHomeId(settler, job, ctx);
    if (!homeId) {
        throw new Error(
            `Settler ${settler.id} (${UnitType[settler.subType]}) has no home building for dropoff. Job started incorrectly.`
        );
    }

    const deposited = ctx.inventoryManager.depositOutput(homeId, carryingGood, 1);
    if (deposited > 0) {
        log.debug(`Settler ${settler.id} deposited ${carryingGood} to building ${homeId}`);
    } else {
        log.warn(`Building ${homeId} output full, material lost`);
    }

    clearCarrying(settler);
    job.data.carryingGood = null;
    return TaskResult.DONE;
}
