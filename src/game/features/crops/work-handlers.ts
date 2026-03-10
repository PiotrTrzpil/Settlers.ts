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
