/**
 * Integration tests for tower garrison — edge cases.
 *
 * Covers pathfinding failures, race-specific towers, door-tile interactions,
 * mass garrison, and save/restore mid-walk.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { Simulation, createSimulation, cleanupSimulation } from '../../helpers/test-simulation';
import { installRealGameData } from '../../helpers/test-game-data';
import { UnitType, tileKey, Tile } from '@/game/entity';
import { BuildingType } from '@/game/buildings';
import { Race } from '@/game/core/race';
import { getBuildingDoorPos } from '@/game/data/game-data-access';
import type { BuildingGarrisonState } from '@/game/features/tower-garrison/types';

installRealGameData();

// ─── helpers ─────────────────────────────────────────────────────────────────

function garrisonUnits(sim: Simulation, buildingId: number, unitIds: number[]) {
    return sim.execute({ type: 'garrison_units', buildingId, unitIds });
}

function ungarrison(sim: Simulation, buildingId: number, unitId: number) {
    return sim.execute({ type: 'ungarrison_unit', buildingId, unitId });
}

function getGarrison(sim: Simulation, buildingId: number): BuildingGarrisonState {
    return sim.services.garrisonManager.getGarrison(buildingId)!;
}

function garrisonedCount(sim: Simulation, buildingId: number): number {
    const g = sim.services.garrisonManager.getGarrison(buildingId);
    if (!g) return 0;
    return g.swordsmanSlots.unitIds.length + g.bowmanSlots.unitIds.length;
}

function isHidden(sim: Simulation, unitId: number): boolean {
    return sim.state.getEntityOrThrow(unitId, 'isHidden').hidden === true;
}

function waitForGarrisoned(sim: Simulation, buildingId: number, count: number, label: string): void {
    sim.runUntil(() => garrisonedCount(sim, buildingId) >= count, {
        maxTicks: 5_000,
        label,
        diagnose: () => {
            const g = sim.services.garrisonManager.getGarrison(buildingId);
            const sw = g?.swordsmanSlots.unitIds.length ?? 0;
            const bw = g?.bowmanSlots.unitIds.length ?? 0;
            return `garrisoned=${sw + bw} (sw=${sw}, bw=${bw})`;
        },
    });
}

// ─── Garrison edge cases ─────────────────────────────────────────────────────

describe('Tower garrison – garrison edge cases', { timeout: 30_000 }, () => {
    let sim: Simulation;

    afterEach(() => {
        sim?.destroy();
        cleanupSimulation();
    });

    it('garrison command where pathfinding fails does not leave unit stuck en-route', () => {
        sim = createSimulation();
        const towerId = sim.placeBuilding(BuildingType.GuardTowerSmall);
        const tower = sim.state.getEntityOrThrow(towerId, 'test');

        const wallY = tower.y + 8;
        for (let dy = 0; dy < 3; dy++) {
            for (let x = 0; x < sim.mapWidth; x++) {
                sim.fillTerrain(x, wallY + dy, 0, 0);
            }
        }

        const unitId = sim.spawnUnit({ x: tower.x, y: wallY + 10 }, UnitType.Swordsman1);

        garrisonUnits(sim, towerId, [unitId]);
        sim.runTicks(100);

        const isEnRoute = sim.services.garrisonManager.isEnRoute(unitId);
        expect(isEnRoute).toBe(false);
        expect(isHidden(sim, unitId)).toBe(false);
    });

    it('garrison pathfinding failure does not retry — gives up after 1 attempt', () => {
        sim = createSimulation();
        sim.state.movement.verbose = true;

        const towerId = sim.placeBuilding(BuildingType.GuardTowerSmall);
        const tower = sim.state.getEntityOrThrow(towerId, 'test');

        const wallY = tower.y + 8;
        for (let dy = 0; dy < 3; dy++) {
            for (let x = 0; x < sim.mapWidth; x++) {
                sim.fillTerrain(x, wallY + dy, 0, 0);
            }
        }

        const unitId = sim.spawnUnit({ x: tower.x, y: wallY + 10 }, UnitType.Swordsman1);

        let pathFailCount = 0;
        sim.eventBus.on('movement:pathFailed', ({ unitId: id }) => {
            if (id === unitId) pathFailCount++;
        });

        garrisonUnits(sim, towerId, [unitId]);
        sim.runTicks(100);

        expect(pathFailCount).toBe(1);
    });

    it('Mayan GuardTowerBig: second soldier from right garrisons (first already inside)', () => {
        sim = createSimulation();
        (sim.state.playerRaces as Map<number, Race>).set(0, Race.Mayan);

        const towerId = sim.placeBuilding(BuildingType.GuardTowerBig, 0, true, Race.Mayan);
        const tower = sim.state.getEntityOrThrow(towerId, 'test');
        const door = getBuildingDoorPos(tower, tower.race, tower.subType as BuildingType);

        const firstId = sim.spawnUnitNear(towerId, UnitType.Swordsman1)[0]!;
        garrisonUnits(sim, towerId, [firstId]);
        waitForGarrisoned(sim, towerId, 1, 'first soldier garrisoned');
        expect(isHidden(sim, firstId)).toBe(true);

        const secondId = sim.spawnUnit({ x: tower.x + 15, y: tower.y }, UnitType.Swordsman1);

        let stoppedPos: Tile | null = null;
        sim.eventBus.on('unit:movementStopped', ({ unitId }) => {
            if (unitId === secondId) {
                const u = sim.state.getEntity(secondId);
                if (u) stoppedPos = { x: u.x, y: u.y };
            }
        });

        const result = garrisonUnits(sim, towerId, [secondId]);
        expect(result.success).toBe(true);

        waitForGarrisoned(sim, towerId, 2, 'second soldier from right garrisoned');

        if (garrisonedCount(sim, towerId) < 2) {
            const u = sim.state.getEntityOrThrow(secondId, 'diag');
            const chebyshev = Math.max(Math.abs(u.x - door.x), Math.abs(u.y - door.y));
            console.log(`[DIAG] tower=(${tower.x},${tower.y}) door=(${door.x},${door.y})`);
            const sp = stoppedPos as Tile | null;
            console.log(`[DIAG] unit stopped at (${sp?.x},${sp?.y}), now at (${u.x},${u.y})`);
            console.log(`[DIAG] chebyshev from door=${chebyshev}`);
            console.log(`[DIAG] door in buildingOccupancy=${sim.state.buildingOccupancy.has(tileKey(door))}`);
            console.log(`[DIAG] isEnRoute=${sim.services.garrisonManager.isEnRoute(secondId)}`);
            console.log(`[DIAG] hidden=${u.hidden}`);
            const doorOccupant = sim.state.unitOccupancy.get(tileKey(door));
            console.log(`[DIAG] door unitOccupancy=${doorOccupant} (tower=${towerId}, first=${firstId})`);
        }

        expect(garrisonedCount(sim, towerId)).toBe(2);
        expect(isHidden(sim, secondId)).toBe(true);
        expect(sim.errors).toHaveLength(0);
    });

    it('garrisoned unit does not ghost-block the door tile for subsequent units', () => {
        sim = createSimulation();
        const towerId = sim.placeBuilding(BuildingType.GuardTowerSmall);
        const tower = sim.state.getEntityOrThrow(towerId, 'test');
        const door = getBuildingDoorPos(tower, tower.race, tower.subType as BuildingType);

        const firstId = sim.spawnUnitNear(towerId, UnitType.Swordsman1)[0]!;
        garrisonUnits(sim, towerId, [firstId]);
        waitForGarrisoned(sim, towerId, 1, 'first soldier garrisoned');

        expect(sim.state.movement.hasController(firstId)).toBe(false);

        const doorOccupant = sim.state.unitOccupancy.get(tileKey(door));
        expect(doorOccupant).not.toBe(firstId);

        const bowmanId = sim.spawnUnitNear(towerId, UnitType.Bowman1)[0]!;
        garrisonUnits(sim, towerId, [bowmanId]);
        waitForGarrisoned(sim, towerId, 2, 'second unit garrisoned after first');

        expect(garrisonedCount(sim, towerId)).toBe(2);
        expect(isHidden(sim, bowmanId)).toBe(true);
        expect(sim.errors).toHaveLength(0);
    });

    it('ejecting second unit bumps the first away from door — new unit appears at door', () => {
        sim = createSimulation();
        const towerId = sim.placeBuilding(BuildingType.GuardTowerSmall);
        const swordsmanId = sim.spawnUnitNear(towerId, UnitType.Swordsman1)[0]!;
        const [bw1, bw2] = sim.spawnUnitNear(towerId, UnitType.Bowman1, 2);

        garrisonUnits(sim, towerId, [swordsmanId, bw1!, bw2!]);
        waitForGarrisoned(sim, towerId, 3, 'fully garrisoned');

        const tower = sim.state.getEntityOrThrow(towerId, 'test');
        const door = getBuildingDoorPos(tower, tower.race, tower.subType as BuildingType);
        const doorKey = tileKey(door);

        // First eject — swordsman appears at door
        ungarrison(sim, towerId, swordsmanId);
        const swAfterFirst = sim.state.getEntityOrThrow(swordsmanId, 'test');
        expect(tileKey(swAfterFirst)).toBe(doorKey);

        // Second eject — bowman appears at door, swordsman is bumped away
        ungarrison(sim, towerId, bw1!);
        const sw = sim.state.getEntityOrThrow(swordsmanId, 'test');
        const bw = sim.state.getEntityOrThrow(bw1!, 'test');

        expect(tileKey(bw)).toBe(doorKey); // new unit lands on door
        expect(tileKey(sw)).not.toBe(doorKey); // previous unit was bumped off door
        expect(sim.errors).toHaveLength(0);
    });

    it('20 soldiers near door all commanded to garrison castle — 9 reach it', () => {
        sim = createSimulation();
        const castleId = sim.placeBuilding(BuildingType.Castle);

        // Spawn 20 soldiers near the castle — they'll crowd the door approach
        const swordsmen = sim.spawnUnitNear(castleId, UnitType.Swordsman1, 10);
        const bowmen = sim.spawnUnitNear(castleId, UnitType.Bowman1, 10);

        // Command all 20 to garrison at once — massive congestion at the door
        garrisonUnits(sim, castleId, [...swordsmen, ...bowmen]);

        // Castle holds 4 swordsmen + 5 bowmen = 9
        waitForGarrisoned(sim, castleId, 9, 'castle fully garrisoned with 9');

        const g = getGarrison(sim, castleId);
        expect(g.swordsmanSlots.unitIds).toHaveLength(4);
        expect(g.bowmanSlots.unitIds).toHaveLength(5);
        expect(sim.errors).toHaveLength(0);
    });

    it('20 soldiers garrison castle — save/restore mid-walk — 9 still reach it', () => {
        sim = createSimulation();
        const castleId = sim.placeBuilding(BuildingType.Castle);

        const swordsmen = sim.spawnUnitNear(castleId, UnitType.Swordsman1, 10);
        const bowmen = sim.spawnUnitNear(castleId, UnitType.Bowman1, 10);

        garrisonUnits(sim, castleId, [...swordsmen, ...bowmen]);

        // Let them start walking, then save+restore mid-approach
        sim.runTicks(20);
        expect(garrisonedCount(sim, castleId)).toBe(0); // none arrived yet
        // Verify some are actually en-route (walking toward the castle)
        const enRouteCount = [...swordsmen, ...bowmen].filter(id => sim.services.garrisonManager.isEnRoute(id)).length;
        expect(enRouteCount).toBeGreaterThan(0);

        sim = sim.saveAndRestore(0); // afterEach will destroy

        waitForGarrisoned(sim, castleId, 9, 'castle fully garrisoned after restore');

        const g = getGarrison(sim, castleId);
        expect(g.swordsmanSlots.unitIds).toHaveLength(4);
        expect(g.bowmanSlots.unitIds).toHaveLength(5);
        expect(sim.errors).toHaveLength(0);
    });

    it('door tile is not in buildingOccupancy (must be walkable for approach)', () => {
        sim = createSimulation();
        const towerId = sim.placeBuilding(BuildingType.GuardTowerSmall);
        const tower = sim.state.getEntityOrThrow(towerId, 'test');

        const door = getBuildingDoorPos(tower, tower.race, tower.subType as BuildingType);

        const doorBlocked = sim.state.buildingOccupancy.has(tileKey(door));
        expect(doorBlocked).toBe(false);
    });
});
