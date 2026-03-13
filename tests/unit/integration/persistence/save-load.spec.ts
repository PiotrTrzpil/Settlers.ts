/**
 * Replay persistence integration tests — keyframe restore + transient state rebuild.
 *
 * With deterministic replay persistence, keyframe snapshots contain only
 * slow-accumulating state (inventories, construction, trees, stones, crops,
 * storage filters, production control, work areas, transport jobs).
 * Transient state (settler tasks, carrier registry, combat, garrison, etc.)
 * rebuilds by running ticks after restoring from a keyframe.
 *
 * Test approach:
 *   1. Set up a scenario and run simulation to a mid-point
 *   2. keyframeAndRestore() — snapshot, restore into fresh sim, run replay ticks
 *   3. Assert the restored sim's economy/construction eventually functions
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
import { createSnapshot, restoreFromSnapshot } from '@/game/state/game-state-persistence';
import type { Game } from '@/game/game';

installRealGameData();

// ─── Helpers ─────────────────────────────────────────────────────

/** Replay window — transient stores rebuild during these ticks after keyframe restore. */
const REPLAY_TICKS = 300;

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
 * Core test primitive: take a keyframe snapshot, restore into a fresh sim,
 * and run a replay window so transient stores rebuild.
 */
function keyframeAndRestore(sim: Simulation): Simulation {
    const snapshot = createSnapshot(asGame(sim));
    const sim2 = createSimulation({ mapWidth: sim.mapWidth, mapHeight: sim.mapHeight });
    restoreFromSnapshot(asGame(sim2), snapshot);
    sim2.runTicks(REPLAY_TICKS);
    return sim2;
}

/**
 * Compare building inventories between two simulations.
 * Only checks that slot structure matches (material types and slot kinds).
 */
function assertInventoryStructureMatch(original: Simulation, restored: Simulation): void {
    for (const entity of original.state.entities) {
        if (entity.type !== EntityType.Building) continue;
        const origSlots = original.services.inventoryManager.getSlots(entity.id);
        if (origSlots.length === 0) continue;

        const restSlots = restored.services.inventoryManager.getSlots(entity.id);
        expect(restSlots.length, `inventory missing for building #${entity.id}`).toBeGreaterThan(0);

        for (const slot of origSlots) {
            const rSlot = restSlots.find(s => s.kind === slot.kind && s.materialType === slot.materialType);
            expect(rSlot, `slot ${slot.kind}/${slot.materialType} missing`).toBeDefined();
        }
    }
}

// ─── Structural integrity ─────────────────────────────────────────

describe('Replay persistence – structural integrity', { timeout: 30_000 }, () => {
    let sim: Simulation;
    let restored: Simulation | undefined;

    afterEach(() => {
        sim?.destroy();
        restored?.destroy();
        restored = undefined;
        cleanupSimulation();
    });

    it('entity types and positions are preserved in keyframe', () => {
        sim = createSimulation();
        sim.placeBuilding(BuildingType.ResidenceSmall);
        const woodcutterId = sim.placeBuilding(BuildingType.WoodcutterHut);
        sim.placeBuilding(BuildingType.StorageArea);
        sim.plantTreesNear(woodcutterId, 5);
        sim.placeStonesNear(woodcutterId, 3);
        sim.runTicks(30);

        const snapshot = createSnapshot(asGame(sim));
        const sim2 = createSimulation({ mapWidth: sim.mapWidth, mapHeight: sim.mapHeight });
        restoreFromSnapshot(asGame(sim2), snapshot);

        const origEntities = sim.state.entities;
        const restEntities = sim2.state.entities;
        expect(restEntities.length).toBe(origEntities.length);

        for (const entity of origEntities) {
            const r = sim2.state.getEntity(entity.id);
            expect(r, `entity #${entity.id} missing`).toBeDefined();
            expect(r!.type).toBe(entity.type);
            expect(r!.subType).toBe(entity.subType);
            expect(r!.x).toBe(entity.x);
            expect(r!.y).toBe(entity.y);
            expect(r!.player).toBe(entity.player);
        }

        sim2.destroy();
    });

    it('empty world round-trip restores cleanly', () => {
        sim = createSimulation();
        restored = keyframeAndRestore(sim);
        expect(restored.state.entities.length).toBe(0);
        expect(restored.errors.length).toBe(0);
    });

    it('RNG seed is persisted in keyframe', () => {
        sim = createSimulation();
        sim.placeBuilding(BuildingType.ResidenceSmall);
        sim.runTicks(100);
        const rngState = sim.state.rng.getState();

        const snapshot = createSnapshot(asGame(sim));
        expect(snapshot.rngSeed).toBe(rngState);
    });
});

// ─── Economy rebuild ──────────────────────────────────────────────

describe('Replay persistence – economy rebuild', { timeout: 30_000 }, () => {
    let sim: Simulation;
    let restored: Simulation | undefined;

    afterEach(() => {
        sim?.destroy();
        restored?.destroy();
        restored = undefined;
        cleanupSimulation();
    });

    it('woodcutter resumes production after keyframe restore + replay', () => {
        sim = createSimulation();
        sim.placeBuilding(BuildingType.ResidenceSmall);
        const woodcutterId = sim.placeBuilding(BuildingType.WoodcutterHut);
        sim.plantTreesNear(woodcutterId, 3);

        sim.runUntil(() => sim.getOutput(woodcutterId, EMaterialType.LOG) >= 1, {
            maxTicks: 15_000,
            label: 'first LOG produced',
        });

        restored = keyframeAndRestore(sim);

        restored.runUntil(() => restored!.getOutput(woodcutterId, EMaterialType.LOG) >= 1, {
            maxTicks: 20_000,
            label: 'restored woodcutter produces LOG',
        });
        expect(restored.getOutput(woodcutterId, EMaterialType.LOG)).toBeGreaterThanOrEqual(1);
    });

    it('production chain resumes — carrier re-matches and delivers boards', () => {
        sim = createSimulation();
        sim.placeBuilding(BuildingType.ResidenceSmall);
        const woodcutterId = sim.placeBuilding(BuildingType.WoodcutterHut);
        const sawmillId = sim.placeBuilding(BuildingType.Sawmill);
        sim.plantTreesNear(woodcutterId, 5);

        sim.runUntil(() => sim.getOutput(woodcutterId, EMaterialType.LOG) >= 1, {
            maxTicks: 15_000,
            label: 'first LOG produced',
        });
        sim.runTicks(120);

        restored = keyframeAndRestore(sim);

        restored.runUntil(() => restored!.getOutput(sawmillId, EMaterialType.BOARD) >= 1, {
            maxTicks: 25_000,
            label: 'boards produced after restore',
        });
        expect(restored.getOutput(sawmillId, EMaterialType.BOARD)).toBeGreaterThanOrEqual(1);
    });

    it('sawmill with injected input produces output after restore', () => {
        sim = createSimulation();
        sim.placeBuilding(BuildingType.ResidenceSmall);
        const sawmillId = sim.placeBuilding(BuildingType.Sawmill);
        sim.injectInput(sawmillId, EMaterialType.LOG, 3);

        sim.runUntil(() => sim.getInput(sawmillId, EMaterialType.LOG) < 3, {
            maxTicks: 10_000,
            label: 'sawmill starts consuming LOG',
        });

        restored = keyframeAndRestore(sim);

        restored.runUntil(() => restored!.getOutput(sawmillId, EMaterialType.BOARD) >= 1, {
            maxTicks: 15_000,
            label: 'restored sawmill produces BOARD',
        });
        expect(restored.getOutput(sawmillId, EMaterialType.BOARD)).toBeGreaterThanOrEqual(1);
    });
});

// ─── Construction & nature ────────────────────────────────────────

describe('Replay persistence – construction & nature', { timeout: 30_000 }, () => {
    let sim: Simulation;
    let restored: Simulation | undefined;

    afterEach(() => {
        sim?.destroy();
        restored?.destroy();
        restored = undefined;
        cleanupSimulation();
    });

    it('construction site mid-build completes after restore', () => {
        const s = createScenario.constructionSite(BuildingType.WoodcutterHut);
        sim = s;
        const siteId = s.siteId;

        sim.runUntil(
            () => {
                const site = sim.services.constructionSiteManager.getSite(siteId);
                return !!site && site.phase >= BuildingConstructionPhase.WaitingForBuilders;
            },
            { maxTicks: 30_000, label: 'construction started' }
        );
        sim.runTicks(500);

        restored = keyframeAndRestore(sim);

        restored.runUntil(() => !restored!.services.constructionSiteManager.hasSite(siteId), {
            maxTicks: 80_000,
            label: 'restored construction completes',
        });
        expect(restored.services.constructionSiteManager.hasSite(siteId)).toBe(false);
    });

    it('construction with pending delivery completes after restore', () => {
        const s = createScenario.constructionSite(BuildingType.WoodcutterHut);
        sim = s;
        const siteId = s.siteId;

        sim.runUntil(
            () => {
                const site = sim.services.constructionSiteManager.getSite(siteId);
                return !!site && site.phase >= BuildingConstructionPhase.WaitingForBuilders;
            },
            { maxTicks: 30_000, label: 'waiting for builders' }
        );

        restored = keyframeAndRestore(sim);

        restored.runUntil(() => !restored!.services.constructionSiteManager.hasSite(siteId), {
            maxTicks: 80_000,
            label: 'restored construction completes',
        });
        expect(restored.services.constructionSiteManager.hasSite(siteId)).toBe(false);
    });

    it('tree growth stages preserved in keyframe and continue growing', () => {
        sim = createSimulation();
        const buildingId = sim.placeBuilding(BuildingType.ResidenceSmall);
        sim.plantTreesNear(buildingId, 5);
        sim.runTicks(300);

        const treesBefore = new Map<number, { stage: TreeStage; progress: number }>();
        for (const entity of sim.state.entities) {
            if (entity.type === EntityType.MapObject) {
                const treeState = sim.services.treeSystem.getTreeState(entity.id);
                if (treeState) {
                    treesBefore.set(entity.id, { stage: treeState.stage, progress: treeState.progress });
                }
            }
        }

        const snapshot = createSnapshot(asGame(sim));
        const sim2 = createSimulation({ mapWidth: sim.mapWidth, mapHeight: sim.mapHeight });
        restoreFromSnapshot(asGame(sim2), snapshot);

        for (const [entityId, before] of treesBefore) {
            const after = sim2.services.treeSystem.getTreeState(entityId);
            expect(after, `tree #${entityId} state missing after keyframe restore`).toBeDefined();
            expect(after!.stage).toBe(before.stage);
            expect(after!.progress).toBeCloseTo(before.progress, 3);
        }

        sim2.runTicks(REPLAY_TICKS);
        sim2.runUntil(
            () => {
                for (const entity of sim2.state.entities) {
                    if (entity.type !== EntityType.MapObject) continue;
                    const ts = sim2.services.treeSystem.getTreeState(entity.id);
                    if (ts && ts.stage === TreeStage.Normal) return true;
                }
                return false;
            },
            { maxTicks: 30_000, label: 'at least one tree matures' }
        );

        sim2.destroy();
    });
});

// ─── Invariants ───────────────────────────────────────────────────

describe('Replay persistence – invariants', { timeout: 30_000 }, () => {
    let sim: Simulation;
    let restored: Simulation | undefined;

    afterEach(() => {
        sim?.destroy();
        restored?.destroy();
        restored = undefined;
        cleanupSimulation();
    });

    it('inventory slot structure preserved after keyframe restore', () => {
        sim = createSimulation();
        sim.placeBuilding(BuildingType.ResidenceSmall);
        const sawmillId = sim.placeBuilding(BuildingType.Sawmill);
        sim.injectInput(sawmillId, EMaterialType.LOG, 5);
        sim.injectOutput(sawmillId, EMaterialType.BOARD, 2);
        sim.runTicks(100);

        restored = keyframeAndRestore(sim);
        assertInventoryStructureMatch(sim, restored);
    });

    it('no duplicate entity IDs after restore', () => {
        sim = createSimulation();
        sim.placeBuilding(BuildingType.ResidenceSmall);
        const woodcutterId = sim.placeBuilding(BuildingType.WoodcutterHut);
        sim.placeBuilding(BuildingType.StorageArea);
        sim.plantTreesNear(woodcutterId, 5);
        sim.runTicks(300);

        restored = keyframeAndRestore(sim);

        const ids = restored.state.entities.map(e => e.id);
        const uniqueIds = new Set(ids);
        expect(uniqueIds.size).toBe(ids.length);
    });

    it('building occupancy restored — completed buildings block pathfinding', () => {
        sim = createSimulation();
        sim.placeBuilding(BuildingType.ResidenceSmall);
        const woodcutterId = sim.placeBuilding(BuildingType.WoodcutterHut);
        const sawmillId = sim.placeBuilding(BuildingType.Sawmill);
        sim.plantTreesNear(woodcutterId, 3);
        sim.runTicks(500);

        const occupancyBefore = new Set(sim.state.buildingOccupancy);
        expect(occupancyBefore.size).toBeGreaterThan(0);

        restored = keyframeAndRestore(sim);

        const occupancyAfter = new Set(restored.state.buildingOccupancy);
        expect(
            occupancyAfter.size,
            `buildingOccupancy lost: before=${occupancyBefore.size} after=${occupancyAfter.size}`
        ).toBe(occupancyBefore.size);

        for (const key of occupancyBefore) {
            expect(occupancyAfter.has(key), `tile ${key} missing from buildingOccupancy`).toBe(true);
        }

        restored.runUntil(() => restored!.getOutput(sawmillId, EMaterialType.BOARD) >= 1, {
            maxTicks: 20_000,
            label: 'restored chain produces BOARD',
        });
        expect(restored.errors.length).toBe(0);
    });

    it('no enterBuilding crash after restore — busy economy survives 10 restore cycles', () => {
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

        sim.runTicks(8000);

        for (let i = 0; i < 10; i++) {
            restored?.destroy();
            restored = keyframeAndRestore(sim);
            restored.runTicks(3000);
            expect(restored.errors.length, `errors on restore cycle ${i}`).toBe(0);
            sim.runTicks(200);
        }
    });

    it('continue after restore — remaining trees are cut', () => {
        sim = createSimulation();
        sim.placeBuilding(BuildingType.ResidenceSmall);
        const woodcutterId = sim.placeBuilding(BuildingType.WoodcutterHut);
        sim.plantTreesNear(woodcutterId, 5);

        sim.runUntil(() => sim.getOutput(woodcutterId, EMaterialType.LOG) >= 1, {
            maxTicks: 15_000,
            label: 'first LOG produced',
        });

        restored = keyframeAndRestore(sim);

        restored.runUntil(() => restored!.getOutput(woodcutterId, EMaterialType.LOG) >= 5, {
            maxTicks: 300 * 30,
            label: 'all 5 trees cut',
        });
        expect(restored.getOutput(woodcutterId, EMaterialType.LOG)).toBeLessThanOrEqual(5);
    });
});
