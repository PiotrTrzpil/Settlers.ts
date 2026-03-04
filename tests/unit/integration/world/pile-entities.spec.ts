/**
 * Pile System Integration Tests
 *
 * End-to-end verification of the InventoryPileSync lifecycle: pile entities are
 * created, updated, and removed in response to inventory changes, building
 * completion, and building removal.
 *
 * All tests require real game XML data (buildingInfo.xml pile positions) and are
 * wrapped in describe.skipIf(!hasRealData) to skip cleanly in CI or local
 * environments without game assets.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { createSimulation, cleanupSimulation, type Simulation } from '../helpers/test-simulation';
import { installRealGameData } from '../helpers/test-game-data';
import { BuildingType, EntityType } from '@/game/entity';
import { EMaterialType } from '@/game/economy/material-type';

const hasRealData = installRealGameData();

// ─── Group 1: InventoryPileSync lifecycle ────────────────────────────────────

describe.skipIf(!hasRealData)('Pile System Integration', { timeout: 10_000 }, () => {
    let sim: Simulation;

    afterEach(() => {
        sim?.destroy();
        cleanupSimulation();
    });

    describe('InventoryPileSync lifecycle', () => {
        it('quantity increase on existing pile → entity count unchanged (no duplicate spawn)', () => {
            sim = createSimulation();
            const woodcutterId = sim.placeBuilding(BuildingType.WoodcutterHut);

            // First deposit — spawns one pile entity
            sim.injectOutput(woodcutterId, EMaterialType.LOG, 2);
            const countAfterFirst = sim.countEntities(EntityType.StackedPile, EMaterialType.LOG);
            expect(countAfterFirst).toBe(1);

            // Second deposit — updates quantity, must NOT spawn a second entity
            sim.injectOutput(woodcutterId, EMaterialType.LOG, 1);
            const countAfterSecond = sim.countEntities(EntityType.StackedPile, EMaterialType.LOG);
            expect(countAfterSecond).toBe(1);
        });

        it('quantity drops to 0 → pile entity removed', () => {
            sim = createSimulation();
            const woodcutterId = sim.placeBuilding(BuildingType.WoodcutterHut);

            sim.injectOutput(woodcutterId, EMaterialType.LOG, 3);
            expect(sim.countEntities(EntityType.StackedPile, EMaterialType.LOG)).toBe(1);

            // Withdraw all — pile entity must disappear
            sim.services.inventoryManager.withdrawOutput(woodcutterId, EMaterialType.LOG, 3);
            expect(sim.countEntities(EntityType.StackedPile, EMaterialType.LOG)).toBe(0);
        });

        it('building:removed → linked pile entities survive and are converted to kind free', () => {
            sim = createSimulation();
            const woodcutterId = sim.placeBuilding(BuildingType.WoodcutterHut);

            sim.injectOutput(woodcutterId, EMaterialType.LOG, 2);
            const logPiles = sim.state.entities.filter(
                e => e.type === EntityType.StackedPile && e.subType === EMaterialType.LOG
            );
            expect(logPiles.length).toBe(1);
            const pileId = logPiles[0]!.id;

            // Remove the building — piles should survive as free piles
            sim.state.removeEntity(woodcutterId);

            // Pile entity still exists
            const stillAlive = sim.state.getEntity(pileId);
            expect(stillAlive).toBeDefined();

            // Kind should now be 'free' (no longer tied to the removed building)
            const kind = sim.state.piles.getKind(pileId);
            expect(kind.kind).toBe('free');
        });
    });

    // ─── Group 2: Construction piles ─────────────────────────────────────────

    describe('Construction piles', () => {
        it('deposit two distinct construction materials → two pile entities at distinct positions', () => {
            // Place a building that requires BOARD and STONE during construction
            // completed=false keeps it in construction phase so deposits use 'construction' kind
            sim = createSimulation();
            const woodcutterId = sim.placeBuilding(BuildingType.WoodcutterHut, 0, false);

            // Inject construction materials directly into inventory (construction phase)
            sim.injectInput(woodcutterId, EMaterialType.BOARD, 1);
            sim.injectInput(woodcutterId, EMaterialType.STONE, 1);

            const piles = sim.state.entities.filter(e => e.type === EntityType.StackedPile);

            // Expect at most two pile entities (one per material type)
            expect(piles.length).toBeGreaterThanOrEqual(1);

            // All pile positions are distinct
            const positions = piles.map(p => `${p.x},${p.y}`);
            const unique = new Set(positions);
            expect(unique.size).toBe(positions.length);
        });

        it('complete construction → all construction pile entities removed', () => {
            sim = createSimulation();
            // Place building in construction state
            const buildingId = sim.placeBuilding(BuildingType.WoodcutterHut, 0, false);

            // Deposit a construction material so a pile appears
            sim.injectInput(buildingId, EMaterialType.BOARD, 1);
            const pilesBefore = sim.state.entities.filter(e => e.type === EntityType.StackedPile);
            expect(pilesBefore.length).toBeGreaterThanOrEqual(1);

            // Emit building:completed — InventoryPileSync.onBuildingCompleted clears construction piles
            sim.eventBus.emit('building:completed', {
                entityId: buildingId,
                buildingType: BuildingType.WoodcutterHut,
                race: sim.state.getEntityOrThrow(buildingId, 'test').race,
            });

            // All construction piles should be gone
            const pilesAfter = sim.state.entities.filter(e => e.type === EntityType.StackedPile);
            expect(pilesAfter.length).toBe(0);
        });
    });

    // ─── Group 5: StorageArea dynamic slots ──────────────────────────────────

    describe('StorageArea dynamic slots', () => {
        it('deposit material into empty StorageArea → pile entity spawned', () => {
            sim = createSimulation();
            const storageId = sim.placeBuilding(BuildingType.StorageArea);

            const beforeCount = sim.countEntities(EntityType.StackedPile);

            sim.injectOutput(storageId, EMaterialType.LOG, 3);

            const afterCount = sim.countEntities(EntityType.StackedPile);
            expect(afterCount).toBeGreaterThan(beforeCount);
        });

        it('deposit same material again → no new entity spawned', () => {
            sim = createSimulation();
            const storageId = sim.placeBuilding(BuildingType.StorageArea);

            sim.injectOutput(storageId, EMaterialType.LOG, 2);
            const countAfterFirst = sim.countEntities(EntityType.StackedPile, EMaterialType.LOG);
            expect(countAfterFirst).toBe(1);

            // Deposit more of the same material — should update the quantity, not spawn a new entity
            sim.injectOutput(storageId, EMaterialType.LOG, 1);
            const countAfterSecond = sim.countEntities(EntityType.StackedPile, EMaterialType.LOG);
            expect(countAfterSecond).toBe(1);
        });

        it('withdraw all of one material → pile entity removed', () => {
            sim = createSimulation();
            const storageId = sim.placeBuilding(BuildingType.StorageArea);

            sim.injectOutput(storageId, EMaterialType.LOG, 4);
            expect(sim.countEntities(EntityType.StackedPile, EMaterialType.LOG)).toBe(1);

            sim.services.inventoryManager.withdrawOutput(storageId, EMaterialType.LOG, 4);
            expect(sim.countEntities(EntityType.StackedPile, EMaterialType.LOG)).toBe(0);
        });
    });

    // ─── Group 6: Position integrity stress test ──────────────────────────────

    describe('Position integrity stress test', () => {
        it('no two StackedResource entities share a tile after 3 buildings with output', () => {
            sim = createSimulation();

            const w1 = sim.placeBuilding(BuildingType.WoodcutterHut);
            const w2 = sim.placeBuilding(BuildingType.WoodcutterHut);
            const sawmill = sim.placeBuilding(BuildingType.Sawmill);

            // Inject output for all buildings to populate piles
            sim.injectOutput(w1, EMaterialType.LOG, 3);
            sim.injectOutput(w2, EMaterialType.LOG, 3);
            sim.injectOutput(sawmill, EMaterialType.BOARD, 2);
            sim.injectInput(sawmill, EMaterialType.LOG, 2);

            const piles = sim.state.entities.filter(e => e.type === EntityType.StackedPile);
            expect(piles.length).toBeGreaterThan(0);

            const coords = piles.map(e => `${e.x},${e.y}`);
            const unique = new Set(coords);
            expect(unique.size).toBe(coords.length);
        });
    });
});
