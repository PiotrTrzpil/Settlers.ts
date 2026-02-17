/**
 * Work handler factories for all settler types.
 *
 * Each factory creates a WorkHandler that plugs into SettlerTaskSystem.
 * Handlers are stateless closures over their dependencies (game state, domain systems).
 *
 * Built-in handlers: WORKPLACE (building production), GOOD (carrier dummy).
 * Domain handlers: TREE (woodcutter), STONE (stonecutter), TREE_SEED_POS (forester in TreeSystem).
 */

import type { GameState } from '../../game-state';
import { EntityType, MapObjectType, UnitType, BuildingType, type Entity } from '../../entity';
import type { BuildingInventoryManager } from '../inventory';
import { LogHandler } from '@/utilities/log-handler';
import type { TaskNode } from './types';
import { TaskType, type EntityWorkHandler, type PositionWorkHandler } from './types';
import type { TreeSystem } from '../trees/tree-system';
import { OBJECT_TYPE_CATEGORY } from '../../systems/map-objects';
import { findNearestEntity } from '../../systems/spatial-search';
import { getWorkerWorkplaces } from '../../unit-types';

// ─────────────────────────────────────────────────────────────
// Domain helpers (used by handlers and settler-task-system)
// ─────────────────────────────────────────────────────────────

/**
 * Find the nearest workplace building for a settler based on their unit type.
 * Returns the nearest building of the appropriate type owned by the same player.
 */
export function findNearestWorkplace(gameState: GameState, settler: Entity): Entity | null {
    const unitType = settler.subType as UnitType;
    const workplaceTypes = getWorkerWorkplaces(unitType);

    if (!workplaceTypes) {
        return null;
    }

    const result = findNearestEntity(
        gameState,
        settler.x,
        settler.y,
        Infinity,
        entity =>
            entity.type === EntityType.Building &&
            workplaceTypes.has(entity.subType as BuildingType) &&
            entity.player === settler.player
    );

    return result ? gameState.getEntityOrThrow(result.entityId, 'nearest workplace') : null;
}

// ─────────────────────────────────────────────────────────────
// Built-in handlers (no external domain system dependency)
// ─────────────────────────────────────────────────────────────

/**
 * Create a handler for WORKPLACE search type.
 * Building workers find their workplace, wait for materials, then produce.
 */
export function createWorkplaceHandler(
    gameState: GameState,
    inventoryManager: BuildingInventoryManager
): EntityWorkHandler {
    return {
        type: 'entity',
        shouldWaitForWork: true,

        findTarget: (_x: number, _y: number, settlerId?: number) => {
            if (settlerId === undefined) return null;
            const settler = gameState.getEntityOrThrow(settlerId, 'settler for findTarget');

            const workplace = findNearestWorkplace(gameState, settler);
            if (!workplace) return null;

            return { entityId: workplace.id, x: workplace.x, y: workplace.y };
        },

        canWork: (targetId: number) => {
            return inventoryManager.canStartProduction(targetId) && inventoryManager.canStoreOutput(targetId);
        },

        onWorkStart: (targetId: number) => {
            inventoryManager.consumeProductionInputs(targetId);
        },

        onWorkTick: (_targetId: number, progress: number) => {
            return progress >= 1.0;
        },

        onWorkComplete: (targetId: number) => {
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
export function createCarrierHandler(): EntityWorkHandler {
    return {
        type: 'entity',
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
export function createWoodcuttingHandler(gameState: GameState, treeSystem: TreeSystem): EntityWorkHandler {
    return {
        type: 'entity',

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
export function createForesterHandler(treeSystem: TreeSystem): PositionWorkHandler {
    return {
        type: 'position',

        findPosition: (x: number, y: number) => {
            return treeSystem.findPlantingSpot(x, y);
        },

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
export function createStonecuttingHandler(gameState: GameState): EntityWorkHandler {
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
export function createSimpleHarvestHandler(config: SimpleHarvestConfig): EntityWorkHandler {
    const { gameState, log, workerLabel, searchRadius, targetFilter } = config;

    return {
        type: 'entity',

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

export function isOutputFull(
    homeBuilding: Entity,
    tasks: TaskNode[],
    inventoryManager: BuildingInventoryManager
): boolean {
    const pickupTask = tasks.find(t => t.task === TaskType.PICKUP && t.good !== undefined);
    if (!pickupTask) return false;

    const material = pickupTask.good!;
    const id = homeBuilding.id;

    // Check all possible storage: input slots, input space, and output slots
    if (inventoryManager.canAcceptInput(id, material, 1)) return false;
    if (inventoryManager.getInputSpace(id, material) > 0) return false;

    // Check output slot capacity directly
    const inventory = inventoryManager.getInventory(id);
    if (!inventory) return false;
    const outputSlot = inventory.outputSlots.find(s => s.materialType === material);
    if (outputSlot && outputSlot.currentAmount < outputSlot.maxCapacity) return false;

    return true;
}
