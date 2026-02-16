/**
 * Task executor functions extracted from SettlerTaskSystem.
 *
 * Each function implements one TaskType from the YAML job sequences.
 * The main system passes a TaskContext to provide access to services.
 */

import { UnitType, type Entity, setCarrying, clearCarrying } from '../../entity';
import { LogHandler } from '@/utilities/log-handler';
import type { ThrottledLogger } from '@/utilities/throttled-logger';
import { hexDistance } from '../hex-directions';
import type { GameState } from '../../game-state';
import type { EventBus } from '../../event-bus';
import type { BuildingInventoryManager, InventoryVisualizer } from '../../features/inventory';
import type { CarrierManager } from '../../features/carriers';
import { CarrierStatus } from '../../features/carriers';
import {
    TaskType,
    TaskResult,
    type TaskNode,
    type CarrierJobState,
    type JobState,
    type WorkHandler,
    type AnimationType,
} from './types';

const log = new LogHandler('TaskExecutors');

/** Fatigue added per delivery cycle */
const FATIGUE_PER_DELIVERY = 5;

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
    setIdleAnimation(settler: Entity): void;
    applyTaskAnimation(settler: Entity, anim: AnimationType, direction?: number): void;
}

// ─────────────────────────────────────────────────────────────
// Dispatcher
// ─────────────────────────────────────────────────────────────

/**
 * Dispatch a task to the appropriate executor function.
 */
export function executeTask(
    settler: Entity,
    job: JobState,
    task: TaskNode,
    dt: number,
    ctx: TaskContext,
    handler?: WorkHandler
): TaskResult {
    switch (task.task) {
    case TaskType.GO_TO_TARGET:
        return executeGoToTarget(settler, job, ctx);

    case TaskType.WORK_ON_ENTITY:
        return executeWorkOnEntity(settler, job, task, dt, ctx, handler);

    case TaskType.PICKUP:
        return executePickup(settler, job, task, ctx);

    case TaskType.GO_HOME:
        return executeGoHome(settler, job, ctx);

    case TaskType.GO_TO_SOURCE:
        return executeGoToSource(settler, job, ctx);

    case TaskType.GO_TO_DEST:
        return executeGoToDest(settler, job, ctx);

    case TaskType.STAY:
        return TaskResult.CONTINUE;

    case TaskType.DROPOFF:
        return executeDropoff(settler, job, ctx);

    case TaskType.WORK:
        return executeWork(settler, job, task, dt, ctx, handler);

    case TaskType.SEARCH_POS:
        return executeSearchPos(settler, job, ctx, handler);

    case TaskType.GO_TO_POS:
        return executeGoToPos(settler, job, ctx);

    case TaskType.WAIT:
        return executeWait(job, task, dt);

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

function moveToPosition(settler: Entity, targetX: number, targetY: number, ctx: TaskContext): TaskResult {
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

function executeGoHome(settler: Entity, job: JobState, ctx: TaskContext): TaskResult {
    const homeId = job.data.homeId;
    if (!homeId) return TaskResult.FAILED;
    const building = ctx.gameState.getEntityOrThrow(homeId, 'home building');
    return moveToPosition(settler, building.x, building.y, ctx);
}

function executeGoToSource(settler: Entity, job: JobState, ctx: TaskContext): TaskResult {
    if (job.type !== 'carrier') return TaskResult.FAILED;
    const { sourceBuildingId, material } = job.data;
    const building = ctx.gameState.getEntityOrThrow(sourceBuildingId, 'source building');
    // Navigate to the output stack position if it exists, otherwise fall back to building center
    const stackPos = ctx.inventoryVisualizer.getStackPosition(sourceBuildingId, material, 'output');
    const targetX = stackPos?.x ?? building.x;
    const targetY = stackPos?.y ?? building.y;
    return moveToPosition(settler, targetX, targetY, ctx);
}

function executeGoToDest(settler: Entity, job: JobState, ctx: TaskContext): TaskResult {
    if (job.type !== 'carrier') return TaskResult.FAILED;
    const { destBuildingId, material } = job.data;
    const building = ctx.gameState.getEntityOrThrow(destBuildingId, 'destination building');
    // Navigate to the input stack position if it exists, otherwise fall back to building center
    const stackPos = ctx.inventoryVisualizer.getStackPosition(destBuildingId, material, 'input');
    const targetX = stackPos?.x ?? building.x;
    const targetY = stackPos?.y ?? building.y;
    return moveToPosition(settler, targetX, targetY, ctx);
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

// ─────────────────────────────────────────────────────────────
// Work tasks
// ─────────────────────────────────────────────────────────────

// eslint-disable-next-line complexity -- handler boundary requires per-call guards
function executeWorkOnEntity(
    settler: Entity,
    job: JobState,
    task: TaskNode,
    dt: number,
    ctx: TaskContext,
    handler?: WorkHandler
): TaskResult {
    if (job.type !== 'worker') return TaskResult.FAILED;
    if (!job.data.targetId || !handler) return TaskResult.FAILED;

    const targetId = job.data.targetId;

    // Only check canWork before work has started — once inputs are consumed
    // by onWorkStart, the check would fail since materials are already gone.
    if (!job.workStarted) {
        try {
            if (!handler.canWork(targetId)) {
                if (handler.shouldWaitForWork) {
                    ctx.setIdleAnimation(settler);
                    return TaskResult.CONTINUE;
                }
                return TaskResult.FAILED;
            }
        } catch (e) {
            const err = e instanceof Error ? e : new Error(String(e));
            ctx.handlerErrorLogger.error(`canWork failed for target ${targetId}`, err);
            return TaskResult.FAILED;
        }
    }

    // Start work on first tick (or when materials become available)
    if (!job.workStarted) {
        ctx.applyTaskAnimation(settler, task.anim);
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

    // Remember previous progress for animation phase transition
    const prevProgress = job.progress;

    // Update progress
    const duration = task.duration ?? 1.0;
    job.progress += dt / duration;

    // Switch to pickup animation when log is ready (at 90% progress)
    const PICKUP_THRESHOLD = 0.9;
    if (prevProgress < PICKUP_THRESHOLD && job.progress >= PICKUP_THRESHOLD) {
        ctx.applyTaskAnimation(settler, 'pickup');
    }

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
    handler?: WorkHandler
): TaskResult {
    const duration = task.duration ?? 1.0;
    job.progress += dt / duration;

    if (job.progress >= 1) {
        // Notify handler if work completed at a searched position (forester planting, etc.)
        if (handler?.onWorkAtPositionComplete && job.type === 'worker' && job.data.targetPos) {
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

function executeSearchPos(settler: Entity, job: JobState, ctx: TaskContext, handler?: WorkHandler): TaskResult {
    if (job.type !== 'worker') return TaskResult.FAILED;
    if (!handler) {
        throw new Error(
            `Settler ${settler.id} (${UnitType[settler.subType]}): SEARCH_POS task requires a work handler`
        );
    }

    // Use findTarget to search for a valid position (handler is a system boundary)
    let target: ReturnType<WorkHandler['findTarget']>;
    try {
        target = handler.findTarget(settler.x, settler.y, settler.id);
    } catch (e) {
        const err = e instanceof Error ? e : new Error(String(e));
        ctx.handlerErrorLogger.error(`findTarget (SEARCH_POS) failed for settler ${settler.id}`, err);
        return TaskResult.FAILED;
    }
    if (!target) {
        if (handler.shouldWaitForWork) {
            return TaskResult.CONTINUE;
        }
        log.debug(`Settler ${settler.id}: no position found for SEARCH_POS`);
        return TaskResult.FAILED;
    }

    // Store position for GO_TO_POS task
    job.data.targetPos = { x: target.x, y: target.y };
    // Also store target entity if provided (e.g., for planting near a building)
    if (target.entityId) {
        job.data.targetId = target.entityId;
    }

    log.debug(`Settler ${settler.id}: found position (${target.x}, ${target.y}) for planting`);
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

function executePickup(settler: Entity, job: JobState, task: TaskNode, ctx: TaskContext): TaskResult {
    if (job.type === 'carrier') {
        return executeCarrierPickup(settler, job, ctx);
    }

    // Regular settler pickup (e.g., woodcutter picking up LOG)
    const material = task.good;
    if (material != null) {
        setCarrying(settler, material, 1);
        job.data.carryingGood = material;
    }
    return TaskResult.DONE;
}

/**
 * Carrier pickup - withdraw from source building inventory.
 * Inventory was reserved by LogisticsDispatcher via InventoryReservationManager.
 */
function executeCarrierPickup(settler: Entity, job: CarrierJobState, ctx: TaskContext): TaskResult {
    const entity = ctx.gameState.getEntityOrThrow(settler.id, 'carrier');
    const { sourceBuildingId, material, amount: requestedAmount } = job.data;

    // Withdraw from reserved amount (atomic: release slot reservation + withdraw)
    const withdrawn = ctx.inventoryManager.withdrawReservedOutput(sourceBuildingId, material, requestedAmount);

    if (withdrawn === 0) {
        log.warn(`Carrier ${settler.id}: material ${material} not available at building ${sourceBuildingId}`);

        ctx.eventBus.emit('carrier:pickupFailed', {
            entityId: settler.id,
            material,
            fromBuilding: sourceBuildingId,
            requestedAmount,
        });

        return TaskResult.FAILED;
    }

    setCarrying(entity, material, withdrawn);

    job.data.carryingGood = material;
    job.data.amount = withdrawn;

    if (withdrawn < requestedAmount) {
        log.debug(`Carrier ${settler.id} picked up ${withdrawn}/${requestedAmount} of ${material} (partial)`);
    } else {
        log.debug(`Carrier ${settler.id} picked up ${withdrawn} of ${material} from building ${sourceBuildingId}`);
    }

    ctx.eventBus.emit('carrier:pickupComplete', {
        entityId: settler.id,
        material,
        amount: withdrawn,
        fromBuilding: sourceBuildingId,
    });

    return TaskResult.DONE;
}

function executeDropoff(settler: Entity, job: JobState, ctx: TaskContext): TaskResult {
    if (job.type === 'carrier') {
        return executeCarrierDropoff(settler, job, ctx);
    }

    // Regular settler dropoff (e.g., woodcutter dropping off LOG at home)
    if (job.data.carryingGood == null) {
        return TaskResult.DONE;
    }

    if (!job.data.homeId) {
        throw new Error(
            `Settler ${settler.id} (${UnitType[settler.subType]}) has no home building for dropoff. Job started incorrectly.`
        );
    }

    const homeId = job.data.homeId;
    const carryingGood = job.data.carryingGood;

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

/**
 * Carrier dropoff - deposit to destination building inventory.
 * Emits the critical 'carrier:deliveryComplete' event.
 */
function executeCarrierDropoff(settler: Entity, job: CarrierJobState, ctx: TaskContext): TaskResult {
    const entity = ctx.gameState.getEntityOrThrow(settler.id, 'carrier');
    const { destBuildingId, material } = job.data;

    const amount = entity.carrying?.amount ?? 0;

    const deposited = ctx.inventoryManager.depositInput(destBuildingId, material, amount);

    const overflow = amount - deposited;
    if (overflow > 0) {
        log.warn(`Carrier ${settler.id}: ${overflow} of ${material} overflow at building ${destBuildingId}`);
    }

    clearCarrying(entity);
    job.data.carryingGood = null;

    log.debug(`Carrier ${settler.id} delivered ${deposited} of ${material} to building ${destBuildingId}`);

    ctx.carrierManager.addFatigue(settler.id, FATIGUE_PER_DELIVERY);
    ctx.carrierManager.setStatus(settler.id, CarrierStatus.Idle);

    ctx.eventBus.emit('carrier:deliveryComplete', {
        entityId: settler.id,
        material,
        amount: deposited,
        toBuilding: destBuildingId,
        overflow,
    });

    return TaskResult.DONE;
}
