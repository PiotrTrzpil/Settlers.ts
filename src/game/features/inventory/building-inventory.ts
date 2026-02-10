/**
 * Building inventory management.
 * Tracks input/output slots for each building's material storage.
 */

import { BuildingType } from '../../entity';
import { EMaterialType } from '../../economy/material-type';
import { BUILDING_PRODUCTIONS } from '../../economy/building-production';
import type { InventorySlot } from './inventory-slot';
import { createSlot, deposit, withdraw, canAccept, canProvide, getAvailableSpace } from './inventory-slot';
import { getInventoryConfig, type SlotConfig } from './inventory-configs';

/**
 * Complete inventory state for a building.
 */
export interface BuildingInventory {
    /** Entity ID of the building this inventory belongs to */
    buildingId: number;
    /** Building type for reference */
    buildingType: BuildingType;
    /** Input slots for materials consumed by production */
    inputSlots: InventorySlot[];
    /** Output slots for materials produced */
    outputSlots: InventorySlot[];
}

/**
 * Callback for inventory change events.
 */
export type InventoryChangeCallback = (
    buildingId: number,
    materialType: EMaterialType,
    slotType: 'input' | 'output',
    previousAmount: number,
    newAmount: number
) => void;

/**
 * Manages building inventories across the game.
 * Provides methods to create, query, and modify building inventories.
 */
export class BuildingInventoryManager {
    private inventories: Map<number, BuildingInventory> = new Map();
    private changeListeners: Set<InventoryChangeCallback> = new Set();

    /**
     * Register a callback for inventory changes.
     * @param callback Function to call when inventory changes
     */
    onChange(callback: InventoryChangeCallback): void {
        this.changeListeners.add(callback);
    }

    /**
     * Unregister a change callback.
     * @param callback The callback to remove
     */
    offChange(callback: InventoryChangeCallback): void {
        this.changeListeners.delete(callback);
    }

    /**
     * Emit an inventory change event to all listeners.
     */
    private emitChange(
        buildingId: number,
        materialType: EMaterialType,
        slotType: 'input' | 'output',
        previousAmount: number,
        newAmount: number
    ): void {
        if (previousAmount === newAmount) return; // No actual change
        for (const listener of this.changeListeners) {
            listener(buildingId, materialType, slotType, previousAmount, newAmount);
        }
    }

    /**
     * Create an inventory for a building based on its type.
     * @param buildingId Entity ID of the building
     * @param buildingType Type of building
     * @returns The created inventory
     */
    createInventory(buildingId: number, buildingType: BuildingType): BuildingInventory {
        const config = getInventoryConfig(buildingType);

        const inventory: BuildingInventory = {
            buildingId,
            buildingType,
            inputSlots: config.inputSlots.map((slotConfig: SlotConfig) =>
                createSlot(slotConfig.materialType, slotConfig.maxCapacity)
            ),
            outputSlots: config.outputSlots.map((slotConfig: SlotConfig) =>
                createSlot(slotConfig.materialType, slotConfig.maxCapacity)
            ),
        };

        this.inventories.set(buildingId, inventory);
        return inventory;
    }

    /**
     * Get the inventory for a building.
     * @param buildingId Entity ID of the building
     * @returns The building's inventory, or undefined if not found
     */
    getInventory(buildingId: number): BuildingInventory | undefined {
        return this.inventories.get(buildingId);
    }

    /**
     * Remove a building's inventory.
     * @param buildingId Entity ID of the building
     * @returns True if inventory was removed, false if not found
     */
    removeInventory(buildingId: number): boolean {
        return this.inventories.delete(buildingId);
    }

    /**
     * Get an input slot for a specific material type.
     * @param buildingId Entity ID of the building
     * @param materialType Material type to find
     * @returns The input slot, or undefined if not found
     */
    getInputSlot(buildingId: number, materialType: EMaterialType): InventorySlot | undefined {
        const inventory = this.inventories.get(buildingId);
        if (!inventory) return undefined;
        return inventory.inputSlots.find(slot => slot.materialType === materialType);
    }

    /**
     * Get an output slot for a specific material type.
     * @param buildingId Entity ID of the building
     * @param materialType Material type to find
     * @returns The output slot, or undefined if not found
     */
    getOutputSlot(buildingId: number, materialType: EMaterialType): InventorySlot | undefined {
        const inventory = this.inventories.get(buildingId);
        if (!inventory) return undefined;
        return inventory.outputSlots.find(slot => slot.materialType === materialType);
    }

    /**
     * Deposit material into a building's input slot.
     * @param buildingId Entity ID of the building
     * @param materialType Material type to deposit
     * @param amount Amount to deposit
     * @returns Amount deposited (may be less than requested if slot is full)
     */
    depositInput(buildingId: number, materialType: EMaterialType, amount: number): number {
        const slot = this.getInputSlot(buildingId, materialType);
        if (!slot) return 0;

        const previousAmount = slot.currentAmount;
        const overflow = deposit(slot, amount);
        const deposited = amount - overflow;

        if (deposited > 0) {
            this.emitChange(buildingId, materialType, 'input', previousAmount, slot.currentAmount);
        }

        return deposited;
    }

    /**
     * Withdraw material from a building's output slot.
     * @param buildingId Entity ID of the building
     * @param materialType Material type to withdraw
     * @param amount Amount to withdraw
     * @returns Actual amount withdrawn (may be less than requested)
     */
    withdrawOutput(buildingId: number, materialType: EMaterialType, amount: number): number {
        const slot = this.getOutputSlot(buildingId, materialType);
        if (!slot) return 0;

        const previousAmount = slot.currentAmount;
        const withdrawn = withdraw(slot, amount);

        if (withdrawn > 0) {
            this.emitChange(buildingId, materialType, 'output', previousAmount, slot.currentAmount);
        }

        return withdrawn;
    }

    /**
     * Check if a building can accept material into its input.
     * @param buildingId Entity ID of the building
     * @param materialType Material type to check
     * @param amount Amount to check
     * @returns True if the building can accept the material
     */
    canAcceptInput(buildingId: number, materialType: EMaterialType, amount: number): boolean {
        const slot = this.getInputSlot(buildingId, materialType);
        if (!slot) return false;
        return canAccept(slot, materialType, amount);
    }

    /**
     * Check if a building can provide material from its output.
     * @param buildingId Entity ID of the building
     * @param materialType Material type to check
     * @param amount Amount to check
     * @returns True if the building has enough material
     */
    canProvideOutput(buildingId: number, materialType: EMaterialType, amount: number): boolean {
        const slot = this.getOutputSlot(buildingId, materialType);
        if (!slot) return false;
        return canProvide(slot, materialType, amount);
    }

    /**
     * Get available space in a building's input slot.
     * @param buildingId Entity ID of the building
     * @param materialType Material type to check
     * @returns Available space, or 0 if slot not found
     */
    getInputSpace(buildingId: number, materialType: EMaterialType): number {
        const slot = this.getInputSlot(buildingId, materialType);
        if (!slot) return 0;
        return getAvailableSpace(slot);
    }

    /**
     * Get amount in a building's input slot.
     * @param buildingId Entity ID of the building
     * @param materialType Material type to check
     * @returns Amount in slot, or 0 if slot not found
     */
    getInputAmount(buildingId: number, materialType: EMaterialType): number {
        const slot = this.getInputSlot(buildingId, materialType);
        return slot?.currentAmount ?? 0;
    }

    /**
     * Get amount available in a building's output slot.
     * @param buildingId Entity ID of the building
     * @param materialType Material type to check
     * @returns Amount available, or 0 if slot not found
     */
    getOutputAmount(buildingId: number, materialType: EMaterialType): number {
        const slot = this.getOutputSlot(buildingId, materialType);
        return slot?.currentAmount ?? 0;
    }

    /**
     * Deposit material into a building's output slot (used by production).
     * @param buildingId Entity ID of the building
     * @param materialType Material type to deposit
     * @param amount Amount to deposit
     * @returns Amount deposited (may be less than requested if slot is full)
     */
    depositOutput(buildingId: number, materialType: EMaterialType, amount: number): number {
        const slot = this.getOutputSlot(buildingId, materialType);
        if (!slot) return 0;

        const previousAmount = slot.currentAmount;
        const overflow = deposit(slot, amount);
        const deposited = amount - overflow;

        if (deposited > 0) {
            this.emitChange(buildingId, materialType, 'output', previousAmount, slot.currentAmount);
        }

        return deposited;
    }

    /**
     * Withdraw material from a building's input slot (used by production).
     * @param buildingId Entity ID of the building
     * @param materialType Material type to withdraw
     * @param amount Amount to withdraw
     * @returns Actual amount withdrawn (may be less than requested)
     */
    withdrawInput(buildingId: number, materialType: EMaterialType, amount: number): number {
        const slot = this.getInputSlot(buildingId, materialType);
        if (!slot) return 0;

        const previousAmount = slot.currentAmount;
        const withdrawn = withdraw(slot, amount);

        if (withdrawn > 0) {
            this.emitChange(buildingId, materialType, 'input', previousAmount, slot.currentAmount);
        }

        return withdrawn;
    }

    /**
     * Check if a building has all required inputs to start production.
     * Uses BUILDING_PRODUCTIONS to determine what inputs are needed.
     * @param buildingId Entity ID of the building
     * @returns True if all required inputs are available (at least 1 of each)
     */
    canStartProduction(buildingId: number): boolean {
        const inventory = this.inventories.get(buildingId);
        if (!inventory) return false;

        const production = BUILDING_PRODUCTIONS.get(inventory.buildingType);
        if (!production) return false;

        // Check that we have at least 1 of each required input
        for (const inputMaterial of production.inputs) {
            const slot = inventory.inputSlots.find(s => s.materialType === inputMaterial);
            if (!slot || slot.currentAmount < 1) {
                return false;
            }
        }

        return true;
    }

    /**
     * Check if a building's output has space for production result.
     * @param buildingId Entity ID of the building
     * @returns True if output slot has space (or building has no output)
     */
    canStoreOutput(buildingId: number): boolean {
        const inventory = this.inventories.get(buildingId);
        if (!inventory) return false;

        const production = BUILDING_PRODUCTIONS.get(inventory.buildingType);
        if (!production) return true; // No production = always ok

        if (production.output === EMaterialType.NO_MATERIAL) {
            return true; // No output material
        }

        const slot = inventory.outputSlots.find(s => s.materialType === production.output);
        if (!slot) return false;

        return slot.currentAmount < slot.maxCapacity;
    }

    /**
     * Get all building IDs that have inventories.
     */
    getAllBuildingIds(): number[] {
        return Array.from(this.inventories.keys());
    }

    /**
     * Get all buildings that have a specific material available in output.
     * @param materialType Material type to find
     * @param minAmount Minimum amount required (default: 1)
     * @returns Array of building IDs with the material available
     */
    getBuildingsWithOutput(materialType: EMaterialType, minAmount: number = 1): number[] {
        const result: number[] = [];
        for (const [buildingId, inventory] of this.inventories) {
            const slot = inventory.outputSlots.find(s => s.materialType === materialType);
            if (slot && slot.currentAmount >= minAmount) {
                result.push(buildingId);
            }
        }
        return result;
    }

    /**
     * Get all buildings that need a specific material (have space in input).
     * @param materialType Material type to find
     * @param minSpace Minimum space required (default: 1)
     * @returns Array of building IDs that need the material
     */
    getBuildingsNeedingInput(materialType: EMaterialType, minSpace: number = 1): number[] {
        const result: number[] = [];
        for (const [buildingId, inventory] of this.inventories) {
            const slot = inventory.inputSlots.find(s => s.materialType === materialType);
            if (slot && getAvailableSpace(slot) >= minSpace) {
                result.push(buildingId);
            }
        }
        return result;
    }

    /**
     * Clear all inventories.
     */
    clear(): void {
        this.inventories.clear();
    }

    /**
     * Get all inventories.
     */
    getAllInventories(): IterableIterator<BuildingInventory> {
        return this.inventories.values();
    }

    /**
     * Restore an inventory from serialized state (used by persistence).
     */
    restoreInventory(data: {
        entityId: number;
        buildingType: BuildingType;
        inputSlots: Array<{ materialType: EMaterialType; current: number; max: number; reserved: number }>;
        outputSlots: Array<{ materialType: EMaterialType; current: number; max: number; reserved: number }>;
    }): void {
        const inventory: BuildingInventory = {
            buildingId: data.entityId,
            buildingType: data.buildingType,
            inputSlots: data.inputSlots.map(s => ({
                materialType: s.materialType,
                currentAmount: s.current,
                maxCapacity: s.max,
                reservedAmount: s.reserved,
            })),
            outputSlots: data.outputSlots.map(s => ({
                materialType: s.materialType,
                currentAmount: s.current,
                maxCapacity: s.max,
                reservedAmount: s.reserved,
            })),
        };

        this.inventories.set(data.entityId, inventory);
    }
}
