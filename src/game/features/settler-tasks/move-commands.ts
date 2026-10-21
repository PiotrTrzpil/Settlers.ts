/**
 * Player move commands (move_unit, move_selected_units).
 *
 * Owned by the settler-tasks feature: a move command becomes a move task on the
 * unit's runtime. Reserved units and (optionally) units in combat are rejected;
 * workers cannot be sent outside their player's territory.
 */

import { EntityType, UnitType, EXTENDED_OFFSETS, tileKey, isUnitTypeMilitary, Tile } from '../../entity';
import { UnitCategory, getUnitCategory } from '../../core/unit-types';
import type { GameState } from '../../game-state';
import type { CombatSystem } from '../combat';
import type { UnitReservationQuery } from '../../systems/unit-commitment';
import { FORMATION_OFFSETS, commandFailed, COMMAND_OK } from '../../commands/command-types';
import type { MoveUnitCommand, MoveSelectedUnitsCommand, CommandResult } from '../../commands/command-types';
import type { TaskDispatcher } from './types';

export interface MoveCommandDeps {
    state: GameState;
    taskDispatcher: TaskDispatcher;
    combatSystem: CombatSystem;
    /** Reserved units reject move commands (`ctx.unitCommitments`). */
    unitCommitments: UnitReservationQuery;
    /** Whether units in combat can be redirected by player commands (live game setting). */
    isCombatControllable: () => boolean;
    /** Territory owner lookup — workers cannot move outside their territory. */
    getOwner: (tile: Tile) => number;
}

/**
 * If the target tile is inside a building footprint, find the nearest
 * walkable tile outside. Returns the original target if it's already clear.
 */
function resolveTargetOutsideBuilding(state: GameState, tile: Tile): Tile {
    if (!state.buildingOccupancy.has(tileKey(tile))) {
        return tile;
    }
    for (const [dx, dy] of EXTENDED_OFFSETS) {
        const candidate = { x: tile.x + dx, y: tile.y + dy };
        if (!state.buildingOccupancy.has(tileKey(candidate))) {
            return candidate;
        }
    }
    return tile; // fallback — shouldn't happen
}

/** Check if there's an enemy military unit within 1 tile of a position. */
function hasEnemyNearTarget(state: GameState, targetX: number, targetY: number, player: number): boolean {
    return state.entityIndex
        .query(EntityType.Unit)
        .inRadius({ x: targetX, y: targetY }, 1.5)
        .filter(e => e.player !== player && !e.hidden && isUnitTypeMilitary(e.subType as UnitType))
        .some();
}

/** Workers (carriers, diggers, etc.) cannot be commanded to move outside their player's territory. */
function isWorkerOutsideTerritory(
    entity: { subType: string | number; player: number },
    target: Tile,
    getOwner: (tile: Tile) => number
): boolean {
    return getUnitCategory(entity.subType as UnitType) === UnitCategory.Worker && getOwner(target) !== entity.player;
}

export function executeMoveUnit(deps: MoveCommandDeps, cmd: MoveUnitCommand): CommandResult {
    const entity = deps.state.getEntity(cmd.entityId);
    if (!entity) {
        return commandFailed(`Entity ${cmd.entityId} not found`);
    }

    if (deps.unitCommitments.isReserved(cmd.entityId)) {
        return commandFailed(`Unit ${cmd.entityId} is reserved and cannot be moved`);
    }

    if (!deps.isCombatControllable() && deps.combatSystem.isInCombat(cmd.entityId)) {
        return commandFailed(`Unit ${cmd.entityId} is in combat and cannot be moved`);
    }

    if (deps.combatSystem.isInCombat(cmd.entityId)) {
        deps.combatSystem.releaseFromCombat(cmd.entityId);
    }

    // Resolve target outside building footprint
    const target = resolveTargetOutsideBuilding(deps.state, { x: cmd.targetX, y: cmd.targetY });

    if (isWorkerOutsideTerritory(entity, target, deps.getOwner)) {
        return commandFailed(`Worker ${cmd.entityId} cannot move outside territory`);
    }

    // March passively if target tile has no enemies — don't engage along the way
    if (
        deps.combatSystem.getState(cmd.entityId) &&
        !hasEnemyNearTarget(deps.state, target.x, target.y, entity.player)
    ) {
        deps.combatSystem.setPassive(cmd.entityId);
    }

    const success = deps.taskDispatcher.assignMoveTask(cmd.entityId, target);

    if (!success) {
        return commandFailed(`Cannot move unit ${cmd.entityId} to (${cmd.targetX}, ${cmd.targetY})`);
    }

    return COMMAND_OK;
}

export function executeMoveSelectedUnits(deps: MoveCommandDeps, cmd: MoveSelectedUnitsCommand): CommandResult {
    const { state } = deps;

    const selectedUnits = state.selection.getSelectedByType(EntityType.Unit);
    if (selectedUnits.length === 0) {
        return commandFailed('No units selected');
    }

    const combatControllable = deps.isCombatControllable();
    const baseTarget = resolveTargetOutsideBuilding(state, { x: cmd.targetX, y: cmd.targetY });
    const firstUnit = selectedUnits[0]!;
    const passiveMarch = !hasEnemyNearTarget(state, baseTarget.x, baseTarget.y, firstUnit.player);

    let movedCount = 0;
    for (let i = 0; i < selectedUnits.length; i++) {
        const unit = selectedUnits[i]!;
        const offset = FORMATION_OFFSETS[Math.min(i, FORMATION_OFFSETS.length - 1)]!;
        const target = resolveTargetOutsideBuilding(state, {
            x: baseTarget.x + offset[0],
            y: baseTarget.y + offset[1],
        });
        if (tryMoveSelectedUnit(deps, unit, target, combatControllable, passiveMarch)) {
            movedCount++;
        }
    }

    if (movedCount === 0) {
        return commandFailed(`Could not move any of ${selectedUnits.length} selected units`);
    }

    return COMMAND_OK;
}

/** Attempt to move a single unit from a multi-select move command. */
function tryMoveSelectedUnit(
    deps: MoveCommandDeps,
    unit: { id: number; subType: string | number; player: number },
    target: Tile,
    combatControllable: boolean,
    passiveMarch: boolean
): boolean {
    if (deps.unitCommitments.isReserved(unit.id)) {
        return false;
    }
    if (!combatControllable && deps.combatSystem.isInCombat(unit.id)) {
        return false;
    }
    if (isWorkerOutsideTerritory(unit, target, deps.getOwner)) {
        return false;
    }

    const inCombat = deps.combatSystem.isInCombat(unit.id);
    if (inCombat) {
        deps.combatSystem.releaseFromCombat(unit.id);
    }
    if (inCombat && passiveMarch) {
        deps.combatSystem.setPassive(unit.id);
    }

    return deps.taskDispatcher.assignMoveTask(unit.id, target);
}
