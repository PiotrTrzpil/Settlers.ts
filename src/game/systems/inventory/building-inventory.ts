/**
 * Building inventory management.
 * Tracks input/output slots for each building's material storage.
 */

import { BuildingType } from '../../entity';
import { EMaterialType } from '../../economy/material-type';
import { Race } from '../../core/race';
import { BUILDING_PRODUCTIONS, type Recipe } from '../../economy/building-production';
import type { InventorySlot } from './inventory-slot';
import {
    createSlot,
    deposit,
    withdraw,
    canAccept,
    canProvide,
    getAvailableSpace,
    reserve,
    releaseReservation,
    withdrawReserved,
    getUnreservedAmount,
} from './inventory-slot';
import { getInventoryConfig, type SlotConfig, type InventoryConfig } from './inventory-configs';
import { type ComponentStore, mapStore } from '../../ecs';
import { createLogger } from '@/utilities/logger';
import type { Persistable } from '@/game/persistence';

const log = createLogger('BuildingInventory');

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

// ── Serialization types ──

export interface SerializedInventorySlot {
    materialType: EMaterialType;
    current: number;
    max: number;
    reserved: number;
}

export interface SerializedBuildingInventory {
    entityId: number;
    buildingType: number;
    inputSlots: SerializedInventorySlot[];
    outputSlots: SerializedInventorySlot[];
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

let _instanceCounter = 0;

/**
 * Manages building inventories across the game.
 * Provides methods to create, query, and modify building inventories.
 */
export class BuildingInventoryManager implements Persistable<SerializedBuildingInventory[]> {
    readonly persistKey = 'buildingInventories' as const;
    private inventories: Map<number, BuildingInventory> = new Map();

    /** Uniform read-only view for cross-cutting queries */
    readonly store: ComponentStore<BuildingInventory> = mapStore(this.inventories);

    private changeListeners: Set<InventoryChangeCallback> = new Set();
    private allowedMaterials = new Map<number, Set<EMaterialType>>();
    private _debugId = ++_instanceCounter;

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
        log.debug(
            `#${this._debugId} emitChange: building=${buildingId}, ${slotType}, ${previousAmount}->${newAmount}, listeners=${this.changeListeners.size}`
        );
        for (const listener of this.changeListeners) {
            listener(buildingId, materialType, slotType, previousAmount, newAmount);
        }
    }

    /**
     * Create an inventory for a building using an explicit configuration.
     * Used for construction inventories where the config differs from the production config.
     * @param buildingId Entity ID of the building
     * @param buildingType Type of building (for reference in inventory object)
     * @param config Explicit inventory configuration to use
     * @returns The created inventory
     */
    createInventoryFromConfig(
        buildingId: number,
        buildingType: BuildingType,
        config: InventoryConfig
    ): BuildingInventory {
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
     * Create an inventory for a building based on its type.
     * @param buildingId Entity ID of the building
     * @param buildingType Type of building
     * @returns The created inventory
     */
    createInventory(buildingId: number, buildingType: BuildingType, race: Race): BuildingInventory {
        const config = getInventoryConfig(buildingType, race);

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
     * Destroy a building's inventory, releasing all slots.
     * Called by the cleanup registry LATE handler when a building entity is removed.
     * @param buildingId Entity ID of the building
     * @returns True if inventory was found and removed, false if not found
     */
    destroyBuildingInventory(buildingId: number): boolean {
        this.allowedMaterials.delete(buildingId);
        return this.inventories.delete(buildingId);
    }

    /**
     * @deprecated Use destroyBuildingInventory instead.
     */
    removeInventory(buildingId: number): boolean {
        return this.destroyBuildingInventory(buildingId);
    }

    /**
     * Atomically swap from construction inventory to production inventory.
     * Destroys the existing (construction) inventory and creates a fresh production inventory.
     * Emits NO change events — InventoryPileSync handles pile clearing before this is called,
     * and the new inventory starts empty.
     * @param buildingId Entity ID of the building
     * @param buildingType Type of the completed building
     */
    swapInventoryPhase(buildingId: number, buildingType: BuildingType, race: Race): void {
        this.destroyBuildingInventory(buildingId);
        this.createInventory(buildingId, buildingType, race);
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
        return inventory.outputSlots.find(s => s.materialType === materialType);
    }

    private getInputSlotOrThrow(buildingId: number, materialType: EMaterialType): InventorySlot {
        return this.getSlotOrThrow(buildingId, materialType, 'input');
    }

    private getOutputSlotOrThrow(buildingId: number, materialType: EMaterialType): InventorySlot {
        return this.getSlotOrThrow(buildingId, materialType, 'output');
    }

    private getSlotOrThrow(buildingId: number, materialType: EMaterialType, kind: 'input' | 'output'): InventorySlot {
        const inventory = this.inventories.get(buildingId);
        if (!inventory) {
            throw new Error(
                `Building ${buildingId} has no inventory. Known: [${[...this.inventories.keys()].join(', ')}]`
            );
        }
        const slots = kind === 'input' ? inventory.inputSlots : inventory.outputSlots;
        const slot = slots.find(s => s.materialType === materialType);
        if (!slot) {
            throw new Error(
                `Building ${buildingId} (${BuildingType[inventory.buildingType]}) has no ${kind} slot for ` +
                    `${EMaterialType[materialType]}. Has: [${slots.map(s => EMaterialType[s.materialType]).join(', ')}]`
            );
        }
        return slot;
    }

    /**
     * Deposit material into a building's input slot.
     * @param buildingId Entity ID of the building
     * @param materialType Material type to deposit
     * @param amount Amount to deposit
     * @returns Amount deposited (may be less than requested if slot is full)
     */
    depositInput(buildingId: number, materialType: EMaterialType, amount: number): number {
        const slot = this.getInputSlotOrThrow(buildingId, materialType);

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
     * For StorageArea buildings, frees the dynamic slot back to NO_MATERIAL when it drains to zero.
     * @param buildingId Entity ID of the building
     * @param materialType Material type to withdraw
     * @param amount Amount to withdraw
     * @returns Actual amount withdrawn (may be less than requested)
     */
    withdrawOutput(buildingId: number, materialType: EMaterialType, amount: number): number {
        if (this.isStorageArea(buildingId)) {
            const inventory = this.inventories.get(buildingId);
            if (!inventory)
                throw new Error(`No inventory for building ${buildingId} in BuildingInventoryManager.withdrawOutput`);
            const slot = inventory.outputSlots.find(s => s.materialType === materialType);
            if (!slot || slot.currentAmount < amount) return 0;
            const prev = slot.currentAmount;
            const withdrawn = Math.min(amount, slot.currentAmount);
            slot.currentAmount -= withdrawn;
            if (slot.currentAmount === 0) {
                slot.materialType = EMaterialType.NO_MATERIAL; // Free this slot for the next material
            }
            this.emitChange(buildingId, materialType, 'output', prev, slot.currentAmount);
            return withdrawn;
        }

        const slot = this.getOutputSlotOrThrow(buildingId, materialType);

        const previousAmount = slot.currentAmount;
        const withdrawn = withdraw(slot, amount);

        if (withdrawn > 0) {
            this.emitChange(buildingId, materialType, 'output', previousAmount, slot.currentAmount);
        }

        return withdrawn;
    }

    /**
     * Reserve material in a building's output slot for a pending carrier pickup.
     * Prevents other carriers from claiming the same material.
     * @param buildingId Entity ID of the building
     * @param materialType Material type to reserve
     * @param amount Amount to reserve
     * @returns Amount actually reserved (may be less if not enough unreserved)
     */
    reserveOutput(buildingId: number, materialType: EMaterialType, amount: number): number {
        const slot = this.getOutputSlotOrThrow(buildingId, materialType);
        return reserve(slot, amount);
    }

    /**
     * Release a reservation on a building's output slot (when pickup fails or is cancelled).
     * @param buildingId Entity ID of the building
     * @param materialType Material type to release
     * @param amount Amount to release from reservation
     * @returns Amount actually released
     */
    releaseOutputReservation(buildingId: number, materialType: EMaterialType, amount: number): number {
        const slot = this.getOutputSlotOrThrow(buildingId, materialType);
        return releaseReservation(slot, amount);
    }

    /**
     * Withdraw from reserved output (for actual carrier pickup).
     * Releases reservation and withdraws in one atomic operation.
     * @param buildingId Entity ID of the building
     * @param materialType Material type to withdraw
     * @param amount Amount to withdraw from reserved
     * @returns Actual amount withdrawn
     */
    withdrawReservedOutput(buildingId: number, materialType: EMaterialType, amount: number): number {
        const slot = this.getOutputSlotOrThrow(buildingId, materialType);

        const previousAmount = slot.currentAmount;
        const withdrawn = withdrawReserved(slot, amount);

        if (withdrawn > 0) {
            this.emitChange(buildingId, materialType, 'output', previousAmount, slot.currentAmount);
        }

        return withdrawn;
    }

    /**
     * Get unreserved amount in a building's output slot.
     * @param buildingId Entity ID of the building
     * @param materialType Material type to check
     * @returns Amount available for new reservations
     */
    getUnreservedOutputAmount(buildingId: number, materialType: EMaterialType): number {
        const slot = this.getOutputSlot(buildingId, materialType);
        if (!slot) return 0;
        return getUnreservedAmount(slot);
    }

    /**
     * Check if a building can accept material into its input.
     * Throws if called on a StorageArea — use depositOutput instead.
     * @param buildingId Entity ID of the building
     * @param materialType Material type to check
     * @param amount Amount to check
     * @returns True if the building can accept the material
     */
    canAcceptInput(buildingId: number, materialType: EMaterialType, amount: number): boolean {
        if (this.isStorageArea(buildingId)) {
            throw new Error(`canAcceptInput called on StorageArea building ${buildingId} — use depositOutput instead`);
        }
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
     * Throws if called on a StorageArea — StorageArea has no input slots.
     * @param buildingId Entity ID of the building
     * @param materialType Material type to check
     * @returns Available space, or 0 if slot not found
     */
    getInputSpace(buildingId: number, materialType: EMaterialType): number {
        if (this.isStorageArea(buildingId)) {
            throw new Error(
                `getInputSpace called on StorageArea building ${buildingId} — StorageArea has no input slots`
            );
        }
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
     * Check whether a building is a StorageArea.
     * Used to gate dynamic-slot logic in depositOutput / withdrawOutput.
     */
    isStorageArea(buildingId: number): boolean {
        return this.inventories.get(buildingId)?.buildingType === BuildingType.StorageArea;
    }

    /**
     * Get remaining capacity for a material in a StorageArea.
     * Accounts for existing assigned slots and free (NO_MATERIAL) slots.
     * Returns 0 for non-StorageArea buildings.
     */
    getStorageOutputSpace(buildingId: number, materialType: EMaterialType): number {
        const inventory = this.inventories.get(buildingId);
        if (!inventory || inventory.buildingType !== BuildingType.StorageArea) return 0;
        let space = 0;
        for (const slot of inventory.outputSlots) {
            if (slot.materialType === materialType) {
                space += slot.maxCapacity - slot.currentAmount;
            } else if (slot.materialType === EMaterialType.NO_MATERIAL && slot.currentAmount === 0) {
                space += slot.maxCapacity;
            }
        }
        return space;
    }

    /**
     * Free any empty StorageArea output slots assigned to the given material.
     * Called when a material direction is disabled so the slot can be reused.
     * Slots with material still in them are left untouched.
     */
    freeEmptyStorageSlots(buildingId: number, materialType: EMaterialType): void {
        const inventory = this.inventories.get(buildingId);
        if (!inventory || inventory.buildingType !== BuildingType.StorageArea) return;
        for (const slot of inventory.outputSlots) {
            if (slot.materialType === materialType && slot.currentAmount === 0) {
                slot.materialType = EMaterialType.NO_MATERIAL;
            }
        }
    }

    /**
     * Get the set of allowed materials for a StorageArea building.
     * The actual routing filter lives in StorageFilterManager — this is a read-only view.
     * @param buildingId Entity ID of the building
     * @returns ReadonlySet of allowed material types (empty set = nothing configured)
     */
    getAllowedMaterials(buildingId: number): ReadonlySet<EMaterialType> {
        return this.allowedMaterials.get(buildingId) ?? new Set();
    }

    /**
     * Configure whether a specific material is allowed into this building's storage.
     * Note: The isAllowed check lives ONLY in logistics routing — depositOutput does NOT enforce it.
     * @param buildingId Entity ID of the building
     * @param material Material type to configure
     * @param allowed True to allow, false to disallow
     */
    setAllowedMaterial(buildingId: number, material: EMaterialType, allowed: boolean): void {
        let set = this.allowedMaterials.get(buildingId);
        if (!set) {
            set = new Set();
            this.allowedMaterials.set(buildingId, set);
        }
        if (allowed) set.add(material);
        else set.delete(material);
    }

    /**
     * Deposit material into a building's output slot (used by production).
     * For StorageArea buildings, uses dynamic slot assignment:
     *   1. Find an existing slot with the matching material type.
     *   2. If none, claim the first free slot (NO_MATERIAL with amount 0) and assign it.
     *   3. If all slots are occupied, return 0.
     * @param buildingId Entity ID of the building
     * @param materialType Material type to deposit
     * @param amount Amount to deposit
     * @returns Amount deposited (may be less than requested if slot is full)
     */
    depositOutput(buildingId: number, materialType: EMaterialType, amount: number): number {
        log.debug(`#${this._debugId} depositOutput: building=${buildingId}, listeners=${this.changeListeners.size}`);

        if (this.isStorageArea(buildingId)) {
            const inventory = this.inventories.get(buildingId);
            if (!inventory)
                throw new Error(`No inventory for building ${buildingId} in BuildingInventoryManager.depositOutput`);
            // 1. Find an existing slot already assigned to this material
            let slot = inventory.outputSlots.find(s => s.materialType === materialType);
            if (!slot) {
                // 2. Find a free slot (NO_MATERIAL sentinel with no contents) and assign it
                slot = inventory.outputSlots.find(
                    s => s.materialType === EMaterialType.NO_MATERIAL && s.currentAmount === 0
                );
                if (!slot) return 0; // All dynamic slots are occupied
                slot.materialType = materialType;
            }
            const deposited = Math.min(amount, slot.maxCapacity - slot.currentAmount);
            if (deposited <= 0) return 0;
            const prev = slot.currentAmount;
            slot.currentAmount += deposited;
            this.emitChange(buildingId, materialType, 'output', prev, slot.currentAmount);
            return deposited;
        }

        const slot = this.getOutputSlotOrThrow(buildingId, materialType);

        const previousAmount = slot.currentAmount;
        const overflow = deposit(slot, amount);
        const deposited = amount - overflow;

        log.debug(
            `#${this._debugId} depositOutput: prev=${previousAmount}, deposited=${deposited}, overflow=${overflow}`
        );

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
        const slot = this.getInputSlotOrThrow(buildingId, materialType);

        const previousAmount = slot.currentAmount;
        const withdrawn = withdraw(slot, amount);

        if (withdrawn > 0) {
            this.emitChange(buildingId, materialType, 'input', previousAmount, slot.currentAmount);
        }

        return withdrawn;
    }

    /**
     * Check if a building has all required inputs to start production.
     * Uses BUILDING_PRODUCTIONS to determine what inputs are needed, or the provided recipe if given.
     * @param buildingId Entity ID of the building
     * @param recipe Optional specific recipe to check against (overrides BUILDING_PRODUCTIONS lookup)
     * @returns True if all required inputs are available (at least 1 of each)
     */
    canStartProduction(buildingId: number, recipe?: Recipe): boolean {
        const inventory = this.inventories.get(buildingId);
        if (!inventory) return false;

        const inputs = recipe ? recipe.inputs : BUILDING_PRODUCTIONS.get(inventory.buildingType)?.inputs;
        if (!inputs) return false;

        // Check that we have at least 1 of each required input
        for (const inputMaterial of inputs) {
            const slot = inventory.inputSlots.find(s => s.materialType === inputMaterial);
            if (!slot || slot.currentAmount < 1) {
                return false;
            }
        }

        return true;
    }

    /**
     * Consume inputs for one production cycle.
     * Withdraws 1 of each required input material.
     * @param buildingId Entity ID of the building
     * @param recipe Optional specific recipe to consume inputs for (overrides BUILDING_PRODUCTIONS lookup)
     * @returns True if inputs were consumed successfully
     */
    consumeProductionInputs(buildingId: number, recipe?: Recipe): boolean {
        const inventory = this.inventories.get(buildingId);
        if (!inventory) return false;

        const inputs = recipe ? recipe.inputs : BUILDING_PRODUCTIONS.get(inventory.buildingType)?.inputs;
        if (!inputs) return false;

        // Consume 1 of each required input
        for (const inputMaterial of inputs) {
            this.withdrawInput(buildingId, inputMaterial, 1);
        }

        return true;
    }

    /**
     * Produce output for one production cycle.
     * Deposits 1 of the output material.
     * @param buildingId Entity ID of the building
     * @param recipe Optional specific recipe whose output to produce (overrides BUILDING_PRODUCTIONS lookup)
     * @returns True if output was produced successfully
     */
    produceOutput(buildingId: number, recipe?: Recipe): boolean {
        const inventory = this.inventories.get(buildingId);
        if (!inventory) return false;

        const output = recipe ? recipe.output : BUILDING_PRODUCTIONS.get(inventory.buildingType)?.output;
        if (output === undefined || output === EMaterialType.NO_MATERIAL) return false;

        const deposited = this.depositOutput(buildingId, output, 1);
        return deposited > 0;
    }

    /**
     * Check if a building's output has space for production result.
     * @param buildingId Entity ID of the building
     * @param recipe Optional specific recipe whose output slot to check (overrides BUILDING_PRODUCTIONS lookup)
     * @returns True if output slot has space (or building has no output)
     */
    canStoreOutput(buildingId: number, recipe?: Recipe): boolean {
        const inventory = this.inventories.get(buildingId);
        if (!inventory) return false;

        const output = recipe ? recipe.output : BUILDING_PRODUCTIONS.get(inventory.buildingType)?.output;
        if (output === undefined) return true; // No production = always ok
        if (output === EMaterialType.NO_MATERIAL) return true; // No output material

        const slot = inventory.outputSlots.find(s => s.materialType === output);
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

    // ── Persistable implementation ──

    serialize(): SerializedBuildingInventory[] {
        const result: SerializedBuildingInventory[] = [];
        for (const inv of this.getAllInventories()) {
            result.push({
                entityId: inv.buildingId,
                buildingType: inv.buildingType,
                inputSlots: this.serializeSlots(inv.inputSlots),
                outputSlots: this.serializeSlots(inv.outputSlots),
            });
        }
        return result;
    }

    deserialize(data: SerializedBuildingInventory[]): void {
        // Reservations are now fully persisted — restore exact slot state including reserved counts
        for (const inv of data) {
            this.restoreInventory(inv);
        }
    }

    private serializeSlots(slots: InventorySlot[]): SerializedInventorySlot[] {
        return slots.map(s => ({
            materialType: s.materialType,
            current: s.currentAmount,
            max: s.maxCapacity,
            reserved: s.reservedAmount,
        }));
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
        const toSlot = (s: {
            materialType: EMaterialType;
            current: number;
            max: number;
            reserved: number;
        }): InventorySlot => ({
            materialType: s.materialType,
            currentAmount: s.current,
            maxCapacity: s.max,
            reservedAmount: s.reserved,
        });

        this.inventories.set(data.entityId, {
            buildingId: data.entityId,
            buildingType: data.buildingType,
            inputSlots: data.inputSlots.map(toSlot),
            outputSlots: data.outputSlots.map(toSlot),
        });
    }
}
