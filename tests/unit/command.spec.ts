import { describe, it, expect, beforeEach } from 'vitest';
import { EntityType } from '@/game/entity';
import { BuildingConstructionPhase } from '@/game/features/building-construction';
import { executeCommand } from '@/game/commands';
import {
    captureOriginalTerrain,
    applyTerrainLeveling,
    CONSTRUCTION_SITE_GROUND_TYPE,
} from '@/game/features/building-construction';
import { TERRAIN, setTerrainAt, blockColumn } from './helpers/test-map';
import { createTestContext, addUnit, addBuilding, createTestEventBus, type TestContext } from './helpers/test-game';

// Note: Happy-path command tests (place_building, spawn_unit, select, deselect,
// area select, remove entity) are covered by flow integration tests in flows/.
// This file focuses on error/edge cases only.

describe('Command System – edge cases', () => {
    let ctx: TestContext;

    beforeEach(() => {
        ctx = createTestContext();
    });

    describe('place_building', () => {
        it('should reject building on water', () => {
            setTerrainAt(ctx.map, 10, 10, TERRAIN.WATER);
            const result = executeCommand(
                ctx.state,
                {
                    type: 'place_building',
                    buildingType: 1,
                    x: 10,
                    y: 10,
                    player: 0,
                },
                ctx.map.groundType,
                ctx.map.groundHeight,
                ctx.map.mapSize,
                ctx.eventBus,
                undefined,
                ctx.buildingStateManager
            );

            expect(result).toBe(false);
            expect(ctx.state.entities).toHaveLength(0);
        });
    });

    describe('move_unit', () => {
        it('should fail for non-existent unit', () => {
            const result = executeCommand(
                ctx.state,
                {
                    type: 'move_unit',
                    entityId: 999,
                    targetX: 10,
                    targetY: 5,
                },
                ctx.map.groundType,
                ctx.map.groundHeight,
                ctx.map.mapSize,
                ctx.eventBus,
                undefined,
                ctx.buildingStateManager
            );
            expect(result).toBe(false);
        });

        it('should fail when no path exists', () => {
            executeCommand(
                ctx.state,
                {
                    type: 'spawn_unit',
                    unitType: 0,
                    x: 5,
                    y: 5,
                    player: 0,
                },
                ctx.map.groundType,
                ctx.map.groundHeight,
                ctx.map.mapSize,
                ctx.eventBus,
                undefined,
                ctx.buildingStateManager
            );

            blockColumn(ctx.map, 15);

            const result = executeCommand(
                ctx.state,
                {
                    type: 'move_unit',
                    entityId: ctx.state.entities[0].id,
                    targetX: 20,
                    targetY: 5,
                },
                ctx.map.groundType,
                ctx.map.groundHeight,
                ctx.map.mapSize,
                ctx.eventBus,
                undefined,
                ctx.buildingStateManager
            );
            expect(result).toBe(false);
        });
    });

    describe('select_area', () => {
        it('should prefer units over buildings in area', () => {
            addBuilding(ctx.state, 10, 10, 0);
            addUnit(ctx.state, 11, 10, { subType: 2 }); // Swordsman (selectable - Military category)

            executeCommand(
                ctx.state,
                {
                    type: 'select_area',
                    x1: 9,
                    y1: 9,
                    x2: 12,
                    y2: 11,
                },
                ctx.map.groundType,
                ctx.map.groundHeight,
                ctx.map.mapSize,
                ctx.eventBus,
                undefined,
                ctx.buildingStateManager
            );

            expect(ctx.state.selectedEntityIds.size).toBe(1);
            const selectedId = Array.from(ctx.state.selectedEntityIds)[0];
            expect(ctx.state.getEntity(selectedId)?.type).toBe(EntityType.Unit);
        });
    });

    describe('remove_entity', () => {
        it('should fail for non-existent entity', () => {
            const result = executeCommand(
                ctx.state,
                {
                    type: 'remove_entity',
                    entityId: 999,
                },
                ctx.map.groundType,
                ctx.map.groundHeight,
                ctx.map.mapSize,
                ctx.eventBus,
                undefined,
                ctx.buildingStateManager
            );
            expect(result).toBe(false);
        });

        it('should restore terrain when removing a building with modified terrain', () => {
            for (let dy = -1; dy <= 2; dy++) {
                for (let dx = -1; dx <= 2; dx++) {
                    const idx = ctx.map.mapSize.toIndex(10 + dx, 10 + dy);
                    ctx.map.groundHeight[idx] = 100 + dy * 5;
                }
            }

            const originalGroundType = new Uint8Array(ctx.map.groundType);
            const originalGroundHeight = new Uint8Array(ctx.map.groundHeight);

            const building = addBuilding(ctx.state, 10, 10, 1);
            const bs = ctx.buildingStateManager.getBuildingState(building.id)!;

            bs.originalTerrain = captureOriginalTerrain(bs, ctx.map.groundType, ctx.map.groundHeight, ctx.map.mapSize);
            bs.terrainModified = true;
            bs.phase = BuildingConstructionPhase.TerrainLeveling;
            applyTerrainLeveling(bs, ctx.map.groundType, ctx.map.groundHeight, ctx.map.mapSize, 1.0);

            expect(ctx.map.groundType[ctx.map.mapSize.toIndex(10, 10)]).toBe(CONSTRUCTION_SITE_GROUND_TYPE);

            const eventBus = createTestEventBus(ctx.state, ctx.map, ctx.buildingStateManager);
            executeCommand(
                ctx.state,
                {
                    type: 'remove_entity',
                    entityId: building.id,
                },
                ctx.map.groundType,
                ctx.map.groundHeight,
                ctx.map.mapSize,
                eventBus,
                undefined,
                ctx.buildingStateManager
            );

            for (let dy = -1; dy <= 2; dy++) {
                for (let dx = -1; dx <= 2; dx++) {
                    const idx = ctx.map.mapSize.toIndex(10 + dx, 10 + dy);
                    expect(ctx.map.groundType[idx]).toBe(originalGroundType[idx]);
                    expect(ctx.map.groundHeight[idx]).toBe(originalGroundHeight[idx]);
                }
            }
        });
    });
});
