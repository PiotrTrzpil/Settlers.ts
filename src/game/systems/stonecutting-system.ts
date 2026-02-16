/**
 * Stonecutting System - provides stone-cutting behavior for stonecutters.
 *
 * Registers as a work handler with SettlerTaskSystem.
 * Stonecutters find stone resources on the map, mine them, and carry stone home.
 */

import type { GameState } from '../game-state';
import { MapObjectType } from '../entity';
import { LogHandler } from '@/utilities/log-handler';
import { SettlerTaskSystem, SearchType } from './settler-tasks';
import { createSimpleHarvestHandler } from './resource-harvesting';

const log = new LogHandler('StonecuttingSystem');

const SEARCH_RADIUS = 30;

/**
 * Provides stonecutter behavior by registering with SettlerTaskSystem.
 */
export class StonecuttingSystem {
    constructor(gameState: GameState, taskSystem: SettlerTaskSystem) {
        taskSystem.registerWorkHandler(
            SearchType.STONE,
            createSimpleHarvestHandler({
                gameState,
                log,
                workerLabel: 'Stonecutter',
                searchRadius: SEARCH_RADIUS,
                targetFilter: entity => entity.subType === MapObjectType.ResourceStone,
            })
        );

        log.debug('Registered stonecutter work handler');
    }
}
