/**
 * Work handler factories for tree-related work types.
 * Woodcutting (TREE) and forester planting (TREE_SEED_POS).
 */

import type { GameState } from '../../game-state';
import { MapObjectCategory, MapObjectType } from '@/game/types/map-object-types';
import { OBJECT_TYPE_CATEGORY } from '../../systems/map-objects';
import { findNearestEntity } from '../../systems/spatial-search';
import { createLogger } from '@/utilities/logger';
import { WorkHandlerType, type EntityWorkHandler, type PositionWorkHandler } from '../settler-tasks/types';
import { asBounded } from '../settler-tasks/choreo-types';
import type { SearchArea } from '../settler-tasks/choreo-types';
import type { PlantingCapable } from '../../systems/growth';
import type { TreeSystem } from './tree-system';

const woodcuttingLog = createLogger('WoodcuttingHandler');

/**
 * Create a handler for TREE search type (woodcutters).
 * Uses TreeSystem for tree lifecycle (cutting stages, falling animation, stump decay).
 */
export function createWoodcuttingHandler(gameState: GameState, treeSystem: TreeSystem): EntityWorkHandler {
    return {
        type: WorkHandlerType.ENTITY,

        findTarget: (area, _settlerId, player) => {
            const { center, radius } = asBounded(area);
            return findNearestEntity(
                gameState.spatialIndex.nearbyForPlayer(center, radius, player),
                center,
                radius,
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

/**
 * Create a generic planting handler for any GrowableSystem.
 * Workers find empty tiles and plant entities via the system's command.
 * Used by foresters (trees), farmers (grain/sunflower/agave), etc.
 */
export function createPlantingHandler(system: PlantingCapable): PositionWorkHandler {
    return {
        type: WorkHandlerType.POSITION,

        findPosition: (area: SearchArea) => {
            const { center, radius } = asBounded(area);
            return system.findPlantingSpot(center, radius);
        },

        onWorkAtPositionComplete: (tile, settlerId) => {
            system.plantEntity(tile, settlerId);
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
