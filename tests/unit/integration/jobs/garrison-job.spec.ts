/**
 * Garrison job ownership — en-route units run an owned `Garrison` job, garrisoned units are
 * `Garrison` holds (docs/designs/job-ownership.md, "Garrison migration").
 *
 * Covers: commitments while walking / inside, save mid-walk and while garrisoned (the job resumes
 * by itself, slots rebuilt from holds), unit killed en route and inside, tower destroyed.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { createSimulation, cleanupSimulation, type Simulation } from '../../helpers/test-simulation';
import { installRealGameData } from '../../helpers/test-game-data';
import { BuildingType } from '@/game/buildings/building-type';
import { UnitType } from '@/game/entity';
import { JobKind } from '@/game/systems/choreo';

installRealGameData();

function garrisonUnits(sim: Simulation, buildingId: number, unitIds: number[]): boolean {
    return sim.execute({ type: 'garrison_units', buildingId, unitIds }).success;
}

function garrisonedIds(sim: Simulation, buildingId: number): number[] {
    const g = sim.services.garrisonManager.getGarrison(buildingId)!;
    return [...g.swordsmanSlots.unitIds, ...g.bowmanSlots.unitIds];
}

function waitForGarrisoned(sim: Simulation, buildingId: number, count: number, label: string): void {
    sim.runUntil(() => garrisonedIds(sim, buildingId).length >= count, {
        maxTicks: 5_000,
        label,
        diagnose: () => `garrisoned=[${garrisonedIds(sim, buildingId).join(',')}]`,
    });
}

/** Spawn a unit a few tiles from the tower, so a dispatch walks for a while. */
function spawnAway(sim: Simulation, towerId: number, unitType: UnitType): number {
    const tower = sim.state.getEntityOrThrow(towerId, 'tower');
    return sim.spawnUnit({ x: tower.x + 8, y: tower.y + 8 }, unitType);
}

/** Place a small tower and a swordsman a few tiles away, dispatched but not arrived yet. */
function dispatchSwordsman(sim: Simulation): { towerId: number; unitId: number } {
    const towerId = sim.placeBuilding(BuildingType.GuardTowerSmall);
    const unitId = spawnAway(sim, towerId, UnitType.Swordsman1);
    expect(garrisonUnits(sim, towerId, [unitId])).toBe(true);
    sim.runTicks(3);
    expect(garrisonedIds(sim, towerId)).not.toContain(unitId);
    return { towerId, unitId };
}

describe('Garrison job ownership', { timeout: 30_000 }, () => {
    let sim: Simulation;
    let restored: Simulation | undefined;

    afterEach(() => {
        sim?.destroy();
        restored?.destroy();
        restored = undefined;
        cleanupSimulation();
    });

    it('en route = reserved Garrison job; garrisoned = reserved Garrison hold', () => {
        sim = createSimulation();
        const { towerId, unitId } = dispatchSwordsman(sim);

        expect(sim.services.unitCommitments.get(unitId)).toEqual({
            owner: JobKind.Garrison,
            ref: towerId,
            reserved: true,
            hasJob: true,
        });
        expect(sim.services.garrisonManager.isEnRoute(unitId)).toBe(true);

        waitForGarrisoned(sim, towerId, 1, 'swordsman garrisoned');
        expect(sim.services.unitCommitments.get(unitId)).toEqual({
            owner: JobKind.Garrison,
            ref: towerId,
            reserved: true,
            hasJob: false,
        });
        expect(sim.services.garrisonManager.isEnRoute(unitId)).toBe(false);
        expect(sim.errors).toHaveLength(0);
    });

    it('ungarrisoned unit is idle again', () => {
        sim = createSimulation();
        const towerId = sim.placeBuilding(BuildingType.GuardTowerSmall);
        const sw = sim.spawnUnitNear(towerId, UnitType.Swordsman1)[0]!;
        const bw = sim.spawnUnitNear(towerId, UnitType.Bowman1)[0]!;
        garrisonUnits(sim, towerId, [sw, bw]);
        waitForGarrisoned(sim, towerId, 2, 'both garrisoned');

        expect(sim.execute({ type: 'ungarrison_unit', buildingId: towerId, unitId: sw }).success).toBe(true);
        expect(sim.services.unitCommitments.isIdle(sw)).toBe(true);
        expect(sim.errors).toHaveLength(0);
    });

    it('saved mid-walk: the Garrison job resumes by itself and the unit garrisons once', () => {
        sim = createSimulation();
        const { towerId, unitId } = dispatchSwordsman(sim);
        let entered = 0;

        restored = sim.saveAndRestore(0);
        restored.eventBus.on('garrison:unitEntered', () => entered++);
        expect(restored.services.unitCommitments.get(unitId)).toMatchObject({
            owner: JobKind.Garrison,
            ref: towerId,
            hasJob: true,
        });
        expect(restored.services.garrisonManager.isEnRoute(unitId)).toBe(true);

        waitForGarrisoned(restored, towerId, 1, 'garrisoned after restore');
        restored.runTicks(100);
        expect(garrisonedIds(restored, towerId)).toEqual([unitId]);
        expect(entered).toBe(1);
        expect(restored.services.unitCommitments.get(unitId)).toMatchObject({ hasJob: false, reserved: true });
        expect(restored.errors).toHaveLength(0);
    });

    it('saved while garrisoned: slots are rebuilt from the holds', () => {
        sim = createSimulation();
        const towerId = sim.placeBuilding(BuildingType.GuardTowerBig);
        const swords = sim.spawnUnitNear(towerId, UnitType.Swordsman1, 2);
        const bows = sim.spawnUnitNear(towerId, UnitType.Bowman1, 2);
        garrisonUnits(sim, towerId, [...swords, ...bows]);
        waitForGarrisoned(sim, towerId, 4, 'all garrisoned');

        restored = sim.saveAndRestore(10);

        const g = restored.services.garrisonManager.getGarrison(towerId)!;
        expect([...g.swordsmanSlots.unitIds].sort((a, b) => a - b)).toEqual([...swords].sort((a, b) => a - b));
        expect([...g.bowmanSlots.unitIds].sort((a, b) => a - b)).toEqual([...bows].sort((a, b) => a - b));
        for (const id of [...swords, ...bows]) {
            expect(restored.services.unitCommitments.get(id)).toEqual({
                owner: JobKind.Garrison,
                ref: towerId,
                reserved: true,
                hasJob: false,
            });
        }
        expect(restored.errors).toHaveLength(0);
    });

    it('unit killed en route frees the slot for another unit', () => {
        sim = createSimulation();
        const { towerId, unitId } = dispatchSwordsman(sim);
        // The only swordsman slot is committed to the walking unit.
        const second = spawnAway(sim, towerId, UnitType.Swordsman1);
        expect(garrisonUnits(sim, towerId, [second])).toBe(false);

        sim.killUnit(unitId);

        expect(sim.services.garrisonManager.getEnRouteSlotCounts(towerId)).toEqual({ swordsman: 0, bowman: 0 });
        expect(garrisonUnits(sim, towerId, [second])).toBe(true);
        waitForGarrisoned(sim, towerId, 1, 'second swordsman garrisoned');
        expect(garrisonedIds(sim, towerId)).toEqual([second]);
        expect(sim.errors).toHaveLength(0);
    });

    it('unit killed while garrisoned frees its slot', () => {
        sim = createSimulation();
        const towerId = sim.placeBuilding(BuildingType.GuardTowerSmall);
        const sw = sim.spawnUnitNear(towerId, UnitType.Swordsman1)[0]!;
        const bw = sim.spawnUnitNear(towerId, UnitType.Bowman1)[0]!;
        garrisonUnits(sim, towerId, [sw, bw]);
        waitForGarrisoned(sim, towerId, 2, 'both garrisoned');

        sim.killUnit(sw);

        expect(garrisonedIds(sim, towerId)).toEqual([bw]);
        expect(sim.services.unitCommitments.unitsOwnedBy(JobKind.Garrison, towerId)).toEqual([bw]);
        expect(sim.errors).toHaveLength(0);
    });

    it('tower destroyed: en-route and garrisoned units become idle', () => {
        sim = createSimulation();
        const towerId = sim.placeBuilding(BuildingType.GuardTowerSmall);
        const bw = sim.spawnUnitNear(towerId, UnitType.Bowman1)[0]!;
        garrisonUnits(sim, towerId, [bw]);
        waitForGarrisoned(sim, towerId, 1, 'bowman garrisoned');
        const sw = spawnAway(sim, towerId, UnitType.Swordsman1);
        expect(garrisonUnits(sim, towerId, [sw])).toBe(true);
        sim.runTicks(3);
        expect(sim.services.garrisonManager.isEnRoute(sw)).toBe(true);

        sim.removeBuilding(towerId);
        sim.runTicks(10);

        for (const id of [sw, bw]) {
            expect(sim.services.unitCommitments.isIdle(id)).toBe(true);
            expect(sim.state.getEntityOrThrow(id, 'unit').hidden).toBeFalsy();
        }
        expect(sim.errors).toHaveLength(0);
    });
});
