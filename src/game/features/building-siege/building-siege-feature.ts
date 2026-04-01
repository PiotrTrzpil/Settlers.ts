/**
 * Building Siege Feature — wires the siege system, registers event subscriptions
 * and the capture_building command handler.
 *
 * Subscribes to:
 * - unit:movementStopped — forwarded to siege system for attacker arrival detection
 * - combat:unitDefeated — forwarded to siege system for defender death / attacker death
 * - building:removed — cancels any active siege on the destroyed building
 * - entity:removed (via cleanupRegistry) — removes dead attackers from siege state
 *
 * Provides:
 * - capture_building command handler (executes ownership change via gameState.changeEntityOwner)
 */

import type { FeatureDefinition, FeatureContext, FeatureInstance } from '../feature';
import type { TowerGarrisonExports } from '@/game/features/tower-garrison';
import type { CombatExports } from '@/game/features/combat';
import type { SettlerTaskExports } from '@/game/features/settler-tasks';
import { BuildingSiegeSystem } from './building-siege-system';
import type { CaptureBuildingCommand } from '@/game/commands/command-types';
import { COMMAND_OK } from '@/game/commands/command-types';

export interface BuildingSiegeExports {
    siegeSystem: BuildingSiegeSystem;
}

export const BuildingSiegeFeature: FeatureDefinition = {
    id: 'building-siege',
    dependencies: ['combat', 'tower-garrison', 'settler-location', 'settler-tasks'],

    create(ctx: FeatureContext): FeatureInstance {
        const { garrisonManager } = ctx.getFeature<TowerGarrisonExports>('tower-garrison');
        const { combatSystem } = ctx.getFeature<CombatExports>('combat');
        const { settlerTaskSystem } = ctx.getFeature<SettlerTaskExports>('settler-tasks');

        const siegeSystem = new BuildingSiegeSystem({
            gameState: ctx.gameState,
            eventBus: ctx.eventBus,
            garrisonManager,
            combatSystem,
            unitReservation: ctx.unitReservation,
            settlerTaskSystem,
            executeCommand: ctx.executeCommand,
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

        // Finalize capture when the conquering unit enters the garrison
        ctx.on('garrison:unitEntered', ({ buildingId }) => {
            siegeSystem.onGarrisonUnitEntered(buildingId);
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
            commands: {
                capture_building: cmd => {
                    const capture = cmd as CaptureBuildingCommand;
                    ctx.gameState.getEntityOrThrow(capture.buildingId, 'capture_building command target');
                    ctx.gameState.changeEntityOwner(capture.buildingId, capture.newPlayer);
                    return COMMAND_OK;
                },
            },
        };
    },
};
