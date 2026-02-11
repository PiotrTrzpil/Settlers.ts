/**
 * Woodcutting System - provides tree-cutting behavior for woodcutters.
 *
 * Registers as a work handler with SettlerTaskSystem.
 * Interacts with TreeSystem for tree lifecycle management.
 */

import type { GameState } from '../game-state';
import { EntityType, MapObjectType } from '../entity';
import { OBJECT_TYPE_CATEGORY } from './map-objects';
import { LogHandler } from '@/utilities/log-handler';
import { TreeSystem } from './tree-system';
import { SettlerTaskSystem, SearchType, type WorkHandler } from './settler-tasks';

const log = new LogHandler('WoodcuttingSystem');

const SEARCH_RADIUS = 30;

/**
 * Provides woodcutter behavior by registering with SettlerTaskSystem.
 */
export class WoodcuttingSystem {
    private gameState: GameState;
    private treeSystem: TreeSystem;

    constructor(gameState: GameState, treeSystem: TreeSystem, taskSystem: SettlerTaskSystem) {
        this.gameState = gameState;
        this.treeSystem = treeSystem;

        // Register as the handler for TREE search type
        taskSystem.registerWorkHandler(SearchType.TREE, this.createWorkHandler());

        log.debug('Registered woodcutter work handler');
    }

    private createWorkHandler(): WorkHandler {
        return {
            findTarget: (x: number, y: number, settlerId?: number) => {
                // Woodcutter needs a home building to return logs to
                if (settlerId !== undefined) {
                    const settler = this.gameState.getEntity(settlerId);
                    if (!settler || !this.gameState.findNearestWorkplace(settler)) {
                        log.debug(`Woodcutter ${settlerId} has no home building, cannot work`);
                        return null;
                    }
                }
                return this.findNearestTree(x, y);
            },

            canWork: (targetId: number) => {
                // Tree is valid if it's ready to cut OR already being cut by us
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
                // TODO: Spawn LOG resource at settler position
            },

            onWorkInterrupt: (targetId: number) => {
                this.treeSystem.cancelCutting(targetId);
            },
        };
    }

    private findNearestTree(x: number, y: number): { entityId: number; x: number; y: number } | null {
        let nearest: { entityId: number; x: number; y: number } | null = null;
        let minDistSq = Infinity;

        for (const entity of this.gameState.entities) {
            if (entity.type !== EntityType.MapObject) continue;

            const category = OBJECT_TYPE_CATEGORY[entity.subType as MapObjectType];
            if (category !== 'trees') continue;

            // Only consider trees that can be cut (Normal stage)
            if (!this.treeSystem.canCut(entity.id)) continue;

            const dx = entity.x - x;
            const dy = entity.y - y;
            const distSq = dx * dx + dy * dy;

            if (distSq < SEARCH_RADIUS * SEARCH_RADIUS && distSq < minDistSq) {
                minDistSq = distSq;
                nearest = { entityId: entity.id, x: entity.x, y: entity.y };
            }
        }

        return nearest;
    }
}
