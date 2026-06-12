/**
 * TransportJobStore — single source of truth for all active transport jobs.
 *
 * Jobs are keyed by jobId. A carrier appears in at most two records via the
 * byCarrier index: its active job (Reserved/PickedUp) and optionally one
 * Queued follow-up job. Terminal records (Delivered/Cancelled) are removed
 * by TransportJobService, so every record in the store is live.
 *
 * All reservation and in-flight queries are derived from job records — no
 * separate data structures. A job's existence at a given phase IS the
 * reservation/in-flight state.
 *
 * Records are flat and serializable; the store persists them directly
 * (persistKey 'transportJobs'). After restore, LogisticsDispatcher rebuilds
 * the carrier choreographies from the records.
 */

import { PersistentIndexedMap } from '@/game/persistence/persistent-store';
import type { Index } from '@/game/utils/indexed-map';
import { TransportPhase, claimsSourceStock, isIncoming, type TransportJobRecord } from './transport-job-record';
import type { EMaterialType } from '../../economy/material-type';

export class TransportJobStore {
    /** Primary store: jobId → TransportJobRecord. Persisted. */
    readonly jobs = new PersistentIndexedMap<TransportJobRecord>('transportJobs');

    /** Index: building ID → job IDs (both source and dest). */
    readonly byBuilding: Index<number, number>;

    /** Index: transport phase → job IDs. */
    readonly byPhase: Index<TransportPhase, number>;

    /** Index: carrier ID → job IDs (at most one active + one queued). */
    readonly byCarrier: Index<number, number>;

    constructor() {
        this.byBuilding = this.jobs.addIndex((_jobId, job) => [job.sourceBuilding, job.destBuilding]);
        this.byPhase = this.jobs.addIndex((_jobId, job) => job.phase);
        this.byCarrier = this.jobs.addIndex((_jobId, job) => job.carrierId);
    }

    add(record: TransportJobRecord): void {
        this.jobs.set(record.id, record);
    }

    get(jobId: number): TransportJobRecord | undefined {
        return this.jobs.get(jobId);
    }

    remove(jobId: number): void {
        this.jobs.delete(jobId);
    }

    /** Re-derive indexes after a phase change. */
    reindex(jobId: number): void {
        this.jobs.reindex(jobId);
    }

    /** The carrier's currently-executing transport job (Reserved or PickedUp), if any. */
    getActiveJobForCarrier(carrierId: number): TransportJobRecord | undefined {
        for (const jobId of this.byCarrier.get(carrierId)) {
            const job = this.getOrThrow(jobId, 'getActiveJobForCarrier');
            if (job.phase !== TransportPhase.Queued) {
                return job;
            }
        }
        return undefined;
    }

    /** The carrier's queued follow-up job, if any. */
    getQueuedJobForCarrier(carrierId: number): TransportJobRecord | undefined {
        for (const jobId of this.byCarrier.get(carrierId)) {
            const job = this.getOrThrow(jobId, 'getQueuedJobForCarrier');
            if (job.phase === TransportPhase.Queued) {
                return job;
            }
        }
        return undefined;
    }

    /**
     * Total amount of source stock spoken for at a building for a material
     * (phase Queued or Reserved — material not yet withdrawn).
     * O(jobs-per-building), typically 1-5.
     */
    getReservedAmount(sourceBuilding: number, material: EMaterialType): number {
        let total = 0;
        for (const jobId of this.byBuilding.get(sourceBuilding)) {
            const job = this.getOrThrow(jobId, 'getReservedAmount');
            if (job.sourceBuilding === sourceBuilding && job.material === material && claimsSourceStock(job.phase)) {
                total += job.amount;
            }
        }
        return total;
    }

    /** Unreserved supply = currentAmount - getReservedAmount(). */
    getAvailableSupply(sourceBuilding: number, material: EMaterialType, currentAmount: number): number {
        return Math.max(0, currentAmount - this.getReservedAmount(sourceBuilding, material));
    }

    /** Total amount in flight toward a destination building (phase PickedUp). */
    getInFlightAmount(destBuilding: number, material: EMaterialType): number {
        let total = 0;
        for (const jobId of this.byBuilding.get(destBuilding)) {
            const job = this.getOrThrow(jobId, 'getInFlightAmount');
            if (
                job.destBuilding === destBuilding &&
                job.material === material &&
                job.phase === TransportPhase.PickedUp
            ) {
                total += job.amount;
            }
        }
        return total;
    }

    /**
     * Total amount headed toward a destination building for a material,
     * across all live phases (Queued, Reserved, PickedUp).
     * Used by demand deficit accounting to avoid over-ordering.
     */
    getIncomingAmount(destBuilding: number, material: EMaterialType): number {
        let total = 0;
        for (const jobId of this.byBuilding.get(destBuilding)) {
            const job = this.getOrThrow(jobId, 'getIncomingAmount');
            if (job.destBuilding === destBuilding && job.material === material && isIncoming(job.phase)) {
                total += job.amount;
            }
        }
        return total;
    }

    /** All jobs for a building (source or dest). */
    getJobsForBuilding(buildingId: number): TransportJobRecord[] {
        const result: TransportJobRecord[] = [];
        for (const jobId of this.byBuilding.get(buildingId)) {
            result.push(this.getOrThrow(jobId, 'getJobsForBuilding'));
        }
        return result;
    }

    private getOrThrow(jobId: number, context: string): TransportJobRecord {
        const job = this.jobs.get(jobId);
        if (!job) {
            throw new Error(`No job for id ${jobId} in TransportJobStore.${context}`);
        }
        return job;
    }
}
