/**
 * Integration tests for tower garrison.
 *
 * All garrison operations are driven via the same commands the UI uses.
 * Tests cover:
 *   - Swordsman / bowman walk to tower and become hidden (garrisoned)
 *   - Multiple units fill their respective role slots
 *   - Swordsman slots are filled before bowman slots (command ordering)
 *   - Excess units beyond slot capacity are rejected
 *   - Non-military units (Carrier) cannot garrison
 *   - Unit already en-route to the same tower is not doubled up
 *   - Garrison fails for non-garrison buildings
 *   - garrison_selected_units: uses tile coords, clears selection on success
 *   - Ejected unit becomes visible at approach tile
 *   - Cannot eject the last garrisoned unit
 *   - Can eject last swordsman when bowmen remain (total > 1)
 *   - Tower removal ejects all garrisoned units
 *   - Full tower rejects additional units
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

function garrisonSelected(sim: Simulation, buildingId: number) {
    const building = sim.state.getEntityOrThrow(buildingId, 'garrisonSelected');
    return sim.execute({ type: 'garrison_selected_units', tileX: building.x, tileY: building.y });
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

// ─── Basic garrison (garrison_units) ──────────────────────────────────────

describe('Tower garrison – basic garrison_units', { timeout: 30_000 }, () => {
    let sim: Simulation;

    afterEach(() => {
        sim?.destroy();
        cleanupSimulation();
    });

    it('swordsman walks to tower and becomes hidden in swordsman slot', () => {
        sim = createSimulation();
        const towerId = sim.placeBuilding(BuildingType.GuardTowerSmall);
        const swordsmanId = sim.spawnUnitNear(towerId, UnitType.Swordsman1)[0]!;

        const result = garrisonUnits(sim, towerId, [swordsmanId]);
        expect(result.success).toBe(true);

        waitForGarrisoned(sim, towerId, 1, 'swordsman garrisoned');

        expect(garrisonedCount(sim, towerId)).toBe(1);
        expect(getGarrison(sim, towerId).swordsmanSlots.unitIds).toContain(swordsmanId);
        expect(getGarrison(sim, towerId).bowmanSlots.unitIds).toHaveLength(0);
        expect(isHidden(sim, swordsmanId)).toBe(true);
        expect(sim.errors).toHaveLength(0);
    });

    it('bowman walks to tower and fills bowman slot', () => {
        sim = createSimulation();
        const towerId = sim.placeBuilding(BuildingType.GuardTowerSmall);
        const bowmanId = sim.spawnUnitNear(towerId, UnitType.Bowman1)[0]!;

        const result = garrisonUnits(sim, towerId, [bowmanId]);
        expect(result.success).toBe(true);

        waitForGarrisoned(sim, towerId, 1, 'bowman garrisoned');

        expect(getGarrison(sim, towerId).bowmanSlots.unitIds).toContain(bowmanId);
        expect(getGarrison(sim, towerId).swordsmanSlots.unitIds).toHaveLength(0);
        expect(isHidden(sim, bowmanId)).toBe(true);
        expect(sim.errors).toHaveLength(0);
    });

    it('multiple units fill their respective role slots', () => {
        sim = createSimulation();
        const towerId = sim.placeBuilding(BuildingType.GuardTowerSmall);
        const swordsmanId = sim.spawnUnitNear(towerId, UnitType.Swordsman1)[0]!;
        const [bowman1Id, bowman2Id] = sim.spawnUnitNear(towerId, UnitType.Bowman1, 2);

        const result = garrisonUnits(sim, towerId, [swordsmanId, bowman1Id!, bowman2Id!]);
        expect(result.success).toBe(true);

        waitForGarrisoned(sim, towerId, 3, 'tower fully garrisoned');

        const g = getGarrison(sim, towerId);
        expect(g.swordsmanSlots.unitIds).toHaveLength(1);
        expect(g.bowmanSlots.unitIds).toHaveLength(2);
        expect(g.swordsmanSlots.unitIds).toContain(swordsmanId);
        expect(sim.errors).toHaveLength(0);
    });

    it('units are sorted into correct slots regardless of command order', () => {
        sim = createSimulation();
        const towerId = sim.placeBuilding(BuildingType.GuardTowerSmall);
        const bowmanId = sim.spawnUnitNear(towerId, UnitType.Bowman1)[0]!;
        const swordsmanId = sim.spawnUnitNear(towerId, UnitType.Swordsman1)[0]!;

        const result = garrisonUnits(sim, towerId, [bowmanId, swordsmanId]);
        expect(result.success).toBe(true);

        waitForGarrisoned(sim, towerId, 2, 'two units garrisoned');

        const g = getGarrison(sim, towerId);
        expect(g.swordsmanSlots.unitIds).toContain(swordsmanId);
        expect(g.bowmanSlots.unitIds).toContain(bowmanId);
        expect(sim.errors).toHaveLength(0);
    });

    it('excess swordsmen beyond slot capacity are rejected', () => {
        sim = createSimulation();
        const towerId = sim.placeBuilding(BuildingType.GuardTowerSmall);
        const [sw1, sw2, sw3] = sim.spawnUnitNear(towerId, UnitType.Swordsman1, 3);

        const result = garrisonUnits(sim, towerId, [sw1!, sw2!, sw3!]);
        expect(result.success).toBe(true);

        waitForGarrisoned(sim, towerId, 1, 'one swordsman garrisoned');

        expect(garrisonedCount(sim, towerId)).toBe(1);
        expect(sim.errors).toHaveLength(0);
    });

    it('non-military unit (Carrier) cannot garrison', () => {
        sim = createSimulation();
        const towerId = sim.placeBuilding(BuildingType.GuardTowerSmall);
        const carrierId = sim.spawnUnitNear(towerId, UnitType.Carrier)[0]!;

        const result = garrisonUnits(sim, towerId, [carrierId]);
        expect(result.success).toBe(false);
        expect(garrisonedCount(sim, towerId)).toBe(0);
    });

    it('unit already en-route to tower is not sent a second time', () => {
        sim = createSimulation();
        const towerId = sim.placeBuilding(BuildingType.GuardTowerSmall);
        const swordsmanId = sim.spawnUnitNear(towerId, UnitType.Swordsman1)[0]!;

        garrisonUnits(sim, towerId, [swordsmanId]);
        expect(sim.services.garrisonManager.isEnRoute(swordsmanId)).toBe(true);

        const result = garrisonUnits(sim, towerId, [swordsmanId]);
        expect(result.success).toBe(false);
    });

    it('garrison fails for non-garrison building', () => {
        sim = createSimulation();
        const hut = sim.placeBuilding(BuildingType.WoodcutterHut);
        const swordsmanId = sim.spawnUnitNear(hut, UnitType.Swordsman1)[0]!;

        const result = garrisonUnits(sim, hut, [swordsmanId]);
        expect(result.success).toBe(false);
    });

    it('full tower rejects additional garrison command', () => {
        sim = createSimulation();
        const towerId = sim.placeBuilding(BuildingType.GuardTowerSmall);
        const swordsmanId = sim.spawnUnitNear(towerId, UnitType.Swordsman1)[0]!;
        const [bw1, bw2] = sim.spawnUnitNear(towerId, UnitType.Bowman1, 2);

        garrisonUnits(sim, towerId, [swordsmanId, bw1!, bw2!]);
        waitForGarrisoned(sim, towerId, 3, 'tower fully garrisoned');

        const extraId = sim.spawnUnitNear(towerId, UnitType.Swordsman1)[0]!;
        const result = garrisonUnits(sim, towerId, [extraId]);
        expect(result.success).toBe(false);
        expect(garrisonedCount(sim, towerId)).toBe(3);
        expect(sim.errors).toHaveLength(0);
    });
});

// ─── garrison_selected_units ───────────────────────────────────────────────

describe('Tower garrison – garrison_selected_units', { timeout: 30_000 }, () => {
    let sim: Simulation;

    afterEach(() => {
        sim?.destroy();
        cleanupSimulation();
    });

    it('garrisons selected military unit into tower at clicked tile', () => {
        sim = createSimulation();
        const towerId = sim.placeBuilding(BuildingType.GuardTowerSmall);
        const swordsmanId = sim.spawnUnitNear(towerId, UnitType.Swordsman1)[0]!;

        sim.execute({ type: 'select', entityId: swordsmanId });
        const result = garrisonSelected(sim, towerId);
        expect(result.success).toBe(true);

        waitForGarrisoned(sim, towerId, 1, 'selected unit garrisoned');
        expect(garrisonedCount(sim, towerId)).toBe(1);
        expect(sim.errors).toHaveLength(0);
    });

    it('clears selection on success', () => {
        sim = createSimulation();
        const towerId = sim.placeBuilding(BuildingType.GuardTowerSmall);
        const swordsmanId = sim.spawnUnitNear(towerId, UnitType.Swordsman1)[0]!;

        sim.execute({ type: 'select', entityId: swordsmanId });
        expect(sim.state.selection.selectedEntityId).toBe(swordsmanId);

        garrisonSelected(sim, towerId);

        expect(sim.state.selection.selectedEntityId).toBeNull();
        expect(sim.state.selection.selectedEntityIds.size).toBe(0);
        expect(sim.errors).toHaveLength(0);
    });

    it('fails silently for non-garrison building tile', () => {
        sim = createSimulation();
        const hut = sim.placeBuilding(BuildingType.WoodcutterHut);
        const swordsmanId = sim.spawnUnitNear(hut, UnitType.Swordsman1)[0]!;

        sim.execute({ type: 'select', entityId: swordsmanId });
        const result = garrisonSelected(sim, hut);
        expect(result.success).toBe(false);
        expect(sim.state.selection.selectedEntityId).toBe(swordsmanId);
    });

    it('fails silently on empty tile', () => {
        sim = createSimulation();
        const swordsmanId = sim.spawnUnit({ x: 64, y: 64 }, UnitType.Swordsman1);

        sim.execute({ type: 'select', entityId: swordsmanId });
        const result = sim.execute({ type: 'garrison_selected_units', tileX: 70, tileY: 70 });
        expect(result.success).toBe(false);
    });

    it('fails when only non-military units are selected', () => {
        sim = createSimulation();
        const towerId = sim.placeBuilding(BuildingType.GuardTowerSmall);
        const carrierId = sim.spawnUnitNear(towerId, UnitType.Carrier)[0]!;

        sim.execute({ type: 'select', entityId: carrierId });
        const result = garrisonSelected(sim, towerId);
        expect(result.success).toBe(false);
        expect(garrisonedCount(sim, towerId)).toBe(0);
    });

    it('garrisons multiple selected military units at once', () => {
        sim = createSimulation();
        const towerId = sim.placeBuilding(BuildingType.GuardTowerSmall);
        const swordsmanId = sim.spawnUnitNear(towerId, UnitType.Swordsman1)[0]!;
        const bowmanId = sim.spawnUnitNear(towerId, UnitType.Bowman1)[0]!;

        sim.execute({ type: 'select_multiple', entityIds: [swordsmanId, bowmanId] });
        const result = garrisonSelected(sim, towerId);
        expect(result.success).toBe(true);

        waitForGarrisoned(sim, towerId, 2, 'both selected units garrisoned');
        expect(garrisonedCount(sim, towerId)).toBe(2);
        expect(sim.errors).toHaveLength(0);
    });
});

// ─── Ungarrison & building lifecycle ───────────────────────────────────────

describe('Tower garrison – ungarrison & lifecycle', { timeout: 30_000 }, () => {
    let sim: Simulation;

    afterEach(() => {
        sim?.destroy();
        cleanupSimulation();
    });

    it('ejected unit becomes visible near the tower', () => {
        sim = createSimulation();
        const towerId = sim.placeBuilding(BuildingType.GuardTowerSmall);
        const swordsmanId = sim.spawnUnitNear(towerId, UnitType.Swordsman1)[0]!;
        const bowmanId = sim.spawnUnitNear(towerId, UnitType.Bowman1)[0]!;

        garrisonUnits(sim, towerId, [swordsmanId, bowmanId]);
        waitForGarrisoned(sim, towerId, 2, 'both garrisoned');

        const result = ungarrison(sim, towerId, swordsmanId);
        expect(result.success).toBe(true);

        expect(isHidden(sim, swordsmanId)).toBe(false);
        expect(garrisonedCount(sim, towerId)).toBe(1);
        expect(getGarrison(sim, towerId).swordsmanSlots.unitIds).toHaveLength(0);
        expect(getGarrison(sim, towerId).bowmanSlots.unitIds).toHaveLength(1);
        expect(sim.errors).toHaveLength(0);
    });

    it('cannot eject the last garrisoned unit', () => {
        sim = createSimulation();
        const towerId = sim.placeBuilding(BuildingType.GuardTowerSmall);
        const swordsmanId = sim.spawnUnitNear(towerId, UnitType.Swordsman1)[0]!;

        garrisonUnits(sim, towerId, [swordsmanId]);
        waitForGarrisoned(sim, towerId, 1, 'swordsman garrisoned');

        const result = ungarrison(sim, towerId, swordsmanId);
        expect(result.success).toBe(false);
        expect(isHidden(sim, swordsmanId)).toBe(true);
        expect(garrisonedCount(sim, towerId)).toBe(1);
        expect(sim.errors).toHaveLength(0);
    });

    it('can eject last swordsman when bowmen are still present', () => {
        sim = createSimulation();
        const towerId = sim.placeBuilding(BuildingType.GuardTowerSmall);
        const swordsmanId = sim.spawnUnitNear(towerId, UnitType.Swordsman1)[0]!;
        const [bw1, bw2] = sim.spawnUnitNear(towerId, UnitType.Bowman1, 2);

        garrisonUnits(sim, towerId, [swordsmanId, bw1!, bw2!]);
        waitForGarrisoned(sim, towerId, 3, 'fully garrisoned');

        const result = ungarrison(sim, towerId, swordsmanId);
        expect(result.success).toBe(true);
        expect(isHidden(sim, swordsmanId)).toBe(false);
        expect(getGarrison(sim, towerId).swordsmanSlots.unitIds).toHaveLength(0);
        expect(getGarrison(sim, towerId).bowmanSlots.unitIds).toHaveLength(2);
        expect(sim.errors).toHaveLength(0);
    });

    it('can eject last bowman when a swordsman is still present', () => {
        sim = createSimulation();
        const towerId = sim.placeBuilding(BuildingType.GuardTowerSmall);
        const swordsmanId = sim.spawnUnitNear(towerId, UnitType.Swordsman1)[0]!;
        const bowmanId = sim.spawnUnitNear(towerId, UnitType.Bowman1)[0]!;

        garrisonUnits(sim, towerId, [swordsmanId, bowmanId]);
        waitForGarrisoned(sim, towerId, 2, 'both garrisoned');

        const result = ungarrison(sim, towerId, bowmanId);
        expect(result.success).toBe(true);
        expect(isHidden(sim, bowmanId)).toBe(false);
        expect(getGarrison(sim, towerId).bowmanSlots.unitIds).toHaveLength(0);
        expect(getGarrison(sim, towerId).swordsmanSlots.unitIds).toHaveLength(1);
        expect(sim.errors).toHaveLength(0);
    });

    it('re-garrisoning a unit standing at the door finalizes immediately', () => {
        sim = createSimulation();
        const towerId = sim.placeBuilding(BuildingType.GuardTowerSmall);
        const swordsmanId = sim.spawnUnitNear(towerId, UnitType.Swordsman1)[0]!;
        const bowmanId = sim.spawnUnitNear(towerId, UnitType.Bowman1)[0]!;

        garrisonUnits(sim, towerId, [swordsmanId, bowmanId]);
        waitForGarrisoned(sim, towerId, 2, 'both garrisoned');

        ungarrison(sim, towerId, swordsmanId);
        expect(isHidden(sim, swordsmanId)).toBe(false);

        const result = garrisonUnits(sim, towerId, [swordsmanId]);
        expect(result.success).toBe(true);

        waitForGarrisoned(sim, towerId, 2, 're-garrisoned');

        expect(garrisonedCount(sim, towerId)).toBe(2);
        expect(getGarrison(sim, towerId).swordsmanSlots.unitIds).toContain(swordsmanId);
        expect(isHidden(sim, swordsmanId)).toBe(true);
        expect(sim.errors).toHaveLength(0);
    });

    it('destroying the tower ejects all garrisoned units', () => {
        sim = createSimulation();
        const towerId = sim.placeBuilding(BuildingType.GuardTowerSmall);
        const swordsmanId = sim.spawnUnitNear(towerId, UnitType.Swordsman1)[0]!;
        const bowmanId = sim.spawnUnitNear(towerId, UnitType.Bowman1)[0]!;

        garrisonUnits(sim, towerId, [swordsmanId, bowmanId]);
        waitForGarrisoned(sim, towerId, 2, 'both garrisoned');

        sim.execute({ type: 'remove_entity', entityId: towerId });

        expect(isHidden(sim, swordsmanId)).toBe(false);
        expect(isHidden(sim, bowmanId)).toBe(false);
        expect(sim.errors).toHaveLength(0);
    });

    it('unit spawned far from tower still garrisons', () => {
        sim = createSimulation();
        const towerId = sim.placeBuilding(BuildingType.GuardTowerSmall);

        const tower = sim.state.getEntityOrThrow(towerId, 'test');
        const unitId = sim.spawnUnit({ x: tower.x + 20, y: tower.y }, UnitType.Swordsman1);

        const result = garrisonUnits(sim, towerId, [unitId]);
        expect(result.success).toBe(true);

        waitForGarrisoned(sim, towerId, 1, 'far swordsman garrisoned');

        expect(garrisonedCount(sim, towerId)).toBe(1);
        expect(isHidden(sim, unitId)).toBe(true);
        expect(sim.errors).toHaveLength(0);
    });
});

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

    it('door tile is not in buildingOccupancy (must be walkable for approach)', () => {
        sim = createSimulation();
        const towerId = sim.placeBuilding(BuildingType.GuardTowerSmall);
        const tower = sim.state.getEntityOrThrow(towerId, 'test');

        const door = getBuildingDoorPos(tower, tower.race, tower.subType as BuildingType);

        const doorBlocked = sim.state.buildingOccupancy.has(tileKey(door));
        expect(doorBlocked).toBe(false);
    });
});
