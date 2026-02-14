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
import { BuildingType } from '@/game/buildings';
import { UnitType } from '@/game/unit-types';
import { EMaterialType } from '@/game/economy/material-type';
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
import { TERRAIN } from '../helpers/test-map';

describe('Building Placement Commands', () => {
    let ctx: TestContext;

    beforeEach(() => {
        ctx = createTestContext();
    });

    it('place_building creates entity with correct attributes', () => {
        const tile = findBuildableTile(ctx.map);
        expect(tile).not.toBeNull();

        const success = placeBuilding(ctx, tile!.x, tile!.y, BuildingType.WoodcutterHut);
        expect(success).toBe(true);

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

        const success = placeBuilding(ctx, cx, cy, BuildingType.WoodcutterHut);
        expect(success).toBe(false);

        const buildings = ctx.state.entities.filter(e => e.type === EntityType.Building);
        expect(buildings.length).toBe(0);
    });

    it('different building types can be placed', () => {
        const tile1 = findBuildableTile(ctx.map);
        expect(tile1).not.toBeNull();

        // Place WoodcutterHut
        const success1 = placeBuilding(ctx, tile1!.x, tile1!.y, BuildingType.WoodcutterHut);
        expect(success1).toBe(true);

        // Place StorageArea at different location
        const success2 = placeBuilding(ctx, tile1!.x + 5, tile1!.y + 5, BuildingType.StorageArea);
        expect(success2).toBe(true);

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

        const success = spawnUnit(ctx, tile!.x, tile!.y, UnitType.Carrier);
        expect(success).toBe(true);

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

        const success = spawnUnit(ctx, tile!.x, tile!.y, UnitType.Swordsman);
        expect(success).toBe(true);

        const units = ctx.state.entities.filter(e => e.type === EntityType.Unit);
        expect(units.length).toBe(1);
        expect(units[0].subType).toBe(UnitType.Swordsman);
    });

    it('spawn_unit uses specified coordinates', () => {
        const tile = findBuildableTile(ctx.map);
        expect(tile).not.toBeNull();

        const success = spawnUnit(ctx, tile!.x, tile!.y, UnitType.Builder);
        expect(success).toBe(true);

        const units = ctx.state.entities.filter(e => e.type === EntityType.Unit);
        expect(units.length).toBe(1);

        const unit = units[0];
        expect(unit.x).toBe(tile!.x);
        expect(unit.y).toBe(tile!.y);
    });

    it('spawned unit is on passable terrain (not water)', () => {
        const tile = findPassableTile(ctx.map);
        expect(tile).not.toBeNull();

        const success = spawnUnit(ctx, tile!.x, tile!.y, UnitType.Builder);
        expect(success).toBe(true);

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
        const success = placeResource(ctx, tile!.x, tile!.y, EMaterialType.LOG, amount);
        expect(success).toBe(true);

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
        const success = placeResource(ctx, tile!.x, tile!.y, EMaterialType.BOARD, amount);
        expect(success).toBe(true);

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
            const success = placeResource(ctx, x, y, EMaterialType.LOG);
            if (success) placedCount++;
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
            const success = placeResource(ctx, x, y, EMaterialType.LOG, amounts[i]);
            if (success) {
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

        const success = placeResource(ctx, cx, cy, EMaterialType.LOG);
        expect(success).toBe(false);

        const resources = ctx.state.entities.filter(e => e.type === EntityType.StackedResource);
        expect(resources.length).toBe(0);
    });
});
