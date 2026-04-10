/**
 * Integration tests for territory change consequences.
 *
 * When territory ownership changes (tower captured or destroyed), non-military
 * buildings of the losing player are destroyed and civilian settlers are
 * displaced to the nearest remaining friendly territory.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { Simulation, createSimulation, cleanupSimulation } from '../../helpers/test-simulation';
import { installRealGameData } from '../../helpers/test-game-data';
import { UnitType } from '@/game/entity';
import { BuildingType } from '@/game/buildings';

installRealGameData();

// ─── helpers ─────────────────────────────────────────────────────────────────

function captureTower(sim: Simulation, buildingId: number, newPlayer: number): void {
    sim.execute({ type: 'capture_building', buildingId, newPlayer });
}

/**
 * Trigger lazy territory recompute (via query) and run enough ticks for the
 * deferred handler (scheduled 1 tick ahead) to execute.
 */
function processConsequences(sim: Simulation): void {
    sim.services.territoryManager.getOwner({ x: 0, y: 0 });
    sim.runTicks(3);
}

/**
 * Ensure the territory grid is computed with current building state.
 * Must be called before any capture/destroy so the recompute can detect
 * the old→new ownership change (lazy grid starts all-zeros otherwise).
 */
function ensureTerritoryComputed(sim: Simulation): void {
    sim.services.territoryManager.getOwner({ x: 0, y: 0 });
}

// ─── Building destruction on lost territory ──────────────────────────────────

describe('Territory consequences – building destruction', { timeout: 60_000 }, () => {
    let sim: Simulation;

    afterEach(() => {
        sim?.destroy();
        cleanupSimulation();
    });

    it('non-military building is destroyed when territory is captured', () => {
        sim = createSimulation({ skipTerritory: true });

        const towerId = sim.placeBuilding(BuildingType.GuardTowerSmall, 0);
        const tm = sim.services.territoryManager;

        const woodcutterId = sim.placeBuilding(BuildingType.WoodcutterHut, 0);
        const wc = sim.state.getEntityOrThrow(woodcutterId, 'woodcutter');
        expect(tm.isInTerritory({ x: wc.x, y: wc.y }, 0)).toBe(true);

        captureTower(sim, towerId, 1);
        processConsequences(sim);

        expect(sim.state.getEntity(woodcutterId)).toBeUndefined();
        expect(sim.errors).toHaveLength(0);
    });

    it('multiple economic buildings are destroyed on captured territory', () => {
        sim = createSimulation({ skipTerritory: true });

        const towerId = sim.placeBuilding(BuildingType.GuardTowerSmall, 0);

        const b1 = sim.placeBuilding(BuildingType.WoodcutterHut, 0);
        const b2 = sim.placeBuilding(BuildingType.Sawmill, 0);
        const b3 = sim.placeBuilding(BuildingType.StonecutterHut, 0);

        ensureTerritoryComputed(sim);

        captureTower(sim, towerId, 1);
        processConsequences(sim);

        expect(sim.state.getEntity(b1)).toBeUndefined();
        expect(sim.state.getEntity(b2)).toBeUndefined();
        expect(sim.state.getEntity(b3)).toBeUndefined();
        expect(sim.errors).toHaveLength(0);
    });

    it('territory buildings (towers) are NOT destroyed by territory change', () => {
        sim = createSimulation({ skipTerritory: true });

        const tower1Id = sim.placeBuilding(BuildingType.GuardTowerSmall, 0);
        const tower1 = sim.state.getEntityOrThrow(tower1Id, 'tower1');
        const tower2Id = sim.placeBuildingAt(tower1.x + 8, tower1.y, BuildingType.GuardTowerSmall, 0);

        ensureTerritoryComputed(sim);

        captureTower(sim, tower1Id, 1);
        processConsequences(sim);

        expect(sim.state.getEntity(tower2Id)).toBeDefined();
        expect(sim.state.getEntity(tower2Id)!.player).toBe(0);
        expect(sim.errors).toHaveLength(0);
    });

    it('building on territory that becomes unclaimed is also destroyed', () => {
        sim = createSimulation({ skipTerritory: true });

        const towerId = sim.placeBuilding(BuildingType.GuardTowerSmall, 0);
        const tm = sim.services.territoryManager;

        const woodcutterId = sim.placeBuilding(BuildingType.WoodcutterHut, 0);
        const wc = sim.state.getEntityOrThrow(woodcutterId, 'woodcutter');
        expect(tm.isInTerritory({ x: wc.x, y: wc.y }, 0)).toBe(true);

        sim.removeBuilding(towerId);
        processConsequences(sim);

        expect(tm.getOwner({ x: wc.x, y: wc.y })).toBe(-1);
        expect(sim.state.getEntity(woodcutterId)).toBeUndefined();
        expect(sim.errors).toHaveLength(0);
    });

    it('building under another tower survives when only the near tower is captured', () => {
        sim = createSimulation({ skipTerritory: true });

        // Two towers for player 0 — far apart so each has exclusive territory
        const nearTowerId = sim.placeBuilding(BuildingType.GuardTowerSmall, 0);
        const nearTower = sim.state.getEntityOrThrow(nearTowerId, 'nearTower');
        const farTowerId = sim.placeBuildingAt(nearTower.x + 20, nearTower.y, BuildingType.GuardTowerSmall, 0);
        const farTower = sim.state.getEntityOrThrow(farTowerId, 'farTower');

        // Place a building near the FAR tower (safe territory, outside footprint)
        const safeBuilding = sim.placeBuildingAt(farTower.x - 10, farTower.y, BuildingType.WoodcutterHut, 0);
        // Place a building near the NEAR tower (will be lost)
        const lostBuilding = sim.placeBuilding(BuildingType.Sawmill, 0);

        const tm = sim.services.territoryManager;
        const safe = sim.state.getEntityOrThrow(safeBuilding, 'safe building');
        expect(tm.isInTerritory({ x: safe.x, y: safe.y }, 0)).toBe(true);

        captureTower(sim, nearTowerId, 1);
        processConsequences(sim);

        // Building under the far tower survives — still in player 0's territory
        expect(sim.state.getEntity(safeBuilding)).toBeDefined();
        expect(tm.isInTerritory({ x: safe.x, y: safe.y }, 0)).toBe(true);

        // Building near the captured tower is destroyed
        expect(sim.state.getEntity(lostBuilding)).toBeUndefined();
        expect(sim.errors).toHaveLength(0);
    });

    it('captured tower footprint shows boundary dots for the new owner', () => {
        sim = createSimulation({ skipTerritory: true, mapWidth: 256, mapHeight: 256 });

        // Player 0 has their own territory far away
        sim.placeBuildingAt(30, 128, BuildingType.GuardTowerSmall, 0);

        // Player 1 has a strong tower covering the contested area
        sim.placeBuildingAt(128, 128, BuildingType.Castle, 1);

        // Player 1 also has a small tower nearby — this will be captured
        const targetTowerId = sim.placeBuildingAt(148, 128, BuildingType.GuardTowerSmall, 1);
        const targetTower = sim.state.getEntityOrThrow(targetTowerId, 'targetTower');

        const tm = sim.services.territoryManager;
        ensureTerritoryComputed(sim);

        // Surrounding area belongs to player 1 (strong tower holds it)
        expect(tm.getOwner({ x: targetTower.x + 3, y: targetTower.y })).toBe(1);
        expect(tm.getOwner({ x: targetTower.x - 3, y: targetTower.y })).toBe(1);

        // Player 0 captures the small tower
        captureTower(sim, targetTowerId, 0);

        // The footprint itself must belong to player 0
        expect(tm.getOwner({ x: targetTower.x, y: targetTower.y })).toBe(0);
        // Nearby tiles still belong to player 1 (footprint is an island)
        expect(tm.getOwner({ x: targetTower.x + 5, y: targetTower.y })).toBe(1);
        expect(tm.getOwner({ x: targetTower.x - 5, y: targetTower.y })).toBe(1);

        // Boundary dots must include player 0 dots ON the footprint border
        const dots = tm.getBoundaryDots();
        const footprintDots = dots.filter(
            d => d.player === 0 && Math.abs(d.x - targetTower.x) <= 4 && Math.abs(d.y - targetTower.y) <= 4
        );
        expect(footprintDots.length).toBeGreaterThan(0);
        expect(sim.errors).toHaveLength(0);
    });

    it('buildings of the capturing player are NOT destroyed', () => {
        sim = createSimulation({ skipTerritory: true });

        const tower1Id = sim.placeBuilding(BuildingType.GuardTowerSmall, 1);
        const tower1 = sim.state.getEntityOrThrow(tower1Id, 'tower1');

        const tower0Id = sim.placeBuildingAt(tower1.x + 30, tower1.y, BuildingType.GuardTowerSmall, 0);

        const p1Building = sim.placeBuilding(BuildingType.WoodcutterHut, 1);

        ensureTerritoryComputed(sim);

        captureTower(sim, tower0Id, 1);
        processConsequences(sim);

        expect(sim.state.getEntity(p1Building)).toBeDefined();
        expect(sim.errors).toHaveLength(0);
    });
});

// ─── Settler displacement on lost territory ──────────────────────────────────

describe('Territory consequences – settler displacement', { timeout: 60_000 }, () => {
    let sim: Simulation;

    afterEach(() => {
        sim?.destroy();
        cleanupSimulation();
    });

    it('civilian settler is displaced toward friendly territory after capture', () => {
        sim = createSimulation({ skipTerritory: true });

        const nearTowerId = sim.placeBuilding(BuildingType.GuardTowerSmall, 0);
        const nearTower = sim.state.getEntityOrThrow(nearTowerId, 'nearTower');
        sim.placeBuildingAt(nearTower.x + 20, nearTower.y, BuildingType.GuardTowerSmall, 0);

        const tm = sim.services.territoryManager;
        const [carrierId] = sim.spawnUnitNear(nearTowerId, UnitType.Carrier, 1, 0);
        const startX = sim.state.getEntityOrThrow(carrierId!, 'carrier').x;
        expect(tm.isInTerritory({ x: startX, y: nearTower.y }, 0)).toBe(true);

        captureTower(sim, nearTowerId, 1);
        processConsequences(sim);

        sim.runUntil(
            () => {
                const c = sim.state.getEntity(carrierId!);
                return c !== undefined && c.x > startX;
            },
            { maxTicks: 2_000, label: 'carrier displaced toward friendly territory' }
        );

        expect(sim.state.getEntityOrThrow(carrierId!, 'carrier').x).toBeGreaterThan(startX);
        expect(sim.errors).toHaveLength(0);
    });

    it('military unit is NOT displaced after territory capture', () => {
        sim = createSimulation({ skipTerritory: true });

        const towerId = sim.placeBuilding(BuildingType.GuardTowerSmall, 0);

        const [swordsmanId] = sim.spawnUnitNear(towerId, UnitType.Swordsman1, 1, 0);
        const sw = sim.state.getEntityOrThrow(swordsmanId!, 'swordsman');
        const startX = sw.x;
        const startY = sw.y;

        ensureTerritoryComputed(sim);

        captureTower(sim, towerId, 1);
        processConsequences(sim);

        const after = sim.state.getEntityOrThrow(swordsmanId!, 'swordsman after');
        expect(after.x).toBe(startX);
        expect(after.y).toBe(startY);
        expect(sim.errors).toHaveLength(0);
    });

    it('building-assigned worker under surviving tower is NOT displaced', () => {
        sim = createSimulation({ skipTerritory: true });

        // Near tower (will be captured) and far tower (safe)
        const nearTowerId = sim.placeBuilding(BuildingType.GuardTowerSmall, 0);
        const nearTower = sim.state.getEntityOrThrow(nearTowerId, 'nearTower');
        const farTowerId = sim.placeBuildingAt(nearTower.x + 20, nearTower.y, BuildingType.GuardTowerSmall, 0);
        const farTower = sim.state.getEntityOrThrow(farTowerId, 'farTower');

        // Place woodcutter near the FAR tower (safe territory) so the building survives
        const wcId = sim.placeBuildingAt(farTower.x - 10, farTower.y, BuildingType.WoodcutterHut, 0);
        sim.plantTreesNear(wcId, 5);

        ensureTerritoryComputed(sim);

        // Let the woodcutter leave the building to chop a tree
        sim.runUntil(
            () => {
                const workers = sim.services.settlerTaskSystem.getWorkersForBuilding(wcId);
                for (const wId of workers) {
                    const w = sim.state.getEntity(wId);
                    if (w && !w.hidden) return true;
                }
                return false;
            },
            { maxTicks: 3_000, label: 'woodcutter left building' }
        );

        // Find the worker that's outside
        const workers = sim.services.settlerTaskSystem.getWorkersForBuilding(wcId);
        let outsideWorkerId: number | undefined;
        for (const wId of workers) {
            const w = sim.state.getEntity(wId);
            if (w && !w.hidden) {
                outsideWorkerId = wId;
                break;
            }
        }
        expect(outsideWorkerId).toBeDefined();

        captureTower(sim, nearTowerId, 1);
        processConsequences(sim);

        // Worker assigned to surviving building should still exist and remain assigned
        expect(sim.state.getEntity(outsideWorkerId!)).toBeDefined();
        expect(sim.services.settlerTaskSystem.getAssignedBuilding(outsideWorkerId!)).toBe(wcId);
        expect(sim.errors).toHaveLength(0);
    });

    it('worker dies when no friendly territory is nearby', () => {
        sim = createSimulation({ skipTerritory: true });

        // Player 0 has a single tower — no other territory source
        const towerId = sim.placeBuilding(BuildingType.GuardTowerSmall, 0);

        const [carrierId] = sim.spawnUnitNear(towerId, UnitType.Carrier, 1, 0);

        ensureTerritoryComputed(sim);

        // Capture the only tower → player 0 has NO territory left
        captureTower(sim, towerId, 1);
        processConsequences(sim);

        // Carrier (worker category) should be dead — no friendly territory reachable
        expect(sim.state.getEntity(carrierId!)).toBeUndefined();
        expect(sim.errors).toHaveLength(0);
    });

    it('military unit survives even when no friendly territory exists', () => {
        sim = createSimulation({ skipTerritory: true });

        const towerId = sim.placeBuilding(BuildingType.GuardTowerSmall, 0);

        const [swordsmanId] = sim.spawnUnitNear(towerId, UnitType.Swordsman1, 1, 0);

        ensureTerritoryComputed(sim);

        captureTower(sim, towerId, 1);
        processConsequences(sim);

        // Military unit survives — not affected by territory loss
        expect(sim.state.getEntity(swordsmanId!)).toBeDefined();
        expect(sim.errors).toHaveLength(0);
    });

    it('settler on unclaimed territory is displaced', () => {
        sim = createSimulation({ skipTerritory: true });

        const nearTowerId = sim.placeBuilding(BuildingType.GuardTowerSmall, 0);
        const nearTower = sim.state.getEntityOrThrow(nearTowerId, 'nearTower');
        sim.placeBuildingAt(nearTower.x + 20, nearTower.y, BuildingType.GuardTowerSmall, 0);

        const tm = sim.services.territoryManager;
        const [carrierId] = sim.spawnUnitNear(nearTowerId, UnitType.Carrier, 1, 0);
        const startX = sim.state.getEntityOrThrow(carrierId!, 'carrier').x;
        expect(tm.isInTerritory({ x: startX, y: nearTower.y }, 0)).toBe(true);

        sim.removeBuilding(nearTowerId);
        processConsequences(sim);

        sim.runUntil(
            () => {
                const c = sim.state.getEntity(carrierId!);
                return c !== undefined && c.x > startX;
            },
            { maxTicks: 2_000, label: 'carrier displaced from unclaimed territory' }
        );

        expect(sim.state.getEntityOrThrow(carrierId!, 'carrier').x).toBeGreaterThan(startX);
        expect(sim.errors).toHaveLength(0);
    });
});
