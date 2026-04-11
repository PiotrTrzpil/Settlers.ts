/**
 * Garrison persistence integration tests — verify garrisoned and en-route
 * soldiers are preserved across save/load.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { createSimulation, cleanupSimulation, type Simulation } from '../../helpers/test-simulation';
import { installRealGameData } from '../../helpers/test-game-data';
import { BuildingType } from '@/game/buildings/building-type';
import { UnitType } from '@/game/entity';

installRealGameData();

// ─── Helpers ─────────────────────────────────────────────────────

function garrisonUnits(sim: Simulation, buildingId: number, unitIds: number[]) {
    return sim.execute({ type: 'garrison_units', buildingId, unitIds });
}

function garrisonedCount(sim: Simulation, buildingId: number): number {
    const g = sim.services.garrisonManager.getGarrison(buildingId);
    if (!g) return 0;
    return g.swordsmanSlots.unitIds.length + g.bowmanSlots.unitIds.length;
}

function waitForGarrisoned(sim: Simulation, buildingId: number, count: number, label: string): void {
    sim.runUntil(() => garrisonedCount(sim, buildingId) >= count, {
        maxTicks: 5_000,
        label,
        diagnose: () => `garrisoned=${garrisonedCount(sim, buildingId)}`,
    });
}

function isHidden(sim: Simulation, unitId: number): boolean {
    return sim.state.getEntityOrThrow(unitId, 'isHidden').hidden === true;
}

// ─── Tests ───────────────────────────────────────────────────────

describe('Garrison persistence', { timeout: 30_000 }, () => {
    let sim: Simulation;
    let restored: Simulation | undefined;

    afterEach(() => {
        sim?.destroy();
        restored?.destroy();
        restored = undefined;
        cleanupSimulation();
    });

    it('fully garrisoned tower preserved — slots, hidden flags, role assignment', () => {
        sim = createSimulation();
        const towerId = sim.placeBuilding(BuildingType.GuardTowerSmall);
        const swId = sim.spawnUnitNear(towerId, UnitType.Swordsman1)[0]!;
        const [bw1, bw2] = sim.spawnUnitNear(towerId, UnitType.Bowman1, 2);

        garrisonUnits(sim, towerId, [swId, bw1!, bw2!]);
        waitForGarrisoned(sim, towerId, 3, 'tower fully garrisoned');

        restored = sim.saveAndRestore(100);

        expect(garrisonedCount(restored, towerId)).toBe(3);
        const g = restored.services.garrisonManager.getGarrison(towerId)!;
        expect(g.swordsmanSlots.unitIds).toContain(swId);
        expect(g.bowmanSlots.unitIds).toHaveLength(2);
        expect(isHidden(restored, swId)).toBe(true);
        expect(isHidden(restored, bw1!)).toBe(true);
        expect(isHidden(restored, bw2!)).toBe(true);
        expect(restored.errors.length).toBe(0);
    });

    it('can garrison and ungarrison after restore', () => {
        sim = createSimulation();
        const towerId = sim.placeBuilding(BuildingType.GuardTowerSmall);
        const swId = sim.spawnUnitNear(towerId, UnitType.Swordsman1)[0]!;
        const bwId = sim.spawnUnitNear(towerId, UnitType.Bowman1)[0]!;

        garrisonUnits(sim, towerId, [swId, bwId]);
        waitForGarrisoned(sim, towerId, 2, 'both garrisoned');

        restored = sim.saveAndRestore(100);

        // Ungarrison swordsman (bowman remains — total > 1)
        expect(restored.execute({ type: 'ungarrison_unit', buildingId: towerId, unitId: swId }).success).toBe(true);
        restored.runTicks(100);
        expect(garrisonedCount(restored, towerId)).toBe(1);
        expect(isHidden(restored, swId)).toBe(false);

        // Garrison a new unit
        const sw2 = restored.spawnUnitNear(towerId, UnitType.Swordsman1)[0]!;
        garrisonUnits(restored, towerId, [sw2]);
        waitForGarrisoned(restored, towerId, 2, 'new swordsman garrisoned');
        expect(restored.errors.length).toBe(0);
    });

    it('en-route units complete garrison after restore', () => {
        sim = createSimulation();
        const towerId = sim.placeBuilding(BuildingType.GuardTowerSmall);
        const swId = sim.spawnUnitNear(towerId, UnitType.Swordsman1)[0]!;
        const [bw1, bw2] = sim.spawnUnitNear(towerId, UnitType.Bowman1, 2);

        garrisonUnits(sim, towerId, [swId, bw1!, bw2!]);
        // Minimal ticks — units dispatched but may not have arrived
        sim.runTicks(5);

        restored = sim.saveAndRestore(100);

        waitForGarrisoned(restored, towerId, 3, 'all units garrisoned after restore');
        expect(garrisonedCount(restored, towerId)).toBe(3);
        expect(restored.errors.length).toBe(0);
    });

    it('mix of garrisoned and en-route units both survive restore', () => {
        sim = createSimulation();
        const towerId = sim.placeBuilding(BuildingType.GuardTowerSmall);
        const swId = sim.spawnUnitNear(towerId, UnitType.Swordsman1)[0]!;

        garrisonUnits(sim, towerId, [swId]);
        waitForGarrisoned(sim, towerId, 1, 'swordsman garrisoned');

        // Dispatch bowman while swordsman is already inside
        const bwId = sim.spawnUnitNear(towerId, UnitType.Bowman1)[0]!;
        garrisonUnits(sim, towerId, [bwId]);
        sim.runTicks(3);

        restored = sim.saveAndRestore(100);

        waitForGarrisoned(restored, towerId, 2, 'both garrisoned after restore');
        expect(isHidden(restored, swId)).toBe(true);
        expect(isHidden(restored, bwId)).toBe(true);
        expect(restored.errors.length).toBe(0);
    });

    it('garrison survives 2 consecutive save/restore cycles', () => {
        sim = createSimulation();
        const towerId = sim.placeBuilding(BuildingType.GuardTowerSmall);
        const swId = sim.spawnUnitNear(towerId, UnitType.Swordsman1)[0]!;
        const bwId = sim.spawnUnitNear(towerId, UnitType.Bowman1)[0]!;

        garrisonUnits(sim, towerId, [swId, bwId]);
        waitForGarrisoned(sim, towerId, 2, 'both garrisoned');

        restored = sim.saveAndRestore(100);
        expect(garrisonedCount(restored, towerId)).toBe(2);

        const sim2 = restored.saveAndRestore(100);
        restored.destroy();
        restored = sim2;

        expect(garrisonedCount(restored, towerId)).toBe(2);
        expect(isHidden(restored, swId)).toBe(true);
        expect(isHidden(restored, bwId)).toBe(true);
        expect(restored.errors.length).toBe(0);
    });

    it('multiple towers each preserve their garrison independently', () => {
        sim = createSimulation();
        const t1 = sim.placeBuilding(BuildingType.GuardTowerSmall);
        const t2 = sim.placeBuilding(BuildingType.GuardTowerSmall);
        const sw1 = sim.spawnUnitNear(t1, UnitType.Swordsman1)[0]!;
        const sw2 = sim.spawnUnitNear(t2, UnitType.Swordsman1)[0]!;

        garrisonUnits(sim, t1, [sw1]);
        garrisonUnits(sim, t2, [sw2]);
        waitForGarrisoned(sim, t1, 1, 'tower1');
        waitForGarrisoned(sim, t2, 1, 'tower2');

        restored = sim.saveAndRestore(100);

        expect(garrisonedCount(restored, t1)).toBe(1);
        expect(garrisonedCount(restored, t2)).toBe(1);
        expect(restored.services.garrisonManager.getGarrison(t1)!.swordsmanSlots.unitIds).toContain(sw1);
        expect(restored.services.garrisonManager.getGarrison(t2)!.swordsmanSlots.unitIds).toContain(sw2);
        expect(restored.errors.length).toBe(0);
    });
});
