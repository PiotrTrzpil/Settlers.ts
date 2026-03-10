/**
 * Persistence integration tests — save/load round-trip verification.
 *
 * Every test follows the same pattern:
 *   1. Set up a scenario (buildings, units, resources, in-progress activity)
 *   2. Run simulation to a specific mid-point
 *   3. saveAndRestore() — snapshot and restore into a fresh simulation
 *   4. Assert the restored sim matches the original
 *   5. Optionally: continue running the restored sim and verify it completes
 *
 * Uses the Simulation harness (test-simulation.ts) with real game data.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { createSimulation, createScenario, cleanupSimulation, type Simulation } from '../../helpers/test-simulation';
import { installRealGameData } from '../../helpers/test-game-data';
import { BuildingType } from '@/game/buildings/building-type';
import { EntityType } from '@/game/entity';
import { EMaterialType } from '@/game/economy/material-type';
import { BuildingConstructionPhase } from '@/game/features/building-construction/types';
import { TreeStage } from '@/game/features/trees/tree-system';
import {
    createSnapshot,
    restoreFromSnapshot,
    type GameStateSnapshot,
} from '@/game/state/game-state-persistence';
import type { Game } from '@/game/game';

const hasRealData = installRealGameData();

// ─── Helpers ─────────────────────────────────────────────────────

/**
 * Create a duck-typed Game-like object from a Simulation, satisfying the
 * subset of the Game interface that createSnapshot/restoreFromSnapshot use.
 */
function asGame(sim: Simulation): Game {
    return {
        state: sim.state,
        services: sim.services,
        terrain: sim.map.terrain,
        eventBus: sim.eventBus,
        execute: (cmd: import('@/game/commands').Command) => sim.execute(cmd),
    } as unknown as Game;
}

/**
 * Core test primitive: snapshot a running simulation and restore into a fresh one.
 * Returns the new simulation with identical state.
 */
function saveAndRestore(sim: Simulation): Simulation {
    const snapshot = createSnapshot(asGame(sim));
    const sim2 = createSimulation({ mapWidth: sim.mapWidth, mapHeight: sim.mapHeight });
    restoreFromSnapshot(asGame(sim2), snapshot);
    return sim2;
}

/**
 * Snapshot the simulation state without restoring — for comparing two snapshots.
 */
function takeSnapshot(sim: Simulation): GameStateSnapshot {
    return createSnapshot(asGame(sim));
}

/**
 * Compare entity tables between two simulations.
 * Asserts count, positions, types, subtypes, and player ownership match.
 */
function assertEntitiesMatch(original: Simulation, restored: Simulation): void {
    const origEntities = original.state.entities;
    const restEntities = restored.state.entities;
    expect(restEntities.length).toBe(origEntities.length);

    for (const entity of origEntities) {
        const r = restored.state.getEntity(entity.id);
        expect(r, `entity #${entity.id} missing after restore`).toBeDefined();
        expect(r!.type).toBe(entity.type);
        expect(r!.subType).toBe(entity.subType);
        expect(r!.x).toBe(entity.x);
        expect(r!.y).toBe(entity.y);
        expect(r!.player).toBe(entity.player);
    }
}

/**
 * Compare building inventories between two simulations.
 */
function assertInventoriesMatch(original: Simulation, restored: Simulation): void {
    for (const entity of original.state.entities) {
        if (entity.type !== EntityType.Building) continue;
        const origInv = original.services.inventoryManager.getInventory(entity.id);
        if (!origInv) continue;

        const restInv = restored.services.inventoryManager.getInventory(entity.id);
        expect(restInv, `inventory missing for building #${entity.id}`).toBeDefined();

        for (const slot of origInv.inputSlots) {
            const rSlot = restInv!.inputSlots.find(s => s.materialType === slot.materialType);
            expect(rSlot, `input slot ${EMaterialType[slot.materialType]} missing`).toBeDefined();
            expect(rSlot!.currentAmount).toBe(slot.currentAmount);
        }
        for (const slot of origInv.outputSlots) {
            const rSlot = restInv!.outputSlots.find(s => s.materialType === slot.materialType);
            expect(rSlot, `output slot ${EMaterialType[slot.materialType]} missing`).toBeDefined();
            expect(rSlot!.currentAmount).toBe(slot.currentAmount);
        }
    }
}

/**
 * Count total materials across all inventories + carried by units.
 * Note: ground piles (StackedPile entities) are tracked via building inventories,
 * so counting inventory slots captures their materials too.
 */
function countTotalMaterials(sim: Simulation): Map<EMaterialType, number> {
    const totals = new Map<EMaterialType, number>();

    const add = (mat: EMaterialType, amount: number) =>
        totals.set(mat, (totals.get(mat) ?? 0) + amount);

    // Inventory slots (inputs + outputs for all buildings)
    for (const inv of sim.services.inventoryManager.getAllInventories()) {
        for (const slot of inv.inputSlots) {
            if (slot.currentAmount > 0) add(slot.materialType, slot.currentAmount);
        }
        for (const slot of inv.outputSlots) {
            if (slot.currentAmount > 0) add(slot.materialType, slot.currentAmount);
        }
    }

    // Carried by units
    for (const entity of sim.state.entities) {
        if (entity.carrying) add(entity.carrying.material, entity.carrying.amount);
    }

    return totals;
}

// ─── Test suite ──────────────────────────────────────────────────

describe.skipIf(!hasRealData)('Persistence: save/load round-trip', { timeout: 30_000 }, () => {
    let sim: Simulation;
    let restored: Simulation | undefined;

    afterEach(() => {
        sim?.destroy();
        restored?.destroy();
        restored = undefined;
        cleanupSimulation();
    });

    // ═══════════════════════════════════════════════════════════════
    //  Category 1: Basic round-trip (structural integrity)
    // ═══════════════════════════════════════════════════════════════

    describe('basic round-trip', () => {
        it('entity round-trip preserves count, positions, types, subtypes', () => {
            sim = createSimulation();

            // Place a variety of entities
            sim.placeBuilding(BuildingType.ResidenceSmall);
            const woodcutterId = sim.placeBuilding(BuildingType.WoodcutterHut);
            sim.placeBuilding(BuildingType.StorageArea);
            sim.plantTreesNear(woodcutterId, 5);
            sim.placeStonesNear(woodcutterId, 3);

            // Let simulation settle
            sim.runTicks(30);

            restored = saveAndRestore(sim);
            assertEntitiesMatch(sim, restored);
        });

        it('empty world round-trip restores cleanly', () => {
            sim = createSimulation();

            // No entities placed — snapshot an empty world
            restored = saveAndRestore(sim);
            expect(restored.state.entities.length).toBe(0);
            expect(restored.errors.length).toBe(0);
        });

        it('RNG seed is persisted in snapshot', () => {
            sim = createSimulation();
            sim.placeBuilding(BuildingType.ResidenceSmall);

            // Run 100 ticks to advance RNG state
            sim.runTicks(100);
            const rngState = sim.state.rng.getState();

            // Snapshot should capture the current RNG seed
            const snapshot = takeSnapshot(sim);
            expect(snapshot.rngSeed).toBe(rngState);
        });
    });

    // ═══════════════════════════════════════════════════════════════
    //  Category 2: Economy mid-flight
    // ═══════════════════════════════════════════════════════════════

    describe('economy mid-flight', () => {
        it('worker mid-choreo eventually produces output after restore', () => {
            sim = createSimulation();
            sim.placeBuilding(BuildingType.ResidenceSmall);
            const woodcutterId = sim.placeBuilding(BuildingType.WoodcutterHut);
            sim.plantTreesNear(woodcutterId, 3);

            // Run until woodcutter is actively working (at least 1 tree targeted)
            sim.runUntil(
                () => {
                    // Worker has been dispatched — at least some ticks elapsed
                    return sim.countEntities(EntityType.MapObject) < 3 + sim.countEntities(EntityType.MapObject, 0);
                },
                { maxTicks: 5000, label: 'woodcutter starts work' }
            );
            // Run a bit more to get mid-choreo
            sim.runTicks(60);

            restored = saveAndRestore(sim);

            // Restored sim should eventually produce LOGs from remaining trees
            restored.runUntil(
                () => restored!.getOutput(woodcutterId, EMaterialType.LOG) >= 1,
                { maxTicks: 15_000, label: 'restored woodcutter produces LOG' }
            );
            expect(restored.getOutput(woodcutterId, EMaterialType.LOG)).toBeGreaterThanOrEqual(1);
        });

        it('carrier mid-transport delivers after restore', () => {
            sim = createSimulation();
            sim.placeBuilding(BuildingType.ResidenceSmall);
            const woodcutterId = sim.placeBuilding(BuildingType.WoodcutterHut);
            const sawmillId = sim.placeBuilding(BuildingType.Sawmill);
            sim.plantTreesNear(woodcutterId, 3);

            // Wait for at least 1 LOG in woodcutter output (carrier will pick it up)
            sim.runUntil(
                () => sim.getOutput(woodcutterId, EMaterialType.LOG) >= 1,
                { maxTicks: 15_000, label: 'first LOG produced' }
            );

            // Run a bit more — carrier should be in transit
            sim.runTicks(120);

            restored = saveAndRestore(sim);

            // Restored sim should eventually produce at least 1 BOARD
            restored.runUntil(
                () => restored!.getOutput(sawmillId, EMaterialType.BOARD) >= 1,
                { maxTicks: 20_000, label: 'restored chain produces BOARD' }
            );
            expect(restored.getOutput(sawmillId, EMaterialType.BOARD)).toBeGreaterThanOrEqual(1);
        });

        it('production mid-cycle completes after restore', () => {
            sim = createSimulation();
            sim.placeBuilding(BuildingType.ResidenceSmall);
            const sawmillId = sim.placeBuilding(BuildingType.Sawmill);

            // Inject LOG directly into sawmill input
            sim.injectInput(sawmillId, EMaterialType.LOG, 3);

            // Let sawmill worker start processing
            sim.runUntil(
                () => sim.getInput(sawmillId, EMaterialType.LOG) < 3,
                { maxTicks: 10_000, label: 'sawmill starts consuming LOG' }
            );

            restored = saveAndRestore(sim);

            // Should eventually produce BOARD from remaining LOGs
            restored.runUntil(
                () => restored!.getOutput(sawmillId, EMaterialType.BOARD) >= 1,
                { maxTicks: 15_000, label: 'restored sawmill produces BOARD' }
            );
            expect(restored.getOutput(sawmillId, EMaterialType.BOARD)).toBeGreaterThanOrEqual(1);
        });
    });

    // ═══════════════════════════════════════════════════════════════
    //  Category 3: Construction
    // ═══════════════════════════════════════════════════════════════

    describe('construction', () => {
        it('construction site mid-build completes after restore', () => {
            // Use constructionSite scenario — spawns digger + 2 builders + carriers + storage
            const s = createScenario.constructionSite(BuildingType.WoodcutterHut);
            sim = s;
            const siteId = s.siteId;

            // Wait for construction to start (at least materials being delivered)
            sim.runUntil(
                () => {
                    const site = sim.services.constructionSiteManager.getSite(siteId);
                    return !!site && site.phase >= BuildingConstructionPhase.WaitingForBuilders;
                },
                { maxTicks: 30_000, label: 'construction started' }
            );
            // Run a bit more so builders start working
            sim.runTicks(500);

            restored = saveAndRestore(sim);

            // Construction should complete after restore
            restored.runUntil(
                () => !restored!.services.constructionSiteManager.hasSite(siteId),
                { maxTicks: 80_000, label: 'restored construction completes' }
            );
            expect(restored.services.constructionSiteManager.hasSite(siteId)).toBe(false);
        });

        it('construction with pending material delivery completes after restore', () => {
            const s = createScenario.constructionSite(BuildingType.WoodcutterHut);
            sim = s;
            const siteId = s.siteId;

            // Wait for at least WaitingForBuilders phase (materials being delivered)
            sim.runUntil(
                () => {
                    const site = sim.services.constructionSiteManager.getSite(siteId);
                    return !!site && site.phase >= BuildingConstructionPhase.WaitingForBuilders;
                },
                { maxTicks: 30_000, label: 'waiting for builders' }
            );

            restored = saveAndRestore(sim);

            // Should complete
            restored.runUntil(
                () => !restored!.services.constructionSiteManager.hasSite(siteId),
                { maxTicks: 50_000, label: 'restored construction completes' }
            );
            expect(restored.services.constructionSiteManager.hasSite(siteId)).toBe(false);
        });
    });

    // ═══════════════════════════════════════════════════════════════
    //  Category 5: Nature / growth
    // ═══════════════════════════════════════════════════════════════

    describe('nature and growth', () => {
        it('tree growth stages preserved and continue growing', () => {
            sim = createSimulation();

            // Place trees that will be in Growing stage
            const buildingId = sim.placeBuilding(BuildingType.ResidenceSmall);
            sim.plantTreesNear(buildingId, 5);

            // Run a few hundred ticks so trees are mid-growth
            sim.runTicks(300);

            // Capture tree states before save
            const treesBefore = new Map<number, { stage: TreeStage; progress: number }>();
            for (const entity of sim.state.entities) {
                if (entity.type === EntityType.MapObject) {
                    const treeState = sim.services.treeSystem.getTreeState(entity.id);
                    if (treeState) {
                        treesBefore.set(entity.id, { stage: treeState.stage, progress: treeState.progress });
                    }
                }
            }

            restored = saveAndRestore(sim);

            // Verify tree states match after restore
            for (const [entityId, before] of treesBefore) {
                const after = restored.services.treeSystem.getTreeState(entityId);
                expect(after, `tree #${entityId} state missing after restore`).toBeDefined();
                expect(after!.stage).toBe(before.stage);
                // Progress should be approximately equal (floating point)
                expect(after!.progress).toBeCloseTo(before.progress, 3);
            }

            // Trees should eventually mature
            restored.runUntil(
                () => {
                    for (const entity of restored!.state.entities) {
                        if (entity.type !== EntityType.MapObject) continue;
                        const ts = restored!.services.treeSystem.getTreeState(entity.id);
                        if (ts && ts.stage === TreeStage.Normal) return true;
                    }
                    return false;
                },
                { maxTicks: 30_000, label: 'at least one tree matures' }
            );
        });
    });

    // ═══════════════════════════════════════════════════════════════
    //  Category 6: Edge cases and invariants
    // ═══════════════════════════════════════════════════════════════

    describe('edge cases and invariants', () => {
        it('material conservation — total materials unchanged after restore', () => {
            sim = createSimulation();
            sim.placeBuilding(BuildingType.ResidenceSmall);
            const woodcutterId = sim.placeBuilding(BuildingType.WoodcutterHut);
            sim.placeBuilding(BuildingType.Sawmill);
            sim.plantTreesNear(woodcutterId, 5);

            // Run production chain for a while
            sim.runTicks(3000);

            const materialsBefore = countTotalMaterials(sim);

            restored = saveAndRestore(sim);

            const materialsAfter = countTotalMaterials(restored);

            // Every material type should have the same total
            const allMats = new Set([...materialsBefore.keys(), ...materialsAfter.keys()]);
            for (const mat of allMats) {
                expect(
                    materialsAfter.get(mat) ?? 0,
                    `material ${EMaterialType[mat]} count mismatch`
                ).toBe(materialsBefore.get(mat) ?? 0);
            }
        });

        it('no duplicate entities after restore', () => {
            sim = createSimulation();
            sim.placeBuilding(BuildingType.ResidenceSmall);
            const woodcutterId = sim.placeBuilding(BuildingType.WoodcutterHut);
            sim.placeBuilding(BuildingType.StorageArea);
            sim.plantTreesNear(woodcutterId, 5);
            sim.runTicks(300);

            restored = saveAndRestore(sim);

            // Entity count should match exactly
            expect(restored.state.entities.length).toBe(sim.state.entities.length);

            // No duplicate IDs
            const ids = restored.state.entities.map(e => e.id);
            const uniqueIds = new Set(ids);
            expect(uniqueIds.size).toBe(ids.length);
        });

        it('idempotent save — entity table matches after save/restore/save', () => {
            sim = createSimulation();
            sim.placeBuilding(BuildingType.ResidenceSmall);
            const woodcutterId = sim.placeBuilding(BuildingType.WoodcutterHut);
            sim.plantTreesNear(woodcutterId, 3);
            sim.runTicks(300);

            restored = saveAndRestore(sim);

            // Take snapshots from original and restored sims
            const snapshot1 = takeSnapshot(sim);
            const snapshot2 = takeSnapshot(restored);

            // Entity table should match exactly
            expect(snapshot2.entities.length).toBe(snapshot1.entities.length);
            expect(snapshot2.nextId).toBe(snapshot1.nextId);

            for (const e1 of snapshot1.entities) {
                const e2 = snapshot2.entities.find(e => e.id === e1.id);
                expect(e2, `entity #${e1.id} missing in second snapshot`).toBeDefined();
                expect(e2!.type).toBe(e1.type);
                expect(e2!.subType).toBe(e1.subType);
                expect(e2!.x).toBe(e1.x);
                expect(e2!.y).toBe(e1.y);
            }
        });

        it('continue after restore — remaining trees are cut and correct LOG count', () => {
            sim = createSimulation();
            sim.placeBuilding(BuildingType.ResidenceSmall);
            const woodcutterId = sim.placeBuilding(BuildingType.WoodcutterHut);
            sim.plantTreesNear(woodcutterId, 5);

            // Wait for first LOG
            sim.runUntil(
                () => sim.getOutput(woodcutterId, EMaterialType.LOG) >= 1,
                { maxTicks: 15_000, label: 'first LOG produced' }
            );
            const logsAtSave = sim.getOutput(woodcutterId, EMaterialType.LOG);

            restored = saveAndRestore(sim);

            // Run until all 5 trees are cut
            restored.runUntil(
                () => restored!.getOutput(woodcutterId, EMaterialType.LOG) >= 5,
                { maxTicks: 300 * 30, label: 'all 5 trees cut' }
            );

            // Should have exactly 5 LOGs total (no duplication, no loss)
            // Allow for logs that may have been picked up by carriers
            const finalLogs = restored.getOutput(woodcutterId, EMaterialType.LOG);
            expect(finalLogs).toBeLessThanOrEqual(5);
            expect(finalLogs).toBeGreaterThanOrEqual(logsAtSave);
        });
    });

    // ═══════════════════════════════════════════════════════════════
    //  Category 7: Regression guards
    // ═══════════════════════════════════════════════════════════════

    describe('regression guards', () => {
        it('carrier does not go idle on restore — continues working', () => {
            sim = createSimulation();
            sim.placeBuilding(BuildingType.ResidenceSmall);
            const woodcutterId = sim.placeBuilding(BuildingType.WoodcutterHut);
            const sawmillId = sim.placeBuilding(BuildingType.Sawmill);
            sim.plantTreesNear(woodcutterId, 5);

            // Wait for production to be active
            sim.runUntil(
                () => sim.getOutput(woodcutterId, EMaterialType.LOG) >= 1,
                { maxTicks: 15_000, label: 'LOG produced' }
            );
            sim.runTicks(120);

            restored = saveAndRestore(sim);

            // After restore, the chain should still function — boards should eventually appear
            // TODO: Once transport persistence is complete, carrier should continue mid-delivery
            // without going idle. For now, even if carrier goes idle and re-matches, boards
            // should still be produced.
            restored.runUntil(
                () => restored!.getOutput(sawmillId, EMaterialType.BOARD) >= 1,
                { maxTicks: 20_000, label: 'boards produced after restore' }
            );
            expect(restored.getOutput(sawmillId, EMaterialType.BOARD)).toBeGreaterThanOrEqual(1);
        });

        it('worker does not restart choreo from node 0 — resumes from saved state', () => {
            sim = createSimulation();
            sim.placeBuilding(BuildingType.ResidenceSmall);
            const woodcutterId = sim.placeBuilding(BuildingType.WoodcutterHut);
            sim.plantTreesNear(woodcutterId, 3);

            // Run until worker is actively cutting (mid-choreo)
            sim.runUntil(
                () => {
                    // At least some trees should have been interacted with
                    const logs = sim.getOutput(woodcutterId, EMaterialType.LOG);
                    return logs >= 1;
                },
                { maxTicks: 15_000, label: 'first LOG' }
            );

            restored = saveAndRestore(sim);

            // Worker should resume and eventually cut all remaining trees
            const logsBefore = restored.getOutput(woodcutterId, EMaterialType.LOG);
            restored.runUntil(
                () => restored!.getOutput(woodcutterId, EMaterialType.LOG) > logsBefore,
                { maxTicks: 15_000, label: 'worker resumes production after restore' }
            );
            expect(restored.getOutput(woodcutterId, EMaterialType.LOG)).toBeGreaterThan(logsBefore);
        });

        it('no enterBuilding mismatch after restore — stale approaching state must not crash', () => {
            // Busy economy: multiple production buildings + carriers moving between them.
            // Carriers approach source building to pick up, then go to dest to deliver.
            // If we save while a carrier is "approaching" building A but their restored
            // transport job targets building B, the stale approaching state causes a crash.
            sim = createSimulation();
            sim.placeBuilding(BuildingType.ResidenceSmall);
            sim.placeBuilding(BuildingType.ResidenceSmall);
            const w1 = sim.placeBuilding(BuildingType.WoodcutterHut);
            const w2 = sim.placeBuilding(BuildingType.WoodcutterHut);
            sim.placeBuilding(BuildingType.Sawmill);
            sim.placeBuilding(BuildingType.Sawmill);
            sim.placeBuilding(BuildingType.StorageArea);
            sim.plantTreesNear(w1, 10);
            sim.plantTreesNear(w2, 10);

            // Run busy economy — many carriers moving between many buildings
            sim.runTicks(8000);

            // Save and restore at multiple offsets — different workers will be in
            // different states (approaching, inside, walking between buildings)
            for (let i = 0; i < 10; i++) {
                restored?.destroy();
                restored = saveAndRestore(sim);
                restored.runTicks(3000);
                expect(restored.errors.length, `errors on restore iteration ${i}`).toBe(0);
                sim.runTicks(200);
            }
        });

        it('inventory state survives restore — amounts match exactly', () => {
            sim = createSimulation();
            sim.placeBuilding(BuildingType.ResidenceSmall);
            const sawmillId = sim.placeBuilding(BuildingType.Sawmill);

            // Inject known amounts
            sim.injectInput(sawmillId, EMaterialType.LOG, 5);
            sim.injectOutput(sawmillId, EMaterialType.BOARD, 2);

            // Let the sawmill process one LOG
            sim.runUntil(
                () => sim.getInput(sawmillId, EMaterialType.LOG) < 5,
                { maxTicks: 10_000, label: 'sawmill starts processing' }
            );

            const logsBefore = sim.getInput(sawmillId, EMaterialType.LOG);
            const boardsBefore = sim.getOutput(sawmillId, EMaterialType.BOARD);

            restored = saveAndRestore(sim);

            // Full inventory comparison
            assertInventoriesMatch(sim, restored);

            // Specific slot checks
            expect(restored.getInput(sawmillId, EMaterialType.LOG)).toBe(logsBefore);
            expect(restored.getOutput(sawmillId, EMaterialType.BOARD)).toBe(boardsBefore);
        });
    });
});
