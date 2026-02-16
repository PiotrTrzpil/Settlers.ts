/**
 * Work handler factories for all settler types.
 *
 * Each factory creates a WorkHandler that plugs into SettlerTaskSystem.
 * Handlers are stateless closures over their dependencies (game state, domain systems).
 *
 * Built-in handlers: WORKPLACE (building production), GOOD (carrier dummy).
 * Domain handlers: TREE (woodcutter), STONE (stonecutter), TREE_SEED_POS (forester in TreeSystem).
 */

import { EMaterialType } from '../../economy';
import type { GameState } from '../../game-state';
import { EntityType, MapObjectType, type Entity } from '../../entity';
import type { BuildingInventoryManager } from '../../features/inventory';
import { LogHandler } from '@/utilities/log-handler';
import type { TaskNode } from './types';
import { TaskType, type WorkHandler } from './types';
import type { TreeSystem } from '../tree-system';
import { OBJECT_TYPE_CATEGORY } from '../map-objects';
import { findNearestEntity } from '../spatial-search';

// ─────────────────────────────────────────────────────────────
// Built-in handlers (no external domain system dependency)
// ─────────────────────────────────────────────────────────────

/**
 * Create a handler for WORKPLACE search type.
 * Building workers find their workplace, wait for materials, then produce.
 */
export function createWorkplaceHandler(gameState: GameState, inventoryManager: BuildingInventoryManager): WorkHandler {
    return {
        // Worker waits at building for materials instead of failing
        shouldWaitForWork: true,

        findTarget: (_x: number, _y: number, settlerId?: number) => {
            if (settlerId === undefined) return null;
            // Settler MUST exist if we're searching for its target
            const settler = gameState.getEntityOrThrow(settlerId, 'settler for findTarget');

            const workplace = gameState.findNearestWorkplace(settler);
            if (!workplace) return null;

            return { entityId: workplace.id, x: workplace.x, y: workplace.y };
        },

        canWork: (targetId: number) => {
            // Can work when building has inputs and output space
            return inventoryManager.canStartProduction(targetId) && inventoryManager.canStoreOutput(targetId);
        },

        onWorkStart: (targetId: number) => {
            // Consume inputs when starting work
            inventoryManager.consumeProductionInputs(targetId);
        },

        onWorkTick: (_targetId: number, progress: number) => {
            // Complete when progress reaches 1.0
            return progress >= 1.0;
        },

        onWorkComplete: (targetId: number) => {
            // Produce outputs when work completes
            inventoryManager.produceOutput(targetId);
        },
    };
}

/**
 * Create a handler for GOOD search type (carriers).
 *
 * Carriers don't find work themselves - they get jobs assigned externally
 * by LogisticsDispatcher via assignJob(). This handler exists to
 * prevent "no handler registered" errors when carriers are idle.
 */
export function createCarrierHandler(): WorkHandler {
    return {
        shouldWaitForWork: true,

        findTarget: () => null,
        canWork: () => false,
        onWorkTick: () => false,
    };
}

// ─────────────────────────────────────────────────────────────
// Domain handlers (depend on external systems)
// ─────────────────────────────────────────────────────────────

const WOODCUTTER_SEARCH_RADIUS = 30;

/**
 * Create a handler for TREE search type (woodcutters).
 * Uses TreeSystem for tree lifecycle (cutting stages, falling animation, stump decay).
 */
export function createWoodcuttingHandler(gameState: GameState, treeSystem: TreeSystem): WorkHandler {
    return {
        findTarget: (x: number, y: number) => {
            return findNearestEntity(gameState, x, y, WOODCUTTER_SEARCH_RADIUS, entity => {
                if (entity.type !== EntityType.MapObject) return false;
                const category = OBJECT_TYPE_CATEGORY[entity.subType as MapObjectType];
                return category === 'trees' && treeSystem.canCut(entity.id);
            });
        },

        canWork: (targetId: number) => {
            return treeSystem.canCut(targetId) || treeSystem.isCutting(targetId);
        },

        onWorkStart: (targetId: number) => {
            treeSystem.startCutting(targetId);
        },

        onWorkTick: (targetId: number, progress: number) => {
            return treeSystem.updateCutting(targetId, progress);
        },

        onWorkComplete: (targetId: number, settlerX: number, settlerY: number) => {
            woodcuttingLog.debug(`Tree ${targetId} cut at (${settlerX}, ${settlerY})`);
        },

        onWorkInterrupt: (targetId: number) => {
            treeSystem.cancelCutting(targetId);
        },
    };
}

const woodcuttingLog = new LogHandler('WoodcuttingHandler');

/**
 * Create a handler for TREE_SEED_POS search type (foresters).
 * Foresters find empty tiles and plant new trees via TreeSystem.
 */
export function createForesterHandler(treeSystem: TreeSystem): WorkHandler {
    return {
        findTarget: (x: number, y: number) => {
            return treeSystem.findPlantingSpot(x, y);
        },

        // canWork/onWorkTick are required but not used for SEARCH_POS → WORK flow
        canWork: () => true,
        onWorkTick: () => true,

        onWorkAtPositionComplete: (posX: number, posY: number, settlerId: number) => {
            treeSystem.plantTree(posX, posY, settlerId);
        },
    };
}

const STONECUTTER_SEARCH_RADIUS = 30;
const stonecuttingLog = new LogHandler('StonecuttingHandler');

/**
 * Create a handler for STONE search type (stonecutters).
 * Simple harvest: find stone → work on it → resource removed.
 */
export function createStonecuttingHandler(gameState: GameState): WorkHandler {
    return createSimpleHarvestHandler({
        gameState,
        log: stonecuttingLog,
        workerLabel: 'Stonecutter',
        searchRadius: STONECUTTER_SEARCH_RADIUS,
        targetFilter: entity => entity.subType === MapObjectType.ResourceStone,
    });
}

// ─────────────────────────────────────────────────────────────
// Simple harvest handler factory (shared by stonecutting + future harvesters)
// ─────────────────────────────────────────────────────────────

/**
 * Configuration for creating a simple resource harvest work handler.
 * Covers the common pattern: find resource → work on it → resource consumed → pickup material.
 */
interface SimpleHarvestConfig {
    gameState: GameState;
    log: LogHandler;
    workerLabel: string;
    searchRadius: number;
    targetFilter: (entity: Entity) => boolean;
    onComplete?: (targetId: number, settlerX: number, settlerY: number) => void;
}

/**
 * Create a work handler for simple resource harvesting.
 * Handles the common case where a worker finds a resource entity, works on it
 * until progress reaches 1.0, and the resource is consumed.
 */
export function createSimpleHarvestHandler(config: SimpleHarvestConfig): WorkHandler {
    const { gameState, log, workerLabel, searchRadius, targetFilter } = config;

    return {
        findTarget: (x: number, y: number) => {
            return findNearestEntity(
                gameState,
                x,
                y,
                searchRadius,
                entity => entity.type === EntityType.MapObject && targetFilter(entity)
            );
        },

        canWork: (targetId: number) => {
            const entity = gameState.getEntity(targetId);
            return entity !== undefined && entity.type === EntityType.MapObject && targetFilter(entity);
        },

        onWorkTick: (_targetId: number, progress: number) => {
            return progress >= 1;
        },

        onWorkComplete:
            config.onComplete ??
            ((targetId: number, settlerX: number, settlerY: number) => {
                log.debug(`${workerLabel} harvested resource ${targetId} at (${settlerX}, ${settlerY})`);
                gameState.removeEntity(targetId);
            }),
    };
}

// ─────────────────────────────────────────────────────────────
// Inventory helpers
// ─────────────────────────────────────────────────────────────

/**
 * Check if the home building's output is full for the job's pickup material.
 */
export function isOutputFull(
    homeBuilding: Entity,
    tasks: TaskNode[],
    inventoryManager: BuildingInventoryManager
): boolean {
    const pickupTask = tasks.find(t => t.task === TaskType.PICKUP && t.good !== undefined);
    if (!pickupTask || pickupTask.good === undefined) return false;

    return (
        !inventoryManager.canAcceptInput(homeBuilding.id, pickupTask.good, 1) &&
        inventoryManager.getInputSpace(homeBuilding.id, pickupTask.good) <= 0 &&
        !canStoreInOutput(inventoryManager, homeBuilding.id, pickupTask.good)
    );
}

/**
 * Check if building can store a material in its output slot.
 */
function canStoreInOutput(
    inventoryManager: BuildingInventoryManager,
    buildingId: number,
    materialType: EMaterialType
): boolean {
    const inventory = inventoryManager.getInventory(buildingId);
    if (!inventory) return false;

    const slot = inventory.outputSlots.find(s => s.materialType === materialType);
    if (!slot) return false;

    return slot.currentAmount < slot.maxCapacity;
}
