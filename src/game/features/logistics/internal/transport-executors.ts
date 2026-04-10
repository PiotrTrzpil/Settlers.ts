/**
 * Transport-specific choreography executors for carrier delivery jobs.
 *
 * Dedicated executors for TRANSPORT_* task types — no branching on transportData.
 * These are registered on ChoreoSystem by registerTransportExecutors() and only
 * run for carrier transport choreographies built by TransportJobBuilder.
 *
 * Movement executors (TRANSPORT_GO_TO_SOURCE/DEST) read positions from
 * job.transportData and delegate to moveToPosition from settler-tasks.
 * Inventory executors (TRANSPORT_PICKUP/DELIVER) handle the TransportJob
 * lifecycle via td.ops closures, material transfer, and carrier events.
 */

import { type Entity, clearCarrying } from '../../../entity';
import { createLogger } from '@/utilities/logger';
import { TaskResult, framesToSeconds, tickDuration } from '../../../systems/choreo/types';
import type { ChoreoJobState, ChoreoNode, TransportData } from '../../../systems/choreo/types';
import type { MovementContext } from '../../settler-tasks';
import type { TransportExecutorContext } from './transport-executor-context';
import { moveToPosition } from '../../settler-tasks/internal/movement-executors';

const log = createLogger('TransportExecutors');

/** Carrier must step onto the exact pile tile. */
const ARRIVAL_DIST_EXACT = 0;

/**
 * Default animation cycle for inventory nodes with duration=0 (one pickup/dropoff animation).
 * Carrier pickup/dropoff animations are typically 4-5 frames at 100ms each.
 */
const DEFAULT_INVENTORY_CYCLE_FRAMES = 5; // 0.5 seconds at CHOREO_FPS

function resolveInventoryDuration(node: ChoreoNode): number {
    if (node.duration === 0) {
        return framesToSeconds(DEFAULT_INVENTORY_CYCLE_FRAMES);
    }
    if (node.duration <= 0) {
        return 0;
    }
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
 * First tick: validates job via td.ops.isValid() and starts the pickup animation.
 * Animation end: withdraws via materialTransfer and consumes reservation.
 */
export function executeTransportPickup(
    settler: Entity,
    job: ChoreoJobState,
    node: ChoreoNode,
    dt: number,
    ctx: TransportExecutorContext
): TaskResult {
    if (!job.workStarted) {
        job.workStarted = true;

        const td = requireTransportData(job, 'TRANSPORT_PICKUP');

        if (!td.ops.isValid()) {
            log.debug(`Carrier ${settler.id}: transport job ${td.jobId} no longer exists, aborting pickup`);
            return TaskResult.FAILED;
        }

        // Advance phase to PickedUp BEFORE withdrawal so that if the source entity
        // is destroyed (e.g. free pile emptied to 0), the cleanup sees PickedUp and
        // lets the carrier continue to deliver instead of cancelling the job.
        if (!td.ops.pickUp()) {
            log.debug(`Carrier ${settler.id}: transport job ${td.jobId} cancelled before pickup`);
            return TaskResult.FAILED;
        }
    }

    const result = tickDuration(job, dt, resolveInventoryDuration(node));

    if (result === TaskResult.DONE) {
        const td = requireTransportData(job, 'TRANSPORT_PICKUP');
        const { material, sourceBuildingId, amount: requestedAmount } = td;

        const withdrawn = ctx.materialTransfer.pickUp(settler.id, sourceBuildingId, material, requestedAmount, true);

        if (withdrawn === 0) {
            log.warn(`Carrier ${settler.id}: pickup failed at building ${sourceBuildingId}`);
            ctx.eventBus.emit('carrier:pickupFailed', {
                unitId: settler.id,
                material,
                fromBuilding: sourceBuildingId,
                requestedAmount,
                level: 'warn',
            });
            return TaskResult.FAILED;
        }
        job.carryingGood = material;
        td.amount = withdrawn;

        log.debug(`Carrier ${settler.id} picked up ${withdrawn} of ${material} from building ${sourceBuildingId}`);

        ctx.eventBus.emit('carrier:pickupComplete', {
            unitId: settler.id,
            material,
            amount: withdrawn,
            fromBuilding: sourceBuildingId,
        });
    }

    return result;
}

/**
 * Deposit material from the carrier into the targeted slot and handle overflow.
 *
 * Calls `inventoryManager.deposit(slotId, amount)` using the stable slot ID from transportData.
 * If the slot cannot fit all material (overflow), the remainder is dropped as
 * a free pile via `materialTransfer.drop` after adjusting entity.carrying.
 *
 * Returns the amount successfully deposited.
 */
function depositIntoSlot(settler: Entity, slotId: number, ctx: TransportExecutorContext): number {
    if (!settler.carrying) {
        throw new Error(`TransportExecutors.depositIntoSlot: settler ${settler.id} is not carrying anything`);
    }

    const { material, amount } = settler.carrying;
    const deposited = ctx.inventoryManager.deposit(slotId, amount);

    const overflow = amount - deposited;
    if (overflow > 0) {
        // Adjust carrying amount to the overflow so materialTransfer.drop creates
        // a free pile with the correct quantity. clearCarrying is called inside drop.
        settler.carrying = { material, amount: overflow };
        ctx.materialTransfer.drop(settler.id);
    } else {
        clearCarrying(settler);
    }

    return deposited;
}

/**
 * TRANSPORT_DELIVER — deposit material at destination building.
 *
 * First tick: validates job via td.ops.isValid() and starts the dropoff animation.
 * Animation end: deposits via inventoryManager.deposit(slotId) into the targeted slot
 * from transportData, fulfills the transport job. Emits construction:materialDelivered
 * when delivering to a construction site.
 */
export function executeTransportDeliver(
    settler: Entity,
    job: ChoreoJobState,
    node: ChoreoNode,
    dt: number,
    ctx: TransportExecutorContext
): TaskResult {
    if (!job.workStarted) {
        job.workStarted = true;

        const td = requireTransportData(job, 'TRANSPORT_DELIVER');

        if (!td.ops.isValid()) {
            log.debug(`Carrier ${settler.id}: transport job ${td.jobId} no longer exists, dropping material`);
            ctx.materialTransfer.drop(settler.id);
            return TaskResult.FAILED;
        }

        if (!settler.carrying) {
            throw new Error(
                `Carrier ${settler.id}: TRANSPORT_DELIVER called but settler is not carrying anything ` +
                    `(job: material=${td.material})`
            );
        }
    }

    const result = tickDuration(job, dt, resolveInventoryDuration(node));

    if (result === TaskResult.DONE) {
        const td = requireTransportData(job, 'TRANSPORT_DELIVER');
        const { destBuildingId, material, slotId } = td;

        const amount = settler.carrying!.amount;
        const deposited = depositIntoSlot(settler, slotId, ctx);
        td.ops.deliver();

        const overflow = amount - deposited;
        if (overflow > 0) {
            log.warn(`Carrier ${settler.id}: ${overflow} of ${material} overflow at building ${destBuildingId}`);
            ctx.eventBus.emit('construction:materialOverflowed', {
                buildingId: destBuildingId,
                material,
                amount: overflow,
                level: 'warn',
            });
        }

        job.carryingGood = null;

        log.debug(`Carrier ${settler.id} delivered ${deposited} of ${material} to building ${destBuildingId}`);

        ctx.eventBus.emit('carrier:deliveryComplete', {
            unitId: settler.id,
            material,
            amount: deposited,
            toBuilding: destBuildingId,
            overflow,
        });

        if (deposited > 0 && ctx.constructionSiteManager.getSite(destBuildingId)) {
            ctx.eventBus.emit('construction:materialDelivered', {
                buildingId: destBuildingId,
                material,
            });
        }
    }

    return result;
}
