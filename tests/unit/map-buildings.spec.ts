import { describe, it, expect, beforeEach } from 'vitest';
import { createTestContext, type TestContext } from './helpers/test-game';
import { populateMapBuildings, mapS4BuildingType } from '@/game/systems/map-buildings';
import { S4BuildingType } from '@/resources/map/s4-types';
import { BuildingType } from '@/game/buildings/types';
import { EntityType } from '@/game/entity';
import { BuildingConstructionPhase } from '@/game/features/building-construction';
import type { MapBuildingData } from '@/resources/map/map-entity-data';

/** Helper to create populate options from test context */
function createPopulateOptions(ctx: TestContext, player?: number) {
    return {
        player,
        buildingStateManager: ctx.buildingStateManager,
        eventBus: ctx.eventBus,
        terrain: {
            groundType: ctx.map.groundType,
            mapSize: ctx.map.mapSize,
        },
    };
}

describe('populateMapBuildings', () => {
    let ctx: TestContext;

    beforeEach(() => {
        ctx = createTestContext();
    });

    it('should create completed building entities from map data', () => {
        const buildings: MapBuildingData[] = [
            { x: 10, y: 10, buildingType: S4BuildingType.WOODCUTTERHUT, player: 0 },
            { x: 20, y: 20, buildingType: S4BuildingType.SAWMILL, player: 1 },
        ];

        const count = populateMapBuildings(ctx.state, buildings, createPopulateOptions(ctx));

        expect(count).toBe(2);
        // 2 buildings, no units spawned (woodcutter/sawmill don't spawn units)
        expect(ctx.state.entities).toHaveLength(2);

        // Check first building
        const entity1 = ctx.state.getEntityAt(10, 10);
        expect(entity1).toBeDefined();
        expect(entity1!.type).toBe(EntityType.Building);
        expect(entity1!.subType).toBe(BuildingType.WoodcutterHut);
        expect(entity1!.player).toBe(0);

        // Check second building
        const entity2 = ctx.state.getEntityAt(20, 20);
        expect(entity2).toBeDefined();
        expect(entity2!.type).toBe(EntityType.Building);
        expect(entity2!.subType).toBe(BuildingType.Sawmill);
        expect(entity2!.player).toBe(1);
    });

    it('should create building states as completed', () => {
        const buildings: MapBuildingData[] = [{ x: 10, y: 10, buildingType: S4BuildingType.BARRACKS, player: 0 }];

        populateMapBuildings(ctx.state, buildings, createPopulateOptions(ctx));

        const entity = ctx.state.getEntityAt(10, 10);
        expect(entity).toBeDefined();

        const buildingState = ctx.buildingStateManager.getBuildingState(entity!.id);
        expect(buildingState).toBeDefined();
        expect(buildingState!.phase).toBe(BuildingConstructionPhase.Completed);
        expect(buildingState!.phaseProgress).toBe(1.0);
    });

    it('should skip unmapped building types', () => {
        const buildings: MapBuildingData[] = [
            { x: 10, y: 10, buildingType: 999 as S4BuildingType, player: 0 }, // Invalid type
            { x: 20, y: 20, buildingType: S4BuildingType.SAWMILL, player: 0 }, // Valid type
        ];

        const count = populateMapBuildings(ctx.state, buildings, createPopulateOptions(ctx));

        expect(count).toBe(1);
        expect(ctx.state.entities).toHaveLength(1);
        expect(ctx.state.getEntityAt(10, 10)).toBeUndefined();
        expect(ctx.state.getEntityAt(20, 20)).toBeDefined();
    });

    it('should skip occupied tiles', () => {
        // Pre-occupy a tile
        ctx.state.addEntity(EntityType.MapObject, 1, 10, 10, 0);

        const buildings: MapBuildingData[] = [
            { x: 10, y: 10, buildingType: S4BuildingType.WOODCUTTERHUT, player: 0 }, // Occupied
            { x: 20, y: 20, buildingType: S4BuildingType.WOODCUTTERHUT, player: 0 }, // Free
        ];

        const count = populateMapBuildings(ctx.state, buildings, createPopulateOptions(ctx));

        expect(count).toBe(1);
        expect(ctx.state.entities).toHaveLength(2); // 1 map object + 1 building
    });

    it('should filter by player when specified', () => {
        const buildings: MapBuildingData[] = [
            { x: 10, y: 10, buildingType: S4BuildingType.WOODCUTTERHUT, player: 0 },
            { x: 20, y: 20, buildingType: S4BuildingType.SAWMILL, player: 1 },
            { x: 30, y: 30, buildingType: S4BuildingType.MILL, player: 0 },
        ];

        const count = populateMapBuildings(ctx.state, buildings, createPopulateOptions(ctx, 0));

        expect(count).toBe(2);
        expect(ctx.state.entities).toHaveLength(2);
        expect(ctx.state.getEntityAt(10, 10)).toBeDefined();
        expect(ctx.state.getEntityAt(20, 20)).toBeUndefined();
        expect(ctx.state.getEntityAt(30, 30)).toBeDefined();
    });

    it('should spawn carriers for residence buildings', () => {
        const buildings: MapBuildingData[] = [{ x: 10, y: 10, buildingType: S4BuildingType.RESIDENCESMALL, player: 0 }];

        const count = populateMapBuildings(ctx.state, buildings, createPopulateOptions(ctx));

        expect(count).toBe(1);
        // ResidenceSmall spawns 2 carriers
        expect(ctx.state.entities).toHaveLength(3); // 1 building + 2 carriers
    });

    it('should emit building:completed event', () => {
        const completedEvents: number[] = [];
        ctx.eventBus.on('building:completed', ({ entityId }) => {
            completedEvents.push(entityId);
        });

        const buildings: MapBuildingData[] = [{ x: 10, y: 10, buildingType: S4BuildingType.WOODCUTTERHUT, player: 0 }];

        populateMapBuildings(ctx.state, buildings, createPopulateOptions(ctx));

        expect(completedEvents).toHaveLength(1);
    });

    it('should emit unit:spawned events for carriers', () => {
        const spawnedEvents: number[] = [];
        ctx.eventBus.on('unit:spawned', ({ entityId }) => {
            spawnedEvents.push(entityId);
        });

        const buildings: MapBuildingData[] = [{ x: 10, y: 10, buildingType: S4BuildingType.RESIDENCESMALL, player: 0 }];

        populateMapBuildings(ctx.state, buildings, createPopulateOptions(ctx));

        // ResidenceSmall spawns 2 carriers
        expect(spawnedEvents).toHaveLength(2);
    });
});

describe('mapS4BuildingType', () => {
    it('should map known S4 building types to internal types', () => {
        expect(mapS4BuildingType(S4BuildingType.WOODCUTTERHUT)).toBe(BuildingType.WoodcutterHut);
        expect(mapS4BuildingType(S4BuildingType.SAWMILL)).toBe(BuildingType.Sawmill);
        expect(mapS4BuildingType(S4BuildingType.BARRACKS)).toBe(BuildingType.Barrack);
        expect(mapS4BuildingType(S4BuildingType.CASTLE)).toBe(BuildingType.Castle);
    });

    it('should return undefined for unknown types', () => {
        expect(mapS4BuildingType(S4BuildingType.NONE)).toBeUndefined();
        expect(mapS4BuildingType(999 as S4BuildingType)).toBeUndefined();
    });
});
