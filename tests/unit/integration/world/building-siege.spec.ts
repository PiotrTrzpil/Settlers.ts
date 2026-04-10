/**
 * Integration tests for building siege.
 *
 * Full siege lifecycle: garrison defenders into a tower, send enemy swordsmen
 * to attack it, verify combat phases, defender ejection, and building capture.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { Simulation, createSimulation, cleanupSimulation } from '../../helpers/test-simulation';
import { installRealGameData } from '../../helpers/test-game-data';
import { UnitType, Tile } from '@/game/entity';
import { BuildingType } from '@/game/buildings';
import type { SiegeState } from '@/game/features/building-siege';
import { DOOR_ARRIVAL_DISTANCE } from '@/game/features/building-siege/siege-types';
import type { BuildingGarrisonState } from '@/game/features/tower-garrison/types';
import { getBuildingDoorPos } from '@/game/data/game-data-access';

installRealGameData();

// ─── helpers ─────────────────────────────────────────────────────────────────

function garrisonUnits(sim: Simulation, buildingId: number, unitIds: number[]) {
    return sim.execute({ type: 'garrison_units', buildingId, unitIds });
}

function moveUnit(sim: Simulation, entityId: number, target: Tile) {
    return sim.execute({ type: 'move_unit', entityId, targetX: target.x, targetY: target.y });
}

function garrisonedCount(sim: Simulation, buildingId: number): number {
    const g = sim.services.garrisonManager.getGarrison(buildingId);
    if (!g) return 0;
    return g.swordsmanSlots.unitIds.length + g.bowmanSlots.unitIds.length;
}

function getGarrison(sim: Simulation, buildingId: number): BuildingGarrisonState {
    return sim.services.garrisonManager.getGarrison(buildingId)!;
}

function getSiege(sim: Simulation, buildingId: number): Readonly<SiegeState> | undefined {
    return sim.services.siegeSystem.getSiege(buildingId);
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

function waitForSiegeStarted(sim: Simulation, buildingId: number, label: string): void {
    sim.runUntil(() => getSiege(sim, buildingId) !== undefined, {
        maxTicks: 10_000,
        label,
        diagnose: () => 'no siege on building yet',
    });
}

function waitForBuildingCaptured(sim: Simulation, buildingId: number, newPlayer: number, label: string): void {
    sim.runUntil(() => sim.state.getEntity(buildingId)?.player === newPlayer, {
        maxTicks: 15_000,
        label,
        diagnose: () => {
            const b = sim.state.getEntity(buildingId);
            if (!b) return 'building removed';
            const s = getSiege(sim, buildingId);
            return `player=${b.player}, siege=${s ? `defender=${s.activeDefenderId}` : 'none'}`;
        },
    });
}

// ─── Siege combat ─────────────────────────────────────────────────────────────

describe('Building siege – combat', { timeout: 60_000 }, () => {
    let sim: Simulation;

    afterEach(() => {
        sim?.destroy();
        cleanupSimulation();
    });

    it('enemy swordsman approaching a garrisoned tower triggers a siege', () => {
        sim = createSimulation({ skipTerritory: true });
        sim.establishTerritory(0);
        sim.establishTerritory(1);

        const towerId = sim.placeBuilding(BuildingType.GuardTowerBig, 0);
        const tower = sim.state.getEntityOrThrow(towerId, 'tower');

        const defenders = sim.spawnUnitNear(towerId, UnitType.Swordsman1, 3, 0);
        garrisonUnits(sim, towerId, defenders);
        waitForGarrisoned(sim, towerId, 3, 'defenders garrisoned');

        const attacker1 = sim.spawnUnit({ x: tower.x + 15, y: tower.y }, UnitType.Swordsman1, 1);
        moveUnit(sim, attacker1, tower);

        waitForSiegeStarted(sim, towerId, 'siege started');

        const siege = getSiege(sim, towerId)!;
        expect(siege.activeDefenderId).not.toBeNull();
        expect(sim.errors).toHaveLength(0);
    });

    it('ejected defender stays at the door and does not pursue', () => {
        sim = createSimulation({ skipTerritory: true });
        sim.establishTerritory(0);
        sim.establishTerritory(1);

        const towerId = sim.placeBuilding(BuildingType.GuardTowerBig, 0);
        const tower = sim.state.getEntityOrThrow(towerId, 'tower');
        const door = getBuildingDoorPos(tower, tower.race, tower.subType as BuildingType);

        const [def1, def2] = sim.spawnUnitNear(towerId, UnitType.Swordsman1, 2, 0);
        garrisonUnits(sim, towerId, [def1!, def2!]);
        waitForGarrisoned(sim, towerId, 2, 'defenders garrisoned');

        const attackerId = sim.spawnUnit({ x: tower.x + 5, y: tower.y }, UnitType.Swordsman1, 1);
        moveUnit(sim, attackerId, tower);

        waitForSiegeStarted(sim, towerId, 'siege reached fighting phase');

        const siege = getSiege(sim, towerId)!;
        expect(siege.activeDefenderId).not.toBeNull();
        expect([def1, def2]).toContain(siege.activeDefenderId);
        expect(garrisonedCount(sim, towerId)).toBe(1);

        // Defender must stay at the door, not chase
        sim.runTicks(200);
        const defender = sim.state.getEntityOrThrow(siege.activeDefenderId!, 'defender');
        const distFromDoor = Math.max(Math.abs(defender.x - door.x), Math.abs(defender.y - door.y));
        expect(distFromDoor).toBeLessThanOrEqual(1);
        expect(sim.errors).toHaveLength(0);
    });

    it('defenders are ejected one at a time — next only after first dies', () => {
        sim = createSimulation({ skipTerritory: true });
        sim.establishTerritory(0);
        sim.establishTerritory(1);

        const towerId = sim.placeBuilding(BuildingType.GuardTowerBig, 0);
        const tower = sim.state.getEntityOrThrow(towerId, 'tower');

        const defenders = sim.spawnUnitNear(towerId, UnitType.Swordsman1, 3, 0);
        garrisonUnits(sim, towerId, defenders);
        waitForGarrisoned(sim, towerId, 3, 'defenders garrisoned');

        const atk1 = sim.spawnUnit({ x: tower.x + 5, y: tower.y }, UnitType.Swordsman3, 1);
        const atk2 = sim.spawnUnit({ x: tower.x + 6, y: tower.y }, UnitType.Swordsman3, 1);
        moveUnit(sim, atk1, tower);
        moveUnit(sim, atk2, tower);

        waitForSiegeStarted(sim, towerId, 'fighting started');

        const firstDefenderId = getSiege(sim, towerId)!.activeDefenderId!;
        expect(garrisonedCount(sim, towerId)).toBe(2);

        sim.runUntil(() => sim.state.getEntity(firstDefenderId) === undefined, {
            maxTicks: 15_000,
            label: 'first defender killed',
        });

        const siege = getSiege(sim, towerId);
        if (siege) {
            expect(siege.activeDefenderId).not.toBe(firstDefenderId);
            expect(garrisonedCount(sim, towerId)).toBe(1);
        }
        expect(sim.errors).toHaveLength(0);
    });

    it('attackers defeat all defenders and capture the tower', () => {
        sim = createSimulation({ skipTerritory: true });
        sim.establishTerritory(0);
        sim.establishTerritory(1);

        const towerId = sim.placeBuilding(BuildingType.GuardTowerSmall, 0);
        const tower = sim.state.getEntityOrThrow(towerId, 'tower');

        const defSw = sim.spawnUnitNear(towerId, UnitType.Swordsman1, 1, 0)[0]!;
        const defBw = sim.spawnUnitNear(towerId, UnitType.Bowman1, 1, 0)[0]!;
        garrisonUnits(sim, towerId, [defSw, defBw]);
        waitForGarrisoned(sim, towerId, 2, 'defenders garrisoned');

        const attackers = [
            sim.spawnUnit({ x: tower.x + 5, y: tower.y }, UnitType.Swordsman3, 1),
            sim.spawnUnit({ x: tower.x + 6, y: tower.y }, UnitType.Swordsman3, 1),
            sim.spawnUnit({ x: tower.x + 7, y: tower.y }, UnitType.Swordsman3, 1),
        ];

        for (const atkId of attackers) {
            moveUnit(sim, atkId, tower);
        }

        waitForSiegeStarted(sim, towerId, 'siege started');
        waitForBuildingCaptured(sim, towerId, 1, 'tower captured');

        const capturedTower = sim.state.getEntityOrThrow(towerId, 'captured tower');
        expect(capturedTower.player).toBe(1);
        // The capturing unit is now garrisoned inside the tower
        expect(garrisonedCount(sim, towerId)).toBe(1);

        const g = getGarrison(sim, towerId);
        expect(g).toBeDefined();
        expect(sim.errors).toHaveLength(0);
    });
});

// ─── Siege edge cases ─────────────────────────────────────────────────────────

describe('Building siege – edge cases', { timeout: 60_000 }, () => {
    let sim: Simulation;

    afterEach(() => {
        sim?.destroy();
        cleanupSimulation();
    });

    it('multiple attackers help capture a tower', () => {
        sim = createSimulation({ skipTerritory: true });
        sim.establishTerritory(0);
        sim.establishTerritory(1);

        const towerId = sim.placeBuilding(BuildingType.GuardTowerBig, 0);
        const tower = sim.state.getEntityOrThrow(towerId, 'tower');

        const defenders = sim.spawnUnitNear(towerId, UnitType.Swordsman1, 3, 0);
        garrisonUnits(sim, towerId, defenders);
        waitForGarrisoned(sim, towerId, 3, 'defenders garrisoned');

        // Send two strong attackers — combat system handles the fighting
        const atk1 = sim.spawnUnit({ x: tower.x + 5, y: tower.y }, UnitType.Swordsman3, 1);
        const atk2 = sim.spawnUnit({ x: tower.x + 6, y: tower.y }, UnitType.Swordsman3, 1);
        moveUnit(sim, atk1, tower);
        moveUnit(sim, atk2, tower);

        waitForSiegeStarted(sim, towerId, 'siege started');
        waitForBuildingCaptured(sim, towerId, 1, 'tower captured');

        const capturedTower = sim.state.getEntityOrThrow(towerId, 'captured tower');
        expect(capturedTower.player).toBe(1);
        expect(sim.errors).toHaveLength(0);
    });

    it('siege is cancelled when building is destroyed', () => {
        sim = createSimulation({ skipTerritory: true });
        sim.establishTerritory(0);
        sim.establishTerritory(1);

        const towerId = sim.placeBuilding(BuildingType.GuardTowerBig, 0);
        const tower = sim.state.getEntityOrThrow(towerId, 'tower');

        const defId = sim.spawnUnitNear(towerId, UnitType.Swordsman1, 1, 0)[0]!;
        garrisonUnits(sim, towerId, [defId]);
        waitForGarrisoned(sim, towerId, 1, 'defender garrisoned');

        const atkId = sim.spawnUnit({ x: tower.x + 5, y: tower.y }, UnitType.Swordsman1, 1);
        moveUnit(sim, atkId, tower);
        waitForSiegeStarted(sim, towerId, 'siege started');

        sim.execute({ type: 'remove_entity', entityId: towerId });

        expect(getSiege(sim, towerId)).toBeUndefined();
        expect(sim.errors).toHaveLength(0);
    });

    it('non-swordsman units do not trigger siege', () => {
        sim = createSimulation({ skipTerritory: true });
        sim.establishTerritory(0);
        sim.establishTerritory(1);

        const towerId = sim.placeBuilding(BuildingType.GuardTowerSmall, 0);
        const tower = sim.state.getEntityOrThrow(towerId, 'tower');

        const defId = sim.spawnUnitNear(towerId, UnitType.Swordsman1, 1, 0)[0]!;
        garrisonUnits(sim, towerId, [defId]);
        waitForGarrisoned(sim, towerId, 1, 'defender garrisoned');

        const bowmanId = sim.spawnUnit({ x: tower.x + 5, y: tower.y }, UnitType.Bowman1, 1);
        moveUnit(sim, bowmanId, tower);
        sim.runTicks(500);

        expect(getSiege(sim, towerId)).toBeUndefined();
        expect(sim.errors).toHaveLength(0);
    });

    it('swordsman at distance 1 from door triggers siege immediately', () => {
        sim = createSimulation({ skipTerritory: true });
        sim.establishTerritory(0);
        sim.establishTerritory(1);

        const towerId = sim.placeBuilding(BuildingType.GuardTowerSmall, 0);
        const tower = sim.state.getEntityOrThrow(towerId, 'tower');
        const door = getBuildingDoorPos(tower, tower.race, tower.subType as BuildingType);

        const defId = sim.spawnUnitNear(towerId, UnitType.Swordsman1, 1, 0)[0]!;
        garrisonUnits(sim, towerId, [defId]);
        waitForGarrisoned(sim, towerId, 1, 'defender garrisoned');

        // Place attacker exactly 1 tile from door (adjacent) — should trigger siege
        sim.spawnUnit({ x: door.x + 1, y: door.y }, UnitType.Swordsman1, 1);

        waitForSiegeStarted(sim, towerId, 'siege started from adjacent tile');
        expect(sim.errors).toHaveLength(0);
    });

    it('swordsman at distance 2 from door does not immediately trigger siege', () => {
        sim = createSimulation({ skipTerritory: true });
        sim.establishTerritory(0);
        sim.establishTerritory(1);

        const towerId = sim.placeBuilding(BuildingType.GuardTowerSmall, 0);
        const tower = sim.state.getEntityOrThrow(towerId, 'tower');
        const door = getBuildingDoorPos(tower, tower.race, tower.subType as BuildingType);

        const defId = sim.spawnUnitNear(towerId, UnitType.Swordsman1, 1, 0)[0]!;
        garrisonUnits(sim, towerId, [defId]);
        waitForGarrisoned(sim, towerId, 1, 'defender garrisoned');

        // Place attacker 2 tiles from door — outside DOOR_ARRIVAL_DISTANCE
        expect(DOOR_ARRIVAL_DISTANCE).toBe(1);
        const atkId = sim.spawnUnit({ x: door.x + 2, y: door.y }, UnitType.Swordsman1, 1);

        // Run a few tick cycles — siege should NOT start yet (unit is too far)
        sim.runTicks(50);
        expect(getSiege(sim, towerId)).toBeUndefined();

        // The unit should have been redirected toward the door
        const atk = sim.state.getEntityOrThrow(atkId, 'attacker');
        const controller = sim.state.movement.getController(atkId);
        const isMovingOrArrived =
            (controller && controller.state !== 'idle') ||
            Math.max(Math.abs(atk.x - door.x), Math.abs(atk.y - door.y)) <= DOOR_ARRIVAL_DISTANCE;
        expect(isMovingOrArrived).toBe(true);

        expect(sim.errors).toHaveLength(0);
    });

    it('attacker does not stand on the door tile', () => {
        sim = createSimulation({ skipTerritory: true });
        sim.establishTerritory(0);
        sim.establishTerritory(1);

        const towerId = sim.placeBuilding(BuildingType.GuardTowerSmall, 0);
        const tower = sim.state.getEntityOrThrow(towerId, 'tower');
        const door = getBuildingDoorPos(tower, tower.race, tower.subType as BuildingType);

        const defId = sim.spawnUnitNear(towerId, UnitType.Swordsman1, 1, 0)[0]!;
        garrisonUnits(sim, towerId, [defId]);
        waitForGarrisoned(sim, towerId, 1, 'defender garrisoned');

        const atkId = sim.spawnUnit({ x: tower.x + 5, y: tower.y }, UnitType.Swordsman1, 1);
        moveUnit(sim, atkId, tower);

        waitForSiegeStarted(sim, towerId, 'siege started');

        // Let the attacker settle into position
        sim.runTicks(100);
        const atk = sim.state.getEntity(atkId);
        if (atk && !atk.hidden) {
            const onDoor = atk.x === door.x && atk.y === door.y;
            expect(onDoor, `attacker at (${atk.x},${atk.y}) should not be on door (${door.x},${door.y})`).toBe(false);
        }
        expect(sim.errors).toHaveLength(0);
    });

    it('idle enemy swordsmen near a tower are auto-detected for siege', () => {
        sim = createSimulation({ skipTerritory: true });
        sim.establishTerritory(0);
        sim.establishTerritory(1);

        const towerId = sim.placeBuilding(BuildingType.GuardTowerSmall, 0);
        const tower = sim.state.getEntityOrThrow(towerId, 'tower');

        const defId = sim.spawnUnitNear(towerId, UnitType.Swordsman1, 1, 0)[0]!;
        garrisonUnits(sim, towerId, [defId]);
        waitForGarrisoned(sim, towerId, 1, 'defender garrisoned');

        sim.spawnUnit({ x: tower.x + 3, y: tower.y }, UnitType.Swordsman1, 1);

        waitForSiegeStarted(sim, towerId, 'idle swordsman auto-detected');

        expect(sim.errors).toHaveLength(0);
    });
});

// ─── Territory recalculation on capture ──────────────────────────────────────

describe('Building siege – territory update on capture', { timeout: 60_000 }, () => {
    let sim: Simulation;

    afterEach(() => {
        sim?.destroy();
        cleanupSimulation();
    });

    it('captured tower projects territory for the new owner', () => {
        sim = createSimulation({ skipTerritory: true });

        // Place a guard tower for player 0 as the ONLY territory source
        // (no establishTerritory — the tower itself defines the territory)
        const towerId = sim.placeBuilding(BuildingType.GuardTowerSmall, 0);
        const tower = sim.state.getEntityOrThrow(towerId, 'tower');

        const tm = sim.services.territoryManager;
        expect(tm.getOwner({ x: tower.x, y: tower.y })).toBe(0);

        // Garrison a weak defender, send strong attackers to capture
        const defId = sim.spawnUnitNear(towerId, UnitType.Swordsman1, 1, 0)[0]!;
        garrisonUnits(sim, towerId, [defId]);
        waitForGarrisoned(sim, towerId, 1, 'defender garrisoned');

        const attackers = [
            sim.spawnUnit({ x: tower.x + 5, y: tower.y }, UnitType.Swordsman3, 1),
            sim.spawnUnit({ x: tower.x + 6, y: tower.y }, UnitType.Swordsman3, 1),
        ];
        for (const atkId of attackers) {
            moveUnit(sim, atkId, tower);
        }

        waitForSiegeStarted(sim, towerId, 'siege started');
        waitForBuildingCaptured(sim, towerId, 1, 'tower captured');

        // Building should now belong to player 1
        const capturedTower = sim.state.getEntityOrThrow(towerId, 'captured tower');
        expect(capturedTower.player).toBe(1);

        // Territory near the tower should now belong to player 1
        expect(tm.getOwner({ x: tower.x, y: tower.y })).toBe(1);

        expect(sim.errors).toHaveLength(0);
    });

    it('placing a second tower nearby does not shrink the first tower territory', () => {
        sim = createSimulation({ skipTerritory: true });

        // Player 0 places a tower first
        const tower0Id = sim.placeBuilding(BuildingType.GuardTowerSmall, 0);
        const tower0 = sim.state.getEntityOrThrow(tower0Id, 'tower0');
        const tm = sim.services.territoryManager;

        // Snapshot ALL tiles owned by player 0 before the second tower is placed
        const player0TilesBefore: Tile[] = [];
        for (let dx = -60; dx <= 60; dx++) {
            for (let dy = -60; dy <= 60; dy++) {
                const tx = tower0.x + dx;
                const ty = tower0.y + dy;
                if (tm.isInTerritory({ x: tx, y: ty }, 0)) {
                    player0TilesBefore.push({ x: tx, y: ty });
                }
            }
        }
        expect(player0TilesBefore.length).toBeGreaterThan(0);

        // Player 1 places a tower nearby — close enough that territory circles overlap
        // GuardTowerSmall radius is 55; offset 30 ensures significant overlap
        const tower1Id = sim.placeBuildingAt(tower0.x + 30, tower0.y, BuildingType.GuardTowerSmall, 1);
        expect(sim.state.getEntity(tower1Id)).toBeDefined();

        // Player 1 should have territory near their own tower
        expect(tm.isInTerritory({ x: tower0.x + 30, y: tower0.y }, 1)).toBe(true);

        // Every tile that was player 0's territory must still belong to player 0
        const lost: (Tile & { nowOwner: number })[] = [];
        for (const tile of player0TilesBefore) {
            const owner = tm.getOwner(tile);
            if (owner !== 0) {
                lost.push({ ...tile, nowOwner: owner });
            }
        }
        expect(lost).toHaveLength(0);

        expect(sim.errors).toHaveLength(0);
    });
});
