import { EntityType, EXTENDED_OFFSETS, getUnitLevel, tileKey, Tile } from '../../entity';
import type { GameState } from '../../game-state';
import type { TerrainData } from '../../terrain';
import type { EventBus } from '../../event-bus';
import type { SpawnUnitCommand, CommandFailure, SpawnResult } from '../command-types';
import { commandFailed } from '../command-types';

export interface SpawnUnitDeps {
    state: GameState;
    terrain: TerrainData;
    eventBus: EventBus;
}

function findValidSpawnTile(tile: Tile, isValid: (tile: Tile) => boolean): Tile | null {
    for (const [dx, dy] of EXTENDED_OFFSETS) {
        const candidate = { x: tile.x + dx, y: tile.y + dy };
        if (isValid(candidate)) {
            return candidate;
        }
    }
    return null;
}

export function executeSpawnUnit(deps: SpawnUnitDeps, cmd: SpawnUnitCommand): SpawnResult | CommandFailure {
    const { state, terrain } = deps;

    const isTileValid = (tile: Tile) => {
        if (!terrain.isInBounds(tile) || !terrain.isPassable(tile)) {
            return false;
        }
        // Units can't overlap other units
        if (state.getUnitAt(tile)) {
            return false;
        }
        // Ground entities block spawning, except construction sites (not yet blocked for movement)
        const ground = state.getGroundEntityAt(tile);
        if (ground && (ground.type !== EntityType.Building || state.buildingOccupancy.has(tileKey(tile)))) {
            return false;
        }
        return true;
    };

    let spawnX = cmd.x;
    let spawnY = cmd.y;

    if (!isTileValid({ x: spawnX, y: spawnY })) {
        const found = findValidSpawnTile({ x: cmd.x, y: cmd.y }, isTileValid);
        if (!found) {
            return commandFailed(`Cannot spawn unit at (${cmd.x}, ${cmd.y}): no valid tile nearby`);
        }
        spawnX = found.x;
        spawnY = found.y;
    }

    const entity = state.addUnit(cmd.unitType, { x: spawnX, y: spawnY }, cmd.player, { race: cmd.race });
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
