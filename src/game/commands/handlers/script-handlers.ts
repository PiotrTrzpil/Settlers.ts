import { EntityType } from '../../entity';
import type { GameState } from '../../game-state';
import type { EventBus } from '../../event-bus';
import { EMaterialType } from '../../economy';
import type {
    ScriptAddGoodsCommand,
    ScriptAddBuildingCommand,
    ScriptAddSettlersCommand,
    SpawnResult,
    BatchSpawnResult,
} from '../command-types';

export interface ScriptDeps {
    state: GameState;
    eventBus: EventBus;
}

export function executeScriptAddGoods(deps: ScriptDeps, cmd: ScriptAddGoodsCommand): SpawnResult {
    const { state, eventBus } = deps;

    const entity = state.addEntity(EntityType.StackedPile, cmd.materialType, cmd, 0);

    // Register free pile — FreePileHandler creates the inventory slot
    eventBus.emit('pile:freePilePlaced', {
        entityId: entity.id,
        materialType: cmd.materialType as EMaterialType,
        quantity: cmd.amount,
    });

    return { success: true, entityId: entity.id };
}

export function executeScriptAddBuilding(deps: ScriptDeps, cmd: ScriptAddBuildingCommand): SpawnResult {
    const { state } = deps;

    const entity = state.addBuilding(cmd.buildingType, cmd, cmd.player, { race: cmd.race });

    return { success: true, entityId: entity.id };
}

export function executeScriptAddSettlers(deps: ScriptDeps, cmd: ScriptAddSettlersCommand): BatchSpawnResult {
    const { state, eventBus } = deps;
    let count = 0;

    for (let i = 0; i < cmd.amount; i++) {
        const offsetX = cmd.x + (i % 3);
        const offsetY = cmd.y + Math.floor(i / 3);

        const entity = state.addUnit(cmd.unitType, { x: offsetX, y: offsetY }, cmd.player, { race: cmd.race });

        eventBus.emit('unit:spawned', {
            unitId: entity.id,
            unitType: cmd.unitType,
            x: offsetX,
            y: offsetY,
            player: cmd.player,
        });

        count++;
    }

    return { success: true, count };
}
