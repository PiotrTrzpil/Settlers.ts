/**
 * Service Area Feature - Self-registering feature module for logistics service areas.
 *
 * Creates and removes service areas in response to building lifecycle events.
 * Only buildings in SERVICE_AREA_BUILDINGS get service areas (taverns/residences).
 */

import type { FeatureDefinition, FeatureContext } from '../feature';
import { EventSubscriptionManager } from '../../event-bus';
import { EntityType, BuildingType } from '../../entity';
import { ServiceAreaManager } from './service-area-manager';

/**
 * Building types that act as logistics hubs (taverns/carrier bases).
 * These buildings get service areas when created.
 */
const SERVICE_AREA_BUILDINGS: ReadonlySet<BuildingType> = new Set([
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

        // Create service areas for logistics hubs
        subscriptions.subscribe(ctx.eventBus, 'entity:created', ({ entityId, type, subType, x, y, player }) => {
            if (type === EntityType.Building && SERVICE_AREA_BUILDINGS.has(subType as BuildingType)) {
                serviceAreaManager.createServiceArea(entityId, player, x, y, subType as BuildingType);
            }
        });

        // Clean up service areas when buildings are removed
        subscriptions.subscribe(ctx.eventBus, 'entity:removed', ({ entityId }) => {
            serviceAreaManager.removeServiceArea(entityId);
        });

        return {
            exports: { serviceAreaManager } satisfies ServiceAreaExports,
            destroy: () => {
                subscriptions.unsubscribeAll();
            },
        };
    },
};
