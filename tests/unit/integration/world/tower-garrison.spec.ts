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
import { UnitType, tileKey } from '@/game/entity';
import { BuildingType } from '@/game/buildings';
import { Race } from '@/game/core/race';
import { getBuildingDoorPos } from '@/game/data/game-data-access';
import type { BuildingGarrisonState } from '@/game/features/tower-garrison/types';

const hasRealData = installRealGameData();

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

// ─── tests ───────────────────────────────────────────────────────────────────

describe.skipIf(!hasRealData)('Tower garrison (integration)', { timeout: 30_000 }, () => {
    let sim: Simulation;

    afterEach(() => {
        sim?.destroy();
        cleanupSimulation();
    });

    // ─── Basic garrison (garrison_units) ──────────────────────────────────────

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
        // GuardTowerSmall: 1 swordsman slot, 2 bowman slots
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

        // Bowman listed first, swordsman second — slots should still be correct
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
        // GuardTowerSmall has only 1 swordsman slot
        const towerId = sim.placeBuilding(BuildingType.GuardTowerSmall);
        const [sw1, sw2, sw3] = sim.spawnUnitNear(towerId, UnitType.Swordsman1, 3);

        const result = garrisonUnits(sim, towerId, [sw1!, sw2!, sw3!]);
        expect(result.success).toBe(true); // 1 accepted, 2 silently rejected

        waitForGarrisoned(sim, towerId, 1, 'one swordsman garrisoned');

        // Only 1 can garrison; others remain visible
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

        // Same unit to same tower — should be filtered out as already en-route
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
        const towerId = sim.placeBuilding(BuildingType.GuardTowerSmall); // 1 sw, 2 bw
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

    // ─── garrison_selected_units ───────────────────────────────────────────────

    it('garrison_selected_units: garrisons selected military unit into tower at clicked tile', () => {
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

    it('garrison_selected_units: clears selection on success', () => {
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

    it('garrison_selected_units: fails silently for non-garrison building tile', () => {
        sim = createSimulation();
        const hut = sim.placeBuilding(BuildingType.WoodcutterHut);
        const swordsmanId = sim.spawnUnitNear(hut, UnitType.Swordsman1)[0]!;

        sim.execute({ type: 'select', entityId: swordsmanId });
        const result = garrisonSelected(sim, hut);
        expect(result.success).toBe(false);
        expect(sim.state.selection.selectedEntityId).toBe(swordsmanId); // selection unchanged
    });

    it('garrison_selected_units: fails silently on empty tile', () => {
        sim = createSimulation();
        const swordsmanId = sim.spawnUnit(64, 64, UnitType.Swordsman1);

        sim.execute({ type: 'select', entityId: swordsmanId });
        const result = sim.execute({ type: 'garrison_selected_units', tileX: 70, tileY: 70 });
        expect(result.success).toBe(false);
    });

    it('garrison_selected_units: fails when only non-military units are selected', () => {
        sim = createSimulation();
        const towerId = sim.placeBuilding(BuildingType.GuardTowerSmall);
        const carrierId = sim.spawnUnitNear(towerId, UnitType.Carrier)[0]!;

        sim.execute({ type: 'select', entityId: carrierId });
        const result = garrisonSelected(sim, towerId);
        expect(result.success).toBe(false);
        expect(garrisonedCount(sim, towerId)).toBe(0);
    });

    it('garrison_selected_units: garrisons multiple selected military units at once', () => {
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

    // ─── Ungarrison ───────────────────────────────────────────────────────────

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
        expect(isHidden(sim, swordsmanId)).toBe(true); // still garrisoned
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

    // ─── Building lifecycle ───────────────────────────────────────────────────

    it('re-garrisoning a unit standing at the door finalizes immediately', () => {
        sim = createSimulation();
        const towerId = sim.placeBuilding(BuildingType.GuardTowerSmall);
        const swordsmanId = sim.spawnUnitNear(towerId, UnitType.Swordsman1)[0]!;
        const bowmanId = sim.spawnUnitNear(towerId, UnitType.Bowman1)[0]!;

        // Fully garrison the tower (need 2 units so we can eject one)
        garrisonUnits(sim, towerId, [swordsmanId, bowmanId]);
        waitForGarrisoned(sim, towerId, 2, 'both garrisoned');

        // Eject the swordsman — it now stands at the approach tile (door)
        ungarrison(sim, towerId, swordsmanId);
        expect(isHidden(sim, swordsmanId)).toBe(false);

        // Re-garrison the unit while it's already at the door
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

    // ─── Bug reproduction: unit far from tower ───────────────────────────────

    it('unit spawned far from tower still garrisons', () => {
        sim = createSimulation();
        const towerId = sim.placeBuilding(BuildingType.GuardTowerSmall);

        // Spawn unit 20 tiles away from tower (not adjacent like spawnUnitNear)
        const tower = sim.state.getEntityOrThrow(towerId, 'test');
        const unitId = sim.spawnUnit(tower.x + 20, tower.y, UnitType.Swordsman1);

        const result = garrisonUnits(sim, towerId, [unitId]);
        expect(result.success).toBe(true);

        waitForGarrisoned(sim, towerId, 1, 'far swordsman garrisoned');

        expect(garrisonedCount(sim, towerId)).toBe(1);
        expect(isHidden(sim, unitId)).toBe(true);
        expect(sim.errors).toHaveLength(0);
    });

    it('garrison command where pathfinding fails does not leave unit stuck en-route', () => {
        sim = createSimulation();
        const towerId = sim.placeBuilding(BuildingType.GuardTowerSmall);
        const tower = sim.state.getEntityOrThrow(towerId, 'test');

        // Create a full-width water wall between tower and unit spawn area.
        // The wall is 3 tiles thick to prevent any diagonal bypass.
        const wallY = tower.y + 8;
        for (let dy = 0; dy < 3; dy++) {
            for (let x = 0; x < sim.mapWidth; x++) {
                sim.fillTerrain(x, wallY + dy, 0, 0); // 0 = WATER
            }
        }

        // Spawn unit on the far side of the wall (on grass)
        const unitId = sim.spawnUnit(tower.x, wallY + 10, UnitType.Swordsman1);

        const result = garrisonUnits(sim, towerId, [unitId]);
        // Command may succeed (unit accepted) but pathfinding fails internally

        // Run a few ticks to let things settle
        sim.runTicks(100);

        // The unit must NOT be stuck in en-route limbo — it should be free to command
        const isEnRoute = sim.services.garrisonManager.isEnRoute(unitId);
        expect(isEnRoute).toBe(false);
        expect(isHidden(sim, unitId)).toBe(false);
    });

    it('Mayan GuardTowerBig: second soldier from right garrisons (first already inside)', () => {
        sim = createSimulation();
        (sim.state.playerRaces as Map<number, number>).set(0, Race.Mayan);

        const towerId = sim.placeBuilding(BuildingType.GuardTowerBig, 0, true, Race.Mayan);
        const tower = sim.state.getEntityOrThrow(towerId, 'test');
        const door = getBuildingDoorPos(tower.x, tower.y, tower.race, tower.subType as BuildingType);

        // First soldier: spawn near and garrison (simulates auto-garrison)
        const firstId = sim.spawnUnitNear(towerId, UnitType.Swordsman1)[0]!;
        garrisonUnits(sim, towerId, [firstId]);
        waitForGarrisoned(sim, towerId, 1, 'first soldier garrisoned');
        expect(isHidden(sim, firstId)).toBe(true);

        // Second soldier: spawn to the RIGHT and garrison manually
        const secondId = sim.spawnUnit(tower.x + 15, tower.y, UnitType.Swordsman1);

        // Capture stop position for diagnostics
        let stoppedPos: { x: number; y: number } | null = null;
        sim.eventBus.on('unit:movementStopped', ({ entityId }) => {
            if (entityId === secondId) {
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
            console.log(`[DIAG] unit stopped at (${stoppedPos?.x},${stoppedPos?.y}), now at (${u.x},${u.y})`);
            console.log(`[DIAG] chebyshev from door=${chebyshev}`);
            console.log(`[DIAG] door in buildingOccupancy=${sim.state.buildingOccupancy.has(tileKey(door.x, door.y))}`);
            console.log(`[DIAG] isEnRoute=${sim.services.garrisonManager.isEnRoute(secondId)}`);
            console.log(`[DIAG] hidden=${u.hidden}`);
            // Check what's on the door tile
            const doorOccupant = sim.state.tileOccupancy.get(tileKey(door.x, door.y));
            console.log(`[DIAG] door tileOccupancy=${doorOccupant} (tower=${towerId}, first=${firstId})`);
        }

        expect(garrisonedCount(sim, towerId)).toBe(2);
        expect(isHidden(sim, secondId)).toBe(true);
        expect(sim.errors).toHaveLength(0);
    });

    it('garrisoned unit does not ghost-block the door tile for subsequent units', () => {
        sim = createSimulation();
        const towerId = sim.placeBuilding(BuildingType.GuardTowerSmall);
        const tower = sim.state.getEntityOrThrow(towerId, 'test');
        const door = getBuildingDoorPos(tower.x, tower.y, tower.race, tower.subType as BuildingType);

        // First soldier garrisons
        const firstId = sim.spawnUnitNear(towerId, UnitType.Swordsman1)[0]!;
        garrisonUnits(sim, towerId, [firstId]);
        waitForGarrisoned(sim, towerId, 1, 'first soldier garrisoned');

        // After garrisoning: movement controller must be removed
        expect(sim.state.movement.hasController(firstId)).toBe(false);

        // After garrisoning: tileOccupancy at door must NOT show the garrisoned unit
        const doorOccupant = sim.state.tileOccupancy.get(tileKey(door.x, door.y));
        expect(doorOccupant).not.toBe(firstId);

        // Second soldier must still be able to garrison
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

        const door = getBuildingDoorPos(tower.x, tower.y, tower.race, tower.subType as BuildingType);

        // Door tile must NOT be in buildingOccupancy — units need to walk onto it
        const doorBlocked = sim.state.buildingOccupancy.has(tileKey(door.x, door.y));
        expect(doorBlocked).toBe(false);
    });
});
