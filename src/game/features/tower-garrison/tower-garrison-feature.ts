/**
 * Tower Garrison Feature — wires subsystems, registers events/commands/persistence.
 *
 * Handles the full lifecycle of garrisoning military units in towers:
 * - building:completed → initTower for garrison buildings
 * - building:removed → removeTower (no-op for non-garrison buildings)
 * - unit:movementStopped → ArrivalDetector.onMovementStopped
 * - onTerrainReady → re-issues move tasks for en-route units that were mid-path when saved
 *
 * Entity removal cleanup (killed en-route / killed while garrisoned) is handled automatically
 * by UnitReservationRegistry.onForcedRelease — no cleanupRegistry.onEntityRemoved needed.
 */

import type { FeatureDefinition, FeatureContext, FeatureInstance } from '../feature';
import type { SettlerTaskExports } from '@/game/features/settler-tasks/settler-tasks-feature';
import type { SettlerLocationExports } from '@/game/features/settler-location/types';
import { TowerGarrisonManager } from './tower-garrison-manager';
import { AutoGarrisonSystem } from './tower-garrison-auto-system';
import { ArrivalDetector } from './internal/arrival-detector';
import { isGarrisonBuildingType } from './internal/garrison-capacity';
import {
    executeGarrisonUnitsCommand,
    executeUngarrisonUnitCommand,
    executeGarrisonSelectedUnitsCommand,
    type GarrisonSelectedResult,
} from './internal/garrison-commands';
import type {
    GarrisonUnitsCommand,
    UngarrisonUnitCommand,
    GarrisonSelectedUnitsCommand,
} from '@/game/commands/command-types';
import { commandSuccess, commandFailed } from '@/game/commands/command-types';

export interface TowerGarrisonExports {
    garrisonManager: TowerGarrisonManager;
}

export const TowerGarrisonFeature: FeatureDefinition = {
    id: 'tower-garrison',
    dependencies: ['settler-tasks', 'movement', 'settler-location'],

    create(ctx: FeatureContext): FeatureInstance {
        const { settlerTaskSystem } = ctx.getFeature<SettlerTaskExports>('settler-tasks');
        const { locationManager } = ctx.getFeature<SettlerLocationExports>('settler-location');

        const manager = new TowerGarrisonManager({
            gameState: ctx.gameState,
            eventBus: ctx.eventBus,
            unitReservation: ctx.unitReservation,
            locationManager,
        });

        const autoSystem = new AutoGarrisonSystem({
            manager,
            unitReservation: ctx.unitReservation,
            executeCommand: ctx.executeCommand,
            gameState: ctx.gameState,
        });

        const arrivalDetector = new ArrivalDetector(manager, ctx.gameState);

        ctx.on('building:completed', ({ entityId, buildingType }) => {
            if (isGarrisonBuildingType(buildingType)) manager.initTower(entityId, buildingType);
        });

        ctx.on('building:removed', ({ entityId }) => {
            manager.removeTower(entityId); // no-op for non-garrison buildings
        });

        ctx.on('unit:movementStopped', ({ entityId }) => {
            arrivalDetector.onMovementStopped(entityId);
        });

        return {
            systems: [autoSystem],
            systemGroup: 'Military',
            exports: { garrisonManager: manager } satisfies TowerGarrisonExports,
            persistence: [manager],
            onTerrainReady(terrain) {
                manager.setTerrain(terrain);
                // Re-issue move tasks and restore reservations for units that were en-route when
                // the game was saved. Move tasks and reservations are not serialized by this manager
                // (approaching state is persisted by SettlerBuildingLocationManager), so we must
                // restore them here after pathfinding is available.
                // We iterate a snapshot since finalization may mutate approaching state.
                for (const { unitId, towerId } of manager.getEnRouteEntries()) {
                    const building = ctx.gameState.getEntity(towerId);
                    if (!building) {
                        manager.cancelEnRoute(unitId);
                        continue;
                    }
                    // Restore the reservation for this en-route unit (not serialized by garrison manager)
                    ctx.unitReservation.reserve(unitId, {
                        purpose: 'garrison-en-route',
                        onForcedRelease: () => {
                            // cancelApproach is a no-op if already gone; reservation auto-released by registry
                        },
                    });
                    if (!manager.tryFinalizeAtDoor(unitId, towerId)) {
                        const approach = manager.getApproachTile(building);
                        settlerTaskSystem.assignMoveTask(unitId, approach.x, approach.y);
                    }
                }
            },
            commands: {
                garrison_units: cmd =>
                    executeGarrisonUnitsCommand(cmd as GarrisonUnitsCommand, manager, settlerTaskSystem, ctx.gameState)
                        ? commandSuccess()
                        : commandFailed('no units fit available garrison slots'),
                garrison_selected_units: cmd => {
                    const result: GarrisonSelectedResult = executeGarrisonSelectedUnitsCommand(
                        cmd as GarrisonSelectedUnitsCommand,
                        manager,
                        settlerTaskSystem,
                        ctx.gameState
                    );
                    if (result === 'success') return commandSuccess();
                    if (result === 'not_garrison_building') return commandFailed('not_garrison_building');
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
