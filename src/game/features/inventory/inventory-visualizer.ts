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
import { Race } from '../../race';
import { MAX_RESOURCE_STACK_SIZE } from '../../entity';
import type { Command, CommandResult } from '../../commands';
import { type EventBus, EventSubscriptionManager } from '../../event-bus';
import { LogHandler } from '@/utilities/log-handler';
import type { StackPositions } from './stack-positions';
import { INVENTORY_CONFIGS } from './inventory-configs';

const log = new LogHandler('InventoryVisualizer');

/** Slot position info for the debug stack-adjust tool. */
export interface DebugSlotInfo {
    buildingId: number;
    x: number;
    y: number;
    slotType: 'input' | 'output';
    material: EMaterialType;
    hasEntity: boolean;
}

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
    private stackPositions: StackPositions | null = null;

    /** Tracks visual state per building */
    private buildingVisuals: Map<number, BuildingVisualState> = new Map();

    /** Debug preview entity IDs (created in stack-adjust mode, cleaned up on exit) */
    private previewEntityIds = new Set<number>();

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

        // Bind the handler so we can unregister it later
        this.changeHandler = this.onInventoryChange.bind(this);
        this.inventoryManager.onChange(this.changeHandler);
    }

    /** Set stack positions config (loaded from YAML, editable via debug tool). */
    setStackPositions(positions: StackPositions): void {
        this.stackPositions = positions;
    }

    /**
     * Subscribe to entity lifecycle events.
     * Cleans up visual inventory stacks when buildings are removed.
     */
    registerEvents(eventBus: EventBus): void {
        this.subscriptions.subscribe(eventBus, 'entity:removed', ({ entityId }) => {
            this.removeBuilding(entityId);
        });
    }

    /** Unsubscribe from all tracked events. */
    unregisterEvents(): void {
        this.subscriptions.unsubscribeAll();
    }

    /**
     * Clean up event listeners.
     */
    dispose(): void {
        this.removeSlotPreviews();
        this.unregisterEvents();
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
            // Create new visual stack — check configured position first, then fall back to pool
            const position = this.resolveStackPosition(buildingId, materialType, slotType, visualState, positions);
            if (position) {
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

        // Auto-calculated fallback positions (used when YAML has no entry for a material)
        const { outputPositions, inputPositions } = this.calculateAutoStackPositions(
            building.x,
            building.y,
            buildingType,
            building.race
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
     * Uses the actual building footprint (from game data) to find adjacent tiles
     * that are truly outside the building's occupied area.
     *
     * - Outputs: upper/right positions (visually higher in isometric view)
     * - Inputs: lower/left positions (visually lower in isometric view)
     */
    /**
     * Auto-calculate fallback positions from building footprint adjacency.
     * These are used when no YAML-configured position exists for a material.
     */
    private calculateAutoStackPositions(
        buildingX: number,
        buildingY: number,
        buildingType: BuildingType,
        race: Race = Race.Roman
    ): { outputPositions: TileCoord[]; inputPositions: TileCoord[] } {
        const size = getBuildingSize(buildingType);
        const footprint = getBuildingFootprint(buildingX, buildingY, buildingType, race);
        const footprintSet = new Set(footprint.map(t => tileKey(t.x, t.y)));

        // Find all tiles adjacent to the footprint but not part of it
        const adjacentSet = new Set<string>();
        const adjacentTiles: TileCoord[] = [];

        for (const tile of footprint) {
            for (const [dx, dy] of [
                [0, -1] as [number, number],
                [1, 0] as [number, number],
                [0, 1] as [number, number],
                [-1, 0] as [number, number],
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
     * Resolve position for a new visual stack.
     * Checks YAML-configured position for this material first, falls back to auto-calc pool.
     */
    private resolveStackPosition(
        buildingId: number,
        materialType: EMaterialType,
        slotType: 'input' | 'output',
        visualState: BuildingVisualState,
        fallbackPositions: TileCoord[]
    ): TileCoord | null {
        if (this.stackPositions) {
            const building = this.gameState.getEntity(buildingId);
            if (building) {
                const pos = this.stackPositions.getPositionForSlot(
                    building.subType as BuildingType,
                    building.race,
                    slotType,
                    materialType,
                    building.x,
                    building.y
                );
                if (pos) return pos;
            }
        }
        return this.findStackPosition(visualState, slotType, fallbackPositions);
    }

    /**
     * Find an available position from the auto-calculated pool.
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

    /** Info returned by identifyStack for the debug adjust tool. */
    identifyStack(entityId: number): {
        buildingId: number;
        buildingType: BuildingType;
        buildingRace: Race;
        buildingX: number;
        buildingY: number;
        slotType: 'input' | 'output';
        material: EMaterialType;
    } | null {
        for (const [buildingId, state] of this.buildingVisuals) {
            const outputMatch = this.findInStackMap(state.outputStacks, entityId);
            if (outputMatch !== null) {
                return this.buildStackInfo(buildingId, 'output', outputMatch);
            }
            const inputMatch = this.findInStackMap(state.inputStacks, entityId);
            if (inputMatch !== null) {
                return this.buildStackInfo(buildingId, 'input', inputMatch);
            }
        }
        return null;
    }

    /** Search a stack map for an entity ID, returning the material if found. */
    private findInStackMap(stacks: Map<EMaterialType, number>, entityId: number): EMaterialType | null {
        for (const [material, id] of stacks) {
            if (id === entityId) return material;
        }
        return null;
    }

    /** Build the stack info result for identifyStack. */
    private buildStackInfo(
        buildingId: number,
        slotType: 'input' | 'output',
        material: EMaterialType
    ): ReturnType<InventoryVisualizer['identifyStack']> {
        const building = this.gameState.getEntity(buildingId);
        if (!building) return null;
        return {
            buildingId,
            buildingType: building.subType as BuildingType,
            buildingRace: building.race,
            buildingX: building.x,
            buildingY: building.y,
            slotType,
            material,
        };
    }

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
        for (const [buildingId, state] of this.buildingVisuals) {
            const building = this.gameState.getEntity(buildingId);
            if (!building || (building.subType as BuildingType) !== buildingType) continue;

            for (const entityId of state.outputStacks.values()) this.gameState.removeEntity(entityId);
            for (const entityId of state.inputStacks.values()) this.gameState.removeEntity(entityId);
            this.buildingVisuals.delete(buildingId);
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

    /** Get all building IDs with visual states (for debug highlighting). */
    getVisualBuildingIds(): number[] {
        return [...this.buildingVisuals.keys()];
    }

    /**
     * Generate default positions for all building types that have inventory,
     * for all available races. Uses the auto-calculation algorithm at a
     * reference point and stores them in the StackPositions config.
     */
    generateDefaultPositions(stackPositions: StackPositions, races: Race[]): void {
        const REF_X = 100;
        const REF_Y = 100;

        for (const [buildingType, config] of INVENTORY_CONFIGS) {
            if (!config.outputSlots.length && !config.inputSlots.length) continue;

            for (const race of races) {
                const { outputPositions, inputPositions } = this.calculateAutoStackPositions(
                    REF_X,
                    REF_Y,
                    buildingType,
                    race
                );

                if (config.outputSlots.length > 0 && outputPositions.length > 0) {
                    stackPositions.setMaterialPositions(
                        buildingType,
                        race,
                        'output',
                        config.outputSlots.map(s => s.materialType),
                        REF_X,
                        REF_Y,
                        outputPositions
                    );
                }
                if (config.inputSlots.length > 0 && inputPositions.length > 0) {
                    stackPositions.setMaterialPositions(
                        buildingType,
                        race,
                        'input',
                        config.inputSlots.map(s => s.materialType),
                        REF_X,
                        REF_Y,
                        inputPositions
                    );
                }
            }
        }
        stackPositions.saveToFile();
    }

    /** Get all stack entity IDs for a building (for debug highlighting). */
    getStackEntityIds(buildingId: number): { entityId: number; slotType: 'input' | 'output' }[] {
        const state = this.buildingVisuals.get(buildingId);
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

    /**
     * Get all configured slot positions across all buildings with inventory.
     * Returns positions for every material in every building's config, resolved
     * from YAML first with auto-calc fallback. Used by the debug adjust tool
     * to show clickable highlights even for empty slots.
     */
    getAllSlotPositions(): DebugSlotInfo[] {
        const result: DebugSlotInfo[] = [];

        for (const buildingId of this.inventoryManager.getAllBuildingIds()) {
            const building = this.gameState.getEntity(buildingId);
            if (!building) continue;

            const buildingType = building.subType as BuildingType;
            const config = INVENTORY_CONFIGS.get(buildingType);
            if (!config) continue;

            const visualState = this.buildingVisuals.get(buildingId);
            const { outputPositions, inputPositions } = this.calculateAutoStackPositions(
                building.x,
                building.y,
                buildingType,
                building.race
            );
            const usedKeys = new Set<string>();

            this.collectSlotPositions(
                result,
                building,
                buildingId,
                config.outputSlots,
                'output',
                outputPositions,
                usedKeys,
                visualState?.outputStacks
            );
            this.collectSlotPositions(
                result,
                building,
                buildingId,
                config.inputSlots,
                'input',
                inputPositions,
                usedKeys,
                visualState?.inputStacks
            );
        }

        return result;
    }

    /** Resolve and collect slot positions for one side (input or output) of a building. */
    private collectSlotPositions(
        result: DebugSlotInfo[],
        building: { subType: number; race: Race; x: number; y: number },
        buildingId: number,
        slots: readonly { materialType: EMaterialType }[],
        slotType: 'input' | 'output',
        fallbackPositions: TileCoord[],
        usedKeys: Set<string>,
        entityMap?: Map<EMaterialType, number>
    ): void {
        for (const slot of slots) {
            const pos = this.resolveDebugSlotPosition(
                building,
                slot.materialType,
                slotType,
                fallbackPositions,
                usedKeys
            );
            if (!pos) continue;

            result.push({
                buildingId,
                x: pos.x,
                y: pos.y,
                slotType,
                material: slot.materialType,
                hasEntity: entityMap?.has(slot.materialType) ?? false,
            });
        }
    }

    /** Resolve a slot position for debug display: YAML config first, then auto-calc pool. */
    private resolveDebugSlotPosition(
        building: { subType: number; race: Race; x: number; y: number },
        materialType: EMaterialType,
        slotType: 'input' | 'output',
        fallbackPositions: TileCoord[],
        usedKeys: Set<string>
    ): TileCoord | null {
        if (this.stackPositions) {
            const pos = this.stackPositions.getPositionForSlot(
                building.subType as BuildingType,
                building.race,
                slotType,
                materialType,
                building.x,
                building.y
            );
            if (pos) return pos;
        }
        for (const pos of fallbackPositions) {
            const key = tileKey(pos.x, pos.y);
            if (usedKeys.has(key)) continue;
            usedKeys.add(key);
            return pos;
        }
        return null;
    }

    /** Large depth bias so preview sprites render on top of everything. */
    private static readonly PREVIEW_DEPTH_BIAS = 1000;

    /**
     * Create preview stack entities (qty 8) at every configured slot that doesn't
     * already have a real stack. Used by the stack-adjust debug tool so the user
     * can see and click all configured positions.
     */
    createSlotPreviews(): void {
        this.removeSlotPreviews();
        for (const slot of this.getAllSlotPositions()) {
            if (slot.hasEntity) continue;
            const created = this.createVisualStack(slot.buildingId, slot.material, slot, MAX_RESOURCE_STACK_SIZE, true);
            if (created) {
                const entity = this.gameState.getEntity(created.id);
                if (entity) entity.depthBias = InventoryVisualizer.PREVIEW_DEPTH_BIAS;
                this.previewEntityIds.add(created.id);
            }
        }
    }

    /**
     * Remove all preview stack entities created by createSlotPreviews.
     */
    removeSlotPreviews(): void {
        for (const entityId of this.previewEntityIds) {
            this.gameState.removeEntity(entityId);
        }
        this.previewEntityIds.clear();
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
