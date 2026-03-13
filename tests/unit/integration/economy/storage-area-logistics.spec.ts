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

// ── Export ──────────────────────────────────────────────────────

describe('StorageArea logistics – export', { timeout: 30_000 }, () => {
    let sim: Simulation;

    afterEach(() => {
        sim?.destroy();
        cleanupSimulation();
    });

    it('export-enabled StorageArea supplies construction site', () => {
        const s = createScenario.constructionSite(BuildingType.WoodcutterHut);
        sim = s;

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

        const sfm = sim.services.storageFilterManager;
        sfm.setDirection(s.storageId, EMaterialType.BOARD, StorageDirection.Import);
        sfm.setDirection(s.storageId, EMaterialType.STONE, StorageDirection.Import);

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
});

// ── Import ─────────────────────────────────────────────────────

describe('StorageArea logistics – import', { timeout: 30_000 }, () => {
    let sim: Simulation;

    afterEach(() => {
        sim?.destroy();
        cleanupSimulation();
    });

    it('import-enabled StorageArea creates low-priority requests', () => {
        sim = createSimulation();
        sim.placeBuilding(BuildingType.ResidenceSmall);
        const storageId = sim.placeBuilding(BuildingType.StorageArea);

        sim.services.storageFilterManager.setDirection(storageId, EMaterialType.BOARD, StorageDirection.Import);

        sim.tick(100);

        const requests = [...sim.services.demandQueue.getAllDemands()].filter(r => r.buildingId === storageId);
        const boardReqs = requests.filter(r => r.materialType === EMaterialType.BOARD);
        expect(boardReqs.length).toBeGreaterThan(0);
        expect(boardReqs[0]!.priority).toBe(2);
    });

    it('import requests are capped per material to avoid request flooding', () => {
        sim = createSimulation();
        sim.placeBuilding(BuildingType.ResidenceSmall);
        const storageId = sim.placeBuilding(BuildingType.StorageArea);

        const totalCapacity = sim.services.inventoryManager
            .getSlots(storageId)
            .filter(s => s.kind === SlotKind.Storage || s.kind === SlotKind.Output)
            .reduce((sum, s) => sum + s.maxCapacity, 0);
        expect(totalCapacity).toBeGreaterThan(20);

        sim.services.storageFilterManager.setDirection(storageId, EMaterialType.LOG, StorageDirection.Import);
        sim.tick(100);

        const requests = [...sim.services.demandQueue.getAllDemands()].filter(r => r.buildingId === storageId);
        const logReqs = requests.filter(r => r.materialType === EMaterialType.LOG);
        expect(logReqs).toHaveLength(20);
        for (const req of logReqs) {
            expect(req.amount).toBe(1);
        }
    });

    it('import pulls material from free pile into StorageArea', () => {
        sim = createSimulation();
        sim.placeBuilding(BuildingType.ResidenceSmall);
        const storageId = sim.placeBuilding(BuildingType.StorageArea);

        sim.services.storageFilterManager.setDirection(storageId, EMaterialType.LOG, StorageDirection.Import);

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

        const woodcutterId = sim.placeBuilding(BuildingType.WoodcutterHut);
        sim.injectOutput(woodcutterId, EMaterialType.LOG, 3);

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

        sim.tick(500);

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
});

// ── No StorageArea↔StorageArea & slot reuse ───────────────────

describe('StorageArea logistics – boundaries & slot reuse', { timeout: 30_000 }, () => {
    let sim: Simulation;

    afterEach(() => {
        sim?.destroy();
        cleanupSimulation();
    });

    it('StorageArea does NOT pull from another StorageArea', () => {
        sim = createSimulation();
        sim.placeBuilding(BuildingType.ResidenceSmall);

        const sourceId = sim.placeBuilding(BuildingType.StorageArea);
        sim.injectOutput(sourceId, EMaterialType.BOARD, 8);

        const destId = sim.placeBuilding(BuildingType.StorageArea);
        sim.services.storageFilterManager.setDirection(destId, EMaterialType.BOARD, StorageDirection.Import);

        sim.tick(5000);

        expect(sim.getOutput(destId, EMaterialType.BOARD)).toBe(0);
    });

    it('disabling material frees empty slots for other materials', () => {
        sim = createSimulation();
        sim.placeBuilding(BuildingType.ResidenceSmall);
        const storageId = sim.placeBuilding(BuildingType.StorageArea);

        sim.injectOutput(storageId, EMaterialType.LOG, 3);

        sim.services.inventoryManager.withdrawOutput(storageId, EMaterialType.LOG, 3);

        sim.services.storageFilterManager.setDirection(storageId, EMaterialType.BOARD, StorageDirection.Import);

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

        sim.injectOutput(storageId, EMaterialType.LOG, 5);
        expect(sim.getOutput(storageId, EMaterialType.LOG)).toBe(5);

        sim.execute({
            type: 'set_storage_filter',
            buildingId: storageId,
            material: EMaterialType.LOG,
            direction: null,
        });

        expect(sim.getOutput(storageId, EMaterialType.LOG)).toBe(5);

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

        sim.injectOutput(storageId, EMaterialType.LOG, 1);

        const logSlot = sim.services.inventoryManager
            .getSlots(storageId)
            .find(
                s => (s.kind === SlotKind.Storage || s.kind === SlotKind.Output) && s.materialType === EMaterialType.LOG
            )!;
        expect(logSlot).toBeDefined();
        expect(logSlot.currentAmount).toBe(1);

        sim.services.inventoryManager.withdrawOutput(storageId, EMaterialType.LOG, 1);
        expect(logSlot.currentAmount).toBe(0);
        expect(logSlot.materialType).toBe(EMaterialType.LOG);

        sim.execute({
            type: 'set_storage_filter',
            buildingId: storageId,
            material: EMaterialType.LOG,
            direction: null,
        });
        expect(logSlot.materialType).toBe(EMaterialType.NO_MATERIAL);
    });

    it('no import requests when storage is full', () => {
        sim = createSimulation();
        sim.placeBuilding(BuildingType.ResidenceSmall);
        const storageId = sim.placeBuilding(BuildingType.StorageArea);

        for (const slot of sim.services.inventoryManager
            .getSlots(storageId)
            .filter(s => s.kind === SlotKind.Storage || s.kind === SlotKind.Output)) {
            slot.materialType = EMaterialType.LOG;
            slot.currentAmount = slot.maxCapacity;
        }

        sim.services.storageFilterManager.setDirection(storageId, EMaterialType.BOARD, StorageDirection.Import);
        sim.tick(100);

        const requests = [...sim.services.demandQueue.getAllDemands()].filter(r => r.buildingId === storageId);
        const boardReqs = requests.filter(r => r.materialType === EMaterialType.BOARD);
        expect(boardReqs).toHaveLength(0);
    });
});
