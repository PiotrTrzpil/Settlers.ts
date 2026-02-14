import { describe, it, expect, beforeEach } from 'vitest';
import { createTestContext, type TestContext } from './helpers/test-game';
import { populateMapBuildings, mapS4BuildingType } from '@/game/systems/map-buildings';
import { S4BuildingType } from '@/resources/map/s4-types';
import { BuildingType } from '@/game/buildings/types';
import { EntityType } from '@/game/entity';
import { BuildingConstructionPhase } from '@/game/features/building-construction';
import type { MapBuildingData } from '@/resources/map/map-entity-data';

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

        const count = populateMapBuildings(ctx.state, buildings, {
            buildingStateManager: ctx.buildingStateManager,
        });

        expect(count).toBe(2);
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

        populateMapBuildings(ctx.state, buildings, {
            buildingStateManager: ctx.buildingStateManager,
        });

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

        const count = populateMapBuildings(ctx.state, buildings, {
            buildingStateManager: ctx.buildingStateManager,
        });

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

        const count = populateMapBuildings(ctx.state, buildings, {
            buildingStateManager: ctx.buildingStateManager,
        });

        expect(count).toBe(1);
        expect(ctx.state.entities).toHaveLength(2); // 1 map object + 1 building
    });

    it('should filter by player when specified', () => {
        const buildings: MapBuildingData[] = [
            { x: 10, y: 10, buildingType: S4BuildingType.WOODCUTTERHUT, player: 0 },
            { x: 20, y: 20, buildingType: S4BuildingType.SAWMILL, player: 1 },
            { x: 30, y: 30, buildingType: S4BuildingType.MILL, player: 0 },
        ];

        const count = populateMapBuildings(ctx.state, buildings, {
            player: 0,
            buildingStateManager: ctx.buildingStateManager,
        });

        expect(count).toBe(2);
        expect(ctx.state.entities).toHaveLength(2);
        expect(ctx.state.getEntityAt(10, 10)).toBeDefined();
        expect(ctx.state.getEntityAt(20, 20)).toBeUndefined();
        expect(ctx.state.getEntityAt(30, 30)).toBeDefined();
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
