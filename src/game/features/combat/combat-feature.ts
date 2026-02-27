/**
 * Combat Feature — self-registering feature that tracks military units and runs combat.
 *
 * Registers military units on spawn, cleans up on removal, and provides the
 * CombatSystem as a tick system for the game loop.
 */

import type { FeatureDefinition } from '../feature';
import { EventSubscriptionManager } from '../../event-bus';
import { EntityType, isUnitTypeMilitary, UnitType } from '../../entity';
import { CombatSystem } from './combat-system';

export interface CombatExports {
    combatSystem: CombatSystem;
}

export const CombatFeature: FeatureDefinition = {
    id: 'combat',
    dependencies: [],

    create(ctx) {
        const subscriptions = new EventSubscriptionManager();
        const combatSystem = new CombatSystem(ctx.gameState, ctx.eventBus, ctx.animationService);

        // Auto-register military units when they spawn
        subscriptions.subscribe(ctx.eventBus, 'unit:spawned', ({ entityId, unitType, player }) => {
            if (isUnitTypeMilitary(unitType)) {
                const entity = ctx.gameState.getEntity(entityId);
                combatSystem.register(entityId, player, unitType, entity?.level ?? 1);
            }
        });

        // Also catch units created via entity:created (e.g., map loading)
        subscriptions.subscribe(ctx.eventBus, 'entity:created', ({ entityId, type, subType, player }) => {
            if (type === EntityType.Unit && isUnitTypeMilitary(subType as UnitType)) {
                const entity = ctx.gameState.getEntity(entityId);
                combatSystem.register(entityId, player, subType as UnitType, entity?.level ?? 1);
            }
        });

        // Clean up on removal
        ctx.cleanupRegistry.onEntityRemoved(entityId => combatSystem.unregister(entityId));

        return {
            systems: [combatSystem],
            exports: { combatSystem } satisfies CombatExports,
            destroy: () => subscriptions.unsubscribeAll(),
        };
    },
};
