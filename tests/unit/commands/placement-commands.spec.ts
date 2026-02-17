/**
 * Unit tests for placement commands (buildings, units, resources).
 *
 * These tests verify command execution and entity creation without needing
 * a browser or game loop. They were migrated from e2e tests that only
 * exercised command logic.
 *
 * Uses test-game.ts helpers for command execution.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { EntityType } from '@/game/entity';
import { BuildingType, getBuildingFootprint } from '@/game/buildings';
import { UnitType } from '@/game/unit-types';
import { EMaterialType } from '@/game/economy/material-type';
import { BuildingConstructionPhase, CONSTRUCTION_SITE_GROUND_TYPE } from '@/game/features/building-construction';
import { gameSettings } from '@/game/game-settings';
import {
    createTestContext,
    placeBuilding,
    spawnUnit,
    placeResource,
    findPassableTile,
    findBuildableTile,
    isTerrainPassable,
    isTerrainWater,
    type TestContext,
} from '../helpers/test-game';
import { TERRAIN, setHeightAt } from '../helpers/test-map';

describe('Building Placement Commands', () => {
    let ctx: TestContext;

    beforeEach(() => {
        ctx = createTestContext();
    });

    it('place_building creates entity with correct attributes', () => {
        const tile = findBuildableTile(ctx.map);
        expect(tile).not.toBeNull();

        const result = placeBuilding(ctx, tile!.x, tile!.y, BuildingType.WoodcutterHut);
        expect(result.success).toBe(true);

        const buildings = ctx.state.entities.filter(e => e.type === EntityType.Building);
        expect(buildings.length).toBe(1);

        const building = buildings[0];
        expect(building.type).toBe(EntityType.Building);
        expect(building.subType).toBe(BuildingType.WoodcutterHut);
        expect(building.x).toBe(tile!.x);
        expect(building.y).toBe(tile!.y);
        expect(building.player).toBe(0);
    });

    it('place_building fails on water terrain', () => {
        // Set center area to water
        const cx = Math.floor(ctx.map.mapSize.width / 2);
        const cy = Math.floor(ctx.map.mapSize.height / 2);
        ctx.map.groundType[ctx.map.mapSize.toIndex(cx, cy)] = TERRAIN.WATER;

        const result = placeBuilding(ctx, cx, cy, BuildingType.WoodcutterHut);
        expect(result.success).toBe(false);

        const buildings = ctx.state.entities.filter(e => e.type === EntityType.Building);
        expect(buildings.length).toBe(0);
    });

    it('different building types can be placed', () => {
        const tile1 = findBuildableTile(ctx.map);
        expect(tile1).not.toBeNull();

        // Place WoodcutterHut
        const result1 = placeBuilding(ctx, tile1!.x, tile1!.y, BuildingType.WoodcutterHut);
        expect(result1.success).toBe(true);

        // Place StorageArea at different location
        const result2 = placeBuilding(ctx, tile1!.x + 5, tile1!.y + 5, BuildingType.StorageArea);
        expect(result2.success).toBe(true);

        const buildings = ctx.state.entities.filter(e => e.type === EntityType.Building);
        expect(buildings.length).toBe(2);
        expect(buildings.map(b => b.subType)).toContain(BuildingType.WoodcutterHut);
        expect(buildings.map(b => b.subType)).toContain(BuildingType.StorageArea);
    });
});

describe('Unit Spawn Commands', () => {
    let ctx: TestContext;

    beforeEach(() => {
        ctx = createTestContext();
    });

    it('spawn_unit creates carrier on passable terrain', () => {
        const tile = findPassableTile(ctx.map);
        expect(tile).not.toBeNull();

        const result = spawnUnit(ctx, tile!.x, tile!.y, UnitType.Carrier);
        expect(result.success).toBe(true);

        const units = ctx.state.entities.filter(e => e.type === EntityType.Unit);
        expect(units.length).toBe(1);

        const unit = units[0];
        expect(unit.type).toBe(EntityType.Unit);
        expect(unit.subType).toBe(UnitType.Carrier);
        expect(unit.x).toBe(tile!.x);
        expect(unit.y).toBe(tile!.y);

        // Verify terrain is passable
        expect(isTerrainPassable(ctx.map, unit.x, unit.y)).toBe(true);
    });

    it('spawn_unit creates swordsman', () => {
        const tile = findPassableTile(ctx.map);
        expect(tile).not.toBeNull();

        const result = spawnUnit(ctx, tile!.x, tile!.y, UnitType.Swordsman);
        expect(result.success).toBe(true);

        const units = ctx.state.entities.filter(e => e.type === EntityType.Unit);
        expect(units.length).toBe(1);
        expect(units[0].subType).toBe(UnitType.Swordsman);
    });

    it('spawn_unit uses specified coordinates', () => {
        const tile = findBuildableTile(ctx.map);
        expect(tile).not.toBeNull();

        const result = spawnUnit(ctx, tile!.x, tile!.y, UnitType.Builder);
        expect(result.success).toBe(true);

        const units = ctx.state.entities.filter(e => e.type === EntityType.Unit);
        expect(units.length).toBe(1);

        const unit = units[0];
        expect(unit.x).toBe(tile!.x);
        expect(unit.y).toBe(tile!.y);
    });

    it('spawned unit is on passable terrain (not water)', () => {
        const tile = findPassableTile(ctx.map);
        expect(tile).not.toBeNull();

        const result = spawnUnit(ctx, tile!.x, tile!.y, UnitType.Builder);
        expect(result.success).toBe(true);

        const units = ctx.state.entities.filter(e => e.type === EntityType.Unit);
        const unit = units[0];

        expect(isTerrainWater(ctx.map, unit.x, unit.y)).toBe(false);
        expect(isTerrainPassable(ctx.map, unit.x, unit.y)).toBe(true);
    });

    it('multiple units can be spawned', () => {
        const tile = findPassableTile(ctx.map);
        expect(tile).not.toBeNull();

        // Spawn units at different locations
        spawnUnit(ctx, tile!.x, tile!.y, UnitType.Carrier);
        spawnUnit(ctx, tile!.x + 2, tile!.y + 2, UnitType.Builder);
        spawnUnit(ctx, tile!.x + 4, tile!.y + 4, UnitType.Swordsman);

        const units = ctx.state.entities.filter(e => e.type === EntityType.Unit);
        expect(units.length).toBe(3);
        expect(units.map(u => u.subType)).toContain(UnitType.Carrier);
        expect(units.map(u => u.subType)).toContain(UnitType.Builder);
        expect(units.map(u => u.subType)).toContain(UnitType.Swordsman);
    });
});

describe('Resource Placement Commands', () => {
    let ctx: TestContext;

    beforeEach(() => {
        ctx = createTestContext();
    });

    it('place_resource creates entity with correct attributes', () => {
        const tile = findPassableTile(ctx.map);
        expect(tile).not.toBeNull();

        const amount = 5;
        const result = placeResource(ctx, tile!.x, tile!.y, EMaterialType.LOG, amount);
        expect(result.success).toBe(true);

        const resources = ctx.state.entities.filter(e => e.type === EntityType.StackedResource);
        expect(resources.length).toBe(1);

        const resource = resources[0];
        expect(resource.type).toBe(EntityType.StackedResource);
        expect(resource.subType).toBe(EMaterialType.LOG);
        expect(resource.x).toBe(tile!.x);
        expect(resource.y).toBe(tile!.y);
    });

    it('place_resource with different material types', () => {
        const tile = findPassableTile(ctx.map);
        expect(tile).not.toBeNull();

        const amount = 3;
        const result = placeResource(ctx, tile!.x, tile!.y, EMaterialType.BOARD, amount);
        expect(result.success).toBe(true);

        const resources = ctx.state.entities.filter(e => e.type === EntityType.StackedResource);
        expect(resources.length).toBe(1);
        expect(resources[0].type).toBe(EntityType.StackedResource);
        expect(resources[0].subType).toBe(EMaterialType.BOARD);
    });

    it('multiple resources can be placed at different locations', () => {
        let placedCount = 0;

        for (let i = 0; i < 3; i++) {
            const x = 10 + i * 3;
            const y = 10 + i * 3;
            const result = placeResource(ctx, x, y, EMaterialType.LOG);
            if (result.success) placedCount++;
        }

        expect(placedCount).toBeGreaterThanOrEqual(2);

        const resources = ctx.state.entities.filter(e => e.type === EntityType.StackedResource);
        expect(resources.length).toBeGreaterThanOrEqual(2);
    });

    it('resources with different amounts are placed correctly', () => {
        const amounts = [1, 5, 8];
        const placed: Array<{ id: number; subType: number }> = [];

        for (let i = 0; i < amounts.length; i++) {
            const x = 10 + i * 3;
            const y = 10 + i * 3;
            const result = placeResource(ctx, x, y, EMaterialType.LOG, amounts[i]);
            if (result.success) {
                const resources = ctx.state.entities.filter(e => e.type === EntityType.StackedResource);
                const newest = resources[resources.length - 1];
                placed.push({ id: newest.id, subType: newest.subType });
            }
        }

        expect(placed.length).toBeGreaterThanOrEqual(2);

        // Verify all placed resources exist
        const resources = ctx.state.entities.filter(e => e.type === EntityType.StackedResource);
        for (const p of placed) {
            const found = resources.find(r => r.id === p.id);
            expect(found).toBeDefined();
        }
    });

    it('place_resource fails on water terrain', () => {
        const cx = Math.floor(ctx.map.mapSize.width / 2);
        const cy = Math.floor(ctx.map.mapSize.height / 2);
        ctx.map.groundType[ctx.map.mapSize.toIndex(cx, cy)] = TERRAIN.WATER;

        const result = placeResource(ctx, cx, cy, EMaterialType.LOG);
        expect(result.success).toBe(false);

        const resources = ctx.state.entities.filter(e => e.type === EntityType.StackedResource);
        expect(resources.length).toBe(0);
    });
});

// ---------------------------------------------------------------------------
// Terrain modification at placement time (regression tests)
// ---------------------------------------------------------------------------

describe('Building Placement Terrain Modification', () => {
    let ctx: TestContext;

    beforeEach(() => {
        ctx = createTestContext();
        // Reset completed mode
        gameSettings.state.placeBuildingsCompleted = false;
    });

    it('should change ground to raw immediately on placement (normal mode)', () => {
        const tile = findBuildableTile(ctx.map);
        expect(tile).not.toBeNull();

        // Verify ground is grass before placement
        const footprint = getBuildingFootprint(tile!.x, tile!.y, BuildingType.WoodcutterHut);
        for (const ft of footprint) {
            expect(ctx.map.groundType[ctx.map.mapSize.toIndex(ft.x, ft.y)]).toBe(TERRAIN.GRASS);
        }

        const result = placeBuilding(ctx, tile!.x, tile!.y, BuildingType.WoodcutterHut);
        expect(result.success).toBe(true);

        // Ground type should be raw (DustyWay) immediately after placement - no tick needed
        for (const ft of footprint) {
            expect(ctx.map.groundType[ctx.map.mapSize.toIndex(ft.x, ft.y)]).toBe(CONSTRUCTION_SITE_GROUND_TYPE);
        }
    });

    it('should capture original terrain at placement time (normal mode)', () => {
        const tile = findBuildableTile(ctx.map);
        expect(tile).not.toBeNull();

        const result = placeBuilding(ctx, tile!.x, tile!.y, BuildingType.WoodcutterHut);
        expect(result.success).toBe(true);

        const building = ctx.state.entities.find(e => e.type === EntityType.Building)!;
        const buildingState = ctx.buildingStateManager.getBuildingState(building.id)!;
        expect(buildingState.originalTerrain).not.toBeNull();
        expect(buildingState.originalTerrain!.tiles.length).toBeGreaterThan(0);
    });

    it('should change ground and level heights instantly in completed mode', () => {
        gameSettings.state.placeBuildingsCompleted = true;

        const tile = findBuildableTile(ctx.map);
        expect(tile).not.toBeNull();

        // Set varying heights within slope tolerance (MAX_SLOPE_DIFF = 8)
        setHeightAt(ctx.map, tile!.x, tile!.y, 10);
        setHeightAt(ctx.map, tile!.x + 1, tile!.y, 14);
        setHeightAt(ctx.map, tile!.x, tile!.y + 1, 12);
        setHeightAt(ctx.map, tile!.x + 1, tile!.y + 1, 8);

        const result = placeBuilding(ctx, tile!.x, tile!.y, BuildingType.WoodcutterHut);
        expect(result.success).toBe(true);

        // Ground type should be raw
        const footprint = getBuildingFootprint(tile!.x, tile!.y, BuildingType.WoodcutterHut);
        for (const ft of footprint) {
            expect(ctx.map.groundType[ctx.map.mapSize.toIndex(ft.x, ft.y)]).toBe(CONSTRUCTION_SITE_GROUND_TYPE);
        }

        // Heights should be leveled (all the same target height)
        const heights = footprint.map(ft => ctx.map.groundHeight[ctx.map.mapSize.toIndex(ft.x, ft.y)]);
        const uniqueHeights = new Set(heights);
        // All footprint tiles should have the same leveled height
        expect(uniqueHeights.size).toBe(1);

        // Building should be completed
        const building = ctx.state.entities.find(e => e.type === EntityType.Building)!;
        const buildingState = ctx.buildingStateManager.getBuildingState(building.id)!;
        expect(buildingState.phase).toBe(BuildingConstructionPhase.Completed);
        expect(buildingState.terrainModified).toBe(true);
    });
});
