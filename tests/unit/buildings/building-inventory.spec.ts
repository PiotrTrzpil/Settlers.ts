import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { installTestGameData, resetTestGameData } from '../helpers/test-game-data';
import {
    BuildingInventoryManager,
    getInventoryConfig,
    hasInventory,
    isProductionBuilding,
    consumesMaterials,
    SLOT_CAPACITY,
} from '@/game/features/inventory';
import { EMaterialType } from '@/game/economy/material-type';
import { BuildingType } from '@/game/entity';
import { Race } from '@/game/core/race';

beforeAll(() => installTestGameData());
afterAll(() => resetTestGameData());

describe('Inventory Configs', () => {
    it('should return correct material mappings for production buildings', () => {
        const sawmill = getInventoryConfig(BuildingType.Sawmill, Race.Roman);
        expect(sawmill.inputSlots).toHaveLength(1);
        expect(sawmill.inputSlots[0]!.materialType).toBe(EMaterialType.LOG);
        expect(sawmill.outputSlots).toHaveLength(1);
        expect(sawmill.outputSlots[0]!.materialType).toBe(EMaterialType.BOARD);

        const woodcutter = getInventoryConfig(BuildingType.WoodcutterHut, Race.Roman);
        expect(woodcutter.inputSlots).toHaveLength(0);
        expect(woodcutter.outputSlots).toHaveLength(1);
        expect(woodcutter.outputSlots[0]!.materialType).toBe(EMaterialType.LOG);

        const bakery = getInventoryConfig(BuildingType.Bakery, Race.Roman);
        expect(bakery.inputSlots).toHaveLength(2);
        const inputMaterials = bakery.inputSlots.map(s => s.materialType);
        expect(inputMaterials).toContain(EMaterialType.FLOUR);
        expect(inputMaterials).toContain(EMaterialType.WATER);
        expect(bakery.outputSlots[0]!.materialType).toBe(EMaterialType.BREAD);
    });

    it('should classify buildings correctly by production role', () => {
        // Production buildings
        expect(hasInventory(BuildingType.Sawmill, Race.Roman)).toBe(true);
        expect(isProductionBuilding(BuildingType.WoodcutterHut, Race.Roman)).toBe(true);
        expect(consumesMaterials(BuildingType.Sawmill, Race.Roman)).toBe(true);

        // Non-production buildings
        expect(hasInventory(BuildingType.GuardTowerSmall, Race.Roman)).toBe(false);
        expect(isProductionBuilding(BuildingType.GuardTowerSmall, Race.Roman)).toBe(false);
        expect(consumesMaterials(BuildingType.WoodcutterHut, Race.Roman)).toBe(false);
    });
});

describe('BuildingInventoryManager', () => {
    let manager: BuildingInventoryManager;

    beforeEach(() => {
        manager = new BuildingInventoryManager();
    });

    it('should create inventory with correct slots and manage deposit/withdraw lifecycle', () => {
        manager.createInventory(100, BuildingType.Sawmill, Race.Roman);

        const inventory = manager.getInventory(100)!;
        expect(inventory.inputSlots[0]!.materialType).toBe(EMaterialType.LOG);
        expect(inventory.inputSlots[0]!.maxCapacity).toBe(SLOT_CAPACITY);
        expect(inventory.outputSlots[0]!.materialType).toBe(EMaterialType.BOARD);

        // Deposit input
        manager.depositInput(100, EMaterialType.LOG, 5);
        expect(inventory.inputSlots[0]!.currentAmount).toBe(5);

        // Deposit output and withdraw
        manager.depositOutput(100, EMaterialType.BOARD, 5);
        const withdrawn = manager.withdrawOutput(100, EMaterialType.BOARD, 3);
        expect(withdrawn).toBe(3);
        expect(inventory.outputSlots[0]!.currentAmount).toBe(2);
    });

    it('should throw when depositing wrong material type or accessing non-existent building', () => {
        manager.createInventory(100, BuildingType.Sawmill, Race.Roman);
        expect(() => manager.depositInput(100, EMaterialType.STONE, 5)).toThrow(/has no input slot for STONE/);
        expect(() => manager.withdrawOutput(999, EMaterialType.BOARD, 5)).toThrow(/Building 999 has no inventory/);
    });

    it('should find buildings by material availability and need', () => {
        manager.createInventory(100, BuildingType.WoodcutterHut, Race.Roman);
        manager.createInventory(101, BuildingType.WoodcutterHut, Race.Roman);
        manager.createInventory(102, BuildingType.Sawmill, Race.Roman);

        manager.depositOutput(100, EMaterialType.LOG, 5);
        manager.depositOutput(101, EMaterialType.LOG, 2);

        const withLogs = manager.getBuildingsWithOutput(EMaterialType.LOG);
        expect(withLogs).toContain(100);
        expect(withLogs).toContain(101);
        expect(withLogs).not.toContain(102);

        // Minimum amount filter
        const withEnoughLogs = manager.getBuildingsWithOutput(EMaterialType.LOG, 3);
        expect(withEnoughLogs).toContain(100);
        expect(withEnoughLogs).not.toContain(101);

        // Buildings needing input
        manager.depositInput(102, EMaterialType.LOG, SLOT_CAPACITY); // Fill sawmill 102
        manager.createInventory(103, BuildingType.Sawmill, Race.Roman); // Empty sawmill 103
        const needingLogs = manager.getBuildingsNeedingInput(EMaterialType.LOG);
        expect(needingLogs).toContain(103);
        expect(needingLogs).not.toContain(102);
    });

    it('should check production readiness based on all required inputs', () => {
        manager.createInventory(100, BuildingType.Bakery, Race.Roman);

        // Missing both inputs
        expect(manager.canStartProduction(100)).toBe(false);

        // Only one input available
        manager.depositInput(100, EMaterialType.FLOUR, 1);
        expect(manager.canStartProduction(100)).toBe(false);

        // Both inputs available
        manager.depositInput(100, EMaterialType.WATER, 1);
        expect(manager.canStartProduction(100)).toBe(true);
    });

    it('should notify listeners on deposit/withdraw and support unsubscribe', () => {
        const callback = vi.fn();
        manager.onChange(callback);
        manager.createInventory(100, BuildingType.Sawmill, Race.Roman);

        manager.depositInput(100, EMaterialType.LOG, 3);
        expect(callback).toHaveBeenCalledWith(100, EMaterialType.LOG, 'input', 0, 3);

        manager.offChange(callback);
        callback.mockClear();
        manager.depositInput(100, EMaterialType.LOG, 2);
        expect(callback).not.toHaveBeenCalled();
    });
});
