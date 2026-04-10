/**
 * Integration tests for ranged (shooting) combat behavior:
 * - Bowman shoots enemies at distance (2–8 tiles)
 * - Bowman fights melee when enemy is adjacent
 * - Bowman transitions between shooting and melee as distance changes
 * - Shooting deals damage and can kill
 */

import { describe, it, expect, afterEach } from 'vitest';
import { Simulation, createSimulation, cleanupSimulation } from '../../helpers/test-simulation';
import { installRealGameData } from '../../helpers/test-game-data';
import { UnitType } from '@/game/entity';
import { CombatStatus } from '@/game/features/combat/combat-state';

installRealGameData();

// ─── helpers ─────────────────────────────────────────────────────────────────

function combatStatus(sim: Simulation, entityId: number): CombatStatus | undefined {
    return sim.services.combatSystem.getState(entityId)?.status;
}

function health(sim: Simulation, entityId: number): number {
    return sim.services.combatSystem.getState(entityId)!.health;
}

// ─── Bowman shoots at range ─────────────────────────────────────────────────

describe('Combat – bowman shooting at range', { timeout: 30_000 }, () => {
    let sim: Simulation;

    afterEach(() => {
        sim?.destroy();
        cleanupSimulation();
    });

    it('bowman enters Shooting state when enemy is within shoot range', () => {
        sim = createSimulation({ skipTerritory: true });
        sim.establishTerritory(0);
        sim.establishTerritory(1);

        // Place bowman and enemy 5 tiles apart (within SHOOT_RANGE=8, beyond RANGED_MELEE_THRESHOLD=2)
        const bowman = sim.spawnUnit({ x: 50, y: 50 }, UnitType.Bowman1, 0);
        const enemy = sim.spawnUnit({ x: 55, y: 50 }, UnitType.Swordsman1, 1);

        sim.runUntil(() => combatStatus(sim, bowman) === CombatStatus.Shooting, {
            maxTicks: 500,
            label: 'bowman starts shooting',
        });

        const state = sim.services.combatSystem.getState(bowman)!;
        expect(state.status).toBe(CombatStatus.Shooting);
        expect(state.targetId).toBe(enemy);
        expect(sim.errors).toHaveLength(0);
    });

    it('bowman deals damage to enemy while shooting', () => {
        sim = createSimulation({ skipTerritory: true });
        sim.establishTerritory(0);
        sim.establishTerritory(1);

        const bowman = sim.spawnUnit({ x: 50, y: 50 }, UnitType.Bowman1, 0);
        const enemy = sim.spawnUnit({ x: 55, y: 50 }, UnitType.Swordsman1, 1);

        const initialHealth = health(sim, enemy);

        // Wait for bowman to start shooting
        sim.runUntil(() => combatStatus(sim, bowman) === CombatStatus.Shooting, {
            maxTicks: 500,
            label: 'bowman starts shooting',
        });

        // Run enough ticks for at least one attack (attackCooldown = 2.0s)
        sim.runTicks(200);

        expect(health(sim, enemy)).toBeLessThan(initialHealth);
        expect(sim.errors).toHaveLength(0);
    });

    it('bowman can kill an enemy by shooting', () => {
        sim = createSimulation({ skipTerritory: true });
        sim.establishTerritory(0);
        sim.establishTerritory(1);

        // Use L3 bowman (high damage) against L1 swordsman for a faster kill
        const bowman = sim.spawnUnit({ x: 50, y: 50 }, UnitType.Bowman3, 0);
        const enemy = sim.spawnUnit({ x: 55, y: 50 }, UnitType.Swordsman1, 1);

        sim.runUntil(() => sim.state.getEntity(enemy) === undefined, {
            maxTicks: 5_000,
            label: 'enemy killed by shooting',
        });

        expect(sim.state.getEntity(enemy)).toBeUndefined();
        // Bowman should return to idle after target is killed
        expect(combatStatus(sim, bowman)).toBe(CombatStatus.Idle);
        expect(sim.errors).toHaveLength(0);
    });

    it('bowman does not shoot when enemy is beyond shoot range', () => {
        sim = createSimulation({ skipTerritory: true });
        sim.establishTerritory(0);
        sim.establishTerritory(1);

        // Place enemy 12 tiles away — beyond SHOOT_RANGE=8 but within DETECTION_RANGE=17
        const bowman = sim.spawnUnit({ x: 50, y: 50 }, UnitType.Bowman1, 0);
        sim.spawnUnit({ x: 62, y: 50 }, UnitType.Swordsman1, 1);

        // Let the combat system scan
        sim.runUntil(() => combatStatus(sim, bowman) !== CombatStatus.Idle, {
            maxTicks: 500,
            label: 'bowman detects enemy',
        });

        // Should be pursuing (not shooting) since enemy is out of shoot range
        expect(combatStatus(sim, bowman)).toBe(CombatStatus.Pursuing);
        expect(sim.errors).toHaveLength(0);
    });
});

// ─── Bowman melee at close range ────────────────────────────────────────────

describe('Combat – bowman melee when adjacent', { timeout: 30_000 }, () => {
    let sim: Simulation;

    afterEach(() => {
        sim?.destroy();
        cleanupSimulation();
    });

    it('bowman enters Fighting state when enemy is adjacent', () => {
        sim = createSimulation({ skipTerritory: true });
        sim.establishTerritory(0);
        sim.establishTerritory(1);

        // Place bowman and enemy adjacent (distance 1)
        const bowman = sim.spawnUnit({ x: 50, y: 50 }, UnitType.Bowman1, 0);
        const enemy = sim.spawnUnit({ x: 51, y: 50 }, UnitType.Swordsman1, 1);

        sim.runUntil(() => combatStatus(sim, bowman) === CombatStatus.Fighting, {
            maxTicks: 500,
            label: 'bowman starts melee fighting',
        });

        const state = sim.services.combatSystem.getState(bowman)!;
        expect(state.status).toBe(CombatStatus.Fighting);
        expect(state.targetId).toBe(enemy);
        expect(sim.errors).toHaveLength(0);
    });

    it('bowman deals melee damage when adjacent', () => {
        sim = createSimulation({ skipTerritory: true });
        sim.establishTerritory(0);
        sim.establishTerritory(1);

        const bowman = sim.spawnUnit({ x: 50, y: 50 }, UnitType.Bowman1, 0);
        const enemy = sim.spawnUnit({ x: 51, y: 50 }, UnitType.Swordsman1, 1);
        const initialHealth = health(sim, enemy);

        // Wait for melee combat
        sim.runUntil(() => combatStatus(sim, bowman) === CombatStatus.Fighting, {
            maxTicks: 500,
            label: 'bowman starts fighting',
        });

        // Run enough ticks for damage
        sim.runTicks(200);

        expect(health(sim, enemy)).toBeLessThan(initialHealth);
        expect(sim.errors).toHaveLength(0);
    });
});

// ─── Shooting ↔ melee transitions ───────────────────────────────────────────

describe('Combat – shooting/melee transitions', { timeout: 60_000 }, () => {
    let sim: Simulation;

    afterEach(() => {
        sim?.destroy();
        cleanupSimulation();
    });

    it('bowman switches from Shooting to Fighting when enemy walks into melee range', () => {
        sim = createSimulation({ skipTerritory: true });
        sim.establishTerritory(0);
        sim.establishTerritory(1);

        // Bowman at distance — starts shooting
        const bowman = sim.spawnUnit({ x: 50, y: 50 }, UnitType.Bowman1, 0);
        const enemy = sim.spawnUnit({ x: 55, y: 50 }, UnitType.Swordsman1, 1);

        sim.runUntil(() => combatStatus(sim, bowman) === CombatStatus.Shooting, {
            maxTicks: 500,
            label: 'bowman starts shooting',
        });

        // The swordsman should be pursuing the bowman — wait until they are adjacent
        sim.runUntil(() => combatStatus(sim, bowman) === CombatStatus.Fighting, {
            maxTicks: 5_000,
            label: 'bowman switches to melee as enemy closes in',
            diagnose: () => {
                const e = sim.state.getEntity(enemy);
                const b = sim.state.getEntity(bowman);
                const s = combatStatus(sim, bowman);
                return `bowman=(${b?.x},${b?.y}) enemy=(${e?.x},${e?.y}) status=${s !== undefined ? CombatStatus[s] : 'removed'}`;
            },
        });

        expect(combatStatus(sim, bowman)).toBe(CombatStatus.Fighting);
        expect(sim.errors).toHaveLength(0);
    });

    it('swordsman pursues and reaches melee with a shooting bowman', () => {
        sim = createSimulation({ skipTerritory: true });
        sim.establishTerritory(0);
        sim.establishTerritory(1);

        // Swordsman should detect the bowman and pursue
        const swordsman = sim.spawnUnit({ x: 55, y: 50 }, UnitType.Swordsman1, 1);
        sim.spawnUnit({ x: 50, y: 50 }, UnitType.Bowman1, 0);

        sim.runUntil(() => combatStatus(sim, swordsman) === CombatStatus.Fighting, {
            maxTicks: 5_000,
            label: 'swordsman reaches melee with bowman',
        });

        expect(combatStatus(sim, swordsman)).toBe(CombatStatus.Fighting);
        expect(sim.errors).toHaveLength(0);
    });
});

// ─── Bowman vs swordsman combat dynamics ────────────────────────────────────

describe('Combat – bowman vs swordsman full encounter', { timeout: 60_000 }, () => {
    let sim: Simulation;

    afterEach(() => {
        sim?.destroy();
        cleanupSimulation();
    });

    it('bowman shoots first then switches to melee when swordsman arrives', () => {
        sim = createSimulation({ skipTerritory: true });
        sim.establishTerritory(0);
        sim.establishTerritory(1);

        // Bowman and swordsman at medium range — bowman shoots while swordsman closes in
        const bowman = sim.spawnUnit({ x: 50, y: 50 }, UnitType.Bowman1, 0);
        const swordsman = sim.spawnUnit({ x: 56, y: 50 }, UnitType.Swordsman1, 1);

        // Track that bowman shot at least once before going to melee
        let shotFired = false;
        let meleeFought = false;

        sim.runUntil(
            () => {
                const status = combatStatus(sim, bowman);
                if (status === CombatStatus.Shooting) shotFired = true;
                if (status === CombatStatus.Fighting) meleeFought = true;
                // End when one unit dies
                return sim.state.getEntity(bowman) === undefined || sim.state.getEntity(swordsman) === undefined;
            },
            {
                maxTicks: 10_000,
                label: 'combat concludes',
            }
        );

        expect(shotFired).toBe(true);
        expect(meleeFought).toBe(true);
        expect(sim.errors).toHaveLength(0);
    });

    it('multiple bowmen focus fire on approaching swordsman', () => {
        sim = createSimulation({ skipTerritory: true });
        sim.establishTerritory(0);
        sim.establishTerritory(1);

        const bowman1 = sim.spawnUnit({ x: 50, y: 50 }, UnitType.Bowman1, 0);
        const bowman2 = sim.spawnUnit({ x: 50, y: 52 }, UnitType.Bowman1, 0);
        const swordsman = sim.spawnUnit({ x: 55, y: 51 }, UnitType.Swordsman1, 1);

        // Both bowmen should start shooting
        sim.runUntil(
            () =>
                combatStatus(sim, bowman1) === CombatStatus.Shooting &&
                combatStatus(sim, bowman2) === CombatStatus.Shooting,
            {
                maxTicks: 500,
                label: 'both bowmen shooting',
            }
        );

        const swordsmanHealth = health(sim, swordsman);

        // Run some ticks — swordsman should take damage from both
        sim.runTicks(200);

        expect(health(sim, swordsman)).toBeLessThan(swordsmanHealth);
        expect(sim.errors).toHaveLength(0);
    });
});
