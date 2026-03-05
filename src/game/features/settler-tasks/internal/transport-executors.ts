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

import { type Entity, setCarrying, clearCarrying } from '../../../entity';
import { EMaterialType } from '../../../economy';
import { LogHandler } from '@/utilities/log-handler';
import { TaskResult } from '../types';
import type { ChoreoJobState, ChoreoContext, TransportData } from '../choreo-types';

const log = new LogHandler('TransportExecutors');

/**
 * Handle carrier pickup from source building via TransportJob.
 *
 * Calls transportJob.pickup() to atomically release reservation and withdraw inventory,
 * transitions carrier to Delivering status, and emits pickup events.
 * Pre-sets job.targetPos for the next movement node (GO_TO_DESTINATION_PILE).
 */
export function executeTransportPickup(
    settler: Entity,
    job: ChoreoJobState,
    td: TransportData,
    ctx: ChoreoContext
): TaskResult {
    const { transportJob, material, sourceBuildingId, amount: requestedAmount } = td;

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
    job.carryingGood = material;
    td.amount = withdrawn;

    log.debug(
        `Carrier ${settler.id} picked up ${withdrawn} of ${EMaterialType[material]} from building ${sourceBuildingId}`
    );

    ctx.carrierManager.startDelivery(settler.id);

    ctx.eventBus.emit('carrier:pickupComplete', {
        entityId: settler.id,
        material,
        amount: withdrawn,
        fromBuilding: sourceBuildingId,
    });

    return TaskResult.DONE;
}

/**
 * Handle carrier delivery to destination building via TransportJob.
 *
 * Calls transportJob.complete() to deposit inventory and fulfill the request,
 * transitions carrier back to Idle, and emits delivery events.
 */
export function executeTransportDelivery(
    settler: Entity,
    job: ChoreoJobState,
    td: TransportData,
    ctx: ChoreoContext
): TaskResult {
    const { transportJob, destBuildingId, material } = td;

    if (!settler.carrying) {
        throw new Error(
            `Carrier ${settler.id}: PUT_GOOD called but settler is not carrying anything ` +
                `(job: material=${EMaterialType[material]})`
        );
    }

    const amount = settler.carrying.amount;
    const deposited = transportJob.complete(amount);

    const overflow = amount - deposited;
    if (overflow > 0) {
        log.warn(
            `Carrier ${settler.id}: ${overflow} of ${EMaterialType[material]} overflow at building ${destBuildingId}`
        );
    }

    clearCarrying(settler);
    job.carryingGood = null;

    log.debug(
        `Carrier ${settler.id} delivered ${deposited} of ${EMaterialType[material]} to building ${destBuildingId}`
    );

    ctx.carrierManager.completeTransport(settler.id);

    ctx.eventBus.emit('carrier:deliveryComplete', {
        entityId: settler.id,
        material,
        amount: deposited,
        toBuilding: destBuildingId,
        overflow,
    });

    return TaskResult.DONE;
}
