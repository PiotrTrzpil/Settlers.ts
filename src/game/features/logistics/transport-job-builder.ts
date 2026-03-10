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

import { EMaterialType } from '../../economy';
import { EntityType } from '../../entity';
import { BuildingType } from '../../buildings/building-type';
import { getBuildingDoorPos } from '../../data/game-data-access';
import { ChoreoTaskType } from '../../systems/choreo/types';
import { choreo } from '../../systems/choreo/choreo-builder';
import type { JobState } from '../settler-tasks/types';
import type { TransportJobRecord } from './transport-job-record';
import type { GameState } from '../../game-state';

/**
 * Resolves pile positions for carrier transport (subset of BuildingPositionResolver).
 * Injected at construction so the builder has no direct dependency on settler-tasks internals.
 */
export interface TransportPositionResolver {
    getSourcePilePosition(buildingId: number, material: string): { x: number; y: number } | null;
    getDestinationPilePosition(buildingId: number, material: string): { x: number; y: number } | null;
}

export interface TransportJobBuilderConfig {
    gameState: GameState;
    positionResolver: TransportPositionResolver;
}

/**
 * Builds ChoreoJobState for carrier transport deliveries.
 *
 * Resolves pile positions (output pile at source, input pile at dest) via the
 * position resolver, falling back to building door. Builds the transport
 * choreography dynamically via ChoreoBuilder.
 */
export class TransportJobBuilder {
    private readonly gameState: GameState;
    private readonly positionResolver: TransportPositionResolver;

    constructor(config: TransportJobBuilderConfig) {
        this.gameState = config.gameState;
        this.positionResolver = config.positionResolver;
    }

    /**
     * Build a ChoreoJobState for a carrier transport delivery.
     * Resolves pile positions and sets up transport data for the choreography executors.
     */
    build(record: TransportJobRecord): JobState {
        const materialName = EMaterialType[record.material];
        // Source building's output pile = where the carrier picks up
        const sourcePos = this.resolvePilePos(
            record.sourceBuilding, this.positionResolver.getDestinationPilePosition(record.sourceBuilding, materialName)
        );
        // Dest building's input pile = where the carrier delivers
        const destPos = this.resolvePilePos(
            record.destBuilding, this.positionResolver.getSourcePilePosition(record.destBuilding, materialName)
        );

        const job = choreo('JOB_CARRIER_TRANSPORT_GOOD')
            .addNode(ChoreoTaskType.TRANSPORT_GO_TO_SOURCE, { jobPart: 'C_WALK' })
            .addNode(ChoreoTaskType.TRANSPORT_PICKUP, { jobPart: 'C_DOWN_NONE' })
            .addNode(ChoreoTaskType.TRANSPORT_GO_TO_DEST, { jobPart: 'C_WALK' })
            .addNode(ChoreoTaskType.TRANSPORT_DELIVER, { jobPart: 'C_DOWN_NONE' })
            .build();

        // targetPos = first movement destination (source pile), used by assignJob for initial pathfinding
        job.targetPos = sourcePos;
        job.transportData = {
            jobId: record.id,
            sourceBuildingId: record.sourceBuilding,
            destBuildingId: record.destBuilding,
            material: record.material,
            amount: record.amount,
            sourcePos,
            destPos,
        };

        return job;
    }

    /** Resolve a pile position, falling back to building door or entity position. */
    private resolvePilePos(
        buildingId: number,
        pile: { x: number; y: number } | null
    ): { x: number; y: number } {
        if (pile) return pile;
        const entity = this.gameState.getEntityOrThrow(buildingId, 'transport building/pile');
        // Free piles: use entity position directly (not a building, no door offset)
        if (entity.type !== EntityType.Building) return entity;
        return getBuildingDoorPos(entity.x, entity.y, entity.race, entity.subType as BuildingType);
    }
}
