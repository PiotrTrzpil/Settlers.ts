import { EntityType } from '../../entity';
import type { GameState } from '../../game-state';
import type { EventBus } from '../../event-bus';
import type { TerrainData } from '../../terrain';
import { EMaterialType } from '../../economy';
import { spiralSearch } from '../../utils/spiral-search';
import type {
    ScriptAddGoodsCommand,
    ScriptAddBuildingCommand,
    ScriptAddSettlersCommand,
    SpawnResult,
    BatchSpawnResult,
} from '../command-types';
import type { Tile } from '../../core/coordinates';

export interface ScriptDeps {
    state: GameState;
    eventBus: EventBus;
    terrain: TerrainData;
}

/** Find a walkable tile near `center` that has no ground entity (pile, tree, building). */
function findFreeTileNear(center: Tile, deps: ScriptDeps): Tile {
    const { state, terrain } = deps;
    const { width, height } = terrain;

    const found = spiralSearch(
        center,
        width,
        height,
        tile => {
            if (!terrain.isPassable(tile)) {
                return false;
            }
            if (state.getGroundEntityAt(tile)) {
                return false;
            }
            return true;
        },
        20
    );

    if (!found) {
        throw new Error(`script: no free tile near (${center.x}, ${center.y}) within radius 20`);
    }
    return found;
}

/** Find a walkable tile near `center` with no ground entity and no unit. */
function findFreeUnitTileNear(center: Tile, deps: ScriptDeps): Tile {
    const { state, terrain } = deps;
    const { width, height } = terrain;

    const found = spiralSearch(
        center,
        width,
        height,
        tile => {
            if (!terrain.isPassable(tile)) {
                return false;
            }
            if (state.getGroundEntityAt(tile)) {
                return false;
            }
            if (state.getUnitAt(tile)) {
                return false;
            }
            return true;
        },
        20
    );

    if (!found) {
        throw new Error(`script: no free unit tile near (${center.x}, ${center.y}) within radius 20`);
    }
    return found;
}

export function executeScriptAddGoods(deps: ScriptDeps, cmd: ScriptAddGoodsCommand): SpawnResult {
    const { state, eventBus } = deps;
    const target = findFreeTileNear(cmd, deps);

    const entity = state.addEntity(EntityType.StackedPile, cmd.materialType, target, 0);

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
    const center: Tile = { x: cmd.x, y: cmd.y };
    let count = 0;

    for (let i = 0; i < cmd.amount; i++) {
        const tile = findFreeUnitTileNear(center, deps);

        const entity = state.addUnit(cmd.unitType, tile, cmd.player, { race: cmd.race });

        eventBus.emit('unit:spawned', {
            unitId: entity.id,
            unitType: cmd.unitType,
            x: tile.x,
            y: tile.y,
            player: cmd.player,
        });

        count++;
    }

    return { success: true, count };
}
