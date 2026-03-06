/**
 * Carrier Feature - Self-registering feature module for carrier membership tracking.
 *
 * This feature manages:
 * - Auto-registration of spawned carrier units
 * - Carrier cleanup on entity removal
 */

import type { FeatureDefinition, FeatureContext } from '../feature';
import { CarrierRegistry } from './carrier-manager';
import { UnitType } from '../../entity';

export interface CarrierFeatureExports {
    carrierRegistry: CarrierRegistry;
}

export const CarrierFeature: FeatureDefinition = {
    id: 'carriers',
    dependencies: [],

    create(ctx: FeatureContext) {
        const carrierRegistry = new CarrierRegistry({
            entityProvider: ctx.gameState,
            eventBus: ctx.eventBus,
        });

        ctx.on('unit:spawned', payload => {
            if (payload.unitType === UnitType.Carrier) {
                carrierRegistry.register(payload.entityId);
            }
        });

        ctx.cleanupRegistry.onEntityRemoved(entityId => {
            if (carrierRegistry.has(entityId)) {
                carrierRegistry.remove(entityId);
            }
        });

        return {
            exports: { carrierRegistry } satisfies CarrierFeatureExports,
        };
    },
};
