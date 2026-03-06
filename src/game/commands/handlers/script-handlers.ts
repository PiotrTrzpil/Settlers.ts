import { EntityType } from '../../entity';
import type { GameState } from '../../game-state';
import type { EventBus } from '../../event-bus';
import { BuildingType } from '../../buildings/types';
import type {
    ScriptAddGoodsCommand,
    ScriptAddBuildingCommand,
    ScriptAddSettlersCommand,
    CommandResult,
} from '../command-types';
import { commandSuccess } from '../command-types';

export interface ScriptDeps {
    state: GameState;
    eventBus: EventBus;
}

export function executeScriptAddGoods(deps: ScriptDeps, cmd: ScriptAddGoodsCommand): CommandResult {
    const { state } = deps;

    const entity = state.addEntity(EntityType.StackedPile, cmd.materialType, cmd.x, cmd.y, 0);

    if (cmd.amount > 1) {
        state.piles.setQuantity(entity.id, cmd.amount);
    }

    return commandSuccess([{ type: 'entity_created', entityId: entity.id, entityType: 'StackedPile' }]);
}

export function executeScriptAddBuilding(deps: ScriptDeps, cmd: ScriptAddBuildingCommand): CommandResult {
    const { state } = deps;

    const entity = state.addBuilding(cmd.buildingType, cmd.x, cmd.y, cmd.player, { race: cmd.race });

    return commandSuccess([
        {
            type: 'building_placed',
            entityId: entity.id,
            buildingType: cmd.buildingType as BuildingType,
            x: cmd.x,
            y: cmd.y,
        },
    ]);
}

export function executeScriptAddSettlers(deps: ScriptDeps, cmd: ScriptAddSettlersCommand): CommandResult {
    const { state, eventBus } = deps;
    const effects: { type: 'unit_spawned'; entityId: number; unitType: number; x: number; y: number }[] = [];

    for (let i = 0; i < cmd.amount; i++) {
        const offsetX = cmd.x + (i % 3);
        const offsetY = cmd.y + Math.floor(i / 3);

        const entity = state.addUnit(cmd.unitType, offsetX, offsetY, cmd.player, { race: cmd.race });

        eventBus.emit('unit:spawned', {
            entityId: entity.id,
            unitType: cmd.unitType,
            x: offsetX,
            y: offsetY,
            player: cmd.player,
        });

        effects.push({
            type: 'unit_spawned',
            entityId: entity.id,
            unitType: cmd.unitType,
            x: offsetX,
            y: offsetY,
        });
    }

    return commandSuccess(effects);
}
