/**
 * Integration test: Building Lifecycle
 *
 * Sweeps across: Command System → GameState → BuildingConstruction →
 *                TerrainLeveling → Territory → Entity Removal
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
import { EntityType, BuildingType, BuildingConstructionPhase, getBuildingFootprint } from '@/game/entity';
import { TerritoryMap, NO_OWNER } from '@/game/systems/territory';
import {
    captureOriginalTerrain,
    applyTerrainLeveling,
    restoreOriginalTerrain,
    CONSTRUCTION_SITE_GROUND_TYPE,
} from '@/game/systems/terrain-leveling';
import {
    updateBuildingConstruction,
    getBuildingVisualState,
    type TerrainContext,
} from '@/game/systems/building-construction';

describe('Building Lifecycle: place → construct → territory → remove', () => {
    it('full lifecycle from placement through construction to removal', () => {
        const map = createTestMap(64, 64, { flatHeight: 100 });
        const state = createGameState();

        // ── Step 1: Place a building via command system ──
        const placed = placeBuilding(state, map, 20, 20, BuildingType.Lumberjack, 0);
        expect(placed).toBe(true);

        const building = state.entities.find(e => e.type === EntityType.Building);
        expect(building).toBeDefined();
        expect(building!.x).toBe(20);
        expect(building!.y).toBe(20);
        expect(building!.subType).toBe(BuildingType.Lumberjack);

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

        // Phase 1: Poles (0-10%)
        updateBuildingConstruction(state, 0.5, ctx);
        expect(bs.phase).toBe(BuildingConstructionPhase.Poles);
        let visual = getBuildingVisualState(bs);
        expect(visual.useConstructionSprite).toBe(true);
        expect(visual.verticalProgress).toBe(0.0);

        // Phase 2: TerrainLeveling (10-25%)
        updateBuildingConstruction(state, 0.8, ctx);
        expect(bs.phase).toBe(BuildingConstructionPhase.TerrainLeveling);
        expect(bs.originalTerrain).not.toBeNull();

        // Advance through terrain leveling
        updateBuildingConstruction(state, 0.5, ctx);

        // Footprint tiles should have construction ground type
        const footprint = getBuildingFootprint(20, 20, BuildingType.Lumberjack);
        for (const tile of footprint) {
            expect(map.groundType[map.mapSize.toIndex(tile.x, tile.y)]).toBe(CONSTRUCTION_SITE_GROUND_TYPE);
        }

        // Phase 3: ConstructionRising (25-60%)
        updateBuildingConstruction(state, 2.0, ctx);
        expect(bs.phase).toBe(BuildingConstructionPhase.ConstructionRising);
        visual = getBuildingVisualState(bs);
        expect(visual.useConstructionSprite).toBe(true);
        expect(visual.verticalProgress).toBeGreaterThan(0);

        // Phase 4: CompletedRising (60-100%)
        updateBuildingConstruction(state, 4.0, ctx);
        expect(bs.phase).toBe(BuildingConstructionPhase.CompletedRising);
        visual = getBuildingVisualState(bs);
        expect(visual.useConstructionSprite).toBe(false);

        // Phase 5: Completed
        updateBuildingConstruction(state, 5.0, ctx);
        expect(bs.phase).toBe(BuildingConstructionPhase.Completed);
        visual = getBuildingVisualState(bs);
        expect(visual.isCompleted).toBe(true);

        // ── Step 4: Territory claims ──
        const territory = new TerritoryMap(map.mapSize);
        territory.rebuild(state.entities.filter(e => e.type === EntityType.Building));

        // Building should claim territory around it
        expect(territory.getOwner(20, 20)).toBe(0);
        expect(territory.isOwnedBy(20, 20, 0)).toBe(true);

        // Far away should be unowned
        expect(territory.getOwner(60, 60)).toBe(NO_OWNER);

        // ── Step 5: Remove building and verify cleanup ──
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

        // Territory cleared after rebuild
        territory.rebuild(state.entities.filter(e => e.type === EntityType.Building));
        expect(territory.getOwner(20, 20)).toBe(NO_OWNER);
    });

    it('multiple buildings compete for territory, removal updates ownership', () => {
        const map = createTestMap(64, 64, { flatHeight: 100 });
        const state = createGameState();

        // Place two buildings for different players
        placeBuilding(state, map, 15, 15, BuildingType.Tower, 0);
        placeBuilding(state, map, 30, 15, BuildingType.Tower, 1);

        const buildings = state.entities.filter(e => e.type === EntityType.Building);
        expect(buildings).toHaveLength(2);

        // Build territory
        const territory = new TerritoryMap(map.mapSize);
        territory.rebuild(buildings);

        // Each player owns their building's tile
        expect(territory.getOwner(15, 15)).toBe(0);
        expect(territory.getOwner(30, 15)).toBe(1);

        // Midpoint ownership depends on distance
        expect(territory.getOwner(22, 15)).toBe(0); // closer to player 0
        expect(territory.getOwner(23, 15)).toBe(1); // closer to player 1

        // Remove player 0's tower
        removeEntity(state, map, buildings[0].id);
        const remainingBuildings = state.entities.filter(e => e.type === EntityType.Building);
        territory.rebuild(remainingBuildings);

        // Player 0's territory is now unowned or claimed by player 1
        expect(territory.getOwner(15, 15)).toBe(NO_OWNER);
        expect(territory.getOwner(30, 15)).toBe(1);
    });

    it('building placement fails on invalid terrain, succeeds on valid', () => {
        const map = createTestMap(64, 64, { flatHeight: 100 });
        const state = createGameState();

        // Water → fails
        setTerrainAt(map, 10, 10, TERRAIN.WATER);
        expect(placeBuilding(state, map, 10, 10, BuildingType.Lumberjack)).toBe(false);
        expect(state.entities).toHaveLength(0);

        // Rock → fails
        setTerrainAt(map, 10, 10, TERRAIN.ROCK);
        expect(placeBuilding(state, map, 10, 10, BuildingType.Lumberjack)).toBe(false);

        // Beach → fails (not buildable)
        setTerrainAt(map, 10, 10, TERRAIN.BEACH);
        expect(placeBuilding(state, map, 10, 10, BuildingType.Lumberjack)).toBe(false);

        // Grass → succeeds
        setTerrainAt(map, 10, 10, TERRAIN.GRASS);
        expect(placeBuilding(state, map, 10, 10, BuildingType.Lumberjack)).toBe(true);

        // Occupied → fails
        expect(placeBuilding(state, map, 10, 10, BuildingType.Warehouse)).toBe(false);
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
        const building = addBuilding(state, 10, 10, BuildingType.Lumberjack, 0);
        const bs = state.buildingStates.get(building.id)!;

        // Capture terrain
        bs.originalTerrain = captureOriginalTerrain(bs, map.groundType, map.groundHeight, map.mapSize);

        // Apply full leveling
        applyTerrainLeveling(bs, map.groundType, map.groundHeight, map.mapSize, 1.0);

        // Footprint tiles should be leveled
        const footprint = getBuildingFootprint(10, 10, BuildingType.Lumberjack);
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

        addBuilding(state, 10, 10, BuildingType.Lumberjack, 0);
        const bs = [...state.buildingStates.values()][0];
        bs.totalDuration = 10;

        let terrainNotifications = 0;
        const ctx: TerrainContext = {
            groundType: map.groundType,
            groundHeight: map.groundHeight,
            mapSize: map.mapSize,
            onTerrainModified: () => { terrainNotifications++ },
        };

        // Advance through Poles phase
        updateBuildingConstruction(state, 0.5, ctx);
        expect(terrainNotifications).toBe(0); // No terrain mods during Poles

        // Advance into TerrainLeveling
        updateBuildingConstruction(state, 0.8, ctx);
        updateBuildingConstruction(state, 0.5, ctx);
        expect(terrainNotifications).toBeGreaterThan(0);
    });
});
