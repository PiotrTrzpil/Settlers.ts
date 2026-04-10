/**
 * Unit tests for placement commands — buildings, units, resources.
 *
 * Focuses on terrain modification at placement time (regression tests)
 * and resource placement. Basic spawn_unit tests are covered by
 * unit-placement-selection-movement.spec.ts.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { EntityType, tileKey } from '@/game/entity';
import { BuildingType, getBuildingFootprint } from '@/game/buildings';
import { Race } from '@/game/core/race';
import { EMaterialType } from '@/game/economy/material-type';
import { MapObjectType } from '@/game/types/map-object-types';
import { CONSTRUCTION_SITE_GROUND_TYPE } from '@/game/features/building-construction';
import { TERRAIN, setHeightAt } from '../../helpers/test-map';
import { Simulation } from '../../helpers/test-simulation';

describe('Resource Placement Commands', () => {
    let sim: Simulation;

    beforeEach(() => {
        sim = new Simulation({ mapWidth: 64, mapHeight: 64 });
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

        const slot = sim.services.inventoryManager.getSlotByEntityId(resource.id);
        expect(slot).toBeDefined();
        expect(slot!.currentAmount).toBe(amount);
    });

    it('place_pile fails on water terrain', () => {
        const cx = Math.floor(sim.map.mapSize.width / 2);
        const cy = Math.floor(sim.map.mapSize.height / 2);
        sim.map.groundType[sim.map.mapSize.toIndex({ x: cx, y: cy })] = TERRAIN.WATER;

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
        sim = new Simulation({ mapWidth: 64, mapHeight: 64 });
    });

    it('should change ground to raw immediately on placement (normal mode)', () => {
        const tile = { x: 32, y: 32 };

        // Verify ground is grass before placement
        const footprint = getBuildingFootprint(tile, BuildingType.WoodcutterHut, Race.Roman);
        for (const ft of footprint) {
            expect(sim.map.groundType[sim.map.mapSize.toIndex(ft)]).toBe(TERRAIN.GRASS);
        }

        const result = sim.execute({
            type: 'place_building',
            buildingType: BuildingType.WoodcutterHut,
            x: tile.x,
            y: tile.y,
            player: 0,
            race: Race.Roman,
        });
        expect(result.success).toBe(true);

        // Ground type should be raw (DustyWay) immediately after placement - no tick needed
        for (const ft of footprint) {
            expect(sim.map.groundType[sim.map.mapSize.toIndex(ft)]).toBe(CONSTRUCTION_SITE_GROUND_TYPE);
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
            race: Race.Roman,
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
        setHeightAt(sim.map, { x: tile.x, y: tile.y }, 10);
        setHeightAt(sim.map, { x: tile.x + 1, y: tile.y }, 14);
        setHeightAt(sim.map, { x: tile.x, y: tile.y + 1 }, 12);
        setHeightAt(sim.map, { x: tile.x + 1, y: tile.y + 1 }, 8);

        const result = sim.execute({
            type: 'place_building',
            buildingType: BuildingType.WoodcutterHut,
            x: tile.x,
            y: tile.y,
            player: 0,
            race: Race.Roman,
            completed: true,
            trusted: true, // bypass slope check — footprint extends beyond the 4 tiles with set heights
        });
        expect(result.success).toBe(true);

        // Ground type should be raw
        const footprint = getBuildingFootprint(tile, BuildingType.WoodcutterHut, Race.Roman);
        for (const ft of footprint) {
            expect(sim.map.groundType[sim.map.mapSize.toIndex(ft)]).toBe(CONSTRUCTION_SITE_GROUND_TYPE);
        }

        // Heights should be leveled (all the same target height)
        const heights = footprint.map(ft => sim.map.groundHeight[sim.map.mapSize.toIndex(ft)]);
        const uniqueHeights = new Set(heights);
        expect(uniqueHeights.size).toBe(1);

        // Building should be completed (no construction site = operational)
        const building = sim.state.entities.find(e => e.type === EntityType.Building)!;
        expect(sim.services.constructionSiteManager.hasSite(building.id)).toBe(false);
    });
});

// ---------------------------------------------------------------------------
// Replaceable map objects — building placement over small decorations
// ---------------------------------------------------------------------------

describe('Building Placement Over Replaceable Map Objects', () => {
    let sim: Simulation;

    beforeEach(() => {
        sim = new Simulation({ mapWidth: 64, mapHeight: 64 });
    });

    it('should allow placing a building on tiles occupied by grass', () => {
        const bx = 32;
        const by = 32;
        const footprint = getBuildingFootprint({ x: bx, y: by }, BuildingType.WoodcutterHut, Race.Roman);

        // Place grass on every footprint tile
        for (const tile of footprint) {
            sim.state.addEntity(EntityType.MapObject, MapObjectType.Grass1, tile, 0);
        }

        const result = sim.execute({
            type: 'place_building',
            buildingType: BuildingType.WoodcutterHut,
            x: bx,
            y: by,
            player: 0,
            race: Race.Roman,
        });
        expect(result.success).toBe(true);
    });

    it('should remove replaceable map objects from footprint when placing a building', () => {
        const bx = 32;
        const by = 32;
        const footprint = getBuildingFootprint({ x: bx, y: by }, BuildingType.WoodcutterHut, Race.Roman);

        // Place a flower on every footprint tile
        for (const tile of footprint) {
            sim.state.addEntity(EntityType.MapObject, MapObjectType.Bush1, tile, 0);
        }

        const mapObjectsBefore = sim.state.entities.filter(e => e.type === EntityType.MapObject).length;
        expect(mapObjectsBefore).toBe(footprint.length);

        sim.execute({
            type: 'place_building',
            buildingType: BuildingType.WoodcutterHut,
            x: bx,
            y: by,
            player: 0,
            race: Race.Roman,
        });

        // All flowers should be removed
        const mapObjectsAfter = sim.state.entities.filter(e => e.type === EntityType.MapObject).length;
        expect(mapObjectsAfter).toBe(0);
    });

    it('should NOT allow placing a building on tiles occupied by trees', () => {
        const bx = 32;
        const by = 32;
        sim.state.addEntity(EntityType.MapObject, MapObjectType.TreeOak, { x: bx, y: by }, 0);

        const result = sim.execute({
            type: 'place_building',
            buildingType: BuildingType.WoodcutterHut,
            x: bx,
            y: by,
            player: 0,
            race: Race.Roman,
        });
        expect(result.success).toBe(false);
    });

    it('should handle mixed tiles — some with replaceable objects, some empty', () => {
        const bx = 32;
        const by = 32;
        const footprint = getBuildingFootprint({ x: bx, y: by }, BuildingType.WoodcutterHut, Race.Roman);

        // Place grass on only the first tile
        sim.state.addEntity(EntityType.MapObject, MapObjectType.Grass3, footprint[0]!, 0);

        const result = sim.execute({
            type: 'place_building',
            buildingType: BuildingType.WoodcutterHut,
            x: bx,
            y: by,
            player: 0,
            race: Race.Roman,
        });
        expect(result.success).toBe(true);

        // The grass should be removed
        const mapObjects = sim.state.entities.filter(e => e.type === EntityType.MapObject);
        expect(mapObjects.length).toBe(0);
    });

    it('should correctly update groundOccupancy after replacing map objects', () => {
        const bx = 32;
        const by = 32;
        const footprint = getBuildingFootprint({ x: bx, y: by }, BuildingType.WoodcutterHut, Race.Roman);

        // Place foliage on the first tile
        sim.state.addEntity(EntityType.MapObject, MapObjectType.Bush1, footprint[0]!, 0);

        sim.execute({
            type: 'place_building',
            buildingType: BuildingType.WoodcutterHut,
            x: bx,
            y: by,
            player: 0,
            race: Race.Roman,
        });

        // Every footprint tile should now be occupied by the building, not the old map object
        const building = sim.state.entities.find(e => e.type === EntityType.Building)!;
        for (const tile of footprint) {
            expect(sim.state.groundOccupancy.get(tileKey(tile))).toBe(building.id);
        }
    });
});
