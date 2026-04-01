import { describe, it, expect, beforeEach } from 'vitest';
import { DemandQueue, DemandPriority } from '@/game/features/logistics/demand-queue';
import { TransportJobStore } from '@/game/features/logistics/transport-job-store';
import { EMaterialType } from '@/game/economy/material-type';
import { TransportPhase, type TransportJobRecord } from '@/game/features/logistics/transport-job-record';
import { EventBus } from '@/game/event-bus';

describe('DemandQueue state machine', () => {
    let demandQueue: DemandQueue;

    beforeEach(() => {
        demandQueue = new DemandQueue(new EventBus());
    });

    it('demand lifecycle: addDemand → getSortedDemands → consumeDemand', () => {
        const demand = demandQueue.addDemand(100, EMaterialType.LOG, 5, DemandPriority.Normal);
        expect(demand.id).toBeGreaterThan(0);
        expect(demand.buildingId).toBe(100);
        expect(demand.materialType).toBe(EMaterialType.LOG);
        expect(demand.amount).toBe(5);
        expect(demand.priority).toBe(DemandPriority.Normal);

        const sorted = demandQueue.getSortedDemands();
        expect(sorted).toHaveLength(1);
        expect(sorted[0]!.id).toBe(demand.id);

        const consumed = demandQueue.consumeDemand(demand.id);
        expect(consumed).toBe(true);
        expect(demandQueue.getDemand(demand.id)).toBeUndefined();

        // Consuming non-existent demand returns false
        expect(demandQueue.consumeDemand(demand.id)).toBe(false);
    });

    it('getSortedDemands sorts by priority then timestamp', () => {
        const low = demandQueue.addDemand(100, EMaterialType.LOG, 1, DemandPriority.Low);
        demandQueue.advanceTime(0.1);
        const high = demandQueue.addDemand(101, EMaterialType.STONE, 1, DemandPriority.High);
        demandQueue.advanceTime(0.1);
        const normal = demandQueue.addDemand(102, EMaterialType.BOARD, 1, DemandPriority.Normal);

        const sorted = demandQueue.getSortedDemands();
        expect(sorted.map(d => d.id)).toEqual([high.id, normal.id, low.id]);
    });

    it('cancelDemandsForBuilding removes all demands for that building', () => {
        demandQueue.addDemand(100, EMaterialType.LOG, 1, DemandPriority.Normal);
        demandQueue.addDemand(100, EMaterialType.STONE, 2, DemandPriority.Normal);
        demandQueue.addDemand(101, EMaterialType.BOARD, 3, DemandPriority.Normal);

        expect(demandQueue.cancelDemandsForBuilding(100)).toBe(2);
        expect(demandQueue.size).toBe(1);
    });
});

describe('TransportJobStore derived queries', () => {
    let jobStore: TransportJobStore;

    function addJob(
        store: TransportJobStore,
        carrierId: number,
        sourceBuilding: number,
        destBuilding: number,
        material: EMaterialType,
        amount: number,
        phase: TransportPhase,
        demandId = carrierId
    ): TransportJobRecord {
        const record: TransportJobRecord = {
            id: store.allocateJobId(),
            demandId,
            sourceBuilding,
            destBuilding,
            material,
            amount,
            carrierId,
            slotId: 0,
            phase,
            createdAt: 0,
        };
        store.jobs.set(carrierId, record);
        return record;
    }

    beforeEach(() => {
        jobStore = new TransportJobStore();
    });

    it('tracks reserved amounts per building+material and computes available correctly', () => {
        addJob(jobStore, 1, 100, 200, EMaterialType.LOG, 5, TransportPhase.Reserved);
        addJob(jobStore, 2, 100, 200, EMaterialType.LOG, 3, TransportPhase.Reserved);
        addJob(jobStore, 3, 100, 200, EMaterialType.STONE, 2, TransportPhase.Reserved);

        expect(jobStore.getReservedAmount(100, EMaterialType.LOG)).toBe(8);
        expect(jobStore.getReservedAmount(100, EMaterialType.STONE)).toBe(2);
        expect(jobStore.getAvailableSupply(100, EMaterialType.LOG, 10)).toBe(2);
        // Does not go below zero
        expect(jobStore.getAvailableSupply(100, EMaterialType.LOG, 5)).toBe(0);
    });

    it('only counts Reserved phase jobs for getReservedAmount (not PickedUp)', () => {
        addJob(jobStore, 1, 100, 200, EMaterialType.LOG, 5, TransportPhase.Reserved);
        addJob(jobStore, 2, 100, 200, EMaterialType.LOG, 3, TransportPhase.PickedUp);

        // PickedUp jobs are no longer "reserving" source inventory
        expect(jobStore.getReservedAmount(100, EMaterialType.LOG)).toBe(5);
    });

    it('getInFlightAmount counts PickedUp jobs targeting a building', () => {
        addJob(jobStore, 1, 100, 200, EMaterialType.LOG, 5, TransportPhase.PickedUp);
        addJob(jobStore, 2, 100, 200, EMaterialType.LOG, 3, TransportPhase.Reserved);
        addJob(jobStore, 3, 100, 201, EMaterialType.LOG, 7, TransportPhase.PickedUp);

        expect(jobStore.getInFlightAmount(200, EMaterialType.LOG)).toBe(5);
        expect(jobStore.getInFlightAmount(201, EMaterialType.LOG)).toBe(7);
    });

    it('hasDemand checks if a demand already has an assigned job', () => {
        addJob(jobStore, 1, 100, 200, EMaterialType.LOG, 5, TransportPhase.Reserved, 42);

        expect(jobStore.hasDemand(42)).toBe(true);
        expect(jobStore.hasDemand(99)).toBe(false);
    });

    it('getJobsForBuilding returns all jobs for a building (source or dest)', () => {
        addJob(jobStore, 1, 100, 200, EMaterialType.LOG, 5, TransportPhase.Reserved);
        addJob(jobStore, 2, 300, 100, EMaterialType.STONE, 2, TransportPhase.PickedUp);
        addJob(jobStore, 3, 400, 500, EMaterialType.BOARD, 1, TransportPhase.Reserved);

        const jobs = jobStore.getJobsForBuilding(100);
        expect(jobs).toHaveLength(2);
        const carrierIds = jobs.map(j => j.carrierId).sort((a, b) => a - b);
        expect(carrierIds).toEqual([1, 2]);
    });
});
