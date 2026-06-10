import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ValidPositionGrid, validateBuildingPlacement, type GridComputeRequest } from '@/game/systems/placement';
import { BuildingType } from '@/game/entity';
import { Race } from '@/game/core/race';
import { createTestMap, type TestMap } from '../helpers/test-map';
import { installTestGameData, resetTestGameData } from '../helpers/test-game-data';

function createGrid(map: TestMap, centerX: number, centerY: number): ValidPositionGrid {
    const request: GridComputeRequest = {
        buildingType: BuildingType.WoodcutterHut,
        race: Race.Roman,
        player: 1,
        centerX,
        centerY,
        placementFilter: null,
    };
    return new ValidPositionGrid(
        request,
        map.mapSize,
        map.groundType,
        map.groundHeight,
        map.occupancy,
        map.buildingOccupancy
    );
}

/** Drive the chunked spiral to completion, failing the test if it never terminates. */
function computeToCompletion(grid: ValidPositionGrid): void {
    for (let chunk = 0; chunk < 100; chunk++) {
        if (grid.computeChunk(5000)) {
            return;
        }
    }
    expect.unreachable('grid computation did not terminate after 500k tiles on a 64x64 map');
}

/** Brute-force the set of valid tile indices using the same validator the grid uses. */
function bruteForceValidTiles(map: TestMap): Set<number> {
    const valid = new Set<number>();
    for (let y = 0; y < map.mapSize.height; y++) {
        for (let x = 0; x < map.mapSize.width; x++) {
            const result = validateBuildingPlacement(x, y, BuildingType.WoodcutterHut, {
                groundType: map.groundType,
                groundHeight: map.groundHeight,
                mapSize: map.mapSize,
                groundOccupancy: map.occupancy,
                buildingFootprint: map.buildingOccupancy,
                race: Race.Roman,
                placementFilter: null,
                player: 1,
            });
            if (result.canPlace) {
                valid.add(map.mapSize.toIndex({ x, y }));
            }
        }
    }
    return valid;
}

describe('ValidPositionGrid spiral computation', () => {
    let map: TestMap;

    beforeEach(() => {
        installTestGameData();
        map = createTestMap();
    });

    afterEach(() => resetTestGameData());

    it('terminates once every ring is fully outside the map', () => {
        const grid = createGrid(map, 32, 32);
        computeToCompletion(grid);
        expect(grid.isComplete).toBe(true);
    });

    it('finds exactly the brute-force valid set, with no tile skipped or duplicated', () => {
        const grid = createGrid(map, 32, 32);
        computeToCompletion(grid);

        const positions = grid.getPositions();
        const found = new Set(positions.map(p => map.mapSize.toIndex(p)));

        // Each position must appear exactly once (the old ring walk visited
        // top-left corners twice, pushing duplicate entries).
        expect(positions.length).toBe(found.size);

        // The spiral must cover every tile (the old ring walk skipped the
        // top-right corner of every ring).
        expect(found).toEqual(bruteForceValidTiles(map));
    });

    it('covers the full map from an off-center start', () => {
        const grid = createGrid(map, 3, 60);
        computeToCompletion(grid);

        const found = new Set(grid.getPositions().map(p => map.mapSize.toIndex(p)));
        expect(found).toEqual(bruteForceValidTiles(map));
    });
});
