import { describe, it, expect, beforeEach } from 'vitest';
import {
    createSlot,
    canAccept,
    canProvide,
    deposit,
    withdraw,
    getAvailableSpace,
    isEmpty,
    isFull,
    BuildingInventoryManager,
    getInventoryConfig,
    hasInventory,
    isProductionBuilding,
    consumesMaterials,
    DEFAULT_INPUT_CAPACITY,
} from '@/game/features/inventory';
import { EMaterialType } from '@/game/economy/material-type';
import { BuildingType } from '@/game/entity';

describe('InventorySlot Helpers', () => {
    describe('createSlot', () => {
        it('should create an empty slot with correct material type and capacity', () => {
            const slot = createSlot(EMaterialType.LOG, 10);
            expect(slot.materialType).toBe(EMaterialType.LOG);
            expect(slot.currentAmount).toBe(0);
            expect(slot.maxCapacity).toBe(10);
        });
    });

    describe('canAccept', () => {
        it('should return true when slot has space for the material', () => {
            const slot = createSlot(EMaterialType.LOG, 10);
            expect(canAccept(slot, EMaterialType.LOG, 5)).toBe(true);
        });

        it('should return true when exact capacity is available', () => {
            const slot = createSlot(EMaterialType.LOG, 10);
            expect(canAccept(slot, EMaterialType.LOG, 10)).toBe(true);
        });

        it('should return false when amount exceeds capacity', () => {
            const slot = createSlot(EMaterialType.LOG, 10);
            expect(canAccept(slot, EMaterialType.LOG, 11)).toBe(false);
        });

        it('should return false for wrong material type', () => {
            const slot = createSlot(EMaterialType.LOG, 10);
            expect(canAccept(slot, EMaterialType.STONE, 5)).toBe(false);
        });

        it('should account for current amount', () => {
            const slot = createSlot(EMaterialType.LOG, 10);
            slot.currentAmount = 7;
            expect(canAccept(slot, EMaterialType.LOG, 3)).toBe(true);
            expect(canAccept(slot, EMaterialType.LOG, 4)).toBe(false);
        });
    });

    describe('canProvide', () => {
        it('should return true when slot has enough material', () => {
            const slot = createSlot(EMaterialType.LOG, 10);
            slot.currentAmount = 5;
            expect(canProvide(slot, EMaterialType.LOG, 3)).toBe(true);
        });

        it('should return true when exact amount is available', () => {
            const slot = createSlot(EMaterialType.LOG, 10);
            slot.currentAmount = 5;
            expect(canProvide(slot, EMaterialType.LOG, 5)).toBe(true);
        });

        it('should return false when not enough material', () => {
            const slot = createSlot(EMaterialType.LOG, 10);
            slot.currentAmount = 3;
            expect(canProvide(slot, EMaterialType.LOG, 5)).toBe(false);
        });

        it('should return false for wrong material type', () => {
            const slot = createSlot(EMaterialType.LOG, 10);
            slot.currentAmount = 5;
            expect(canProvide(slot, EMaterialType.STONE, 3)).toBe(false);
        });
    });

    describe('deposit', () => {
        it('should add material and return 0 overflow when space available', () => {
            const slot = createSlot(EMaterialType.LOG, 10);
            const overflow = deposit(slot, 5);
            expect(slot.currentAmount).toBe(5);
            expect(overflow).toBe(0);
        });

        it('should fill to capacity and return overflow', () => {
            const slot = createSlot(EMaterialType.LOG, 10);
            slot.currentAmount = 7;
            const overflow = deposit(slot, 5);
            expect(slot.currentAmount).toBe(10);
            expect(overflow).toBe(2);
        });

        it('should return full amount as overflow when slot is full', () => {
            const slot = createSlot(EMaterialType.LOG, 10);
            slot.currentAmount = 10;
            const overflow = deposit(slot, 5);
            expect(slot.currentAmount).toBe(10);
            expect(overflow).toBe(5);
        });
    });

    describe('withdraw', () => {
        it('should remove material and return actual amount', () => {
            const slot = createSlot(EMaterialType.LOG, 10);
            slot.currentAmount = 8;
            const withdrawn = withdraw(slot, 5);
            expect(slot.currentAmount).toBe(3);
            expect(withdrawn).toBe(5);
        });

        it('should withdraw all when requesting more than available', () => {
            const slot = createSlot(EMaterialType.LOG, 10);
            slot.currentAmount = 3;
            const withdrawn = withdraw(slot, 5);
            expect(slot.currentAmount).toBe(0);
            expect(withdrawn).toBe(3);
        });

        it('should return 0 when slot is empty', () => {
            const slot = createSlot(EMaterialType.LOG, 10);
            const withdrawn = withdraw(slot, 5);
            expect(slot.currentAmount).toBe(0);
            expect(withdrawn).toBe(0);
        });
    });

    describe('getAvailableSpace', () => {
        it('should return full capacity for empty slot', () => {
            const slot = createSlot(EMaterialType.LOG, 10);
            expect(getAvailableSpace(slot)).toBe(10);
        });

        it('should return remaining space for partially filled slot', () => {
            const slot = createSlot(EMaterialType.LOG, 10);
            slot.currentAmount = 7;
            expect(getAvailableSpace(slot)).toBe(3);
        });

        it('should return 0 for full slot', () => {
            const slot = createSlot(EMaterialType.LOG, 10);
            slot.currentAmount = 10;
            expect(getAvailableSpace(slot)).toBe(0);
        });
    });

    describe('isEmpty', () => {
        it('should return true for empty slot', () => {
            const slot = createSlot(EMaterialType.LOG, 10);
            expect(isEmpty(slot)).toBe(true);
        });

        it('should return false for slot with material', () => {
            const slot = createSlot(EMaterialType.LOG, 10);
            slot.currentAmount = 1;
            expect(isEmpty(slot)).toBe(false);
        });
    });

    describe('isFull', () => {
        it('should return true for full slot', () => {
            const slot = createSlot(EMaterialType.LOG, 10);
            slot.currentAmount = 10;
            expect(isFull(slot)).toBe(true);
        });

        it('should return false for slot with space', () => {
            const slot = createSlot(EMaterialType.LOG, 10);
            slot.currentAmount = 9;
            expect(isFull(slot)).toBe(false);
        });

        it('should return false for empty slot', () => {
            const slot = createSlot(EMaterialType.LOG, 10);
            expect(isFull(slot)).toBe(false);
        });
    });
});

describe('Inventory Configs', () => {
    describe('getInventoryConfig', () => {
        it('should return correct config for Sawmill (inputs and outputs)', () => {
            const config = getInventoryConfig(BuildingType.Sawmill);
            expect(config.inputSlots).toHaveLength(1);
            expect(config.inputSlots[0].materialType).toBe(EMaterialType.LOG);
            expect(config.outputSlots).toHaveLength(1);
            expect(config.outputSlots[0].materialType).toBe(EMaterialType.BOARD);
        });

        it('should return correct config for WoodcutterHut (output only)', () => {
            const config = getInventoryConfig(BuildingType.WoodcutterHut);
            expect(config.inputSlots).toHaveLength(0);
            expect(config.outputSlots).toHaveLength(1);
            expect(config.outputSlots[0].materialType).toBe(EMaterialType.LOG);
        });

        it('should return correct config for Bakery (multiple inputs)', () => {
            const config = getInventoryConfig(BuildingType.Bakery);
            expect(config.inputSlots).toHaveLength(2);
            const inputMaterials = config.inputSlots.map(s => s.materialType);
            expect(inputMaterials).toContain(EMaterialType.FLOUR);
            expect(inputMaterials).toContain(EMaterialType.WATER);
            expect(config.outputSlots).toHaveLength(1);
            expect(config.outputSlots[0].materialType).toBe(EMaterialType.BREAD);
        });

        it('should return empty config for unknown building type', () => {
            const config = getInventoryConfig(999 as BuildingType);
            expect(config.inputSlots).toHaveLength(0);
            expect(config.outputSlots).toHaveLength(0);
        });
    });

    describe('hasInventory', () => {
        it('should return true for production buildings', () => {
            expect(hasInventory(BuildingType.Sawmill)).toBe(true);
            expect(hasInventory(BuildingType.WoodcutterHut)).toBe(true);
            expect(hasInventory(BuildingType.Bakery)).toBe(true);
        });

        it('should return false for buildings without inventory', () => {
            expect(hasInventory(BuildingType.GuardTowerSmall)).toBe(false);
            expect(hasInventory(BuildingType.Decoration)).toBe(false);
        });
    });

    describe('isProductionBuilding', () => {
        it('should return true for buildings with output slots', () => {
            expect(isProductionBuilding(BuildingType.WoodcutterHut)).toBe(true);
            expect(isProductionBuilding(BuildingType.Sawmill)).toBe(true);
            expect(isProductionBuilding(BuildingType.Bakery)).toBe(true);
        });

        it('should return false for buildings without output slots', () => {
            expect(isProductionBuilding(BuildingType.Barrack)).toBe(false); // Consumes but doesn't output materials
            expect(isProductionBuilding(BuildingType.GuardTowerSmall)).toBe(false);
        });
    });

    describe('consumesMaterials', () => {
        it('should return true for buildings with input slots', () => {
            expect(consumesMaterials(BuildingType.Sawmill)).toBe(true);
            expect(consumesMaterials(BuildingType.Bakery)).toBe(true);
            expect(consumesMaterials(BuildingType.Barrack)).toBe(true);
        });

        it('should return false for buildings without input slots', () => {
            expect(consumesMaterials(BuildingType.WoodcutterHut)).toBe(false);
            expect(consumesMaterials(BuildingType.GrainFarm)).toBe(false);
        });
    });
});

describe('BuildingInventoryManager', () => {
    let manager: BuildingInventoryManager;

    beforeEach(() => {
        manager = new BuildingInventoryManager();
    });

    describe('createInventory', () => {
        it('should create inventory with correct slots for building type', () => {
            const inventory = manager.createInventory(100, BuildingType.Sawmill);

            expect(inventory.buildingId).toBe(100);
            expect(inventory.buildingType).toBe(BuildingType.Sawmill);
            expect(inventory.inputSlots).toHaveLength(1);
            expect(inventory.inputSlots[0].materialType).toBe(EMaterialType.LOG);
            expect(inventory.inputSlots[0].maxCapacity).toBe(DEFAULT_INPUT_CAPACITY);
            expect(inventory.outputSlots).toHaveLength(1);
            expect(inventory.outputSlots[0].materialType).toBe(EMaterialType.BOARD);
        });

        it('should create empty inventory for buildings without production', () => {
            const inventory = manager.createInventory(200, BuildingType.GuardTowerSmall);

            expect(inventory.inputSlots).toHaveLength(0);
            expect(inventory.outputSlots).toHaveLength(0);
        });
    });

    describe('getInventory', () => {
        it('should return created inventory', () => {
            manager.createInventory(100, BuildingType.Sawmill);
            const inventory = manager.getInventory(100);

            expect(inventory).toBeDefined();
            expect(inventory!.buildingId).toBe(100);
        });

        it('should return undefined for non-existent building', () => {
            expect(manager.getInventory(999)).toBeUndefined();
        });
    });

    describe('removeInventory', () => {
        it('should remove inventory and return true', () => {
            manager.createInventory(100, BuildingType.Sawmill);
            const result = manager.removeInventory(100);

            expect(result).toBe(true);
            expect(manager.getInventory(100)).toBeUndefined();
        });

        it('should return false for non-existent building', () => {
            expect(manager.removeInventory(999)).toBe(false);
        });
    });

    describe('depositInput / withdrawOutput', () => {
        it('should deposit material into input slot', () => {
            manager.createInventory(100, BuildingType.Sawmill);
            const deposited = manager.depositInput(100, EMaterialType.LOG, 5);

            expect(deposited).toBe(5);
            const inventory = manager.getInventory(100)!;
            expect(inventory.inputSlots[0].currentAmount).toBe(5);
        });

        it('should withdraw material from output slot', () => {
            manager.createInventory(100, BuildingType.Sawmill);
            manager.depositOutput(100, EMaterialType.BOARD, 5);

            const withdrawn = manager.withdrawOutput(100, EMaterialType.BOARD, 3);
            expect(withdrawn).toBe(3);

            const inventory = manager.getInventory(100)!;
            expect(inventory.outputSlots[0].currentAmount).toBe(2);
        });

        it('should return 0 when depositing wrong material type', () => {
            manager.createInventory(100, BuildingType.Sawmill);
            const deposited = manager.depositInput(100, EMaterialType.STONE, 5);
            expect(deposited).toBe(0);
        });

        it('should return 0 when withdrawing from non-existent building', () => {
            expect(manager.withdrawOutput(999, EMaterialType.BOARD, 5)).toBe(0);
        });
    });

    describe('canAcceptInput / canProvideOutput', () => {
        it('should check if building can accept input', () => {
            manager.createInventory(100, BuildingType.Sawmill);
            expect(manager.canAcceptInput(100, EMaterialType.LOG, 5)).toBe(true);
            expect(manager.canAcceptInput(100, EMaterialType.STONE, 5)).toBe(false);
        });

        it('should check if building can provide output', () => {
            manager.createInventory(100, BuildingType.Sawmill);
            manager.depositOutput(100, EMaterialType.BOARD, 5);

            expect(manager.canProvideOutput(100, EMaterialType.BOARD, 3)).toBe(true);
            expect(manager.canProvideOutput(100, EMaterialType.BOARD, 10)).toBe(false);
        });
    });

    describe('getBuildingsWithOutput', () => {
        it('should find buildings with specific material available', () => {
            manager.createInventory(100, BuildingType.WoodcutterHut);
            manager.createInventory(101, BuildingType.WoodcutterHut);
            manager.createInventory(102, BuildingType.Sawmill);

            manager.depositOutput(100, EMaterialType.LOG, 5);
            manager.depositOutput(101, EMaterialType.LOG, 2);
            // 102 has no logs

            const withLogs = manager.getBuildingsWithOutput(EMaterialType.LOG);
            expect(withLogs).toContain(100);
            expect(withLogs).toContain(101);
            expect(withLogs).not.toContain(102);
        });

        it('should respect minimum amount parameter', () => {
            manager.createInventory(100, BuildingType.WoodcutterHut);
            manager.createInventory(101, BuildingType.WoodcutterHut);

            manager.depositOutput(100, EMaterialType.LOG, 5);
            manager.depositOutput(101, EMaterialType.LOG, 2);

            const withEnoughLogs = manager.getBuildingsWithOutput(EMaterialType.LOG, 3);
            expect(withEnoughLogs).toContain(100);
            expect(withEnoughLogs).not.toContain(101);
        });
    });

    describe('getBuildingsNeedingInput', () => {
        it('should find buildings that need specific material', () => {
            manager.createInventory(100, BuildingType.Sawmill);
            manager.createInventory(101, BuildingType.Sawmill);

            manager.depositInput(100, EMaterialType.LOG, DEFAULT_INPUT_CAPACITY); // Full

            const needingLogs = manager.getBuildingsNeedingInput(EMaterialType.LOG);
            expect(needingLogs).toContain(101); // Empty
            expect(needingLogs).not.toContain(100); // Full
        });
    });

    describe('clear', () => {
        it('should remove all inventories', () => {
            manager.createInventory(100, BuildingType.Sawmill);
            manager.createInventory(101, BuildingType.WoodcutterHut);

            manager.clear();

            expect(manager.getInventory(100)).toBeUndefined();
            expect(manager.getInventory(101)).toBeUndefined();
            expect(manager.getAllBuildingIds()).toHaveLength(0);
        });
    });

    describe('getAllBuildingIds', () => {
        it('should return all building IDs with inventories', () => {
            manager.createInventory(100, BuildingType.Sawmill);
            manager.createInventory(200, BuildingType.WoodcutterHut);

            const ids = manager.getAllBuildingIds();
            expect(ids).toContain(100);
            expect(ids).toContain(200);
            expect(ids).toHaveLength(2);
        });
    });
});
