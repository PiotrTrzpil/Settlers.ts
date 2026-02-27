/**
 * Material Stack State
 *
 * Tracks the visual stacked resource entity IDs associated with each building's
 * input and output inventory slots. Purely a state container — no rendering,
 * no position calculation.
 */

import { EntityType } from '../../entity';
import { EMaterialType } from '../../economy/material-type';
import type { GameState } from '../../game-state';
import type { BuildingInventoryManager } from './building-inventory';
import { LogHandler } from '@/utilities/log-handler';

const log = new LogHandler('MaterialStackState');

/**
 * Tracks visual resources for a single building.
 * Maps material type to the stacked resource entity ID representing it.
 */
export interface BuildingVisualState {
    buildingId: number;
    /** Map of materialType -> entityId for output visual stacks */
    outputStacks: Map<EMaterialType, number>;
    /** Map of materialType -> entityId for input visual stacks */
    inputStacks: Map<EMaterialType, number>;
}

/**
 * Manages per-building visual stack state.
 * Tracks which entity IDs correspond to which material/slot pairs for each building.
 */
export class MaterialStackState {
    private buildingVisuals: Map<number, BuildingVisualState> = new Map();

    private gameState: GameState;
    private inventoryManager: BuildingInventoryManager;

    constructor(gameState: GameState, inventoryManager: BuildingInventoryManager) {
        this.gameState = gameState;
        this.inventoryManager = inventoryManager;
    }

    /**
     * Get the visual state for a building if it exists.
     */
    get(buildingId: number): BuildingVisualState | undefined {
        return this.buildingVisuals.get(buildingId);
    }

    /**
     * Get or create the visual state for a building.
     * Returns null if the building entity does not exist or has no inventory.
     */
    getOrCreate(buildingId: number): BuildingVisualState | null {
        const existing = this.buildingVisuals.get(buildingId);
        if (existing) return existing;

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

        const state: BuildingVisualState = {
            buildingId,
            outputStacks: new Map(),
            inputStacks: new Map(),
        };

        this.buildingVisuals.set(buildingId, state);
        return state;
    }

    /**
     * Remove visual state for a building (called when building is destroyed).
     * Does NOT remove the underlying entities — caller is responsible for that.
     */
    remove(buildingId: number): void {
        this.buildingVisuals.delete(buildingId);
    }

    /**
     * Get all building IDs that have tracked visual state.
     */
    getAllBuildingIds(): number[] {
        return [...this.buildingVisuals.keys()];
    }

    /**
     * Return the stack map for the given slot type from a visual state.
     */
    getStackMap(state: BuildingVisualState, slotType: 'input' | 'output'): Map<EMaterialType, number> {
        return slotType === 'output' ? state.outputStacks : state.inputStacks;
    }

    /**
     * Get the stack entity ID for a specific material and slot type at a building.
     * Returns undefined if no stack entity is tracked.
     */
    getEntityId(buildingId: number, material: EMaterialType, slotType: 'input' | 'output'): number | undefined {
        const state = this.buildingVisuals.get(buildingId);
        if (!state) return undefined;
        return this.getStackMap(state, slotType).get(material);
    }

    /**
     * Register a new stack entity for a material slot.
     */
    setEntityId(buildingId: number, material: EMaterialType, slotType: 'input' | 'output', entityId: number): void {
        const state = this.buildingVisuals.get(buildingId);
        if (!state) {
            log.warn(`setEntityId: no visual state for building ${buildingId}`);
            return;
        }
        this.getStackMap(state, slotType).set(material, entityId);
    }

    /**
     * Remove a tracked stack entity for a material slot.
     */
    deleteEntityId(buildingId: number, material: EMaterialType, slotType: 'input' | 'output'): void {
        const state = this.buildingVisuals.get(buildingId);
        if (!state) return;
        this.getStackMap(state, slotType).delete(material);
    }

    /**
     * Search all building visual states to find which building and slot own the given entity ID.
     * Returns the material type and slot info if found, null otherwise.
     */
    identifyEntity(entityId: number): {
        buildingId: number;
        slotType: 'input' | 'output';
        material: EMaterialType;
    } | null {
        for (const [buildingId, state] of this.buildingVisuals) {
            for (const [material, id] of state.outputStacks) {
                if (id === entityId) return { buildingId, slotType: 'output', material };
            }
            for (const [material, id] of state.inputStacks) {
                if (id === entityId) return { buildingId, slotType: 'input', material };
            }
        }
        return null;
    }

    /**
     * Rebuild state by scanning existing StackedResource entities in the game state.
     * Call this after HMR or game restore to reconnect with existing visual stacks.
     */
    rebuildFromExistingEntities(): void {
        for (const entity of this.gameState.entities) {
            if (entity.type !== EntityType.StackedResource) continue;

            const buildingId = this.gameState.resources.getBuildingId(entity.id);
            if (buildingId === undefined) continue;

            const visualState = this.getOrCreate(buildingId);
            if (!visualState) continue;

            const materialType = entity.subType as EMaterialType;

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

    /**
     * Clear all tracked visual state.
     */
    clear(): void {
        this.buildingVisuals.clear();
    }
}
