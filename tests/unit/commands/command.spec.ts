import { describe, it, expect, beforeEach } from 'vitest';
import { BuildingConstructionPhase } from '@/game/features/building-construction';
import { executeCommand } from '@/game/commands';
import {
    captureOriginalTerrain,
    applyTerrainLeveling,
    CONSTRUCTION_SITE_GROUND_TYPE,
} from '@/game/features/building-construction';
import { TERRAIN, setTerrainAt, blockColumn } from '../helpers/test-map';
import { createTestContext, addBuilding, toCommandContext, type TestContext } from '../helpers/test-game';

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
            const result = executeCommand(toCommandContext(ctx), {
                type: 'place_building',
                buildingType: 1,
                x: 10,
                y: 10,
                player: 0,
                race: 10,
            });

            expect(result.success).toBe(false);
            expect(ctx.state.entities).toHaveLength(0);
        });
    });

    describe('move_unit', () => {
        it('should fail for non-existent unit', () => {
            const result = executeCommand(toCommandContext(ctx), {
                type: 'move_unit',
                entityId: 999,
                targetX: 10,
                targetY: 5,
            });
            expect(result.success).toBe(false);
        });

        it('should fail when no path exists', () => {
            executeCommand(toCommandContext(ctx), {
                type: 'spawn_unit',
                unitType: 0,
                x: 5,
                y: 5,
                player: 0,
                race: 10,
            });

            blockColumn(ctx.map, 15);

            const result = executeCommand(toCommandContext(ctx), {
                type: 'move_unit',
                entityId: ctx.state.entities[0]!.id,
                targetX: 20,
                targetY: 5,
            });
            expect(result.success).toBe(false);
        });
    });

    // select_area happy paths (including units-over-buildings priority)
    // are covered in unit-placement-selection-movement.spec.ts.

    describe('remove_entity', () => {
        it('should fail for non-existent entity', () => {
            const result = executeCommand(toCommandContext(ctx), {
                type: 'remove_entity',
                entityId: 999,
            });
            expect(result.success).toBe(false);
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

            executeCommand(toCommandContext(ctx), {
                type: 'remove_entity',
                entityId: building.id,
            });

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
