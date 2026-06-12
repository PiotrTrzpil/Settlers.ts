/**
 * CarrierAssigner
 *
 * Finds the best (carrier, source) pair for a demand and creates the
 * transport job. Considers both idle carriers and busy carriers in
 * PickedUp phase — a busy carrier that will finish near the new source
 * can be pre-assigned a follow-up job (phase=Queued in the job store),
 * which the dispatcher activates when its current delivery completes.
 *
 * All distances are compared via travelCost (hex distance) so supply
 * ranking and carrier ranking agree about geometry.
 */

import type { GameState } from '../../game-state';
import type { EventBus } from '../../event-bus';
import type { EMaterialType } from '../../economy/material-type';
import type { TransportJobRecord } from './transport-job-record';
import * as TransportJobService from './transport-job-service';
import type { TransportJobDeps } from './transport-job-service';
import type { RequestMatchResult } from './request-matcher';
import type { TransportJobBuilder } from './transport-job-builder';
import type { ChoreoJobState } from '../../systems/choreo';
import type { CarrierFilter } from './logistics-filter';
import type { IdleCarrierPool } from '../carriers';
import { TransportPhase } from './transport-job-record';
import { travelCost } from './travel-cost';
import type { Tile } from '@/game/core/coordinates';

/** Assigns a job to a settler and optionally starts movement. */
export interface JobAssigner {
    assignJob(entityId: number, job: ChoreoJobState, moveTo?: Tile): boolean;
}

/** A demand being dispatched — destination, material, and amount to move. */
export interface TransportDemand {
    readonly buildingId: number;
    readonly materialType: EMaterialType;
    readonly amount: number;
}

/** A busy carrier in PickedUp phase that could be pre-assigned a follow-up job. */
interface BusyCarrierCandidate {
    carrierId: number;
    /** Estimated cost: travelCost(carrier → dest) + travelCost(dest → newSource). */
    estimatedCost: number;
}

export interface CarrierAssignerConfig {
    gameState: GameState;
    eventBus: EventBus;
    idleCarrierPool: IdleCarrierPool;
    jobAssigner: JobAssigner;
    transportJobBuilder: TransportJobBuilder;
    transportJobDeps: TransportJobDeps;
    carrierFilter?: CarrierFilter;
}

/** Result of a successful carrier assignment. */
export interface AssignmentSuccess {
    /** The created transport job record. */
    record: TransportJobRecord;
    /** Entity ID of the carrier that was assigned. */
    carrierId: number;
    /** True when the job was queued for a busy carrier (phase=Queued). */
    queued: boolean;
}

/** Result of tryAssign / tryAssignBest — success, no carrier available, or hard failure. */
export type AssignResult = AssignmentSuccess | 'no_carrier' | null;

export class CarrierAssigner {
    private readonly gameState: GameState;
    private readonly eventBus: EventBus;
    private readonly idleCarrierPool: IdleCarrierPool;
    private readonly jobAssigner: JobAssigner;
    private readonly transportJobBuilder: TransportJobBuilder;
    private readonly transportJobDeps: TransportJobDeps;
    carrierFilter: CarrierFilter | null;

    constructor(config: CarrierAssignerConfig) {
        this.gameState = config.gameState;
        this.eventBus = config.eventBus;
        this.idleCarrierPool = config.idleCarrierPool;
        this.jobAssigner = config.jobAssigner;
        this.transportJobBuilder = config.transportJobBuilder;
        this.transportJobDeps = config.transportJobDeps;
        // eslint-disable-next-line no-restricted-syntax -- optional config/prop with sensible default
        this.carrierFilter = config.carrierFilter ?? null;
    }

    /**
     * Try to assign the best (carrier, source) pair from the supply candidates.
     * Picks the pair with the lowest total trip cost: carrier→source + source→dest.
     */
    // eslint-disable-next-line sonarjs/function-return-type -- discriminated union return is intentional
    tryAssignBest(demand: TransportDemand, candidates: readonly RequestMatchResult[]): AssignResult {
        if (candidates.length === 0) {
            return null;
        }

        const destBuilding = this.gameState.getEntityOrThrow(demand.buildingId, 'dest building');
        const ranked = this.rankByTotalTrip(candidates, destBuilding.x, destBuilding.y);
        if (!ranked) {
            return 'no_carrier';
        }

        if (ranked.busyCarrier) {
            return this.tryQueueForBusyCarrier(demand, ranked.match, ranked.busyCarrier);
        }
        return this.tryAssignIdle(demand, ranked.match, ranked.idleCarrierId!);
    }

    /**
     * Rank supply candidates by total trip cost (carrier→source + source→dest).
     * Returns the best candidate plus the carrier to use (idle or busy),
     * or null if no carrier is available for any candidate.
     */
    private rankByTotalTrip(
        candidates: readonly RequestMatchResult[],
        destX: number,
        destY: number
    ): { match: RequestMatchResult; idleCarrierId?: number; busyCarrier?: BusyCarrierCandidate } | null {
        let bestMatch: RequestMatchResult | null = null;
        let bestTotal = Infinity;
        let bestIdle: number | undefined;
        let bestBusy: BusyCarrierCandidate | undefined;

        for (const candidate of candidates) {
            const source = this.gameState.getEntityOrThrow(
                candidate.sourceBuilding,
                'supply source building in carrier ranking'
            );
            const sourceToDest = travelCost(source.x, source.y, destX, destY);

            // Idle carriers (filter checks territory connectivity to source)
            const filter = this.buildFilter(source.x, source.y);
            const idleResult = this.idleCarrierPool.findNearestWithCost(source.x, source.y, candidate.playerId, filter);
            if (idleResult) {
                const carrier = this.gameState.getEntityOrThrow(idleResult.carrierId, 'idle carrier in ranking');
                const total = travelCost(carrier.x, carrier.y, source.x, source.y) + sourceToDest;
                if (total < bestTotal) {
                    bestTotal = total;
                    bestMatch = candidate;
                    bestIdle = idleResult.carrierId;
                    bestBusy = undefined;
                }
            }

            // Busy carriers in PickedUp phase
            const busyResult = this.findBestBusyCarrier(source.x, source.y, candidate.playerId);
            if (busyResult) {
                const total = busyResult.estimatedCost + sourceToDest;
                if (total < bestTotal) {
                    bestTotal = total;
                    bestMatch = candidate;
                    bestIdle = undefined;
                    bestBusy = busyResult;
                }
            }
        }

        return bestMatch ? { match: bestMatch, idleCarrierId: bestIdle, busyCarrier: bestBusy } : null;
    }

    // eslint-disable-next-line sonarjs/function-return-type -- discriminated union return is intentional
    private tryAssignIdle(demand: TransportDemand, match: RequestMatchResult, carrierId: number): AssignResult {
        const record = TransportJobService.activate(
            match.sourceBuilding,
            demand.buildingId,
            demand.materialType,
            match.amount,
            carrierId,
            this.transportJobDeps
        );

        if (!record) {
            this.emitAssignmentFailed(demand, match, carrierId, 'reservation_failed');
            return null;
        }

        const job = this.transportJobBuilder.build(record);
        const success = this.jobAssigner.assignJob(carrierId, job, job.targetPos!);

        if (success) {
            this.emitAssigned(record);
            return { record, carrierId, queued: false };
        }

        this.emitAssignmentFailed(demand, match, carrierId, 'movement_failed');
        TransportJobService.cancel(record, 'assignment_failed', this.transportJobDeps);
        return null;
    }

    /**
     * Scan PickedUp-phase jobs for carriers belonging to the given player,
     * compute estimated cost to reach the source after finishing their current
     * delivery, and return the best candidate without a queued follow-up.
     */
    private findBestBusyCarrier(sourceX: number, sourceY: number, playerId: number): BusyCarrierCandidate | null {
        const jobStore = this.transportJobDeps.jobStore;
        let best: BusyCarrierCandidate | null = null;

        for (const jobId of jobStore.byPhase.get(TransportPhase.PickedUp)) {
            const record = jobStore.get(jobId);
            if (!record) {
                throw new Error(`No job for id ${jobId} in CarrierAssigner.findBestBusyCarrier`);
            }
            if (jobStore.getQueuedJobForCarrier(record.carrierId)) {
                continue;
            }

            const carrier = this.gameState.getEntityOrThrow(record.carrierId, 'busy carrier in PickedUp phase');
            if (carrier.player !== playerId) {
                continue;
            }
            const dest = this.gameState.getEntityOrThrow(
                record.destBuilding,
                'destination building of busy carrier job'
            );

            const estimatedCost =
                travelCost(carrier.x, carrier.y, dest.x, dest.y) + travelCost(dest.x, dest.y, sourceX, sourceY);

            if (!best || estimatedCost < best.estimatedCost) {
                best = { carrierId: record.carrierId, estimatedCost };
            }
        }

        return best;
    }

    /**
     * Queue a transport job for a busy carrier instead of assigning immediately.
     * The record enters the store at phase=Queued — it claims source stock and
     * counts as incoming at the destination, but the carrier's active job is
     * untouched. The dispatcher promotes it when the current delivery completes.
     */
    // eslint-disable-next-line sonarjs/function-return-type -- discriminated union return is intentional
    private tryQueueForBusyCarrier(
        demand: TransportDemand,
        match: RequestMatchResult,
        busyCandidate: BusyCarrierCandidate
    ): AssignResult {
        const record = TransportJobService.activate(
            match.sourceBuilding,
            demand.buildingId,
            demand.materialType,
            match.amount,
            busyCandidate.carrierId,
            this.transportJobDeps,
            { queued: true }
        );

        if (!record) {
            this.emitAssignmentFailed(demand, match, busyCandidate.carrierId, 'reservation_failed');
            return null;
        }

        this.emitAssigned(record);
        this.eventBus.emit('logistics:preAssignQueued', {
            carrierId: busyCandidate.carrierId,
            jobId: record.id,
            materialType: demand.materialType,
            sourceBuilding: match.sourceBuilding,
            destBuilding: demand.buildingId,
        });

        return { record, carrierId: busyCandidate.carrierId, queued: true };
    }

    private emitAssigned(record: TransportJobRecord): void {
        this.eventBus.emit('carrier:assigned', {
            jobId: record.id,
            unitId: record.carrierId,
            sourceBuilding: record.sourceBuilding,
            destBuilding: record.destBuilding,
            material: record.material,
        });
    }

    private emitAssignmentFailed(
        demand: TransportDemand,
        match: RequestMatchResult,
        carrierId: number,
        reason: 'reservation_failed' | 'movement_failed'
    ): void {
        this.eventBus.emit('carrier:assignmentFailed', {
            reason,
            sourceBuilding: match.sourceBuilding,
            destBuilding: demand.buildingId,
            material: demand.materialType,
            unitId: carrierId,
            level: 'warn',
        });
    }

    /**
     * Adapt the optional CarrierFilter (entity-based) to CarrierEligibilityFilter (id-based).
     * When nearX/nearY are provided, they're forwarded so filters can check territory connectivity.
     */
    private buildFilter(nearX?: number, nearY?: number): ((entityId: number) => boolean) | undefined {
        if (!this.carrierFilter) {
            return undefined;
        }
        const cf = this.carrierFilter;
        return (entityId: number) => {
            const entity = this.gameState.getEntityOrThrow(entityId, 'carrier filter');
            return cf(entity, entity.player, nearX, nearY);
        };
    }
}
