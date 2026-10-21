/**
 * Transport-specific choreography executors for carrier delivery jobs (JobKind.Transport).
 *
 * Nodes carry `args: { task: 'transport', recordId }`; walks carry their `goal`. Everything else
 * (buildings, material, amount, phase) is read from the TransportJobRecord. While a Transport job
 * runs, its record exists: every record cancel ends the job first (TransportJobService.cancel),
 * so a missing record here is a bug and throws.
 */

import type { Entity } from '../../../entity';
import { clearCarrying } from '../../../entity';
import { createLogger } from '@/utilities/logger';
import { TaskResult, framesToSeconds, tickDuration } from '../../../systems/choreo/types';
import type { ChoreoJobState, ChoreoNode } from '../../../systems/choreo/types';
import type { Tile } from '../../../core/coordinates';
import type { MovementContext } from '../../settler-tasks';
import type { TransportExecutorContext } from './transport-executor-context';
import { moveToPosition } from '../../settler-tasks/internal/movement-executors';
import * as TransportJobService from '../transport-job-service';
import { TransportPhase, type TransportJobRecord } from '../transport-job-record';

const log = createLogger('TransportExecutors');

const ARRIVAL_DIST_EXACT = 0;
const DEFAULT_INVENTORY_CYCLE_FRAMES = 5;

function resolveInventoryDuration(node: ChoreoNode): number {
    if (node.duration === 0) {
        return framesToSeconds(DEFAULT_INVENTORY_CYCLE_FRAMES);
    }
    if (node.duration <= 0) {
        return 0;
    }
    return framesToSeconds(node.duration);
}

/** Record id from the node args — only TRANSPORT_* nodes built by the Transport handler run here. */
function recordIdOf(node: ChoreoNode, context: string): number {
    const args = node.args;
    if (!args || args.task !== 'transport') {
        throw new Error(`${context}: node has no transport args — only use TRANSPORT_* nodes in Transport jobs`);
    }
    return args.recordId;
}

/** The node's transport record (exists while its Transport job runs — see file header). */
function recordOf(ctx: TransportExecutorContext, node: ChoreoNode, context: string): TransportJobRecord {
    return ctx.jobStore.getOrThrow(recordIdOf(node, context), context);
}

function goalOf(node: ChoreoNode, context: string): Tile {
    if (!node.goal) {
        throw new Error(`${context}: walk node has no goal (record #${recordIdOf(node, context)})`);
    }
    return node.goal;
}

// ─────────────────────────────────────────────────────────────
// Movement executors
// ─────────────────────────────────────────────────────────────

export function executeTransportGoToSource(
    settler: Entity,
    job: ChoreoJobState,
    node: ChoreoNode,
    _dt: number,
    ctx: MovementContext
): TaskResult {
    const goal = goalOf(node, 'TRANSPORT_GO_TO_SOURCE');
    return moveToPosition(settler, goal.x, goal.y, node, ctx, ARRIVAL_DIST_EXACT, job);
}

export function executeTransportGoToDest(
    settler: Entity,
    job: ChoreoJobState,
    node: ChoreoNode,
    _dt: number,
    ctx: MovementContext
): TaskResult {
    const goal = goalOf(node, 'TRANSPORT_GO_TO_DEST');
    return moveToPosition(settler, goal.x, goal.y, node, ctx, ARRIVAL_DIST_EXACT, job);
}

// ─────────────────────────────────────────────────────────────
// Inventory executors
// ─────────────────────────────────────────────────────────────

/**
 * TRANSPORT_PICKUP — withdraw material from source building.
 * Phase stays Reserved during animation so getReservedAmount still counts this job.
 */
export function executeTransportPickup(
    settler: Entity,
    job: ChoreoJobState,
    node: ChoreoNode,
    dt: number,
    ctx: TransportExecutorContext
): TaskResult {
    job.workStarted = true;
    const result = tickDuration(job, dt, resolveInventoryDuration(node));
    if (result !== TaskResult.DONE) {
        return result;
    }

    const record = recordOf(ctx, node, 'TRANSPORT_PICKUP');
    if (record.phase !== TransportPhase.Reserved) {
        throw new Error(`TRANSPORT_PICKUP: record #${record.id} is '${record.phase}', expected 'reserved'`);
    }
    TransportJobService.pickUp(record, ctx.transportJobDeps);

    const { material, sourceBuilding, amount: requestedAmount } = record;
    const withdrawn = ctx.materialTransfer.pickUpOutput(settler.id, sourceBuilding, material, requestedAmount);
    if (withdrawn === 0) {
        // The job fails; the Transport handler's onFailed discards the record (nothing is carried).
        log.warn(`Carrier ${settler.id}: pickup failed at building ${sourceBuilding}`);
        ctx.eventBus.emit('carrier:pickupFailed', {
            unitId: settler.id,
            material,
            fromBuilding: sourceBuilding,
            requestedAmount,
            level: 'warn',
        });
        return TaskResult.FAILED;
    }
    job.carryingGood = material;

    log.debug(`Carrier ${settler.id} picked up ${withdrawn} of ${material} from building ${sourceBuilding}`);
    ctx.eventBus.emit('carrier:pickupComplete', {
        unitId: settler.id,
        material,
        amount: withdrawn,
        fromBuilding: sourceBuilding,
    });
    return result;
}

function depositIntoBuilding(settler: Entity, buildingId: number, ctx: TransportExecutorContext): number {
    if (!settler.carrying) {
        throw new Error(`TransportExecutors.depositIntoBuilding: settler ${settler.id} is not carrying anything`);
    }

    const { material, amount } = settler.carrying;
    const deposited = ctx.inventoryManager.depositDelivery(buildingId, material, amount);

    const overflow = amount - deposited;
    if (overflow > 0) {
        settler.carrying = { material, amount: overflow };
        ctx.materialTransfer.drop(settler.id);
    } else {
        clearCarrying(settler);
    }

    return deposited;
}

/**
 * TRANSPORT_DELIVER — deposit material at destination building.
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
        if (!settler.carrying) {
            throw new Error(
                `Carrier ${settler.id}: TRANSPORT_DELIVER called but settler is not carrying anything ` +
                    `(record #${recordIdOf(node, 'TRANSPORT_DELIVER')})`
            );
        }
    }

    const result = tickDuration(job, dt, resolveInventoryDuration(node));
    if (result !== TaskResult.DONE) {
        return result;
    }

    const record = recordOf(ctx, node, 'TRANSPORT_DELIVER');
    const { destBuilding, material } = record;
    const amount = settler.carrying!.amount;
    const deposited = depositIntoBuilding(settler, destBuilding, ctx);
    TransportJobService.deliver(record, ctx.transportJobDeps);

    const overflow = amount - deposited;
    if (overflow > 0) {
        log.warn(`Carrier ${settler.id}: ${overflow} of ${material} overflow at building ${destBuilding}`);
        ctx.eventBus.emit('construction:materialOverflowed', {
            buildingId: destBuilding,
            material,
            amount: overflow,
            level: 'warn',
        });
    }

    job.carryingGood = null;

    log.debug(`Carrier ${settler.id} delivered ${deposited} of ${material} to building ${destBuilding}`);

    ctx.eventBus.emit('carrier:deliveryComplete', {
        unitId: settler.id,
        material,
        amount: deposited,
        toBuilding: destBuilding,
        overflow,
    });

    if (deposited > 0 && ctx.constructionSiteManager.getSite(destBuilding)) {
        ctx.eventBus.emit('construction:materialDelivered', {
            buildingId: destBuilding,
            material,
        });
    }
    return result;
}

export function executeTransportStandUp(
    _settler: Entity,
    job: ChoreoJobState,
    node: ChoreoNode,
    dt: number
): TaskResult {
    return tickDuration(job, dt, resolveInventoryDuration(node));
}
