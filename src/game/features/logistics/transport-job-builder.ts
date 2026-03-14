/**
 * TransportJobBuilder — constructs ChoreoJobState for carrier transport deliveries.
 *
 * Moved from SettlerTaskSystem to break the settler-tasks → logistics coupling.
 * The logistics feature builds the full job state (with positions resolved) and
 * passes it to settlerTaskSystem.assignJob() as an opaque job.
 *
 * Uses the fluent ChoreoBuilder instead of XML lookup — the XML choreography
 * (JOB_CARRIER_TRANSPORT_GOOD) was just 4 trivial nodes with no real data.
 */

import { EntityType } from '../../entity';
import { BuildingType } from '../../buildings/building-type';
import { getBuildingDoorPos } from '../../data/game-data-access';
import { ChoreoTaskType, type ChoreoJobState, type TransportOps } from '../../systems/choreo/types';
import { choreo } from '../../systems/choreo/choreo-builder';
import { type TransportJobRecord } from './transport-job-record';
import * as TransportJobService from './transport-job-service';
import type { TransportJobDeps } from './transport-job-service';
import type { TransportJobStore } from './transport-job-store';
import type { GameState } from '../../game-state';
import type { BuildingInventoryManager } from '../../systems/inventory/building-inventory';

/**
 * Resolves source pile positions for carrier transport (output pile at source building).
 * Injected at construction so the builder has no direct dependency on settler-tasks internals.
 */
export interface TransportPositionResolver {
    getSourcePilePosition(buildingId: number, material: string): { x: number; y: number } | null;
}

export interface TransportJobBuilderConfig {
    gameState: GameState;
    positionResolver: TransportPositionResolver;
    inventoryManager: BuildingInventoryManager;
    jobStore: TransportJobStore;
    transportJobDeps: TransportJobDeps;
}

/**
 * Builds ChoreoJobState for carrier transport deliveries.
 *
 * Source pile position (pickup): resolved via positionResolver (output pile at source building).
 * Destination pile position (delivery): read directly from inventoryManager.getSlot(slotId).position.
 *
 * Builds the transport choreography dynamically via ChoreoBuilder.
 */
export class TransportJobBuilder {
    private readonly gameState: GameState;
    private readonly positionResolver: TransportPositionResolver;
    private readonly inventoryManager: BuildingInventoryManager;
    private readonly jobStore: TransportJobStore;
    private readonly transportJobDeps: TransportJobDeps;

    constructor(config: TransportJobBuilderConfig) {
        this.gameState = config.gameState;
        this.positionResolver = config.positionResolver;
        this.inventoryManager = config.inventoryManager;
        this.jobStore = config.jobStore;
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
        // Destination slot's position comes directly from the PileSlot — no resolver indirection
        const destSlot = this.inventoryManager.getSlot(record.slotId);
        if (!destSlot) {
            throw new Error(
                `TransportJobBuilder.build: slot ${record.slotId} not found for job ${record.id} ` +
                    `(dest building ${record.destBuilding}, material ${record.material})`
            );
        }
        const destPos = destSlot.position;

        const job = choreo('JOB_CARRIER_TRANSPORT_GOOD')
            .addNode(ChoreoTaskType.TRANSPORT_GO_TO_SOURCE, { jobPart: 'C_WALK' })
            .addNode(ChoreoTaskType.TRANSPORT_PICKUP, { jobPart: 'C_DOWN_NONE' })
            .addNode(ChoreoTaskType.TRANSPORT_GO_TO_DEST, { jobPart: 'C_WALK' })
            .addNode(ChoreoTaskType.TRANSPORT_DELIVER, { jobPart: 'C_DOWN_NONE' })
            .build();

        // targetPos = first movement destination (source pile), used by assignJob for initial pathfinding
        job.targetPos = sourcePos;
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
            slotId: record.slotId,
            ops,
        };

        job.onCancel = () => {
            const r = this.findRecord(record.id);
            if (r) {
                TransportJobService.cancel(r, 'interrupted', this.transportJobDeps);
            }
        };

        return job;
    }

    /**
     * Find a TransportJobRecord by its job ID, searching both active jobs and pending reservations.
     * Returns undefined if the record no longer exists (cancelled externally).
     */
    private findRecord(jobId: number): TransportJobRecord | undefined {
        for (const record of this.jobStore.jobs.values()) {
            if (record.id === jobId) {
                return record;
            }
        }
        return undefined;
    }

    /** Resolve a source pile position, falling back to building door or entity position. */
    private resolvePilePos(buildingId: number, pile: { x: number; y: number } | null): { x: number; y: number } {
        if (pile) {
            return pile;
        }
        const entity = this.gameState.getEntityOrThrow(buildingId, 'transport building/pile');
        // Free piles: use entity position directly (not a building, no door offset)
        if (entity.type !== EntityType.Building) {
            return entity;
        }
        return getBuildingDoorPos(entity.x, entity.y, entity.race, entity.subType as BuildingType);
    }
}
