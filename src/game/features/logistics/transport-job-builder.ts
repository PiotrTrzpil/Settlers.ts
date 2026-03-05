/**
 * TransportJobBuilder — constructs ChoreoJobState for carrier transport deliveries.
 *
 * Moved from SettlerTaskSystem to break the settler-tasks → logistics coupling.
 * The logistics feature builds the full job state (with positions resolved) and
 * passes it to settlerTaskSystem.assignJob() as an opaque job.
 */

import { EMaterialType } from '../../economy';
import { EntityType } from '../../entity';
import { BuildingType } from '../../buildings/building-type';
import { raceToRaceId, getBuildingDoorPos } from '../../game-data-access';
import { createChoreoJobState, type ChoreoJob } from '../settler-tasks/choreo-types';
import type { JobState } from '../settler-tasks/types';
import type { TransportJob } from './transport-job';
import type { GameState } from '../../game-state';
import type { RaceId } from '@/resources/game-data/types';

/**
 * Resolves pile positions for carrier transport (subset of BuildingPositionResolver).
 * Injected at construction so the builder has no direct dependency on settler-tasks internals.
 */
export interface TransportPositionResolver {
    getSourcePilePosition(buildingId: number, material: string): { x: number; y: number } | null;
    getDestinationPilePosition(buildingId: number, material: string): { x: number; y: number } | null;
}

/**
 * Looks up choreography job definitions by race and job ID.
 * Injected at construction so the builder has no direct dependency on JobChoreographyStore.
 */
export interface ChoreographyLookup {
    getJob(raceId: RaceId, jobId: string): ChoreoJob | undefined;
}

export interface TransportJobBuilderConfig {
    gameState: GameState;
    positionResolver: TransportPositionResolver;
    choreographyLookup: ChoreographyLookup;
}

/**
 * Builds ChoreoJobState for carrier transport deliveries.
 *
 * Resolves pile positions (output pile at source, input pile at dest) via the
 * position resolver, falling back to building door. Looks up the carrier transport
 * choreography from XML data.
 */
export class TransportJobBuilder {
    private readonly gameState: GameState;
    private readonly positionResolver: TransportPositionResolver;
    private readonly choreographyLookup: ChoreographyLookup;

    constructor(config: TransportJobBuilderConfig) {
        this.gameState = config.gameState;
        this.positionResolver = config.positionResolver;
        this.choreographyLookup = config.choreographyLookup;
    }

    /**
     * Build a ChoreoJobState for a carrier transport delivery.
     * Resolves pile positions and sets up transport data for the choreography executors.
     */
    build(transportJob: TransportJob, carrierId: number): JobState {
        const sourcePos = this.resolveTransportPos(transportJob.sourceBuilding, transportJob.material, 'output');
        const destPos = this.resolveTransportPos(transportJob.destBuilding, transportJob.material, 'input');

        const carrier = this.gameState.getEntityOrThrow(carrierId, 'transport carrier');
        const raceId = raceToRaceId(carrier.race);
        const xmlJob = this.choreographyLookup.getJob(raceId, 'JOB_CARRIER_TRANSPORT_GOOD');
        if (!xmlJob) {
            throw new Error(`JOB_CARRIER_TRANSPORT_GOOD not found for race ${raceId}`);
        }

        const job = createChoreoJobState(xmlJob.id, structuredClone(xmlJob.nodes));
        job.transportData = {
            transportJob,
            sourceBuildingId: transportJob.sourceBuilding,
            destBuildingId: transportJob.destBuilding,
            material: transportJob.material,
            amount: transportJob.amount,
            sourcePos,
            destPos,
        };

        return job;
    }

    /**
     * Resolve a pile position for a carrier transport (output pile for pickup, input pile for delivery).
     * Falls back to building door when no pile is defined in the building config.
     */
    private resolveTransportPos(
        buildingId: number,
        material: EMaterialType,
        slotType: 'input' | 'output'
    ): { x: number; y: number } {
        const materialName = EMaterialType[material];
        const pile =
            slotType === 'input'
                ? this.positionResolver.getSourcePilePosition(buildingId, materialName)
                : this.positionResolver.getDestinationPilePosition(buildingId, materialName);
        if (pile) return pile;
        const entity = this.gameState.getEntityOrThrow(buildingId, 'transport building/pile');
        // Free piles: use entity position directly (not a building, no door offset)
        if (entity.type !== EntityType.Building) return entity;
        return getBuildingDoorPos(entity.x, entity.y, entity.race, entity.subType as BuildingType);
    }
}
