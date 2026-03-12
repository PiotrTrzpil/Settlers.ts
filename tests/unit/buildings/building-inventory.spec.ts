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
import { SlotKind } from '@/game/core/pile-kind';
import { EventBus } from '@/game/event-bus';
import type { SlotPositionResolver } from '@/game/systems/inventory/building-inventory';

beforeAll(() => installTestGameData());
afterAll(() => resetTestGameData());

/** Trivial resolver that assigns (0,0) to every slot. */
const stubPositionResolver: SlotPositionResolver = (_id, _building, configs) => configs.map(() => ({ x: 0, y: 0 }));

interface TestManager {
    manager: BuildingInventoryManager;
    eventBus: EventBus;
    /** Register building metadata so gameState mock returns the right subType for canStartProduction. */
    registerBuilding(id: number, buildingType: BuildingType, race?: Race): void;
    createSlots(id: number, buildingType: BuildingType, race?: Race): void;
}

function makeManager(): TestManager {
    let nextEntityId = 1000;
    const eventBus = new EventBus();
    const manager = new BuildingInventoryManager();
    const buildingMeta = new Map<number, { buildingType: BuildingType; race: Race }>();

    manager.configure({
        executeCommand: () =>
            ({ success: true, effects: [{ type: 'entity_created', entityId: nextEntityId++ }] }) as any,
        gameState: {
            getEntity: (id: number) => {
                const meta = buildingMeta.get(id) ?? { buildingType: BuildingType.Sawmill, race: Race.Roman };
                return { id, type: 1, subType: meta.buildingType, race: meta.race, player: 0, x: 0, y: 0 };
            },
            getEntityOrThrow: (id: number) => {
                const meta = buildingMeta.get(id) ?? { buildingType: BuildingType.Sawmill, race: Race.Roman };
                return { id, type: 1, subType: meta.buildingType, race: meta.race, player: 0, x: 0, y: 0 };
            },
        } as any,
        eventBus,
    });

    return {
        manager,
        eventBus,
        registerBuilding(id, buildingType, race = Race.Roman) {
            buildingMeta.set(id, { buildingType, race });
        },
        createSlots(id, buildingType, race = Race.Roman) {
            buildingMeta.set(id, { buildingType, race });
            manager.createSlots(id, buildingType, race, stubPositionResolver);
        },
    };
}

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
    let tm: TestManager;

    beforeEach(() => {
        tm = makeManager();
    });

    it('should create slots with correct config and manage deposit/withdraw lifecycle', () => {
        tm.createSlots(100, BuildingType.Sawmill);

        const slots = tm.manager.getSlots(100);
        const inputSlot = slots.find(s => s.kind === SlotKind.Input && s.materialType === EMaterialType.LOG)!;
        const outputSlot = slots.find(s => s.kind === SlotKind.Output && s.materialType === EMaterialType.BOARD)!;

        expect(inputSlot.materialType).toBe(EMaterialType.LOG);
        expect(inputSlot.maxCapacity).toBe(SLOT_CAPACITY);
        expect(outputSlot.materialType).toBe(EMaterialType.BOARD);

        // Deposit input
        tm.manager.depositInput(100, EMaterialType.LOG, 5);
        expect(inputSlot.currentAmount).toBe(5);

        // Deposit output and withdraw
        tm.manager.depositOutput(100, EMaterialType.BOARD, 5);
        const withdrawn = tm.manager.withdrawOutput(100, EMaterialType.BOARD, 3);
        expect(withdrawn).toBe(3);
        expect(outputSlot.currentAmount).toBe(2);
    });

    it('should throw when depositing wrong material type or accessing non-existent building', () => {
        tm.createSlots(100, BuildingType.Sawmill);
        expect(() => tm.manager.depositInput(100, EMaterialType.STONE, 5)).toThrow(/has no input slot for STONE/);
        expect(() => tm.manager.withdrawOutput(999, EMaterialType.BOARD, 5)).toThrow(/has no output slot for BOARD/);
    });

    it('should find buildings by material availability and need', () => {
        tm.createSlots(100, BuildingType.WoodcutterHut);
        tm.createSlots(101, BuildingType.WoodcutterHut);
        tm.createSlots(102, BuildingType.Sawmill);

        tm.manager.depositOutput(100, EMaterialType.LOG, 5);
        tm.manager.depositOutput(101, EMaterialType.LOG, 2);

        const withLogs = tm.manager.getSourcesWithOutput(EMaterialType.LOG);
        expect(withLogs).toContain(100);
        expect(withLogs).toContain(101);
        expect(withLogs).not.toContain(102);

        // Minimum amount filter
        const withEnoughLogs = tm.manager.getSourcesWithOutput(EMaterialType.LOG, 3);
        expect(withEnoughLogs).toContain(100);
        expect(withEnoughLogs).not.toContain(101);

        // Buildings needing input
        tm.manager.depositInput(102, EMaterialType.LOG, SLOT_CAPACITY); // Fill sawmill 102
        tm.createSlots(103, BuildingType.Sawmill); // Empty sawmill 103
        const needingLogs = tm.manager.getSinksNeedingInput(EMaterialType.LOG);
        expect(needingLogs).toContain(103);
        expect(needingLogs).not.toContain(102);
    });

    it('should check production readiness based on all required inputs', () => {
        tm.createSlots(100, BuildingType.Bakery);

        // Missing both inputs
        expect(tm.manager.canStartProduction(100)).toBe(false);

        // Only one input available
        tm.manager.depositInput(100, EMaterialType.FLOUR, 1);
        expect(tm.manager.canStartProduction(100)).toBe(false);

        // Both inputs available
        tm.manager.depositInput(100, EMaterialType.WATER, 1);
        expect(tm.manager.canStartProduction(100)).toBe(true);
    });

    it('should emit inventory:changed events on deposit/withdraw and stop after unsubscribe', () => {
        const callback = vi.fn();
        tm.eventBus.on('inventory:changed', callback);

        tm.createSlots(100, BuildingType.Sawmill);

        tm.manager.depositInput(100, EMaterialType.LOG, 3);
        expect(callback).toHaveBeenCalledWith(
            expect.objectContaining({
                buildingId: 100,
                materialType: EMaterialType.LOG,
                slotType: 'input',
                previousAmount: 0,
                newAmount: 3,
            })
        );

        callback.mockClear();
        tm.eventBus.off('inventory:changed', callback);
        tm.manager.depositInput(100, EMaterialType.LOG, 2);
        expect(callback).not.toHaveBeenCalled();
    });
});
