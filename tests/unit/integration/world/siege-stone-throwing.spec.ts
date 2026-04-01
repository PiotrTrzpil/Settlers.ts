/**
 * Integration tests for garrisoned bowmen throwing stones during siege.
 *
 * When a siege is in the Fighting phase with an active defender at the door,
 * garrisoned bowmen switch from normal shooting to throwing stones at the
 * attackers that are fighting the door defender.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { Simulation, createSimulation, cleanupSimulation } from '../../helpers/test-simulation';
import { installRealGameData } from '../../helpers/test-game-data';
import { UnitType } from '@/game/entity';
import { BuildingType } from '@/game/buildings';
import { CombatStatus } from '@/game/features/combat/combat-state';
import {
    towerBowmanTargets,
    towerBowmanThrowingStones,
} from '@/game/features/tower-garrison/internal/tower-combat-system';

installRealGameData();

// ─── helpers ─────────────────────────────────────────────────────────────────

function garrisonUnits(sim: Simulation, buildingId: number, unitIds: number[]) {
    return sim.execute({ type: 'garrison_units', buildingId, unitIds });
}

function moveUnit(sim: Simulation, entityId: number, targetX: number, targetY: number) {
    return sim.execute({ type: 'move_unit', entityId, targetX, targetY });
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
    });
}

// ─── Bowmen throw stones at door attackers during siege ────────────────────

describe('Siege – garrisoned bowmen throw stones', { timeout: 60_000 }, () => {
    let sim: Simulation;

    afterEach(() => {
        sim?.destroy();
        cleanupSimulation();
    });

    it('bowmen enter throw-stone mode when attackers fight the door defender', () => {
        sim = createSimulation({ skipTerritory: true });
        sim.establishTerritory(0);
        sim.establishTerritory(1);

        // Set up a tower with bowmen and a swordsman defender
        const towerId = sim.placeBuilding(BuildingType.GuardTowerSmall, 0);
        const tower = sim.state.getEntityOrThrow(towerId, 'tower');

        const defId = sim.spawnUnitNear(towerId, UnitType.Swordsman1, 1, 0)[0]!;
        const [bw1, bw2] = sim.spawnUnitNear(towerId, UnitType.Bowman1, 2, 0);
        garrisonUnits(sim, towerId, [defId, bw1!, bw2!]);
        waitForGarrisoned(sim, towerId, 3, 'tower fully garrisoned');

        // Send an attacker to the tower to trigger siege
        const atkId = sim.spawnUnit(tower.x + 8, tower.y, UnitType.Swordsman3, 1);
        moveUnit(sim, atkId, tower.x, tower.y);

        // Wait for siege to start and defender to be ejected
        sim.runUntil(() => sim.services.siegeSystem.getSiege(towerId) !== undefined, {
            maxTicks: 10_000,
            label: 'siege started',
        });

        // Wait for the attacker to start fighting the ejected defender
        sim.runUntil(
            () => {
                const atkState = sim.services.combatSystem.getState(atkId);
                return atkState !== undefined && atkState.status === CombatStatus.Fighting;
            },
            {
                maxTicks: 5_000,
                label: 'attacker fighting defender at door',
            }
        );

        // Let the tower combat system do a scan cycle
        sim.runTicks(30);

        // Garrisoned bowmen should be in throw-stone mode
        expect(towerBowmanThrowingStones.has(bw1!)).toBe(true);
        expect(towerBowmanThrowingStones.has(bw2!)).toBe(true);

        // They should target the attacker fighting the defender
        expect(towerBowmanTargets.get(bw1!)).toBe(atkId);
        expect(towerBowmanTargets.get(bw2!)).toBe(atkId);

        expect(sim.errors).toHaveLength(0);
    });

    it('bowmen only target attackers fighting the door defender, not other enemies', () => {
        sim = createSimulation({ skipTerritory: true });
        sim.establishTerritory(0);
        sim.establishTerritory(1);

        const towerId = sim.placeBuilding(BuildingType.GuardTowerBig, 0);
        const tower = sim.state.getEntityOrThrow(towerId, 'tower');

        // Garrison: 1 swordsman + 2 bowmen
        const defId = sim.spawnUnitNear(towerId, UnitType.Swordsman1, 1, 0)[0]!;
        const bowmanId = sim.spawnUnitNear(towerId, UnitType.Bowman1, 1, 0)[0]!;
        garrisonUnits(sim, towerId, [defId, bowmanId]);
        waitForGarrisoned(sim, towerId, 2, 'swordsman + bowman garrisoned');

        // Place a bystander enemy within tower range but not at door — use a bowman
        // so it doesn't walk to the door and start siege-related combat
        const bystander = sim.spawnUnit(tower.x + 6, tower.y, UnitType.Bowman1, 1);

        // Send a door attacker (swordsman walks to door and fights)
        const doorAttacker = sim.spawnUnit(tower.x + 10, tower.y, UnitType.Swordsman3, 1);
        moveUnit(sim, doorAttacker, tower.x, tower.y);

        // Wait for siege + door combat
        sim.runUntil(
            () => {
                const atkState = sim.services.combatSystem.getState(doorAttacker);
                return (
                    sim.services.siegeSystem.getSiege(towerId) !== undefined &&
                    atkState !== undefined &&
                    atkState.status === CombatStatus.Fighting
                );
            },
            {
                maxTicks: 10_000,
                label: 'siege started and attacker fighting',
            }
        );

        // Let the tower combat system do a scan cycle
        sim.runTicks(30);

        // Bowman should target the door attacker, NOT the bystander
        expect(towerBowmanTargets.get(bowmanId)).toBe(doorAttacker);
        expect(towerBowmanTargets.get(bowmanId)).not.toBe(bystander);
        expect(towerBowmanThrowingStones.has(bowmanId)).toBe(true);

        expect(sim.errors).toHaveLength(0);
    });

    it('bowmen revert to normal shooting when no attackers fight the defender', () => {
        sim = createSimulation({ skipTerritory: true });
        sim.establishTerritory(0);
        sim.establishTerritory(1);

        const towerId = sim.placeBuilding(BuildingType.GuardTowerSmall, 0);
        const tower = sim.state.getEntityOrThrow(towerId, 'tower');

        // Garrison bowmen only (no swordsman to eject as defender)
        const [bw1, bw2] = sim.spawnUnitNear(towerId, UnitType.Bowman1, 2, 0);
        garrisonUnits(sim, towerId, [bw1!, bw2!]);
        waitForGarrisoned(sim, towerId, 2, 'bowmen garrisoned');

        // Place an enemy within tower attack range but no siege (no garrison swordsmen to eject)
        const enemy = sim.spawnUnit(tower.x + 5, tower.y, UnitType.Swordsman1, 1);

        // Let the tower combat system scan
        sim.runTicks(30);

        // Bowmen should be in normal shooting mode (no throw-stone)
        expect(towerBowmanThrowingStones.has(bw1!)).toBe(false);
        expect(towerBowmanThrowingStones.has(bw2!)).toBe(false);

        // They should still target the enemy
        expect(towerBowmanTargets.get(bw1!)).toBe(enemy);
        expect(towerBowmanTargets.get(bw2!)).toBe(enemy);

        expect(sim.errors).toHaveLength(0);
    });

    it('bowmen deal damage to door attackers while throwing stones', () => {
        sim = createSimulation({ skipTerritory: true });
        sim.establishTerritory(0);
        sim.establishTerritory(1);

        const towerId = sim.placeBuilding(BuildingType.GuardTowerSmall, 0);
        const tower = sim.state.getEntityOrThrow(towerId, 'tower');

        const defId = sim.spawnUnitNear(towerId, UnitType.Swordsman1, 1, 0)[0]!;
        const bowmanId = sim.spawnUnitNear(towerId, UnitType.Bowman1, 1, 0)[0]!;
        garrisonUnits(sim, towerId, [defId, bowmanId]);
        waitForGarrisoned(sim, towerId, 2, 'garrisoned');

        const atkId = sim.spawnUnit(tower.x + 8, tower.y, UnitType.Swordsman3, 1);
        moveUnit(sim, atkId, tower.x, tower.y);

        // Wait for siege + fighting
        sim.runUntil(
            () => {
                const atkState = sim.services.combatSystem.getState(atkId);
                return (
                    sim.services.siegeSystem.getSiege(towerId) !== undefined &&
                    atkState !== undefined &&
                    atkState.status === CombatStatus.Fighting
                );
            },
            {
                maxTicks: 10_000,
                label: 'door combat started',
            }
        );

        const healthBefore = sim.services.combatSystem.getState(atkId)!.health;

        // Run enough ticks for the bowman to fire (attackCooldown = 2.0s)
        sim.runTicks(200);

        const healthAfter = sim.services.combatSystem.getState(atkId)?.health ?? 0;
        expect(healthAfter).toBeLessThan(healthBefore);

        expect(sim.errors).toHaveLength(0);
    });
});
