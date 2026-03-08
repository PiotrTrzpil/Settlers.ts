/**
 * Unit tests for placement commands — buildings, units, resources.
 *
 * Focuses on terrain modification at placement time (regression tests)
 * and resource placement. Basic spawn_unit tests are covered by
 * unit-placement-selection-movement.spec.ts.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { EntityType } from '@/game/entity';
import { BuildingType, getBuildingFootprint } from '@/game/buildings';
import { Race } from '@/game/core/race';
import { EMaterialType } from '@/game/economy/material-type';
import { CONSTRUCTION_SITE_GROUND_TYPE } from '@/game/features/building-construction';
import {
    createTestContext,
    placeBuilding,
    placeResource,
    findPassableTile,
    findBuildableTile,
    type TestContext,
} from '../helpers/test-game';
import { TERRAIN, setHeightAt } from '../helpers/test-map';

describe('Resource Placement Commands', () => {
    let ctx: TestContext;

    beforeEach(() => {
        ctx = createTestContext();
    });

    it('place_pile creates entity with correct attributes and stores quantity', () => {
        const tile = findPassableTile(ctx.map);
        expect(tile).not.toBeNull();

        const amount = 5;
        const result = placeResource(ctx, tile!.x, tile!.y, EMaterialType.LOG, amount);
        expect(result.success).toBe(true);

        const resources = ctx.state.entities.filter(e => e.type === EntityType.StackedPile);
        expect(resources.length).toBe(1);

        const resource = resources[0]!;
        expect(resource.type).toBe(EntityType.StackedPile);
        expect(resource.subType).toBe(EMaterialType.LOG);
        expect(resource.x).toBe(tile!.x);
        expect(resource.y).toBe(tile!.y);

        const resourceState = ctx.state.piles.states.get(resource.id);
        expect(resourceState).toBeDefined();
        expect(resourceState!.quantity).toBe(amount);
    });

    it('place_pile fails on water terrain', () => {
        const cx = Math.floor(ctx.map.mapSize.width / 2);
        const cy = Math.floor(ctx.map.mapSize.height / 2);
        ctx.map.groundType[ctx.map.mapSize.toIndex(cx, cy)] = TERRAIN.WATER;

        const result = placeResource(ctx, cx, cy, EMaterialType.LOG);
        expect(result.success).toBe(false);

        const resources = ctx.state.entities.filter(e => e.type === EntityType.StackedPile);
        expect(resources.length).toBe(0);
    });

    it('multiple resources with different materials and amounts can be placed', () => {
        const materials = [EMaterialType.LOG, EMaterialType.BOARD, EMaterialType.STONE];
        const amounts = [1, 5, 8];

        for (let i = 0; i < materials.length; i++) {
            const x = 10 + i * 3;
            const y = 10 + i * 3;
            const result = placeResource(ctx, x, y, materials[i]!, amounts[i]);
            expect(result.success).toBe(true);
        }

        const resources = ctx.state.entities.filter(e => e.type === EntityType.StackedPile);
        expect(resources.length).toBe(3);
        expect(resources.map(r => r.subType)).toContain(EMaterialType.LOG);
        expect(resources.map(r => r.subType)).toContain(EMaterialType.BOARD);
        expect(resources.map(r => r.subType)).toContain(EMaterialType.STONE);
    });
});

// ---------------------------------------------------------------------------
// Terrain modification at placement time (regression tests)
// ---------------------------------------------------------------------------

describe('Building Placement Terrain Modification', () => {
    let ctx: TestContext;

    beforeEach(() => {
        ctx = createTestContext();
    });

    it('should change ground to raw immediately on placement (normal mode)', () => {
        const tile = findBuildableTile(ctx.map);
        expect(tile).not.toBeNull();

        // Verify ground is grass before placement
        const footprint = getBuildingFootprint(tile!.x, tile!.y, BuildingType.WoodcutterHut, Race.Roman);
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
        const site = ctx.constructionSiteManager.getSite(building.id);
        expect(site).toBeDefined();
        expect(site!.terrain.originalTerrain).not.toBeNull();
        expect(site!.terrain.originalTerrain!.tiles.length).toBeGreaterThan(0);
    });

    it('should change ground and level heights instantly in completed mode', () => {
        const tile = findBuildableTile(ctx.map);
        expect(tile).not.toBeNull();

        // Set varying heights within slope tolerance (MAX_SLOPE_DIFF = 8)
        setHeightAt(ctx.map, tile!.x, tile!.y, 10);
        setHeightAt(ctx.map, tile!.x + 1, tile!.y, 14);
        setHeightAt(ctx.map, tile!.x, tile!.y + 1, 12);
        setHeightAt(ctx.map, tile!.x + 1, tile!.y + 1, 8);

        const result = placeBuilding(ctx, tile!.x, tile!.y, BuildingType.WoodcutterHut, 0, { completed: true });
        expect(result.success).toBe(true);

        // Ground type should be raw
        const footprint = getBuildingFootprint(tile!.x, tile!.y, BuildingType.WoodcutterHut, Race.Roman);
        for (const ft of footprint) {
            expect(ctx.map.groundType[ctx.map.mapSize.toIndex(ft.x, ft.y)]).toBe(CONSTRUCTION_SITE_GROUND_TYPE);
        }

        // Heights should be leveled (all the same target height)
        const heights = footprint.map(ft => ctx.map.groundHeight[ctx.map.mapSize.toIndex(ft.x, ft.y)]);
        const uniqueHeights = new Set(heights);
        expect(uniqueHeights.size).toBe(1);

        // Building should be completed (no construction site = operational)
        const building = ctx.state.entities.find(e => e.type === EntityType.Building)!;
        expect(ctx.constructionSiteManager.hasSite(building.id)).toBe(false);
    });
});
