import { EntityType, UnitType, tileKey, type Entity } from '../../entity';
import type { GameState } from '../../game-state';
import type { TerrainData } from '../../terrain';
import type { EventBus } from '../../event-bus';
import type { GameSettings } from '../../game-settings';
import type { ConstructionSiteManager } from '../../features/building-construction';
import {
    captureOriginalTerrain,
    setConstructionSiteGroundType,
    applyTerrainLeveling,
} from '../../features/building-construction';
import { canPlaceBuildingFootprint } from '../../systems/placement';
import type { PlacementFilter } from '../../systems/placement';
import { BuildingType } from '../../buildings/types';
import { BUILDING_SPAWN_ON_COMPLETE } from '../../features/building-construction/spawn-units';
import { getBuildingWorkerInfo, getBuildingDoorPos } from '../../data/game-data-access';
import { ringTiles } from '../../systems/spatial-search';
import type {
    PlaceBuildingCommand,
    RemoveEntityCommand,
    SpawnBuildingUnitsCommand,
    CommandResult,
} from '../command-types';
import { commandSuccess, commandFailed } from '../command-types';

export interface PlaceBuildingDeps {
    state: GameState;
    terrain: TerrainData;
    eventBus: EventBus;
    settings: GameSettings;
    constructionSiteManager: ConstructionSiteManager;
    placementFilter: PlacementFilter | null;
}

export interface RemoveEntityDeps {
    state: GameState;
    eventBus: EventBus;
}

export interface SpawnBuildingUnitsDeps {
    state: GameState;
    terrain: TerrainData;
    eventBus: EventBus;
}

type UnitSpawnEffect = { type: 'unit_spawned'; entityId: number; unitType: number; x: number; y: number };

function isSpawnableTile(deps: SpawnBuildingUnitsDeps, x: number, y: number): boolean {
    return (
        deps.terrain.isInBounds(x, y) &&
        deps.terrain.isPassable(x, y) &&
        !deps.state.getGroundEntityAt(x, y) &&
        !deps.state.buildingOccupancy.has(tileKey(x, y))
    );
}

function spawnUnitsNear(
    deps: SpawnBuildingUnitsDeps,
    bx: number,
    by: number,
    unitType: number,
    count: number,
    player: number,
    selectable: boolean | undefined,
    effects: UnitSpawnEffect[]
): void {
    const { state, eventBus } = deps;
    let spawned = 0;
    for (let radius = 1; radius <= 4 && spawned < count; radius++) {
        for (const tile of ringTiles(bx, by, radius)) {
            if (spawned >= count) break;
            if (!isSpawnableTile(deps, tile.x, tile.y)) continue;

            const spawnedEntity = state.addUnit(unitType, tile.x, tile.y, player, { selectable });

            eventBus.emit('unit:spawned', {
                unitId: spawnedEntity.id,
                unitType: unitType as UnitType,
                x: tile.x,
                y: tile.y,
                player,
            });

            effects.push({ type: 'unit_spawned', entityId: spawnedEntity.id, unitType, x: tile.x, y: tile.y });
            spawned++;
        }
    }
}

function spawnWorkerInsideBuilding(
    deps: SpawnBuildingUnitsDeps,
    entity: Entity,
    bx: number,
    by: number,
    effects: UnitSpawnEffect[]
): void {
    const { state, eventBus } = deps;
    const buildingType = entity.subType as BuildingType;
    const workerInfo = getBuildingWorkerInfo(entity.race, buildingType);
    if (!workerInfo) return;

    // Spawn the worker at the door tile but hidden (already inside the building).
    // No occupancy — the building owns the door tile. The task system will assign
    // the worker and the normal work cycle handles walking out via exitBuilding.
    const door = getBuildingDoorPos(bx, by, entity.race, buildingType);
    const workerEntity = state.addUnit(workerInfo.unitType, door.x, door.y, entity.player, { occupancy: false });

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

    effects.push({
        type: 'unit_spawned',
        entityId: workerEntity.id,
        unitType: workerInfo.unitType,
        x: door.x,
        y: door.y,
    });
}

export function executePlaceBuilding(deps: PlaceBuildingDeps, cmd: PlaceBuildingCommand): CommandResult {
    const { state, terrain } = deps;

    if (
        !cmd.trusted &&
        !canPlaceBuildingFootprint(
            terrain,
            state.groundOccupancy,
            cmd.x,
            cmd.y,
            cmd.buildingType,
            cmd.race ?? state.playerRaces.get(cmd.player)!,
            state.buildingFootprint,
            deps.placementFilter,
            cmd.player
        )
    ) {
        return commandFailed(`Cannot place building at (${cmd.x}, ${cmd.y}): invalid placement`);
    }

    const entity = state.addBuilding(cmd.buildingType, cmd.x, cmd.y, cmd.player, { race: cmd.race });

    const terrainParams = { buildingType: cmd.buildingType, race: entity.race, tileX: cmd.x, tileY: cmd.y };
    const { groundType, groundHeight, mapSize } = terrain;
    const originalTerrain = captureOriginalTerrain(terrainParams, groundType, groundHeight, mapSize);
    setConstructionSiteGroundType(terrainParams, groundType, mapSize, originalTerrain);

    if (cmd.completed) {
        applyTerrainLeveling(terrainParams, groundType, groundHeight, mapSize, 1.0, originalTerrain);
        state.restoreBuildingFootprintBlock(entity.id);
    }

    deps.eventBus.emit('terrain:modified', { reason: 'placement', x: cmd.x, y: cmd.y });

    deps.eventBus.emit('building:placed', {
        buildingId: entity.id,
        buildingType: cmd.buildingType,
        x: cmd.x,
        y: cmd.y,
        player: cmd.player,
        level: 'info',
    });

    // Assign captured terrain after building:placed (which creates the site via registerSite),
    // then populate unleveled tiles so digger findTarget can reserve tiles immediately.
    const site = deps.constructionSiteManager.getSite(entity.id);
    if (site) {
        site.terrain.originalTerrain = originalTerrain;
        deps.constructionSiteManager.populateUnleveledTiles(entity.id);
    }

    if (cmd.completed) {
        deps.eventBus.emit('building:completed', {
            buildingId: entity.id,
            buildingType: cmd.buildingType,
            race: entity.race,
            placedCompleted: true,
            spawnWorker: cmd.spawnWorker,
            level: 'info',
        });
    }

    const effects: any[] = [
        { type: 'building_placed', entityId: entity.id, buildingType: cmd.buildingType, x: cmd.x, y: cmd.y },
    ];

    return commandSuccess(effects);
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
    return commandSuccess([{ type: 'entity_removed', entityId: cmd.entityId }]);
}

export function executeSpawnBuildingUnits(deps: SpawnBuildingUnitsDeps, cmd: SpawnBuildingUnitsCommand): CommandResult {
    const entity = deps.state.getEntityOrThrow(cmd.buildingEntityId, 'completed building for unit spawning');
    const buildingType = entity.subType as BuildingType;
    const bx = entity.x;
    const by = entity.y;
    const effects: UnitSpawnEffect[] = [];

    const spawnDef = BUILDING_SPAWN_ON_COMPLETE[buildingType];
    if (spawnDef && !spawnDef.spawnInterval) {
        spawnUnitsNear(deps, bx, by, spawnDef.unitType, spawnDef.count, entity.player, spawnDef.selectable, effects);
    }

    if (cmd.spawnWorker && !spawnDef) {
        spawnWorkerInsideBuilding(deps, entity, bx, by, effects);
    }

    return commandSuccess(effects);
}
