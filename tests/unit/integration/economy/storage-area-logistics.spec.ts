/**
 * Integration tests for StorageArea import/export logistics.
 *
 * StorageArea buildings act as buffers between production buildings.
 * Direction settings (Import/Export/Both) control material flow:
 *   - Import: carriers bring material from building outputs/free piles INTO storage
 *   - Export: carriers take material FROM storage to deliver to requesting buildings
 *   - Both: bidirectional
 *   - No StorageArea↔StorageArea transfers (they're buffers, not endpoints)
 */

import { describe, it, expect, afterEach } from 'vitest';
import { BuildingType } from '@/game/entity';
import { EMaterialType } from '@/game/economy';
import { SlotKind } from '@/game/core/pile-kind';
import { StorageDirection } from '@/game/systems/inventory/storage-filter-manager';
import { createSimulation, createScenario, cleanupSimulation, type Simulation } from '../../helpers/test-simulation';
import { installRealGameData } from '../../helpers/test-game-data';

installRealGameData();

describe('StorageArea logistics (real game data)', { timeout: 30_000 }, () => {
    let sim: Simulation;

    afterEach(() => {
        sim?.destroy();
        cleanupSimulation();
    });

    // ── Export ──────────────────────────────────────────────────────

    it('export-enabled StorageArea supplies construction site', () => {
        const s = createScenario.constructionSite(BuildingType.WoodcutterHut);
        sim = s;

        // StorageArea is pre-stocked with BOARD+STONE and auto-set to Both by injectOutput
        sim.runUntil(
            () => {
                const site = sim.services.constructionSiteManager.getSite(s.siteId);
                return (
                    !!site &&
                    sim.services.inventoryManager
                        .getSlots(s.siteId)
                        .filter(slot => slot.kind === SlotKind.Input)
                        .some(slot => slot.currentAmount > 0)
                );
            },
            { maxTicks: 50_000, label: 'material delivered from StorageArea' }
        );

        expect(
            sim.services.inventoryManager
                .getSlots(s.siteId)
                .filter(slot => slot.kind === SlotKind.Input)
                .some(slot => slot.currentAmount > 0)
        ).toBe(true);
        expect(sim.errors).toHaveLength(0);
    });

    it('import-only StorageArea does NOT supply construction site', () => {
        const s = createScenario.constructionSite(BuildingType.WoodcutterHut);
        sim = s;

        // Override direction to Import-only (no export)
        const sfm = sim.services.storageFilterManager;
        sfm.setDirection(s.storageId, EMaterialType.BOARD, StorageDirection.Import);
        sfm.setDirection(s.storageId, EMaterialType.STONE, StorageDirection.Import);

        // Run for a while — nothing should be delivered
        sim.tick(5000);

        expect(
            sim.services.inventoryManager
                .getSlots(s.siteId)
                .filter(slot => slot.kind === SlotKind.Input)
                .every(slot => slot.currentAmount === 0)
        ).toBe(true);
    });

    it('disabled StorageArea does NOT supply construction site', () => {
        const s = createScenario.constructionSite(BuildingType.WoodcutterHut);
        sim = s;

        // Remove all directions (disable)
        const sfm = sim.services.storageFilterManager;
        sfm.disallow(s.storageId, EMaterialType.BOARD);
        sfm.disallow(s.storageId, EMaterialType.STONE);

        sim.tick(5000);

        expect(
            sim.services.inventoryManager
                .getSlots(s.siteId)
                .filter(slot => slot.kind === SlotKind.Input)
                .every(slot => slot.currentAmount === 0)
        ).toBe(true);
    });

    // ── Import ─────────────────────────────────────────────────────

    it('import-enabled StorageArea creates low-priority requests', () => {
        sim = createSimulation();
        sim.placeBuilding(BuildingType.ResidenceSmall);
        const storageId = sim.placeBuilding(BuildingType.StorageArea);

        // Enable import for BOARD
        sim.services.storageFilterManager.setDirection(storageId, EMaterialType.BOARD, StorageDirection.Import);

        // Tick to trigger request creation
        sim.tick(100);

        const requests = [...sim.services.demandQueue.getAllDemands()].filter(r => r.buildingId === storageId);
        const boardReqs = requests.filter(r => r.materialType === EMaterialType.BOARD);
        expect(boardReqs.length).toBeGreaterThan(0);
        // Import requests should be Low priority (2)
        expect(boardReqs[0]!.priority).toBe(2);
    });

    it('import requests are capped per material to avoid request flooding', () => {
        sim = createSimulation();
        sim.placeBuilding(BuildingType.ResidenceSmall);
        const storageId = sim.placeBuilding(BuildingType.StorageArea);

        // Get total capacity — should exceed the cap
        const totalCapacity = sim.services.inventoryManager
            .getSlots(storageId)
            .filter(s => s.kind === SlotKind.Storage || s.kind === SlotKind.Output)
            .reduce((sum, s) => sum + s.maxCapacity, 0);
        expect(totalCapacity).toBeGreaterThan(20);

        // Enable import for LOG
        sim.services.storageFilterManager.setDirection(storageId, EMaterialType.LOG, StorageDirection.Import);
        sim.tick(100);

        const requests = [...sim.services.demandQueue.getAllDemands()].filter(r => r.buildingId === storageId);
        const logReqs = requests.filter(r => r.materialType === EMaterialType.LOG);
        // Capped at MAX_ACTIVE_IMPORTS_PER_MATERIAL (20), not totalCapacity
        expect(logReqs).toHaveLength(20);
        for (const req of logReqs) {
            expect(req.amount).toBe(1);
        }
    });

    it('import pulls material from free pile into StorageArea', () => {
        sim = createSimulation();
        sim.placeBuilding(BuildingType.ResidenceSmall);
        const storageId = sim.placeBuilding(BuildingType.StorageArea);

        // Enable import for LOG
        sim.services.storageFilterManager.setDirection(storageId, EMaterialType.LOG, StorageDirection.Import);

        // Place a free pile with LOGs
        sim.placeGoodsNear(storageId, EMaterialType.LOG, 3);

        sim.runUntil(() => sim.getOutput(storageId, EMaterialType.LOG) > 0, {
            maxTicks: 50_000,
            label: 'LOG imported into StorageArea',
        });

        expect(sim.getOutput(storageId, EMaterialType.LOG)).toBeGreaterThan(0);
        expect(sim.errors).toHaveLength(0);
    });

    it('import pulls material from building output into StorageArea', () => {
        sim = createSimulation();
        sim.placeBuilding(BuildingType.ResidenceSmall);
        const storageId = sim.placeBuilding(BuildingType.StorageArea);

        // Place a woodcutter hut and stock its output with LOGs
        const woodcutterId = sim.placeBuilding(BuildingType.WoodcutterHut);
        sim.injectOutput(woodcutterId, EMaterialType.LOG, 3);

        // Enable import for LOG on the StorageArea
        sim.services.storageFilterManager.setDirection(storageId, EMaterialType.LOG, StorageDirection.Import);

        sim.runUntil(() => sim.getOutput(storageId, EMaterialType.LOG) > 0, {
            maxTicks: 50_000,
            label: 'LOG imported from woodcutter into StorageArea',
        });

        expect(sim.getOutput(storageId, EMaterialType.LOG)).toBeGreaterThan(0);
        expect(sim.errors).toHaveLength(0);
    });

    it('enabling import AFTER initial tick creates requests (direction change mid-game)', () => {
        sim = createSimulation();
        sim.placeBuilding(BuildingType.ResidenceSmall);
        const storageId = sim.placeBuilding(BuildingType.StorageArea);
        const woodcutterId = sim.placeBuilding(BuildingType.WoodcutterHut);
        sim.injectOutput(woodcutterId, EMaterialType.LOG, 3);

        // Tick first so the initial full-scan has already happened
        sim.tick(500);

        // NOW enable import via command (like UI) — must trigger new requests even though full-scan already ran
        sim.execute({
            type: 'set_storage_filter',
            buildingId: storageId,
            material: EMaterialType.LOG,
            direction: StorageDirection.Import,
        });
        sim.tick(100);

        const requests = [...sim.services.demandQueue.getAllDemands()].filter(r => r.buildingId === storageId);
        const logReqs = requests.filter(r => r.materialType === EMaterialType.LOG);
        expect(logReqs.length).toBeGreaterThan(0);
    });

    // ── No StorageArea↔StorageArea ─────────────────────────────────

    it('StorageArea does NOT pull from another StorageArea', () => {
        sim = createSimulation();
        sim.placeBuilding(BuildingType.ResidenceSmall);

        const sourceId = sim.placeBuilding(BuildingType.StorageArea);
        sim.injectOutput(sourceId, EMaterialType.BOARD, 8);
        // source has export enabled (auto-set by injectOutput)

        const destId = sim.placeBuilding(BuildingType.StorageArea);
        sim.services.storageFilterManager.setDirection(destId, EMaterialType.BOARD, StorageDirection.Import);

        // Run for a while — dest should NOT receive from source
        sim.tick(5000);

        expect(sim.getOutput(destId, EMaterialType.BOARD)).toBe(0);
    });

    // ── Direction switching ────────────────────────────────────────

    // ── Slot reuse on direction change ──────────────────────────────

    it('disabling material frees empty slots for other materials', () => {
        sim = createSimulation();
        sim.placeBuilding(BuildingType.ResidenceSmall);
        const storageId = sim.placeBuilding(BuildingType.StorageArea);

        // Fill 3 slots with LOG (import + deposit)
        sim.injectOutput(storageId, EMaterialType.LOG, 3);

        // Withdraw all LOG to empty the slots (simulates carriers exporting)
        sim.services.inventoryManager.withdrawOutput(storageId, EMaterialType.LOG, 3);
        // Slots are freed by withdrawOutput when amount reaches 0

        // Now the slots should be free — enable BOARD import
        sim.services.storageFilterManager.setDirection(storageId, EMaterialType.BOARD, StorageDirection.Import);

        // Check capacity: should have space for BOARD
        const space = sim.services.inventoryManager
            .getSlots(storageId)
            .filter(s => s.kind === SlotKind.Storage || s.kind === SlotKind.Output)
            .filter(s => s.materialType === EMaterialType.BOARD || s.materialType === EMaterialType.NO_MATERIAL)
            .reduce((sum, s) => sum + s.maxCapacity - s.currentAmount, 0);
        expect(space).toBeGreaterThan(0);
    });

    it('disabling material with stock keeps stock but frees empty slots', () => {
        sim = createSimulation();
        sim.placeBuilding(BuildingType.ResidenceSmall);
        const storageId = sim.placeBuilding(BuildingType.StorageArea);

        // Put LOG in storage (auto-sets direction to Both)
        sim.injectOutput(storageId, EMaterialType.LOG, 5);
        expect(sim.getOutput(storageId, EMaterialType.LOG)).toBe(5);

        // Disable LOG via command (like user clicking OFF in the UI)
        sim.execute({
            type: 'set_storage_filter',
            buildingId: storageId,
            material: EMaterialType.LOG,
            direction: null,
        });

        // LOG stock still exists (not removed)
        expect(sim.getOutput(storageId, EMaterialType.LOG)).toBe(5);

        // Enable BOARD — should have remaining slots available
        sim.services.storageFilterManager.setDirection(storageId, EMaterialType.BOARD, StorageDirection.Import);
        const space = sim.services.inventoryManager
            .getSlots(storageId)
            .filter(s => s.kind === SlotKind.Storage || s.kind === SlotKind.Output)
            .filter(s => s.materialType === EMaterialType.BOARD || s.materialType === EMaterialType.NO_MATERIAL)
            .reduce((sum, s) => sum + s.maxCapacity - s.currentAmount, 0);
        expect(space).toBeGreaterThan(0);
    });

    it('disabling material frees empty-but-claimed slots via command', () => {
        sim = createSimulation();
        sim.placeBuilding(BuildingType.ResidenceSmall);
        const storageId = sim.placeBuilding(BuildingType.StorageArea);

        // Claim a slot for LOG and deposit into it
        sim.injectOutput(storageId, EMaterialType.LOG, 1);

        // Get the inventory and find the LOG slot
        const logSlot = sim.services.inventoryManager
            .getSlots(storageId)
            .find(
                s => (s.kind === SlotKind.Storage || s.kind === SlotKind.Output) && s.materialType === EMaterialType.LOG
            )!;
        expect(logSlot).toBeDefined();
        expect(logSlot.currentAmount).toBe(1);

        // Drain to 0 via withdraw — slot stays claimed (materialType=LOG, amount=0)
        sim.services.inventoryManager.withdrawOutput(storageId, EMaterialType.LOG, 1);
        expect(logSlot.currentAmount).toBe(0);
        expect(logSlot.materialType).toBe(EMaterialType.LOG);

        // Disallow LOG via command — system-handler frees empty-but-claimed slots
        sim.execute({
            type: 'set_storage_filter',
            buildingId: storageId,
            material: EMaterialType.LOG,
            direction: null,
        });
        expect(logSlot.materialType).toBe(EMaterialType.NO_MATERIAL);
    });

    // ── Full storage ───────────────────────────────────────────────

    it('no import requests when storage is full', () => {
        sim = createSimulation();
        sim.placeBuilding(BuildingType.ResidenceSmall);
        const storageId = sim.placeBuilding(BuildingType.StorageArea);

        // Fill ALL output slots with LOG (StorageArea has limited dynamic slots)
        for (const slot of sim.services.inventoryManager
            .getSlots(storageId)
            .filter(s => s.kind === SlotKind.Storage || s.kind === SlotKind.Output)) {
            slot.materialType = EMaterialType.LOG;
            slot.currentAmount = slot.maxCapacity;
        }

        // Enable BOARD import — but no free slots
        sim.services.storageFilterManager.setDirection(storageId, EMaterialType.BOARD, StorageDirection.Import);
        sim.tick(100);

        // No requests should be created (no capacity)
        const requests = [...sim.services.demandQueue.getAllDemands()].filter(r => r.buildingId === storageId);
        const boardReqs = requests.filter(r => r.materialType === EMaterialType.BOARD);
        expect(boardReqs).toHaveLength(0);
    });
});
