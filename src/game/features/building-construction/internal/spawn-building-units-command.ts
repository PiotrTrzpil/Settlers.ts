/**
 * spawn_building_units command — spawns the units a building brings on completion:
 * a fixed batch near the building (BUILDING_SPAWN_ON_COMPLETE without interval) or
 * its dedicated worker, hidden inside the building.
 *
 * Owned by the building-construction feature; issued by BuildingConstructionSystem
 * on building:completed.
 */

import { UnitType, tileKey, type Entity, Tile } from '../../../entity';
import type { GameState } from '../../../game-state';
import type { TerrainData } from '../../../terrain';
import type { EventBus } from '../../../event-bus';
import type { BuildingType } from '../../../buildings/types';
import { BUILDING_SPAWN_ON_COMPLETE } from '../spawn-units';
import { getBuildingWorkerInfo, getBuildingDoorPos } from '../../../data/game-data-access';
import { ringTiles } from '../../../systems/spatial-search';
import type { SpawnBuildingUnitsCommand, CommandResult } from '../../../commands/command-types';
import { COMMAND_OK } from '../../../commands/command-types';

export interface SpawnBuildingUnitsDeps {
    state: GameState;
    terrain: TerrainData;
    eventBus: EventBus;
}

function isSpawnableTile(deps: SpawnBuildingUnitsDeps, tile: Tile): boolean {
    return (
        deps.terrain.isInBounds(tile) &&
        deps.terrain.isPassable(tile) &&
        !deps.state.getGroundEntityAt(tile) &&
        !deps.state.buildingOccupancy.has(tileKey(tile))
    );
}

function spawnUnitsNear(
    deps: SpawnBuildingUnitsDeps,
    bx: number,
    by: number,
    unitType: UnitType,
    count: number,
    player: number,
    selectable: boolean | undefined
): void {
    const { state, eventBus } = deps;
    let spawned = 0;
    for (let radius = 1; radius <= 4 && spawned < count; radius++) {
        for (const tile of ringTiles({ x: bx, y: by }, radius)) {
            if (spawned >= count) {
                break;
            }
            if (!isSpawnableTile(deps, tile)) {
                continue;
            }

            const spawnedEntity = state.addUnit(unitType, tile, player, { selectable });

            eventBus.emit('unit:spawned', {
                unitId: spawnedEntity.id,
                unitType,
                x: tile.x,
                y: tile.y,
                player,
            });

            spawned++;
        }
    }
}

function spawnWorkerInsideBuilding(deps: SpawnBuildingUnitsDeps, entity: Entity, tile: Tile): void {
    const { state, eventBus } = deps;
    const buildingType = entity.subType as BuildingType;
    const workerInfo = getBuildingWorkerInfo(entity.race, buildingType);
    if (!workerInfo) {
        return;
    }

    // Spawn the worker at the door tile but hidden (already inside the building).
    // No occupancy and no movement controller — the door tile may legitimately be
    // occupied by another unit, and registering the hidden worker there would
    // clobber that unit's occupancy entry. The task system will assign the worker
    // and the normal work cycle handles walking out via exitBuilding.
    const door = getBuildingDoorPos(tile, entity.race, buildingType);
    const workerEntity = state.addUnit(workerInfo.unitType, door, entity.player, { occupancy: false, hidden: true });

    eventBus.emit('unit:spawned', {
        unitId: workerEntity.id,
        unitType: workerInfo.unitType,
        x: door.x,
        y: door.y,
        player: entity.player,
    });
    eventBus.emit('building:workerSpawned', {
        buildingId: entity.id,
        unitId: workerEntity.id,
        unitType: workerEntity.subType as UnitType,
    });
}

export function executeSpawnBuildingUnits(deps: SpawnBuildingUnitsDeps, cmd: SpawnBuildingUnitsCommand): CommandResult {
    const entity = deps.state.getEntityOrThrow(cmd.buildingEntityId, 'completed building for unit spawning');
    const buildingType = entity.subType as BuildingType;
    const bx = entity.x;
    const by = entity.y;

    const spawnDef = BUILDING_SPAWN_ON_COMPLETE[buildingType];
    if (spawnDef && !spawnDef.spawnInterval) {
        spawnUnitsNear(deps, bx, by, spawnDef.unitType, spawnDef.count, entity.player, spawnDef.selectable);
    }

    if (cmd.spawnWorker && !spawnDef) {
        spawnWorkerInsideBuilding(deps, entity, entity);
    }

    return COMMAND_OK;
}
