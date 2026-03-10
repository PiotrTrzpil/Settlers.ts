/**
 * Transport-specific choreography executors for carrier delivery jobs.
 *
 * Dedicated executors for TRANSPORT_* task types — no branching on transportData.
 * These are registered alongside the core executors and only run for carrier
 * transport choreographies built by TransportJobBuilder.
 *
 * Movement executors (TRANSPORT_GO_TO_SOURCE/DEST) read positions from
 * job.transportData. Inventory executors (TRANSPORT_PICKUP/DELIVER) handle
 * the TransportJob lifecycle, material transfer, and carrier events.
 */

import { type Entity } from '../../../entity';
import { EMaterialType } from '../../../economy';
import { createLogger } from '@/utilities/logger';
import { TaskResult, framesToSeconds, tickDuration } from '../../../systems/choreo/types';
import type { ChoreoJobState, ChoreoNode, TransportData } from '../../../systems/choreo/types';
import type { InventoryExecutorContext, MovementContext } from '../choreo-types';
import { moveToPosition } from './movement-executors';

const log = createLogger('TransportExecutors');

/** Carrier must step onto the exact pile tile. */
const ARRIVAL_DIST_EXACT = 0;

/**
 * Default animation cycle for inventory nodes with duration=0 (one pickup/dropoff animation).
 * Carrier pickup/dropoff animations are typically 4-5 frames at 100ms each.
 */
const DEFAULT_INVENTORY_CYCLE_FRAMES = 5; // 0.5 seconds at CHOREO_FPS

function resolveInventoryDuration(node: ChoreoNode): number {
    if (node.duration === 0) return framesToSeconds(DEFAULT_INVENTORY_CYCLE_FRAMES);
    if (node.duration <= 0) return 0;
    return framesToSeconds(node.duration);
}

/** Require transportData on the job — all TRANSPORT_* executors need it. */
function requireTransportData(job: ChoreoJobState, context: string): TransportData {
    if (!job.transportData) {
        throw new Error(
            `${context}: job '${job.jobId}' has no transportData — only use TRANSPORT_* nodes in carrier jobs`
        );
    }
    return job.transportData;
}

// ─────────────────────────────────────────────────────────────
// Movement executors
// ─────────────────────────────────────────────────────────────

/** TRANSPORT_GO_TO_SOURCE — move to source building's output pile for pickup. */
export function executeTransportGoToSource(
    settler: Entity,
    job: ChoreoJobState,
    node: ChoreoNode,
    _dt: number,
    ctx: MovementContext
): TaskResult {
    const td = requireTransportData(job, 'TRANSPORT_GO_TO_SOURCE');
    return moveToPosition(settler, td.sourcePos.x, td.sourcePos.y, node, ctx, ARRIVAL_DIST_EXACT, job);
}

/** TRANSPORT_GO_TO_DEST — move to destination building's input pile for delivery. */
export function executeTransportGoToDest(
    settler: Entity,
    job: ChoreoJobState,
    node: ChoreoNode,
    _dt: number,
    ctx: MovementContext
): TaskResult {
    const td = requireTransportData(job, 'TRANSPORT_GO_TO_DEST');
    return moveToPosition(settler, td.destPos.x, td.destPos.y, node, ctx, ARRIVAL_DIST_EXACT, job);
}

// ─────────────────────────────────────────────────────────────
// Inventory executors
// ─────────────────────────────────────────────────────────────

/**
 * TRANSPORT_PICKUP — withdraw material from source building.
 *
 * First tick: validates job, withdraws via materialTransfer, consumes reservation.
 * Subsequent ticks: plays pickup animation.
 */
export function executeTransportPickup(
    settler: Entity,
    job: ChoreoJobState,
    node: ChoreoNode,
    dt: number,
    ctx: InventoryExecutorContext
): TaskResult {
    if (!job.workStarted) {
        job.workStarted = true;

        const td = requireTransportData(job, 'TRANSPORT_PICKUP');
        const { jobId, material, sourceBuildingId, amount: requestedAmount } = td;

        if (!ctx.transportJobOps.getJob(jobId)) {
            log.debug(`Carrier ${settler.id}: transport job ${jobId} no longer exists, aborting pickup`);
            return TaskResult.FAILED;
        }

        // Advance phase to PickedUp BEFORE withdrawal so that if the source entity
        // is destroyed (e.g. free pile emptied to 0), the cleanup sees PickedUp and
        // lets the carrier continue to deliver instead of cancelling the job.
        if (!ctx.transportJobOps.pickUp(jobId)) {
            log.debug(`Carrier ${settler.id}: transport job ${jobId} cancelled before pickup`);
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
    }

    return tickDuration(job, dt, resolveInventoryDuration(node));
}

/**
 * TRANSPORT_DELIVER — deposit material at destination building.
 *
 * First tick: validates job, deposits via materialTransfer, fulfills request.
 * Subsequent ticks: plays dropoff animation.
 */
export function executeTransportDeliver(
    settler: Entity,
    job: ChoreoJobState,
    node: ChoreoNode,
    dt: number,
    ctx: InventoryExecutorContext
): TaskResult {
    if (!job.workStarted) {
        job.workStarted = true;

        const td = requireTransportData(job, 'TRANSPORT_DELIVER');
        const { jobId, destBuildingId, material } = td;

        if (!ctx.transportJobOps.getJob(jobId)) {
            log.debug(`Carrier ${settler.id}: transport job ${jobId} no longer exists, dropping material`);
            ctx.materialTransfer.drop(settler.id);
            return TaskResult.FAILED;
        }

        if (!settler.carrying) {
            throw new Error(
                `Carrier ${settler.id}: TRANSPORT_DELIVER called but settler is not carrying anything ` +
                    `(job: material=${EMaterialType[material]})`
            );
        }

        const amount = settler.carrying.amount;
        // StorageArea has no input slots — deliver to output (dynamic slot assignment)
        const slotType = ctx.inventoryManager.isStorageArea(destBuildingId) ? 'output' : 'input';
        const deposited = ctx.materialTransfer.deliver(settler.id, destBuildingId, slotType);
        ctx.transportJobOps.deliver(jobId);

        const overflow = amount - deposited;
        if (overflow > 0) {
            log.warn(
                `Carrier ${settler.id}: ${overflow} of ${EMaterialType[material]} overflow at building ${destBuildingId}`
            );
            ctx.eventBus.emit('construction:materialOverflowed', {
                buildingId: destBuildingId,
                material,
                amount: overflow,
            });
        }

        job.carryingGood = null;

        log.debug(
            `Carrier ${settler.id} delivered ${deposited} of ${EMaterialType[material]} to building ${destBuildingId}`
        );

        ctx.eventBus.emit('carrier:deliveryComplete', {
            entityId: settler.id,
            material,
            amount: deposited,
            toBuilding: destBuildingId,
            overflow,
        });
    }

    return tickDuration(job, dt, resolveInventoryDuration(node));
}
