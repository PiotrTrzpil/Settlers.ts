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
import { EventSubscriptionManager } from '../../event-bus';
import { StoneSystem } from './stone-system';
import { EntityType } from '../../entity';
import { MapObjectType } from '@/game/types/map-object-types';

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
    dependencies: [],

    create(ctx: FeatureContext) {
        const subscriptions = new EventSubscriptionManager();

        const stoneSystem = new StoneSystem(ctx.gameState, ctx.visualService);

        // Register for map object creation events to auto-register stones.
        // The variation from map data encodes the initial depletion level (1-12).
        subscriptions.subscribe(ctx.eventBus, 'entity:created', ({ entityId, type, subType, variation }) => {
            if (type === EntityType.MapObject) {
                stoneSystem.register(entityId, subType as MapObjectType, variation || undefined);
            }
        });

        // Clean up stone state when entities are removed
        ctx.cleanupRegistry.onEntityRemoved(entityId => stoneSystem.unregister(entityId));

        return {
            systems: [],
            exports: { stoneSystem } satisfies StoneFeatureExports,
            destroy: () => {
                subscriptions.unsubscribeAll();
            },
        };
    },
};
