/**
 * Territory Feature - Self-registering feature module for territory zones.
 *
 * Towers (small, large) and castles create territory zones.
 * Territory boundary dots are rendered at the edges of these zones.
 *
 * The TerritoryManager is created externally (needs map dimensions from terrain)
 * and registered via FeatureRegistry.registerExports(). This feature handles
 * the event wiring for building lifecycle.
 */

import type { BuildingType } from '../../buildings/types';
import { EventSubscriptionManager, type EventBus } from '../../event-bus';
import { EntityType } from '../../entity';
import type { TerritoryManager } from './territory-manager';
import { TERRITORY_BUILDINGS } from './territory-types';
import type { EntityCleanupRegistry } from '../../systems/entity-cleanup-registry';

export interface TerritoryExports {
    territoryManager: TerritoryManager;
}

/**
 * Register territory event handlers for a TerritoryManager.
 * Called from GameServices after the manager is created with correct dimensions.
 *
 * @returns cleanup function to unsubscribe events
 */
export function registerTerritoryEvents(
    eventBus: EventBus,
    territoryManager: TerritoryManager,
    cleanupRegistry: EntityCleanupRegistry
): { unsubscribeAll: () => void } {
    const subscriptions = new EventSubscriptionManager();

    // Register territory buildings when created
    subscriptions.subscribe(eventBus, 'entity:created', ({ entityId, type, subType, x, y, player }) => {
        if (type === EntityType.Building && TERRITORY_BUILDINGS.has(subType as BuildingType)) {
            territoryManager.addBuilding(entityId, x, y, player, subType as BuildingType);
        }
    });

    // Remove territory when buildings are destroyed
    cleanupRegistry.onEntityRemoved(territoryManager.removeBuilding.bind(territoryManager));

    return subscriptions;
}
