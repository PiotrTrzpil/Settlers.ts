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
import { EntityType, MapObjectType } from '../../entity';

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

        const stoneSystem = new StoneSystem(ctx.gameState);

        // Register for map object creation events to auto-register stones.
        // If entity.variation is pre-set (1-12 from map data), use it as initial depletion level.
        subscriptions.subscribe(ctx.eventBus, 'entity:created', ({ entityId, type, subType }) => {
            if (type === EntityType.MapObject) {
                const variation = ctx.gameState.getEntity(entityId)?.variation;
                const initialLevel = variation && variation > 0 && variation <= 12 ? variation : undefined;
                stoneSystem.register(entityId, subType as MapObjectType, initialLevel);
            }
        });

        // Clean up stone state when entities are removed
        subscriptions.subscribe(ctx.eventBus, 'entity:removed', ({ entityId }) => {
            stoneSystem.unregister(entityId);
        });

        return {
            systems: [],
            exports: { stoneSystem } satisfies StoneFeatureExports,
            destroy: () => {
                subscriptions.unsubscribeAll();
            },
        };
    },
};
