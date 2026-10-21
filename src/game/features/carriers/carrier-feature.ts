/**
 * Carrier Feature - Self-registering feature module for carrier membership tracking.
 *
 * This feature manages:
 * - Auto-registration of spawned carrier units
 * - Carrier cleanup on entity removal
 */

import type { FeatureDefinition, FeatureContext } from '../feature';
import { CarrierRegistry } from './carrier-registry';
import { IdleCarrierPool } from './idle-carrier-pool';
import { UnitType } from '../../entity';

export interface CarrierFeatureExports {
    carrierRegistry: CarrierRegistry;
    idleCarrierPool: IdleCarrierPool;
}

export const CarrierFeature: FeatureDefinition = {
    id: 'carriers',
    dependencies: [],

    create(ctx: FeatureContext) {
        const carrierRegistry = new CarrierRegistry({
            entityProvider: ctx.gameState,
        });

        ctx.on('unit:spawned', payload => {
            if (payload.unitType === UnitType.Carrier) {
                carrierRegistry.register(payload.unitId);
            }
        });

        ctx.cleanupRegistry.onEntityRemoved(entityId => {
            if (carrierRegistry.has(entityId)) {
                carrierRegistry.remove(entityId);
            }
        });

        const idleCarrierPool = new IdleCarrierPool({
            gameState: ctx.gameState,
            carrierRegistry,
            unitCommitments: ctx.unitCommitments,
        });

        return {
            exports: {
                carrierRegistry,
                idleCarrierPool,
            } satisfies CarrierFeatureExports,
            persistence: [],
            onRestoreComplete() {
                carrierRegistry.rebuildFromEntities();
            },
        };
    },
};
