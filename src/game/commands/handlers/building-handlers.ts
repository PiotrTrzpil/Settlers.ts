import { EntityType, UnitType, tileKey, getBuildingFootprint, type Entity, Tile } from '../../entity';
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
import { BuildingType, isMineBuilding } from '../../buildings/types';
import { TERRITORY_BUILDINGS } from '../../features/territory/territory-types';
import { isNonBlockingMapObject } from '../../data/game-data-access';
import { BUILDING_SPAWN_ON_COMPLETE } from '../../features/building-construction/spawn-units';
import { getBuildingWorkerInfo, getBuildingDoorPos } from '../../data/game-data-access';
import { ringTiles } from '../../systems/spatial-search';
import type {
    PlaceBuildingCommand,
    RemoveEntityCommand,
    SpawnBuildingUnitsCommand,
    CommandResult,
    CommandFailure,
    SpawnResult,
} from '../command-types';
import { commandFailed, COMMAND_OK } from '../command-types';

export interface PlaceBuildingDeps {
    state: GameState;
    terrain: TerrainData;
    eventBus: EventBus;
    settings: GameSettings;
    constructionSiteManager: ConstructionSiteManager;
    placementFilter: PlacementFilter | null;
    /** Territory owner lookup — rejects placement outside player's territory. */
    getOwner: (tile: Tile) => number;
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
    // No occupancy — the building owns the door tile. The task system will assign
    // the worker and the normal work cycle handles walking out via exitBuilding.
    const door = getBuildingDoorPos(tile, entity.race, buildingType);
    const workerEntity = state.addUnit(workerInfo.unitType, door, entity.player, { occupancy: false });

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

function isReplaceableOccupant(state: GameState, entityId: number): boolean {
    const entity = state.getEntity(entityId);
    if (!entity || entity.type !== EntityType.MapObject) {
        return false;
    }
    return isNonBlockingMapObject(entity.subType as number);
}

/** Remove replaceable map objects from footprint tiles before placing a building. */
function removeReplaceableMapObjects(state: GameState, footprint: ReadonlyArray<Tile>): void {
    for (const tile of footprint) {
        const occupantId = state.groundOccupancy.get(tileKey(tile));
        if (occupantId !== undefined && isReplaceableOccupant(state, occupantId)) {
            state.removeEntity(occupantId);
        }
    }
}

/**
 * Check that every footprint tile is inside the player's territory.
 * The only exception is the player's very first territory building (castle/tower)
 * which bootstraps territory from unclaimed land.
 */
function validateTerritoryPlacement(
    deps: PlaceBuildingDeps,
    state: GameState,
    cmd: PlaceBuildingCommand,
    footprint: ReadonlyArray<Tile>
): CommandFailure | undefined {
    const playerHasTerritory = deps.getOwner({ x: cmd.x, y: cmd.y }) === cmd.player;
    const isBootstrap =
        !playerHasTerritory &&
        TERRITORY_BUILDINGS.has(cmd.buildingType) &&
        !state.entities.some(
            e =>
                e.type === EntityType.Building &&
                e.player === cmd.player &&
                TERRITORY_BUILDINGS.has(e.subType as BuildingType)
        );
    if (isBootstrap) {return undefined;}

    for (const tile of footprint) {
        if (deps.getOwner(tile) !== cmd.player) {
            return commandFailed(
                `Cannot place building at (${cmd.x}, ${cmd.y}): tile (${tile.x}, ${tile.y}) outside player ${cmd.player}'s territory`
            );
        }
    }
    return undefined;
}

export function executePlaceBuilding(deps: PlaceBuildingDeps, cmd: PlaceBuildingCommand): SpawnResult | CommandFailure {
    const { state, terrain } = deps;
    const race =
        cmd.race ??
        state.playerRaces.get(cmd.player) ??
        (() => {
            throw new Error(`No race for player ${cmd.player} in PlaceBuildingHandler`);
        })();
    const replaceCheck = (id: number) => isReplaceableOccupant(state, id);

    if (
        !cmd.trusted &&
        !canPlaceBuildingFootprint(
            terrain,
            state.groundOccupancy,
            cmd.x,
            cmd.y,
            cmd.buildingType,
            race,
            state.buildingFootprint,
            deps.placementFilter,
            cmd.player,
            replaceCheck
        )
    ) {
        return commandFailed(`Cannot place building at (${cmd.x}, ${cmd.y}): invalid placement`);
    }

    // Remove small decorative map objects from the footprint before placing the building
    const footprint = getBuildingFootprint(cmd, cmd.buildingType, race);

    if (!cmd.trusted) {
        const territoryError = validateTerritoryPlacement(deps, state, cmd, footprint);
        if (territoryError) {return territoryError;}
    }
    removeReplaceableMapObjects(state, footprint);

    const entity = state.addBuilding(cmd.buildingType, cmd, cmd.player, { race: cmd.race });
    const isMine = isMineBuilding(cmd.buildingType);

    // Mines skip terrain modification — mountain stays as rock
    if (!isMine) {
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
    } else {
        if (cmd.completed) {
            state.restoreBuildingFootprintBlock(entity.id);
        }

        deps.eventBus.emit('building:placed', {
            buildingId: entity.id,
            buildingType: cmd.buildingType,
            x: cmd.x,
            y: cmd.y,
            player: cmd.player,
            level: 'info',
        });
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

    return { success: true, entityId: entity.id };
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
