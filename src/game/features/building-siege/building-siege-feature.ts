/**
 * Building Siege Feature — wires the siege system and registers event subscriptions.
 *
 * Subscribes to:
 * - unit:movementStopped — forwarded to siege system for attacker arrival detection
 * - combat:unitDefeated — forwarded to siege system for defender death / attacker death
 * - building:removed — cancels any active siege on the destroyed building
 *
 * Registers the 'siege' hold owner (persist: false — siege state is not saved, so participants
 * load idle): a participant removed or taken over outside combat leaves its siege.
 */

import type { FeatureDefinition, FeatureContext, FeatureInstance } from '../feature';
import type { TowerGarrisonExports } from '@/game/features/tower-garrison';
import type { CombatExports } from '@/game/features/combat';
import type { SettlerTaskExports } from '@/game/features/settler-tasks';
import { isDarkTribe } from '@/game/core/race';
import { BuildingSiegeSystem } from './building-siege-system';
import { TowerAssaultSystem } from './tower-assault-system';
import { SIEGE_OWNER } from './siege-participants';
import { TickPhase } from '../../core/tick-phase';

export interface BuildingSiegeExports {
    siegeSystem: BuildingSiegeSystem;
    towerAssaultSystem: TowerAssaultSystem;
}

export const BuildingSiegeFeature: FeatureDefinition = {
    id: 'building-siege',
    dependencies: ['combat', 'tower-garrison', 'settler-location', 'settler-tasks'],

    create(ctx: FeatureContext): FeatureInstance {
        const { garrisonManager, towerCombatSystem } = ctx.getFeature<TowerGarrisonExports>('tower-garrison');
        const { combatSystem } = ctx.getFeature<CombatExports>('combat');
        const { jobs, jobRunner } = ctx.getFeature<SettlerTaskExports>('settler-tasks');

        const siegeSystem = new BuildingSiegeSystem({
            gameState: ctx.gameState,
            eventBus: ctx.eventBus,
            garrisonManager,
            combatSystem,
            jobs,
            taskDispatcher: jobRunner,
            doorDefenderNotifier: towerCombatSystem,
        });

        jobs.registerHoldOwner({
            owner: SIEGE_OWNER,
            persist: false,
            onUnitRemoved: (unitId, buildingId) => siegeSystem.onParticipantRemoved(unitId, buildingId),
            onPreempted: (unitId, buildingId) => siegeSystem.onParticipantPreempted(unitId, buildingId),
        });

        const towerAssaultSystem = new TowerAssaultSystem({
            gameState: ctx.gameState,
            eventBus: ctx.eventBus,
            combatSystem,
            unitCommitments: ctx.unitCommitments,
            taskDispatcher: jobRunner,
            garrisonManager,
            executeCommand: ctx.executeCommand,
        });

        // Wire Dark Tribe tower assault into the siege system
        siegeSystem.setTowerAssaultSystem(towerAssaultSystem);

        // Let combat system defer to siege when a building door is closer than the nearest enemy.
        // Dark Tribe never sieges — skip entirely so they freely engage enemies.
        combatSystem.setEngagementFilter((entityId, enemyDist) => {
            const unit = ctx.gameState.getEntity(entityId);
            if (unit && isDarkTribe(unit.race)) {
                return false;
            }
            return siegeSystem.hasDoorCloserThan(entityId, enemyDist);
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
            towerAssaultSystem.cancelAssault(buildingId);
        });

        return {
            systems: [siegeSystem, towerAssaultSystem],
            tickPhase: TickPhase.Military,
            exports: { siegeSystem, towerAssaultSystem } satisfies BuildingSiegeExports,
            persistence: 'none',
        };
    },
};
