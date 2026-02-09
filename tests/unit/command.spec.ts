import { describe, it, expect, beforeEach } from 'vitest';
import { BuildingConstructionPhase, EntityType } from '@/game/entity';
import { executeCommand } from '@/game/commands/command';
import { captureOriginalTerrain, applyTerrainLeveling, CONSTRUCTION_SITE_GROUND_TYPE } from '@/game/features/building-construction';
import { createTestMap, TERRAIN, setTerrainAt, blockColumn, type TestMap } from './helpers/test-map';
import { createGameState, addUnit, addBuilding, createTestEventBus } from './helpers/test-game';
import type { GameState } from '@/game/game-state';

// Note: Happy-path command tests (place_building, spawn_unit, select, deselect,
// area select, remove entity) are covered by flow integration tests in flows/.
// This file focuses on error/edge cases only.

describe('Command System – edge cases', () => {
    let state: GameState;
    let map: TestMap;

    beforeEach(() => {
        state = createGameState();
        map = createTestMap();
    });

    describe('place_building', () => {
        it('should reject building on water', () => {
            setTerrainAt(map, 10, 10, TERRAIN.WATER);
            const result = executeCommand(state, {
                type: 'place_building',
                buildingType: 1, x: 10, y: 10, player: 0,
            }, map.groundType, map.groundHeight, map.mapSize);

            expect(result).toBe(false);
            expect(state.entities).toHaveLength(0);
        });
    });

    describe('move_unit', () => {
        it('should fail for non-existent unit', () => {
            const result = executeCommand(state, {
                type: 'move_unit', entityId: 999, targetX: 10, targetY: 5,
            }, map.groundType, map.groundHeight, map.mapSize);
            expect(result).toBe(false);
        });

        it('should fail when no path exists', () => {
            executeCommand(state, {
                type: 'spawn_unit', unitType: 0, x: 5, y: 5, player: 0,
            }, map.groundType, map.groundHeight, map.mapSize);

            blockColumn(map, 15);

            const result = executeCommand(state, {
                type: 'move_unit', entityId: state.entities[0].id, targetX: 20, targetY: 5,
            }, map.groundType, map.groundHeight, map.mapSize);
            expect(result).toBe(false);
        });
    });

    describe('select_area', () => {
        it('should prefer units over buildings in area', () => {
            addBuilding(state, 10, 10, 0);
            addUnit(state, 11, 10, { subType: 1 }); // Builder (selectable)

            executeCommand(state, {
                type: 'select_area', x1: 9, y1: 9, x2: 12, y2: 11,
            }, map.groundType, map.groundHeight, map.mapSize);

            expect(state.selectedEntityIds.size).toBe(1);
            const selectedId = Array.from(state.selectedEntityIds)[0];
            expect(state.getEntity(selectedId)?.type).toBe(EntityType.Unit);
        });
    });

    describe('remove_entity', () => {
        it('should fail for non-existent entity', () => {
            const result = executeCommand(state, {
                type: 'remove_entity', entityId: 999,
            }, map.groundType, map.groundHeight, map.mapSize);
            expect(result).toBe(false);
        });

        it('should restore terrain when removing a building with modified terrain', () => {
            for (let dy = -1; dy <= 2; dy++) {
                for (let dx = -1; dx <= 2; dx++) {
                    const idx = map.mapSize.toIndex(10 + dx, 10 + dy);
                    map.groundHeight[idx] = 100 + dy * 5;
                }
            }

            const originalGroundType = new Uint8Array(map.groundType);
            const originalGroundHeight = new Uint8Array(map.groundHeight);

            const building = addBuilding(state, 10, 10, 1);
            const bs = state.buildingStates.get(building.id)!;

            bs.originalTerrain = captureOriginalTerrain(bs, map.groundType, map.groundHeight, map.mapSize);
            bs.terrainModified = true;
            bs.phase = BuildingConstructionPhase.TerrainLeveling;
            applyTerrainLeveling(bs, map.groundType, map.groundHeight, map.mapSize, 1.0);

            expect(map.groundType[map.mapSize.toIndex(10, 10)]).toBe(CONSTRUCTION_SITE_GROUND_TYPE);

            const eventBus = createTestEventBus(state, map);
            executeCommand(state, {
                type: 'remove_entity', entityId: building.id,
            }, map.groundType, map.groundHeight, map.mapSize, eventBus);

            for (let dy = -1; dy <= 2; dy++) {
                for (let dx = -1; dx <= 2; dx++) {
                    const idx = map.mapSize.toIndex(10 + dx, 10 + dy);
                    expect(map.groundType[idx]).toBe(originalGroundType[idx]);
                    expect(map.groundHeight[idx]).toBe(originalGroundHeight[idx]);
                }
            }
        });
    });
});
