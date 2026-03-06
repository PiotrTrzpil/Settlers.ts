/**
 * Transport-specific choreography executors for carrier delivery jobs.
 *
 * Extracted from inventory-executors.ts to separate transport domain logic
 * from the generic worker inventory operations. These functions handle
 * TransportJob lifecycle (pickup/complete), carrier status transitions,
 * and carrier-specific events.
 *
 * Called by executeGetGood/executePutGood when job.transportData is present.
 */

import { type Entity } from '../../../entity';
import { EMaterialType } from '../../../economy';
import { createLogger } from '@/utilities/logger';
import { TaskResult } from '../types';
import type { ChoreoJobState, InventoryExecutorContext, TransportData } from '../choreo-types';

const log = createLogger('TransportExecutors');

/**
 * Handle carrier pickup from source building.
 *
 * Withdraws material via materialTransfer.pickUp(), then calls callbacks.onPickedUp()
 * to notify logistics (consumes reservation). Emits pickup events.
 */
export function executeTransportPickup(
    settler: Entity,
    job: ChoreoJobState,
    td: TransportData,
    ctx: InventoryExecutorContext
): TaskResult {
    const { jobId, material, sourceBuildingId, amount: requestedAmount } = td;

    // Job may have been cancelled externally (building destroyed, state restore, etc.)
    if (!ctx.transportJobOps.getJob(jobId)) {
        log.debug(`Carrier ${settler.id}: transport job ${jobId} no longer exists, aborting pickup`);
        return TaskResult.FAILED;
    }

    const withdrawn = ctx.materialTransfer.pickUp(settler.id, sourceBuildingId, material, requestedAmount, true);

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

    // Job may have been cancelled between getJob check and now (e.g. during inventory withdrawal)
    if (!ctx.transportJobOps.pickUp(jobId)) {
        log.debug(`Carrier ${settler.id}: transport job ${jobId} cancelled during pickup`);
        return TaskResult.FAILED;
    }
    job.carryingGood = material;
    td.amount = withdrawn;

    log.debug(
        `Carrier ${settler.id} picked up ${withdrawn} of ${EMaterialType[material]} from building ${sourceBuildingId}`
    );

    ctx.eventBus.emit('carrier:pickupComplete', {
        entityId: settler.id,
        material,
        amount: withdrawn,
        fromBuilding: sourceBuildingId,
    });

    return TaskResult.DONE;
}

/**
 * Handle carrier delivery to destination building.
 *
 * Deposits material via materialTransfer.deliver(), then calls callbacks.onDelivered()
 * to notify logistics (fulfills request). Emits delivery events.
 */
export function executeTransportDelivery(
    settler: Entity,
    job: ChoreoJobState,
    td: TransportData,
    ctx: InventoryExecutorContext
): TaskResult {
    const { jobId, destBuildingId, material } = td;

    if (!settler.carrying) {
        throw new Error(
            `Carrier ${settler.id}: PUT_GOOD called but settler is not carrying anything ` +
                `(job: material=${EMaterialType[material]})`
        );
    }

    const amount = settler.carrying.amount;
    const deposited = ctx.materialTransfer.deliver(settler.id, destBuildingId, 'input');
    // Job may have been cancelled externally — deliver gracefully handles missing jobs
    ctx.transportJobOps.deliver(jobId);

    const overflow = amount - deposited;
    if (overflow > 0) {
        log.warn(
            `Carrier ${settler.id}: ${overflow} of ${EMaterialType[material]} overflow at building ${destBuildingId}`
        );
    }

    job.carryingGood = null;

    log.debug(
        `Carrier ${settler.id} delivered ${deposited} of ${EMaterialType[material]} to building ${destBuildingId}`
    );

    // NOTE: completeTransport (carrier → Idle) is NOT called here.
    // It is deferred until the PUT_GOOD animation finishes (tickInventoryDuration returns DONE),
    // to prevent the logistics dispatcher from re-assigning the carrier mid-animation.
    // See executePutGood in inventory-executors.ts.

    ctx.eventBus.emit('carrier:deliveryComplete', {
        entityId: settler.id,
        material,
        amount: deposited,
        toBuilding: destBuildingId,
        overflow,
    });

    return TaskResult.DONE;
}
