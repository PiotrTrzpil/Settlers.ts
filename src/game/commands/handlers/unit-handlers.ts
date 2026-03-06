import { EntityType, EXTENDED_OFFSETS, getUnitLevel } from '../../entity';
import type { GameState } from '../../game-state';
import type { TerrainData } from '../../terrain';
import type { EventBus } from '../../event-bus';
import type { SettlerTaskSystem } from '../../features/settler-tasks';
import type { CombatSystem } from '../../features/combat';
import { FORMATION_OFFSETS } from '../command-types';
import type { SpawnUnitCommand, MoveUnitCommand, MoveSelectedUnitsCommand, CommandResult } from '../command-types';
import { commandSuccess, commandFailed } from '../command-types';

export interface SpawnUnitDeps {
    state: GameState;
    terrain: TerrainData;
    eventBus: EventBus;
}

export interface MoveUnitDeps {
    state: GameState;
    settlerTaskSystem: SettlerTaskSystem;
    combatSystem: CombatSystem;
}

export interface MoveSelectedUnitsDeps {
    state: GameState;
    settlerTaskSystem: SettlerTaskSystem;
    combatSystem: CombatSystem;
}

function findValidSpawnTile(
    x: number,
    y: number,
    isValid: (x: number, y: number) => boolean
): { x: number; y: number } | null {
    for (const [dx, dy] of EXTENDED_OFFSETS) {
        const nx = x + dx;
        const ny = y + dy;
        if (isValid(nx, ny)) {
            return { x: nx, y: ny };
        }
    }
    return null;
}

export function executeSpawnUnit(deps: SpawnUnitDeps, cmd: SpawnUnitCommand): CommandResult {
    const { state, terrain } = deps;

    const isTileValid = (x: number, y: number) =>
        terrain.isInBounds(x, y) && terrain.isPassable(x, y) && !state.getEntityAt(x, y);

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
        entityId: entity.id,
        unitType: cmd.unitType,
        x: spawnX,
        y: spawnY,
        player: cmd.player,
    });

    return commandSuccess([
        { type: 'unit_spawned', entityId: entity.id, unitType: cmd.unitType, x: spawnX, y: spawnY },
    ]);
}

export function executeMoveUnit(deps: MoveUnitDeps, cmd: MoveUnitCommand): CommandResult {
    const entity = deps.state.getEntity(cmd.entityId);
    if (!entity) {
        return commandFailed(`Entity ${cmd.entityId} not found`);
    }

    deps.combatSystem.releaseFromCombat(cmd.entityId);

    const fromX = entity.x;
    const fromY = entity.y;

    const success = deps.settlerTaskSystem.assignMoveTask(cmd.entityId, cmd.targetX, cmd.targetY);

    if (!success) {
        return commandFailed(`Cannot move unit ${cmd.entityId} to (${cmd.targetX}, ${cmd.targetY})`);
    }

    return commandSuccess([
        { type: 'entity_moved', entityId: cmd.entityId, fromX, fromY, toX: cmd.targetX, toY: cmd.targetY },
    ]);
}

export function executeMoveSelectedUnits(deps: MoveSelectedUnitsDeps, cmd: MoveSelectedUnitsCommand): CommandResult {
    const { state } = deps;

    const selectedUnits = state.selection.getSelectedByType(EntityType.Unit);
    if (selectedUnits.length === 0) {
        return commandFailed('No units selected');
    }

    const effects: {
        type: 'entity_moved';
        entityId: number;
        fromX: number;
        fromY: number;
        toX: number;
        toY: number;
    }[] = [];
    for (let i = 0; i < selectedUnits.length; i++) {
        const unit = selectedUnits[i]!;
        const offset = FORMATION_OFFSETS[Math.min(i, FORMATION_OFFSETS.length - 1)]!;
        const targetX = cmd.targetX + offset[0];
        const targetY = cmd.targetY + offset[1];

        deps.combatSystem.releaseFromCombat(unit.id);

        const fromX = unit.x;
        const fromY = unit.y;

        const moved = deps.settlerTaskSystem.assignMoveTask(unit.id, targetX, targetY);

        if (moved) {
            effects.push({
                type: 'entity_moved',
                entityId: unit.id,
                fromX,
                fromY,
                toX: targetX,
                toY: targetY,
            });
        }
    }

    if (effects.length === 0) {
        return commandFailed(`Could not move any of ${selectedUnits.length} selected units`);
    }

    return commandSuccess(effects);
}
