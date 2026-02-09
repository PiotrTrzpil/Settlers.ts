/**
 * Building Inventory Visualizer
 *
 * Syncs building output inventory to visual stacked resource entities.
 * When a building's output slot contains materials, this system creates/updates
 * stacked resource entities next to the building for visual feedback.
 */

import type { GameState } from '../../game-state';
import type { BuildingInventoryManager } from './building-inventory';
import { BuildingType, EntityType, getBuildingFootprint, getBuildingSize, tileKey, type TileCoord } from '../../entity';
import { EMaterialType } from '../../economy/material-type';
import { MAX_RESOURCE_STACK_SIZE } from '../../entity';

/**
 * Tracks visual resources for a single building.
 * Maps material type to the stacked resource entity ID representing it.
 */
interface BuildingVisualState {
    buildingId: number;
    /** Map of materialType -> entityId for visual stacks */
    visualStacks: Map<EMaterialType, number>;
    /** Positions available for placing resource stacks */
    outputPositions: TileCoord[];
}

/**
 * Manages visual representation of building inventories.
 * Creates stacked resource entities next to buildings to show their output contents.
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
     * Only output slot changes trigger visual updates.
     */
    private onInventoryChange(
        buildingId: number,
        materialType: EMaterialType,
        slotType: 'input' | 'output',
        _previousAmount: number,
        newAmount: number
    ): void {
        // Only visualize output slots (what's produced and ready for pickup)
        if (slotType !== 'output') return;

        this.updateVisualStack(buildingId, materialType, newAmount);
    }

    /**
     * Update the visual stack for a specific material at a building.
     */
    private updateVisualStack(
        buildingId: number,
        materialType: EMaterialType,
        quantity: number
    ): void {
        const visualState = this.getOrCreateVisualState(buildingId);
        if (!visualState) return;

        const existingEntityId = visualState.visualStacks.get(materialType);

        if (quantity <= 0) {
            // Remove the visual stack if quantity is zero
            if (existingEntityId !== undefined) {
                this.gameState.removeEntity(existingEntityId);
                visualState.visualStacks.delete(materialType);
            }
            return;
        }

        // Clamp quantity to max stack size for visual representation
        const visualQuantity = Math.min(quantity, MAX_RESOURCE_STACK_SIZE);

        if (existingEntityId !== undefined) {
            // Update existing stack quantity
            this.gameState.setResourceQuantity(existingEntityId, visualQuantity);
        } else {
            // Create new visual stack
            const position = this.findOutputPosition(visualState, materialType);
            if (position) {
                const entity = this.createVisualStack(buildingId, materialType, position, visualQuantity);
                if (entity) {
                    visualState.visualStacks.set(materialType, entity.id);
                }
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
        if (!building || building.type !== EntityType.Building) return null;

        const inventory = this.inventoryManager.getInventory(buildingId);
        if (!inventory) return null;

        // Calculate output positions for this building
        const outputPositions = this.calculateOutputPositions(
            building.x,
            building.y,
            building.subType as BuildingType
        );

        state = {
            buildingId,
            visualStacks: new Map(),
            outputPositions,
        };

        this.buildingVisuals.set(buildingId, state);
        return state;
    }

    /**
     * Calculate positions adjacent to a building where output resources can be displayed.
     * Prioritizes positions to the right/below the building (typical output direction).
     */
    private calculateOutputPositions(
        buildingX: number,
        buildingY: number,
        buildingType: BuildingType
    ): TileCoord[] {
        const size = getBuildingSize(buildingType);
        const footprint = getBuildingFootprint(buildingX, buildingY, buildingType);
        const footprintSet = new Set(footprint.map(t => tileKey(t.x, t.y)));

        const positions: TileCoord[] = [];

        // Prioritize positions along the bottom-right edge (typical output area)
        // Bottom edge (y + height)
        for (let dx = 0; dx < size.width; dx++) {
            const pos = { x: buildingX + dx, y: buildingY + size.height };
            if (!footprintSet.has(tileKey(pos.x, pos.y))) {
                positions.push(pos);
            }
        }

        // Right edge (x + width)
        for (let dy = 0; dy < size.height; dy++) {
            const pos = { x: buildingX + size.width, y: buildingY + dy };
            if (!footprintSet.has(tileKey(pos.x, pos.y))) {
                positions.push(pos);
            }
        }

        // Top edge (y - 1)
        for (let dx = 0; dx < size.width; dx++) {
            const pos = { x: buildingX + dx, y: buildingY - 1 };
            if (pos.y >= 0 && !footprintSet.has(tileKey(pos.x, pos.y))) {
                positions.push(pos);
            }
        }

        // Left edge (x - 1)
        for (let dy = 0; dy < size.height; dy++) {
            const pos = { x: buildingX - 1, y: buildingY + dy };
            if (pos.x >= 0 && !footprintSet.has(tileKey(pos.x, pos.y))) {
                positions.push(pos);
            }
        }

        return positions;
    }

    /**
     * Find an available position for a new visual stack.
     */
    private findOutputPosition(
        visualState: BuildingVisualState,
        _materialType: EMaterialType
    ): TileCoord | null {
        // Get positions already used by this building's visual stacks
        const usedPositions = new Set<string>();
        for (const entityId of visualState.visualStacks.values()) {
            const entity = this.gameState.getEntity(entityId);
            if (entity) {
                usedPositions.add(tileKey(entity.x, entity.y));
            }
        }

        // Find first available position not occupied by anything
        for (const pos of visualState.outputPositions) {
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
     */
    private createVisualStack(
        buildingId: number,
        materialType: EMaterialType,
        position: TileCoord,
        quantity: number
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

        return entity;
    }

    /**
     * Remove all visual stacks for a building.
     * Called when a building is destroyed.
     */
    removeBuilding(buildingId: number): void {
        const state = this.buildingVisuals.get(buildingId);
        if (!state) return;

        // Remove all visual stack entities
        for (const entityId of state.visualStacks.values()) {
            this.gameState.removeEntity(entityId);
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
                    this.updateVisualStack(buildingId, slot.materialType, slot.currentAmount);
                }
            }
        }
    }
}
