/**
 * Work handler factories for built-in settler types.
 *
 * Each factory creates a WorkHandler that plugs into SettlerTaskSystem.
 * Handlers are stateless closures over their dependencies (game state, domain systems).
 *
 * Built-in handlers: WORKPLACE (building production), GOOD (carrier dummy), WATER (waterworker).
 * Domain handlers (TREE, STONE, crops, geologist) are registered by their own features.
 */

import type { GameState } from '../../game-state';
import { BuildingType, type Entity } from '../../entity';
import type { BuildingInventoryManager } from '../inventory';
import type { OreVeinData } from '../ore-veins';
import { MINE_ORE_TYPE, MINE_SEARCH_RADIUS } from '../ore-veins/ore-type';
import { isMineBuilding } from '../../buildings/types';
import { WorkHandlerType, type EntityWorkHandler, type PositionWorkHandler } from './types';
import { ProductionMode } from '../production-control';
import { spiralSearch } from '../../utils/spiral-search';
import type { TerrainData } from '../../terrain';
import type { ProductionControlManager } from '../production-control';
import type { Recipe } from '@/game/economy/building-production';
import { getRecipeSet } from '@/game/economy/building-production';

// ─────────────────────────────────────────────────────────────
// Built-in handlers (no external domain system dependency)
// ─────────────────────────────────────────────────────────────

/**
 * Create a handler for WORKPLACE search type.
 * Building workers find their workplace, wait for materials, then produce.
 *
 * When getOreVeinData returns data, mine buildings additionally check
 * that ore is available within {@link MINE_SEARCH_RADIUS} before
 * starting work and consume one ore level on completion.
 */
export function createWorkplaceHandler(
    gameState: GameState,
    inventoryManager: BuildingInventoryManager,
    getAssignedBuilding: (settlerId: number) => Entity | null,
    getOreVeinData?: () => OreVeinData | undefined,
    getProductionControlManager?: () => ProductionControlManager | undefined
): EntityWorkHandler {
    // Tracks the recipe selected at onWorkStart so onWorkComplete produces the matching output.
    const activeRecipes = new Map<number, Recipe>();

    /** Check output-slot availability for multi-recipe or single-recipe buildings. */
    function canStoreAnyOutput(targetId: number): boolean {
        const pcm = getProductionControlManager?.();
        const state = pcm?.getProductionState(targetId);
        if (!state) {
            return inventoryManager.canStoreOutput(targetId);
        }

        // Manual mode with empty queue — building idles
        if (state.mode === ProductionMode.Manual && state.queue.length === 0) {
            return false;
        }

        // Check that at least one recipe's output slot has space
        const building = gameState.getEntityOrThrow(targetId, 'workplace canWork');
        const recipeSet = getRecipeSet(building.subType as BuildingType);
        if (!recipeSet) {
            return inventoryManager.canStoreOutput(targetId);
        }
        return recipeSet.recipes.some(r => inventoryManager.canStoreOutput(targetId, r));
    }

    return {
        type: WorkHandlerType.ENTITY,
        shouldWaitForWork: true,

        findTarget: (_x: number, _y: number, settlerId?: number) => {
            if (settlerId === undefined) {
                return null;
            }

            // Use pre-assigned building (set by occupancy tracking in SettlerTaskSystem)
            const workplace = getAssignedBuilding(settlerId);
            if (!workplace) {
                return null;
            }

            return { entityId: workplace.id, x: workplace.x, y: workplace.y };
        },

        canWork: (targetId: number) => {
            if (!inventoryManager.canStartProduction(targetId)) {
                return false;
            }
            if (!canStoreAnyOutput(targetId)) {
                return false;
            }

            // Mine buildings require ore in the surrounding mountain tiles
            const oreDataForCanWork = getOreVeinData?.();
            if (oreDataForCanWork) {
                const building = gameState.getEntityOrThrow(targetId, 'mine ore check');
                const bt = building.subType as BuildingType;
                if (isMineBuilding(bt)) {
                    const oreType = MINE_ORE_TYPE.get(bt);
                    if (!oreType) {
                        return false;
                    }
                    return oreDataForCanWork.hasOreInRadius(building.x, building.y, MINE_SEARCH_RADIUS, oreType);
                }
            }
            return true;
        },

        onWorkStart: (targetId: number) => {
            const pcm = getProductionControlManager?.();
            if (pcm) {
                const recipeIndex = pcm.getNextRecipeIndex(targetId);
                if (recipeIndex !== null) {
                    const building = gameState.getEntityOrThrow(targetId, 'workplace onWorkStart');
                    const recipeSet = getRecipeSet(building.subType as BuildingType);
                    if (recipeSet) {
                        const recipe = recipeSet.recipes[recipeIndex]!;
                        activeRecipes.set(targetId, recipe);
                        inventoryManager.consumeProductionInputs(targetId, recipe);
                        return;
                    }
                }
            }
            inventoryManager.consumeProductionInputs(targetId);
        },

        onWorkTick: (_targetId: number, progress: number) => {
            return progress >= 1.0;
        },

        onWorkComplete: (targetId: number) => {
            // Mine buildings consume one ore level from a nearby tile
            const oreDataForConsume = getOreVeinData?.();
            if (oreDataForConsume) {
                const building = gameState.getEntityOrThrow(targetId, 'mine ore consume');
                const bt = building.subType as BuildingType;
                if (isMineBuilding(bt)) {
                    const oreType = MINE_ORE_TYPE.get(bt);
                    if (oreType) {
                        oreDataForConsume.consumeOreInRadius(building.x, building.y, MINE_SEARCH_RADIUS, oreType, n =>
                            gameState.rng.nextInt(n)
                        );
                    }
                }
            }

            const recipe = activeRecipes.get(targetId);
            if (recipe) {
                activeRecipes.delete(targetId);
                inventoryManager.produceOutput(targetId, recipe);
            } else {
                inventoryManager.produceOutput(targetId);
            }
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
        type: WorkHandlerType.ENTITY,
        shouldWaitForWork: true,

        findTarget: () => null,
        canWork: () => false,
        onWorkTick: () => false,
    };
}

// ─────────────────────────────────────────────────────────────
// Water handler (waterworker — draws water from river tiles)
// ─────────────────────────────────────────────────────────────

const WATER_SEARCH_RADIUS = 20;
/** River ground types (S4GroundType.RIVER1–RIVER4) */
const RIVER_TYPE_MIN = 96;
const RIVER_TYPE_MAX = 99;
function isRiverTile(groundType: number): boolean {
    return groundType >= RIVER_TYPE_MIN && groundType <= RIVER_TYPE_MAX;
}

/**
 * Create a position handler for WATER search type (waterworkers).
 * Worker walks to a nearby river tile within the work area to draw water.
 * Output deposit is handled by the choreography PUT_GOOD node (entity=GOOD_WATER),
 * not by this handler — keeping a single deposit code path through the inventory executors.
 */
export function createWaterHandler(terrain: TerrainData): PositionWorkHandler {
    return {
        type: WorkHandlerType.POSITION,

        findPosition: (x: number, y: number) => {
            return spiralSearch(x, y, terrain.width, terrain.height, (tx, ty) => {
                if (Math.abs(tx - x) > WATER_SEARCH_RADIUS || Math.abs(ty - y) > WATER_SEARCH_RADIUS) {
                    return false;
                }
                return isRiverTile(terrain.groundType[terrain.toIndex(tx, ty)]!);
            });
        },

        onWorkAtPositionComplete: () => {
            // No-op: deposit handled by PUT_GOOD choreography node
        },
    };
}
