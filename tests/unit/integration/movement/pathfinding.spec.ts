/**
 * Headless movement & pathfinding simulation — runs the full movement
 * pipeline without a browser using real XML game data.
 *
 * Uses the same simulation harness as the economy tests: GameServices,
 * real building footprints, real door positions, real terrain rules.
 *
 * ═══════════════════════════════════════════════════════════════════
 *  MOVEMENT & PATHFINDING RULES
 * ═══════════════════════════════════════════════════════════════════
 *
 * TILE OCCUPANCY
 * ──────────────
 * Two separate maps control movement:
 *
 *   tileOccupancy (Map<string, entityId>)
 *     — Tracks which entity "owns" each tile. Updated when units move.
 *     — Pathfinder can optionally ignore this (for initial route planning).
 *
 *   buildingOccupancy (Set<string>)
 *     — Tiles blocked by building footprints. ALWAYS blocks pathfinding
 *       except at the goal tile. Door tiles are excluded so units can
 *       enter/exit buildings.
 *
 * BUILDING FOOTPRINTS & DOORS
 * ───────────────────────────
 * When a building is placed, its footprint (from XML bitmask) populates
 * both maps. The door tile is excluded from buildingOccupancy so
 * settlers can walk to the building entrance. Door offset comes from
 * buildingInfo.xml per race and building type.
 *
 * TERRAIN
 * ───────
 * Water (terrain types 0-8) is impassable. All other types are passable
 * with varying height costs. The A* pathfinder considers terrain type,
 * height differences, tile occupancy, and building occupancy.
 *
 * ASSERTIONS
 * ──────────
 * Tests record every tile visited during movement and verify:
 *   • Unit arrives at the target tile
 *   • No visited tile is in buildingOccupancy (footprint avoidance)
 *   • No visited tile is impassable terrain (water avoidance)
 *   • Tile occupancy is consistent after arrival
 */

import { describe, it, expect, afterEach } from 'vitest';
import { createSimulation, cleanupSimulation, type Simulation } from '../helpers/test-simulation';
import { installRealGameData } from '../helpers/test-game-data';
import { TERRAIN, setTerrainAt, blockColumnWithGap } from '../helpers/test-map';
import { BuildingType } from '@/game/buildings/building-type';
import { tileKey, getBuildingFootprint, type TileCoord } from '@/game/entity';
import { Race } from '@/game/race';
import { getBuildingDoorPos } from '@/game/game-data-access';

const hasRealData = installRealGameData();

// ─── Assertion helpers ──────────────────────────────────────────────

/** Assert no visited tile appears in buildingOccupancy. */
function assertAvoidedFootprints(visited: TileCoord[], buildingOccupancy: Set<string>): void {
    for (const tile of visited) {
        const key = tileKey(tile.x, tile.y);
        expect(buildingOccupancy.has(key), `unit stepped on building tile (${tile.x}, ${tile.y})`).toBe(false);
    }
}

/** Assert every visited tile is passable terrain (type > 8). */
function assertAllPassable(visited: TileCoord[], groundType: Uint8Array, mapWidth: number): void {
    for (const tile of visited) {
        const idx = tile.y * mapWidth + tile.x;
        expect(groundType[idx]!, `unit visited impassable tile (${tile.x}, ${tile.y})`).toBeGreaterThan(8);
    }
}

// ─── Tests ──────────────────────────────────────────────────────────

describe.skipIf(!hasRealData)('Movement & Pathfinding simulation (real game data)', { timeout: 5000 }, () => {
    let sim: Simulation;

    afterEach(() => {
        sim?.destroy();
        cleanupSimulation();
    });

    it('unit moves to target on open terrain', () => {
        sim = createSimulation();

        const unitId = sim.spawnUnit(20, 60);
        const target = { x: 30, y: 60 };
        expect(sim.moveUnit(unitId, target.x, target.y)).toBe(true);

        const visited = sim.simulateMovement(unitId, { target });

        expect(visited[0]).toEqual({ x: 20, y: 60 });
        expect(visited[visited.length - 1]).toEqual(target);
        expect(visited.length).toBeGreaterThan(2);
    });

    it('tile occupancy is consistent after movement', () => {
        sim = createSimulation();

        const unitId = sim.spawnUnit(20, 60);
        const startKey = tileKey(20, 60);
        expect(sim.state.tileOccupancy.get(startKey)).toBe(unitId);

        const target = { x: 30, y: 60 };
        sim.moveUnit(unitId, target.x, target.y);
        sim.simulateMovement(unitId, { target });

        const unit = sim.state.getEntityOrThrow(unitId, 'test');
        const endKey = tileKey(unit.x, unit.y);

        // Start freed, end occupied, exactly one entry for this unit
        expect(sim.state.tileOccupancy.has(startKey)).toBe(false);
        expect(sim.state.tileOccupancy.get(endKey)).toBe(unitId);

        let count = 0;
        for (const id of sim.state.tileOccupancy.values()) {
            if (id === unitId) count++;
        }
        expect(count).toBe(1);
    });

    it('unit avoids building footprint tiles', () => {
        sim = createSimulation({ mapWidth: 128, mapHeight: 128 });

        // Place two buildings — auto-placer puts them at (30,30) and (40,30)
        sim.placeBuilding(BuildingType.ResidenceSmall);
        sim.placeBuilding(BuildingType.Sawmill);

        expect(sim.state.buildingOccupancy.size).toBeGreaterThan(0);

        // Let auto-spawned workers settle at their buildings
        sim.runTicks(60);

        // Unit must cross through the building zone to reach its target
        const target = { x: 60, y: 30 };
        const unitId = sim.spawnUnit(10, 30);
        expect(sim.moveUnit(unitId, target.x, target.y)).toBe(true);

        const visited = sim.simulateMovement(unitId, { target, maxTicks: 1200 });

        expect(visited[visited.length - 1]).toEqual(target);
        assertAvoidedFootprints(visited, sim.state.buildingOccupancy);
    });

    it('unit reaches building via its door tile', () => {
        sim = createSimulation({ mapWidth: 128, mapHeight: 128 });

        const buildingId = sim.placeBuilding(BuildingType.WoodcutterHut);
        const building = sim.state.getEntityOrThrow(buildingId, 'test');
        const door = getBuildingDoorPos(building.x, building.y, Race.Roman, BuildingType.WoodcutterHut);

        // Door tile must NOT be in buildingOccupancy — passable for units
        expect(sim.state.buildingOccupancy.has(tileKey(door.x, door.y))).toBe(false);

        // Let auto-spawned worker settle
        sim.runTicks(60);

        // Spawn unit to the side of the building and move to the door
        const target = { x: door.x, y: door.y };
        const unitId = sim.spawnUnit(door.x - 10, door.y);
        expect(sim.moveUnit(unitId, target.x, target.y)).toBe(true);

        const visited = sim.simulateMovement(unitId, { target, maxTicks: 1200 });

        expect(visited[visited.length - 1]).toEqual(target);
        assertAvoidedFootprints(visited, sim.state.buildingOccupancy);
    });

    it('unit navigates between multiple buildings without crossing footprints', () => {
        sim = createSimulation({ mapWidth: 128, mapHeight: 128, buildingSpacing: 12 });

        sim.placeBuilding(BuildingType.ResidenceSmall);
        sim.placeBuilding(BuildingType.WoodcutterHut);
        sim.placeBuilding(BuildingType.Sawmill);
        sim.placeBuilding(BuildingType.StorageArea);

        // Let auto-spawned workers/carriers settle
        sim.runTicks(60);

        const target = { x: 70, y: 50 };
        const unitId = sim.spawnUnit(10, 30);
        expect(sim.moveUnit(unitId, target.x, target.y)).toBe(true);

        const visited = sim.simulateMovement(unitId, { target, maxTicks: 1200 });

        expect(visited[visited.length - 1]).toEqual(target);
        assertAvoidedFootprints(visited, sim.state.buildingOccupancy);
    });

    it('unit avoids water and finds alternative route', () => {
        sim = createSimulation();

        // Terrain is modified in-place on the same Uint8Array — pathfinder sees it immediately
        blockColumnWithGap(sim.map, 60, 50);

        const target = { x: 65, y: 55 };
        const unitId = sim.spawnUnit(55, 55);
        expect(sim.moveUnit(unitId, target.x, target.y)).toBe(true);

        const visited = sim.simulateMovement(unitId, { target });

        expect(visited[visited.length - 1]).toEqual(target);

        // Path must go through the gap at (60, 50)
        const usesGap = visited.some(p => p.x === 60 && p.y === 50);
        expect(usesGap).toBe(true);

        assertAllPassable(visited, sim.map.groundType, sim.map.mapSize.width);
    });

    it('all visited tiles are passable when detouring around water', () => {
        sim = createSimulation();

        // Water patch blocking the direct route
        for (let x = 58; x <= 68; x++) {
            for (let y = 60; y <= 64; y++) {
                setTerrainAt(sim.map, x, y, TERRAIN.WATER);
            }
        }

        const target = { x: 72, y: 62 };
        const unitId = sim.spawnUnit(55, 62);
        expect(sim.moveUnit(unitId, target.x, target.y)).toBe(true);

        const visited = sim.simulateMovement(unitId, { target, maxTicks: 1200 });

        expect(visited[visited.length - 1]).toEqual(target);
        assertAllPassable(visited, sim.map.groundType, sim.map.mapSize.width);
    });

    it('unit avoids both water and building obstacles simultaneously', () => {
        sim = createSimulation({ mapWidth: 128, mapHeight: 128 });

        // Water blocking the southern route
        for (let x = 35; x <= 50; x++) {
            setTerrainAt(sim.map, x, 45, TERRAIN.WATER);
            setTerrainAt(sim.map, x, 46, TERRAIN.WATER);
        }

        // Buildings blocking part of the northern route
        sim.placeBuilding(BuildingType.ResidenceSmall);
        sim.placeBuilding(BuildingType.Sawmill);

        sim.runTicks(60);

        const target = { x: 60, y: 40 };
        const unitId = sim.spawnUnit(20, 40);
        expect(sim.moveUnit(unitId, target.x, target.y)).toBe(true);

        const visited = sim.simulateMovement(unitId, { target, maxTicks: 1200 });

        expect(visited[visited.length - 1]).toEqual(target);
        assertAvoidedFootprints(visited, sim.state.buildingOccupancy);
        assertAllPassable(visited, sim.map.groundType, sim.map.mapSize.width);
    });

    // ─── Tight building spacing (10-tile gap, real footprints) ─────────

    it('A* finds path between two completed buildings at 10-tile spacing', () => {
        sim = createSimulation({ buildingSpacing: 10 });

        // Use non-residential buildings to avoid spawning carriers
        sim.placeBuilding(BuildingType.Sawmill); // slot 0 → (30,30)
        sim.placeBuilding(BuildingType.StorageArea); // slot 1 → (40,30)

        // Pathfinding must succeed across the gap between buildings
        const unitId = sim.spawnUnit(10, 30);
        expect(sim.moveUnit(unitId, 60, 30)).toBe(true);
    });

    it('clearBuildingFootprintBlock removes all construction site tiles', () => {
        sim = createSimulation({ buildingSpacing: 20 });

        const siteId = sim.placeBuilding(BuildingType.WoodcutterHut, 0, false);
        const building = sim.state.getEntityOrThrow(siteId, 'test');

        // Every tile in the construction site footprint should NOT be in buildingOccupancy
        const footprint = getBuildingFootprint(building.x, building.y, building.subType, building.race);
        const leaked: string[] = [];
        for (const tile of footprint) {
            if (sim.state.buildingOccupancy.has(tileKey(tile.x, tile.y))) {
                leaked.push(`(${tile.x},${tile.y})`);
            }
        }
        expect(leaked, `tiles still in buildingOccupancy: ${leaked.join(', ')}`).toHaveLength(0);
    });

    it('A* finds path to construction site door at 20-tile spacing', () => {
        sim = createSimulation({ buildingSpacing: 20 });

        sim.placeBuilding(BuildingType.Sawmill); // slot 0 → (30,30)
        const siteId = sim.placeBuilding(BuildingType.WoodcutterHut, 0, false); // slot 1 → (50,30)

        const site = sim.state.getEntityOrThrow(siteId, 'test');
        const door = getBuildingDoorPos(site.x, site.y, site.race, site.subType as BuildingType);

        // Pathfinding must succeed to the construction site's door
        const unitId = sim.spawnUnit(10, 30);
        expect(sim.moveUnit(unitId, door.x, door.y)).toBe(true);
    });

    it('pathfinding fails for unreachable target', () => {
        sim = createSimulation();

        // Impenetrable double water wall
        for (let y = 0; y < sim.map.mapSize.height; y++) {
            setTerrainAt(sim.map, 60, y, TERRAIN.WATER);
            setTerrainAt(sim.map, 61, y, TERRAIN.WATER);
        }

        const unitId = sim.spawnUnit(50, 50);
        expect(sim.moveUnit(unitId, 70, 50)).toBe(false);
    });

    it('two units moving to different targets both arrive', () => {
        sim = createSimulation();

        const u1 = sim.spawnUnit(20, 50);
        const u2 = sim.spawnUnit(20, 70);

        const t1 = { x: 40, y: 50 };
        const t2 = { x: 40, y: 70 };
        sim.moveUnit(u1, t1.x, t1.y);
        sim.moveUnit(u2, t2.x, t2.y);

        // Tick until both arrive
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

        // Distinct occupancy
        expect(sim.state.tileOccupancy.get(tileKey(40, 50))).toBe(u1);
        expect(sim.state.tileOccupancy.get(tileKey(40, 70))).toBe(u2);
    });
});
