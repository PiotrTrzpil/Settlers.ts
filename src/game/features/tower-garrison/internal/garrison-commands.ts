import type {
    GarrisonUnitsCommand,
    UngarrisonUnitCommand,
    GarrisonSelectedUnitsCommand,
} from '@/game/commands/command-types';
import { EntityType } from '@/game/entity';
import type { GameState } from '@/game/game-state';
import type { SettlerTaskSystem } from '@/game/features/settler-tasks';
import { BuildingType } from '@/game/buildings/building-type';
import { UnitType } from '@/game/core/unit-types';
import { createLogger } from '@/utilities/logger';
import type { UnitReservationRegistry } from '@/game/systems/unit-reservation';
import type { ISettlerBuildingLocationManager } from '@/game/features/settler-location/types';
import type { TowerGarrisonManager } from '../tower-garrison-manager';
import { dispatchUnitToGarrison } from './garrison-dispatch';
import { getGarrisonCapacity, getGarrisonRole } from './garrison-capacity';
import type { GarrisonRole } from '../types';

/** Shared context for garrison command execution. */
export interface GarrisonCommandContext {
    manager: TowerGarrisonManager;
    settlerTaskSystem: SettlerTaskSystem;
    gameState: GameState;
    unitReservation: UnitReservationRegistry;
    locationManager: ISettlerBuildingLocationManager;
}

const log = createLogger('GarrisonCommands');

/** Returns the garrison role for a unit if it is eligible for this tower, or null if it should be skipped. */
function getEligibleRole(
    unitId: number,
    buildingId: number,
    manager: TowerGarrisonManager,
    gameState: GameState
): GarrisonRole | null {
    const unit = gameState.getEntity(unitId);
    if (!unit) {
        return null;
    }
    const role = getGarrisonRole(unit.subType as UnitType);
    if (!role) {
        return null;
    }
    if (manager.getTowerIdForEnRouteUnit(unitId) === buildingId) {
        return null;
    }
    return role;
}

function filterAcceptedUnits(
    unitIds: number[],
    buildingId: number,
    manager: TowerGarrisonManager,
    gameState: GameState,
    swordsmanSlots: number,
    bowmanSlots: number
): number[] {
    let remainingSwordsman = swordsmanSlots;
    let remainingBowman = bowmanSlots;
    const accepted: number[] = [];

    for (const unitId of unitIds) {
        const role = getEligibleRole(unitId, buildingId, manager, gameState);
        if (!role) {
            continue;
        }

        if (role === 'swordsman' && remainingSwordsman > 0) {
            remainingSwordsman--;
            accepted.push(unitId);
        } else if (role === 'bowman' && remainingBowman > 0) {
            remainingBowman--;
            accepted.push(unitId);
        }
    }

    return accepted;
}

/**
 * Handle a `garrison_units` command.
 *
 * Algorithm:
 * 1. Look up the building entity (nullable — user input). Return false if not found or not a garrison building.
 * 2. Filter supplied unit IDs to those that exist, have a valid garrison role, fit a slot, and are not
 *    already en-route to this same tower.
 * 3. Slot availability accounts for both garrisoned units AND en-route units, preventing over-commitment.
 * 4. Greedily allocate: fill available swordsman slots first, then bowman slots. Stop each role when full.
 * 5. If no units survive filtering: return false.
 * 6. For each accepted unit: reserve → assign worker to building → assign WORKER_DISPATCH choreo job.
 * 7. Return true.
 */
export function executeGarrisonUnitsCommand(cmd: GarrisonUnitsCommand, ctx: GarrisonCommandContext): boolean {
    const { manager, settlerTaskSystem, gameState, unitReservation, locationManager } = ctx;
    const building = gameState.getEntity(cmd.buildingId);
    if (!building) {
        log.warn(`garrison_units: building ${cmd.buildingId} not found`);
        return false;
    }

    const buildingType = building.subType as BuildingType;
    if (!getGarrisonCapacity(buildingType)) {
        log.warn(`garrison_units: building ${cmd.buildingId} (${buildingType}) has no garrison capacity`);
        return false;
    }

    const garrison = manager.getGarrison(cmd.buildingId);
    if (!garrison) {
        log.warn(
            `garrison_units: building ${cmd.buildingId} not registered in garrison manager — was initTower called?`
        );
        return false;
    }

    // Subtract both garrisoned AND en-route units so we never over-commit slots.
    const enRoute = manager.getEnRouteSlotCounts(cmd.buildingId);
    const swordsmanSlotsAvailable =
        garrison.swordsmanSlots.max - garrison.swordsmanSlots.unitIds.length - enRoute.swordsman;
    const bowmanSlotsAvailable = garrison.bowmanSlots.max - garrison.bowmanSlots.unitIds.length - enRoute.bowman;

    const acceptedUnitIds = filterAcceptedUnits(
        cmd.unitIds,
        cmd.buildingId,
        manager,
        gameState,
        swordsmanSlotsAvailable,
        bowmanSlotsAvailable
    );

    if (acceptedUnitIds.length === 0) {
        log.warn(
            `garrison_units: no units accepted for building ${cmd.buildingId}. ` +
                `slots=(sw:${swordsmanSlotsAvailable}, bw:${bowmanSlotsAvailable}). ` +
                `candidates=[${cmd.unitIds
                    .map(id => {
                        const u = gameState.getEntity(id);
                        const role = u ? getGarrisonRole(u.subType as UnitType) : 'missing';
                        const enRouteId = manager.getTowerIdForEnRouteUnit(id);
                        // eslint-disable-next-line no-restricted-syntax -- nullable field with display/config default
                        return `${id}(role=${role ?? 'none'}, enRoute=${enRouteId ?? '-'})`;
                    })
                    .join(', ')}]`
        );
        return false;
    }

    const dispatchDeps = { gameState, unitReservation, settlerTaskSystem };
    let anyDispatched = false;

    for (const unitId of acceptedUnitIds) {
        if (dispatchUnitToGarrison(unitId, cmd.buildingId, dispatchDeps)) {
            anyDispatched = true;
        } else {
            // Blacklist so auto-garrison doesn't retry the same pair.
            locationManager.cancelApproach(unitId);
            manager.recordDispatchFailure(unitId, cmd.buildingId);
        }
    }

    return anyDispatched;
}

/**
 * Result of a `garrison_selected_units` command, distinguishing three cases:
 * - 'success'              — units were accepted and are now en-route.
 * - 'not_garrison_building' — tile has no garrison building (caller may fall back to move).
 * - 'garrison_building_blocked' — tile IS a garrison building, but units could not be garrisoned
 *                                  (wrong role, slots full, no military selected, etc.).
 *                                  Caller must NOT fall back to a move command.
 */
export type GarrisonSelectedResult = 'success' | 'not_garrison_building' | 'garrison_building_blocked';

/**
 * Handle a `garrison_selected_units` command.
 *
 * Looks up the building at the given tile, then attempts to garrison
 * the currently selected military units into it.
 */
export function executeGarrisonSelectedUnitsCommand(
    cmd: GarrisonSelectedUnitsCommand,
    ctx: GarrisonCommandContext
): GarrisonSelectedResult {
    // Silent: user right-clicks on any tile — most won't be garrison buildings.
    const building = ctx.gameState.getGroundEntityAt(cmd.tileX, cmd.tileY);
    if (!building || building.type !== EntityType.Building) {
        return 'not_garrison_building';
    }
    if (!getGarrisonCapacity(building.subType as BuildingType)) {
        return 'not_garrison_building';
    }

    const selectedUnits = ctx.gameState.selection.getSelectedByType(EntityType.Unit);
    if (selectedUnits.length === 0) {
        return 'garrison_building_blocked';
    }

    // Enemy garrison building — don't garrison, let the caller fall through
    // to move_selected_units so the siege system can handle it.
    if (selectedUnits[0]!.player !== building.player) {
        return 'not_garrison_building';
    }

    const unitIds = selectedUnits.map(u => u.id);
    const ok = executeGarrisonUnitsCommand({ type: 'garrison_units', buildingId: building.id, unitIds }, ctx);
    if (ok) {
        ctx.gameState.selection.select(null);
        return 'success';
    }
    return 'garrison_building_blocked';
}

/**
 * Handle an `ungarrison_unit` command.
 *
 * Algorithm:
 * 1. Look up the building entity (nullable). Return false if not found.
 * 2. Look up the garrison; return false if the unit is not in either slot set.
 * 3. Compute total garrisoned. Return false if == 1 (last soldier cannot be ejected).
 * 4. Call manager.ejectUnit and return true.
 */
export function executeUngarrisonUnitCommand(
    cmd: UngarrisonUnitCommand,
    manager: TowerGarrisonManager,
    gameState: GameState
): boolean {
    const building = gameState.getEntity(cmd.buildingId);
    if (!building) {
        return false;
    }

    const garrison = manager.getGarrison(cmd.buildingId);
    if (!garrison) {
        log.warn(`ungarrison_unit: building ${cmd.buildingId} not registered in garrison manager`);
        return false;
    }

    const inSwordsmanSlots = garrison.swordsmanSlots.unitIds.includes(cmd.unitId);
    const inBowmanSlots = garrison.bowmanSlots.unitIds.includes(cmd.unitId);
    if (!inSwordsmanSlots && !inBowmanSlots) {
        return false;
    }

    const totalGarrisoned = garrison.swordsmanSlots.unitIds.length + garrison.bowmanSlots.unitIds.length;
    if (totalGarrisoned === 1) {
        return false;
    }

    manager.ejectUnit(cmd.unitId, cmd.buildingId);
    return true;
}
