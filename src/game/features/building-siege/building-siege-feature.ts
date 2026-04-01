/**
 * Building Siege Feature — wires the siege system and registers event subscriptions.
 *
 * Subscribes to:
 * - unit:movementStopped — forwarded to siege system for attacker arrival detection
 * - combat:unitDefeated — forwarded to siege system for defender death / attacker death
 * - building:removed — cancels any active siege on the destroyed building
 * - entity:removed (via cleanupRegistry) — removes dead attackers from siege state
 */

import type { FeatureDefinition, FeatureContext, FeatureInstance } from '../feature';
import type { TowerGarrisonExports } from '@/game/features/tower-garrison';
import type { CombatExports } from '@/game/features/combat';
import type { SettlerTaskExports } from '@/game/features/settler-tasks';
import { BuildingSiegeSystem } from './building-siege-system';

export interface BuildingSiegeExports {
    siegeSystem: BuildingSiegeSystem;
}

export const BuildingSiegeFeature: FeatureDefinition = {
    id: 'building-siege',
    dependencies: ['combat', 'tower-garrison', 'settler-location', 'settler-tasks'],

    create(ctx: FeatureContext): FeatureInstance {
        const { garrisonManager, towerCombatSystem } = ctx.getFeature<TowerGarrisonExports>('tower-garrison');
        const { combatSystem } = ctx.getFeature<CombatExports>('combat');
        const { settlerTaskSystem } = ctx.getFeature<SettlerTaskExports>('settler-tasks');

        const siegeSystem = new BuildingSiegeSystem({
            gameState: ctx.gameState,
            eventBus: ctx.eventBus,
            garrisonManager,
            combatSystem,
            unitReservation: ctx.unitReservation,
            settlerTaskSystem,
            doorDefenderNotifier: towerCombatSystem,
        });

        // --- Event subscriptions ---

        ctx.on('unit:movementStopped', ({ unitId }) => {
            siegeSystem.onMovementStopped(unitId);
        });

        ctx.on('combat:unitDefeated', ({ unitId, defeatedBy }) => {
            siegeSystem.onUnitDefeated(unitId, defeatedBy);
        });

        ctx.on('building:removed', ({ buildingId }) => {
            siegeSystem.cancelSiege(buildingId);
        });

        // Clean up dead attackers from siege state
        ctx.cleanupRegistry.onEntityRemoved(entityId => {
            siegeSystem.onEntityRemoved(entityId);
        });

        return {
            systems: [siegeSystem],
            systemGroup: 'Military',
            exports: { siegeSystem } satisfies BuildingSiegeExports,
            persistence: 'none',
        };
    },
};
