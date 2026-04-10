/**
 * Work handler factories for crop-related work types.
 * Harvest handlers and planting handlers for all crop types.
 */

import type { GameState } from '../../game-state';
import { MapObjectType } from '@/game/types/map-object-types';
import { findNearestEntity } from '../../systems/spatial-search';
import { createLogger } from '@/utilities/logger';
import { WorkHandlerType, type EntityWorkHandler } from '../settler-tasks/types';
import type { CropSystem } from './crop-system';

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

        findTarget: ({ center, radius }, _settlerId, player) => {
            if (radius === undefined) {
                throw new Error(`CropHarvestHandler: searchRadius is required (crop=${MapObjectType[cropType]})`);
            }
            return findNearestEntity(
                gameState.spatialIndex.nearbyForPlayer(center, radius, player),
                center,
                radius,
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
