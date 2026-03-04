/**
 * Carrier Feature - Self-registering feature module for carrier state management.
 *
 * This feature manages:
 * - Auto-registration of spawned carrier units
 * - Carrier state cleanup on entity removal
 */

import type { FeatureDefinition, FeatureContext } from '../feature';
import { EventSubscriptionManager } from '../../event-bus';
import { CarrierManager } from './carrier-manager';
import { UnitType } from '../../entity';

/**
 * Exports provided by CarrierFeature.
 */
export interface CarrierFeatureExports {
    /** The carrier manager instance for querying/updating carrier state */
    carrierManager: CarrierManager;
}

/**
 * Carrier feature definition.
 * No dependencies - uses only core services from context.
 */
export const CarrierFeature: FeatureDefinition = {
    id: 'carriers',
    dependencies: [],

    create(ctx: FeatureContext) {
        const subscriptions = new EventSubscriptionManager();

        const carrierManager = new CarrierManager({
            entityProvider: ctx.gameState,
            eventBus: ctx.eventBus,
        });

        // Auto-register spawned carrier units
        subscriptions.subscribe(ctx.eventBus, 'unit:spawned', payload => {
            if (payload.unitType === UnitType.Carrier) {
                carrierManager.registerCarrier(payload.entityId);
            }
        });

        // Clean up carrier state when entities are removed
        ctx.cleanupRegistry.onEntityRemoved(entityId => {
            if (carrierManager.hasCarrier(entityId)) {
                carrierManager.removeCarrier(entityId);
            }
        });

        return {
            exports: { carrierManager } satisfies CarrierFeatureExports,
            destroy: () => {
                subscriptions.unsubscribeAll();
            },
        };
    },
};
