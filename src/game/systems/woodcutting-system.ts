/**
 * Woodcutting System - provides tree-cutting behavior for woodcutters.
 *
 * Registers as a work handler with SettlerTaskSystem.
 * Interacts with TreeSystem for tree lifecycle management.
 */

import type { GameState } from '../game-state';
import type { MapObjectType } from '../entity';
import { OBJECT_TYPE_CATEGORY } from './map-objects';
import { LogHandler } from '@/utilities/log-handler';
import { TreeSystem } from './tree-system';
import { SettlerTaskSystem, SearchType, type WorkHandler } from './settler-tasks';
import { findNearestMapObject } from './resource-harvesting';

const log = new LogHandler('WoodcuttingSystem');

const SEARCH_RADIUS = 30;

/**
 * Provides woodcutter behavior by registering with SettlerTaskSystem.
 * Uses TreeSystem for lifecycle (cutting stages, falling animation, stump decay).
 */
export class WoodcuttingSystem {
    private treeSystem: TreeSystem;

    constructor(gameState: GameState, treeSystem: TreeSystem, taskSystem: SettlerTaskSystem) {
        this.treeSystem = treeSystem;

        // Register as the handler for TREE search type
        taskSystem.registerWorkHandler(SearchType.TREE, this.createWorkHandler(gameState));

        log.debug('Registered woodcutter work handler');
    }

    private createWorkHandler(gameState: GameState): WorkHandler {
        return {
            findTarget: (x: number, y: number) => {
                return findNearestMapObject(gameState, x, y, SEARCH_RADIUS, entity => {
                    const category = OBJECT_TYPE_CATEGORY[entity.subType as MapObjectType];
                    return category === 'trees' && this.treeSystem.canCut(entity.id);
                });
            },

            canWork: (targetId: number) => {
                return this.treeSystem.canCut(targetId) || this.treeSystem.isCutting(targetId);
            },

            onWorkStart: (targetId: number) => {
                this.treeSystem.startCutting(targetId);
            },

            onWorkTick: (targetId: number, progress: number) => {
                return this.treeSystem.updateCutting(targetId, progress);
            },

            onWorkComplete: (targetId: number, settlerX: number, settlerY: number) => {
                log.debug(`Tree ${targetId} cut at (${settlerX}, ${settlerY})`);
            },

            onWorkInterrupt: (targetId: number) => {
                this.treeSystem.cancelCutting(targetId);
            },
        };
    }
}
