import { EntityType, EXTENDED_OFFSETS, getUnitLevel, tileKey, Tile } from '../../entity';
import type { GameState } from '../../game-state';
import type { TerrainData } from '../../terrain';
import type { EventBus } from '../../event-bus';
import type { SpawnUnitCommand, CommandResult, CommandFailure, SpawnResult } from '../command-types';
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
