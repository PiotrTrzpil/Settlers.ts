/**
 * Integration test: Building Lifecycle
 *
 * Sweeps across: Command System → GameState → BuildingConstruction →
 *                TerrainLeveling → Entity Removal
 *
 * Tests the full lifecycle of a building from placement to removal,
 * verifying that all subsystems interact correctly.
 */

import { describe, it, expect } from 'vitest';
import { createTestMap, TERRAIN, setTerrainAt, setHeightAt } from '../helpers/test-map';
import {
    createGameState,
    addBuilding,
    placeBuilding,
    removeEntity,
} from '../helpers/test-game';
import { EntityType, BuildingType, getBuildingFootprint } from '@/game/entity';
import {
    BuildingConstructionPhase,
    BuildingConstructionSystem,
    captureOriginalTerrain,
    applyTerrainLeveling,
    restoreOriginalTerrain,
    getBuildingVisualState,
    CONSTRUCTION_SITE_GROUND_TYPE,
    type TerrainContext,
} from '@/game/features/building-construction';

/** Create a BuildingConstructionSystem with terrain context, tick it once. */
function tickConstruction(state: ReturnType<typeof createGameState>, dt: number, ctx: TerrainContext): void {
    const system = new BuildingConstructionSystem(state);
    system.setTerrainContext(ctx);
    system.tick(dt);
}

describe('Building Lifecycle: place → construct → remove', () => {
    it('full lifecycle from placement through construction to removal', () => {
        const map = createTestMap(64, 64, { flatHeight: 100 });
        const state = createGameState();

        // ── Step 1: Place a building via command system ──
        const placed = placeBuilding(state, map, 20, 20, BuildingType.WoodcutterHut, 0);
        expect(placed).toBe(true);

        const building = state.entities.find(e => e.type === EntityType.Building);
        expect(building).toBeDefined();
        expect(building!.x).toBe(20);
        expect(building!.y).toBe(20);
        expect(building!.subType).toBe(BuildingType.WoodcutterHut);

        // Lumberjack auto-spawns a worker
        const worker = state.entities.find(e => e.type === EntityType.Unit);
        expect(worker).toBeDefined();
        expect(worker!.player).toBe(0);

        // ── Step 2: Verify tile occupancy ──
        expect(state.tileOccupancy.get('20,20')).toBe(building!.id);

        // ── Step 3: Simulate construction phases ──
        const bs = state.buildingStates.get(building!.id)!;
        expect(bs).toBeDefined();
        bs.totalDuration = 10;

        const ctx: TerrainContext = {
            groundType: map.groundType,
            groundHeight: map.groundHeight,
            mapSize: map.mapSize,
            onTerrainModified: () => {},
        };

        // Phase 1: TerrainLeveling (0-20%) - Poles phase is skipped (duration=0)
        tickConstruction(state, 0.5, ctx);
        expect(bs.phase).toBe(BuildingConstructionPhase.TerrainLeveling);
        let visual = getBuildingVisualState(bs);
        expect(visual.useConstructionSprite).toBe(true);
        expect(visual.verticalProgress).toBe(0.0);
        expect(bs.originalTerrain).not.toBeNull();

        // Advance through terrain leveling
        tickConstruction(state, 0.5, ctx);

        // Footprint tiles should have construction ground type
        const footprint = getBuildingFootprint(20, 20, BuildingType.WoodcutterHut);
        for (const tile of footprint) {
            expect(map.groundType[map.mapSize.toIndex(tile.x, tile.y)]).toBe(CONSTRUCTION_SITE_GROUND_TYPE);
        }

        // Phase 2: ConstructionRising (20-55%)
        tickConstruction(state, 2.0, ctx);
        expect(bs.phase).toBe(BuildingConstructionPhase.ConstructionRising);
        visual = getBuildingVisualState(bs);
        expect(visual.useConstructionSprite).toBe(true);
        expect(visual.verticalProgress).toBeGreaterThan(0);

        // Phase 3: CompletedRising (55-100%)
        tickConstruction(state, 4.0, ctx);
        expect(bs.phase).toBe(BuildingConstructionPhase.CompletedRising);
        visual = getBuildingVisualState(bs);
        expect(visual.useConstructionSprite).toBe(false);

        // Phase 4: Completed
        tickConstruction(state, 5.0, ctx);
        expect(bs.phase).toBe(BuildingConstructionPhase.Completed);
        visual = getBuildingVisualState(bs);
        expect(visual.isCompleted).toBe(true);

        // ── Step 4: Remove building and verify cleanup ──
        const removed = removeEntity(state, map, building!.id);
        expect(removed).toBe(true);

        // Entity gone from state
        expect(state.entities.find(e => e.id === building!.id)).toBeUndefined();

        // Tile occupancy cleared
        expect(state.tileOccupancy.has('20,20')).toBe(false);

        // Terrain restored (construction ground type removed)
        for (const tile of footprint) {
            expect(map.groundType[map.mapSize.toIndex(tile.x, tile.y)]).toBe(TERRAIN.GRASS);
        }
    });

    it('building placement fails on invalid terrain, succeeds on valid', () => {
        const map = createTestMap(64, 64, { flatHeight: 100 });
        const state = createGameState();

        // Water → fails
        setTerrainAt(map, 10, 10, TERRAIN.WATER);
        expect(placeBuilding(state, map, 10, 10, BuildingType.WoodcutterHut)).toBe(false);
        expect(state.entities).toHaveLength(0);

        // Rock → fails
        setTerrainAt(map, 10, 10, TERRAIN.ROCK);
        expect(placeBuilding(state, map, 10, 10, BuildingType.WoodcutterHut)).toBe(false);

        // Beach → fails (not buildable)
        setTerrainAt(map, 10, 10, TERRAIN.BEACH);
        expect(placeBuilding(state, map, 10, 10, BuildingType.WoodcutterHut)).toBe(false);

        // Grass → succeeds
        setTerrainAt(map, 10, 10, TERRAIN.GRASS);
        expect(placeBuilding(state, map, 10, 10, BuildingType.WoodcutterHut)).toBe(true);

        // Occupied → fails
        expect(placeBuilding(state, map, 10, 10, BuildingType.StorageArea)).toBe(false);
    });

    it('terrain capture and restoration preserves varied heights', () => {
        const map = createTestMap(64, 64);
        setHeightAt(map, 10, 10, 200);
        setHeightAt(map, 11, 10, 50);
        setHeightAt(map, 10, 11, 100);
        setHeightAt(map, 11, 11, 150);

        // Save original state
        const originalHeights = new Uint8Array(map.groundHeight);

        const state = createGameState();
        const building = addBuilding(state, 10, 10, BuildingType.WoodcutterHut, 0);
        const bs = state.buildingStates.get(building.id)!;

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
        const map = createTestMap(64, 64, { flatHeight: 100 });
        const state = createGameState();

        addBuilding(state, 10, 10, BuildingType.WoodcutterHut, 0);
        const bs = [...state.buildingStates.values()][0];
        bs.totalDuration = 10;

        let terrainNotifications = 0;
        const ctx: TerrainContext = {
            groundType: map.groundType,
            groundHeight: map.groundHeight,
            mapSize: map.mapSize,
            onTerrainModified: () => { terrainNotifications++ },
        };

        // TerrainLeveling starts immediately (Poles phase is skipped)
        tickConstruction(state, 0.5, ctx);
        expect(terrainNotifications).toBeGreaterThan(0); // Terrain mods during TerrainLeveling
    });
});
