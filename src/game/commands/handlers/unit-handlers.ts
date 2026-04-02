import { EntityType, UnitType, EXTENDED_OFFSETS, getUnitLevel, tileKey, isUnitTypeMilitary, Tile } from '../../entity';
import { UnitCategory, getUnitCategory } from '../../core/unit-types';
import type { GameState } from '../../game-state';
import type { TerrainData } from '../../terrain';
import type { EventBus } from '../../event-bus';
import type { SettlerTaskSystem } from '../../features/settler-tasks';
import type { CombatSystem } from '../../features/combat';
import { FORMATION_OFFSETS } from '../command-types';
import type {
    SpawnUnitCommand,
    MoveUnitCommand,
    MoveSelectedUnitsCommand,
    CommandResult,
    CommandFailure,
    SpawnResult,
} from '../command-types';
import type { UnitReservationRegistry } from '../../systems/unit-reservation';
import { commandFailed, COMMAND_OK } from '../command-types';
import type { RecruitSpecialistCommand } from '../command-types';
import { SPECIALIST_TOOL_MAP } from '../../systems/recruit/specialist-tool-map';
import type { RecruitSystem } from '../../systems/recruit/recruit-system';
import type { UnitTransformer } from '../../systems/recruit/unit-transformer';

export interface SpawnUnitDeps {
    state: GameState;
    terrain: TerrainData;
    eventBus: EventBus;
}

export interface MoveUnitDeps {
    state: GameState;
    settlerTaskSystem: SettlerTaskSystem;
    combatSystem: CombatSystem;
    unitReservation: UnitReservationRegistry;
    /** Whether units in combat can be redirected by player commands. */
    isCombatControllable: () => boolean;
    /** Territory owner lookup — workers cannot move outside their territory. */
    getOwner: (x: number, y: number) => number;
}

export interface MoveSelectedUnitsDeps {
    state: GameState;
    settlerTaskSystem: SettlerTaskSystem;
    combatSystem: CombatSystem;
    unitReservation: UnitReservationRegistry;
    /** Whether units in combat can be redirected by player commands. */
    isCombatControllable: () => boolean;
    /** Territory owner lookup — workers cannot move outside their territory. */
    getOwner: (x: number, y: number) => number;
}

function findValidSpawnTile(x: number, y: number, isValid: (x: number, y: number) => boolean): Tile | null {
    for (const [dx, dy] of EXTENDED_OFFSETS) {
        const nx = x + dx;
        const ny = y + dy;
        if (isValid(nx, ny)) {
            return { x: nx, y: ny };
        }
    }
    return null;
}

export function executeSpawnUnit(deps: SpawnUnitDeps, cmd: SpawnUnitCommand): SpawnResult | CommandFailure {
    const { state, terrain } = deps;

    const isTileValid = (x: number, y: number) => {
        if (!terrain.isInBounds(x, y) || !terrain.isPassable(x, y)) {
            return false;
        }
        // Units can't overlap other units
        if (state.getUnitAt(x, y)) {
            return false;
        }
        // Ground entities block spawning, except construction sites (not yet blocked for movement)
        const ground = state.getGroundEntityAt(x, y);
        if (ground && (ground.type !== EntityType.Building || state.buildingOccupancy.has(tileKey(x, y)))) {
            return false;
        }
        return true;
    };

    let spawnX = cmd.x;
    let spawnY = cmd.y;

    if (!isTileValid(spawnX, spawnY)) {
        const found = findValidSpawnTile(cmd.x, cmd.y, isTileValid);
        if (!found) {
            return commandFailed(`Cannot spawn unit at (${cmd.x}, ${cmd.y}): no valid tile nearby`);
        }
        spawnX = found.x;
        spawnY = found.y;
    }

    const entity = state.addUnit(cmd.unitType, spawnX, spawnY, cmd.player, { race: cmd.race });
    entity.level = getUnitLevel(cmd.unitType);

    deps.eventBus.emit('unit:spawned', {
        unitId: entity.id,
        unitType: cmd.unitType,
        x: spawnX,
        y: spawnY,
        player: cmd.player,
    });

    return { success: true, entityId: entity.id };
}

/**
 * If the target tile is inside a building footprint, find the nearest
 * walkable tile outside. Returns the original target if it's already clear.
 */
function resolveTargetOutsideBuilding(state: GameState, x: number, y: number): Tile {
    if (!state.buildingOccupancy.has(tileKey(x, y))) {
        return { x, y };
    }
    for (const [dx, dy] of EXTENDED_OFFSETS) {
        const nx = x + dx;
        const ny = y + dy;
        if (!state.buildingOccupancy.has(tileKey(nx, ny))) {
            return { x: nx, y: ny };
        }
    }
    return { x, y }; // fallback — shouldn't happen
}

/** Check if there's an enemy military unit within 1 tile of a position. */
function hasEnemyNearTarget(state: GameState, targetX: number, targetY: number, player: number): boolean {
    const nearby = state.getEntitiesInRadius(targetX, targetY, 1.5);
    for (const e of nearby) {
        if (
            e.type === EntityType.Unit &&
            e.player !== player &&
            !e.hidden &&
            isUnitTypeMilitary(e.subType as UnitType)
        ) {
            return true;
        }
    }
    return false;
}

/** Workers (carriers, diggers, etc.) cannot be commanded to move outside their player's territory. */
function isWorkerOutsideTerritory(
    entity: { subType: string | number; player: number },
    target: Tile,
    getOwner: (x: number, y: number) => number
): boolean {
    return (
        getUnitCategory(entity.subType as UnitType) === UnitCategory.Worker &&
        getOwner(target.x, target.y) !== entity.player
    );
}

export function executeMoveUnit(deps: MoveUnitDeps, cmd: MoveUnitCommand): CommandResult {
    const entity = deps.state.getEntity(cmd.entityId);
    if (!entity) {
        return commandFailed(`Entity ${cmd.entityId} not found`);
    }

    if (deps.unitReservation.isReserved(cmd.entityId)) {
        return commandFailed(`Unit ${cmd.entityId} is reserved and cannot be moved`);
    }

    if (!deps.isCombatControllable() && deps.combatSystem.isInCombat(cmd.entityId)) {
        return commandFailed(`Unit ${cmd.entityId} is in combat and cannot be moved`);
    }

    if (deps.combatSystem.isInCombat(cmd.entityId)) {
        deps.combatSystem.releaseFromCombat(cmd.entityId);
    }

    // Resolve target outside building footprint
    const target = resolveTargetOutsideBuilding(deps.state, cmd.targetX, cmd.targetY);

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

    const success = deps.settlerTaskSystem.assignMoveTask(cmd.entityId, target.x, target.y);

    if (!success) {
        return commandFailed(`Cannot move unit ${cmd.entityId} to (${cmd.targetX}, ${cmd.targetY})`);
    }

    return COMMAND_OK;
}

export function executeMoveSelectedUnits(deps: MoveSelectedUnitsDeps, cmd: MoveSelectedUnitsCommand): CommandResult {
    const { state } = deps;

    const selectedUnits = state.selection.getSelectedByType(EntityType.Unit);
    if (selectedUnits.length === 0) {
        return commandFailed('No units selected');
    }

    const combatControllable = deps.isCombatControllable();
    const baseTarget = resolveTargetOutsideBuilding(state, cmd.targetX, cmd.targetY);
    const firstUnit = selectedUnits[0]!;
    const passiveMarch = !hasEnemyNearTarget(state, baseTarget.x, baseTarget.y, firstUnit.player);

    let movedCount = 0;
    for (let i = 0; i < selectedUnits.length; i++) {
        const unit = selectedUnits[i]!;
        const offset = FORMATION_OFFSETS[Math.min(i, FORMATION_OFFSETS.length - 1)]!;
        const target = resolveTargetOutsideBuilding(state, baseTarget.x + offset[0], baseTarget.y + offset[1]);
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
    deps: MoveSelectedUnitsDeps,
    unit: { id: number; subType: string | number; player: number },
    target: Tile,
    combatControllable: boolean,
    passiveMarch: boolean
): boolean {
    if (deps.unitReservation.isReserved(unit.id)) {
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

    return deps.settlerTaskSystem.assignMoveTask(unit.id, target.x, target.y);
}

export interface RecruitSpecialistDeps {
    recruitSystem: RecruitSystem;
    unitTransformer: UnitTransformer;
}

export function executeRecruitSpecialist(deps: RecruitSpecialistDeps, cmd: RecruitSpecialistCommand): CommandResult {
    const toolMaterial = SPECIALIST_TOOL_MAP[cmd.unitType];
    if (toolMaterial === undefined) {
        return commandFailed(`Unknown specialist type: ${cmd.unitType}`);
    }

    if (cmd.count > 0) {
        const near = cmd.nearX !== undefined && cmd.nearY !== undefined ? { x: cmd.nearX, y: cmd.nearY } : null;
        deps.recruitSystem.enqueue(cmd.unitType, cmd.count, toolMaterial, cmd.player, cmd.race, near);
    } else if (cmd.count < 0) {
        let remaining = -cmd.count;
        // Drain queue first
        const queued = deps.recruitSystem.getQueuedCount(cmd.unitType);
        const fromQueue = Math.min(remaining, queued);
        if (fromQueue > 0) {
            deps.recruitSystem.dequeue(cmd.unitType, fromQueue);
            remaining -= fromQueue;
        }
        // Dismiss live specialists for the remainder
        for (let i = 0; i < remaining; i++) {
            if (!deps.unitTransformer.dismissSpecialist(cmd.unitType, toolMaterial, cmd.player)) {
                break;
            }
        }
    }

    return COMMAND_OK;
}
