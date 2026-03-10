/**
 * Exhaustive door pathfinding test — verifies every building/race combo
 * has the door at the edge of the block area (blockPosLines), so settlers
 * can pathfind to it without corridor carving.
 *
 * One simulation per race (fast), all buildings placed in the same sim.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { createSimulation, cleanupSimulation, type Simulation } from '../../helpers/test-simulation';
import { installRealGameData } from '../../helpers/test-game-data';
import { BuildingType } from '@/game/buildings/building-type';
import { tileKey, type TileCoord, UnitType } from '@/game/entity';
import { Race, AVAILABLE_RACES } from '@/game/core/race';
import { getBuildingDoorPos, hasBuildingXmlMapping } from '@/game/data/game-data-access';
import { getBuildingBlockArea, getBuildingPassableTiles, isMineBuilding } from '@/game/buildings/types';
import { isBuildingAvailableForRace } from '@/game/data/race-availability';
import { getAllNeighbors } from '@/game/systems/hex-directions';
import { setPathDebugHook } from '@/game/systems/pathfinding/astar';

const hasRealData = installRealGameData();

const FUNCTIONAL_BUILDINGS: BuildingType[] = Object.values(BuildingType)
    .filter((v): v is BuildingType => typeof v === 'number')
    .filter(bt => {
        if (bt >= BuildingType.Eyecatcher01 && bt <= BuildingType.Eyecatcher12) return false;
        if (!hasBuildingXmlMapping(bt)) return false;
        return true;
    });

function hasBuildingBlockData(race: Race, buildingType: BuildingType): boolean {
    try {
        return getBuildingBlockArea(60, 60, buildingType, race).length > 0;
    } catch {
        return false;
    }
}

/** Check one building's door is at the edge of the block area. Returns failure message or null. */
function checkDoorAtEdge(race: Race, bt: BuildingType): string | null {
    const bx = 60, by = 60;
    const label = `${BuildingType[bt]}/${Race[race]}`;
    const blockArea = getBuildingBlockArea(bx, by, bt, race);
    const blockKeys = new Set(blockArea.map(t => tileKey(t.x, t.y)));
    const passable = getBuildingPassableTiles(bx, by, bt, race, blockArea);
    const door = getBuildingDoorPos(bx, by, race, bt);
    const doorKey = tileKey(door.x, door.y);

    // Door must be passable (either outside block area, or marked passable)
    if (blockKeys.has(doorKey) && !passable.has(doorKey)) {
        return `${label}: door (${door.x},${door.y}) blocked and not in passable set`;
    }

    // Check all 6 neighbors — at least one must be free (not blocked, or marked passable)
    const hasFreeAdjacent = getAllNeighbors(door).some(n => {
        const nk = tileKey(n.x, n.y);
        return !blockKeys.has(nk) || passable.has(nk);
    });
    if (!hasFreeAdjacent) {
        return `${label}: door (${door.x},${door.y}) has no free adjacent tile`;
    }
    return null;
}

const VERBOSE = !!process.env['VERBOSE_MOVEMENT'];

/** Diagnose why A* failed to reach a door — prints neighbor and occupancy info. */
function diagnosePathfindFailure(sim: Simulation, door: TileCoord, label: string): string {
    const neighbors = getAllNeighbors(door);
    const tileInfo = neighbors.map(t => {
        const k = tileKey(t.x, t.y);
        return `(${t.x},${t.y}):block=${sim.state.buildingOccupancy.has(k)}`;
    });
    return `${label}: A* failed to door (${door.x},${door.y})\n  neighbors: ${tileInfo.join(', ')}`;
}

/** Check if any visited tile is in buildingOccupancy. */
function checkVisitedForBlocked(visited: TileCoord[], occupancy: Set<string>, label: string): string | null {
    for (const tile of visited) {
        if (occupancy.has(tileKey(tile.x, tile.y))) {
            return `${label}: stepped on blocked tile (${tile.x},${tile.y})`;
        }
    }
    return null;
}

/** Check one building's door is reachable via pathfinding in a simulation. */
function checkDoorPathfinding(sim: Simulation, race: Race, bt: BuildingType): string | null {
    const label = `${BuildingType[bt]}/${Race[race]}`;
    const buildingId = sim.placeBuilding(bt, 0, true, race, false);
    const building = sim.state.getEntityOrThrow(buildingId, 'test');
    const door = getBuildingDoorPos(building.x, building.y, race, bt);

    if (sim.state.buildingOccupancy.has(tileKey(door.x, door.y))) {
        return `${label}: door (${door.x},${door.y}) blocked in buildingOccupancy`;
    }

    const unitId = sim.spawnUnitNear(buildingId, UnitType.Carrier)[0]!;
    const unit = sim.state.getEntityOrThrow(unitId, 'test');

    // Capture raw and smoothed A* paths for diagnostics
    let capturedRaw = '';
    let capturedSmoothed = '';
    if (VERBOSE) {
        setPathDebugHook((raw, smoothed) => {
            capturedRaw = raw.map(t => `(${t.x},${t.y})`).join('→');
            capturedSmoothed = smoothed.map(t => `(${t.x},${t.y})`).join('→');
        });
    }

    const canMove = sim.moveUnit(unitId, door.x, door.y);
    if (VERBOSE) setPathDebugHook(undefined);

    if (!canMove) {
        sim.state.removeEntity(unitId);
        return diagnosePathfindFailure(sim, door, label);
    }

    // Verify the computed path reaches the door (don't simulate — other units may collide)
    const unitState = sim.state.unitStates.get(unitId)!;
    const path = unitState.path;
    const lastWp = path[path.length - 1]!;
    let failure: string | null = null;

    if (lastWp.x !== door.x || lastWp.y !== door.y) {
        failure = `${label}: path ends at (${lastWp.x},${lastWp.y}) not door (${door.x},${door.y})`;
    }

    if (!failure) {
        failure = checkVisitedForBlocked(path as TileCoord[], sim.state.buildingOccupancy, label);
    }

    if (failure && VERBOSE) {
        const pathStr = path.map((t: TileCoord) => `(${t.x},${t.y})`).join('→');
        failure += `\n  unit_start=(${unit.x},${unit.y}) door=(${door.x},${door.y})` +
            `\n  raw_path:      ${capturedRaw}` +
            `\n  smoothed_path: ${capturedSmoothed}` +
            `\n  path:          ${pathStr}`;
    }

    sim.state.removeEntity(unitId);
    return failure;
}

describe.skipIf(!hasRealData)('Door pathfinding — every building, every race', { timeout: 15000 }, () => {
    // ─── Static: door is at edge of block area (has a non-blocked neighbor) ──

    it('every door is at the edge of the block area', () => {
        const failures: string[] = [];

        for (const race of AVAILABLE_RACES) {
            for (const bt of FUNCTIONAL_BUILDINGS) {
                if (!isBuildingAvailableForRace(bt, race) || !hasBuildingBlockData(race, bt)) continue;
                const failure = checkDoorAtEdge(race, bt);
                if (failure) failures.push(failure);
            }
        }

        expect(failures, `Block area edge failures:\n${failures.join('\n')}`).toHaveLength(0);
    });

    // ─── Live: one sim per race, pathfind to every door ──────────────

    describe('pathfinding to door', () => {
        let sim: Simulation;

        afterEach(() => {
            sim?.destroy();
            cleanupSimulation();
        });

        for (const race of AVAILABLE_RACES) {
            it(`${Race[race]}: unit reaches every building door`, () => {
                sim = createSimulation({ mapWidth: 512, mapHeight: 512 });
                (sim.state.playerRaces as Map<number, Race>).set(0, race);

                const failures: string[] = [];
                for (const bt of FUNCTIONAL_BUILDINGS) {
                    if (!isBuildingAvailableForRace(bt, race) || !hasBuildingBlockData(race, bt)) continue;
                    if (isMineBuilding(bt)) continue;
                    const failure = checkDoorPathfinding(sim, race, bt);
                    if (failure) failures.push(failure);
                }

                expect(failures, `Failures:\n${failures.join('\n')}`).toHaveLength(0);
            });
        }
    });
});
