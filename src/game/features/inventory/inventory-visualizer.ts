/**
 * Building Inventory Visualizer
 *
 * Syncs building inventory to visual stacked resource entities.
 * When a building's input or output slots contain materials, this system creates/updates
 * stacked resource entities next to the building for visual feedback.
 *
 * Visual layout:
 * - Outputs are displayed on the right side of the building, in upper positions
 * - Inputs are displayed on the right side of the building, in lower positions
 */

import type { GameState } from '../../game-state';
import type { BuildingInventoryManager } from './building-inventory';
import { BuildingType, EntityType, getBuildingSize, tileKey, type TileCoord } from '../../entity';
import { EMaterialType } from '../../economy/material-type';
import { MAX_RESOURCE_STACK_SIZE } from '../../entity';
import { LogHandler } from '@/utilities/log-handler';

const log = new LogHandler('InventoryVisualizer');

/**
 * Tracks visual resources for a single building.
 * Maps material type to the stacked resource entity ID representing it.
 */
interface BuildingVisualState {
    buildingId: number;
    /** Map of materialType -> entityId for output visual stacks */
    outputStacks: Map<EMaterialType, number>;
    /** Map of materialType -> entityId for input visual stacks */
    inputStacks: Map<EMaterialType, number>;
    /** Positions available for placing output resource stacks (right side, upper) */
    outputPositions: TileCoord[];
    /** Positions available for placing input resource stacks (right side, lower) */
    inputPositions: TileCoord[];
}

/**
 * Manages visual representation of building inventories.
 * Creates stacked resource entities next to buildings to show their input and output contents.
 */
export class InventoryVisualizer {
    private gameState: GameState;
    private inventoryManager: BuildingInventoryManager;

    /** Tracks visual state per building */
    private buildingVisuals: Map<number, BuildingVisualState> = new Map();

    /** Bound handler for inventory changes */
    private changeHandler: (
        buildingId: number,
        materialType: EMaterialType,
        slotType: 'input' | 'output',
        previousAmount: number,
        newAmount: number
    ) => void;

    constructor(gameState: GameState, inventoryManager: BuildingInventoryManager) {
        this.gameState = gameState;
        this.inventoryManager = inventoryManager;

        // Bind the handler so we can unregister it later
        this.changeHandler = this.onInventoryChange.bind(this);
        this.inventoryManager.onChange(this.changeHandler);
    }

    /**
     * Clean up event listeners.
     */
    dispose(): void {
        this.inventoryManager.offChange(this.changeHandler);
        this.buildingVisuals.clear();
    }

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
        const visualState = this.getOrCreateVisualState(buildingId);
        if (!visualState) {
            log.warn(`Failed to get/create visual state for building ${buildingId}`);
            return;
        }

        const stackMap = slotType === 'output' ? visualState.outputStacks : visualState.inputStacks;
        const positions = slotType === 'output' ? visualState.outputPositions : visualState.inputPositions;
        const existingEntityId = stackMap.get(materialType);

        if (quantity <= 0) {
            // Remove the visual stack if quantity is zero
            if (existingEntityId !== undefined) {
                this.gameState.removeEntity(existingEntityId);
                stackMap.delete(materialType);
            }
            return;
        }

        // Clamp quantity to max stack size for visual representation
        const visualQuantity = Math.min(quantity, MAX_RESOURCE_STACK_SIZE);

        if (existingEntityId !== undefined) {
            // Update existing stack quantity
            log.debug(`Updating stack ${existingEntityId} to qty ${visualQuantity}`);
            this.gameState.setResourceQuantity(existingEntityId, visualQuantity);
        } else {
            // Create new visual stack
            const position = this.findStackPosition(visualState, slotType, positions);
            if (position) {
                // Both inputs and outputs are reserved - carriers must use inventory API
                const entity = this.createVisualStack(buildingId, materialType, position, visualQuantity, true);
                if (entity) {
                    log.debug(`Created stack ${entity.id} at (${position.x}, ${position.y})`);
                    stackMap.set(materialType, entity.id);
                } else {
                    log.warn(`Failed to create stack at (${position.x}, ${position.y})`);
                }
            } else {
                log.warn(`No position for ${slotType} stack. Available: ${positions.length}`);
            }
        }
    }

    /**
     * Get or create the visual state for a building.
     */
    private getOrCreateVisualState(buildingId: number): BuildingVisualState | null {
        let state = this.buildingVisuals.get(buildingId);
        if (state) return state;

        const building = this.gameState.getEntity(buildingId);
        if (!building || building.type !== EntityType.Building) {
            log.warn(`Building ${buildingId} not found or not a building`);
            return null;
        }

        const inventory = this.inventoryManager.getInventory(buildingId);
        if (!inventory) {
            log.warn(`No inventory for building ${buildingId}`);
            return null;
        }

        const buildingType = building.subType as BuildingType;

        // Calculate positions for outputs (upper right) and inputs (lower right)
        const { outputPositions, inputPositions } = this.calculateStackPositions(
            building.x,
            building.y,
            buildingType
        );

        state = {
            buildingId,
            outputStacks: new Map(),
            inputStacks: new Map(),
            outputPositions,
            inputPositions,
        };

        this.buildingVisuals.set(buildingId, state);
        return state;
    }

    /**
     * Calculate positions for both output and input resource stacks.
     * - Outputs are placed on the right side, upper positions (visually higher)
     * - Inputs are placed on the right side, lower positions (visually lower)
     *
     * In isometric view, lower Y = visually higher (north), higher Y = visually lower (south).
     */
    private calculateStackPositions(
        buildingX: number,
        buildingY: number,
        buildingType: BuildingType
    ): { outputPositions: TileCoord[]; inputPositions: TileCoord[] } {
        // Use simple building size for visual placement (ignore large blocking footprint)
        const size = getBuildingSize(buildingType);

        const outputPositions: TileCoord[] = [];
        const inputPositions: TileCoord[] = [];

        // Right edge (x + width + 1) - primary location, offset one tile right
        // Split: upper half for outputs, lower half for inputs
        for (let dy = 0; dy < size.height; dy++) {
            const pos = { x: buildingX + size.width + 1, y: buildingY + dy };
            if (dy < size.height / 2) {
                outputPositions.push(pos);
            } else {
                inputPositions.push(pos);
            }
        }

        // Bottom edge (y + height) - secondary for inputs
        for (let dx = size.width - 1; dx >= 0; dx--) {
            inputPositions.push({ x: buildingX + dx, y: buildingY + size.height });
        }

        // Top edge (y - 1) - secondary for outputs
        for (let dx = size.width - 1; dx >= 0; dx--) {
            if (buildingY > 0) {
                outputPositions.push({ x: buildingX + dx, y: buildingY - 1 });
            }
        }

        // Left edge (x - 1) - fallback
        for (let dy = 0; dy < size.height; dy++) {
            if (buildingX > 0) {
                const pos = { x: buildingX - 1, y: buildingY + dy };
                if (dy < size.height / 2) {
                    outputPositions.push(pos);
                } else {
                    inputPositions.push(pos);
                }
            }
        }

        return { outputPositions, inputPositions };
    }

    /**
     * Find an available position for a new visual stack.
     */
    private findStackPosition(
        visualState: BuildingVisualState,
        _slotType: 'input' | 'output',
        positions: TileCoord[]
    ): TileCoord | null {
        // Get positions already used by this building's visual stacks (both input and output)
        const usedPositions = new Set<string>();
        for (const entityId of visualState.outputStacks.values()) {
            const entity = this.gameState.getEntity(entityId);
            if (entity) {
                usedPositions.add(tileKey(entity.x, entity.y));
            }
        }
        for (const entityId of visualState.inputStacks.values()) {
            const entity = this.gameState.getEntity(entityId);
            if (entity) {
                usedPositions.add(tileKey(entity.x, entity.y));
            }
        }

        // Find first available position not occupied by anything
        for (const pos of positions) {
            const key = tileKey(pos.x, pos.y);
            if (usedPositions.has(key)) continue;

            // Check if tile is occupied by any entity
            const occupant = this.gameState.getEntityAt(pos.x, pos.y);
            if (!occupant) {
                return pos;
            }
        }

        return null;
    }

    /**
     * Create a visual stacked resource entity.
     * @param reserveForBuilding If true, marks the resource as belonging to the building
     *                           (inputs are reserved, outputs are available for pickup)
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

        const entity = this.gameState.addEntity(
            EntityType.StackedResource,
            materialType,
            position.x,
            position.y,
            building.player
        );

        // Set the initial quantity
        this.gameState.setResourceQuantity(entity.id, quantity);

        // Only reserve inputs - outputs are available for carrier pickup
        if (reserveForBuilding) {
            this.gameState.setResourceBuildingId(entity.id, buildingId);
        }

        return entity;
    }

    /**
     * Release visual stacks when a building is destroyed.
     * The resource piles become free (available for pickup by carriers).
     */
    removeBuilding(buildingId: number): void {
        const state = this.buildingVisuals.get(buildingId);
        if (!state) return;

        // Release output stacks - they become free resources
        for (const entityId of state.outputStacks.values()) {
            this.gameState.setResourceBuildingId(entityId, undefined);
        }

        // Release input stacks - they become free resources
        for (const entityId of state.inputStacks.values()) {
            this.gameState.setResourceBuildingId(entityId, undefined);
        }

        this.buildingVisuals.delete(buildingId);
    }

    /**
     * Initialize visuals for all existing buildings with inventory.
     * Call this after loading a map with pre-existing buildings.
     */
    initializeExistingBuildings(): void {
        for (const buildingId of this.inventoryManager.getAllBuildingIds()) {
            const inventory = this.inventoryManager.getInventory(buildingId);
            if (!inventory) continue;

            // Sync output slot visuals
            for (const slot of inventory.outputSlots) {
                if (slot.currentAmount > 0) {
                    this.updateVisualStack(buildingId, slot.materialType, 'output', slot.currentAmount);
                }
            }

            // Sync input slot visuals
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
        // Find all stacked resources that belong to buildings
        for (const entity of this.gameState.entities) {
            if (entity.type !== EntityType.StackedResource) continue;

            const buildingId = this.gameState.getResourceBuildingId(entity.id);
            if (buildingId === undefined) continue;

            // Get or create visual state for this building
            const visualState = this.getOrCreateVisualState(buildingId);
            if (!visualState) continue;

            const materialType = entity.subType as EMaterialType;

            // Determine if this is an input or output based on inventory slots
            const inventory = this.inventoryManager.getInventory(buildingId);
            if (!inventory) continue;

            const isOutput = inventory.outputSlots.some(s => s.materialType === materialType);
            const isInput = inventory.inputSlots.some(s => s.materialType === materialType);

            if (isOutput) {
                visualState.outputStacks.set(materialType, entity.id);
                log.debug(`Rebuilt output stack: building=${buildingId}, material=${EMaterialType[materialType]}, entity=${entity.id}`);
            } else if (isInput) {
                visualState.inputStacks.set(materialType, entity.id);
                log.debug(`Rebuilt input stack: building=${buildingId}, material=${EMaterialType[materialType]}, entity=${entity.id}`);
            }
        }
    }
}
