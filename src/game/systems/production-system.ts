/**
 * Production System - handles automatic building production cycles.
 *
 * This system manages AUTOMATIC production buildings where the building itself
 * transforms inputs into outputs without worker movement.
 *
 * ## Production Types
 *
 * There are two types of production in the game:
 *
 * ### 1. AUTOMATIC (this system)
 * - Building transforms inputs to outputs automatically
 * - No worker movement required - building does the work
 * - Examples: Mill (GRAIN → FLOUR), IronSmelter (IRONORE + COAL → IRONBAR)
 *
 * ### 2. WORKER-BASED (SettlerTaskSystem)
 * - Worker travels to external resource or workspace
 * - Worker brings material back to building or works at the building
 * - Examples: Woodcutter (travels to tree → brings LOG), Sawmill (worker at building)
 *
 * Responsibilities:
 * - Create resource requests when buildings need input materials
 * - Process production when buildings have required inputs
 * - Manage production timers and output
 * - Emit production:started and production:completed events
 *
 * State is stored on entity.production (RFC: Entity-Owned State).
 */

import type { TickSystem } from '../tick-system';
import type { GameState } from '../game-state';
import type { EventBus } from '../event-bus';
import { EntityType, BuildingType } from '../entity';
import { EMaterialType } from '../economy';
import { BUILDING_PRODUCTIONS } from '../economy/building-production';
import { LogHandler } from '@/utilities/log-handler';
import { RequestPriority } from '../features/logistics';
import { getInventoryConfig, type InventoryConfig } from '../features/inventory';
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
    /** True if we emitted production:started for the current cycle */
    cycleStarted: boolean;
}

/** Configuration for ProductionSystem dependencies */
export interface ProductionSystemConfig {
    gameState: GameState;
    eventBus: EventBus;
}

/**
 * System that manages automatic production buildings.
 * State is stored on entity.production (RFC: Entity-Owned State).
 */
export class ProductionSystem implements TickSystem {
    private gameState: GameState;
    private eventBus: EventBus;

    constructor(config: ProductionSystemConfig) {
        this.gameState = config.gameState;
        this.eventBus = config.eventBus;
    }

    tick(dt: number): void {
        // Process all production buildings
        for (const entity of this.gameState.entities) {
            if (entity.type !== EntityType.Building) continue;

            const buildingType = entity.subType as BuildingType;

            // Only process AUTOMATIC production buildings (not worker-based)
            if (!PRODUCTION_TIME[buildingType]) continue;

            // Only process completed buildings
            const buildingState = this.gameState.buildingStateManager.getBuildingState(entity.id);
            if (!buildingState || buildingState.phase !== BuildingConstructionPhase.Completed) continue;

            this.updateProduction(entity, buildingType, dt);
        }
    }

    private updateProduction(entity: { id: number; production?: ProductionState }, buildingType: BuildingType, dt: number): void {
        // Get or create production state on entity (RFC: Entity-Owned State)
        if (!entity.production) {
            entity.production = { progress: 0, pendingRequests: new Set(), cycleStarted: false };
        }
        const state = entity.production;

        const config = getInventoryConfig(buildingType);

        // Check if we need to request materials
        this.checkAndRequestMaterials(entity.id, config, state);

        // Check if we can produce (have all inputs and output space)
        if (!this.canProduce(entity.id)) {
            // Reset cycle started if we can't produce (inputs depleted)
            if (state.progress === 0) {
                state.cycleStarted = false;
            }
            return;
        }

        // Emit production:started only once per cycle
        if (!state.cycleStarted) {
            state.cycleStarted = true;
            const production = BUILDING_PRODUCTIONS.get(buildingType)!;
            this.eventBus.emit('production:started', {
                buildingId: entity.id,
                buildingType,
                outputMaterial: production.output,
            });
        }

        // Update production progress
        const productionTime = PRODUCTION_TIME[buildingType] ?? 5.0;
        state.progress += dt / productionTime;

        if (state.progress >= 1) {
            this.completeProduction(entity.id, buildingType);
            state.progress = 0;
            state.cycleStarted = false;
        }
    }

    private checkAndRequestMaterials(
        buildingId: number,
        config: InventoryConfig,
        state: ProductionState
    ): void {
        // Production buildings MUST have inventories by design
        const inventory = this.gameState.inventoryManager.getInventory(buildingId);
        if (!inventory) {
            throw new Error(`Production building ${buildingId} has no inventory`);
        }

        for (const inputSlot of config.inputSlots) {
            const currentAmount = this.gameState.inventoryManager.getInputAmount(
                buildingId,
                inputSlot.materialType
            );

            // Request more if below threshold and no pending request
            if (currentAmount < REQUEST_THRESHOLD && !state.pendingRequests.has(inputSlot.materialType)) {

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

        // Emit production:completed event
        const production = BUILDING_PRODUCTIONS.get(buildingType)!;
        this.eventBus.emit('production:completed', {
            buildingId,
            buildingType,
            outputMaterial: production.output,
        });

        log.debug(`Building ${buildingId} (${BuildingType[buildingType]}) produced output`);
    }

    // No onEntityRemoved needed - state is deleted with entity automatically (RFC: Entity-Owned State)
}
