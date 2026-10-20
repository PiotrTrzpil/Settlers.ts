import { EntityType } from '../../entity';
import type { GameState } from '../../game-state';
import type { EventBus } from '../../event-bus';
import type { BuildingType } from '../../buildings/types';
import type { RemoveEntityCommand, CommandResult } from '../command-types';
import { commandFailed, COMMAND_OK } from '../command-types';

export interface RemoveEntityDeps {
    state: GameState;
    eventBus: EventBus;
}

export function executeRemoveEntity(deps: RemoveEntityDeps, cmd: RemoveEntityCommand): CommandResult {
    const { state } = deps;
    const entity = state.getEntity(cmd.entityId);
    if (!entity) {
        return commandFailed(`Entity ${cmd.entityId} not found`);
    }

    if (entity.type === EntityType.Building) {
        deps.eventBus.emit('building:removed', {
            buildingId: cmd.entityId,
            buildingType: entity.subType as BuildingType,
            level: 'info',
        });
    }

    state.removeEntity(cmd.entityId);
    return COMMAND_OK;
}
