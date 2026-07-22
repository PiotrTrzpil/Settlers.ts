/**
 * Transport-specific choreography executors for carrier delivery jobs.
 *
 * Lifecycle uses TransportJobStore + TransportJobService via context (pure transportData).
 */

import type { Entity } from '../../../entity';
import { clearCarrying } from '../../../entity';
import { createLogger } from '@/utilities/logger';
import { TaskResult, framesToSeconds, tickDuration } from '../../../systems/choreo/types';
import type { ChoreoJobState, ChoreoNode, TransportData } from '../../../systems/choreo/types';
import type { MovementContext } from '../../settler-tasks';
import type { TransportExecutorContext } from './transport-executor-context';
import { moveToPosition } from '../../settler-tasks/internal/movement-executors';
import * as TransportJobService from '../transport-job-service';
import { TransportPhase } from '../transport-job-record';

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

function requireTransportData(job: ChoreoJobState, context: string): TransportData {
    if (!job.transportData) {
        throw new Error(
            `${context}: job '${job.jobId}' has no transportData — only use TRANSPORT_* nodes in carrier jobs`
        );
    }
    return job.transportData;
}

/** True when the transport record still exists in the store. */
function isJobLive(ctx: TransportExecutorContext, jobId: number): boolean {
    return ctx.jobStore.get(jobId) !== undefined;
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
    const td = requireTransportData(job, 'TRANSPORT_GO_TO_SOURCE');
    return moveToPosition(settler, td.sourcePos.x, td.sourcePos.y, node, ctx, ARRIVAL_DIST_EXACT, job);
}

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
 * Phase stays Reserved during animation so getReservedAmount still counts this job.
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
        if (!isJobLive(ctx, td.jobId)) {
            log.debug(`Carrier ${settler.id}: transport job ${td.jobId} no longer exists, aborting pickup`);
            return TaskResult.FAILED;
        }
    }

    const result = tickDuration(job, dt, resolveInventoryDuration(node));

    if (result === TaskResult.DONE) {
        const td = requireTransportData(job, 'TRANSPORT_PICKUP');
        const record = ctx.jobStore.get(td.jobId);
        if (!record || record.phase !== TransportPhase.Reserved) {
            log.debug(`Carrier ${settler.id}: transport job ${td.jobId} cancelled during pickup animation`);
            return TaskResult.FAILED;
        }

        TransportJobService.pickUp(record, ctx.transportJobDeps);

        const { material, sourceBuildingId, amount: requestedAmount } = td;
        const withdrawn = ctx.materialTransfer.pickUpOutput(settler.id, sourceBuildingId, material, requestedAmount);

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
        const td = requireTransportData(job, 'TRANSPORT_DELIVER');

        if (!isJobLive(ctx, td.jobId)) {
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
        const { destBuildingId, material } = td;

        const amount = settler.carrying!.amount;
        const deposited = depositIntoBuilding(settler, destBuildingId, ctx);

        const record = ctx.jobStore.get(td.jobId);
        if (record && record.phase === TransportPhase.PickedUp) {
            TransportJobService.deliver(record, ctx.transportJobDeps);
        }

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

export function executeTransportStandUp(
    _settler: Entity,
    job: ChoreoJobState,
    node: ChoreoNode,
    dt: number
): TaskResult {
    return tickDuration(job, dt, resolveInventoryDuration(node));
}
