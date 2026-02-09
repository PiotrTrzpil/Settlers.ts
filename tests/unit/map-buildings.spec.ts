import { describe, it, expect, beforeEach } from 'vitest';
import { createGameState } from './helpers/test-game';
import { populateMapBuildings, mapS4BuildingType } from '@/game/systems/map-buildings';
import { S4BuildingType } from '@/resources/map/s4-types';
import { BuildingType } from '@/game/buildings/types';
import { EntityType } from '@/game/entity';
import { BuildingConstructionPhase } from '@/game/features/building-construction';
import type { MapBuildingData } from '@/resources/map/map-entity-data';
import type { GameState } from '@/game/game-state';

describe('populateMapBuildings', () => {
    let state: GameState;

    beforeEach(() => {
        state = createGameState();
    });

    it('should create completed building entities from map data', () => {
        const buildings: MapBuildingData[] = [
            { x: 10, y: 10, buildingType: S4BuildingType.WOODCUTTERHUT, player: 0 },
            { x: 20, y: 20, buildingType: S4BuildingType.SAWMILL, player: 1 },
        ];

        const count = populateMapBuildings(state, buildings);

        expect(count).toBe(2);
        expect(state.entities).toHaveLength(2);

        // Check first building
        const entity1 = state.getEntityAt(10, 10);
        expect(entity1).toBeDefined();
        expect(entity1!.type).toBe(EntityType.Building);
        expect(entity1!.subType).toBe(BuildingType.Lumberjack);
        expect(entity1!.player).toBe(0);

        // Check second building
        const entity2 = state.getEntityAt(20, 20);
        expect(entity2).toBeDefined();
        expect(entity2!.type).toBe(EntityType.Building);
        expect(entity2!.subType).toBe(BuildingType.Sawmill);
        expect(entity2!.player).toBe(1);
    });

    it('should create building states as completed', () => {
        const buildings: MapBuildingData[] = [
            { x: 10, y: 10, buildingType: S4BuildingType.BARRACKS, player: 0 },
        ];

        populateMapBuildings(state, buildings);

        const entity = state.getEntityAt(10, 10);
        expect(entity).toBeDefined();

        const buildingState = state.buildingStates.get(entity!.id);
        expect(buildingState).toBeDefined();
        expect(buildingState!.phase).toBe(BuildingConstructionPhase.Completed);
        expect(buildingState!.phaseProgress).toBe(1.0);
    });

    it('should skip unmapped building types', () => {
        const buildings: MapBuildingData[] = [
            { x: 10, y: 10, buildingType: 999 as S4BuildingType, player: 0 }, // Invalid type
            { x: 20, y: 20, buildingType: S4BuildingType.SAWMILL, player: 0 }, // Valid type
        ];

        const count = populateMapBuildings(state, buildings);

        expect(count).toBe(1);
        expect(state.entities).toHaveLength(1);
        expect(state.getEntityAt(10, 10)).toBeUndefined();
        expect(state.getEntityAt(20, 20)).toBeDefined();
    });

    it('should skip occupied tiles', () => {
        // Pre-occupy a tile
        state.addEntity(EntityType.MapObject, 1, 10, 10, 0);

        const buildings: MapBuildingData[] = [
            { x: 10, y: 10, buildingType: S4BuildingType.WOODCUTTERHUT, player: 0 }, // Occupied
            { x: 20, y: 20, buildingType: S4BuildingType.WOODCUTTERHUT, player: 0 }, // Free
        ];

        const count = populateMapBuildings(state, buildings);

        expect(count).toBe(1);
        expect(state.entities).toHaveLength(2); // 1 map object + 1 building
    });

    it('should filter by player when specified', () => {
        const buildings: MapBuildingData[] = [
            { x: 10, y: 10, buildingType: S4BuildingType.WOODCUTTERHUT, player: 0 },
            { x: 20, y: 20, buildingType: S4BuildingType.SAWMILL, player: 1 },
            { x: 30, y: 30, buildingType: S4BuildingType.MILL, player: 0 },
        ];

        const count = populateMapBuildings(state, buildings, { player: 0 });

        expect(count).toBe(2);
        expect(state.entities).toHaveLength(2);
        expect(state.getEntityAt(10, 10)).toBeDefined();
        expect(state.getEntityAt(20, 20)).toBeUndefined();
        expect(state.getEntityAt(30, 30)).toBeDefined();
    });
});

describe('mapS4BuildingType', () => {
    it('should map known S4 building types to internal types', () => {
        expect(mapS4BuildingType(S4BuildingType.WOODCUTTERHUT)).toBe(BuildingType.Lumberjack);
        expect(mapS4BuildingType(S4BuildingType.SAWMILL)).toBe(BuildingType.Sawmill);
        expect(mapS4BuildingType(S4BuildingType.BARRACKS)).toBe(BuildingType.Barrack);
        expect(mapS4BuildingType(S4BuildingType.CASTLE)).toBe(BuildingType.Castle);
    });

    it('should return undefined for unknown types', () => {
        expect(mapS4BuildingType(S4BuildingType.NONE)).toBeUndefined();
        expect(mapS4BuildingType(999 as S4BuildingType)).toBeUndefined();
    });
});
