/**
 * Tower Garrison Feature — wires subsystems, registers events/commands/persistence.
 *
 * Handles the full lifecycle of garrisoning military units in towers:
 * - building:completed → initTower for garrison buildings
 * - building:removed → removeTower (no-op for non-garrison buildings)
 * - onTerrainReady → re-builds WORKER_DISPATCH choreo jobs for en-route units
 *
 * Garrison dispatch uses WORKER_DISPATCH choreo jobs (goToDoorAndEnter).
 * The garrison manager listens for settler-location:entered to finalize.
 *
 * Entity removal cleanup (killed en-route / killed while garrisoned) is handled
 * automatically by UnitReservationRegistry.onForcedRelease.
 */

import type { FeatureDefinition, FeatureContext, FeatureInstance } from '../feature';
import type { SettlerTaskExports } from '@/game/features/settler-tasks/settler-tasks-feature';
import type { SettlerLocationExports } from '@/game/features/settler-location/types';
import type { CombatExports } from '@/game/features/combat';
import { TowerGarrisonManager } from './tower-garrison-manager';
import { AutoGarrisonSystem } from './tower-garrison-auto-system';
import { TowerCombatSystem } from './internal/tower-combat-system';
import { towerBowmanTargets } from './internal/tower-combat-system';
import { TowerBowmanRenderPass } from './internal/tower-bowman-render-pass';
import { isGarrisonBuildingType } from './internal/garrison-capacity';
import { choreo } from '@/game/systems/choreo/choreo-builder';
import {
    executeGarrisonUnitsCommand,
    executeUngarrisonUnitCommand,
    executeGarrisonSelectedUnitsCommand,
    type GarrisonSelectedResult,
    type GarrisonCommandContext,
} from './internal/garrison-commands';
import type {
    GarrisonUnitsCommand,
    UngarrisonUnitCommand,
    GarrisonSelectedUnitsCommand,
} from '@/game/commands/command-types';
import { commandSuccess, commandFailed } from '@/game/commands/command-types';
import { RenderLayer } from '@/game/renderer/render-passes/types';

export interface TowerGarrisonExports {
    garrisonManager: TowerGarrisonManager;
    towerCombatSystem: TowerCombatSystem;
}

export const TowerGarrisonFeature: FeatureDefinition = {
    id: 'tower-garrison',
    dependencies: ['settler-tasks', 'settler-location', 'combat'],

    create(ctx: FeatureContext): FeatureInstance {
        const { settlerTaskSystem } = ctx.getFeature<SettlerTaskExports>('settler-tasks');
        const { locationManager } = ctx.getFeature<SettlerLocationExports>('settler-location');
        const { combatSystem } = ctx.getFeature<CombatExports>('combat');

        const manager = new TowerGarrisonManager({
            gameState: ctx.gameState,
            eventBus: ctx.eventBus,
            unitReservation: ctx.unitReservation,
            locationManager,
            releaseWorkerAssignment: (settlerId: number) => settlerTaskSystem.releaseWorkerAssignment(settlerId),
        });

        const autoSystem = new AutoGarrisonSystem({
            manager,
            unitReservation: ctx.unitReservation,
            executeCommand: ctx.executeCommand,
            gameState: ctx.gameState,
        });

        const towerCombatSystem = new TowerCombatSystem({
            garrisonManager: manager,
            combatSystem,
            gameState: ctx.gameState,
            eventBus: ctx.eventBus,
        });

        ctx.on('building:completed', ({ buildingId, buildingType }) => {
            if (isGarrisonBuildingType(buildingType)) {
                manager.initTower(buildingId, buildingType);
            }
        });

        ctx.on('building:removed', ({ buildingId }) => {
            manager.removeTower(buildingId); // no-op for non-garrison buildings
        });

        // Clean up when a dispatch job fails for a garrison-bound unit
        ctx.on('settler:taskFailed', ({ unitId }) => {
            if (manager.isEnRoute(unitId)) {
                ctx.unitReservation.release(unitId);
                locationManager.cancelApproach(unitId);
                settlerTaskSystem.releaseWorkerAssignment(unitId);
            }
        });

        return {
            systems: [autoSystem, towerCombatSystem],
            systemGroup: 'Military',
            exports: {
                garrisonManager: manager,
                towerCombatSystem,
            } satisfies TowerGarrisonExports,
            renderPasses: [
                {
                    id: 'tower-bowman',
                    layer: RenderLayer.AboveEntities,
                    needs: { sprites: true },
                    create: () => new TowerBowmanRenderPass(manager, ctx.gameState, towerBowmanTargets),
                },
            ],
            persistence: [manager],
            onTerrainReady(terrain) {
                manager.setTerrain(terrain);
                // Re-build WORKER_DISPATCH choreo jobs for units that were
                // en-route when the game was saved. Approaching state is
                // persisted by SettlerBuildingLocationManager; reservations
                // and jobs are restored here after pathfinding is available.
                for (const { unitId, towerId } of manager.getEnRouteEntries()) {
                    const building = ctx.gameState.getEntity(towerId);
                    if (!building) {
                        // Tower gone during save — release reservation, assignment
                        ctx.unitReservation.release(unitId);
                        settlerTaskSystem.releaseWorkerAssignment(unitId);
                        continue;
                    }
                    // Restore reservation (not serialized by garrison manager)
                    ctx.unitReservation.reserve(unitId, {
                        purpose: 'garrison-en-route',
                        onForcedRelease: () => {
                            // reservation auto-released by registry
                        },
                    });
                    const job = choreo('WORKER_DISPATCH').goToDoorAndEnter(towerId).build();
                    settlerTaskSystem.assignJob(unitId, job);
                }
            },
            commands: {
                garrison_units: cmd => {
                    const cmdCtx: GarrisonCommandContext = {
                        manager,
                        settlerTaskSystem,
                        locationManager,
                        gameState: ctx.gameState,
                        unitReservation: ctx.unitReservation,
                    };
                    return executeGarrisonUnitsCommand(cmd as GarrisonUnitsCommand, cmdCtx)
                        ? commandSuccess()
                        : commandFailed('no units fit available garrison slots');
                },
                garrison_selected_units: cmd => {
                    const cmdCtx: GarrisonCommandContext = {
                        manager,
                        settlerTaskSystem,
                        locationManager,
                        gameState: ctx.gameState,
                        unitReservation: ctx.unitReservation,
                    };
                    const result: GarrisonSelectedResult = executeGarrisonSelectedUnitsCommand(
                        cmd as GarrisonSelectedUnitsCommand,
                        cmdCtx
                    );
                    if (result === 'success') {
                        return commandSuccess();
                    }
                    if (result === 'not_garrison_building') {
                        return commandFailed('not_garrison_building');
                    }
                    return commandFailed('No garrison slot available for selected units');
                },
                ungarrison_unit: cmd =>
                    executeUngarrisonUnitCommand(cmd as UngarrisonUnitCommand, manager, ctx.gameState)
                        ? commandSuccess()
                        : commandFailed('unit cannot be ungarrisoned'),
            },
        };
    },
};
