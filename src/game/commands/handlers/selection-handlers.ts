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
import { commandSuccess, commandFailed } from '../command-types';

export interface SelectionDeps {
    state: GameState;
}

export function executeSelect(deps: SelectionDeps, cmd: SelectCommand): CommandResult {
    const { state } = deps;
    const sel = state.selection;
    const debugAll = debugStats.state.selectAllUnits;

    if (cmd.entityId !== null) {
        const ent = state.getEntity(cmd.entityId);
        if (ent && !sel.canSelect(ent, debugAll)) {
            sel.clear();
            return commandSuccess([{ type: 'selection_changed', selectedIds: [] }]);
        }
    }

    sel.select(cmd.entityId);

    return commandSuccess([{ type: 'selection_changed', selectedIds: cmd.entityId !== null ? [cmd.entityId] : [] }]);
}

export function executeSelectAtTile(deps: SelectionDeps, cmd: SelectAtTileCommand): CommandResult {
    const { state } = deps;
    const sel = state.selection;
    const debugAll = debugStats.state.selectAllUnits;
    const rawEntity = state.getEntityAt(cmd.x, cmd.y);
    const entity = sel.canSelect(rawEntity, debugAll) ? rawEntity : undefined;

    if (cmd.addToSelection) {
        if (entity) sel.toggle(entity.id);
        return commandSuccess([{ type: 'selection_changed', selectedIds: [...sel.selectedEntityIds] }]);
    }

    sel.select(entity?.id ?? null);
    return commandSuccess([{ type: 'selection_changed', selectedIds: entity ? [entity.id] : [] }]);
}

export function executeToggleSelection(deps: SelectionDeps, cmd: ToggleSelectionCommand): CommandResult {
    const { state } = deps;
    const sel = state.selection;
    const entity = state.getEntity(cmd.entityId);
    if (!sel.canSelect(entity, debugStats.state.selectAllUnits)) {
        return commandFailed(`Entity ${cmd.entityId} is not selectable`);
    }

    sel.toggle(cmd.entityId);
    return commandSuccess([{ type: 'selection_changed', selectedIds: [...sel.selectedEntityIds] }]);
}

export function executeSelectArea(deps: SelectionDeps, cmd: SelectAreaCommand): CommandResult {
    const { state } = deps;
    const allEntities = state.getEntitiesInRect(cmd.x1, cmd.y1, cmd.x2, cmd.y2);
    const selectedIds = state.selection.selectArea(allEntities, debugStats.state.selectAllUnits);
    return commandSuccess([{ type: 'selection_changed', selectedIds }]);
}

export function executeSelectMultiple(deps: SelectionDeps, cmd: SelectMultipleCommand): CommandResult {
    const { state } = deps;
    const debugAll = debugStats.state.selectAllUnits;
    const entities = cmd.entityIds
        .map(id => state.getEntity(id))
        .filter((e): e is Entity => e !== undefined && state.selection.canSelect(e, debugAll));
    const selectedIds = state.selection.selectArea(entities, debugAll);
    return commandSuccess([{ type: 'selection_changed', selectedIds }]);
}

export function executeSelectSameUnitType(deps: SelectionDeps, cmd: SelectSameUnitTypeCommand): CommandResult {
    const { state } = deps;
    const debugAll = debugStats.state.selectAllUnits;

    const seed = state.getEntity(cmd.seedEntityId);
    if (!seed || seed.type !== EntityType.Unit) {
        return commandFailed(`Seed entity ${cmd.seedEntityId} is not a unit`);
    }

    const subType = seed.subType;
    const entities = cmd.candidateIds
        .map(id => state.getEntity(id))
        .filter(
            (e): e is Entity =>
                e !== undefined &&
                e.type === EntityType.Unit &&
                e.subType === subType &&
                state.selection.canSelect(e, debugAll)
        );

    const selectedIds = state.selection.selectArea(entities, debugAll);
    return commandSuccess([{ type: 'selection_changed', selectedIds }]);
}
