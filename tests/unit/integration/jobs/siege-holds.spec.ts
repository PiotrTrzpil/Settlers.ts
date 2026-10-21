/**
 * Siege participants are `'siege'` holds (docs/designs/job-ownership.md, "Readers & siege migration").
 *
 * Door attackers and the ejected defender are committed to the siege (`hold(unit, 'siege', towerId,
 * reserved)`). The siege hold owner learns of a participant's removal at COMMITMENTS priority, so a
 * defender removed outside combat (no `combat:unitDefeated`) releases the door attackers — before,
 * their reservation, busy flag and combat lock leaked forever.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { createSimulation, cleanupSimulation, type Simulation } from '../../helpers/test-simulation';
import { installRealGameData } from '../../helpers/test-game-data';
import { UnitType } from '@/game/entity';
import { BuildingType } from '@/game/buildings';
import type { SiegeState } from '@/game/features/building-siege';
import { CombatStatus } from '@/game/features/combat/combat-state';
import { JobKind } from '@/game/systems/choreo';
import { getBuildingDoorPos } from '@/game/data/game-data-access';

installRealGameData();

function getSiege(sim: Simulation, towerId: number): Readonly<SiegeState> | undefined {
    return sim.services.siegeSystem.getSiege(towerId);
}

function garrisonedCount(sim: Simulation, towerId: number): number {
    const g = sim.services.garrisonManager.getGarrison(towerId)!;
    return g.swordsmanSlots.unitIds.length + g.bowmanSlots.unitIds.length;
}

/**
 * Expect the unit to carry nothing of the siege: no siege hold, unreserved, not busy, no combat lock.
 * (An attacker joined while its walk was still ending finishes that walk as a plain 'player-move'.)
 */
function expectReleased(sim: Simulation, unitId: number): void {
    expect(sim.services.unitCommitments.unitsOwnedBy('siege')).not.toContain(unitId);
    expect(sim.services.unitCommitments.isReserved(unitId)).toBe(false);
    expect(sim.state.movement.getController(unitId)!.busy).toBe(false);
    expect(sim.services.combatSystem.isLocked(unitId)).toBe(false);
}

/**
 * Tower of player 0 with `defenderCount` garrisoned swordsmen, attacked by two strong player-1
 * swordsmen. Runs until the siege has an ejected defender and at least one door attacker.
 */
function setupSiegeWithDoorAttackers(defenderCount: number): { sim: Simulation; towerId: number } {
    const sim = createSimulation({ skipTerritory: true });
    sim.establishTerritory(0);
    sim.establishTerritory(1);

    const towerId = sim.placeBuilding(BuildingType.GuardTowerBig, 0);
    const tower = sim.state.getEntityOrThrow(towerId, 'tower');

    const defenders = sim.spawnUnitNear(towerId, UnitType.Swordsman1, defenderCount, 0);
    sim.execute({ type: 'garrison_units', buildingId: towerId, unitIds: defenders });
    sim.runUntil(() => garrisonedCount(sim, towerId) === defenderCount, { maxTicks: 5_000, label: 'garrisoned' });

    for (const dx of [5, 6]) {
        const attacker = sim.spawnUnit({ x: tower.x + dx, y: tower.y }, UnitType.Swordsman3, 1);
        sim.execute({ type: 'move_unit', entityId: attacker, targetX: tower.x, targetY: tower.y });
    }

    sim.runUntil(
        () => {
            const siege = getSiege(sim, towerId);
            return siege !== undefined && siege.activeDefenderId !== null && siege.doorAttackerIds.length > 0;
        },
        {
            maxTicks: 10_000,
            label: 'door attackers assigned',
            diagnose: () => JSON.stringify(getSiege(sim, towerId) ?? null),
        }
    );
    return { sim, towerId };
}

describe('Siege holds', { timeout: 60_000 }, () => {
    let sim: Simulation;

    afterEach(() => {
        sim?.destroy();
        cleanupSimulation();
    });

    it('door attackers and the ejected defender are reserved siege holds on the tower', () => {
        const setup = setupSiegeWithDoorAttackers(3);
        sim = setup.sim;
        const siege = getSiege(sim, setup.towerId)!;

        for (const id of [siege.activeDefenderId!, ...siege.doorAttackerIds]) {
            expect(sim.services.unitCommitments.get(id)).toEqual({
                owner: 'siege',
                ref: setup.towerId,
                reserved: true,
                hasJob: false,
            });
        }
        expect(sim.services.unitCommitments.unitsOwnedBy('siege', setup.towerId)).toEqual(
            [siege.activeDefenderId!, ...siege.doorAttackerIds].sort((a, b) => a - b)
        );
        expect(sim.errors).toHaveLength(0);
    });

    it('defender removed outside combat frees the door attackers and ejects the next defender', () => {
        const setup = setupSiegeWithDoorAttackers(3);
        sim = setup.sim;
        const siege = getSiege(sim, setup.towerId)!;
        const defenderId = siege.activeDefenderId!;
        const attackerIds = [...siege.doorAttackerIds];

        sim.killUnit(defenderId);

        for (const id of attackerIds) {
            expectReleased(sim, id);
        }
        const after = getSiege(sim, setup.towerId)!;
        expect(after.activeDefenderId).not.toBeNull();
        expect(after.activeDefenderId).not.toBe(defenderId);
        expect(after.doorAttackerIds).toEqual([]);
        expect(garrisonedCount(sim, setup.towerId)).toBe(1);
        expect(sim.errors).toHaveLength(0);
    });

    it('door attacker removed outside combat leaves the siege', () => {
        const setup = setupSiegeWithDoorAttackers(3);
        sim = setup.sim;
        const siege = getSiege(sim, setup.towerId)!;
        const attackerId = siege.doorAttackerIds[0]!;

        sim.killUnit(attackerId);

        expect(getSiege(sim, setup.towerId)!.doorAttackerIds).not.toContain(attackerId);
        expect(sim.services.unitCommitments.unitsOwnedBy('siege')).not.toContain(attackerId);
        expect(sim.errors).toHaveLength(0);
    });

    it('building removed releases every siege participant', () => {
        const setup = setupSiegeWithDoorAttackers(3);
        sim = setup.sim;
        const siege = getSiege(sim, setup.towerId)!;
        const participants = [siege.activeDefenderId!, ...siege.doorAttackerIds];

        sim.execute({ type: 'remove_entity', entityId: setup.towerId });

        expect(getSiege(sim, setup.towerId)).toBeUndefined();
        for (const id of participants) {
            expectReleased(sim, id);
        }
        expect(sim.services.unitCommitments.unitsOwnedBy('siege')).toEqual([]);
        expect(sim.errors).toHaveLength(0);
    });

    it('siege holds are not saved: participants load idle', () => {
        const setup = setupSiegeWithDoorAttackers(3);
        const siege = getSiege(setup.sim, setup.towerId)!;
        const participants = [siege.activeDefenderId!, ...siege.doorAttackerIds];

        sim = setup.sim.saveAndRestore(0);
        setup.sim.destroy();

        for (const id of participants) {
            expect(sim.services.unitCommitments.get(id)).toBeUndefined();
        }
        expect(sim.errors).toHaveLength(0);
    });

    it('a swordsman walking to garrison its own tower is not picked by the siege or by combat', () => {
        sim = createSimulation({ skipTerritory: true });
        sim.establishTerritory(0);
        sim.establishTerritory(1);

        const enemyTowerId = sim.placeBuilding(BuildingType.GuardTowerSmall, 0);
        const enemyTower = sim.state.getEntityOrThrow(enemyTowerId, 'enemy tower');
        const defenders = sim.spawnUnitNear(enemyTowerId, UnitType.Swordsman1, 1, 0);
        sim.execute({ type: 'garrison_units', buildingId: enemyTowerId, unitIds: defenders });
        sim.runUntil(() => garrisonedCount(sim, enemyTowerId) === 1, { maxTicks: 5_000, label: 'garrisoned' });

        const ownTowerId = sim.placeBuildingNear(
            { x: enemyTower.x + 14, y: enemyTower.y },
            BuildingType.GuardTowerSmall,
            1
        );
        // Right next to the enemy door — an idle swordsman here would start a siege
        const door = getBuildingDoorPos(enemyTower, enemyTower.race, enemyTower.subType as BuildingType);
        const walker = sim.spawnUnit({ x: door.x + 1, y: door.y + 1 }, UnitType.Swordsman1, 1);
        // A defenseless enemy next to the walker — an idle swordsman would engage it
        sim.spawnUnit({ x: door.x + 2, y: door.y + 1 }, UnitType.Geologist, 0);

        sim.execute({ type: 'garrison_units', buildingId: ownTowerId, unitIds: [walker] });
        expect(sim.services.unitCommitments.get(walker)).toMatchObject({ owner: JobKind.Garrison, reserved: true });

        sim.runUntil(
            () => {
                expect(sim.services.unitCommitments.unitsOwnedBy('siege')).not.toContain(walker);
                expect(getSiege(sim, enemyTowerId)).toBeUndefined();
                const combat = sim.services.combatSystem.getState(walker)!.status;
                expect([CombatStatus.Pursuing, CombatStatus.Fighting]).not.toContain(combat);
                return garrisonedCount(sim, ownTowerId) === 1;
            },
            { maxTicks: 5_000, label: 'walker garrisoned in its own tower' }
        );
        expect(sim.errors).toHaveLength(0);
    });
});
