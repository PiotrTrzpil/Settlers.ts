/**
 * Integration test: Building Lifecycle
 *
 * Sweeps across: Command System → GameState → BuildingConstruction →
 *                TerrainLeveling → Entity Removal
 *
 * Tests the full lifecycle of a building from placement to removal,
 * verifying that all subsystems interact correctly.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { TERRAIN, setTerrainAt, setHeightAt, type TestMap } from '../helpers/test-map';
import { createTestContext, addBuilding, placeBuilding, removeEntity, type TestContext } from '../helpers/test-game';
import { EntityType, BuildingType, getBuildingFootprint } from '@/game/entity';
import {
    BuildingConstructionPhase,
    captureOriginalTerrain,
    applyTerrainLeveling,
    restoreOriginalTerrain,
    getBuildingVisualState,
    CONSTRUCTION_SITE_GROUND_TYPE,
} from '@/game/features/building-construction';

describe('Building Lifecycle: place → construct → remove', () => {
    let ctx: TestContext;
    let map: TestMap;

    beforeEach(() => {
        // Create a test context with 64x64 map
        ctx = createTestContext(64, 64);
        map = ctx.map;
        // Set terrain to flat grass at height 100 for building tests
        map.groundType.fill(TERRAIN.GRASS);
        map.groundHeight.fill(100);
        // Re-apply to state
        ctx.state.movement.setTerrainData(map.groundType, map.groundHeight, map.mapSize.width, map.mapSize.height);
    });

    it('full lifecycle from placement through construction to removal', () => {
        // ── Step 1: Place a building via command system ──
        const placed = placeBuilding(ctx, 20, 20, BuildingType.WoodcutterHut, 0);
        expect(placed.success).toBe(true);

        const building = ctx.state.entities.find(e => e.type === EntityType.Building);
        expect(building).toBeDefined();
        expect(building!.x).toBe(20);
        expect(building!.y).toBe(20);
        expect(building!.subType).toBe(BuildingType.WoodcutterHut);

        // Worker is not spawned until construction completes
        const workerBeforeComplete = ctx.state.entities.find(e => e.type === EntityType.Unit);
        expect(workerBeforeComplete).toBeUndefined();

        // ── Step 2: Verify tile occupancy ──
        const occupyingEntityId = ctx.state.tileOccupancy.get('20,20');
        expect(occupyingEntityId).toBeDefined();
        expect(ctx.state.getEntity(occupyingEntityId!)).toBe(building);

        // ── Step 3: Simulate construction phases ──
        const bs = ctx.buildingStateManager.getBuildingState(building!.id)!;
        expect(bs).toBeDefined();
        bs.totalDuration = 10;

        // Phase 1: TerrainLeveling (0-20%) - Poles phase is skipped (duration=0)
        ctx.buildingConstructionSystem.tick(0.5);
        expect(bs.phase).toBe(BuildingConstructionPhase.TerrainLeveling);
        let visual = getBuildingVisualState(bs);
        expect(visual.useConstructionSprite).toBe(true);
        expect(visual.verticalProgress).toBe(0.0);
        expect(bs.originalTerrain).not.toBeNull();

        // Advance through terrain leveling
        ctx.buildingConstructionSystem.tick(0.5);

        // Footprint tiles should have construction ground type
        const footprint = getBuildingFootprint(20, 20, BuildingType.WoodcutterHut);
        for (const tile of footprint) {
            expect(map.groundType[map.mapSize.toIndex(tile.x, tile.y)]).toBe(CONSTRUCTION_SITE_GROUND_TYPE);
        }

        // Phase 2: ConstructionRising (20-55%)
        ctx.buildingConstructionSystem.tick(2.0);
        expect(bs.phase).toBe(BuildingConstructionPhase.ConstructionRising);
        visual = getBuildingVisualState(bs);
        expect(visual.useConstructionSprite).toBe(true);
        expect(visual.verticalProgress).toBeGreaterThan(0);

        // Phase 3: CompletedRising (55-100%)
        ctx.buildingConstructionSystem.tick(4.0);
        expect(bs.phase).toBe(BuildingConstructionPhase.CompletedRising);
        visual = getBuildingVisualState(bs);
        expect(visual.useConstructionSprite).toBe(false);

        // Phase 4: Completed
        ctx.buildingConstructionSystem.tick(5.0);
        expect(bs.phase).toBe(BuildingConstructionPhase.Completed);
        visual = getBuildingVisualState(bs);
        expect(visual.isCompleted).toBe(true);

        // Worker is spawned when construction completes
        const workerAfterComplete = ctx.state.entities.find(e => e.type === EntityType.Unit);
        expect(workerAfterComplete).toBeDefined();
        expect(workerAfterComplete!.player).toBe(0);

        // ── Step 4: Remove building and verify cleanup ──
        const removed = removeEntity(ctx, building!.id);
        expect(removed.success).toBe(true);

        // Entity gone from state
        expect(ctx.state.entities.find(e => e.id === building!.id)).toBeUndefined();

        // Tile occupancy cleared
        expect(ctx.state.tileOccupancy.has('20,20')).toBe(false);

        // Terrain restored (construction ground type removed)
        for (const tile of footprint) {
            expect(map.groundType[map.mapSize.toIndex(tile.x, tile.y)]).toBe(TERRAIN.GRASS);
        }
    });

    it('building placement fails on invalid terrain, succeeds on valid', () => {
        // Water → fails
        setTerrainAt(map, 10, 10, TERRAIN.WATER);
        expect(placeBuilding(ctx, 10, 10, BuildingType.WoodcutterHut).success).toBe(false);
        expect(ctx.state.entities).toHaveLength(0);

        // Rock → fails
        setTerrainAt(map, 10, 10, TERRAIN.ROCK);
        expect(placeBuilding(ctx, 10, 10, BuildingType.WoodcutterHut).success).toBe(false);

        // Beach → fails (not buildable)
        setTerrainAt(map, 10, 10, TERRAIN.BEACH);
        expect(placeBuilding(ctx, 10, 10, BuildingType.WoodcutterHut).success).toBe(false);

        // Grass → succeeds
        setTerrainAt(map, 10, 10, TERRAIN.GRASS);
        expect(placeBuilding(ctx, 10, 10, BuildingType.WoodcutterHut).success).toBe(true);

        // Occupied → fails
        expect(placeBuilding(ctx, 10, 10, BuildingType.StorageArea).success).toBe(false);
    });

    it('terrain capture and restoration preserves varied heights', () => {
        setHeightAt(map, 10, 10, 200);
        setHeightAt(map, 11, 10, 50);
        setHeightAt(map, 10, 11, 100);
        setHeightAt(map, 11, 11, 150);

        // Save original state
        const originalHeights = new Uint8Array(map.groundHeight);

        const building = addBuilding(ctx.state, 10, 10, BuildingType.WoodcutterHut, 0);
        const bs = ctx.buildingStateManager.getBuildingState(building.id)!;

        // Capture terrain
        bs.originalTerrain = captureOriginalTerrain(bs, map.groundType, map.groundHeight, map.mapSize);

        // Apply full leveling
        applyTerrainLeveling(bs, map.groundType, map.groundHeight, map.mapSize, 1.0);

        // Footprint tiles should be leveled
        const footprint = getBuildingFootprint(10, 10, BuildingType.WoodcutterHut);
        const targetHeight = bs.originalTerrain!.targetHeight;
        for (const tile of footprint) {
            expect(map.groundHeight[map.mapSize.toIndex(tile.x, tile.y)]).toBe(targetHeight);
            expect(map.groundType[map.mapSize.toIndex(tile.x, tile.y)]).toBe(CONSTRUCTION_SITE_GROUND_TYPE);
        }

        // Restore terrain
        const restored = restoreOriginalTerrain(bs, map.groundType, map.groundHeight, map.mapSize);
        expect(restored).toBe(true);

        // All captured tiles should be back to original
        for (const tile of bs.originalTerrain!.tiles) {
            const idx = map.mapSize.toIndex(tile.x, tile.y);
            expect(map.groundHeight[idx]).toBe(originalHeights[idx]);
            expect(map.groundType[idx]).toBe(TERRAIN.GRASS);
        }
    });

    it('construction with terrain modification notifies callback', () => {
        let terrainNotifications = 0;
        ctx.buildingConstructionSystem.setTerrainContext({
            terrain: ctx.map.terrain,
            onTerrainModified: () => {
                terrainNotifications++;
            },
        });

        addBuilding(ctx.state, 10, 10, BuildingType.WoodcutterHut, 0);
        const bs = [...ctx.buildingStateManager.buildingStates.values()][0];
        bs.totalDuration = 10;

        // TerrainLeveling starts immediately (Poles phase is skipped)
        ctx.buildingConstructionSystem.tick(0.5);
        expect(terrainNotifications).toBeGreaterThan(0);
    });
});
