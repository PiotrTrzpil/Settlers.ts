/**
 * Integration tests for Dark Tribe tower assault.
 *
 * Dark Tribe swordsmen cannot siege towers (eject-and-capture).
 * Instead, they attack the tower structure directly, dealing damage over time.
 * When the tower's health reaches 0 it is destroyed and garrisoned units die.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { Simulation, createSimulation, cleanupSimulation } from '../../helpers/test-simulation';
import { installRealGameData } from '../../helpers/test-game-data';
import { UnitType } from '@/game/entity';
import { BuildingType } from '@/game/buildings';
import { Race } from '@/game/core/race';
import type { Tile } from '@/game/core/coordinates';

installRealGameData();

// ─── helpers ─────────────────────────────────────────────────────────────────

function garrisonUnits(sim: Simulation, buildingId: number, unitIds: number[]) {
    return sim.execute({ type: 'garrison_units', buildingId, unitIds });
}

function moveUnit(sim: Simulation, entityId: number, tile: Tile) {
    return sim.execute({ type: 'move_unit', entityId, targetX: tile.x, targetY: tile.y });
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

function waitForBuildingDestroyed(sim: Simulation, buildingId: number, label: string): void {
    sim.runUntil(() => sim.state.getEntity(buildingId) === undefined, {
        maxTicks: 30_000,
        label,
        diagnose: () => {
            const hp = sim.services.towerAssaultSystem.healthTracker.getHealth(buildingId);
            return `health=${hp?.health ?? 'none'}, assault=${sim.services.towerAssaultSystem.getAssault(buildingId) ? 'active' : 'none'}`;
        },
    });
}

/** Spawn a Dark Tribe swordsman for player 1. */
function spawnDarkTribeSwordsman(sim: Simulation, tile: Tile): number {
    return sim.spawnUnit(tile, UnitType.Swordsman1, 1, Race.DarkTribe);
}

// ─── Dark Tribe tower assault ────────────────────────────────────────────────

describe('Dark Tribe tower assault', { timeout: 60_000 }, () => {
    let sim: Simulation;

    afterEach(() => {
        sim?.destroy();
        cleanupSimulation();
    });

    it('dark tribe swordsmen destroy a tower instead of sieging it', () => {
        sim = createSimulation({ skipTerritory: true, race1: Race.DarkTribe });
        sim.establishTerritory(0);

        const towerId = sim.placeBuilding(BuildingType.GuardTowerSmall, 0);
        const tower = sim.state.getEntityOrThrow(towerId, 'tower');

        // Send multiple strong dark tribe swordsmen
        const atk1 = spawnDarkTribeSwordsman(sim, { x: tower.x + 5, y: tower.y });
        const atk2 = spawnDarkTribeSwordsman(sim, { x: tower.x + 6, y: tower.y });
        moveUnit(sim, atk1, { x: tower.x, y: tower.y });
        moveUnit(sim, atk2, { x: tower.x, y: tower.y });

        waitForBuildingDestroyed(sim, towerId, 'tower destroyed by dark tribe');

        // Tower should be gone
        expect(sim.state.getEntity(towerId)).toBeUndefined();

        // No siege should have been created (dark tribe bypasses siege)
        expect(sim.services.siegeSystem.getSiege(towerId)).toBeUndefined();
        expect(sim.errors).toHaveLength(0);
    });

    it('dark tribe does NOT capture — no ownership change, just destruction', () => {
        sim = createSimulation({ skipTerritory: true, race1: Race.DarkTribe });
        sim.establishTerritory(0);

        const towerId = sim.placeBuilding(BuildingType.GuardTowerSmall, 0);
        const tower = sim.state.getEntityOrThrow(towerId, 'tower');

        let ownerChanged = false;
        sim.eventBus.on('building:ownerChanged', () => {
            ownerChanged = true;
        });

        const atkId = spawnDarkTribeSwordsman(sim, { x: tower.x + 5, y: tower.y });
        moveUnit(sim, atkId, { x: tower.x, y: tower.y });

        waitForBuildingDestroyed(sim, towerId, 'tower destroyed');

        expect(ownerChanged).toBe(false);
        expect(sim.errors).toHaveLength(0);
    });

    it('garrisoned units die when the tower is destroyed', () => {
        sim = createSimulation({ skipTerritory: true, race1: Race.DarkTribe });
        sim.establishTerritory(0);

        const towerId = sim.placeBuilding(BuildingType.GuardTowerSmall, 0);
        const tower = sim.state.getEntityOrThrow(towerId, 'tower');

        // Garrison a defender
        const defId = sim.spawnUnitNear(towerId, UnitType.Swordsman1, 1, 0)[0]!;
        garrisonUnits(sim, towerId, [defId]);
        waitForGarrisoned(sim, towerId, 1, 'defender garrisoned');

        // Send dark tribe attackers
        const atk1 = spawnDarkTribeSwordsman(sim, { x: tower.x + 5, y: tower.y });
        const atk2 = spawnDarkTribeSwordsman(sim, { x: tower.x + 6, y: tower.y });
        moveUnit(sim, atk1, { x: tower.x, y: tower.y });
        moveUnit(sim, atk2, { x: tower.x, y: tower.y });

        waitForBuildingDestroyed(sim, towerId, 'tower destroyed with garrison');

        // Garrisoned defender should be dead
        expect(sim.state.getEntity(defId)).toBeUndefined();
        expect(sim.errors).toHaveLength(0);
    });

    it('territory is preserved after dark tribe destroys the tower', () => {
        sim = createSimulation({ skipTerritory: true, race1: Race.DarkTribe });

        // Place a tower as the ONLY territory source for player 0
        const towerId = sim.placeBuilding(BuildingType.GuardTowerSmall, 0);
        const tower = sim.state.getEntityOrThrow(towerId, 'tower');
        const tm = sim.services.territoryManager;

        // Tower should generate territory
        expect(tm.getOwner({ x: tower.x, y: tower.y })).toBe(0);

        const atkId = spawnDarkTribeSwordsman(sim, { x: tower.x + 5, y: tower.y });
        moveUnit(sim, atkId, { x: tower.x, y: tower.y });

        waitForBuildingDestroyed(sim, towerId, 'tower destroyed');

        // Territory should still belong to player 0
        expect(tm.getOwner({ x: tower.x, y: tower.y })).toBe(0);
        expect(sim.errors).toHaveLength(0);
    });

    it('attackers are released after the tower is destroyed', () => {
        sim = createSimulation({ skipTerritory: true, race1: Race.DarkTribe });
        sim.establishTerritory(0);

        const towerId = sim.placeBuilding(BuildingType.GuardTowerSmall, 0);
        const tower = sim.state.getEntityOrThrow(towerId, 'tower');

        const atkId = spawnDarkTribeSwordsman(sim, { x: tower.x + 5, y: tower.y });
        moveUnit(sim, atkId, { x: tower.x, y: tower.y });

        waitForBuildingDestroyed(sim, towerId, 'tower destroyed');

        // Attacker should still be alive and no longer reserved
        const atk = sim.state.getEntity(atkId);
        expect(atk).toBeDefined();
        expect(sim.services.towerAssaultSystem.getAssault(towerId)).toBeUndefined();
        expect(sim.errors).toHaveLength(0);
    });
});
