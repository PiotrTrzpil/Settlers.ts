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
import { EntityType, UnitType, BuildingType, type Entity } from '../../entity';
import type { ConstructionSiteManager } from '../building-construction/construction-site-manager';
import { getBuildingDoorPos } from '../../game-data-access';
import { MapObjectCategory, MapObjectType } from '@/game/types/map-object-types';
import type { BuildingInventoryManager } from '../inventory';
import type { OreVeinData } from '../ore-veins';
import { MINE_ORE_TYPE, MINE_SEARCH_RADIUS } from '../ore-veins/ore-type';
import { isMineBuilding } from '../../buildings/types';
import { createLogger, type Logger } from '@/utilities/logger';
import { WorkHandlerType, type EntityWorkHandler, type PositionWorkHandler } from './types';
import type { PlantingCapable } from '../growth';
import type { TreeSystem } from '../trees/tree-system';
import type { StoneSystem } from '../stones/stone-system';
import type { CropSystem } from '../crops/crop-system';
import { OBJECT_TYPE_CATEGORY } from '../../systems/map-objects';
import { findNearestEntity } from '../../systems/spatial-search';
import { ProductionMode } from '../production-control';
import { getWorkerBuildingTypes } from '../../game-data-access';
import { getBuildingMaxOccupants } from '../../buildings/types';
import { spiralSearch } from '../../utils/spiral-search';
import type { TerrainData } from '../../terrain';
import type { ResourceSignSystem } from '../ore-veins/resource-sign-system';
import type { ProductionControlManager } from '../production-control';
import type { Recipe } from '@/game/economy/building-production';
import { getRecipeSet } from '@/game/economy/building-production';

// ─────────────────────────────────────────────────────────────
// Domain helpers (used by handlers and settler-task-system)
// ─────────────────────────────────────────────────────────────

/**
 * Find the nearest workplace building for a settler based on their unit type.
 * Building-to-worker mapping is derived from buildingInfo.xml (inhabitant field).
 * Returns the nearest building of the appropriate type owned by the same player.
 *
 * @param isBuildingAvailable Optional filter — returns false for buildings that should be
 *   skipped (e.g. buildings still under construction).
 */
export function findNearestWorkplace(
    gameState: GameState,
    settler: Entity,
    buildingOccupants?: ReadonlyMap<number, number>,
    isBuildingAvailable?: (buildingId: number) => boolean
): Entity | null {
    const unitType = settler.subType as UnitType;
    const workplaceTypes = getWorkerBuildingTypes(settler.race, unitType);

    if (!workplaceTypes) {
        return null;
    }

    // Use entity index — iterates only this player's buildings, not all entities
    const result = findNearestEntity(
        gameState.entityIndex.ofTypeAndPlayer(EntityType.Building, settler.player),
        settler.x,
        settler.y,
        Infinity,
        entity =>
            workplaceTypes.has(entity.subType as BuildingType) &&
            (!isBuildingAvailable || isBuildingAvailable(entity.id)) &&
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
        if (!state) return inventoryManager.canStoreOutput(targetId);

        // Manual mode with empty queue — building idles
        if (state.mode === ProductionMode.Manual && state.queue.length === 0) return false;

        // Check that at least one recipe's output slot has space
        const building = gameState.getEntityOrThrow(targetId, 'workplace canWork');
        const recipeSet = getRecipeSet(building.subType as BuildingType);
        if (!recipeSet) return inventoryManager.canStoreOutput(targetId);
        return recipeSet.recipes.some(r => inventoryManager.canStoreOutput(targetId, r));
    }

    return {
        type: WorkHandlerType.ENTITY,
        shouldWaitForWork: true,

        findTarget: (_x: number, _y: number, settlerId?: number) => {
            if (settlerId === undefined) return null;

            // Use pre-assigned building (set by occupancy tracking in SettlerTaskSystem)
            const workplace = getAssignedBuilding(settlerId);
            if (!workplace) return null;

            return { entityId: workplace.id, x: workplace.x, y: workplace.y };
        },

        canWork: (targetId: number) => {
            if (!inventoryManager.canStartProduction(targetId)) return false;
            if (!canStoreAnyOutput(targetId)) return false;

            // Mine buildings require ore in the surrounding mountain tiles
            const oreDataForCanWork = getOreVeinData?.();
            if (oreDataForCanWork) {
                const building = gameState.getEntityOrThrow(targetId, 'mine ore check');
                const bt = building.subType as BuildingType;
                if (isMineBuilding(bt)) {
                    const oreType = MINE_ORE_TYPE.get(bt);
                    if (!oreType) return false;
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
// Domain handlers (depend on external systems)
// ─────────────────────────────────────────────────────────────

const WOODCUTTER_SEARCH_RADIUS = 30;

/**
 * Create a handler for TREE search type (woodcutters).
 * Uses TreeSystem for tree lifecycle (cutting stages, falling animation, stump decay).
 */
export function createWoodcuttingHandler(gameState: GameState, treeSystem: TreeSystem): EntityWorkHandler {
    return {
        type: WorkHandlerType.ENTITY,

        findTarget: (x: number, y: number, _settlerId?: number, player?: number) => {
            return findNearestEntity(
                gameState.spatialIndex.nearbyForPlayer(x, y, WOODCUTTER_SEARCH_RADIUS, player!),
                x,
                y,
                WOODCUTTER_SEARCH_RADIUS,
                entity => {
                    const category = OBJECT_TYPE_CATEGORY[entity.subType as MapObjectType];
                    return category === MapObjectCategory.Trees && treeSystem.canCut(entity.id);
                }
            );
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

const woodcuttingLog = createLogger('WoodcuttingHandler');

/**
 * Create a generic planting handler for any GrowableSystem.
 * Workers find empty tiles and plant entities via the system's command.
 * Used by foresters (trees), farmers (grain/sunflower/agave), etc.
 */
export function createPlantingHandler(system: PlantingCapable): PositionWorkHandler {
    return {
        type: WorkHandlerType.POSITION,
        useWorkAreaCenter: true,

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
const stonecuttingLog = createLogger('StonecuttingHandler');

/**
 * Create a handler for STONE search type (stonecutters).
 * Uses StoneSystem for depletion tracking (13 visual stages per stone).
 * Each work session depletes one level; stone is removed when fully depleted.
 */
export function createStonecuttingHandler(gameState: GameState, stoneSystem: StoneSystem): EntityWorkHandler {
    return {
        type: WorkHandlerType.ENTITY,

        findTarget: (x: number, y: number, _settlerId?: number, player?: number) => {
            return findNearestEntity(
                gameState.spatialIndex.nearbyForPlayer(x, y, STONECUTTER_SEARCH_RADIUS, player!),
                x,
                y,
                STONECUTTER_SEARCH_RADIUS,
                entity => entity.subType === MapObjectType.ResourceStone && stoneSystem.canMine(entity.id)
            );
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
const cropLog = createLogger('CropHandler');

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
        type: WorkHandlerType.ENTITY,

        findTarget: (x: number, y: number, _settlerId?: number, player?: number) => {
            return findNearestEntity(
                gameState.spatialIndex.nearbyForPlayer(x, y, CROP_HARVEST_SEARCH_RADIUS, player!),
                x,
                y,
                CROP_HARVEST_SEARCH_RADIUS,
                entity => entity.subType === cropType && cropSystem.canHarvest(entity.id)
            );
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
    log: Logger;
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
        type: WorkHandlerType.ENTITY,

        findTarget: (x: number, y: number, _settlerId?: number, player?: number) => {
            return findNearestEntity(
                gameState.spatialIndex.nearbyForPlayer(x, y, searchRadius, player!),
                x,
                y,
                searchRadius,
                targetFilter
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
// Water handler (waterworker — draws water from river tiles)
// ─────────────────────────────────────────────────────────────

const WATER_SEARCH_RADIUS = 20;
/** River ground types (S4GroundType.RIVER1–RIVER4) */
const RIVER_TYPE_MIN = 96;
const RIVER_TYPE_MAX = 99;
const waterLog = createLogger('WaterHandler');

function isRiverTile(groundType: number): boolean {
    return groundType >= RIVER_TYPE_MIN && groundType <= RIVER_TYPE_MAX;
}

/**
 * Create a position handler for WATER search type (waterworkers).
 * Worker walks to a nearby river tile within the work area, draws water,
 * and deposits WATER output at their assigned building.
 */
export function createWaterHandler(
    terrain: TerrainData,
    inventoryManager: BuildingInventoryManager,
    getAssignedBuilding: (settlerId: number) => number | null
): PositionWorkHandler {
    return {
        type: WorkHandlerType.POSITION,

        findPosition: (x: number, y: number) => {
            return spiralSearch(x, y, terrain.width, terrain.height, (tx, ty) => {
                if (Math.abs(tx - x) > WATER_SEARCH_RADIUS || Math.abs(ty - y) > WATER_SEARCH_RADIUS) return false;
                return isRiverTile(terrain.groundType[terrain.toIndex(tx, ty)]!);
            });
        },

        onWorkAtPositionComplete: (_x: number, _y: number, settlerId: number) => {
            const buildingId = getAssignedBuilding(settlerId);
            if (buildingId === null) {
                waterLog.debug(`Waterworker ${settlerId} has no assigned building, skipping output`);
                return;
            }
            if (inventoryManager.canStoreOutput(buildingId)) {
                inventoryManager.produceOutput(buildingId);
                waterLog.debug(`Waterworker ${settlerId} deposited WATER at building ${buildingId}`);
            }
        },
    };
}

// ─────────────────────────────────────────────────────────────
// Geologist handler (prospects mountain tiles for ore signs)
// ─────────────────────────────────────────────────────────────

const GEOLOGIST_SEARCH_RADIUS = 20;

/**
 * Create a position handler for RESOURCE_POS search type (geologists).
 * Worker walks to an unprospected rock tile, performs work animation,
 * then marks the tile as prospected and places a resource sign.
 */
export function createGeologistHandler(
    oreVeinData: OreVeinData,
    terrain: TerrainData,
    signSystem: ResourceSignSystem
): PositionWorkHandler {
    return {
        type: WorkHandlerType.POSITION,

        findPosition: (x: number, y: number) => {
            return spiralSearch(x, y, terrain.width, terrain.height, (tx, ty) => {
                if (Math.abs(tx - x) > GEOLOGIST_SEARCH_RADIUS || Math.abs(ty - y) > GEOLOGIST_SEARCH_RADIUS) {
                    return false;
                }
                return terrain.isRock(tx, ty) && !oreVeinData.isProspected(tx, ty);
            });
        },

        onWorkAtPositionComplete: (posX: number, posY: number, _settlerId: number) => {
            oreVeinData.setProspected(posX, posY);
            signSystem.placeSign(posX, posY);
        },
    };
}

// ─────────────────────────────────────────────────────────────
// Construction handlers (digger + builder)
// ─────────────────────────────────────────────────────────────

const diggerLog = createLogger('DiggerHandler');
const builderLog = createLogger('BuilderHandler');

/**
 * Create a handler for CONSTRUCTION_DIG search type (diggers).
 *
 * Diggers find construction sites that need terrain leveling, walk there, and perform
 * repeated work cycles until leveling is complete. Slot claim/release is managed
 * via a FIFO pending queue (findTarget → onWorkStart) and an active map
 * (onWorkStart → onWorkComplete/onWorkInterrupt) so that multiple diggers can safely
 * work the same site concurrently without ID collisions.
 */
export function createDiggerHandler(
    gameState: GameState,
    constructionSiteManager: ConstructionSiteManager
): EntityWorkHandler {
    // FIFO queue per target: findTarget pushes settlerId, onWorkStart shifts it
    const pendingClaims = new Map<number, number[]>();
    // Active workers: settlerId → targetId; used to release the correct slot on complete/interrupt
    const activeWorkers = new Map<number, number>();

    function releaseActive(targetId: number, settlerLabel: string): void {
        for (const [sid, tid] of activeWorkers) {
            if (tid === targetId) {
                const site = constructionSiteManager.getSite(targetId);
                if (site) {
                    constructionSiteManager.releaseDiggerSlot(targetId, sid);
                } else {
                    diggerLog.debug(`${settlerLabel}: site ${targetId} already removed, skipping slot release`);
                }
                activeWorkers.delete(sid);
                return;
            }
        }
    }

    return {
        type: WorkHandlerType.ENTITY,
        shouldWaitForWork: true,

        findTarget: (x: number, y: number, settlerId?: number) => {
            if (settlerId === undefined) return null;

            // If already claimed on a site, continue there
            const existingTarget = activeWorkers.get(settlerId);
            if (existingTarget !== undefined) {
                const site = constructionSiteManager.getSite(existingTarget);
                if (site && !site.terrain.complete) {
                    // Return next unleveled tile position (not door) for intra-site walking
                    const tilePos = constructionSiteManager.getNextUnleveledTilePos(existingTarget);
                    if (tilePos) {
                        return { entityId: existingTarget, x: tilePos.x, y: tilePos.y };
                    }
                }
                // Work done or site removed — release
                releaseActive(existingTarget, 'digger findTarget (done)');
            }

            const settler = gameState.getEntityOrThrow(settlerId, 'digger findTarget');
            const buildingId = constructionSiteManager.findSiteNeedingDiggers(x, y, settler.player);
            if (buildingId === undefined) return null;

            const site = constructionSiteManager.getSite(buildingId);
            if (!site) return null;

            // Check that pending + assigned doesn't exceed slot limit
            const pending = pendingClaims.get(buildingId);
            const pendingCount = pending ? pending.length : 0;
            if (site.terrain.slots.assigned.size + pendingCount >= site.terrain.slots.required) return null;

            // Queue this settler for slot claim in onWorkStart
            const queue = pending ?? [];
            queue.push(settlerId);
            pendingClaims.set(buildingId, queue);

            // Return next unleveled tile position for direct walking to work site
            const tilePos = constructionSiteManager.getNextUnleveledTilePos(buildingId);
            if (tilePos) {
                return { entityId: buildingId, x: tilePos.x, y: tilePos.y };
            }
            // No tiles to level (shouldn't happen for a site needing diggers)
            const door = getBuildingDoorPos(site.tileX, site.tileY, site.race, site.buildingType);
            return { entityId: buildingId, x: door.x, y: door.y };
        },

        canWork: (targetId: number) => {
            const site = constructionSiteManager.getSite(targetId);
            return !!site && !site.terrain.complete;
        },

        onWorkStart: (targetId: number) => {
            // If settler already claimed (continuing work), skip re-claim
            const queue = pendingClaims.get(targetId);
            if (!queue || queue.length === 0) return;
            const settlerId = queue.shift()!;
            if (queue.length === 0) pendingClaims.delete(targetId);
            activeWorkers.set(settlerId, targetId);
            constructionSiteManager.claimDiggerSlot(targetId, settlerId);
        },

        onWorkTick: () => {
            // Each choreo work cycle = one leveling step. Return true to complete immediately
            // when the choreo node has duration=-1 (domain-controlled timing).
            return true;
        },

        onWorkComplete: (targetId: number) => {
            const site = constructionSiteManager.getSite(targetId);
            if (site) {
                // Complete one tile's terrain leveling
                constructionSiteManager.completeNextTile(targetId);
                // Stay claimed until leveling is complete
                if (!site.terrain.complete) return;
            }
            releaseActive(targetId, 'digger onWorkComplete');
        },

        onWorkInterrupt: (targetId: number) => {
            releaseActive(targetId, 'digger onWorkInterrupt');
        },
    };
}

/** Number of animation (work) cycles a builder plays per 1 unit of material consumed. */
const BUILD_CYCLES_PER_MATERIAL = 10;

/**
 * Create a handler for CONSTRUCTION search type (builders).
 *
 * Builders find construction sites where leveling is complete and materials have been
 * delivered, walk there, and perform repeated work cycles that consume materials and
 * advance construction progress. Uses the same pending-queue / active-map slot
 * tracking as the digger handler.
 */
export function createBuilderHandler(
    gameState: GameState,
    constructionSiteManager: ConstructionSiteManager
): EntityWorkHandler {
    // FIFO queue per target: findTarget pushes settlerId, onWorkStart shifts it
    const pendingClaims = new Map<number, number[]>();
    // Active workers: settlerId → targetId; used to release the correct slot on complete/interrupt
    const activeWorkers = new Map<number, number>();
    // Counts work cycles per target to know when to consume a material unit
    const cycleCounters = new Map<number, number>();

    function releaseActive(targetId: number, settlerLabel: string): void {
        for (const [sid, tid] of activeWorkers) {
            if (tid === targetId) {
                const site = constructionSiteManager.getSite(targetId);
                if (site) {
                    constructionSiteManager.releaseBuilderSlot(targetId, sid);
                } else {
                    builderLog.debug(`${settlerLabel}: site ${targetId} already removed, skipping slot release`);
                }
                activeWorkers.delete(sid);
                return;
            }
        }
    }

    return {
        type: WorkHandlerType.ENTITY,
        shouldWaitForWork: true,

        findTarget: (x: number, y: number, settlerId?: number) => {
            if (settlerId === undefined) return null;

            // If already claimed on a site, continue there if materials available
            const existingTarget = activeWorkers.get(settlerId);
            if (existingTarget !== undefined) {
                const site = constructionSiteManager.getSite(existingTarget);
                if (
                    site &&
                    site.building.progress < 1.0 &&
                    constructionSiteManager.hasAvailableMaterials(existingTarget)
                ) {
                    const pos = constructionSiteManager.getRandomBuilderWorkPos(existingTarget);
                    return { entityId: existingTarget, x: pos.x, y: pos.y };
                }
                // Construction done, materials exhausted, or site removed — release
                releaseActive(existingTarget, 'builder findTarget (done)');
            }

            const settler = gameState.getEntityOrThrow(settlerId, 'builder findTarget');
            const buildingId = constructionSiteManager.findSiteNeedingBuilders(x, y, settler.player);
            if (buildingId === undefined) return null;

            const site = constructionSiteManager.getSite(buildingId);
            if (!site) return null;

            // Check that pending + assigned doesn't exceed slot limit
            const pending = pendingClaims.get(buildingId);
            const pendingCount = pending ? pending.length : 0;
            if (site.building.slots.assigned.size + pendingCount >= site.building.slots.required) return null;

            // Queue this settler for slot claim in onWorkStart
            const queue = pending ?? [];
            queue.push(settlerId);
            pendingClaims.set(buildingId, queue);

            // Random position along the lower border of the building footprint
            const pos = constructionSiteManager.getRandomBuilderWorkPos(buildingId);
            return { entityId: buildingId, x: pos.x, y: pos.y };
        },

        canWork: (targetId: number) => {
            const site = constructionSiteManager.getSite(targetId);
            return (
                !!site &&
                site.terrain.complete &&
                site.building.progress < 1.0 &&
                constructionSiteManager.hasAvailableMaterials(targetId)
            );
        },

        onWorkStart: (targetId: number) => {
            // If settler already claimed (continuing work), skip re-claim
            const queue = pendingClaims.get(targetId);
            if (!queue || queue.length === 0) return;
            const settlerId = queue.shift()!;
            if (queue.length === 0) pendingClaims.delete(targetId);
            activeWorkers.set(settlerId, targetId);
            constructionSiteManager.claimBuilderSlot(targetId, settlerId);
        },

        onWorkTick: () => {
            // Each choreo work cycle = one build step. Return true to complete immediately
            // when the choreo node has duration=-1 (domain-controlled timing).
            return true;
        },

        onWorkComplete: (targetId: number) => {
            const site = constructionSiteManager.getSite(targetId);
            if (site) {
                const totalCycles = site.materials.totalCost * BUILD_CYCLES_PER_MATERIAL;
                const progressPerCycle = 1.0 / totalCycles;
                constructionSiteManager.advanceConstruction(targetId, progressPerCycle);

                // Consume one material unit every BUILD_CYCLES_PER_MATERIAL cycles
                const count = (cycleCounters.get(targetId) ?? 0) + 1;
                if (count >= BUILD_CYCLES_PER_MATERIAL) {
                    site.materials.consumedAmount += 1;
                    cycleCounters.set(targetId, 0);
                } else {
                    cycleCounters.set(targetId, count);
                }

                // Stay claimed until construction done or materials exhausted
                if (site.building.progress < 1.0 && constructionSiteManager.hasAvailableMaterials(targetId)) return;
            }
            cycleCounters.delete(targetId);
            releaseActive(targetId, 'builder onWorkComplete');
        },

        onWorkInterrupt: (targetId: number) => {
            cycleCounters.delete(targetId);
            releaseActive(targetId, 'builder onWorkInterrupt');
        },
    };
}
