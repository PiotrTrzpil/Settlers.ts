/**
 * Shared utilities for resource harvesting systems.
 *
 * Provides the SimpleHarvestHandler factory used by StonecuttingSystem
 * and future harvesting systems (e.g., fishing, hunting).
 */

import type { GameState } from '../game-state';
import type { Entity } from '../entity';
import { EntityType } from '../entity';
import { LogHandler } from '@/utilities/log-handler';
import type { WorkHandler } from './settler-tasks';
import { findNearestEntity } from './spatial-search';

/**
 * Configuration for creating a simple resource harvest work handler.
 * Covers the common pattern: find resource → work on it → resource consumed → pickup material.
 */
export interface SimpleHarvestConfig {
    /** Game state reference */
    gameState: GameState;
    /** Logger instance */
    log: LogHandler;
    /** Label for log messages (e.g., "Stonecutter") */
    workerLabel: string;
    /** Search radius in tiles */
    searchRadius: number;
    /** Filter to find valid target entities */
    targetFilter: (entity: Entity) => boolean;
    /** Called when work completes. Default: removes the target entity. */
    onComplete?: (targetId: number, settlerX: number, settlerY: number) => void;
}

/**
 * Create a work handler for simple resource harvesting.
 * Handles the common case where a worker finds a resource entity, works on it
 * until progress reaches 1.0, and the resource is consumed.
 *
 * Note: Workplace validation is handled by SettlerTaskSystem.handleIdle() before
 * calling findTarget, so handlers don't need to check for a home building.
 *
 * For more complex behaviors (e.g., tree cutting with stages), write a custom handler.
 */
export function createSimpleHarvestHandler(config: SimpleHarvestConfig): WorkHandler {
    const { gameState, log, workerLabel, searchRadius, targetFilter } = config;

    return {
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
