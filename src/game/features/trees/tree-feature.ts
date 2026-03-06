/**
 * Tree Feature - Self-registering feature module for tree lifecycle.
 *
 * This feature manages:
 * - Tree growth (planted saplings -> full trees)
 * - Tree cutting (by woodcutters)
 * - Stump decay and removal
 *
 * The feature wraps TreeSystem and handles event subscriptions.
 */

import type { FeatureDefinition, FeatureContext } from '../feature';
import { TreeSystem } from './tree-system';
import { EntityType } from '../../entity';
import { MapObjectType } from '@/game/types/map-object-types';

/**
 * Exports provided by TreeFeature.
 */
export interface TreeFeatureExports {
    /** The tree system instance for querying/manipulating tree state */
    treeSystem: TreeSystem;
}

/**
 * Tree feature definition.
 * No dependencies - uses only core services from context.
 */
export const TreeFeature: FeatureDefinition = {
    id: 'trees',
    dependencies: [],

    create(ctx: FeatureContext) {
        const treeSystem = new TreeSystem({
            gameState: ctx.gameState,
            visualService: ctx.visualService,
            eventBus: ctx.eventBus,
            executeCommand: ctx.executeCommand,
        });

        // Register for map object creation events to auto-register trees
        ctx.on('entity:created', ({ entityId, type, subType }) => {
            if (type === EntityType.MapObject) {
                treeSystem.register(entityId, subType as MapObjectType);
            }
        });

        // Clean up tree state when entities are removed
        ctx.cleanupRegistry.onEntityRemoved(treeSystem.unregister.bind(treeSystem));

        return {
            systems: [treeSystem],
            exports: { treeSystem } satisfies TreeFeatureExports,
        };
    },
};
