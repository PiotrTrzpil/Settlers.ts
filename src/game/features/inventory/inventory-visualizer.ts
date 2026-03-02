/**
 * Building Inventory Visualizer
 *
 * Thin coordinator: listens for inventory changes and entity lifecycle events,
 * then delegates to InventoryLayout (position resolution) and MaterialStackState
 * (entity-ID tracking) to maintain visual stacked resource entities next to buildings.
 *
 * Visual layout:
 * - Outputs are displayed on the right side of the building, in upper positions
 * - Inputs are displayed on the right side of the building, in lower positions
 */

import type { GameState } from '../../game-state';
import type { BuildingInventoryManager } from './building-inventory';
import { BuildingType, MAX_RESOURCE_STACK_SIZE, type TileCoord } from '../../entity';
import { EMaterialType } from '../../economy/material-type';
import type { Command, CommandResult } from '../../commands';
import { type EventBus, EventSubscriptionManager } from '../../event-bus';
import { LogHandler } from '@/utilities/log-handler';
import type { BuildingPileRegistry } from './building-pile-registry';
import { MaterialStackState } from './material-stack-state';
import { InventoryLayout } from './inventory-layout';
import type { EntityCleanupRegistry } from '../../systems/entity-cleanup-registry';

const log = new LogHandler('InventoryVisualizer');

/**
 * Manages visual representation of building inventories.
 * Creates stacked resource entities next to buildings to show their input and output contents.
 */
export class InventoryVisualizer {
    private gameState: GameState;
    private inventoryManager: BuildingInventoryManager;
    private executeCommand: (cmd: Command) => CommandResult;

    private stackState: MaterialStackState;
    private layout: InventoryLayout;

    /** Bound handler for inventory changes */
    private changeHandler: (
        buildingId: number,
        materialType: EMaterialType,
        slotType: 'input' | 'output',
        previousAmount: number,
        newAmount: number
    ) => void;

    /** Tracked event subscriptions for cleanup */
    private readonly subscriptions = new EventSubscriptionManager();

    constructor(
        gameState: GameState,
        inventoryManager: BuildingInventoryManager,
        executeCommand: (cmd: Command) => CommandResult
    ) {
        this.gameState = gameState;
        this.inventoryManager = inventoryManager;
        this.executeCommand = executeCommand;

        this.stackState = new MaterialStackState(gameState, inventoryManager);
        this.layout = new InventoryLayout(gameState);

        this.changeHandler = this.onInventoryChange.bind(this);
        this.inventoryManager.onChange(this.changeHandler);
    }

    /** Set the pile registry (derived from XML game data). */
    setPileRegistry(registry: BuildingPileRegistry): void {
        this.layout.setPileRegistry(registry);
    }

    /**
     * Subscribe to entity lifecycle events.
     * Cleans up visual inventory stacks when buildings are removed.
     */
    registerEvents(_eventBus: EventBus, cleanupRegistry: EntityCleanupRegistry): void {
        cleanupRegistry.onEntityRemoved(this.removeBuilding.bind(this));
    }

    /** Unsubscribe from all tracked events. */
    unregisterEvents(): void {
        this.subscriptions.unsubscribeAll();
    }

    /** Clean up event listeners and internal state. */
    dispose(): void {
        this.unregisterEvents();
        this.inventoryManager.offChange(this.changeHandler);
        this.stackState.clear();
    }

    // --- Inventory change handling ---

    /**
     * Handle inventory change events.
     * Both input and output slot changes trigger visual updates.
     */
    private onInventoryChange(
        buildingId: number,
        materialType: EMaterialType,
        slotType: 'input' | 'output',
        _previousAmount: number,
        newAmount: number
    ): void {
        log.debug(`onChange: building=${buildingId}, ${EMaterialType[materialType]}, ${slotType}, amount=${newAmount}`);
        this.updateVisualStack(buildingId, materialType, slotType, newAmount);
    }

    /**
     * Update the visual stack for a specific material at a building.
     */
    private updateVisualStack(
        buildingId: number,
        materialType: EMaterialType,
        slotType: 'input' | 'output',
        quantity: number
    ): void {
        const visualState = this.stackState.getOrCreate(buildingId);
        if (!visualState) {
            log.warn(`Failed to get/create visual state for building ${buildingId}`);
            return;
        }

        const stackMap = this.stackState.getStackMap(visualState, slotType);
        const existingEntityId = stackMap.get(materialType);

        if (quantity <= 0) {
            if (existingEntityId !== undefined) {
                this.gameState.removeEntity(existingEntityId);
                this.stackState.deleteEntityId(buildingId, materialType, slotType);
            }
            return;
        }

        const visualQuantity = Math.min(quantity, MAX_RESOURCE_STACK_SIZE);

        if (existingEntityId !== undefined) {
            log.debug(`Updating stack ${existingEntityId} to qty ${visualQuantity}`);
            this.gameState.resources.setQuantity(existingEntityId, visualQuantity);
        } else {
            const position = this.layout.resolveStackPosition(buildingId, materialType, slotType, visualState);
            if (position) {
                const entity = this.createVisualStack(buildingId, materialType, position, visualQuantity, true);
                if (entity) {
                    log.debug(`Created stack ${entity.id} at (${position.x}, ${position.y})`);
                    this.stackState.setEntityId(buildingId, materialType, slotType, entity.id);
                } else {
                    log.warn(`Failed to create stack at (${position.x}, ${position.y})`);
                }
            } else {
                log.warn(`No position for ${slotType} stack`);
            }
        }
    }

    // --- Public query API ---

    /**
     * Get the position of a visual stack for a specific material at a building.
     * Used by carriers to walk to the correct stack position instead of the building center.
     */
    getStackPosition(buildingId: number, material: EMaterialType, slotType: 'input' | 'output'): TileCoord | null {
        const entityId = this.stackState.getEntityId(buildingId, material, slotType);
        if (entityId === undefined) return null;

        const entity = this.gameState.getEntity(entityId);
        if (!entity) return null;

        return { x: entity.x, y: entity.y };
    }

    /**
     * Release visual stacks when a building is destroyed.
     * The resource piles become free (available for pickup by carriers).
     */
    removeBuilding(buildingId: number): void {
        const state = this.stackState.get(buildingId);
        if (!state) return;

        for (const entityId of state.outputStacks.values()) {
            this.gameState.resources.setBuildingId(entityId, undefined);
        }
        for (const entityId of state.inputStacks.values()) {
            this.gameState.resources.setBuildingId(entityId, undefined);
        }

        this.stackState.remove(buildingId);
    }

    // --- Refresh / bulk rebuild ---

    /**
     * Rebuild visual positions for all buildings of a given type.
     * Called after stack position config changes to apply the new layout everywhere.
     */
    refreshBuildingType(buildingType: BuildingType): void {
        this.removeVisualsForType(buildingType);
        this.recreateVisualsForType(buildingType);
    }

    /** Remove all visual stacks for buildings of a specific type. */
    private removeVisualsForType(buildingType: BuildingType): void {
        for (const buildingId of this.stackState.getAllBuildingIds()) {
            const building = this.gameState.getEntity(buildingId);
            if (!building || (building.subType as BuildingType) !== buildingType) continue;

            const state = this.stackState.get(buildingId);
            if (!state)
                throw new Error(
                    `InventoryVisualizer: no stack state for building ${buildingId} (removeVisualsForType)`
                );
            for (const entityId of state.outputStacks.values()) this.gameState.removeEntity(entityId);
            for (const entityId of state.inputStacks.values()) this.gameState.removeEntity(entityId);
            this.stackState.remove(buildingId);
        }
    }

    /** Recreate visual stacks for all buildings of a specific type using current positions. */
    private recreateVisualsForType(buildingType: BuildingType): void {
        for (const buildingId of this.inventoryManager.getAllBuildingIds()) {
            const building = this.gameState.getEntity(buildingId);
            if (!building || (building.subType as BuildingType) !== buildingType) continue;

            const inventory = this.inventoryManager.getInventory(buildingId);
            if (!inventory) continue;

            for (const slot of inventory.outputSlots) {
                if (slot.currentAmount > 0) {
                    this.updateVisualStack(buildingId, slot.materialType, 'output', slot.currentAmount);
                }
            }
            for (const slot of inventory.inputSlots) {
                if (slot.currentAmount > 0) {
                    this.updateVisualStack(buildingId, slot.materialType, 'input', slot.currentAmount);
                }
            }
        }
    }

    // --- Initialization ---

    /**
     * Initialize visuals for all existing buildings with inventory.
     * Call this after loading a map with pre-existing buildings.
     */
    initializeExistingBuildings(): void {
        for (const buildingId of this.inventoryManager.getAllBuildingIds()) {
            const inventory = this.inventoryManager.getInventory(buildingId);
            if (!inventory) continue;

            for (const slot of inventory.outputSlots) {
                if (slot.currentAmount > 0) {
                    this.updateVisualStack(buildingId, slot.materialType, 'output', slot.currentAmount);
                }
            }
            for (const slot of inventory.inputSlots) {
                if (slot.currentAmount > 0) {
                    this.updateVisualStack(buildingId, slot.materialType, 'input', slot.currentAmount);
                }
            }
        }
    }

    /**
     * Rebuild visualizer state from existing StackedResource entities.
     * Call this after HMR or game restore to reconnect with existing visual stacks.
     */
    rebuildFromExistingEntities(): void {
        this.stackState.rebuildFromExistingEntities();
    }

    // --- Debug helpers ---

    /** Get all building IDs with visual states (for debug highlighting). */
    getVisualBuildingIds(): number[] {
        return this.stackState.getAllBuildingIds();
    }

    /** Get all stack entity IDs for a building (for debug highlighting). */
    getStackEntityIds(buildingId: number): { entityId: number; slotType: 'input' | 'output' }[] {
        const state = this.stackState.get(buildingId);
        if (!state) return [];

        const result: { entityId: number; slotType: 'input' | 'output' }[] = [];
        for (const entityId of state.outputStacks.values()) {
            result.push({ entityId, slotType: 'output' });
        }
        for (const entityId of state.inputStacks.values()) {
            result.push({ entityId, slotType: 'input' });
        }
        return result;
    }

    // --- Entity creation ---

    /**
     * Create a visual stacked resource entity via the command pipeline.
     * @param reserveForBuilding If true, marks the resource as belonging to the building
     */
    private createVisualStack(
        buildingId: number,
        materialType: EMaterialType,
        position: TileCoord,
        quantity: number,
        reserveForBuilding: boolean
    ): { id: number } | null {
        const building = this.gameState.getEntity(buildingId);
        if (!building) return null;

        const result = this.executeCommand({
            type: 'spawn_visual_resource',
            materialType,
            x: position.x,
            y: position.y,
            player: building.player,
            quantity,
            buildingId: reserveForBuilding ? buildingId : undefined,
        });

        if (!result.success || !result.effects?.length) return null;

        const entityId = (result.effects[0] as { entityId: number }).entityId;
        return { id: entityId };
    }
}
