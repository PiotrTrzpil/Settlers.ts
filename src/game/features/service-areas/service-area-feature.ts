/**
 * Service Area Feature - Self-registering feature module for logistics service areas.
 *
 * Creates and removes service areas in response to building lifecycle events.
 * Only buildings in SERVICE_AREA_BUILDINGS get service areas (taverns/residences).
 *
 * Service areas are created on building:completed (not entity:created) so that
 * buildings under construction are excluded from the logistics network.
 * For save-restored buildings, createServiceAreaIfCompleted() is called
 * after building states are restored.
 */

import type { FeatureDefinition, FeatureContext } from '../feature';
import { EventSubscriptionManager } from '../../event-bus';
import { BuildingType } from '../../entity';
import { ServiceAreaManager } from './service-area-manager';

/**
 * Building types that act as logistics hubs (taverns/carrier bases).
 * These buildings get service areas when construction completes.
 */
export const SERVICE_AREA_BUILDINGS: ReadonlySet<BuildingType> = new Set([
    BuildingType.ResidenceSmall,
    BuildingType.ResidenceMedium,
    BuildingType.ResidenceBig,
]);

export interface ServiceAreaExports {
    serviceAreaManager: ServiceAreaManager;
}

export const ServiceAreaFeature: FeatureDefinition = {
    id: 'service-areas',
    dependencies: [],

    create(ctx: FeatureContext) {
        const subscriptions = new EventSubscriptionManager();
        const serviceAreaManager = new ServiceAreaManager();

        // Create service areas only when a building completes construction.
        // For instant-complete mode (placeBuildingsCompleted) building:completed fires
        // immediately after placement, so service areas are still created in time.
        subscriptions.subscribe(ctx.eventBus, 'building:completed', ({ entityId, buildingType }) => {
            if (!SERVICE_AREA_BUILDINGS.has(buildingType)) return;
            const entity = ctx.gameState.getEntity(entityId);
            if (!entity) return;
            serviceAreaManager.createServiceArea(entityId, entity.player, entity.x, entity.y, buildingType);
        });

        // Clean up service areas when buildings are removed
        ctx.cleanupRegistry.onEntityRemoved(serviceAreaManager.removeServiceArea.bind(serviceAreaManager));

        return {
            exports: { serviceAreaManager } satisfies ServiceAreaExports,
            destroy: () => {
                subscriptions.unsubscribeAll();
            },
        };
    },
};
