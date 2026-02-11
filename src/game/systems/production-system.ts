/**
 * Production System - handles building production cycles.
 *
 * Responsibilities:
 * - Create resource requests when buildings need input materials
 * - Process production when buildings have required inputs
 * - Manage production timers and output
 *
 * State is stored on entity.production (RFC: Entity-Owned State).
 */

import type { TickSystem } from '../tick-system';
import type { GameState } from '../game-state';
import { EntityType, BuildingType } from '../entity';
import { EMaterialType } from '../economy';
import { LogHandler } from '@/utilities/log-handler';
import { RequestPriority } from '../features/logistics';
import { consumesMaterials, getInventoryConfig, type InventoryConfig } from '../features/inventory';
import { BuildingConstructionPhase } from '../features/building-construction';

const log = new LogHandler('ProductionSystem');

/** Production time in seconds for each building type */
const PRODUCTION_TIME: Partial<Record<BuildingType, number>> = {
    // Worker-based buildings are handled by SettlerTaskSystem:
    // - Sawmill: SawmillWorker
    // - WeaponSmith/ToolSmith: Smith
    // - Bakery: Baker (TODO)
    [BuildingType.Mill]: 4.0,
    [BuildingType.IronSmelter]: 8.0,
    [BuildingType.SmeltGold]: 8.0,
    [BuildingType.Slaughterhouse]: 4.0,
};

/** Minimum input threshold before requesting more materials */
const REQUEST_THRESHOLD = 4;

/**
 * Production state for a building.
 * Stored on entity.production (RFC: Entity-Owned State).
 */
export interface ProductionState {
    /** Progress of current production cycle (0-1) */
    progress: number;
    /** Whether we have active requests for each input slot */
    pendingRequests: Set<EMaterialType>;
}

/**
 * System that manages production buildings.
 * State is stored on entity.production (RFC: Entity-Owned State).
 */
export class ProductionSystem implements TickSystem {
    private gameState: GameState;

    constructor(gameState: GameState) {
        this.gameState = gameState;
    }

    tick(dt: number): void {
        // Process all production buildings
        for (const entity of this.gameState.entities) {
            if (entity.type !== EntityType.Building) continue;

            const buildingType = entity.subType as BuildingType;
            if (!consumesMaterials(buildingType)) continue;

            // Only process completed buildings
            const buildingState = this.gameState.buildingStateManager.getBuildingState(entity.id);
            if (!buildingState || buildingState.phase !== BuildingConstructionPhase.Completed) continue;

            this.updateProduction(entity, buildingType, dt);
        }
    }

    private updateProduction(entity: { id: number; production?: ProductionState }, buildingType: BuildingType, dt: number): void {
        // Get or create production state on entity (RFC: Entity-Owned State)
        if (!entity.production) {
            entity.production = { progress: 0, pendingRequests: new Set() };
        }
        const state = entity.production;

        const config = getInventoryConfig(buildingType);

        // Check if we need to request materials
        this.checkAndRequestMaterials(entity.id, config, state);

        // Check if we can produce (have all inputs and output space)
        if (!this.canProduce(entity.id)) {
            return;
        }

        // Update production progress
        const productionTime = PRODUCTION_TIME[buildingType] ?? 5.0;
        state.progress += dt / productionTime;

        if (state.progress >= 1) {
            this.completeProduction(entity.id, buildingType);
            state.progress = 0;
        }
    }

    private checkAndRequestMaterials(
        buildingId: number,
        config: InventoryConfig,
        state: ProductionState
    ): void {
        const inventory = this.gameState.inventoryManager.getInventory(buildingId);
        if (!inventory) return;

        for (const inputSlot of config.inputSlots) {
            const currentAmount = this.gameState.inventoryManager.getInputAmount(
                buildingId,
                inputSlot.materialType
            );

            // Request more if below threshold and no pending request
            if (currentAmount < REQUEST_THRESHOLD && !state.pendingRequests.has(inputSlot.materialType)) {
                const entity = this.gameState.getEntity(buildingId);
                if (!entity) continue;

                // Create request for this material
                this.gameState.requestManager.addRequest(
                    buildingId,
                    inputSlot.materialType,
                    1,
                    RequestPriority.Normal
                );

                state.pendingRequests.add(inputSlot.materialType);
                log.debug(`Building ${buildingId} requested ${EMaterialType[inputSlot.materialType]}`);
            }

            // Clear pending flag if we received material
            if (currentAmount >= REQUEST_THRESHOLD) {
                state.pendingRequests.delete(inputSlot.materialType);
            }
        }
    }

    private canProduce(buildingId: number): boolean {
        return this.gameState.inventoryManager.canStartProduction(buildingId) &&
               this.gameState.inventoryManager.canStoreOutput(buildingId);
    }

    private completeProduction(buildingId: number, buildingType: BuildingType): void {
        this.gameState.inventoryManager.consumeProductionInputs(buildingId);
        this.gameState.inventoryManager.produceOutput(buildingId);

        log.debug(`Building ${buildingId} (${BuildingType[buildingType]}) produced output`);
    }

    // No onEntityRemoved needed - state is deleted with entity automatically (RFC: Entity-Owned State)
}
