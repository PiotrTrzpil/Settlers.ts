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
import { TERRAIN, setHeightAt } from '../helpers/test-map';
import { Simulation } from '../helpers/test-simulation';

describe('Resource Placement Commands', () => {
    let sim: Simulation;

    beforeEach(() => {
        sim = new Simulation({ useStubData: true, mapWidth: 64, mapHeight: 64 });
    });

    it('place_pile creates entity with correct attributes and stores quantity', () => {
        const amount = 5;
        const result = sim.execute({
            type: 'place_pile',
            materialType: EMaterialType.LOG,
            amount,
            x: 32,
            y: 32,
        });
        expect(result.success).toBe(true);

        const resources = sim.state.entities.filter(e => e.type === EntityType.StackedPile);
        expect(resources.length).toBe(1);

        const resource = resources[0]!;
        expect(resource.type).toBe(EntityType.StackedPile);
        expect(resource.subType).toBe(EMaterialType.LOG);
        expect(resource.x).toBe(32);
        expect(resource.y).toBe(32);

        const resourceState = sim.state.piles.states.get(resource.id);
        expect(resourceState).toBeDefined();
        expect(resourceState!.quantity).toBe(amount);
    });

    it('place_pile fails on water terrain', () => {
        const cx = Math.floor(sim.map.mapSize.width / 2);
        const cy = Math.floor(sim.map.mapSize.height / 2);
        sim.map.groundType[sim.map.mapSize.toIndex(cx, cy)] = TERRAIN.WATER;

        const result = sim.execute({
            type: 'place_pile',
            materialType: EMaterialType.LOG,
            amount: 1,
            x: cx,
            y: cy,
        });
        expect(result.success).toBe(false);

        const resources = sim.state.entities.filter(e => e.type === EntityType.StackedPile);
        expect(resources.length).toBe(0);
    });

    it('multiple resources with different materials and amounts can be placed', () => {
        const materials = [EMaterialType.LOG, EMaterialType.BOARD, EMaterialType.STONE];
        const amounts = [1, 5, 8];

        for (let i = 0; i < materials.length; i++) {
            const x = 10 + i * 3;
            const y = 10 + i * 3;
            const result = sim.execute({
                type: 'place_pile',
                materialType: materials[i]!,
                amount: amounts[i]!,
                x,
                y,
            });
            expect(result.success).toBe(true);
        }

        const resources = sim.state.entities.filter(e => e.type === EntityType.StackedPile);
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
    let sim: Simulation;

    beforeEach(() => {
        sim = new Simulation({ useStubData: true, mapWidth: 64, mapHeight: 64 });
    });

    it('should change ground to raw immediately on placement (normal mode)', () => {
        const tile = { x: 32, y: 32 };

        // Verify ground is grass before placement
        const footprint = getBuildingFootprint(tile.x, tile.y, BuildingType.WoodcutterHut, Race.Roman);
        for (const ft of footprint) {
            expect(sim.map.groundType[sim.map.mapSize.toIndex(ft.x, ft.y)]).toBe(TERRAIN.GRASS);
        }

        const result = sim.execute({
            type: 'place_building',
            buildingType: BuildingType.WoodcutterHut,
            x: tile.x,
            y: tile.y,
            player: 0,
            race: 10,
        });
        expect(result.success).toBe(true);

        // Ground type should be raw (DustyWay) immediately after placement - no tick needed
        for (const ft of footprint) {
            expect(sim.map.groundType[sim.map.mapSize.toIndex(ft.x, ft.y)]).toBe(CONSTRUCTION_SITE_GROUND_TYPE);
        }
    });

    it('should capture original terrain at placement time (normal mode)', () => {
        const tile = { x: 32, y: 32 };

        const result = sim.execute({
            type: 'place_building',
            buildingType: BuildingType.WoodcutterHut,
            x: tile.x,
            y: tile.y,
            player: 0,
            race: 10,
        });
        expect(result.success).toBe(true);

        const building = sim.state.entities.find(e => e.type === EntityType.Building)!;
        const site = sim.services.constructionSiteManager.getSite(building.id);
        expect(site).toBeDefined();
        expect(site!.terrain.originalTerrain).not.toBeNull();
        expect(site!.terrain.originalTerrain!.tiles.length).toBeGreaterThan(0);
    });

    it('should change ground and level heights instantly in completed mode', () => {
        const tile = { x: 32, y: 32 };

        // Set varying heights within slope tolerance (MAX_SLOPE_DIFF = 12)
        setHeightAt(sim.map, tile.x, tile.y, 10);
        setHeightAt(sim.map, tile.x + 1, tile.y, 14);
        setHeightAt(sim.map, tile.x, tile.y + 1, 12);
        setHeightAt(sim.map, tile.x + 1, tile.y + 1, 8);

        const result = sim.execute({
            type: 'place_building',
            buildingType: BuildingType.WoodcutterHut,
            x: tile.x,
            y: tile.y,
            player: 0,
            race: 10,
            completed: true,
        });
        expect(result.success).toBe(true);

        // Ground type should be raw
        const footprint = getBuildingFootprint(tile.x, tile.y, BuildingType.WoodcutterHut, Race.Roman);
        for (const ft of footprint) {
            expect(sim.map.groundType[sim.map.mapSize.toIndex(ft.x, ft.y)]).toBe(CONSTRUCTION_SITE_GROUND_TYPE);
        }

        // Heights should be leveled (all the same target height)
        const heights = footprint.map(ft => sim.map.groundHeight[sim.map.mapSize.toIndex(ft.x, ft.y)]);
        const uniqueHeights = new Set(heights);
        expect(uniqueHeights.size).toBe(1);

        // Building should be completed (no construction site = operational)
        const building = sim.state.entities.find(e => e.type === EntityType.Building)!;
        expect(sim.services.constructionSiteManager.hasSite(building.id)).toBe(false);
    });
});
