/**
 * Integration tests for building worker auto-recruitment.
 *
 * When a building completes without spawnWorker (e.g. placed via command without
 * the spawnWorker flag), the RecruitSystem auto-recruits a carrier into the
 * building's required worker type — using the same demand-driven pipeline as
 * digger/builder auto-recruitment.
 *
 * Tests cover:
 *   - Tool-based worker (Woodcutter: carrier walks to AXE pile, transforms)
 *   - No-tool worker (Baker: carrier transforms in place)
 *   - No carrier available → demand stays pending, fulfilled once carrier spawns
 *   - Building destroyed before demand fulfilled → demand discarded
 */

import { describe, it, expect, afterEach } from 'vitest';
import { type Simulation, createSimulation, cleanupSimulation } from '../../helpers/test-simulation';
import { installRealGameData } from '../../helpers/test-game-data';
import { EntityType, UnitType } from '@/game/entity';
import { EMaterialType } from '@/game/economy/material-type';
import { BuildingType } from '@/game/buildings/building-type';

installRealGameData();

// ─── helpers ─────────────────────────────────────────────────────────────────

function findUnit(sim: Simulation, unitType: UnitType, player = 0): number {
    for (const e of sim.state.entities) {
        if (e.type === EntityType.Unit && e.subType === unitType && e.player === player) {
            return e.id;
        }
    }
    throw new Error(`No ${UnitType[unitType]} found for player ${player}`);
}

function diagnoseWorker(sim: Simulation, unitType: UnitType): string {
    return (
        `workers=${sim.countEntities(EntityType.Unit, unitType)} ` +
        `carriers=${sim.countEntities(EntityType.Unit, UnitType.Carrier)} ` +
        `pending=${sim.services.unitTransformer.getPendingCountByType(unitType)}`
    );
}

// ─── tests ───────────────────────────────────────────────────────────────────

describe('Building worker auto-recruitment (integration)', { timeout: 30_000 }, () => {
    let sim: Simulation;

    afterEach(() => {
        sim?.destroy();
        cleanupSimulation();
    });

    /**
     * Place a completed building without spawning its worker.
     * Uses the sim's placeBuilding to find a valid position, then removes the
     * spawned worker so we can test auto-recruitment from scratch.
     *
     * Alternative approach: we emit building:completed directly, but that
     * would skip the real placement pipeline. Instead, we place normally and
     * then test that auto-recruitment works for a building that lost its worker.
     *
     * Simplest approach: execute place_building at a valid position with spawnWorker=false.
     */
    function placeCompletedNoWorker(buildingType: BuildingType): number {
        // Place completed building without spawning worker — demand pipeline recruits one.
        return sim.placeBuilding(buildingType, 0, true, undefined, false);
    }

    // ─── Tool-based worker (Woodcutter needs AXE) ────────────────────────

    it('WoodcutterHut: carrier walks to AXE pile and transforms into Woodcutter', () => {
        sim = createSimulation();

        sim.spawnUnit(64, 60, UnitType.Carrier);
        sim.placeGoods(EMaterialType.AXE, 1);

        placeCompletedNoWorker(BuildingType.WoodcutterHut);

        sim.runUntil(() => sim.countEntities(EntityType.Unit, UnitType.Woodcutter) === 1, {
            maxTicks: 30_000,
            label: 'Woodcutter appears via auto-recruitment',
            diagnose: () => diagnoseWorker(sim, UnitType.Woodcutter),
        });

        expect(sim.countEntities(EntityType.Unit, UnitType.Woodcutter)).toBe(1);
        expect(sim.countEntities(EntityType.Unit, UnitType.Carrier)).toBe(0);
        expect(sim.errors).toHaveLength(0);
    });

    // ─── No-tool worker (Baker needs no tool) ────────────────────────────

    it('Bakery: carrier transforms into Baker in place (no tool needed)', () => {
        sim = createSimulation();

        sim.spawnUnit(64, 60, UnitType.Carrier);

        placeCompletedNoWorker(BuildingType.Bakery);

        sim.runUntil(() => sim.countEntities(EntityType.Unit, UnitType.Baker) === 1, {
            maxTicks: 3_000,
            label: 'Baker appears via auto-recruitment',
            diagnose: () => diagnoseWorker(sim, UnitType.Baker),
        });

        expect(sim.countEntities(EntityType.Unit, UnitType.Baker)).toBe(1);
        expect(sim.countEntities(EntityType.Unit, UnitType.Carrier)).toBe(0);
        expect(sim.errors).toHaveLength(0);
    });

    // ─── Another tool-based: Farmer needs SCYTHE ─────────────────────────

    it('GrainFarm: carrier walks to SCYTHE pile and transforms into Farmer', () => {
        sim = createSimulation();

        sim.spawnUnit(64, 60, UnitType.Carrier);
        sim.placeGoods(EMaterialType.SCYTHE, 1);

        placeCompletedNoWorker(BuildingType.GrainFarm);

        sim.runUntil(() => sim.countEntities(EntityType.Unit, UnitType.Farmer) === 1, {
            maxTicks: 30_000,
            label: 'Farmer appears via auto-recruitment',
            diagnose: () => diagnoseWorker(sim, UnitType.Farmer),
        });

        expect(sim.countEntities(EntityType.Unit, UnitType.Farmer)).toBe(1);
        expect(sim.countEntities(EntityType.Unit, UnitType.Carrier)).toBe(0);
        expect(sim.errors).toHaveLength(0);
    });

    // ─── No carrier available → demand retries ───────────────────────────

    it('demand stays pending when no carrier is available, fulfilled once one spawns', () => {
        sim = createSimulation();

        placeCompletedNoWorker(BuildingType.Bakery);

        // Run a few drain cycles — nothing should happen (no carriers)
        sim.runTicks(200);
        expect(sim.countEntities(EntityType.Unit, UnitType.Baker)).toBe(0);

        // Now spawn a carrier — demand should be fulfilled on next drain
        sim.spawnUnit(64, 60, UnitType.Carrier);

        sim.runUntil(() => sim.countEntities(EntityType.Unit, UnitType.Baker) === 1, {
            maxTicks: 3_000,
            label: 'Baker appears after carrier spawned',
            diagnose: () => diagnoseWorker(sim, UnitType.Baker),
        });

        expect(sim.countEntities(EntityType.Unit, UnitType.Baker)).toBe(1);
        expect(sim.countEntities(EntityType.Unit, UnitType.Carrier)).toBe(0);
        expect(sim.errors).toHaveLength(0);
    });

    // ─── Building destroyed → demand discarded ───────────────────────────

    it('demand is discarded when building is destroyed before fulfillment', () => {
        sim = createSimulation();

        const buildingId = placeCompletedNoWorker(BuildingType.Bakery);

        // Run a bit — no carriers so demand stays pending
        sim.runTicks(100);

        // Destroy the building
        sim.execute({ type: 'remove_entity', entityId: buildingId });

        // Now spawn a carrier — demand should be discarded (building gone)
        sim.spawnUnit(64, 60, UnitType.Carrier);
        sim.runTicks(200);

        expect(sim.countEntities(EntityType.Unit, UnitType.Baker)).toBe(0);
        expect(sim.countEntities(EntityType.Unit, UnitType.Carrier)).toBe(1);
        expect(sim.errors).toHaveLength(0);
    });

    // ─── Idle specialist claims vacant building ──────────────────────────

    it('idle specialist claims vacant building without carrier transformation', () => {
        sim = createSimulation();

        // Spawn an idle woodcutter (no home assignment)
        sim.spawnUnit(64, 60, UnitType.Woodcutter);

        // Place a completed WoodcutterHut — triggers building:completed demand
        placeCompletedNoWorker(BuildingType.WoodcutterHut);

        // The idle woodcutter should be assigned directly (no carrier needed)
        sim.runUntil(
            () => {
                const assigned = sim.services.settlerTaskSystem.getAssignedBuilding(findUnit(sim, UnitType.Woodcutter));
                return assigned !== null;
            },
            {
                maxTicks: 3_000,
                label: 'Idle woodcutter assigned to building',
                diagnose: () => diagnoseWorker(sim, UnitType.Woodcutter),
            }
        );

        // Woodcutter still exists (no transformation happened)
        expect(sim.countEntities(EntityType.Unit, UnitType.Woodcutter)).toBe(1);
        // No carriers were consumed
        expect(sim.countEntities(EntityType.Unit, UnitType.Carrier)).toBe(0);
        expect(sim.errors).toHaveLength(0);
    });

    // ─── workerLost event triggers re-recruitment ──────────────────────

    it('building:workerLost creates demand that recruits replacement via carrier', () => {
        sim = createSimulation();

        // Place building + carrier for initial baker
        const buildingId = placeCompletedNoWorker(BuildingType.Bakery);
        sim.spawnUnit(64, 60, UnitType.Carrier);

        // Wait for initial baker to be recruited
        sim.runUntil(() => sim.countEntities(EntityType.Unit, UnitType.Baker) === 1, {
            maxTicks: 3_000,
            label: 'Initial baker recruited',
        });

        const bakerId = findUnit(sim, UnitType.Baker);
        expect(sim.services.settlerTaskSystem.getAssignedBuilding(bakerId)).toBe(buildingId);

        // Spawn a spare carrier for re-recruitment
        sim.spawnUnit(64, 60, UnitType.Carrier);

        // Simulate worker loss by directly emitting building:workerLost
        sim.eventBus.emit('building:workerLost', {
            buildingId,
            buildingType: BuildingType.Bakery,
            unitId: bakerId,
            player: 0,
            race: sim.state.playerRaces.get(0)!,
        });

        // Demand should recruit the carrier into a new baker
        sim.runUntil(() => sim.countEntities(EntityType.Unit, UnitType.Baker) === 2, {
            maxTicks: 3_000,
            label: 'New baker recruited after workerLost event',
            diagnose: () => diagnoseWorker(sim, UnitType.Baker),
        });

        expect(sim.countEntities(EntityType.Unit, UnitType.Baker)).toBe(2);
        expect(sim.countEntities(EntityType.Unit, UnitType.Carrier)).toBe(0);
        expect(sim.errors).toHaveLength(0);
    });
});
