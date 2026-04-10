/**
 * Work handler factory for stone mining (STONE search type).
 */

import type { GameState } from '../../game-state';
import { isHarvestableStone } from '@/game/types/map-object-types';
import { findNearestEntity } from '../../systems/spatial-search';
import { createLogger } from '@/utilities/logger';
import { WorkHandlerType, type EntityWorkHandler } from '../settler-tasks/types';
import { asBounded } from '../settler-tasks/choreo-types';
import type { StoneSystem } from './stone-system';

const stonecuttingLog = createLogger('StonecuttingHandler');

/**
 * Create a handler for STONE search type (stonecutters).
 * Uses StoneSystem for depletion tracking (13 visual stages per stone).
 * Each work session depletes one level; stone is removed when fully depleted.
 */
export function createStonecuttingHandler(gameState: GameState, stoneSystem: StoneSystem): EntityWorkHandler {
    return {
        type: WorkHandlerType.ENTITY,

        findTarget: (area, _settlerId, player) => {
            const { center, radius } = asBounded(area);
            return findNearestEntity(
                gameState.spatialIndex.nearbyForPlayer(center, radius, player),
                center,
                radius,
                entity => isHarvestableStone(entity.subType as number) && stoneSystem.canMine(entity.id)
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
