import { EntityType, type Entity } from '../../entity';
import { GameState } from '../../game-state';
import { debugStats } from '../../debug/debug-stats';
import type {
    SelectCommand,
    SelectAtTileCommand,
    ToggleSelectionCommand,
    SelectAreaCommand,
    SelectMultipleCommand,
    SelectSameUnitTypeCommand,
    CommandResult,
} from '../command-types';
import { COMMAND_OK, commandFailed } from '../command-types';

export interface SelectionDeps {
    state: GameState;
}

export function executeSelect(deps: SelectionDeps, cmd: SelectCommand): CommandResult {
    const { state } = deps;
    const sel = state.selection;
    const debugAll = debugStats.state.selectAllUnits;

    if (cmd.entityId !== null) {
        const ent = state.getEntityOrThrow(cmd.entityId, 'entity to select');
        if (!sel.canSelect(ent, debugAll)) {
            sel.clear();
            return COMMAND_OK;
        }
    }

    sel.select(cmd.entityId);
    return COMMAND_OK;
}

export function executeSelectAtTile(deps: SelectionDeps, cmd: SelectAtTileCommand): CommandResult {
    const { state } = deps;
    const sel = state.selection;
    const debugAll = debugStats.state.selectAllUnits;
    const rawEntity = state.getEntityAt(cmd.x, cmd.y);
    const entity = sel.canSelect(rawEntity, debugAll) ? rawEntity : undefined;

    if (cmd.addToSelection) {
        if (entity) {
            sel.toggle(entity.id);
        }
        return COMMAND_OK;
    }

    // eslint-disable-next-line no-restricted-syntax -- optional chaining; null when source is absent
    sel.select(entity?.id ?? null);
    return COMMAND_OK;
}

export function executeToggleSelection(deps: SelectionDeps, cmd: ToggleSelectionCommand): CommandResult {
    const { state } = deps;
    const sel = state.selection;
    const entity = state.getEntity(cmd.entityId);
    if (!entity) {
        return commandFailed(`Entity ${cmd.entityId} not found`);
    }
    if (!sel.canSelect(entity, debugStats.state.selectAllUnits)) {
        return commandFailed(`Entity ${cmd.entityId} is not selectable`);
    }

    sel.toggle(cmd.entityId);
    return COMMAND_OK;
}

export function executeSelectArea(deps: SelectionDeps, cmd: SelectAreaCommand): CommandResult {
    const { state } = deps;
    const allEntities = state.getEntitiesInRect(cmd.x1, cmd.y1, cmd.x2, cmd.y2);
    state.selection.selectArea(allEntities, debugStats.state.selectAllUnits);
    return COMMAND_OK;
}

export function executeSelectMultiple(deps: SelectionDeps, cmd: SelectMultipleCommand): CommandResult {
    const { state } = deps;
    const debugAll = debugStats.state.selectAllUnits;
    const entities = cmd.entityIds
        .map(id => state.getEntityOrThrow(id, 'entity in multiple selection'))
        .filter((e): e is Entity => state.selection.canSelect(e, debugAll));
    state.selection.selectArea(entities, debugAll);
    return COMMAND_OK;
}

export function executeSelectSameUnitType(deps: SelectionDeps, cmd: SelectSameUnitTypeCommand): CommandResult {
    const { state } = deps;
    const debugAll = debugStats.state.selectAllUnits;

    const seed = state.getEntityOrThrow(cmd.seedEntityId, 'seed entity for same-type selection');
    if (seed.type !== EntityType.Unit) {
        return commandFailed(`Seed entity ${cmd.seedEntityId} is not a unit`);
    }

    const subType = seed.subType;
    const entities = cmd.candidateIds
        .map(id => state.getEntityOrThrow(id, 'candidate entity for same-type selection'))
        .filter(
            (e): e is Entity =>
                e.type === EntityType.Unit && e.subType === subType && state.selection.canSelect(e, debugAll)
        );

    state.selection.selectArea(entities, debugAll);
    return COMMAND_OK;
}
