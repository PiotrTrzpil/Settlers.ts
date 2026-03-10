/**
 * Stone Feature - Self-registering feature module for stone mining lifecycle.
 *
 * This feature manages:
 * - Stone depletion (by stonecutters, 13 visual stages)
 * - Visual variant assignment (A/B on creation)
 * - Mining reservation (prevents concurrent mining)
 *
 * The feature wraps StoneSystem and handles event subscriptions.
 */

import type { FeatureDefinition, FeatureContext } from '../feature';
import { StoneSystem } from './stone-system';
import { EntityType } from '../../entity';
import { MapObjectType } from '@/game/types/map-object-types';
import type { SettlerTaskExports } from '../settler-tasks/settler-tasks-feature';
import { SearchType } from '../settler-tasks';
import { createStonecuttingHandler } from './work-handlers';

/**
 * Exports provided by StoneFeature.
 */
export interface StoneFeatureExports {
    /** The stone system instance for querying/manipulating stone state */
    stoneSystem: StoneSystem;
}

/**
 * Stone feature definition.
 * No dependencies - uses only core services from context.
 */
export const StoneFeature: FeatureDefinition = {
    id: 'stones',
    dependencies: ['settler-tasks'],

    create(ctx: FeatureContext) {
        const stoneSystem = new StoneSystem({
            gameState: ctx.gameState,
            visualService: ctx.visualService,
            executeCommand: ctx.executeCommand,
        });

        // Register for map object creation events to auto-register stones.
        // The variation from map data encodes the initial depletion level (1-12).
        ctx.on('entity:created', ({ entityId, type, subType, variation }) => {
            if (type === EntityType.MapObject) {
                stoneSystem.register(entityId, subType as MapObjectType, variation || undefined);
            }
        });

        // Clean up stone state when entities are removed
        ctx.cleanupRegistry.onEntityRemoved(stoneSystem.unregister.bind(stoneSystem));

        const { settlerTaskSystem } = ctx.getFeature<SettlerTaskExports>('settler-tasks');
        settlerTaskSystem.registerWorkHandler(SearchType.STONE, createStonecuttingHandler(ctx.gameState, stoneSystem));

        return {
            systems: [],
            exports: { stoneSystem } satisfies StoneFeatureExports,
            persistence: 'none',
        };
    },
};
