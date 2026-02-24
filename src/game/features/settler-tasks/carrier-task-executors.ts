/**
 * Carrier-specific task executors.
 *
 * Handles the carrier.transport job tasks: GO_TO_SOURCE, PICKUP, GO_TO_DEST, DROPOFF.
 * PICKUP and DROPOFF delegate to TransportJob for inventory + request lifecycle.
 * Generic tasks (GO_HOME, WAIT, STAY) fall through to the main dispatcher.
 */

import { type Entity, setCarrying, clearCarrying } from '../../entity';
import { LogHandler } from '@/utilities/log-handler';
import { CarrierStatus } from '../carriers';
import { TaskType, TaskResult, type TaskNode, type CarrierJobState } from './types';
import type { TaskContext } from './task-executors';
import { moveToPosition } from './task-executors';

const log = new LogHandler('CarrierTaskExecutors');

/** Fatigue added per delivery cycle */
const FATIGUE_PER_DELIVERY = 5;

/**
 * Try to execute a carrier-specific task.
 * Returns null for tasks that should be handled by the generic dispatcher.
 */
// eslint-disable-next-line complexity -- exhaustive switch over all task types
export function executeCarrierTask(
    settler: Entity,
    job: CarrierJobState,
    task: TaskNode,
    ctx: TaskContext
): TaskResult | null {
    switch (task.task) {
    case TaskType.GO_TO_SOURCE:
        return goToSource(settler, job, ctx);

    case TaskType.GO_TO_DEST:
        return goToDest(settler, job, ctx);

    case TaskType.PICKUP:
        return pickup(settler, job, ctx);

    case TaskType.DROPOFF:
        return dropoff(settler, job, ctx);

    case TaskType.GO_TO_TARGET:
    case TaskType.GO_TO_POS:
    case TaskType.GO_HOME:
    case TaskType.SEARCH_POS:
    case TaskType.WAIT_FOR_WORK:
    case TaskType.WORK_ON_ENTITY:
    case TaskType.STAY:
    case TaskType.WORK:
    case TaskType.WAIT:
    case TaskType.GO_ADJACENT_POS:
    case TaskType.FACE_POS:
        return null; // Not carrier-specific — fall through to generic dispatcher
    }
}

// ─────────────────────────────────────────────────────────────
// Movement
// ─────────────────────────────────────────────────────────────

function goToSource(settler: Entity, job: CarrierJobState, ctx: TaskContext): TaskResult {
    const { sourceBuildingId, material } = job.data;
    const building = ctx.gameState.getEntityOrThrow(sourceBuildingId, 'source building');
    // Navigate to the output stack position if it exists, otherwise fall back to building center
    const stackPos = ctx.inventoryVisualizer.getStackPosition(sourceBuildingId, material, 'output');
    const targetX = stackPos?.x ?? building.x;
    const targetY = stackPos?.y ?? building.y;
    return moveToPosition(settler, targetX, targetY, ctx);
}

function goToDest(settler: Entity, job: CarrierJobState, ctx: TaskContext): TaskResult {
    const { destBuildingId, material } = job.data;
    const building = ctx.gameState.getEntityOrThrow(destBuildingId, 'destination building');
    // Navigate to the input stack position if it exists, otherwise fall back to building center
    const stackPos = ctx.inventoryVisualizer.getStackPosition(destBuildingId, material, 'input');
    const targetX = stackPos?.x ?? building.x;
    const targetY = stackPos?.y ?? building.y;
    return moveToPosition(settler, targetX, targetY, ctx);
}

// ─────────────────────────────────────────────────────────────
// Pickup / Dropoff — delegated to TransportJob
// ─────────────────────────────────────────────────────────────

/**
 * Pick up material from source building.
 * TransportJob handles the reservation → withdrawal atomically.
 */
function pickup(settler: Entity, job: CarrierJobState, ctx: TaskContext): TaskResult {
    const { transportJob, material, sourceBuildingId, amount: requestedAmount } = job.data;

    const withdrawn = transportJob.pickup();

    if (withdrawn === 0) {
        log.warn(`Carrier ${settler.id}: pickup failed at building ${sourceBuildingId}`);

        ctx.eventBus.emit('carrier:pickupFailed', {
            entityId: settler.id,
            material,
            fromBuilding: sourceBuildingId,
            requestedAmount,
        });

        return TaskResult.FAILED;
    }

    setCarrying(settler, material, withdrawn);
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

/**
 * Deposit material to destination building.
 * TransportJob handles the deposit + request fulfillment.
 */
function dropoff(settler: Entity, job: CarrierJobState, ctx: TaskContext): TaskResult {
    const { transportJob, destBuildingId, material } = job.data;

    const amount = settler.carrying?.amount ?? 0;
    const deposited = transportJob.complete(amount);

    const overflow = amount - deposited;
    if (overflow > 0) {
        log.warn(`Carrier ${settler.id}: ${overflow} of ${material} overflow at building ${destBuildingId}`);
    }

    clearCarrying(settler);
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
