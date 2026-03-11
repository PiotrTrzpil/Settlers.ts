/**
 * Carrier Feature - Self-registering feature module for carrier membership tracking.
 *
 * This feature manages:
 * - Auto-registration of spawned carrier units
 * - Carrier cleanup on entity removal
 */

import type { FeatureDefinition, FeatureContext } from '../feature';
import { CarrierRegistry } from '../../systems/carrier-registry';
import { IdleCarrierPool } from '../../systems/idle-carrier-pool';
import { UnitType } from '../../entity';

export interface CarrierFeatureExports {
    carrierRegistry: CarrierRegistry;
    idleCarrierPool: IdleCarrierPool;
    /** Late-bind the transport busy check from logistics-dispatcher. */
    setIsTransportBusy(fn: (carrierId: number) => boolean): void;
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

        // isTransportBusy is wired later by logistics-dispatcher feature (late binding
        // avoids circular dep: carriers tier < logistics tier).
        let isTransportBusy: (carrierId: number) => boolean = (_carrierId: number) => false;

        const idleCarrierPool = new IdleCarrierPool({
            gameState: ctx.gameState,
            carrierRegistry,
            isTransportBusy: (carrierId: number) => isTransportBusy(carrierId),
            unitReservation: ctx.unitReservation,
        });

        return {
            exports: {
                carrierRegistry,
                idleCarrierPool,
                setIsTransportBusy(fn: (carrierId: number) => boolean) {
                    isTransportBusy = fn;
                },
            } satisfies CarrierFeatureExports,
            persistence: [carrierRegistry],
        };
    },
};
