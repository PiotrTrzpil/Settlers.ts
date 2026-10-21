/**
 * Tower Garrison Feature — wires subsystems, registers events/commands/persistence.
 *
 * Handles the full lifecycle of garrisoning military units in towers:
 * - building:completed → initTower for garrison buildings
 * - building:removed → removeTower (no-op for non-garrison buildings)
 * - onRestoreComplete → initTower for every garrison building, slots rebuilt from Garrison holds
 *
 * Owns the `Garrison` job kind (en-route units: goToDoor + ENTER_BUILDING) and the Garrison hold
 * owner (garrisoned units) — see internal/garrison-job-kind.ts. Outcomes (entered, failed, unit
 * removed, preempted) arrive as direct handler calls; en-route jobs resume after load by themselves.
 */

import type { FeatureDefinition, FeatureContext, FeatureInstance } from '../feature';
import type { SettlerTaskExports } from '@/game/features/settler-tasks';
import type { SettlerLocationExports } from '@/game/features/settler-location';
import type { CombatExports } from '@/game/features/combat';
import type { BuildingConstructionExports } from '../building-construction';
import { BuildingType } from '../../buildings/building-type';
import { TowerGarrisonManager } from './tower-garrison-manager';
import { AutoGarrisonSystem } from './tower-garrison-auto-system';
import { TowerCombatSystem } from './internal/tower-combat-system';
import { isGarrisonBuildingType } from './internal/garrison-capacity';
import { createGarrisonHoldOwner, createGarrisonJobKind } from './internal/garrison-job-kind';
import {
    executeGarrisonUnitsCommand,
    executeUngarrisonUnitCommand,
    executeGarrisonSelectedUnitsCommand,
    executeFillGarrisonCommand,
    type GarrisonSelectedResult,
    type GarrisonCommandContext,
    type FillGarrisonContext,
} from './internal/garrison-commands';
import type {
    GarrisonUnitsCommand,
    UngarrisonUnitCommand,
    GarrisonSelectedUnitsCommand,
    FillGarrisonCommand,
    CaptureBuildingCommand,
} from '@/game/commands/command-types';
import { COMMAND_OK, commandFailed } from '@/game/commands/command-types';
import { createLogger } from '@/utilities/logger';
import { TickPhase } from '../../core/tick-phase';

const log = createLogger('TowerGarrisonFeature');

import { forEachCompletedBuilding } from '../restore-utils';

export interface TowerGarrisonExports {
    garrisonManager: TowerGarrisonManager;
    towerCombatSystem: TowerCombatSystem;
}

export const TowerGarrisonFeature: FeatureDefinition = {
    id: 'tower-garrison',
    dependencies: ['settler-tasks', 'settler-location', 'combat', 'building-construction'],

    create(ctx: FeatureContext): FeatureInstance {
        const { jobs, workerAssignments } = ctx.getFeature<SettlerTaskExports>('settler-tasks');
        const { locationManager } = ctx.getFeature<SettlerLocationExports>('settler-location');
        const { combatSystem } = ctx.getFeature<CombatExports>('combat');
        const { constructionSiteManager } = ctx.getFeature<BuildingConstructionExports>('building-construction');

        const manager = new TowerGarrisonManager({
            gameState: ctx.gameState,
            eventBus: ctx.eventBus,
            terrain: ctx.terrain,
            jobs,
            locationManager,
            workerAssignments,
        });
        jobs.registerKind(createGarrisonJobKind({ gameState: ctx.gameState, terrain: ctx.terrain, manager }));
        jobs.registerHoldOwner(createGarrisonHoldOwner(manager));

        const autoSystem = new AutoGarrisonSystem({
            manager,
            unitCommitments: ctx.unitCommitments,
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
                log.debug(`initTower for ${buildingType} id=${buildingId}`);
                manager.initTower(buildingId, buildingType);
            }
        });

        ctx.on('building:removed', ({ buildingId }) => {
            manager.removeTower(buildingId); // no-op for non-garrison buildings
        });

        // When a tower changes owner (siege capture), cancel en-route units of the old player
        ctx.on('building:ownerChanged', ({ buildingId, oldPlayer }) => {
            manager.cancelEnRouteUnitsOf(buildingId, oldPlayer);
        });

        // When an enemy unit enters an empty garrison, capture the building.
        // The finalizeGarrison check prevents enemy entry into occupied garrisons,
        // but we also verify here: only capture if the garrison has exactly 1 unit
        // (the one that just entered).
        ctx.on('garrison:unitEntered', ({ buildingId, unitId }) => {
            const building = ctx.gameState.getEntity(buildingId);
            if (!building) {
                return;
            }
            const unit = ctx.gameState.getEntity(unitId);
            if (!unit || unit.player === building.player) {
                return;
            }
            const garrison = manager.getGarrison(buildingId);
            if (!garrison) {
                return;
            }
            const total = garrison.swordsmanSlots.unitIds.length + garrison.bowmanSlots.unitIds.length;
            if (total !== 1) {
                return;
            }
            const oldPlayer = building.player;
            ctx.executeCommand({ type: 'capture_building', buildingId, newPlayer: unit.player });
            ctx.eventBus.emit('siege:buildingCaptured', {
                buildingId,
                oldPlayer,
                newPlayer: unit.player,
                level: 'info',
            });
            log.debug(`Building ${buildingId} captured by player ${unit.player} (was player ${oldPlayer})`);
        });

        return {
            systems: [autoSystem, towerCombatSystem],
            tickPhase: TickPhase.Military,
            exports: {
                garrisonManager: manager,
                towerCombatSystem,
            } satisfies TowerGarrisonExports,
            // Both swordsmen and bowmen are rendered via overlay-resolution.ts
            // (AboveBuilding layer) as static standing poses.
            renderPasses: [],
            // Garrison state is persisted as commitments (Garrison jobs + holds) by settler-tasks.
            persistence: 'none',
            onRestoreComplete() {
                forEachCompletedBuilding(ctx.gameState, constructionSiteManager, e => {
                    const bt = e.subType as BuildingType;
                    if (isGarrisonBuildingType(bt)) {
                        manager.initTower(e.id, bt);
                    }
                });
                // En-route Garrison jobs are resumed by settler-tasks in onRestoreResume.
                manager.rebuildFromHolds();
            },
            commands: {
                garrison_units: cmd => {
                    const cmdCtx: GarrisonCommandContext = { manager, gameState: ctx.gameState };
                    return executeGarrisonUnitsCommand(cmd as GarrisonUnitsCommand, cmdCtx)
                        ? COMMAND_OK
                        : commandFailed('no units fit available garrison slots');
                },
                garrison_selected_units: cmd => {
                    const cmdCtx: GarrisonCommandContext = { manager, gameState: ctx.gameState };
                    const result: GarrisonSelectedResult = executeGarrisonSelectedUnitsCommand(
                        cmd as GarrisonSelectedUnitsCommand,
                        cmdCtx
                    );
                    if (result === 'success') {
                        return COMMAND_OK;
                    }
                    if (result === 'not_garrison_building') {
                        return commandFailed('not_garrison_building');
                    }
                    return commandFailed('No garrison slot available for selected units');
                },
                ungarrison_unit: cmd =>
                    executeUngarrisonUnitCommand(cmd as UngarrisonUnitCommand, manager, ctx.gameState)
                        ? COMMAND_OK
                        : commandFailed('unit cannot be ungarrisoned'),
                fill_garrison: cmd => {
                    const fillCtx: FillGarrisonContext = {
                        manager,
                        gameState: ctx.gameState,
                        eventBus: ctx.eventBus,
                        locationManager,
                    };
                    return executeFillGarrisonCommand(cmd as FillGarrisonCommand, fillCtx);
                },
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
