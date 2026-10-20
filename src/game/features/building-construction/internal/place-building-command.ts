/**
 * place_building command — validates placement (terrain, occupancy, placement filter,
 * territory), clears decorative map objects, creates the building entity, captures the
 * original terrain for the construction site and emits the lifecycle events.
 *
 * Owned by the building-placement feature (see building-placement-feature.ts).
 */

import { EntityType, tileKey, getBuildingFootprint, Tile, getEntityIfType } from '../../../entity';
import type { GameState } from '../../../game-state';
import type { TerrainData } from '../../../terrain';
import type { EventBus } from '../../../event-bus';
import type { ConstructionSiteManager } from '../construction-site-manager';
import { captureOriginalTerrain, setConstructionSiteGroundType, applyTerrainLeveling } from '../terrain';
import { canPlaceBuildingFootprint } from '../../../systems/placement';
import type { PlacementFilter } from '../../../systems/placement';
import { BuildingType, isMineBuilding } from '../../../buildings/types';
import { TERRITORY_BUILDINGS } from '../../territory/territory-types';
import { isNonBlockingMapObject } from '../../../data/game-data-access';
import type { PlaceBuildingCommand, CommandFailure, SpawnResult } from '../../../commands/command-types';
import { commandFailed } from '../../../commands/command-types';

export interface PlaceBuildingDeps {
    state: GameState;
    terrain: TerrainData;
    eventBus: EventBus;
    constructionSiteManager: ConstructionSiteManager;
    /** Territory placement filter; null when territory enforcement is off (nullable by design). */
    placementFilter: PlacementFilter | null;
    /** Territory owner lookup — rejects placement outside player's territory. */
    getOwner: (tile: Tile) => number;
}

function isReplaceableOccupant(state: GameState, entityId: number): boolean {
    const entity = getEntityIfType(state, entityId, EntityType.MapObject);
    if (!entity) {
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
        !state.entityIndex
            .query(EntityType.Building, cmd.player)
            .filter(e => TERRITORY_BUILDINGS.has(e.subType as BuildingType))
            .some();
    if (isBootstrap) {
        return undefined;
    }

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
        if (territoryError) {
            return territoryError;
        }
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
