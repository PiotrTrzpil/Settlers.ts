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
import { EventSubscriptionManager } from '../../event-bus';
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
        const subscriptions = new EventSubscriptionManager();

        // Create the tree system
        const treeSystem = new TreeSystem(ctx.gameState, ctx.visualService, ctx.eventBus);

        // Register for map object creation events to auto-register trees
        subscriptions.subscribe(ctx.eventBus, 'entity:created', ({ entityId, type, subType }) => {
            if (type === EntityType.MapObject) {
                treeSystem.register(entityId, subType as MapObjectType);
            }
        });

        // Clean up tree state when entities are removed
        ctx.cleanupRegistry.onEntityRemoved(treeSystem.unregister.bind(treeSystem));

        return {
            systems: [treeSystem],
            exports: { treeSystem } satisfies TreeFeatureExports,
            destroy: () => {
                subscriptions.unsubscribeAll();
            },
        };
    },
};
