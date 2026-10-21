/**
 * Transport JobKind handler — the one owner of carrier transport jobs (JobKind.Transport).
 *
 * A carrier's job is plain data: `ref` = `params.recordId` = its TransportJobRecord id. `build` reads
 * the record and the current world (inventory slot positions, doors), so the same function serves
 * the live assign, the queued follow-up flush and restore after load (no hand-written rebuild).
 *
 * Node layout is always the full leg, so a saved node index means the same node after load:
 *   0 TRANSPORT_GO_TO_SOURCE · 1 TRANSPORT_PICKUP · 2 TRANSPORT_GO_TO_DEST · 3 TRANSPORT_DELIVER · 4 TRANSPORT_STAND_UP
 * Phase decides the leg: Reserved → walk goals for both walks; PickedUp → delivery leg (the source
 * walk has no goal — the pickup is irreversible and `resumeIndex` never resumes before GO_TO_DEST;
 * the source may even be gone by then).
 *
 * Outcomes (called by the job runtime, never via `settler:task*`):
 * - completed → flush the carrier's queued follow-up (promote + assign);
 * - failed / unit removed → discard the active record and the queued follow-up (stock claims
 *   released, deficit re-opens; carried goods are dropped by the runtime / material-transfer).
 *
 * Walk targets are read from inventory slots (PileSlot.position, fixed at slot creation). Destination
 * binding is late: the landing slot is chosen at delivery time (depositDelivery).
 */

import { EntityType, type Tile } from '../../entity';
import { BuildingType } from '../../buildings/building-type';
import { getBuildingDoorPos } from '../../data/game-data-access';
import { EMaterialType } from '../../economy/material-type';
import { SlotKind } from '../../core/pile-kind';
import type { EventBus } from '../../event-bus';
import type { GameState } from '../../game-state';
import {
    ChoreoTaskType,
    JobKind,
    choreo,
    type ChoreoNode,
    type JobBuild,
    type JobKindHandler,
    type JobSpec,
} from '../../systems/choreo';
import type { JobService } from '../settler-tasks';
import type { BuildingInventoryManager } from '../inventory';
import { TransportPhase, type TransportJobRecord } from './transport-job-record';
import type { TransportJobStore } from './transport-job-store';
import * as TransportJobService from './transport-job-service';
import type { TransportJobDeps } from './transport-job-service';

/** Transport job params — a type alias so it is assignable to JobParams. */
export type TransportJobParams = { readonly recordId: number };

/** Display / XML id of every transport job. */
export const TRANSPORT_JOB_ID = 'JOB_CARRIER_TRANSPORT_GOOD';

/** Starts a carrier on a record's transport job (CarrierAssigner, follow-up flush). */
export interface TransportJobAssigner {
    /** Assign the record's job to its carrier. False when the carrier cannot walk to the source. */
    assign(record: TransportJobRecord): boolean;
}

export interface TransportJobKindConfig {
    gameState: GameState;
    eventBus: EventBus;
    inventoryManager: BuildingInventoryManager;
    jobStore: TransportJobStore;
    transportJobDeps: TransportJobDeps;
    jobs: Pick<JobService, 'assign'>;
}

/** Plain tile copy — node goals are data, never live entity references. */
function tileOf(t: Tile): Tile {
    return { x: t.x, y: t.y };
}

export class TransportJobKind implements JobKindHandler<TransportJobParams>, TransportJobAssigner {
    readonly kind = JobKind.Transport;
    readonly persist = true;

    private readonly gameState: GameState;
    private readonly eventBus: EventBus;
    private readonly inventoryManager: BuildingInventoryManager;
    private readonly jobStore: TransportJobStore;
    private readonly deps: TransportJobDeps;
    private readonly jobs: Pick<JobService, 'assign'>;

    constructor(config: TransportJobKindConfig) {
        this.gameState = config.gameState;
        this.eventBus = config.eventBus;
        this.inventoryManager = config.inventoryManager;
        this.jobStore = config.jobStore;
        this.deps = config.transportJobDeps;
        this.jobs = config.jobs;
    }

    // ── Dispatch ────────────────────────────────────────────────

    assign(record: TransportJobRecord): boolean {
        const spec: JobSpec<TransportJobParams> = {
            kind: JobKind.Transport,
            ref: record.id,
            params: { recordId: record.id },
            reserved: false,
        };
        return this.jobs.assign(record.carrierId, spec, { moveTo: this.resolveSourcePos(record) });
    }

    // ── JobKindHandler ──────────────────────────────────────────

    build(unitId: number, params: TransportJobParams): JobBuild {
        const record = this.recordOf(unitId, params, 'build');
        const args = { task: 'transport', recordId: record.id } as const;
        const pickedUp = record.phase === TransportPhase.PickedUp;
        if (!pickedUp && record.phase !== TransportPhase.Reserved) {
            throw new Error(`Transport build: record #${record.id} is '${record.phase}', not active`);
        }
        const sourcePos = pickedUp ? null : tileOf(this.resolveSourcePos(record));
        const destPos = tileOf(this.resolveDestPos(record));

        const sourceWalk: Partial<ChoreoNode> = { jobPart: 'C_WALK', args };
        if (sourcePos) {
            sourceWalk.goal = sourcePos;
        }
        const build = choreo(TRANSPORT_JOB_ID, JobKind.Transport)
            .addNode(ChoreoTaskType.TRANSPORT_GO_TO_SOURCE, sourceWalk)
            .addNode(ChoreoTaskType.TRANSPORT_PICKUP, { jobPart: 'C_DOWN_NONE', args })
            .addNode(ChoreoTaskType.TRANSPORT_GO_TO_DEST, { jobPart: 'C_WALK', args, goal: destPos })
            .addNode(ChoreoTaskType.TRANSPORT_DELIVER, { jobPart: 'C_DOWN_NONE', args })
            .addNode(ChoreoTaskType.TRANSPORT_STAND_UP, { jobPart: 'C_DOWN_NONE', forward: false, args })
            .toJobBuild();
        return {
            ...build,
            targetPos: sourcePos ?? destPos,
            carryingGood: pickedUp ? record.material : null,
        };
    }

    /** The record must still be this carrier's active job; a PickedUp carrier must still carry it. */
    restorable(unitId: number, _ref: number, params: TransportJobParams): boolean {
        // Nullable by design: a record cancelled / delivered before the save is simply gone.
        const record = this.jobStore.get(params.recordId);
        if (!record || record.carrierId !== unitId) {
            return false;
        }
        if (record.phase === TransportPhase.Reserved) {
            return true;
        }
        const carrier = this.gameState.getEntityOrThrow(unitId, 'restored transport carrier');
        return (
            record.phase === TransportPhase.PickedUp &&
            carrier.carrying !== undefined &&
            carrier.carrying.material === record.material
        );
    }

    /** After the pickup, resume no earlier than the walk to the destination. */
    resumeIndex(
        unitId: number,
        _ref: number,
        params: TransportJobParams,
        snappedIndex: number,
        nodes: readonly ChoreoNode[]
    ): number | null {
        const record = this.recordOf(unitId, params, 'resumeIndex');
        if (record.phase !== TransportPhase.PickedUp) {
            return snappedIndex;
        }
        const destWalk = nodes.findIndex(n => n.task === ChoreoTaskType.TRANSPORT_GO_TO_DEST);
        return Math.max(snappedIndex, destWalk);
    }

    onCompleted(unitId: number): void {
        this.flushQueued(unitId);
    }

    onFailed(unitId: number, ref: number): void {
        this.releaseCarrier(unitId, ref, 'job_failed');
    }

    onUnitRemoved(unitId: number, ref: number): void {
        this.releaseCarrier(unitId, ref, 'carrier_removed');
    }

    // ── Internal ────────────────────────────────────────────────

    /**
     * The carrier's job ended without completing: discard its record (still there unless it was
     * delivered before a failure during the stand-up) and its queued follow-up.
     */
    private releaseCarrier(unitId: number, ref: number, reason: string): void {
        // Nullable by design: the record is already gone after delivery / a restore of a stale save.
        const record = this.jobStore.get(ref);
        if (record) {
            TransportJobService.discard(record, reason, this.deps);
        }
        const queued = this.jobStore.getQueuedJobForCarrier(unitId);
        if (queued) {
            TransportJobService.discard(queued, reason, this.deps);
        }
    }

    /**
     * Activate the queued follow-up of a carrier that just finished its transport. The job is built
     * now (not at queue time), so positions reflect the current world state.
     */
    private flushQueued(carrierId: number): void {
        const record = this.jobStore.getQueuedJobForCarrier(carrierId);
        if (!record) {
            return;
        }
        TransportJobService.promoteQueued(record, this.deps);
        const success = this.assign(record);
        if (!success) {
            // Movement blocked — cancel; the deficit re-opens.
            TransportJobService.cancel(record, 'assignment_failed', this.deps);
        }
        this.eventBus.emit('logistics:preAssignFlushed', {
            carrierId,
            jobId: record.id,
            success,
            reason: success ? undefined : 'assignment_failed',
        });
    }

    private recordOf(unitId: number, params: TransportJobParams, context: string): TransportJobRecord {
        const record = this.jobStore.getOrThrow(params.recordId, `TransportJobKind.${context}`);
        if (record.carrierId !== unitId) {
            throw new Error(
                `Transport ${context}: record #${record.id} belongs to carrier ${record.carrierId}, not ${unitId}`
            );
        }
        return record;
    }

    /**
     * Pickup walk target: the source's OUTPUT-side pile of the material (production output,
     * or storage / free pile holding it). When no pile currently holds it, walk to the door.
     */
    private resolveSourcePos(record: TransportJobRecord): Tile {
        const pile = this.inventoryManager.findPileSlot(record.sourceBuilding, record.material, SlotKind.Output);
        if (pile) {
            return pile.position;
        }
        return this.doorOrEntityPos(record.sourceBuilding);
    }

    /**
     * Walk target at the destination: claimed Storage → unclaimed Storage → Input → door.
     * Purely positional — the landing slot is re-resolved at delivery time.
     */
    private resolveDestPos(record: TransportJobRecord): Tile {
        const entity = this.gameState.getEntityOrThrow(record.destBuilding, 'transport job destination');
        if (entity.type !== EntityType.Building) {
            return entity;
        }
        const im = this.inventoryManager;
        const slot =
            im.findSlot(record.destBuilding, record.material, SlotKind.Storage) ??
            im.findSlot(record.destBuilding, EMaterialType.NO_MATERIAL, SlotKind.Storage) ??
            im.findSlot(record.destBuilding, record.material, SlotKind.Input);
        if (slot) {
            return slot.position;
        }
        // Game rule: no pile with space for this material (all full, or none defined for it) —
        // carriers deliver at the door; depositDelivery picks the landing slot or drops a free pile.
        return getBuildingDoorPos(entity, entity.race, entity.subType as BuildingType);
    }

    /** Door of a building, or the entity's own tile for non-building sources (free piles). */
    private doorOrEntityPos(buildingId: number): Tile {
        const entity = this.gameState.getEntityOrThrow(buildingId, 'transport building/pile');
        if (entity.type !== EntityType.Building) {
            return entity;
        }
        return getBuildingDoorPos(entity, entity.race, entity.subType as BuildingType);
    }
}
