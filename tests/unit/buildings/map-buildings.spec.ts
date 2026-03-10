import { describe, it, expect, beforeEach } from 'vitest';
import { createTestContext, type TestContext } from '../helpers/test-game';
import { populateMapBuildings, mapS4BuildingType } from '@/game/features/building-construction';
import { S4BuildingType } from '@/resources/map/s4-types';
import { BuildingType } from '@/game/buildings/types';
import { EntityType } from '@/game/entity';
import { Race } from '@/game/core/race';
import type { MapBuildingData } from '@/resources/map/map-entity-data';

function createPopulateOptions(ctx: TestContext, player?: number) {
    return {
        player,
        eventBus: ctx.eventBus,
        terrain: ctx.map.terrain,
    };
}

describe('populateMapBuildings', () => {
    let ctx: TestContext;

    beforeEach(() => {
        ctx = createTestContext();
    });

    it('should create completed building entities from map data with correct type mapping', () => {
        const buildings: MapBuildingData[] = [
            { x: 10, y: 10, buildingType: S4BuildingType.WOODCUTTERHUT, player: 0 },
            { x: 20, y: 20, buildingType: S4BuildingType.SAWMILL, player: 1 },
        ];

        const count = populateMapBuildings(ctx.state, buildings, createPopulateOptions(ctx));

        expect(count).toBe(2);
        expect(ctx.state.entities).toHaveLength(2); // 2 buildings (workers come from map settler data)

        const entity1 = ctx.state.getEntityAt(10, 10)!;
        expect(entity1.type).toBe(EntityType.Building);
        expect(entity1.subType).toBe(BuildingType.WoodcutterHut);
        expect(entity1.player).toBe(0);

        const entity2 = ctx.state.getEntityAt(20, 20)!;
        expect(entity2.subType).toBe(BuildingType.Sawmill);
        expect(entity2.player).toBe(1);

        // Map-loaded buildings bypass construction (no ConstructionSite)
        expect(ctx.constructionSiteManager.hasSite(entity1.id)).toBe(false);
    });

    it('should skip unmapped building types and occupied tiles', () => {
        ctx.state.addEntity(EntityType.MapObject, 1, 10, 10, 0); // Pre-occupy

        const buildings: MapBuildingData[] = [
            { x: 10, y: 10, buildingType: S4BuildingType.WOODCUTTERHUT, player: 0 }, // Occupied
            { x: 20, y: 20, buildingType: 999 as S4BuildingType, player: 0 }, // Invalid type
            { x: 30, y: 30, buildingType: S4BuildingType.SAWMILL, player: 0 }, // Valid
        ];

        const count = populateMapBuildings(ctx.state, buildings, createPopulateOptions(ctx));

        expect(count).toBe(1);
        expect(ctx.state.getEntityAt(10, 10)!.type).toBe(EntityType.MapObject); // unchanged
        expect(ctx.state.getEntityAt(20, 20)).toBeUndefined();
        expect(ctx.state.getEntityAt(30, 30)).toBeDefined();
    });

    it('should filter by player when specified', () => {
        const buildings: MapBuildingData[] = [
            { x: 10, y: 10, buildingType: S4BuildingType.WOODCUTTERHUT, player: 0 },
            { x: 20, y: 20, buildingType: S4BuildingType.SAWMILL, player: 1 },
            { x: 30, y: 30, buildingType: S4BuildingType.MILL, player: 0 },
        ];

        const count = populateMapBuildings(ctx.state, buildings, createPopulateOptions(ctx, 0));

        expect(count).toBe(2);
        expect(ctx.state.getEntityAt(10, 10)).toBeDefined();
        expect(ctx.state.getEntityAt(20, 20)).toBeUndefined();
        expect(ctx.state.getEntityAt(30, 30)).toBeDefined();
    });

    it('should spawn carriers for residence buildings and emit correct events', () => {
        const completedEvents: Array<{ buildingType: BuildingType; race: Race }> = [];
        const spawnedEvents: number[] = [];
        ctx.eventBus.on('building:completed', ({ buildingType, race }) => completedEvents.push({ buildingType, race }));
        ctx.eventBus.on('unit:spawned', ({ entityId }) => spawnedEvents.push(entityId));

        const buildings: MapBuildingData[] = [{ x: 10, y: 10, buildingType: S4BuildingType.RESIDENCESMALL, player: 0 }];

        populateMapBuildings(ctx.state, buildings, createPopulateOptions(ctx));

        // ResidenceSmall spawns 2 carriers (1 building + 2 carriers)
        expect(ctx.state.entities).toHaveLength(3);

        expect(completedEvents).toHaveLength(1);
        expect(completedEvents[0]!.race).toBe(Race.Roman);

        // 2 carriers = 2 unit:spawned events
        expect(spawnedEvents).toHaveLength(2);
    });
});

describe('mapS4BuildingType', () => {
    it('should map known S4 types and return undefined for unknown', () => {
        expect(mapS4BuildingType(S4BuildingType.WOODCUTTERHUT)).toBe(BuildingType.WoodcutterHut);
        expect(mapS4BuildingType(S4BuildingType.CASTLE)).toBe(BuildingType.Castle);
        expect(mapS4BuildingType(S4BuildingType.NONE)).toBeUndefined();
        expect(mapS4BuildingType(999 as S4BuildingType)).toBeUndefined();
    });
});
