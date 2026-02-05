/**
 * Tests for building construction: terrain leveling and construction phases.
 *
 * Note: screenToTile height refinement and heightToWorld tests have been
 * consolidated into coordinates.spec.ts where they logically belong.
 */

import { describe, it, expect } from 'vitest';
import { BuildingType, BuildingConstructionPhase, type BuildingState, getBuildingFootprint } from '@/game/entity';
import {
    captureOriginalTerrain,
    applyTerrainLeveling,
    restoreOriginalTerrain,
    CONSTRUCTION_SITE_GROUND_TYPE,
} from '@/game/systems/terrain-leveling';
import {
    getBuildingVisualState,
} from '@/game/systems/building-construction';
import { createTestMap, TERRAIN } from './helpers/test-map';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeBuildingState(
    tileX: number,
    tileY: number,
    buildingType: BuildingType,
    overrides: Partial<BuildingState> = {},
): BuildingState {
    return {
        entityId: 1,
        buildingType,
        phase: BuildingConstructionPhase.TerrainLeveling,
        phaseProgress: 0,
        totalDuration: 30,
        elapsedTime: 0,
        tileX,
        tileY,
        originalTerrain: null,
        terrainModified: false,
        ...overrides,
    };
}

// ---------------------------------------------------------------------------
// Terrain Leveling
// ---------------------------------------------------------------------------

describe('Terrain Leveling', () => {
    describe('captureOriginalTerrain', () => {
        it('should capture all 4 footprint tiles for a 2x2 building', () => {
            const map = createTestMap();
            const bs = makeBuildingState(10, 10, BuildingType.Lumberjack);

            const captured = captureOriginalTerrain(bs, map.groundType, map.groundHeight, map.mapSize);

            const footprintTiles = captured.tiles.filter(t => t.isFootprint);
            expect(footprintTiles).toHaveLength(4);

            const footprintCoords = footprintTiles.map(t => `${t.x},${t.y}`).sort();
            expect(footprintCoords).toEqual(['10,10', '10,11', '11,10', '11,11']);
        });

        it('should capture all 9 footprint tiles for a 3x3 building', () => {
            const map = createTestMap();
            const bs = makeBuildingState(10, 10, BuildingType.Warehouse);

            const captured = captureOriginalTerrain(bs, map.groundType, map.groundHeight, map.mapSize);

            const footprintTiles = captured.tiles.filter(t => t.isFootprint);
            expect(footprintTiles).toHaveLength(9);
        });

        it('should capture 1 footprint tile for a 1x1 decoration', () => {
            const map = createTestMap();
            const bs = makeBuildingState(10, 10, BuildingType.Decoration);

            const captured = captureOriginalTerrain(bs, map.groundType, map.groundHeight, map.mapSize);

            const footprintTiles = captured.tiles.filter(t => t.isFootprint);
            expect(footprintTiles).toHaveLength(1);
            expect(footprintTiles[0].x).toBe(10);
            expect(footprintTiles[0].y).toBe(10);
        });

        it('should capture cardinal neighbors of the footprint', () => {
            const map = createTestMap();
            const bs = makeBuildingState(10, 10, BuildingType.Lumberjack);

            const captured = captureOriginalTerrain(bs, map.groundType, map.groundHeight, map.mapSize);

            const neighborTiles = captured.tiles.filter(t => !t.isFootprint);
            expect(neighborTiles.length).toBeGreaterThanOrEqual(8);
        });

        it('should not create duplicate tiles for shared neighbors', () => {
            const map = createTestMap();
            const bs = makeBuildingState(10, 10, BuildingType.Lumberjack);

            const captured = captureOriginalTerrain(bs, map.groundType, map.groundHeight, map.mapSize);

            const coordKeys = captured.tiles.map(t => `${t.x},${t.y}`);
            const uniqueKeys = new Set(coordKeys);
            expect(uniqueKeys.size).toBe(coordKeys.length);
        });

        it('should preserve original ground types and heights', () => {
            const map = createTestMap();
            map.groundType[map.mapSize.toIndex(10, 10)] = TERRAIN.DESERT;
            map.groundHeight[map.mapSize.toIndex(10, 10)] = 100;
            map.groundHeight[map.mapSize.toIndex(11, 10)] = 120;
            map.groundHeight[map.mapSize.toIndex(10, 11)] = 80;
            map.groundHeight[map.mapSize.toIndex(11, 11)] = 90;

            const bs = makeBuildingState(10, 10, BuildingType.Lumberjack);
            const captured = captureOriginalTerrain(bs, map.groundType, map.groundHeight, map.mapSize);

            const tile1010 = captured.tiles.find(t => t.x === 10 && t.y === 10);
            expect(tile1010).toBeDefined();
            expect(tile1010!.originalGroundType).toBe(TERRAIN.DESERT);
            expect(tile1010!.originalGroundHeight).toBe(100);

            const tile1110 = captured.tiles.find(t => t.x === 11 && t.y === 10);
            expect(tile1110!.originalGroundHeight).toBe(120);
        });

        it('should compute target height as average of all captured tiles', () => {
            const map = createTestMap(64, 64, { flatHeight: 100 });
            const bs = makeBuildingState(10, 10, BuildingType.Lumberjack);
            const captured = captureOriginalTerrain(bs, map.groundType, map.groundHeight, map.mapSize);

            expect(captured.targetHeight).toBe(100);
        });

        it('should handle building at map edge', () => {
            const map = createTestMap();
            const bs = makeBuildingState(0, 0, BuildingType.Lumberjack);

            const captured = captureOriginalTerrain(bs, map.groundType, map.groundHeight, map.mapSize);

            const footprintTiles = captured.tiles.filter(t => t.isFootprint);
            expect(footprintTiles).toHaveLength(4);

            for (const tile of captured.tiles) {
                expect(tile.x).toBeGreaterThanOrEqual(0);
                expect(tile.y).toBeGreaterThanOrEqual(0);
            }
        });
    });

    describe('applyTerrainLeveling', () => {
        it('should not modify terrain at progress 0', () => {
            const map = createTestMap(64, 64, { flatHeight: 100 });
            const bs = makeBuildingState(10, 10, BuildingType.Lumberjack);
            bs.originalTerrain = captureOriginalTerrain(bs, map.groundType, map.groundHeight, map.mapSize);

            const modified = applyTerrainLeveling(bs, map.groundType, map.groundHeight, map.mapSize, 0);

            expect(map.groundType[map.mapSize.toIndex(10, 10)]).toBe(TERRAIN.GRASS);
            expect(modified).toBe(false);
        });

        it('should NOT change ground type for neighbor tiles', () => {
            const map = createTestMap();
            const bs = makeBuildingState(10, 10, BuildingType.Lumberjack);
            bs.originalTerrain = captureOriginalTerrain(bs, map.groundType, map.groundHeight, map.mapSize);

            applyTerrainLeveling(bs, map.groundType, map.groundHeight, map.mapSize, 1.0);

            expect(map.groundType[map.mapSize.toIndex(9, 10)]).toBe(TERRAIN.GRASS);
            expect(map.groundType[map.mapSize.toIndex(12, 10)]).toBe(TERRAIN.GRASS);
            expect(map.groundType[map.mapSize.toIndex(10, 9)]).toBe(TERRAIN.GRASS);
            expect(map.groundType[map.mapSize.toIndex(10, 12)]).toBe(TERRAIN.GRASS);
        });

        it('should interpolate heights toward target at partial progress', () => {
            const map = createTestMap();
            map.groundHeight[map.mapSize.toIndex(10, 10)] = 200;
            map.groundHeight[map.mapSize.toIndex(11, 10)] = 0;
            map.groundHeight[map.mapSize.toIndex(10, 11)] = 0;
            map.groundHeight[map.mapSize.toIndex(11, 11)] = 0;

            const bs = makeBuildingState(10, 10, BuildingType.Lumberjack);
            bs.originalTerrain = captureOriginalTerrain(bs, map.groundType, map.groundHeight, map.mapSize);
            const target = bs.originalTerrain!.targetHeight;

            applyTerrainLeveling(bs, map.groundType, map.groundHeight, map.mapSize, 0.5);

            const h1010 = map.groundHeight[map.mapSize.toIndex(10, 10)];
            const expected1010 = Math.round(200 + (target - 200) * 0.5);
            expect(h1010).toBe(expected1010);
        });

        it('should level all heights to target at progress 1.0', () => {
            const map = createTestMap();
            map.groundHeight[map.mapSize.toIndex(10, 10)] = 200;
            map.groundHeight[map.mapSize.toIndex(11, 10)] = 50;
            map.groundHeight[map.mapSize.toIndex(10, 11)] = 100;
            map.groundHeight[map.mapSize.toIndex(11, 11)] = 150;

            const bs = makeBuildingState(10, 10, BuildingType.Lumberjack);
            bs.originalTerrain = captureOriginalTerrain(bs, map.groundType, map.groundHeight, map.mapSize);
            const target = bs.originalTerrain!.targetHeight;

            applyTerrainLeveling(bs, map.groundType, map.groundHeight, map.mapSize, 1.0);

            for (const tile of getBuildingFootprint(10, 10, BuildingType.Lumberjack)) {
                expect(map.groundHeight[map.mapSize.toIndex(tile.x, tile.y)]).toBe(target);
            }
        });

        it('should change ground type on all tiles of a 3x3 building', () => {
            const map = createTestMap();
            const bs = makeBuildingState(10, 10, BuildingType.Warehouse);
            bs.originalTerrain = captureOriginalTerrain(bs, map.groundType, map.groundHeight, map.mapSize);

            applyTerrainLeveling(bs, map.groundType, map.groundHeight, map.mapSize, 1.0);

            const footprint = getBuildingFootprint(10, 10, BuildingType.Warehouse);
            expect(footprint).toHaveLength(9);
            for (const tile of footprint) {
                expect(map.groundType[map.mapSize.toIndex(tile.x, tile.y)]).toBe(CONSTRUCTION_SITE_GROUND_TYPE);
            }
        });
    });

    describe('restoreOriginalTerrain', () => {
        it('should restore ground types and heights for all tiles', () => {
            const map = createTestMap();
            map.groundHeight[map.mapSize.toIndex(10, 10)] = 100;
            map.groundHeight[map.mapSize.toIndex(11, 10)] = 120;

            const bs = makeBuildingState(10, 10, BuildingType.Lumberjack);
            bs.originalTerrain = captureOriginalTerrain(bs, map.groundType, map.groundHeight, map.mapSize);

            applyTerrainLeveling(bs, map.groundType, map.groundHeight, map.mapSize, 1.0);
            expect(map.groundType[map.mapSize.toIndex(10, 10)]).toBe(CONSTRUCTION_SITE_GROUND_TYPE);

            const modified = restoreOriginalTerrain(bs, map.groundType, map.groundHeight, map.mapSize);
            expect(modified).toBe(true);

            expect(map.groundType[map.mapSize.toIndex(10, 10)]).toBe(TERRAIN.GRASS);
            expect(map.groundType[map.mapSize.toIndex(11, 10)]).toBe(TERRAIN.GRASS);
            expect(map.groundHeight[map.mapSize.toIndex(10, 10)]).toBe(100);
            expect(map.groundHeight[map.mapSize.toIndex(11, 10)]).toBe(120);
        });

        it('should return false when no original terrain is captured', () => {
            const map = createTestMap();
            const bs = makeBuildingState(10, 10, BuildingType.Lumberjack);

            const modified = restoreOriginalTerrain(bs, map.groundType, map.groundHeight, map.mapSize);
            expect(modified).toBe(false);
        });
    });
});

// ---------------------------------------------------------------------------
// Building Construction Phases
// ---------------------------------------------------------------------------

describe('Building Construction Phases', () => {
    describe('getBuildingVisualState', () => {
        it('should return completed state for undefined building state', () => {
            const state = getBuildingVisualState(undefined);
            expect(state.isCompleted).toBe(true);
            expect(state.verticalProgress).toBe(1.0);
        });

        it('should return zero vertical progress during Poles phase', () => {
            const bs = makeBuildingState(10, 10, BuildingType.Lumberjack, {
                phase: BuildingConstructionPhase.Poles,
                phaseProgress: 0.5,
            });
            const state = getBuildingVisualState(bs);
            expect(state.useConstructionSprite).toBe(true);
            expect(state.verticalProgress).toBe(0.0);
        });

        it('should return zero vertical progress during TerrainLeveling phase', () => {
            const bs = makeBuildingState(10, 10, BuildingType.Lumberjack, {
                phase: BuildingConstructionPhase.TerrainLeveling,
                phaseProgress: 0.5,
            });
            const state = getBuildingVisualState(bs);
            expect(state.verticalProgress).toBe(0.0);
        });

        it('should use construction sprite with rising progress during ConstructionRising', () => {
            const bs = makeBuildingState(10, 10, BuildingType.Lumberjack, {
                phase: BuildingConstructionPhase.ConstructionRising,
                phaseProgress: 0.6,
                elapsedTime: 15,
            });
            const state = getBuildingVisualState(bs);
            expect(state.useConstructionSprite).toBe(true);
            expect(state.verticalProgress).toBe(0.6);
        });

        it('should use completed sprite during CompletedRising', () => {
            const bs = makeBuildingState(10, 10, BuildingType.Lumberjack, {
                phase: BuildingConstructionPhase.CompletedRising,
                phaseProgress: 0.8,
                elapsedTime: 25,
            });
            const state = getBuildingVisualState(bs);
            expect(state.useConstructionSprite).toBe(false);
            expect(state.verticalProgress).toBe(0.8);
        });
    });

    // Note: Full phase-transition integration test (Poles → TerrainLeveling →
    // ConstructionRising → CompletedRising → Completed) is covered by
    // building-lifecycle flow test.
});
