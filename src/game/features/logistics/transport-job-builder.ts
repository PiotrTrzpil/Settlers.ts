/**
 * TransportJobBuilder — constructs ChoreoJobState for carrier transport deliveries.
 *
 * The logistics feature builds the full job state (with positions resolved) and
 * passes it to TaskDispatcher.assignJob() as an opaque job.
 *
 * transportData is pure data (ids + positions). Lifecycle ops run in transport
 * executors via TransportJobStore + TransportJobService. onCancel still cancels
 * the store record when the choreo is interrupted (thin store lookup only).
 *
 * Destination binding is late: walk-target pile resolved up front; landing slot
 * chosen at delivery time (depositDelivery).
 */

import { EntityType, Tile } from '../../entity';
import { BuildingType } from '../../buildings/building-type';
import { getBuildingDoorPos } from '../../data/game-data-access';
import { EMaterialType } from '../../economy/material-type';
import { SlotKind } from '../../core/pile-kind';
import { ChoreoTaskType, JobKind, type ChoreoJobState } from '../../systems/choreo/types';
import { choreo } from '../../systems/choreo/choreo-builder';
import { type TransportJobRecord } from './transport-job-record';
import * as TransportJobService from './transport-job-service';
import type { TransportJobDeps } from './transport-job-service';
import type { GameState } from '../../game-state';
import type { BuildingInventoryManager } from '../../systems/inventory/building-inventory';

/**
 * Resolves source pile positions for carrier transport (output pile at source building).
 * Injected at construction so the builder has no direct dependency on settler-tasks internals.
 */
export interface TransportPositionResolver {
    getSourcePilePosition(buildingId: number, material: string): Tile | null;
}

export interface TransportJobBuilderConfig {
    gameState: GameState;
    positionResolver: TransportPositionResolver;
    inventoryManager: BuildingInventoryManager;
    transportJobDeps: TransportJobDeps;
}

/**
 * Builds ChoreoJobState for carrier transport deliveries.
 */
export class TransportJobBuilder {
    private readonly gameState: GameState;
    private readonly positionResolver: TransportPositionResolver;
    private readonly inventoryManager: BuildingInventoryManager;
    private readonly transportJobDeps: TransportJobDeps;

    constructor(config: TransportJobBuilderConfig) {
        this.gameState = config.gameState;
        this.positionResolver = config.positionResolver;
        this.inventoryManager = config.inventoryManager;
        this.transportJobDeps = config.transportJobDeps;
    }

    /**
     * Build a ChoreoJobState for a full carrier transport (source → dest).
     */
    build(record: TransportJobRecord): ChoreoJobState {
        const sourcePos = this.resolvePilePos(
            record.sourceBuilding,
            this.positionResolver.getSourcePilePosition(record.sourceBuilding, record.material)
        );
        const destPos = this.resolveDestPos(record);

        const job = choreo('JOB_CARRIER_TRANSPORT_GOOD', JobKind.Transport)
            .addNode(ChoreoTaskType.TRANSPORT_GO_TO_SOURCE, { jobPart: 'C_WALK' })
            .addNode(ChoreoTaskType.TRANSPORT_PICKUP, { jobPart: 'C_DOWN_NONE' })
            .addNode(ChoreoTaskType.TRANSPORT_GO_TO_DEST, { jobPart: 'C_WALK' })
            .addNode(ChoreoTaskType.TRANSPORT_DELIVER, { jobPart: 'C_DOWN_NONE' })
            .addNode(ChoreoTaskType.TRANSPORT_STAND_UP, { jobPart: 'C_DOWN_NONE', forward: false })
            .build();

        job.targetPos = sourcePos;
        this.attachTransportData(job, record, sourcePos, destPos);
        return job;
    }

    /**
     * Build a delivery-only choreography for a carrier that already picked up material.
     * Used after keyframe restore for PickedUp-phase jobs.
     */
    buildDeliveryOnly(record: TransportJobRecord): ChoreoJobState {
        const destPos = this.resolveDestPos(record);
        const sourcePos = this.resolvePilePos(
            record.sourceBuilding,
            this.positionResolver.getSourcePilePosition(record.sourceBuilding, record.material)
        );

        const job = choreo('JOB_CARRIER_TRANSPORT_GOOD', JobKind.Transport)
            .addNode(ChoreoTaskType.TRANSPORT_GO_TO_DEST, { jobPart: 'C_WALK' })
            .addNode(ChoreoTaskType.TRANSPORT_DELIVER, { jobPart: 'C_DOWN_NONE' })
            .addNode(ChoreoTaskType.TRANSPORT_STAND_UP, { jobPart: 'C_DOWN_NONE', forward: false })
            .build();

        job.targetPos = destPos;
        job.carryingGood = record.material;
        this.attachTransportData(job, record, sourcePos, destPos);
        return job;
    }

    /**
     * Resolve walk target at destination: claimed Storage → unclaimed Storage → Input → door.
     * Purely positional — landing slot re-resolved at delivery time.
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
        return getBuildingDoorPos(entity, entity.race, entity.subType as BuildingType);
    }

    private attachTransportData(job: ChoreoJobState, record: TransportJobRecord, sourcePos: Tile, destPos: Tile): void {
        // Pure data — executors look up TransportJobStore by jobId.
        job.transportData = {
            jobId: record.id,
            sourceBuildingId: record.sourceBuilding,
            destBuildingId: record.destBuilding,
            material: record.material,
            amount: record.amount,
            sourcePos,
            destPos,
        };

        // Interrupt path: cancel store record if still live (lifecycle owns entity.jobId clear).
        const deps = this.transportJobDeps;
        const jobId = record.id;
        job.onCancel = () => {
            const r = deps.jobStore.get(jobId);
            if (r) {
                TransportJobService.cancel(r, 'interrupted', deps);
            }
        };
    }

    private resolvePilePos(buildingId: number, pile: Tile | null): Tile {
        if (pile) {
            return pile;
        }
        const entity = this.gameState.getEntityOrThrow(buildingId, 'transport building/pile');
        if (entity.type !== EntityType.Building) {
            return entity;
        }
        return getBuildingDoorPos(entity, entity.race, entity.subType as BuildingType);
    }
}
