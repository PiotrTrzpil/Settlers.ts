/**
 * TransportJobBuilder — constructs ChoreoJobState for carrier transport deliveries.
 *
 * Moved from SettlerTaskSystem to break the settler-tasks → logistics coupling.
 * The logistics feature builds the full job state (with positions resolved) and
 * passes it to settlerTaskSystem.assignJob() as an opaque job.
 *
 * Destination binding is late: the builder resolves a walk-target pile position
 * up front, but the landing slot is chosen at delivery time (depositDelivery),
 * so no slot is reserved or claimed when the job is created.
 */

import { EntityType, Tile } from '../../entity';
import { BuildingType } from '../../buildings/building-type';
import { getBuildingDoorPos } from '../../data/game-data-access';
import { EMaterialType } from '../../economy/material-type';
import { SlotKind } from '../../core/pile-kind';
import { ChoreoTaskType, type ChoreoJobState, type TransportOps } from '../../systems/choreo/types';
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
 *
 * Source pile position (pickup): resolved via positionResolver (output pile at source building).
 * Destination pile position (delivery): best matching slot position at the destination,
 * falling back to the building door.
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
     * Build a ChoreoJobState for a carrier transport delivery.
     * Resolves pile positions and sets up transport data for the choreography executors.
     * Attaches per-job lifecycle closures (TransportOps) and onCancel hook.
     */
    build(record: TransportJobRecord): ChoreoJobState {
        // Source building's output pile = where the carrier picks up
        const sourcePos = this.resolvePilePos(
            record.sourceBuilding,
            this.positionResolver.getSourcePilePosition(record.sourceBuilding, record.material)
        );
        const destPos = this.resolveDestPos(record);

        const job = choreo('JOB_CARRIER_TRANSPORT_GOOD')
            .addNode(ChoreoTaskType.TRANSPORT_GO_TO_SOURCE, { jobPart: 'C_WALK' })
            .addNode(ChoreoTaskType.TRANSPORT_PICKUP, { jobPart: 'C_DOWN_NONE' })
            .addNode(ChoreoTaskType.TRANSPORT_GO_TO_DEST, { jobPart: 'C_WALK' })
            .addNode(ChoreoTaskType.TRANSPORT_DELIVER, { jobPart: 'C_DOWN_NONE' })
            .addNode(ChoreoTaskType.TRANSPORT_STAND_UP, { jobPart: 'C_DOWN_NONE', forward: false })
            .build();

        // targetPos = first movement destination (source pile), used by assignJob for initial pathfinding
        job.targetPos = sourcePos;
        this.attachTransportData(job, record, sourcePos, destPos);

        return job;
    }

    /**
     * Build a delivery-only choreography for a carrier that already picked up material.
     *
     * Used after keyframe restore: PickedUp-phase jobs lose their choreography
     * (choreographies are transient), but the carrier still holds material. This
     * builds a delivery choreo so the carrier resumes without re-visiting the source.
     */
    buildDeliveryOnly(record: TransportJobRecord): ChoreoJobState {
        const destPos = this.resolveDestPos(record);
        const sourcePos = this.resolvePilePos(
            record.sourceBuilding,
            this.positionResolver.getSourcePilePosition(record.sourceBuilding, record.material)
        );

        const job = choreo('JOB_CARRIER_TRANSPORT_GOOD')
            .addNode(ChoreoTaskType.TRANSPORT_GO_TO_DEST, { jobPart: 'C_WALK' })
            .addNode(ChoreoTaskType.TRANSPORT_DELIVER, { jobPart: 'C_DOWN_NONE' })
            .addNode(ChoreoTaskType.TRANSPORT_STAND_UP, { jobPart: 'C_DOWN_NONE', forward: false })
            .build();

        // targetPos = destination pile, used by assignJob for initial pathfinding
        job.targetPos = destPos;
        // Carrier already holds material — reflect that on the choreo job
        job.carryingGood = record.material;
        this.attachTransportData(job, record, sourcePos, destPos);

        return job;
    }

    /**
     * Resolve the walk target at the destination: the pile position where the
     * delivery will most likely land. Order: claimed Storage slot with space,
     * unclaimed Storage slot, Input slot, free-pile slot, building door.
     * Purely positional — the landing slot is re-resolved at delivery time.
     */
    private resolveDestPos(record: TransportJobRecord): Tile {
        const entity = this.gameState.getEntityOrThrow(record.destBuilding, 'transport job destination');
        if (entity.type !== EntityType.Building) {
            // Free piles / non-building entities: walk to the entity itself
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
        const ops: TransportOps = {
            isValid: () => this.findRecord(record.id) !== undefined,
            pickUp: () => {
                const r = this.findRecord(record.id);
                if (!r) {
                    return false;
                }
                TransportJobService.pickUp(r, this.transportJobDeps);
                return true;
            },
            deliver: () => {
                const r = this.findRecord(record.id);
                if (!r) {
                    return false;
                }
                TransportJobService.deliver(r, this.transportJobDeps);
                return true;
            },
        };

        job.transportData = {
            jobId: record.id,
            sourceBuildingId: record.sourceBuilding,
            destBuildingId: record.destBuilding,
            material: record.material,
            amount: record.amount,
            sourcePos,
            destPos,
            ops,
        };

        job.onCancel = () => {
            const r = this.findRecord(record.id);
            if (r) {
                TransportJobService.cancel(r, 'interrupted', this.transportJobDeps);
            }
        };
    }

    /**
     * Find a TransportJobRecord by its job ID.
     * Returns undefined if the record no longer exists (cancelled or delivered).
     */
    private findRecord(jobId: number): TransportJobRecord | undefined {
        return this.transportJobDeps.jobStore.get(jobId);
    }

    /** Resolve a source pile position, falling back to building door or entity position. */
    private resolvePilePos(buildingId: number, pile: Tile | null): Tile {
        if (pile) {
            return pile;
        }
        const entity = this.gameState.getEntityOrThrow(buildingId, 'transport building/pile');
        // Free piles: use entity position directly (not a building, no door offset)
        if (entity.type !== EntityType.Building) {
            return entity;
        }
        return getBuildingDoorPos(entity, entity.race, entity.subType as BuildingType);
    }
}
