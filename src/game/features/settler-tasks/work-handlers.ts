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
import type { PlantingCapable } from '../growth';
import type { TreeSystem } from '../trees/tree-system';
import type { StoneSystem } from '../stones/stone-system';
import type { CropSystem } from '../crops/crop-system';
import { OBJECT_TYPE_CATEGORY } from '../../systems/map-objects';
import { findNearestEntity } from '../../systems/spatial-search';
import { getWorkerWorkplaces } from '../../unit-types';
import { getBuildingMaxOccupants } from '../../buildings/types';

// ─────────────────────────────────────────────────────────────
// Domain helpers (used by handlers and settler-task-system)
// ─────────────────────────────────────────────────────────────

/**
 * Find the nearest workplace building for a settler based on their unit type.
 * Returns the nearest building of the appropriate type owned by the same player.
 */
export function findNearestWorkplace(
    gameState: GameState,
    settler: Entity,
    buildingOccupants?: ReadonlyMap<number, number>
): Entity | null {
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
            entity.player === settler.player &&
            (!buildingOccupants ||
                (buildingOccupants.get(entity.id) ?? 0) < getBuildingMaxOccupants(entity.subType as BuildingType))
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
    inventoryManager: BuildingInventoryManager,
    getAssignedBuilding: (settlerId: number) => Entity | null
): EntityWorkHandler {
    return {
        type: 'entity',
        shouldWaitForWork: true,

        findTarget: (_x: number, _y: number, settlerId?: number) => {
            if (settlerId === undefined) return null;

            // Use pre-assigned building (set by occupancy tracking in SettlerTaskSystem)
            const workplace = getAssignedBuilding(settlerId);
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
 * Create a generic planting handler for any GrowableSystem.
 * Workers find empty tiles and plant entities via the system's command.
 * Used by foresters (trees), farmers (grain/sunflower/agave), etc.
 */
export function createPlantingHandler(system: PlantingCapable): PositionWorkHandler {
    return {
        type: 'position',

        findPosition: (x: number, y: number) => {
            return system.findPlantingSpot(x, y);
        },

        onWorkAtPositionComplete: (posX: number, posY: number, settlerId: number) => {
            system.plantEntity(posX, posY, settlerId);
        },
    };
}

/**
 * Create a handler for TREE_SEED_POS search type (foresters).
 * Foresters find empty tiles and plant new trees via TreeSystem.
 */
export function createForesterHandler(treeSystem: TreeSystem): PositionWorkHandler {
    return createPlantingHandler(treeSystem);
}

const STONECUTTER_SEARCH_RADIUS = 30;
const stonecuttingLog = new LogHandler('StonecuttingHandler');

/**
 * Create a handler for STONE search type (stonecutters).
 * Uses StoneSystem for depletion tracking (13 visual stages per stone).
 * Each work session depletes one level; stone is removed when fully depleted.
 */
export function createStonecuttingHandler(gameState: GameState, stoneSystem: StoneSystem): EntityWorkHandler {
    return {
        type: 'entity',

        findTarget: (x: number, y: number) => {
            return findNearestEntity(gameState, x, y, STONECUTTER_SEARCH_RADIUS, entity => {
                if (entity.type !== EntityType.MapObject) return false;
                return entity.subType === MapObjectType.ResourceStone && stoneSystem.canMine(entity.id);
            });
        },

        canWork: (targetId: number) => {
            return stoneSystem.canMine(targetId) || stoneSystem.isMining(targetId);
        },

        onWorkStart: (targetId: number) => {
            stoneSystem.startMining(targetId);
        },

        onWorkTick: (_targetId: number, progress: number) => {
            return progress >= 1;
        },

        onWorkComplete: (targetId: number, settlerX: number, settlerY: number) => {
            const depleted = stoneSystem.completeMining(targetId);
            stonecuttingLog.debug(
                `Stonecutter mined stone ${targetId} at (${settlerX}, ${settlerY})${depleted ? ' — depleted' : ''}`
            );
        },

        onWorkInterrupt: (targetId: number) => {
            stoneSystem.cancelMining(targetId);
        },
    };
}

const CROP_HARVEST_SEARCH_RADIUS = 20;
const cropLog = new LogHandler('CropHandler');

/**
 * Create a harvest handler for a specific crop type.
 * Workers find mature crops, harvest them, and produce material.
 */
export function createCropHarvestHandler(
    gameState: GameState,
    cropSystem: CropSystem,
    cropType: MapObjectType
): EntityWorkHandler {
    return {
        type: 'entity',

        findTarget: (x: number, y: number) => {
            return findNearestEntity(gameState, x, y, CROP_HARVEST_SEARCH_RADIUS, entity => {
                if (entity.type !== EntityType.MapObject) return false;
                return entity.subType === cropType && cropSystem.canHarvest(entity.id);
            });
        },

        canWork: (targetId: number) => {
            return cropSystem.canHarvest(targetId) || cropSystem.isHarvesting(targetId);
        },

        onWorkStart: (targetId: number) => {
            cropSystem.startHarvesting(targetId);
        },

        onWorkTick: (targetId: number, progress: number) => {
            return cropSystem.updateHarvesting(targetId, progress);
        },

        onWorkComplete: (targetId: number, settlerX: number, settlerY: number) => {
            cropLog.debug(`Harvested ${MapObjectType[cropType]} ${targetId} at (${settlerX}, ${settlerY})`);
        },

        onWorkInterrupt: (targetId: number) => {
            cropSystem.cancelHarvesting(targetId);
        },
    };
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
