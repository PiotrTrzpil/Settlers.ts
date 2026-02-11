/**
 * Production System - handles building production cycles.
 *
 * Responsibilities:
 * - Create resource requests when buildings need input materials
 * - Process production when buildings have required inputs
 * - Manage production timers and output
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

/** Production state for a building */
interface ProductionState {
    /** Progress of current production cycle (0-1) */
    progress: number;
    /** Whether we have active requests for each input slot */
    pendingRequests: Set<EMaterialType>;
}

/**
 * System that manages production buildings.
 */
export class ProductionSystem implements TickSystem {
    private gameState: GameState;
    private productionStates: Map<number, ProductionState> = new Map();

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

            this.updateProduction(entity.id, buildingType, dt);
        }
    }

    private updateProduction(buildingId: number, buildingType: BuildingType, dt: number): void {
        // Get or create production state
        let state = this.productionStates.get(buildingId);
        if (!state) {
            state = { progress: 0, pendingRequests: new Set() };
            this.productionStates.set(buildingId, state);
        }

        const config = getInventoryConfig(buildingType);

        // Check if we need to request materials
        this.checkAndRequestMaterials(buildingId, config, state);

        // Check if we can produce (have all inputs and output space)
        if (!this.canProduce(buildingId)) {
            return;
        }

        // Update production progress
        const productionTime = PRODUCTION_TIME[buildingType] ?? 5.0;
        state.progress += dt / productionTime;

        if (state.progress >= 1) {
            this.completeProduction(buildingId, buildingType);
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

    /**
     * Clean up production state when entity is removed.
     * Implements TickSystem.onEntityRemoved for automatic cleanup.
     */
    onEntityRemoved(entityId: number): void {
        this.productionStates.delete(entityId);
    }
}
