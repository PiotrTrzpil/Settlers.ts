/**
 * CarrierAssigner
 *
 * Finds available carriers for transport jobs and assigns them.
 *
 * Handles the two-phase carrier search:
 * 1. Try carriers from hubs that cover both source and destination (zone-optimal)
 * 2. In global mode, fall back to any remaining player hub
 */

import type { GameState } from '../../game-state';
import type { CoreDeps } from '../feature';
import type { EventBus } from '../../event-bus';
import type { CarrierRegistry } from '../carriers';
import type { TransportJobRecord } from './transport-job-record';
import * as TransportJobService from './transport-job-service';
import type { TransportJobDeps } from './transport-job-service';
import type { InventoryReservationManager } from './inventory-reservation';
import type { RequestManager } from './request-manager';
import type { RequestMatchResult } from './request-matcher';
import type { ResourceRequest } from './resource-request';
import type { TransportJobBuilder } from './transport-job-builder';
import type { JobState } from '../settler-tasks/types';
import { hexDistance } from '../../systems/hex-directions';
import type { CarrierFilter } from './logistics-filter';
import { query } from '../../ecs';
import type { InFlightTracker } from './in-flight-tracker';

/** Assigns a job to a settler and optionally starts movement. */
export interface JobAssigner {
    assignJob(entityId: number, job: JobState, moveTo?: { x: number; y: number }): boolean;
}

export interface CarrierAssignerConfig extends CoreDeps {
    carrierRegistry: CarrierRegistry;
    jobAssigner: JobAssigner;
    transportJobBuilder: TransportJobBuilder;
    reservationManager: InventoryReservationManager;
    requestManager: RequestManager;
    inFlightTracker: InFlightTracker;
    carrierFilter?: CarrierFilter;
    activeJobs: ReadonlyMap<number, unknown>;
}

/** Result of a successful carrier assignment. */
export interface AssignmentSuccess {
    /** The created transport job record. */
    record: TransportJobRecord;
    /** Entity ID of the carrier that was assigned. */
    carrierId: number;
}

/** Result of tryAssign / tryAssignBest — success, no carrier available, or hard failure. */
export type AssignResult = AssignmentSuccess | 'no_carrier' | null;

/**
 * Assigns available carriers to matched transport requests.
 *
 * Creates TransportJob instances that own the reservation and request lifecycle,
 * then assigns the carrier task to fulfill the job.
 */
export class CarrierAssigner {
    private readonly gameState: GameState;
    private readonly eventBus: EventBus;
    private readonly carrierRegistry: CarrierRegistry;
    private readonly jobAssigner: JobAssigner;
    private readonly transportJobBuilder: TransportJobBuilder;
    private readonly reservationManager: InventoryReservationManager;
    private readonly requestManager: RequestManager;
    private readonly activeJobs: ReadonlyMap<number, unknown>;
    private readonly transportJobDeps: TransportJobDeps;
    carrierFilter: CarrierFilter | null;

    constructor(config: CarrierAssignerConfig) {
        this.gameState = config.gameState;
        this.eventBus = config.eventBus;
        this.carrierRegistry = config.carrierRegistry;
        this.jobAssigner = config.jobAssigner;
        this.transportJobBuilder = config.transportJobBuilder;
        this.reservationManager = config.reservationManager;
        this.requestManager = config.requestManager;
        this.activeJobs = config.activeJobs;
        this.transportJobDeps = {
            reservationManager: this.reservationManager,
            requestManager: this.requestManager,
            eventBus: this.eventBus,
            inFlightTracker: config.inFlightTracker,
        };
        this.carrierFilter = config.carrierFilter ?? null;
    }

    /**
     * Try to assign a carrier to fulfill a matched request (single candidate).
     *
     * @returns AssignmentSuccess on success, `'no_carrier'` when all carriers are busy, or null on hard failure.
     */
    tryAssign(request: ResourceRequest, match: RequestMatchResult): AssignResult {
        return this.tryAssignMatch(request, match);
    }

    /**
     * Try to assign the best (carrier, source) pair from multiple supply candidates.
     * Picks the pair with the lowest total trip distance: carrier→source + source→dest.
     *
     * Falls back to single-match behavior if only one candidate.
     */
    // eslint-disable-next-line sonarjs/function-return-type -- discriminated union return is intentional
    tryAssignBest(request: ResourceRequest, candidates: readonly RequestMatchResult[]): AssignResult {
        if (candidates.length === 0) return null;
        if (candidates.length === 1) return this.tryAssignMatch(request, candidates[0]!);

        const destBuilding = this.gameState.getEntityOrThrow(request.buildingId, 'dest building');
        const ranked = this.rankByTotalTrip(candidates, destBuilding.x, destBuilding.y);
        if (!ranked) return 'no_carrier';

        return this.tryAssignMatch(request, ranked.match);
    }

    /**
     * Rank supply candidates by total trip distance (carrier→source + source→dest).
     * Returns the best candidate+carrier pair, or null if no carrier is available.
     */
    private rankByTotalTrip(
        candidates: readonly RequestMatchResult[],
        destX: number,
        destY: number
    ): { match: RequestMatchResult } | null {
        let bestMatch: RequestMatchResult | null = null;
        let bestTotal = Infinity;

        for (const candidate of candidates) {
            const source = this.gameState.getEntity(candidate.sourceBuilding);
            if (!source) continue;

            const carrier = this.findAvailableCarrier(source.x, source.y, candidate.playerId);
            if (!carrier) continue;

            const carrierEntity = this.gameState.getEntityOrThrow(carrier.entityId, 'carrier');
            const carrierToSource = hexDistance(carrierEntity.x, carrierEntity.y, source.x, source.y);
            const sourceToDest = hexDistance(source.x, source.y, destX, destY);
            const total = carrierToSource + sourceToDest;

            if (total < bestTotal) {
                bestTotal = total;
                bestMatch = candidate;
            }
        }

        return bestMatch ? { match: bestMatch } : null;
    }

    // eslint-disable-next-line sonarjs/function-return-type -- discriminated union return is intentional
    private tryAssignMatch(request: ResourceRequest, match: RequestMatchResult): AssignResult {
        const sourceBuilding = this.gameState.getEntityOrThrow(match.sourceBuilding, 'carrier source building');
        const carrier = this.findAvailableCarrier(sourceBuilding.x, sourceBuilding.y, match.playerId);
        if (!carrier) {
            return 'no_carrier';
        }

        const record = TransportJobService.activate(
            request.id,
            match.sourceBuilding,
            request.buildingId,
            request.materialType,
            match.amount,
            carrier.entityId,
            this.transportJobDeps
        );

        if (!record) {
            this.eventBus.emit('carrier:assignmentFailed', {
                requestId: request.id,
                reason: 'reservation_failed',
                sourceBuilding: match.sourceBuilding,
                destBuilding: request.buildingId,
                material: request.materialType,
                carrierId: carrier.entityId,
            });
            return null;
        }

        const job = this.transportJobBuilder.build(record, carrier.entityId);
        const success = this.jobAssigner.assignJob(carrier.entityId, job, job.targetPos!);

        if (success) {
            this.eventBus.emit('carrier:assigned', {
                requestId: request.id,
                carrierId: carrier.entityId,
                sourceBuilding: match.sourceBuilding,
                destBuilding: request.buildingId,
                material: request.materialType,
            });
            return { record, carrierId: carrier.entityId };
        }

        this.eventBus.emit('carrier:assignmentFailed', {
            requestId: request.id,
            reason: 'movement_failed',
            sourceBuilding: match.sourceBuilding,
            destBuilding: request.buildingId,
            material: request.materialType,
            carrierId: carrier.entityId,
        });
        TransportJobService.cancel(record, 'assignment_failed', this.transportJobDeps);
        return null;
    }

    /**
     * Find the nearest available idle carrier for the given player.
     * Prefers carriers closest to the source building to minimize transport time.
     */
    private findAvailableCarrier(sourceX: number, sourceY: number, playerId: number): { entityId: number } | null {
        let bestId: number | null = null;
        let bestDist = Infinity;

        for (const [id, , entity] of query(this.carrierRegistry.store, this.gameState.store)) {
            if (this.activeJobs.has(id)) continue;
            if (entity.player !== playerId) continue;
            if (this.carrierFilter && !this.carrierFilter(entity, playerId)) continue;

            const dist = hexDistance(entity.x, entity.y, sourceX, sourceY);
            if (dist < bestDist) {
                bestDist = dist;
                bestId = id;
            }
        }

        return bestId !== null ? { entityId: bestId } : null;
    }
}
