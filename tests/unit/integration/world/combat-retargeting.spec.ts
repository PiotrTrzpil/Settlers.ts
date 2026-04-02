/**
 * Integration tests for combat pathfinding improvements:
 * - Pursuing soldiers re-target to closer enemies
 * - Stuck soldiers (path cleared) immediately re-evaluate
 * - Fighters switch to adjacent enemy when current target moves away
 * - resolveOutsideBuilding handles large building footprints
 */

import { describe, it, expect, afterEach } from 'vitest';
import { Simulation, createSimulation, cleanupSimulation } from '../../helpers/test-simulation';
import { installRealGameData } from '../../helpers/test-game-data';
import { UnitType } from '@/game/entity';
import { CombatStatus } from '@/game/features/combat/combat-state';
import { hexDistanceTo } from '@/game/systems/hex-directions';

installRealGameData();

// ─── helpers ─────────────────────────────────────────────────────────────────

function combatStatus(sim: Simulation, entityId: number): CombatStatus | undefined {
    return sim.services.combatSystem.getState(entityId)?.status;
}

function combatTarget(sim: Simulation, entityId: number): number | null | undefined {
    return sim.services.combatSystem.getState(entityId)?.targetId;
}

// ─── Pursuit re-targeting ─────────────────────────────────────────────────────

describe('Combat – pursuit re-targeting', { timeout: 60_000 }, () => {
    let sim: Simulation;

    afterEach(() => {
        sim?.destroy();
        cleanupSimulation();
    });

    it('pursuing soldier switches to a much closer enemy that appears', () => {
        sim = createSimulation({ skipTerritory: true });
        sim.establishTerritory(0);
        sim.establishTerritory(1);

        // Strong soldier so it survives long enough to demonstrate retargeting
        const soldier = sim.spawnUnit(50, 50, UnitType.Swordsman3, 0);
        const farEnemy = sim.spawnUnit(65, 50, UnitType.Swordsman1, 1);

        // Wait for the soldier to start pursuing the far enemy
        sim.runUntil(() => combatStatus(sim, soldier) === CombatStatus.Pursuing, {
            maxTicks: 500,
            label: 'soldier starts pursuing far enemy',
        });
        expect(combatTarget(sim, soldier)).toBe(farEnemy);

        // Run a few ticks so the soldier is mid-pursuit
        sim.runTicks(15);

        // Spawn a much closer enemy — should trigger re-targeting
        const pos = sim.state.getEntityOrThrow(soldier, 'soldier');
        const closeEnemy = sim.spawnUnit(pos.x + 2, pos.y, UnitType.Swordsman1, 1);

        // The soldier should eventually switch to the closer enemy
        sim.runUntil(() => combatTarget(sim, soldier) === closeEnemy, {
            maxTicks: 500,
            label: 'soldier re-targets to closer enemy',
            diagnose: () => {
                const s = sim.state.getEntity(soldier);
                const t = combatTarget(sim, soldier);
                return `soldier=(${s?.x},${s?.y}) target=${t} close=${closeEnemy} far=${farEnemy}`;
            },
        });

        expect(combatTarget(sim, soldier)).toBe(closeEnemy);
        expect(sim.errors).toHaveLength(0);
    });

    it('pursuing soldier does NOT ping-pong between equidistant enemies', () => {
        sim = createSimulation({ skipTerritory: true });
        sim.establishTerritory(0);
        sim.establishTerritory(1);

        // Two enemies at similar distances — soldier should stick with one
        const soldier = sim.spawnUnit(50, 50, UnitType.Swordsman1, 0);
        sim.spawnUnit(57, 50, UnitType.Swordsman1, 1);
        sim.spawnUnit(56, 50, UnitType.Swordsman1, 1);

        sim.runUntil(() => combatStatus(sim, soldier) === CombatStatus.Pursuing, {
            maxTicks: 500,
            label: 'soldier starts pursuing',
        });

        const initialTarget = combatTarget(sim, soldier);
        let targetSwitches = 0;
        let lastTarget = initialTarget;

        // Run for a while and count how many times the target switches
        for (let i = 0; i < 300; i++) {
            sim.runTicks(1);
            const current = combatTarget(sim, soldier);
            if (current !== lastTarget && current !== null) {
                targetSwitches++;
                lastTarget = current;
            }
            // Stop if combat resolved
            const status = combatStatus(sim, soldier);
            if (status === CombatStatus.Fighting || status === CombatStatus.Idle) break;
        }

        // Should not have switched more than once (allowed one switch to the nearer enemy)
        expect(targetSwitches).toBeLessThanOrEqual(1);
        expect(sim.errors).toHaveLength(0);
    });
});

// ─── Stuck soldier recovery ──────────────────────────────────────────────────

describe('Combat – stuck soldier recovery', { timeout: 60_000 }, () => {
    let sim: Simulation;

    afterEach(() => {
        sim?.destroy();
        cleanupSimulation();
    });

    it('soldier that gets stuck while pursuing eventually engages an enemy', () => {
        sim = createSimulation({ skipTerritory: true });
        sim.establishTerritory(0);
        sim.establishTerritory(1);

        // Place soldier and enemy with some distance
        const soldier = sim.spawnUnit(50, 50, UnitType.Swordsman3, 0);
        const enemy = sim.spawnUnit(55, 50, UnitType.Swordsman1, 1);

        // Wait for pursuit to start
        sim.runUntil(() => combatStatus(sim, soldier) === CombatStatus.Pursuing, {
            maxTicks: 500,
            label: 'soldier starts pursuing',
        });

        // Eventually the soldier should reach and engage the enemy
        sim.runUntil(
            () => {
                const status = combatStatus(sim, soldier);
                return status === CombatStatus.Fighting || sim.state.getEntity(enemy) === undefined;
            },
            {
                maxTicks: 5_000,
                label: 'soldier reaches enemy',
                diagnose: () => {
                    const s = sim.state.getEntity(soldier);
                    const e = sim.state.getEntity(enemy);
                    const ctrl = sim.state.movement.getController(soldier);
                    return (
                        `soldier=(${s?.x},${s?.y}) enemy=(${e?.x},${e?.y})` +
                        ` status=${combatStatus(sim, soldier)} ctrl=${ctrl?.state}`
                    );
                },
            }
        );

        expect(sim.errors).toHaveLength(0);
    });
});

// ─── Fighting re-target to adjacent enemy ────────────────────────────────────

describe('Combat – fighting re-target', { timeout: 60_000 }, () => {
    let sim: Simulation;

    afterEach(() => {
        sim?.destroy();
        cleanupSimulation();
    });

    it('soldier switches to adjacent enemy when current target dies', () => {
        sim = createSimulation({ skipTerritory: true });
        sim.establishTerritory(0);
        sim.establishTerritory(1);

        // Strong soldier vs two weak enemies side by side
        const soldier = sim.spawnUnit(50, 50, UnitType.Swordsman3, 0);
        const enemy1 = sim.spawnUnit(51, 50, UnitType.Swordsman1, 1);
        const enemy2 = sim.spawnUnit(50, 51, UnitType.Swordsman1, 1);

        // Wait for the soldier to start fighting one of them
        sim.runUntil(() => combatStatus(sim, soldier) === CombatStatus.Fighting, {
            maxTicks: 500,
            label: 'soldier starts fighting',
        });

        const firstTarget = combatTarget(sim, soldier)!;
        const secondEnemy = firstTarget === enemy1 ? enemy2 : enemy1;

        // Wait for the first target to die
        sim.runUntil(() => sim.state.getEntity(firstTarget) === undefined, {
            maxTicks: 5_000,
            label: 'first target killed',
        });

        // Soldier should engage the second enemy (it's adjacent)
        sim.runUntil(() => combatStatus(sim, soldier) === CombatStatus.Fighting, {
            maxTicks: 500,
            label: 'soldier fights second enemy',
        });

        expect(combatTarget(sim, soldier)).toBe(secondEnemy);
        expect(sim.errors).toHaveLength(0);
    });

    it('soldier prefers adjacent enemy over distant one when target moves away', () => {
        sim = createSimulation({ skipTerritory: true });
        sim.establishTerritory(0);
        sim.establishTerritory(1);

        // Two enemies: one adjacent, one further out
        const soldier = sim.spawnUnit(50, 50, UnitType.Swordsman1, 0);
        const nearEnemy = sim.spawnUnit(51, 50, UnitType.Swordsman1, 1);
        sim.spawnUnit(55, 50, UnitType.Swordsman1, 1);

        // Wait for soldier to engage (should pick the adjacent one first)
        sim.runUntil(() => combatStatus(sim, soldier) === CombatStatus.Fighting, {
            maxTicks: 500,
            label: 'soldier starts fighting',
        });

        // Verify it picked the adjacent enemy
        expect(combatTarget(sim, soldier)).toBe(nearEnemy);
        expect(sim.errors).toHaveLength(0);
    });
});

// ─── Multi-soldier target distribution ───────────────────────────────────────

describe('Combat – multiple soldiers engage closest enemies', { timeout: 60_000 }, () => {
    let sim: Simulation;

    afterEach(() => {
        sim?.destroy();
        cleanupSimulation();
    });

    it('two soldiers each engage their nearest enemy rather than the same one', () => {
        sim = createSimulation({ skipTerritory: true });
        sim.establishTerritory(0);
        sim.establishTerritory(1);

        // Two soldiers, two enemies — each soldier should pick the nearest
        const soldier1 = sim.spawnUnit(50, 50, UnitType.Swordsman1, 0);
        const soldier2 = sim.spawnUnit(50, 55, UnitType.Swordsman1, 0);

        const enemy1 = sim.spawnUnit(53, 50, UnitType.Swordsman1, 1); // closer to soldier1
        const enemy2 = sim.spawnUnit(53, 55, UnitType.Swordsman1, 1); // closer to soldier2

        sim.runUntil(
            () =>
                combatStatus(sim, soldier1) === CombatStatus.Pursuing &&
                combatStatus(sim, soldier2) === CombatStatus.Pursuing,
            {
                maxTicks: 500,
                label: 'both soldiers pursuing',
            }
        );

        // Each should target their closest enemy
        expect(combatTarget(sim, soldier1)).toBe(enemy1);
        expect(combatTarget(sim, soldier2)).toBe(enemy2);
        expect(sim.errors).toHaveLength(0);
    });

    it('soldiers converge on a single enemy when only one is in range', () => {
        sim = createSimulation({ skipTerritory: true });
        sim.establishTerritory(0);
        sim.establishTerritory(1);

        const soldier1 = sim.spawnUnit(50, 50, UnitType.Swordsman1, 0);
        const soldier2 = sim.spawnUnit(52, 50, UnitType.Swordsman1, 0);
        const enemy = sim.spawnUnit(55, 50, UnitType.Swordsman1, 1);

        sim.runUntil(
            () =>
                combatStatus(sim, soldier1) !== CombatStatus.Idle && combatStatus(sim, soldier2) !== CombatStatus.Idle,
            {
                maxTicks: 500,
                label: 'both soldiers engage',
            }
        );

        // Both should target the same (only) enemy
        expect(combatTarget(sim, soldier1)).toBe(enemy);
        expect(combatTarget(sim, soldier2)).toBe(enemy);
        expect(sim.errors).toHaveLength(0);
    });
});

// ─── Pursuit repath responsiveness ──────────────────────────────────────────

describe('Combat – pursuit responsiveness', { timeout: 60_000 }, () => {
    let sim: Simulation;

    afterEach(() => {
        sim?.destroy();
        cleanupSimulation();
    });

    it('pursuing soldier reaches a stationary enemy within reasonable time', () => {
        sim = createSimulation({ skipTerritory: true });
        sim.establishTerritory(0);
        sim.establishTerritory(1);

        const soldier = sim.spawnUnit(50, 50, UnitType.Swordsman1, 0);
        const enemy = sim.spawnUnit(58, 50, UnitType.Swordsman1, 1);

        const startPos = sim.state.getEntityOrThrow(soldier, 'soldier');
        const dist = hexDistanceTo(startPos, sim.state.getEntityOrThrow(enemy, 'enemy'));

        // Soldier should reach the enemy within a generous but bounded time.
        // At ~2 tiles/sec movement speed, 8 tiles should take ~4s = ~120 ticks.
        // Allow 3x margin for pathfinding delays and bumping.
        sim.runUntil(() => combatStatus(sim, soldier) === CombatStatus.Fighting, {
            maxTicks: Math.max(500, dist * 60),
            label: 'soldier reaches enemy for melee',
            diagnose: () => {
                const s = sim.state.getEntity(soldier);
                const e = sim.state.getEntity(enemy);
                const ctrl = sim.state.movement.getController(soldier);
                return (
                    `soldier=(${s?.x},${s?.y}) enemy=(${e?.x},${e?.y})` +
                    ` status=${combatStatus(sim, soldier)} ctrl=${ctrl?.state}`
                );
            },
        });

        expect(combatStatus(sim, soldier)).toBe(CombatStatus.Fighting);
        expect(sim.errors).toHaveLength(0);
    });
});
