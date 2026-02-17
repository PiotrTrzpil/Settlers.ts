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
import { getBuildingFootprint } from '../../buildings/types';
import { EMaterialType } from '../../economy/material-type';
import { MAX_RESOURCE_STACK_SIZE } from '../../entity';
import type { Command, CommandResult } from '../../commands';
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
    private executeCommand: (cmd: Command) => CommandResult;

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

    constructor(
        gameState: GameState,
        inventoryManager: BuildingInventoryManager,
        executeCommand: (cmd: Command) => CommandResult
    ) {
        this.gameState = gameState;
        this.inventoryManager = inventoryManager;
        this.executeCommand = executeCommand;

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
            this.gameState.resources.setQuantity(existingEntityId, visualQuantity);
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
        const { outputPositions, inputPositions } = this.calculateStackPositions(building.x, building.y, buildingType);

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
     * Uses the actual building footprint (from game data) to find adjacent tiles
     * that are truly outside the building's occupied area.
     *
     * - Outputs: upper/right positions (visually higher in isometric view)
     * - Inputs: lower/left positions (visually lower in isometric view)
     */
    private calculateStackPositions(
        buildingX: number,
        buildingY: number,
        buildingType: BuildingType
    ): { outputPositions: TileCoord[]; inputPositions: TileCoord[] } {
        const size = getBuildingSize(buildingType);
        const footprint = getBuildingFootprint(buildingX, buildingY, buildingType);
        const footprintSet = new Set(footprint.map(t => tileKey(t.x, t.y)));

        // Find all tiles adjacent to the footprint but not part of it
        const adjacentSet = new Set<string>();
        const adjacentTiles: TileCoord[] = [];

        for (const tile of footprint) {
            for (const [dx, dy] of [
                [0, -1],
                [1, 0],
                [0, 1],
                [-1, 0],
            ]) {
                const nx = tile.x + dx;
                const ny = tile.y + dy;
                if (nx < 0 || ny < 0) continue;
                const key = tileKey(nx, ny);
                if (footprintSet.has(key) || adjacentSet.has(key)) continue;
                adjacentSet.add(key);
                adjacentTiles.push({ x: nx, y: ny });
            }
        }

        // Categorize into output (upper/right) vs input (lower/left) based on
        // position relative to building center. In isometric view, lower Y = visually higher.
        const centerY = buildingY + size.height / 2;

        const outputPositions: TileCoord[] = [];
        const inputPositions: TileCoord[] = [];

        for (const pos of adjacentTiles) {
            if (pos.y < centerY) {
                outputPositions.push(pos);
            } else {
                inputPositions.push(pos);
            }
        }

        // Sort outputs: prefer right side (higher x), then top (lower y)
        outputPositions.sort((a, b) => b.x - a.x || a.y - b.y);

        // Sort inputs: prefer right side (higher x), then bottom (higher y)
        inputPositions.sort((a, b) => b.x - a.x || b.y - a.y);

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
     * Create a visual stacked resource entity via the command pipeline.
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

    /**
     * Get the position of a visual stack for a specific material at a building.
     * Used by carriers to walk to the correct stack position instead of the building center.
     */
    getStackPosition(buildingId: number, material: EMaterialType, slotType: 'input' | 'output'): TileCoord | null {
        const state = this.buildingVisuals.get(buildingId);
        if (!state) return null;

        const stackMap = slotType === 'output' ? state.outputStacks : state.inputStacks;
        const entityId = stackMap.get(material);
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
        const state = this.buildingVisuals.get(buildingId);
        if (!state) return;

        // Release output stacks - they become free resources
        for (const entityId of state.outputStacks.values()) {
            this.gameState.resources.setBuildingId(entityId, undefined);
        }

        // Release input stacks - they become free resources
        for (const entityId of state.inputStacks.values()) {
            this.gameState.resources.setBuildingId(entityId, undefined);
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

            const buildingId = this.gameState.resources.getBuildingId(entity.id);
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
                log.debug(
                    `Rebuilt output stack: building=${buildingId}, material=${EMaterialType[materialType]}, entity=${entity.id}`
                );
            } else if (isInput) {
                visualState.inputStacks.set(materialType, entity.id);
                log.debug(
                    `Rebuilt input stack: building=${buildingId}, material=${EMaterialType[materialType]}, entity=${entity.id}`
                );
            }
        }
    }
}
