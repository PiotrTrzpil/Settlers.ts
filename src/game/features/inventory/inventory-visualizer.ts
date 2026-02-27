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
import { Race } from '../../race';
import type { Command, CommandResult } from '../../commands';
import { type EventBus, EventSubscriptionManager } from '../../event-bus';
import { LogHandler } from '@/utilities/log-handler';
import type { StackPositions } from './stack-positions';
import { INVENTORY_CONFIGS } from './inventory-configs';
import { MaterialStackState } from './material-stack-state';
import { InventoryLayout } from './inventory-layout';
import type { EntityCleanupRegistry } from '../../systems/entity-cleanup-registry';

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
 * Manages visual representation of building inventories.
 * Creates stacked resource entities next to buildings to show their input and output contents.
 */
export class InventoryVisualizer {
    private gameState: GameState;
    private inventoryManager: BuildingInventoryManager;
    private executeCommand: (cmd: Command) => CommandResult;

    private stackState: MaterialStackState;
    private layout: InventoryLayout;

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

    /** Large depth bias so preview sprites render on top of everything. */
    private static readonly PREVIEW_DEPTH_BIAS = 1000;

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

    /** Set stack positions config (loaded from YAML, editable via debug tool). */
    setStackPositions(positions: StackPositions): void {
        this.layout.setStackPositions(positions);
    }

    /**
     * Subscribe to entity lifecycle events.
     * Cleans up visual inventory stacks when buildings are removed.
     */
    registerEvents(_eventBus: EventBus, cleanupRegistry: EntityCleanupRegistry): void {
        cleanupRegistry.onEntityRemoved(entityId => this.removeBuilding(entityId));
    }

    /** Unsubscribe from all tracked events. */
    unregisterEvents(): void {
        this.subscriptions.unsubscribeAll();
    }

    /** Clean up event listeners and internal state. */
    dispose(): void {
        this.removeSlotPreviews();
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
        this.layout.invalidateCache(buildingId);
    }

    /**
     * Reverse-look up which building and slot own a given visual stack entity.
     * Used by the debug adjust tool.
     */
    identifyStack(entityId: number): {
        buildingId: number;
        buildingType: BuildingType;
        buildingRace: Race;
        buildingX: number;
        buildingY: number;
        slotType: 'input' | 'output';
        material: EMaterialType;
    } | null {
        const match = this.stackState.identifyEntity(entityId);
        if (!match) return null;

        const building = this.gameState.getEntity(match.buildingId);
        if (!building) return null;

        return {
            buildingId: match.buildingId,
            buildingType: building.subType as BuildingType,
            buildingRace: building.race,
            buildingX: building.x,
            buildingY: building.y,
            slotType: match.slotType,
            material: match.material,
        };
    }

    // --- Refresh / bulk rebuild ---

    /**
     * Rebuild visual positions for all buildings of a given type.
     * Called after stack position config changes to apply the new layout everywhere.
     */
    refreshBuildingType(buildingType: BuildingType): void {
        this.removeVisualsForType(buildingType);
        this.layout.invalidateCacheForType(buildingType);
        this.recreateVisualsForType(buildingType);
    }

    /** Remove all visual stacks for buildings of a specific type. */
    private removeVisualsForType(buildingType: BuildingType): void {
        for (const buildingId of this.stackState.getAllBuildingIds()) {
            const building = this.gameState.getEntity(buildingId);
            if (!building || (building.subType as BuildingType) !== buildingType) continue;

            const state = this.stackState.get(buildingId)!;
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

            const visualState = this.stackState.get(buildingId);
            const layoutPositions = this.layout.calculateAutoStackPositions(
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
                layoutPositions.outputPositions,
                usedKeys,
                visualState?.outputStacks
            );
            this.collectSlotPositions(
                result,
                building,
                buildingId,
                config.inputSlots,
                'input',
                layoutPositions.inputPositions,
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
            const pos = this.layout.resolveDebugSlotPosition(
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
                const { outputPositions, inputPositions } = this.layout.calculateAutoStackPositions(
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

    /**
     * Create preview stack entities (qty MAX) at every configured slot that doesn't
     * already have a real stack. Used by the stack-adjust debug tool.
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

    /** Remove all preview stack entities created by createSlotPreviews. */
    removeSlotPreviews(): void {
        for (const entityId of this.previewEntityIds) {
            this.gameState.removeEntity(entityId);
        }
        this.previewEntityIds.clear();
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
