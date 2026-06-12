/**
 * Unit tests for the demand side of fulfillment matching:
 * DemandLedger standing orders (upsert/clear, dispatch ordering, fair
 * rotation), deficit derivation (computeDeficit/deliverySpace), and
 * TransportJobStore derived queries that feed the deficit accounting.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { DemandLedger, DemandPriority } from '@/game/features/logistics/demand-ledger';
import { computeDeficit, deliverySpace } from '@/game/features/logistics/demand-deficit';
import { TransportJobStore } from '@/game/features/logistics/transport-job-store';
import { TransportPhase, type TransportJobRecord } from '@/game/features/logistics/transport-job-record';
import { EMaterialType } from '@/game/economy/material-type';
import { SlotKind } from '@/game/core/pile-kind';
import type { BuildingInventoryManager, PileSlot } from '@/game/features/inventory';

// ─── Helpers ────────────────────────────────────────────────────────

let nextJobId = 1;
let nextSlotId = 1;

function addJob(
    store: TransportJobStore,
    carrierId: number,
    sourceBuilding: number,
    destBuilding: number,
    material: EMaterialType,
    amount: number,
    phase: TransportPhase
): TransportJobRecord {
    const record: TransportJobRecord = {
        id: nextJobId++,
        sourceBuilding,
        destBuilding,
        material,
        amount,
        carrierId,
        phase,
        createdAt: 0,
    };
    store.add(record);
    return record;
}

function makeSlot(
    buildingId: number,
    kind: SlotKind,
    materialType: EMaterialType,
    currentAmount: number,
    maxCapacity = 8
): PileSlot {
    return {
        id: nextSlotId++,
        materialType,
        currentAmount,
        maxCapacity,
        position: { x: 0, y: 0 },
        entityId: null,
        kind,
        buildingId,
    };
}

/** Inventory stub exposing only getSlots() — all that deficit derivation reads. */
function createInventoryStub(slotsByBuilding: Map<number, PileSlot[]>): BuildingInventoryManager {
    return {
        getSlots: (buildingId: number): readonly PileSlot[] => slotsByBuilding.get(buildingId) ?? [],
    } as unknown as BuildingInventoryManager;
}

// ─── DemandLedger ───────────────────────────────────────────────────

describe('DemandLedger standing orders', () => {
    let ledger: DemandLedger;

    beforeEach(() => {
        ledger = new DemandLedger();
    });

    it('setTarget creates a standing order with fill-capacity defaults', () => {
        ledger.setTarget(100, EMaterialType.LOG, { priority: DemandPriority.Normal });

        const entry = ledger.getTarget(100, EMaterialType.LOG)!;
        expect(entry.buildingId).toBe(100);
        expect(entry.materialType).toBe(EMaterialType.LOG);
        expect(entry.priority).toBe(DemandPriority.Normal);
        expect(entry.target).toBeNull();
        expect(entry.maxIncoming).toBe(Infinity);
        expect(ledger.size).toBe(1);
    });

    it('setTarget upserts: same (building, material) keeps one entry and updates fields', () => {
        ledger.setTarget(100, EMaterialType.LOG, { priority: DemandPriority.Low, target: 5 });
        ledger.setTarget(100, EMaterialType.LOG, { priority: DemandPriority.High, target: 2, maxIncoming: 3 });

        expect(ledger.size).toBe(1);
        const entry = ledger.getTarget(100, EMaterialType.LOG)!;
        expect(entry.priority).toBe(DemandPriority.High);
        expect(entry.target).toBe(2);
        expect(entry.maxIncoming).toBe(3);
    });

    it('setTarget with target: 0 removes the standing order', () => {
        ledger.setTarget(100, EMaterialType.LOG, { priority: DemandPriority.Normal, target: 5 });
        ledger.setTarget(100, EMaterialType.LOG, { priority: DemandPriority.Normal, target: 0 });

        expect(ledger.getTarget(100, EMaterialType.LOG)).toBeUndefined();
        expect(ledger.size).toBe(0);
    });

    it('clearTarget removes one order; clearBuilding removes all for a building', () => {
        ledger.setTarget(100, EMaterialType.LOG, { priority: DemandPriority.Normal });
        ledger.setTarget(100, EMaterialType.STONE, { priority: DemandPriority.Normal });
        ledger.setTarget(101, EMaterialType.BOARD, { priority: DemandPriority.Normal });

        ledger.clearTarget(100, EMaterialType.LOG);
        expect(ledger.getTarget(100, EMaterialType.LOG)).toBeUndefined();
        expect(ledger.size).toBe(2);

        expect(ledger.clearBuilding(100)).toBe(1);
        expect(ledger.size).toBe(1);
        expect(ledger.getTarget(101, EMaterialType.BOARD)).toBeDefined();

        // Clearing a building with no orders returns 0
        expect(ledger.clearBuilding(100)).toBe(0);
    });

    it('sorts by demand priority class first', () => {
        ledger.setTarget(100, EMaterialType.LOG, { priority: DemandPriority.Low });
        ledger.setTarget(101, EMaterialType.LOG, { priority: DemandPriority.High });
        ledger.setTarget(102, EMaterialType.LOG, { priority: DemandPriority.Normal });

        const sorted = ledger.getSortedEntries();
        expect(sorted.map(e => e.buildingId)).toEqual([101, 102, 100]);
    });

    it('sorts by material priority within the same class (BOARD before GOLDBAR)', () => {
        ledger.setTarget(100, EMaterialType.GOLDBAR, { priority: DemandPriority.Normal });
        ledger.setTarget(101, EMaterialType.BOARD, { priority: DemandPriority.Normal });
        ledger.setTarget(102, EMaterialType.STONE, { priority: DemandPriority.Normal });

        const sorted = ledger.getSortedEntries();
        expect(sorted.map(e => e.materialType)).toEqual([
            EMaterialType.BOARD,
            EMaterialType.STONE,
            EMaterialType.GOLDBAR,
        ]);
    });

    it('rotates fairly: markServed moves an entry behind its never-served peer', () => {
        ledger.setTarget(100, EMaterialType.LOG, { priority: DemandPriority.Normal });
        ledger.setTarget(101, EMaterialType.LOG, { priority: DemandPriority.Normal });

        // Never served: tie broken by buildingId
        expect(ledger.getSortedEntries().map(e => e.buildingId)).toEqual([100, 101]);

        ledger.markServed(ledger.getTarget(100, EMaterialType.LOG)!);
        expect(ledger.getSortedEntries().map(e => e.buildingId)).toEqual([101, 100]);

        ledger.advanceTime(1);
        ledger.markServed(ledger.getTarget(101, EMaterialType.LOG)!);
        expect(ledger.getSortedEntries().map(e => e.buildingId)).toEqual([100, 101]);
    });

    it('priority class outranks recency: a served High entry stays ahead of unserved Normal', () => {
        ledger.setTarget(100, EMaterialType.LOG, { priority: DemandPriority.Normal });
        ledger.setTarget(101, EMaterialType.LOG, { priority: DemandPriority.High });

        ledger.advanceTime(5);
        ledger.markServed(ledger.getTarget(101, EMaterialType.LOG)!);

        expect(ledger.getSortedEntries().map(e => e.buildingId)).toEqual([101, 100]);
    });

    it('advanceTime accumulates game time used for lastServedAt stamps', () => {
        expect(ledger.getGameTime()).toBe(0);
        ledger.advanceTime(0.5);
        ledger.advanceTime(1.5);
        expect(ledger.getGameTime()).toBe(2);

        ledger.setTarget(100, EMaterialType.LOG, { priority: DemandPriority.Normal });
        const entry = ledger.getTarget(100, EMaterialType.LOG)!;
        ledger.markServed(entry);
        expect(entry.lastServedAt).toBe(2);
    });

    it('getAllTargets iterates every standing order', () => {
        ledger.setTarget(100, EMaterialType.LOG, { priority: DemandPriority.Normal });
        ledger.setTarget(101, EMaterialType.STONE, { priority: DemandPriority.Low });

        const all = [...ledger.getAllTargets()];
        expect(all).toHaveLength(2);
        expect(all.map(e => e.buildingId).sort((a, b) => a - b)).toEqual([100, 101]);
    });
});

// ─── Deficit derivation ─────────────────────────────────────────────

describe('demand deficit derivation', () => {
    const DEST = 200;
    let ledger: DemandLedger;
    let jobStore: TransportJobStore;

    beforeEach(() => {
        ledger = new DemandLedger();
        jobStore = new TransportJobStore();
    });

    function entryFor(
        material: EMaterialType,
        options: { priority?: DemandPriority; target?: number | null; maxIncoming?: number } = {}
    ) {
        ledger.setTarget(DEST, material, { priority: options.priority ?? DemandPriority.Normal, ...options });
        return ledger.getTarget(DEST, material)!;
    }

    it('deliverySpace sums free capacity of matching input and storage slots', () => {
        const inventory = createInventoryStub(
            new Map([
                [
                    DEST,
                    [
                        makeSlot(DEST, SlotKind.Input, EMaterialType.LOG, 3), // 5 free
                        makeSlot(DEST, SlotKind.Input, EMaterialType.STONE, 0), // wrong material
                        makeSlot(DEST, SlotKind.Storage, EMaterialType.LOG, 6), // 2 free
                        makeSlot(DEST, SlotKind.Storage, EMaterialType.NO_MATERIAL, 0), // unclaimed: full 8
                        makeSlot(DEST, SlotKind.Output, EMaterialType.LOG, 0), // outputs never count
                    ],
                ],
            ])
        );

        expect(deliverySpace(inventory, jobStore, DEST, EMaterialType.LOG)).toBe(5 + 2 + 8);
        expect(deliverySpace(inventory, jobStore, DEST, EMaterialType.STONE)).toBe(8 + 8);
    });

    it('deliverySpace deducts foreign incoming overflow from shared free storage slots', () => {
        const inventory = createInventoryStub(
            new Map([
                [
                    DEST,
                    [
                        makeSlot(DEST, SlotKind.Storage, EMaterialType.STONE, 6), // 2 free for STONE
                        makeSlot(DEST, SlotKind.Storage, EMaterialType.NO_MATERIAL, 0), // shared 8
                    ],
                ],
            ])
        );

        // 5 STONE incoming: 2 land in STONE's own claimed slot, 3 spill into the free slot
        addJob(jobStore, 1, 100, DEST, EMaterialType.STONE, 5, TransportPhase.Reserved);

        expect(deliverySpace(inventory, jobStore, DEST, EMaterialType.LOG)).toBe(8 - 3);
    });

    it('fill-capacity order (target null): deficit = space − incoming, all live phases counted', () => {
        const inventory = createInventoryStub(
            new Map([[DEST, [makeSlot(DEST, SlotKind.Input, EMaterialType.LOG, 0)]]])
        );
        const entry = entryFor(EMaterialType.LOG);

        expect(computeDeficit(entry, inventory, jobStore)).toBe(8);

        addJob(jobStore, 1, 100, DEST, EMaterialType.LOG, 2, TransportPhase.Queued);
        addJob(jobStore, 2, 100, DEST, EMaterialType.LOG, 1, TransportPhase.Reserved);
        addJob(jobStore, 3, 100, DEST, EMaterialType.LOG, 3, TransportPhase.PickedUp);

        expect(jobStore.getIncomingAmount(DEST, EMaterialType.LOG)).toBe(6);
        expect(computeDeficit(entry, inventory, jobStore)).toBe(2);
    });

    it('absolute target order: wanted is capped by deliverable space', () => {
        const inventory = createInventoryStub(
            new Map([[DEST, [makeSlot(DEST, SlotKind.Input, EMaterialType.LOG, 5)]]])
        );

        // Construction-style order for 6, but only 3 units of space remain
        const entry = entryFor(EMaterialType.LOG, { target: 6 });
        expect(computeDeficit(entry, inventory, jobStore)).toBe(3);

        // Target below space wins the min
        const small = entryFor(EMaterialType.LOG, { target: 2 });
        expect(computeDeficit(small, inventory, jobStore)).toBe(2);
    });

    it('maxIncoming caps the deficit by concurrent incoming jobs', () => {
        const inventory = createInventoryStub(
            new Map([[DEST, [makeSlot(DEST, SlotKind.Storage, EMaterialType.NO_MATERIAL, 0)]]])
        );
        const entry = entryFor(EMaterialType.LOG, { maxIncoming: 2 });

        expect(computeDeficit(entry, inventory, jobStore)).toBe(2);

        addJob(jobStore, 1, 100, DEST, EMaterialType.LOG, 1, TransportPhase.Reserved);
        expect(computeDeficit(entry, inventory, jobStore)).toBe(1);

        addJob(jobStore, 2, 100, DEST, EMaterialType.LOG, 1, TransportPhase.PickedUp);
        expect(computeDeficit(entry, inventory, jobStore)).toBe(0);
    });

    it('clamps at zero when incoming exceeds the wanted amount', () => {
        const inventory = createInventoryStub(
            new Map([[DEST, [makeSlot(DEST, SlotKind.Input, EMaterialType.LOG, 7)]]])
        );
        const entry = entryFor(EMaterialType.LOG);

        addJob(jobStore, 1, 100, DEST, EMaterialType.LOG, 5, TransportPhase.PickedUp);

        expect(computeDeficit(entry, inventory, jobStore)).toBe(0);
    });
});

// ─── TransportJobStore derived queries ──────────────────────────────

describe('TransportJobStore derived queries', () => {
    let jobStore: TransportJobStore;

    beforeEach(() => {
        jobStore = new TransportJobStore();
    });

    it('counts Queued and Reserved jobs as reserved source stock, not PickedUp', () => {
        addJob(jobStore, 1, 100, 200, EMaterialType.LOG, 5, TransportPhase.Reserved);
        addJob(jobStore, 2, 100, 200, EMaterialType.LOG, 3, TransportPhase.Queued);
        addJob(jobStore, 3, 100, 200, EMaterialType.LOG, 2, TransportPhase.PickedUp);
        addJob(jobStore, 4, 100, 200, EMaterialType.STONE, 2, TransportPhase.Reserved);

        expect(jobStore.getReservedAmount(100, EMaterialType.LOG)).toBe(8);
        expect(jobStore.getReservedAmount(100, EMaterialType.STONE)).toBe(2);
        expect(jobStore.getAvailableSupply(100, EMaterialType.LOG, 10)).toBe(2);
        // Does not go below zero
        expect(jobStore.getAvailableSupply(100, EMaterialType.LOG, 5)).toBe(0);
    });

    it('getInFlightAmount counts only PickedUp jobs targeting a building', () => {
        addJob(jobStore, 1, 100, 200, EMaterialType.LOG, 5, TransportPhase.PickedUp);
        addJob(jobStore, 2, 100, 200, EMaterialType.LOG, 3, TransportPhase.Reserved);
        addJob(jobStore, 3, 100, 201, EMaterialType.LOG, 7, TransportPhase.PickedUp);

        expect(jobStore.getInFlightAmount(200, EMaterialType.LOG)).toBe(5);
        expect(jobStore.getInFlightAmount(201, EMaterialType.LOG)).toBe(7);
    });

    it('getIncomingAmount counts all live phases toward a destination', () => {
        addJob(jobStore, 1, 100, 200, EMaterialType.LOG, 5, TransportPhase.PickedUp);
        addJob(jobStore, 2, 100, 200, EMaterialType.LOG, 3, TransportPhase.Reserved);
        addJob(jobStore, 3, 100, 200, EMaterialType.LOG, 2, TransportPhase.Queued);
        addJob(jobStore, 4, 100, 200, EMaterialType.STONE, 9, TransportPhase.Reserved);
        addJob(jobStore, 5, 100, 201, EMaterialType.LOG, 7, TransportPhase.PickedUp);

        expect(jobStore.getIncomingAmount(200, EMaterialType.LOG)).toBe(10);
        expect(jobStore.getIncomingAmount(201, EMaterialType.LOG)).toBe(7);
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

    it('distinguishes a carrier active job from its queued follow-up', () => {
        const active = addJob(jobStore, 7, 100, 200, EMaterialType.LOG, 1, TransportPhase.PickedUp);
        const queued = addJob(jobStore, 7, 100, 201, EMaterialType.LOG, 1, TransportPhase.Queued);

        expect(jobStore.getActiveJobForCarrier(7)).toBe(active);
        expect(jobStore.getQueuedJobForCarrier(7)).toBe(queued);
        expect(jobStore.getActiveJobForCarrier(8)).toBeUndefined();
        expect(jobStore.getQueuedJobForCarrier(8)).toBeUndefined();
    });
});
