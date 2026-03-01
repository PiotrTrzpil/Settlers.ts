/**
 * Transport choreography executors for carrier jobs.
 *
 * These executors handle the carrier-specific inventory operations that
 * use TransportJob (with reservations and request lifecycle) instead of
 * direct inventory access.
 *
 * TRANSPORT_PICKUP  — TransportJob.pickup() + setCarrying + events
 * TRANSPORT_DROPOFF — TransportJob.complete() + clearCarrying + events + fatigue
 */

import { setCarrying, clearCarrying } from '../../../entity';
import { EMaterialType } from '../../../economy';
import { CarrierStatus } from '../../carriers';
import { LogHandler } from '@/utilities/log-handler';
import { TaskResult } from '../types';
import type { ChoreoExecutorFn, ChoreoJobState } from '../choreo-types';

const log = new LogHandler('TransportExecutors');

/** Fatigue added per delivery cycle. */
const FATIGUE_PER_DELIVERY = 5;

/**
 * TRANSPORT_PICKUP — Pick up material from source building via TransportJob.
 *
 * TransportJob.pickup() atomically:
 *   1. Releases the slot-level reservation
 *   2. Withdraws inventory from the source building
 *   3. Changes status: 'active' → 'picked-up'
 *
 * After pickup, sets the job's targetPos to the destination building position
 * so the next GO_TO_TARGET node navigates correctly.
 */
export const executeTransportPickup: ChoreoExecutorFn = (settler, job, _node, _dt, ctx) => {
    const td = requireTransportData(job, settler.id);
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

    if (withdrawn < requestedAmount) {
        log.debug(
            `Carrier ${settler.id} picked up ${withdrawn}/${requestedAmount} of ${EMaterialType[material]} (partial)`
        );
    } else {
        log.debug(
            `Carrier ${settler.id} picked up ${withdrawn} of ${EMaterialType[material]} from building ${sourceBuildingId}`
        );
    }

    ctx.eventBus.emit('carrier:pickupComplete', {
        entityId: settler.id,
        material,
        amount: withdrawn,
        fromBuilding: sourceBuildingId,
    });

    // Pre-set targetPos for the next movement node (destination building)
    job.targetPos = { x: td.destPos.x, y: td.destPos.y };

    return TaskResult.DONE;
};

/**
 * TRANSPORT_DROPOFF — Deposit material at destination building via TransportJob.
 *
 * TransportJob.complete() atomically:
 *   1. Deposits inventory at destination building
 *   2. Fulfills the original resource request
 *   3. Changes status: 'picked-up' → 'completed'
 *
 * After dropoff, sets the job's targetPos to the home building position
 * so the next GO_TO_TARGET node navigates home correctly.
 */
export const executeTransportDropoff: ChoreoExecutorFn = (settler, job, _node, _dt, ctx) => {
    const td = requireTransportData(job, settler.id);
    const { transportJob, destBuildingId, material } = td;

    if (!settler.carrying) {
        throw new Error(
            `Carrier ${settler.id}: dropoff called but settler is not carrying anything (job: material=${EMaterialType[material]})`
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

    ctx.carrierManager.addFatigue(settler.id, FATIGUE_PER_DELIVERY);
    ctx.carrierManager.setStatus(settler.id, CarrierStatus.Idle);

    ctx.eventBus.emit('carrier:deliveryComplete', {
        entityId: settler.id,
        material,
        amount: deposited,
        toBuilding: destBuildingId,
        overflow,
    });

    // Pre-set targetPos for the next movement node (home building)
    job.targetPos = { x: td.homePos.x, y: td.homePos.y };

    return TaskResult.DONE;
};

/** Extract transportData from job, throwing if missing. */
function requireTransportData(job: ChoreoJobState, settlerId: number) {
    if (!job.transportData) {
        throw new Error(`Carrier ${settlerId}: TRANSPORT_* node executed but job has no transportData`);
    }
    return job.transportData;
}
