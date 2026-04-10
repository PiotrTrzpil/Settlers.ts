/**
 * Headless movement & pathfinding simulation using real XML game data.
 *
 * Two occupancy maps: unitOccupancy (ignored by A*) and buildingOccupancy
 * (blocks pathfinding except goal/door tiles). Water (type 0-8) is impassable.
 *
 * Tests verify: arrival, footprint avoidance, terrain avoidance, occupancy consistency.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { createSimulation, cleanupSimulation, type Simulation } from '../../helpers/test-simulation';
import { installRealGameData } from '../../helpers/test-game-data';
import { TERRAIN, setTerrainAt, blockColumnWithGap } from '../../helpers/test-map';
import { BuildingType } from '@/game/buildings/building-type';
import { tileKey, getBuildingFootprint, type Tile } from '@/game/entity';
import { UnitType } from '@/game/core/unit-types';
import { Race } from '@/game/core/race';
import { getBuildingDoorPos } from '@/game/data/game-data-access';
import { hexDistance, GRID_DELTAS } from '@/game/systems/hex-directions';

installRealGameData();

// ─── Assertion helpers ──────────────────────────────────────────────

/** Assert no visited tile appears in buildingOccupancy. */
function assertAvoidedFootprints(visited: Tile[], buildingOccupancy: Set<string>): void {
    for (const tile of visited) {
        const key = tileKey(tile);
        expect(buildingOccupancy.has(key), `unit stepped on building tile (${tile.x}, ${tile.y})`).toBe(false);
    }
}

/** Assert every visited tile is passable terrain (type > 8). */
function assertAllPassable(visited: Tile[], groundType: Uint8Array, mapWidth: number): void {
    for (const tile of visited) {
        const idx = tile.y * mapWidth + tile.x;
        expect(groundType[idx]!, `unit visited impassable tile (${tile.x}, ${tile.y})`).toBeGreaterThan(8);
    }
}

// ─── Group collision helpers ────────────────────────────────────────

/**
 * Spawn a column of units near a location.
 * Units are placed in a vertical column at (x, startY), (x, startY+spacing), etc.
 */
function spawnGroup(
    s: Simulation,
    opts: { count: number; x: number; startY: number; spacing?: number; unitType?: UnitType }
): number[] {
    const { count, x, startY, spacing = 2, unitType = UnitType.Swordsman1 } = opts;
    const ids: number[] = [];
    for (let i = 0; i < count; i++) {
        ids.push(s.spawnUnit({ x: x, y: startY + i * spacing }, unitType));
    }
    return ids;
}

/**
 * Issue move orders for a group — each unit moves to (targetX, same Y).
 * Returns { ids, targets } ready for runWithPositionTracking.
 */
function moveGroupTo(s: Simulation, ids: number[], targetX: number) {
    const targets: Tile[] = [];
    for (const id of ids) {
        const e = s.state.getEntityOrThrow(id, 'moveGroup');
        targets.push({ x: targetX, y: e.y });
    }
    for (let i = 0; i < ids.length; i++) {
        expect(s.moveUnit(ids[i]!, targets[i]!)).toBe(true);
    }
    return { ids, targets };
}

/** Spawn two opposing groups and move them toward each other's start positions. */
function spawnOpposingGroups(
    s: Simulation,
    opts: { count: number; leftX: number; rightX: number; startY: number; ySpacing: number; unitType?: UnitType }
) {
    const { count, leftX, rightX, startY, ySpacing, unitType = UnitType.Swordsman1 } = opts;
    const leftGroup = spawnGroup(s, { count, x: leftX, startY, spacing: ySpacing, unitType });
    const rightGroup = spawnGroup(s, { count, x: rightX, startY, spacing: ySpacing, unitType });

    const ids: number[] = [];
    const targets: Tile[] = [];
    for (let i = 0; i < count; i++) {
        ids.push(leftGroup[i]!);
        targets.push({ x: rightX, y: startY + i * ySpacing });
        ids.push(rightGroup[i]!);
        targets.push({ x: leftX, y: startY + i * ySpacing });
    }

    for (let i = 0; i < ids.length; i++) {
        expect(s.moveUnit(ids[i]!, targets[i]!)).toBe(true);
    }
    return { ids, targets };
}

/**
 * Tick the simulation while tracking every unit's position each tick.
 * Returns a map from entity ID to the sequence of positions it occupied.
 * Only records a new entry when the position actually changes (deduped).
 */
function runWithPositionTracking(
    s: Simulation,
    ids: number[],
    targets: Tile[],
    opts: { maxTicks: number; label: string; dt?: number }
): Map<number, Tile[]> {
    const trails = new Map<number, Tile[]>();
    for (const id of ids) {
        const e = s.state.getEntityOrThrow(id, 'track-init');
        trails.set(id, [{ x: e.x, y: e.y }]);
    }

    s.runUntil(
        () => {
            // Record positions each tick
            for (const id of ids) {
                const e = s.state.getEntityOrThrow(id, 'track');
                const trail = trails.get(id)!;
                const last = trail[trail.length - 1]!;
                if (e.x !== last.x || e.y !== last.y) {
                    trail.push({ x: e.x, y: e.y });
                }
            }
            return ids.every((id, i) => {
                const e = s.state.getEntityOrThrow(id, 'arrive');
                return e.x === targets[i]!.x && e.y === targets[i]!.y;
            });
        },
        {
            maxTicks: opts.maxTicks,
            dt: opts.dt,
            label: opts.label,
            diagnose: () => {
                const stuck: string[] = [];
                for (let i = 0; i < ids.length; i++) {
                    const e = s.state.getEntityOrThrow(ids[i]!, 'diag');
                    const t = targets[i]!;
                    if (e.x !== t.x || e.y !== t.y) {
                        const group = i % 2 === 0 ? 'A' : 'B';
                        stuck.push(`${group}[${Math.floor(i / 2)}] #${e.id} at (${e.x},${e.y}) → (${t.x},${t.y})`);
                    }
                }
                return `${stuck.length}/${ids.length} units didn't arrive:\n  ${stuck.join('\n  ')}`;
            },
        }
    );
    return trails;
}

/** Assert no unit teleported — every consecutive position must be a hex neighbor. */
function assertNoTeleports(trails: Map<number, Tile[]>) {
    for (const [id, trail] of trails) {
        for (let i = 1; i < trail.length; i++) {
            const prev = trail[i - 1]!;
            const curr = trail[i]!;
            const dist = hexDistance(prev.x, prev.y, curr.x, curr.y);
            expect(dist, `unit #${id} teleported (${prev.x},${prev.y})→(${curr.x},${curr.y}) dist=${dist}`).toBe(1);
        }
    }
}

/**
 * Convert a step delta to a hex direction index (0-5), or -1 if zero delta.
 * Matches GRID_DELTAS: NE=0, E=1, SE=2, SW=3, W=4, NW=5.
 */
function stepToDirection(dx: number, dy: number): number {
    for (let d = 0; d < GRID_DELTAS.length; d++) {
        if (GRID_DELTAS[d]![0] === dx && GRID_DELTAS[d]![1] === dy) return d;
    }
    return -1;
}

/** Hex angular distance between two directions (0-3, where 3 = 180deg). */
function turnAngle(dirA: number, dirB: number): number {
    const diff = Math.abs(dirA - dirB);
    return Math.min(diff, 6 - diff);
}

/** Direction names for diagnostic output. */
const DIR_NAMES = ['NE', 'E', 'SE', 'SW', 'W', 'NW'];

/**
 * Assert no unit makes a sharp turn (> 120deg on hex grid).
 * maxAngle: maximum allowed hex turn steps (default 2 = 120deg).
 */
function assertSmoothMovement(trails: Map<number, Tile[]>, maxAngle = 2) {
    for (const [id, trail] of trails) {
        if (trail.length < 3) continue;

        for (let i = 2; i < trail.length; i++) {
            const dx1 = trail[i - 1]!.x - trail[i - 2]!.x;
            const dy1 = trail[i - 1]!.y - trail[i - 2]!.y;
            const dx2 = trail[i]!.x - trail[i - 1]!.x;
            const dy2 = trail[i]!.y - trail[i - 1]!.y;

            const d1 = stepToDirection(dx1, dy1);
            const d2 = stepToDirection(dx2, dy2);
            if (d1 === -1 || d2 === -1) continue;

            const angle = turnAngle(d1, d2);
            expect(
                angle,
                `unit #${id} sharp turn ${DIR_NAMES[d1]}→${DIR_NAMES[d2]} (${angle * 60}deg) ` +
                    `at step ${i}: (${trail[i - 2]!.x},${trail[i - 2]!.y})→` +
                    `(${trail[i - 1]!.x},${trail[i - 1]!.y})→(${trail[i]!.x},${trail[i]!.y})`
            ).toBeLessThanOrEqual(maxAngle);
        }
    }
}

/** Assert every unit sits on its target and no two share a tile. */
function assertAllArrived(s: Simulation, ids: number[], targets: Tile[]) {
    const occupied = new Set<string>();
    for (let i = 0; i < ids.length; i++) {
        const e = s.state.getEntityOrThrow(ids[i]!, 'verify');
        expect(e.x, `unit #${e.id} x`).toBe(targets[i]!.x);
        expect(e.y, `unit #${e.id} y`).toBe(targets[i]!.y);
        const key = tileKey(e);
        expect(occupied.has(key), `duplicate occupancy at (${e.x},${e.y})`).toBe(false);
        occupied.add(key);
    }
}

// ─── Single-unit pathfinding ────────────────────────────────────────

describe('Single-unit pathfinding (real game data)', { timeout: 5000 }, () => {
    let sim: Simulation;

    afterEach(() => {
        sim?.destroy();
        cleanupSimulation();
    });

    it('unit moves to target on open terrain', () => {
        sim = createSimulation();

        const unitId = sim.spawnUnit({ x: 20, y: 60 });
        const target = { x: 30, y: 60 };
        expect(sim.moveUnit(unitId, target)).toBe(true);

        const visited = sim.simulateMovement(unitId, { target });

        expect(visited[0]).toEqual({ x: 20, y: 60 });
        expect(visited[visited.length - 1]).toEqual(target);
        expect(visited.length).toBeGreaterThan(2);
    });

    it('tile occupancy is consistent after movement', () => {
        sim = createSimulation();

        const unitId = sim.spawnUnit({ x: 20, y: 60 });
        const startKey = tileKey({ x: 20, y: 60 });
        expect(sim.state.unitOccupancy.get(startKey)).toBe(unitId);

        const target = { x: 30, y: 60 };
        sim.moveUnit(unitId, target);
        sim.simulateMovement(unitId, { target });

        const unit = sim.state.getEntityOrThrow(unitId, 'test');
        const endKey = tileKey(unit);

        expect(sim.state.unitOccupancy.has(startKey)).toBe(false);
        expect(sim.state.unitOccupancy.get(endKey)).toBe(unitId);

        let count = 0;
        for (const id of sim.state.unitOccupancy.values()) {
            if (id === unitId) count++;
        }
        expect(count).toBe(1);
    });

    it('unit avoids building footprint tiles', () => {
        sim = createSimulation({ mapWidth: 128, mapHeight: 128 });

        sim.placeBuilding(BuildingType.ResidenceSmall);
        sim.placeBuilding(BuildingType.Sawmill);

        expect(sim.state.buildingOccupancy.size).toBeGreaterThan(0);
        sim.runTicks(60);

        const target = { x: 60, y: 30 };
        const unitId = sim.spawnUnit({ x: 10, y: 30 });
        expect(sim.moveUnit(unitId, target)).toBe(true);

        const visited = sim.simulateMovement(unitId, { target, maxTicks: 1200 });

        expect(visited[visited.length - 1]).toEqual(target);
        assertAvoidedFootprints(visited, sim.state.buildingOccupancy);
    });

    it('unit reaches building via its door tile', () => {
        sim = createSimulation({ mapWidth: 128, mapHeight: 128 });

        const buildingId = sim.placeBuilding(BuildingType.WoodcutterHut);
        const building = sim.state.getEntityOrThrow(buildingId, 'test');
        const door = getBuildingDoorPos(building, Race.Roman, BuildingType.WoodcutterHut);

        expect(sim.state.buildingOccupancy.has(tileKey(door))).toBe(false);
        sim.runTicks(60);

        const target = { x: door.x, y: door.y };
        const unitId = sim.spawnUnit({ x: door.x - 10, y: door.y });
        expect(sim.moveUnit(unitId, target)).toBe(true);

        const visited = sim.simulateMovement(unitId, { target, maxTicks: 1200 });

        expect(visited[visited.length - 1]).toEqual(target);
        assertAvoidedFootprints(visited, sim.state.buildingOccupancy);
    });

    it('unit navigates between multiple buildings without crossing footprints', () => {
        sim = createSimulation({ mapWidth: 128, mapHeight: 128 });

        sim.placeBuilding(BuildingType.ResidenceSmall);
        sim.placeBuilding(BuildingType.WoodcutterHut);
        sim.placeBuilding(BuildingType.Sawmill);
        sim.placeBuilding(BuildingType.StorageArea);

        sim.runTicks(60);

        const target = { x: 70, y: 50 };
        const unitId = sim.spawnUnit({ x: 10, y: 30 });
        expect(sim.moveUnit(unitId, target)).toBe(true);

        const visited = sim.simulateMovement(unitId, { target, maxTicks: 1200 });

        expect(visited[visited.length - 1]).toEqual(target);
        assertAvoidedFootprints(visited, sim.state.buildingOccupancy);
    });

    it('unit avoids water and finds alternative route', () => {
        sim = createSimulation();

        blockColumnWithGap(sim.map, 60, 50);

        const target = { x: 65, y: 55 };
        const unitId = sim.spawnUnit({ x: 55, y: 55 });
        expect(sim.moveUnit(unitId, target)).toBe(true);

        const visited = sim.simulateMovement(unitId, { target });

        expect(visited[visited.length - 1]).toEqual(target);

        const usesGap = visited.some(p => p.x === 60 && p.y === 50);
        expect(usesGap).toBe(true);

        assertAllPassable(visited, sim.map.groundType, sim.map.mapSize.width);
    });

    it('all visited tiles are passable when detouring around water', () => {
        sim = createSimulation();

        for (let x = 58; x <= 68; x++) {
            for (let y = 60; y <= 64; y++) {
                setTerrainAt(sim.map, { x: x, y: y }, TERRAIN.WATER);
            }
        }

        const target = { x: 72, y: 62 };
        const unitId = sim.spawnUnit({ x: 55, y: 62 });
        expect(sim.moveUnit(unitId, target)).toBe(true);

        const visited = sim.simulateMovement(unitId, { target, maxTicks: 1200 });

        expect(visited[visited.length - 1]).toEqual(target);
        assertAllPassable(visited, sim.map.groundType, sim.map.mapSize.width);
    });

    it('unit avoids both water and building obstacles simultaneously', () => {
        sim = createSimulation({ mapWidth: 128, mapHeight: 128 });

        for (let x = 35; x <= 50; x++) {
            setTerrainAt(sim.map, { x: x, y: 45 }, TERRAIN.WATER);
            setTerrainAt(sim.map, { x: x, y: 46 }, TERRAIN.WATER);
        }

        sim.placeBuilding(BuildingType.ResidenceSmall);
        sim.placeBuilding(BuildingType.Sawmill);

        sim.runTicks(60);

        const target = { x: 60, y: 40 };
        const unitId = sim.spawnUnit({ x: 20, y: 40 });
        expect(sim.moveUnit(unitId, target)).toBe(true);

        const visited = sim.simulateMovement(unitId, { target, maxTicks: 1200 });

        expect(visited[visited.length - 1]).toEqual(target);
        assertAvoidedFootprints(visited, sim.state.buildingOccupancy);
        assertAllPassable(visited, sim.map.groundType, sim.map.mapSize.width);
    });

    it('A* finds path between two completed buildings at 10-tile spacing', () => {
        sim = createSimulation();

        sim.placeBuilding(BuildingType.Sawmill);
        sim.placeBuilding(BuildingType.StorageArea);

        const unitId = sim.spawnUnit({ x: 10, y: 30 });
        expect(sim.moveUnit(unitId, { x: 60, y: 30 })).toBe(true);
    });
});

// ─── Construction site & multi-unit pathfinding ───────────────────────────────

describe('Construction site & multi-unit pathfinding (real game data)', { timeout: 5000 }, () => {
    let sim: Simulation;

    afterEach(() => {
        sim?.destroy();
        cleanupSimulation();
    });

    it('clearBuildingFootprintBlock removes all construction site tiles', () => {
        sim = createSimulation();

        const siteId = sim.placeBuilding(BuildingType.WoodcutterHut, 0, false);
        const building = sim.state.getEntityOrThrow(siteId, 'test');

        sim.state.clearBuildingFootprintBlock(siteId);

        const footprint = getBuildingFootprint(
            { x: building.x, y: building.y },
            building.subType as BuildingType,
            building.race
        );
        const leaked: string[] = [];
        for (const tile of footprint) {
            if (sim.state.buildingOccupancy.has(tileKey(tile))) {
                leaked.push(`(${tile.x},${tile.y})`);
            }
        }
        expect(leaked, `tiles still in buildingOccupancy: ${leaked.join(', ')}`).toHaveLength(0);
    });

    it('A* finds path to construction site door at 20-tile spacing', () => {
        sim = createSimulation();

        sim.placeBuilding(BuildingType.Sawmill);
        const siteId = sim.placeBuilding(BuildingType.WoodcutterHut, 0, false);

        const site = sim.state.getEntityOrThrow(siteId, 'test');
        const door = getBuildingDoorPos(site, site.race, site.subType as BuildingType);

        const unitId = sim.spawnUnit({ x: 10, y: 30 });
        expect(sim.moveUnit(unitId, door)).toBe(true);
    });

    it('pathfinding fails for unreachable target', () => {
        sim = createSimulation();

        for (let y = 0; y < sim.map.mapSize.height; y++) {
            setTerrainAt(sim.map, { x: 60, y: y }, TERRAIN.WATER);
            setTerrainAt(sim.map, { x: 61, y: y }, TERRAIN.WATER);
        }

        const unitId = sim.spawnUnit({ x: 50, y: 50 });
        expect(sim.moveUnit(unitId, { x: 70, y: 50 })).toBe(false);
    });

    it('two units moving to different targets both arrive', () => {
        sim = createSimulation();

        const u1 = sim.spawnUnit({ x: 20, y: 50 });
        const u2 = sim.spawnUnit({ x: 20, y: 70 });

        const t1 = { x: 40, y: 50 };
        const t2 = { x: 40, y: 70 };
        sim.moveUnit(u1, t1);
        sim.moveUnit(u2, t2);

        sim.runUntil(
            () => {
                const e1 = sim.state.getEntityOrThrow(u1, 'test');
                const e2 = sim.state.getEntityOrThrow(u2, 'test');
                return e1.x === t1.x && e1.y === t1.y && e2.x === t2.x && e2.y === t2.y;
            },
            { maxTicks: 600 }
        );

        const entity1 = sim.state.getEntityOrThrow(u1, 'test');
        const entity2 = sim.state.getEntityOrThrow(u2, 'test');

        expect(entity1.x).toBe(40);
        expect(entity1.y).toBe(50);
        expect(entity2.x).toBe(40);
        expect(entity2.y).toBe(70);

        expect(sim.state.unitOccupancy.get(tileKey({ x: 40, y: 50 }))).toBe(u1);
        expect(sim.state.unitOccupancy.get(tileKey({ x: 40, y: 70 }))).toBe(u2);
    });
});

// ─── Group collision (two squads passing through each other) ──────

describe('Group collision pathfinding (real game data)', { timeout: 5000 }, () => {
    let sim: Simulation;

    afterEach(() => {
        sim?.destroy();
        cleanupSimulation();
    });

    it('two groups of five swordsmen pass through each other', () => {
        sim = createSimulation();

        const { ids, targets } = spawnOpposingGroups(sim, {
            count: 5,
            leftX: 20,
            rightX: 60,
            startY: 50,
            ySpacing: 2,
        });

        const trails = runWithPositionTracking(sim, ids, targets, {
            maxTicks: 3000,
            label: '2x5 swordsmen open terrain',
        });
        assertAllArrived(sim, ids, targets);
        assertNoTeleports(trails);
        assertSmoothMovement(trails);
    });

    it('two groups pass through each other in a narrow corridor', () => {
        sim = createSimulation();

        for (let x = 30; x <= 70; x++) {
            for (let dy = -3; dy >= -6; dy--) setTerrainAt(sim.map, { x: x, y: 50 + dy }, TERRAIN.WATER);
            for (let dy = 5; dy <= 8; dy++) setTerrainAt(sim.map, { x: x, y: 50 + dy }, TERRAIN.WATER);
        }

        const { ids, targets } = spawnOpposingGroups(sim, {
            count: 5,
            leftX: 25,
            rightX: 75,
            startY: 48,
            ySpacing: 1,
        });

        const trails = runWithPositionTracking(sim, ids, targets, {
            maxTicks: 6000,
            label: '2x5 swordsmen narrow corridor',
        });
        assertAllArrived(sim, ids, targets);
        assertNoTeleports(trails);
        // Allow 180deg turns — bumps in tight corridors can push units backward temporarily
        assertSmoothMovement(trails, 3);
    });

    it('ten swordsmen march through a dense building cluster with idle settlers', () => {
        sim = createSimulation({ mapWidth: 256, mapHeight: 256 });

        sim.placeBuilding(BuildingType.ResidenceSmall);
        sim.placeBuilding(BuildingType.WoodcutterHut);
        sim.placeBuilding(BuildingType.Sawmill);
        sim.placeBuilding(BuildingType.StorageArea);
        sim.placeBuilding(BuildingType.ForesterHut);
        sim.placeBuilding(BuildingType.StonecutterHut);

        expect(sim.state.buildingOccupancy.size).toBeGreaterThan(0);
        sim.runTicks(120);

        // Marching group created first → lower IDs → can bump idle settlers
        const marchGroup = spawnGroup(sim, { count: 10, x: 10, startY: 26 });
        spawnGroup(sim, { count: 5, x: 35, startY: 28, spacing: 4 });

        const { ids, targets } = moveGroupTo(sim, marchGroup, 90);

        const trails = runWithPositionTracking(sim, ids, targets, {
            maxTicks: 6000,
            label: '10 swordsmen through building cluster',
        });
        assertAllArrived(sim, ids, targets);
        assertNoTeleports(trails);
        assertSmoothMovement(trails);
        for (const [, trail] of trails) {
            assertAvoidedFootprints(trail, sim.state.buildingOccupancy);
        }
    });
});
