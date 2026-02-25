/**
 * Flag Feature — displays small animated flags near buildings.
 *
 * Listens for building creation/removal events and spawns/removes
 * Decoration entities that the renderer draws as animated flag sprites.
 */

import type { FeatureDefinition, FeatureContext } from '../feature';
import { EventSubscriptionManager } from '../../event-bus';
import { EntityType, BuildingType } from '../../entity';
import { FlagManager } from './flag-manager';

export interface FlagFeatureExports {
    flagManager: FlagManager;
}

export const FlagFeature: FeatureDefinition = {
    id: 'flags',
    dependencies: [],

    create(ctx: FeatureContext) {
        const subscriptions = new EventSubscriptionManager();
        const flagManager = new FlagManager(ctx.gameState);

        // When a building is created, spawn a flag at its position
        subscriptions.subscribe(ctx.eventBus, 'entity:created', ({ entityId, type, subType, x, y, player }) => {
            if (type !== EntityType.Building) return;

            const entity = ctx.gameState.getEntity(entityId);
            if (!entity) return;

            flagManager.createFlag(entityId, subType as BuildingType, x, y, player, entity.race);
        });

        // When a building is removed, remove its flag
        subscriptions.subscribe(ctx.eventBus, 'entity:removed', ({ entityId }) => {
            flagManager.removeFlag(entityId);
        });

        return {
            systems: [],
            exports: { flagManager } satisfies FlagFeatureExports,
            destroy: () => {
                subscriptions.unsubscribeAll();
            },
        };
    },
};
