/**
 * Material Request System - creates transport requests for buildings that need input materials.
 *
 * All production is handled by SettlerTaskSystem via the WORKPLACE work handler.
 * This system's only job is to ensure buildings request materials when their
 * input slots are running low.
 *
 * Active request tracking is delegated to the RequestManager (single source of truth).
 */

import type { TickSystem } from '../tick-system';
import type { GameState } from '../game-state';
import { EntityType, BuildingType } from '../entity';
import { EMaterialType } from '../economy';
import { LogHandler } from '@/utilities/log-handler';
import { RequestPriority, type RequestManager } from '../features/logistics';
import { getInventoryConfig, type InventoryConfig, type BuildingInventoryManager } from '../features/inventory';
import { BuildingConstructionPhase, type BuildingStateManager } from '../features/building-construction';

const log = new LogHandler('MaterialRequestSystem');

/** Minimum input threshold before requesting more materials */
const REQUEST_THRESHOLD = 4;

/** Configuration for MaterialRequestSystem dependencies */
export interface MaterialRequestSystemConfig {
    gameState: GameState;
    buildingStateManager: BuildingStateManager;
    inventoryManager: BuildingInventoryManager;
    requestManager: RequestManager;
}

/**
 * System that creates material transport requests for buildings with input slots.
 * Production cycles are handled entirely by SettlerTaskSystem workers.
 */
export class MaterialRequestSystem implements TickSystem {
    private gameState: GameState;
    private buildingStateManager: BuildingStateManager;
    private inventoryManager: BuildingInventoryManager;
    private requestManager: RequestManager;

    constructor(config: MaterialRequestSystemConfig) {
        this.gameState = config.gameState;
        this.buildingStateManager = config.buildingStateManager;
        this.inventoryManager = config.inventoryManager;
        this.requestManager = config.requestManager;
    }

    tick(): void {
        for (const entity of this.gameState.entities) {
            if (entity.type !== EntityType.Building) continue;

            const buildingType = entity.subType as BuildingType;
            const config = getInventoryConfig(buildingType);

            // Skip buildings with no input slots
            if (config.inputSlots.length === 0) continue;

            // Only process completed buildings
            const buildingState = this.buildingStateManager.getBuildingState(entity.id);
            if (!buildingState || buildingState.phase !== BuildingConstructionPhase.Completed) continue;

            this.requestMaterials(entity, config);
        }
    }

    private requestMaterials(entity: { id: number }, config: InventoryConfig): void {
        // Buildings with input slots MUST have inventories by design
        const inventory = this.inventoryManager.getInventory(entity.id);
        if (!inventory) {
            throw new Error(`Building ${entity.id} has input slots but no inventory`);
        }

        for (const inputSlot of config.inputSlots) {
            const currentAmount = this.inventoryManager.getInputAmount(entity.id, inputSlot.materialType);

            // Request more if below threshold and no active request in the RequestManager
            if (currentAmount < REQUEST_THRESHOLD && !this.hasActiveRequest(entity.id, inputSlot.materialType)) {
                this.requestManager.addRequest(entity.id, inputSlot.materialType, 1, RequestPriority.Normal);
                log.debug(`Building ${entity.id} requested ${EMaterialType[inputSlot.materialType]}`);
            }
        }
    }

    /** Check if there's already an active (pending or in-progress) request for this building+material */
    private hasActiveRequest(buildingId: number, materialType: EMaterialType): boolean {
        const requests = this.requestManager.getRequestsForBuilding(buildingId);
        return requests.some(r => r.materialType === materialType);
    }
}
