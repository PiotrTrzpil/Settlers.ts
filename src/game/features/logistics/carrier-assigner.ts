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
import type { TransportJobRecord } from './transport-job-record';
import * as TransportJobService from './transport-job-service';
import type { TransportJobDeps } from './transport-job-service';
import type { InventoryReservationManager } from './inventory-reservation';
import type { RequestManager } from './request-manager';
import type { RequestMatchResult } from './request-matcher';
import type { ResourceRequest } from './resource-request';
import type { TransportJobBuilder } from './transport-job-builder';
import type { JobState } from '../settler-tasks/types';
import type { CarrierFilter } from './logistics-filter';
import type { IdleCarrierPool } from '../carriers';
import type { InFlightTracker } from './in-flight-tracker';
import type { PreAssignmentQueue } from './pre-assignment-queue';
import { TransportPhase } from './transport-job-record';

/** Assigns a job to a settler and optionally starts movement. */
export interface JobAssigner {
    assignJob(entityId: number, job: JobState, moveTo?: { x: number; y: number }): boolean;
}

/** A busy carrier in PickedUp phase that could be pre-assigned to a new job. */
export interface BusyCarrierCandidate {
    carrierId: number;
    /** Where the carrier will end up (destBuilding position). */
    futureX: number;
    futureY: number;
    /** Estimated cost: distSq(carrier.pos → dest) + distSq(dest → newSource). */
    estimatedCostSq: number;
}

export interface CarrierAssignerConfig extends CoreDeps {
    idleCarrierPool: IdleCarrierPool;
    jobAssigner: JobAssigner;
    transportJobBuilder: TransportJobBuilder;
    reservationManager: InventoryReservationManager;
    requestManager: RequestManager;
    inFlightTracker: InFlightTracker;
    preAssignmentQueue: PreAssignmentQueue;
    activeJobs: ReadonlyMap<number, TransportJobRecord>;
    carrierFilter?: CarrierFilter;
}

/** Result of a successful carrier assignment. */
export interface AssignmentSuccess {
    /** The created transport job record. */
    record: TransportJobRecord;
    /** Entity ID of the carrier that was assigned. */
    carrierId: number;
}

/** Result when a job was queued for a busy carrier (not yet in activeJobs). */
export interface QueuedSuccess {
    /** The created transport job record (inventory reserved, but carrier still busy). */
    record: TransportJobRecord;
    /** Entity ID of the carrier that was pre-assigned. */
    carrierId: number;
    /** Discriminant — this assignment is queued, not immediately active. */
    queued: true;
}

/** Result of tryAssign / tryAssignBest — success, queued, no carrier available, or hard failure. */
export type AssignResult = AssignmentSuccess | QueuedSuccess | 'no_carrier' | null;

/**
 * Assigns available carriers to matched transport requests.
 *
 * Creates TransportJob instances that own the reservation and request lifecycle,
 * then assigns the carrier task to fulfill the job.
 */
export class CarrierAssigner {
    private readonly gameState: GameState;
    private readonly eventBus: EventBus;
    private readonly idleCarrierPool: IdleCarrierPool;
    private readonly jobAssigner: JobAssigner;
    private readonly transportJobBuilder: TransportJobBuilder;
    private readonly reservationManager: InventoryReservationManager;
    private readonly requestManager: RequestManager;
    private readonly transportJobDeps: TransportJobDeps;
    private readonly preAssignmentQueue: PreAssignmentQueue;
    private readonly activeJobs: ReadonlyMap<number, TransportJobRecord>;
    carrierFilter: CarrierFilter | null;

    constructor(config: CarrierAssignerConfig) {
        this.gameState = config.gameState;
        this.eventBus = config.eventBus;
        this.idleCarrierPool = config.idleCarrierPool;
        this.jobAssigner = config.jobAssigner;
        this.transportJobBuilder = config.transportJobBuilder;
        this.reservationManager = config.reservationManager;
        this.requestManager = config.requestManager;
        this.preAssignmentQueue = config.preAssignmentQueue;
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

        if (ranked.busyCarrier) {
            return this.tryQueueForBusyCarrier(request, ranked.match, ranked.busyCarrier);
        }
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
    ): { match: RequestMatchResult; busyCarrier?: BusyCarrierCandidate } | null {
        let bestMatch: RequestMatchResult | null = null;
        let bestTotal = Infinity;
        let bestBusy: BusyCarrierCandidate | undefined;

        const filter = this.buildFilter();
        for (const candidate of candidates) {
            const source = this.gameState.getEntity(candidate.sourceBuilding);
            if (!source) continue;

            const dx2 = source.x - destX;
            const dy2 = source.y - destY;
            const sourceToDestSq = dx2 * dx2 + dy2 * dy2;

            // Check idle carriers
            const idleResult = this.idleCarrierPool.findNearestWithCost(
                source.x, source.y, candidate.playerId, filter,
            );
            if (idleResult) {
                const total = idleResult.distSq + sourceToDestSq;
                if (total < bestTotal) {
                    bestTotal = total;
                    bestMatch = candidate;
                    bestBusy = undefined;
                }
            }

            // Check busy carriers in PickedUp phase
            const busyResult = this.findBestBusyCarrier(source.x, source.y, candidate.playerId);
            if (busyResult) {
                const total = busyResult.estimatedCostSq + sourceToDestSq;
                if (total < bestTotal) {
                    bestTotal = total;
                    bestMatch = candidate;
                    bestBusy = busyResult;
                }
            }
        }

        return bestMatch ? { match: bestMatch, busyCarrier: bestBusy } : null;
    }

    // eslint-disable-next-line sonarjs/function-return-type -- discriminated union return is intentional
    private tryAssignMatch(request: ResourceRequest, match: RequestMatchResult): AssignResult {
        const sourceBuilding = this.gameState.getEntityOrThrow(match.sourceBuilding, 'carrier source building');

        // Compare idle vs busy carrier for single-candidate path
        const idleResult = this.idleCarrierPool.findNearestWithCost(
            sourceBuilding.x, sourceBuilding.y, match.playerId, this.buildFilter(),
        );
        const busyResult = this.findBestBusyCarrier(sourceBuilding.x, sourceBuilding.y, match.playerId);

        if (!idleResult && !busyResult) return 'no_carrier';

        // If busy carrier beats idle, queue instead of assign
        if (busyResult && (!idleResult || busyResult.estimatedCostSq < idleResult.distSq)) {
            return this.tryQueueForBusyCarrier(request, match, busyResult);
        }

        const carrierId = idleResult!.carrierId;

        const record = TransportJobService.activate(
            request.id,
            match.sourceBuilding,
            request.buildingId,
            request.materialType,
            match.amount,
            carrierId,
            this.transportJobDeps
        );

        if (!record) {
            this.eventBus.emit('carrier:assignmentFailed', {
                requestId: request.id,
                reason: 'reservation_failed',
                sourceBuilding: match.sourceBuilding,
                destBuilding: request.buildingId,
                material: request.materialType,
                carrierId,
            });
            return null;
        }

        const job = this.transportJobBuilder.build(record);
        const success = this.jobAssigner.assignJob(carrierId, job, job.targetPos!);

        if (success) {
            this.eventBus.emit('carrier:assigned', {
                requestId: request.id,
                carrierId,
                sourceBuilding: match.sourceBuilding,
                destBuilding: request.buildingId,
                material: request.materialType,
            });
            return { record, carrierId };
        }

        this.eventBus.emit('carrier:assignmentFailed', {
            requestId: request.id,
            reason: 'movement_failed',
            sourceBuilding: match.sourceBuilding,
            destBuilding: request.buildingId,
            material: request.materialType,
            carrierId,
        });
        TransportJobService.cancel(record, 'assignment_failed', this.transportJobDeps);
        return null;
    }

    /**
     * Scan activeJobs for PickedUp-phase carriers belonging to the given player,
     * compute estimated cost to reach sourceX/sourceY after finishing their current delivery,
     * and return the best candidate.
     */
    private findBestBusyCarrier(
        sourceX: number,
        sourceY: number,
        playerId: number
    ): BusyCarrierCandidate | null {
        let best: BusyCarrierCandidate | null = null;

        for (const [carrierId, record] of this.activeJobs) {
            if (record.phase !== TransportPhase.PickedUp) continue;
            if (this.preAssignmentQueue.has(carrierId)) continue;

            const carrier = this.gameState.getEntity(carrierId);
            if (!carrier || carrier.player !== playerId) continue;

            const dest = this.gameState.getEntity(record.destBuilding);
            if (!dest) continue;

            // Cost: carrier→dest + dest→newSource
            const cdx = carrier.x - dest.x;
            const cdy = carrier.y - dest.y;
            const carrierToDestSq = cdx * cdx + cdy * cdy;

            const dsx = dest.x - sourceX;
            const dsy = dest.y - sourceY;
            const destToSourceSq = dsx * dsx + dsy * dsy;

            const estimatedCostSq = carrierToDestSq + destToSourceSq;

            if (!best || estimatedCostSq < best.estimatedCostSq) {
                best = { carrierId, futureX: dest.x, futureY: dest.y, estimatedCostSq };
            }
        }

        return best;
    }

    /**
     * Queue a transport job for a busy carrier instead of assigning immediately.
     * Reserves inventory now, builds the choreo, and enqueues for later assignment.
     */
    // eslint-disable-next-line sonarjs/function-return-type -- discriminated union return is intentional
    private tryQueueForBusyCarrier(
        request: ResourceRequest,
        match: RequestMatchResult,
        busyCandidate: BusyCarrierCandidate
    ): AssignResult {
        const record = TransportJobService.activate(
            request.id,
            match.sourceBuilding,
            request.buildingId,
            request.materialType,
            match.amount,
            busyCandidate.carrierId,
            this.transportJobDeps
        );

        if (!record) {
            this.eventBus.emit('carrier:assignmentFailed', {
                requestId: request.id,
                reason: 'reservation_failed',
                sourceBuilding: match.sourceBuilding,
                destBuilding: request.buildingId,
                material: request.materialType,
                carrierId: busyCandidate.carrierId,
            });
            return null;
        }

        const job = this.transportJobBuilder.build(record);
        this.preAssignmentQueue.queue({
            carrierId: busyCandidate.carrierId,
            record,
            job,
            moveTo: job.targetPos!,
        });

        this.eventBus.emit('carrier:assigned', {
            requestId: request.id,
            carrierId: busyCandidate.carrierId,
            sourceBuilding: match.sourceBuilding,
            destBuilding: request.buildingId,
            material: request.materialType,
        });

        return { record, carrierId: busyCandidate.carrierId, queued: true };
    }

    /**
     * Adapt the optional CarrierFilter (entity-based) to CarrierEligibilityFilter (id-based).
     */
    private buildFilter(): ((entityId: number) => boolean) | undefined {
        if (!this.carrierFilter) return undefined;
        const cf = this.carrierFilter;
        return (entityId: number) => {
            const entity = this.gameState.getEntityOrThrow(entityId, 'carrier filter');
            return cf(entity, entity.player);
        };
    }
}
