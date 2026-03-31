/**
 * Integration tests for combat behavior changes:
 * - Right-click enemy tower → move to attack (not garrison)
 * - Combat system skips hidden (garrisoned) units
 * - No siege while field enemies are nearby
 * - Attackers are free — player can move them away from siege
 * - Siege cancelled when all attackers leave door area
 * - combatControllable setting
 * - Passive march (move to empty ground without engaging)
 * - Combat winner near enemy tower triggers siege
 */

import { describe, it, expect, afterEach } from 'vitest';
import { Simulation, createSimulation, cleanupSimulation } from '../../helpers/test-simulation';
import { installRealGameData } from '../../helpers/test-game-data';
import { UnitType, tileKey } from '@/game/entity';
import { BuildingType } from '@/game/buildings';
import { CombatStatus } from '@/game/features/combat/combat-state';
import { getBuildingDoorPos } from '@/game/data/game-data-access';

installRealGameData();

// ─── helpers ─────────────────────────────────────────────────────────────────

function moveUnit(sim: Simulation, entityId: number, targetX: number, targetY: number) {
    return sim.execute({ type: 'move_unit', entityId, targetX, targetY });
}

function selectUnit(sim: Simulation, entityId: number) {
    sim.state.selection.select(entityId);
}

function garrisonUnits(sim: Simulation, buildingId: number, unitIds: number[]) {
    return sim.execute({ type: 'garrison_units', buildingId, unitIds });
}

function garrisonSelected(sim: Simulation, tileX: number, tileY: number) {
    return sim.execute({ type: 'garrison_selected_units', tileX, tileY });
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

// ─── Right-click enemy tower → attack, not garrison ─────────────────────────

describe('Combat – right-click enemy tower', { timeout: 30_000 }, () => {
    let sim: Simulation;

    afterEach(() => {
        sim?.destroy();
        cleanupSimulation();
    });

    it('garrison_selected_units on enemy tower returns not_garrison_building', () => {
        sim = createSimulation({ skipTerritory: true });
        sim.establishTerritory(0);
        sim.establishTerritory(1);

        // Use a big tower (larger footprint, easier to hit in ground occupancy)
        const towerId = sim.placeBuilding(BuildingType.GuardTowerBig, 0);
        const tower = sim.state.getEntityOrThrow(towerId, 'tower');

        const defId = sim.spawnUnitNear(towerId, UnitType.Swordsman1, 1, 0)[0]!;
        garrisonUnits(sim, towerId, [defId]);
        waitForGarrisoned(sim, towerId, 1, 'defender garrisoned');

        // Select a player-1 swordsman and try to garrison into player-0's tower
        const atkId = sim.spawnUnit(tower.x + 10, tower.y, UnitType.Swordsman1, 1);
        selectUnit(sim, atkId);

        // Find a tile the tower occupies via ground occupancy scan
        let tileX = tower.x;
        let tileY = tower.y;
        for (let dx = -3; dx <= 3; dx++) {
            for (let dy = -3; dy <= 3; dy++) {
                const e = sim.state.getGroundEntityAt(tower.x + dx, tower.y + dy);
                if (e?.id === towerId) {
                    tileX = tower.x + dx;
                    tileY = tower.y + dy;
                    break;
                }
            }
        }

        const result = garrisonSelected(sim, tileX, tileY);
        // Should fail with not_garrison_building so the caller falls through to move
        expect(result.success).toBe(false);
        expect(result.error).toBe('not_garrison_building');
        expect(sim.errors).toHaveLength(0);
    });

    it('garrison_selected_units on own tower succeeds', () => {
        sim = createSimulation({ skipTerritory: true });
        sim.establishTerritory(0);

        const towerId = sim.placeBuilding(BuildingType.GuardTowerSmall, 0);
        const tower = sim.state.getEntityOrThrow(towerId, 'tower');

        const unitId = sim.spawnUnit(tower.x + 3, tower.y, UnitType.Swordsman1, 0);
        selectUnit(sim, unitId);

        const result = garrisonSelected(sim, tower.x, tower.y);
        expect(result.success).toBe(true);
        expect(sim.errors).toHaveLength(0);
    });
});

// ─── Combat system skips hidden units ───────────────────────────────────────

describe('Combat – hidden unit handling', { timeout: 30_000 }, () => {
    let sim: Simulation;

    afterEach(() => {
        sim?.destroy();
        cleanupSimulation();
    });

    it('swordsman does not pursue hidden units inside a garrison', () => {
        sim = createSimulation({ skipTerritory: true });
        sim.establishTerritory(0);
        sim.establishTerritory(1);

        // Use a non-garrison building so the siege system doesn't interfere
        // (we're testing the combat system's hidden-unit filtering, not siege)
        const towerId = sim.placeBuilding(BuildingType.GuardTowerSmall, 0);
        const tower = sim.state.getEntityOrThrow(towerId, 'tower');

        // Garrison a defender (it becomes hidden)
        const defId = sim.spawnUnitNear(towerId, UnitType.Swordsman1, 1, 0)[0]!;
        garrisonUnits(sim, towerId, [defId]);
        waitForGarrisoned(sim, towerId, 1, 'defender garrisoned');
        expect(sim.state.getEntityOrThrow(defId, 'defender').hidden).toBe(true);

        // Place an enemy BOWMAN far enough that siege won't trigger (bowmen can't siege)
        // but close enough that combat detection would pick up the hidden unit if not filtered
        const atkId = sim.spawnUnit(tower.x + 5, tower.y, UnitType.Bowman1, 1);
        sim.runTicks(200); // let the combat system scan

        // The bowman should NOT be pursuing the hidden defender
        const combatState = sim.services.combatSystem.getState(atkId);
        expect(combatState).toBeDefined();
        expect(combatState!.targetId).not.toBe(defId);
        expect(sim.errors).toHaveLength(0);
    });
});

// ─── No siege while field enemies are nearby ────────────────────────────────

describe('Combat – field enemies block siege', { timeout: 60_000 }, () => {
    let sim: Simulation;

    afterEach(() => {
        sim?.destroy();
        cleanupSimulation();
    });

    it('swordsman fights field enemies before starting siege', () => {
        sim = createSimulation({ skipTerritory: true });
        sim.establishTerritory(0);
        sim.establishTerritory(1);

        const towerId = sim.placeBuilding(BuildingType.GuardTowerSmall, 0);
        const tower = sim.state.getEntityOrThrow(towerId, 'tower');
        const door = getBuildingDoorPos(tower.x, tower.y, tower.race, tower.subType as BuildingType);

        // Garrison a defender
        const defId = sim.spawnUnitNear(towerId, UnitType.Swordsman1, 1, 0)[0]!;
        garrisonUnits(sim, towerId, [defId]);
        waitForGarrisoned(sim, towerId, 1, 'defender garrisoned');

        // Place a field enemy near the door (not garrisoned)
        const fieldEnemy = sim.spawnUnit(door.x + 1, door.y, UnitType.Swordsman1, 0);

        // Send an attacker
        const atkId = sim.spawnUnit(tower.x + 5, tower.y, UnitType.Swordsman3, 1);
        moveUnit(sim, atkId, tower.x, tower.y);
        sim.runTicks(500);

        // Siege should NOT have started while the field enemy is alive
        const siege = sim.services.siegeSystem.getSiege(towerId);
        const fieldEnemyAlive = sim.state.getEntity(fieldEnemy) !== undefined;
        if (fieldEnemyAlive) {
            expect(siege).toBeUndefined();
        }
        expect(sim.errors).toHaveLength(0);
    });
});

// ─── Attackers are free — player can move them away ─────────────────────────

describe('Combat – attacker freedom during siege', { timeout: 60_000 }, () => {
    let sim: Simulation;

    afterEach(() => {
        sim?.destroy();
        cleanupSimulation();
    });

    it('player can move an attacker away from an active siege', () => {
        sim = createSimulation({ skipTerritory: true });
        sim.establishTerritory(0);
        sim.establishTerritory(1);

        const towerId = sim.placeBuilding(BuildingType.GuardTowerBig, 0);
        const tower = sim.state.getEntityOrThrow(towerId, 'tower');

        const defenders = sim.spawnUnitNear(towerId, UnitType.Swordsman1, 3, 0);
        garrisonUnits(sim, towerId, defenders);
        waitForGarrisoned(sim, towerId, 3, 'defenders garrisoned');

        const atkId = sim.spawnUnit(tower.x + 5, tower.y, UnitType.Swordsman1, 1);
        moveUnit(sim, atkId, tower.x, tower.y);

        sim.runUntil(() => sim.services.siegeSystem.getSiege(towerId) !== undefined, {
            maxTicks: 10_000,
            label: 'siege started',
        });

        // Attacker is NOT reserved — player can move it
        expect(sim.services.unitReservation.isReserved(atkId)).toBe(false);
        const moveResult = moveUnit(sim, atkId, tower.x + 30, tower.y);
        expect(moveResult.success).toBe(true);

        expect(sim.errors).toHaveLength(0);
    });
});

// ─── combatControllable setting ─────────────────────────────────────────────

describe('Combat – combatControllable setting', { timeout: 30_000 }, () => {
    let sim: Simulation;

    afterEach(() => {
        sim?.destroy();
        cleanupSimulation();
    });

    it('when disabled, units in combat cannot be moved', () => {
        sim = createSimulation({ skipTerritory: true });
        sim.establishTerritory(0);
        sim.establishTerritory(1);
        sim.settings.state.combatControllable = false;

        // Spawn two enemies near each other so combat starts
        const unit0 = sim.spawnUnit(50, 50, UnitType.Swordsman1, 0);
        sim.spawnUnit(51, 50, UnitType.Swordsman1, 1);

        // Wait for combat to start
        sim.runUntil(() => sim.services.combatSystem.isInCombat(unit0), {
            maxTicks: 500,
            label: 'unit0 in combat',
        });

        const result = moveUnit(sim, unit0, 70, 50);
        expect(result.success).toBe(false);
        expect(sim.errors).toHaveLength(0);
    });

    it('when enabled (default), units in combat can be moved', () => {
        sim = createSimulation({ skipTerritory: true });
        sim.establishTerritory(0);
        sim.establishTerritory(1);
        // combatControllable is true by default

        const unit0 = sim.spawnUnit(50, 50, UnitType.Swordsman1, 0);
        sim.spawnUnit(51, 50, UnitType.Swordsman1, 1);

        sim.runUntil(() => sim.services.combatSystem.isInCombat(unit0), {
            maxTicks: 500,
            label: 'unit0 in combat',
        });

        const result = moveUnit(sim, unit0, 70, 50);
        expect(result.success).toBe(true);
        expect(sim.errors).toHaveLength(0);
    });
});

// ─── Passive march ──────────────────────────────────────────────────────────

describe('Combat – passive march', { timeout: 60_000 }, () => {
    let sim: Simulation;

    afterEach(() => {
        sim?.destroy();
        cleanupSimulation();
    });

    it('unit marching to empty ground does not engage enemies along the way', () => {
        sim = createSimulation({ skipTerritory: true });
        sim.establishTerritory(0);
        sim.establishTerritory(1);

        // Place enemy swordsman in the path between start and destination
        const unit0 = sim.spawnUnit(50, 50, UnitType.Swordsman1, 0);
        sim.spawnUnit(55, 50, UnitType.Swordsman1, 1); // enemy in the way

        // Move to empty ground far from enemies
        moveUnit(sim, unit0, 70, 50);
        sim.runTicks(100);

        // The unit should be passive (not engaging the enemy it walks past)
        const combatState = sim.services.combatSystem.getState(unit0);
        expect(combatState!.status).toBe(CombatStatus.Idle);
        expect(sim.errors).toHaveLength(0);
    });

    it('unit moved near an enemy engages normally (not passive)', () => {
        sim = createSimulation({ skipTerritory: true });
        sim.establishTerritory(0);
        sim.establishTerritory(1);

        const unit0 = sim.spawnUnit(50, 50, UnitType.Swordsman1, 0);
        sim.spawnUnit(55, 50, UnitType.Swordsman1, 1);

        // Move directly to the enemy's tile — should engage
        moveUnit(sim, unit0, 55, 50);

        sim.runUntil(() => sim.services.combatSystem.isInCombat(unit0), {
            maxTicks: 2000,
            label: 'unit engages enemy at destination',
        });

        expect(sim.errors).toHaveLength(0);
    });
});

// ─── Combat winner triggers siege ───────────────────────────────────────────

describe('Combat – winner auto-siege', { timeout: 60_000 }, () => {
    let sim: Simulation;

    afterEach(() => {
        sim?.destroy();
        cleanupSimulation();
    });

    it('swordsman that wins combat near enemy tower starts siege', () => {
        sim = createSimulation({ skipTerritory: true });
        sim.establishTerritory(0);
        sim.establishTerritory(1);

        const towerId = sim.placeBuilding(BuildingType.GuardTowerSmall, 0);
        const tower = sim.state.getEntityOrThrow(towerId, 'tower');
        const door = getBuildingDoorPos(tower.x, tower.y, tower.race, tower.subType as BuildingType);

        // Garrison a defender inside
        const defId = sim.spawnUnitNear(towerId, UnitType.Swordsman1, 1, 0)[0]!;
        garrisonUnits(sim, towerId, [defId]);
        waitForGarrisoned(sim, towerId, 1, 'defender garrisoned');

        // Place a field enemy near the door and a strong attacker next to it
        const fieldEnemy = sim.spawnUnit(door.x + 1, door.y, UnitType.Swordsman1, 0);
        const attacker = sim.spawnUnit(door.x + 2, door.y, UnitType.Swordsman3, 1);

        // Wait for the attacker to kill the field enemy
        sim.runUntil(() => sim.state.getEntity(fieldEnemy) === undefined, {
            maxTicks: 10_000,
            label: 'field enemy killed',
        });

        // After winning, the attacker should auto-start a siege
        // (checkSiegeOpportunity is called on combat winner)
        sim.runUntil(() => sim.services.siegeSystem.getSiege(towerId) !== undefined, {
            maxTicks: 5_000,
            label: 'siege started after combat win',
            diagnose: () => {
                const atk = sim.state.getEntity(attacker);
                return `attacker alive=${!!atk}, pos=(${atk?.x},${atk?.y})`;
            },
        });

        expect(sim.errors).toHaveLength(0);
    });
});

// ─── Attackers never stand on building tiles ────────────────────────────────

describe('Combat – attackers stay outside building footprint', { timeout: 60_000 }, () => {
    let sim: Simulation;

    afterEach(() => {
        sim?.destroy();
        cleanupSimulation();
    });

    it('attackers never occupy building footprint tiles during siege', () => {
        sim = createSimulation({ skipTerritory: true });
        sim.establishTerritory(0);
        sim.establishTerritory(1);

        const towerId = sim.placeBuilding(BuildingType.GuardTowerBig, 0);
        const tower = sim.state.getEntityOrThrow(towerId, 'tower');

        const defenders = sim.spawnUnitNear(towerId, UnitType.Swordsman1, 2, 0);
        garrisonUnits(sim, towerId, defenders);
        waitForGarrisoned(sim, towerId, 2, 'defenders garrisoned');

        // Send strong attackers to the tower
        const atkIds = [
            sim.spawnUnit(tower.x + 8, tower.y, UnitType.Swordsman3, 1),
            sim.spawnUnit(tower.x + 9, tower.y, UnitType.Swordsman3, 1),
        ];
        for (const id of atkIds) {
            moveUnit(sim, id, tower.x, tower.y);
        }

        // Collect building footprint tiles for this tower
        const buildingTiles = new Set<string>();
        for (const key of sim.state.buildingOccupancy) {
            const [kx, ky] = key.split(',').map(Number);
            const entity = sim.state.getGroundEntityAt(kx!, ky!);
            if (entity?.id === towerId) {
                buildingTiles.add(key);
            }
        }

        // Track violations: attacker standing on a building tile
        const violations: { unitId: number; x: number; y: number }[] = [];

        sim.runUntil(
            () => {
                for (const atkId of atkIds) {
                    const unit = sim.state.getEntity(atkId);
                    if (!unit || unit.hidden) continue;
                    const key = tileKey(unit.x, unit.y);
                    if (buildingTiles.has(key)) {
                        violations.push({ unitId: atkId, x: unit.x, y: unit.y });
                    }
                }
                const siege = sim.services.siegeSystem.getSiege(towerId);
                return siege === undefined && sim.state.getEntityOrThrow(towerId, 'tower').player === 1;
            },
            {
                maxTicks: 15_000,
                label: 'siege completed',
                diagnose: () => {
                    const s = sim.services.siegeSystem.getSiege(towerId);
                    return `siege=${s ? 'active' : 'none'}, violations=${violations.length}`;
                },
            }
        );

        expect(violations).toHaveLength(0);
        expect(sim.errors).toHaveLength(0);
    });
});
