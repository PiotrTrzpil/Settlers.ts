import { describe, it, expect, beforeEach } from 'vitest';
import { Simulation } from '../../helpers/test-simulation';
import { populateMapBuildings, mapS4BuildingType } from '@/game/features/building-construction';
import { S4BuildingType } from '@/resources/map/s4-types';
import { BuildingType } from '@/game/buildings/types';
import { EntityType } from '@/game/entity';
import { Race } from '@/game/core/race';
import type { MapBuildingData } from '@/resources/map/map-entity-data';

function createPopulateOptions(sim: Simulation, player?: number) {
    return {
        player,
        terrain: sim.map.terrain,
    };
}

describe('populateMapBuildings', () => {
    let sim: Simulation;

    beforeEach(() => {
        sim = new Simulation({ mapWidth: 64, mapHeight: 64 });
    });

    it('should create completed building entities from map data with correct type mapping', () => {
        const buildings: MapBuildingData[] = [
            { x: 10, y: 10, buildingType: S4BuildingType.WOODCUTTERHUT, player: 0 },
            { x: 20, y: 20, buildingType: S4BuildingType.SAWMILL, player: 1 },
        ];

        const result = populateMapBuildings(sim.state, buildings, createPopulateOptions(sim));

        expect(result).toHaveLength(2);
        expect(sim.state.entities).toHaveLength(2); // 2 buildings (workers come from map settler data)

        const entity1 = sim.state.getGroundEntityAt(10, 10)!;
        expect(entity1.type).toBe(EntityType.Building);
        expect(entity1.subType).toBe(BuildingType.WoodcutterHut);
        expect(entity1.player).toBe(0);

        const entity2 = sim.state.getGroundEntityAt(20, 20)!;
        expect(entity2.subType).toBe(BuildingType.Sawmill);
        expect(entity2.player).toBe(1);

        // Map-loaded buildings bypass construction (no ConstructionSite)
        expect(sim.services.constructionSiteManager.hasSite(entity1.id)).toBe(false);
    });

    it('should skip unmapped building types and occupied tiles', () => {
        sim.state.addEntity(EntityType.MapObject, 1, 10, 10, 0); // Pre-occupy

        const buildings: MapBuildingData[] = [
            { x: 10, y: 10, buildingType: S4BuildingType.WOODCUTTERHUT, player: 0 }, // Occupied
            { x: 20, y: 20, buildingType: 999 as S4BuildingType, player: 0 }, // Invalid type
            { x: 30, y: 30, buildingType: S4BuildingType.SAWMILL, player: 0 }, // Valid
        ];

        const result = populateMapBuildings(sim.state, buildings, createPopulateOptions(sim));

        expect(result).toHaveLength(1);
        expect(sim.state.getGroundEntityAt(10, 10)!.type).toBe(EntityType.MapObject); // unchanged
        expect(sim.state.getGroundEntityAt(20, 20)).toBeUndefined();
        expect(sim.state.getGroundEntityAt(30, 30)).toBeDefined();
    });

    it('should filter by player when specified', () => {
        const buildings: MapBuildingData[] = [
            { x: 10, y: 10, buildingType: S4BuildingType.WOODCUTTERHUT, player: 0 },
            { x: 20, y: 20, buildingType: S4BuildingType.SAWMILL, player: 1 },
            { x: 30, y: 30, buildingType: S4BuildingType.MILL, player: 0 },
        ];

        const result = populateMapBuildings(sim.state, buildings, createPopulateOptions(sim, 0));

        expect(result).toHaveLength(2);
        expect(sim.state.getGroundEntityAt(10, 10)).toBeDefined();
        expect(sim.state.getGroundEntityAt(20, 20)).toBeUndefined();
        expect(sim.state.getGroundEntityAt(30, 30)).toBeDefined();
    });

    it('should return building entries without emitting lifecycle events', () => {
        const completedEvents: Array<{ buildingType: BuildingType; race: Race }> = [];
        sim.eventBus.on('building:completed', ({ buildingType, race }) => completedEvents.push({ buildingType, race }));

        const buildings: MapBuildingData[] = [{ x: 10, y: 10, buildingType: S4BuildingType.RESIDENCESMALL, player: 0 }];

        const result = populateMapBuildings(sim.state, buildings, createPopulateOptions(sim));

        // Only the building entity — no carriers spawned (lifecycle events deferred)
        expect(sim.state.entities).toHaveLength(1);

        // No events emitted — caller is responsible for activation after reconciliation
        expect(completedEvents).toHaveLength(0);

        // Returns building info for deferred activation
        expect(result).toHaveLength(1);
        expect(result[0]!.buildingType).toBe(BuildingType.ResidenceSmall);
        expect(result[0]!.race).toBe(Race.Roman);
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
