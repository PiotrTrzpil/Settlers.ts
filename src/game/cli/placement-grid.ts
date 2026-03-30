/**
 * CLI placement grid — creates a ValidPositionGrid and computes just enough
 * rings to cover the CLI map viewport. Uses the same validation logic as
 * the in-game renderer's placement overlay dots.
 */

import type { GameCore } from '@/game/game-core';
import type { BuildingType } from '@/game/buildings/building-type';
import { EntityType } from '@/game/entity';
import { isNonBlockingMapObject } from '@/game/data/game-data-access';
import type { GridComputeRequest } from '@/game/systems/placement/valid-position-grid';
import { ValidPositionGrid } from '@/game/systems/placement/valid-position-grid';

/**
 * Create a ValidPositionGrid and compute enough to cover the given viewport radius.
 * Returns null if the player's race is unknown.
 */
export function createCliPlacementGrid(
    game: GameCore,
    buildingType: BuildingType,
    centerX: number,
    centerY: number,
    player: number,
    viewportRadius: number
): ValidPositionGrid | null {
    const race = game.playerRaces.get(player);
    if (race === undefined) {
        return null;
    }

    const request: GridComputeRequest = {
        buildingType,
        race,
        player,
        centerX: Math.round(centerX),
        centerY: Math.round(centerY),
        placementFilter: game.placementFilter,
    };

    const replaceCheck = (id: number) => {
        const e = game.state.getEntity(id);
        return e?.type === EntityType.MapObject && isNonBlockingMapObject(e.subType as number);
    };
    const grid = new ValidPositionGrid(
        request,
        game.terrain.mapSize,
        game.terrain.groundType,
        game.terrain.groundHeight,
        game.state.groundOccupancy,
        game.state.buildingFootprint,
        replaceCheck
    );

    // Compute just enough tiles to cover the viewport.
    // Ring r covers all tiles within Chebyshev distance r from center.
    // Add margin for building footprint overhang.
    const tilesNeeded = (2 * (viewportRadius + 5) + 1) ** 2;
    grid.computeChunk(tilesNeeded);

    return grid;
}
