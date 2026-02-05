/**
 * Tests for building construction: terrain leveling, height refinement,
 * construction phases, and the screenToTile fix on varying terrain.
 */

import { describe, it, expect } from 'vitest';
import { MapSize } from '@/utilities/map-size';
import { BuildingType, BuildingConstructionPhase, BuildingState, getBuildingFootprint } from '@/game/entity';
import { TilePicker } from '@/game/input/tile-picker';
import { IViewPoint } from '@/game/renderer/i-view-point';
import { heightToWorld } from '@/game/systems/coordinate-system';
import {
    captureOriginalTerrain,
    applyTerrainLeveling,
    restoreOriginalTerrain,
    CONSTRUCTION_SITE_GROUND_TYPE,
} from '@/game/systems/terrain-leveling';
import {
    getBuildingVisualState,
    updateBuildingConstruction,
    type TerrainContext,
} from '@/game/systems/building-construction';
import { GameState } from '@/game/game-state';
import { EntityType } from '@/game/entity';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const GRASS = 16;

function makeMap(width: number, height: number) {
    const mapSize = new MapSize(width, height);
    const groundType = new Uint8Array(width * height).fill(GRASS);
    const groundHeight = new Uint8Array(width * height).fill(0);
    return { mapSize, groundType, groundHeight };
}

function makeBuildingState(
    tileX: number,
    tileY: number,
    buildingType: BuildingType,
    overrides: Partial<BuildingState> = {}
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
            const { mapSize, groundType, groundHeight } = makeMap(64, 64);
            const bs = makeBuildingState(10, 10, BuildingType.Lumberjack);

            const captured = captureOriginalTerrain(bs, groundType, groundHeight, mapSize);

            // 2x2 footprint: (10,10) (11,10) (10,11) (11,11)
            const footprintTiles = captured.tiles.filter(t => t.isFootprint);
            expect(footprintTiles).toHaveLength(4);

            const footprintCoords = footprintTiles.map(t => `${t.x},${t.y}`).sort();
            expect(footprintCoords).toEqual(['10,10', '10,11', '11,10', '11,11']);
        });

        it('should capture all 9 footprint tiles for a 3x3 building', () => {
            const { mapSize, groundType, groundHeight } = makeMap(64, 64);
            const bs = makeBuildingState(10, 10, BuildingType.Warehouse);

            const captured = captureOriginalTerrain(bs, groundType, groundHeight, mapSize);

            const footprintTiles = captured.tiles.filter(t => t.isFootprint);
            expect(footprintTiles).toHaveLength(9);
        });

        it('should capture 1 footprint tile for a 1x1 decoration', () => {
            const { mapSize, groundType, groundHeight } = makeMap(64, 64);
            const bs = makeBuildingState(10, 10, BuildingType.Decoration);

            const captured = captureOriginalTerrain(bs, groundType, groundHeight, mapSize);

            const footprintTiles = captured.tiles.filter(t => t.isFootprint);
            expect(footprintTiles).toHaveLength(1);
            expect(footprintTiles[0].x).toBe(10);
            expect(footprintTiles[0].y).toBe(10);
        });

        it('should capture cardinal neighbors of the footprint', () => {
            const { mapSize, groundType, groundHeight } = makeMap(64, 64);
            const bs = makeBuildingState(10, 10, BuildingType.Lumberjack);

            const captured = captureOriginalTerrain(bs, groundType, groundHeight, mapSize);

            const neighborTiles = captured.tiles.filter(t => !t.isFootprint);
            // 2x2 footprint: neighbors are the 8 tiles surrounding the 2x2 block
            // that are reachable by cardinal moves from footprint tiles:
            // (9,10) (9,11) (12,10) (12,11) (10,9) (11,9) (10,12) (11,12)
            expect(neighborTiles.length).toBeGreaterThanOrEqual(8);
        });

        it('should not create duplicate tiles for shared neighbors', () => {
            const { mapSize, groundType, groundHeight } = makeMap(64, 64);
            const bs = makeBuildingState(10, 10, BuildingType.Lumberjack);

            const captured = captureOriginalTerrain(bs, groundType, groundHeight, mapSize);

            // Check no duplicate coordinates
            const coordKeys = captured.tiles.map(t => `${t.x},${t.y}`);
            const uniqueKeys = new Set(coordKeys);
            expect(uniqueKeys.size).toBe(coordKeys.length);
        });

        it('should preserve original ground types and heights', () => {
            const { mapSize, groundType, groundHeight } = makeMap(64, 64);
            // Set varying terrain
            groundType[mapSize.toIndex(10, 10)] = 64; // desert
            groundHeight[mapSize.toIndex(10, 10)] = 100;
            groundHeight[mapSize.toIndex(11, 10)] = 120;
            groundHeight[mapSize.toIndex(10, 11)] = 80;
            groundHeight[mapSize.toIndex(11, 11)] = 90;

            const bs = makeBuildingState(10, 10, BuildingType.Lumberjack);
            const captured = captureOriginalTerrain(bs, groundType, groundHeight, mapSize);

            const tile1010 = captured.tiles.find(t => t.x === 10 && t.y === 10);
            expect(tile1010).toBeDefined();
            expect(tile1010!.originalGroundType).toBe(64);
            expect(tile1010!.originalGroundHeight).toBe(100);

            const tile1110 = captured.tiles.find(t => t.x === 11 && t.y === 10);
            expect(tile1110!.originalGroundHeight).toBe(120);
        });

        it('should compute target height as average of all captured tiles', () => {
            const { mapSize, groundType, groundHeight } = makeMap(64, 64);
            // Set uniform height = 100 for everything
            groundHeight.fill(100);

            const bs = makeBuildingState(10, 10, BuildingType.Lumberjack);
            const captured = captureOriginalTerrain(bs, groundType, groundHeight, mapSize);

            // With uniform height, target should equal 100
            expect(captured.targetHeight).toBe(100);
        });

        it('should handle building at map edge', () => {
            const { mapSize, groundType, groundHeight } = makeMap(64, 64);
            // Building anchor at (0, 0) — 2x2 footprint fits in [0,1]x[0,1]
            const bs = makeBuildingState(0, 0, BuildingType.Lumberjack);

            const captured = captureOriginalTerrain(bs, groundType, groundHeight, mapSize);

            // Should not crash; tiles outside map are skipped
            const footprintTiles = captured.tiles.filter(t => t.isFootprint);
            expect(footprintTiles).toHaveLength(4);

            // Neighbors at x=-1 or y=-1 should be excluded
            for (const tile of captured.tiles) {
                expect(tile.x).toBeGreaterThanOrEqual(0);
                expect(tile.y).toBeGreaterThanOrEqual(0);
            }
        });
    });

    describe('applyTerrainLeveling', () => {
        it('should not modify terrain at progress 0', () => {
            const { mapSize, groundType, groundHeight } = makeMap(64, 64);
            groundHeight.fill(100);
            const bs = makeBuildingState(10, 10, BuildingType.Lumberjack);
            bs.originalTerrain = captureOriginalTerrain(bs, groundType, groundHeight, mapSize);

            const modified = applyTerrainLeveling(bs, groundType, groundHeight, mapSize, 0);

            // Heights unchanged (already at target), ground type unchanged (progress=0)
            expect(groundType[mapSize.toIndex(10, 10)]).toBe(GRASS);
            expect(modified).toBe(false);
        });

        it('should change ground type to DustyWay for all footprint tiles', () => {
            const { mapSize, groundType, groundHeight } = makeMap(64, 64);
            const bs = makeBuildingState(10, 10, BuildingType.Lumberjack);
            bs.originalTerrain = captureOriginalTerrain(bs, groundType, groundHeight, mapSize);

            applyTerrainLeveling(bs, groundType, groundHeight, mapSize, 0.5);

            // All 4 footprint tiles should be DustyWay
            const footprint = getBuildingFootprint(10, 10, BuildingType.Lumberjack);
            for (const tile of footprint) {
                expect(groundType[mapSize.toIndex(tile.x, tile.y)]).toBe(CONSTRUCTION_SITE_GROUND_TYPE);
            }
        });

        it('should NOT change ground type for neighbor tiles', () => {
            const { mapSize, groundType, groundHeight } = makeMap(64, 64);
            const bs = makeBuildingState(10, 10, BuildingType.Lumberjack);
            bs.originalTerrain = captureOriginalTerrain(bs, groundType, groundHeight, mapSize);

            applyTerrainLeveling(bs, groundType, groundHeight, mapSize, 1.0);

            // Neighbor tiles should still be grass
            expect(groundType[mapSize.toIndex(9, 10)]).toBe(GRASS);
            expect(groundType[mapSize.toIndex(12, 10)]).toBe(GRASS);
            expect(groundType[mapSize.toIndex(10, 9)]).toBe(GRASS);
            expect(groundType[mapSize.toIndex(10, 12)]).toBe(GRASS);
        });

        it('should interpolate heights toward target at partial progress', () => {
            const { mapSize, groundType, groundHeight } = makeMap(64, 64);
            // Create a slope: one tile high, one low
            groundHeight[mapSize.toIndex(10, 10)] = 200;
            groundHeight[mapSize.toIndex(11, 10)] = 0;
            groundHeight[mapSize.toIndex(10, 11)] = 0;
            groundHeight[mapSize.toIndex(11, 11)] = 0;

            const bs = makeBuildingState(10, 10, BuildingType.Lumberjack);
            bs.originalTerrain = captureOriginalTerrain(bs, groundType, groundHeight, mapSize);
            const target = bs.originalTerrain!.targetHeight;

            applyTerrainLeveling(bs, groundType, groundHeight, mapSize, 0.5);

            // At 50%: heights should be halfway between original and target
            const h1010 = groundHeight[mapSize.toIndex(10, 10)];
            const expected1010 = Math.round(200 + (target - 200) * 0.5);
            expect(h1010).toBe(expected1010);
        });

        it('should level all heights to target at progress 1.0', () => {
            const { mapSize, groundType, groundHeight } = makeMap(64, 64);
            groundHeight[mapSize.toIndex(10, 10)] = 200;
            groundHeight[mapSize.toIndex(11, 10)] = 50;
            groundHeight[mapSize.toIndex(10, 11)] = 100;
            groundHeight[mapSize.toIndex(11, 11)] = 150;

            const bs = makeBuildingState(10, 10, BuildingType.Lumberjack);
            bs.originalTerrain = captureOriginalTerrain(bs, groundType, groundHeight, mapSize);
            const target = bs.originalTerrain!.targetHeight;

            applyTerrainLeveling(bs, groundType, groundHeight, mapSize, 1.0);

            // All footprint tiles should be at target height
            for (const tile of getBuildingFootprint(10, 10, BuildingType.Lumberjack)) {
                expect(groundHeight[mapSize.toIndex(tile.x, tile.y)]).toBe(target);
            }
        });

        it('should change ground type on all tiles of a 3x3 building', () => {
            const { mapSize, groundType, groundHeight } = makeMap(64, 64);
            const bs = makeBuildingState(10, 10, BuildingType.Warehouse);
            bs.originalTerrain = captureOriginalTerrain(bs, groundType, groundHeight, mapSize);

            applyTerrainLeveling(bs, groundType, groundHeight, mapSize, 1.0);

            // All 9 footprint tiles should be DustyWay
            const footprint = getBuildingFootprint(10, 10, BuildingType.Warehouse);
            expect(footprint).toHaveLength(9);
            for (const tile of footprint) {
                expect(groundType[mapSize.toIndex(tile.x, tile.y)]).toBe(CONSTRUCTION_SITE_GROUND_TYPE);
            }
        });
    });

    describe('restoreOriginalTerrain', () => {
        it('should restore ground types and heights for all tiles', () => {
            const { mapSize, groundType, groundHeight } = makeMap(64, 64);
            groundHeight[mapSize.toIndex(10, 10)] = 100;
            groundHeight[mapSize.toIndex(11, 10)] = 120;

            const bs = makeBuildingState(10, 10, BuildingType.Lumberjack);
            bs.originalTerrain = captureOriginalTerrain(bs, groundType, groundHeight, mapSize);

            // Apply full leveling
            applyTerrainLeveling(bs, groundType, groundHeight, mapSize, 1.0);

            // Verify terrain was changed
            expect(groundType[mapSize.toIndex(10, 10)]).toBe(CONSTRUCTION_SITE_GROUND_TYPE);

            // Restore
            const modified = restoreOriginalTerrain(bs, groundType, groundHeight, mapSize);
            expect(modified).toBe(true);

            // Ground type restored
            expect(groundType[mapSize.toIndex(10, 10)]).toBe(GRASS);
            expect(groundType[mapSize.toIndex(11, 10)]).toBe(GRASS);

            // Heights restored
            expect(groundHeight[mapSize.toIndex(10, 10)]).toBe(100);
            expect(groundHeight[mapSize.toIndex(11, 10)]).toBe(120);
        });

        it('should return false when no original terrain is captured', () => {
            const { mapSize, groundType, groundHeight } = makeMap(64, 64);
            const bs = makeBuildingState(10, 10, BuildingType.Lumberjack);

            const modified = restoreOriginalTerrain(bs, groundType, groundHeight, mapSize);
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

    describe('updateBuildingConstruction with terrain', () => {
        it('should transition through all phases and modify terrain', () => {
            const { mapSize, groundType, groundHeight } = makeMap(64, 64);
            groundType.fill(GRASS);
            groundHeight.fill(100);

            const gameState = new GameState();
            gameState.addEntity(EntityType.Building, BuildingType.Lumberjack, 10, 10, 0);
            const bs = gameState.buildingStates.values().next().value as BuildingState;
            bs.totalDuration = 10; // 10 seconds total

            let terrainNotified = false;
            const ctx: TerrainContext = {
                groundType,
                groundHeight,
                mapSize,
                onTerrainModified: () => { terrainNotified = true },
            };

            // Phase 1: TerrainLeveling starts immediately (0-20% = 0-2s)
            // First tick captures terrain and starts leveling
            updateBuildingConstruction(gameState, 0.5, ctx);
            expect(bs.phase).toBe(BuildingConstructionPhase.TerrainLeveling);
            expect(bs.originalTerrain).not.toBeNull();
            expect(terrainNotified).toBe(true);

            // All footprint tiles should have construction ground type
            const footprint = getBuildingFootprint(10, 10, BuildingType.Lumberjack);
            for (const tile of footprint) {
                expect(groundType[mapSize.toIndex(tile.x, tile.y)]).toBe(CONSTRUCTION_SITE_GROUND_TYPE);
            }

            // Phase 2: ConstructionRising (20-55% = 2-5.5s)
            updateBuildingConstruction(gameState, 2.0, ctx);
            expect(bs.phase).toBe(BuildingConstructionPhase.ConstructionRising);

            // Phase 3: CompletedRising (55-100% = 5.5-10s)
            updateBuildingConstruction(gameState, 4.0, ctx);
            expect(bs.phase).toBe(BuildingConstructionPhase.CompletedRising);

            // Phase 4: Completed
            updateBuildingConstruction(gameState, 5.0, ctx);
            expect(bs.phase).toBe(BuildingConstructionPhase.Completed);
        });
    });
});

// ---------------------------------------------------------------------------
// screenToTile Height Refinement
// ---------------------------------------------------------------------------

describe('screenToTile on varying terrain', () => {
    const mockCanvas = {
        clientWidth: 1300,
        clientHeight: 1000,
    } as HTMLCanvasElement;
    const picker = new TilePicker(mockCanvas);

    /**
     * Helper: convert tile → world → screen → tile and check round-trip.
     */
    function expectRoundTrip(
        tileX: number,
        tileY: number,
        groundHeight: Uint8Array,
        mapSize: MapSize,
        viewPoint: { x: number; y: number; zoom: number }
    ) {
        const worldPos = TilePicker.tileToWorld(
            tileX, tileY, groundHeight, mapSize, viewPoint.x, viewPoint.y
        );

        const aspect = mockCanvas.clientWidth / mockCanvas.clientHeight;
        const ndcX = worldPos.worldX * viewPoint.zoom / aspect - viewPoint.zoom;
        const ndcY = viewPoint.zoom - worldPos.worldY * viewPoint.zoom;
        const screenX = (ndcX + 1) / 2 * mockCanvas.clientWidth;
        const screenY = (1 - ndcY) / 2 * mockCanvas.clientHeight;

        const recovered = picker.screenToTile(screenX, screenY, viewPoint, mapSize, groundHeight);

        expect(recovered).not.toBeNull();
        expect(recovered!.x).toBe(tileX);
        expect(recovered!.y).toBe(tileY);
    }

    /** Like expectRoundTrip but allows ±1 tile for steep terrain where isometric ambiguity is inherent */
    function expectRoundTripApprox(
        tileX: number, tileY: number,
        groundHeight: Uint8Array, mapSize: MapSize, viewPoint: IViewPoint,
        tolerance = 1
    ) {
        const worldPos = TilePicker.tileToWorld(
            tileX, tileY, groundHeight, mapSize, viewPoint.x, viewPoint.y
        );

        const aspect = mockCanvas.clientWidth / mockCanvas.clientHeight;
        const ndcX = worldPos.worldX * viewPoint.zoom / aspect - viewPoint.zoom;
        const ndcY = viewPoint.zoom - worldPos.worldY * viewPoint.zoom;
        const screenX = (ndcX + 1) / 2 * mockCanvas.clientWidth;
        const screenY = (1 - ndcY) / 2 * mockCanvas.clientHeight;

        const recovered = picker.screenToTile(screenX, screenY, viewPoint, mapSize, groundHeight);

        expect(recovered).not.toBeNull();
        expect(Math.abs(recovered!.x - tileX)).toBeLessThanOrEqual(tolerance);
        expect(Math.abs(recovered!.y - tileY)).toBeLessThanOrEqual(tolerance);
    }

    it('should round-trip on flat terrain', () => {
        const mapSize = new MapSize(640, 640);
        const groundHeight = new Uint8Array(mapSize.width * mapSize.height).fill(128);
        const vp = { x: 320, y: 320, zoom: 0.1 };

        for (const [dx, dy] of [[0, 0], [3, 2], [-2, 3], [5, -4]]) {
            expectRoundTrip(320 + dx, 320 + dy, groundHeight, mapSize, vp);
        }
    });

    it('should round-trip on high terrain (max height)', () => {
        const mapSize = new MapSize(640, 640);
        const groundHeight = new Uint8Array(mapSize.width * mapSize.height).fill(255);
        const vp = { x: 320, y: 320, zoom: 0.1 };

        for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [-1, 0], [0, -1]]) {
            expectRoundTrip(320 + dx, 320 + dy, groundHeight, mapSize, vp);
        }
    });

    it('should round-trip on terrain with a height gradient (slope)', () => {
        const mapSize = new MapSize(640, 640);
        const groundHeight = new Uint8Array(mapSize.width * mapSize.height);
        // Create a slope: height increases with Y
        for (let y = 0; y < mapSize.height; y++) {
            for (let x = 0; x < mapSize.width; x++) {
                groundHeight[mapSize.toIndex(x, y)] = Math.min(255, Math.floor(y * 0.5));
            }
        }

        const vp = { x: 320, y: 320, zoom: 0.1 };

        // Test at various points on the slope
        for (const [dx, dy] of [[0, 0], [0, 5], [0, -5], [3, 3], [-3, -3], [5, -2]]) {
            expectRoundTrip(320 + dx, 320 + dy, groundHeight, mapSize, vp);
        }
    });

    it('should round-trip on terrain with moderate height ramp', () => {
        const mapSize = new MapSize(640, 640);
        const groundHeight = new Uint8Array(mapSize.width * mapSize.height);
        // Moderate ramp: ~3 height units per tile (realistic game terrain)
        for (let y = 0; y < mapSize.height; y++) {
            for (let x = 0; x < mapSize.width; x++) {
                groundHeight[mapSize.toIndex(x, y)] = Math.min(255, Math.floor(y * 3) % 256);
            }
        }

        const vp = { x: 320, y: 320, zoom: 0.1 };

        for (const [dx, dy] of [[0, 0], [0, 3], [0, -3], [3, 3], [-3, -3], [5, -2]]) {
            expectRoundTrip(320 + dx, 320 + dy, groundHeight, mapSize, vp);
        }
    });

    it('should round-trip with gentle hill near a building site', () => {
        const mapSize = new MapSize(640, 640);
        const groundHeight = new Uint8Array(mapSize.width * mapSize.height).fill(100);

        // Gentle hill at building site: max ~5 height units per tile (realistic terrain)
        for (let dy = -8; dy <= 8; dy++) {
            for (let dx = -8; dx <= 8; dx++) {
                const dist = Math.abs(dx) + Math.abs(dy);
                const h = Math.max(100, Math.min(255, 140 - dist * 5));
                const x = 320 + dx, y = 320 + dy;
                if (x >= 0 && x < mapSize.width && y >= 0 && y < mapSize.height) {
                    groundHeight[mapSize.toIndex(x, y)] = h;
                }
            }
        }

        const vp = { x: 320, y: 320, zoom: 0.1 };

        // Hill terrain has non-uniform slopes; allow ±1 tile for isometric ambiguity
        for (let dy = -3; dy <= 3; dy++) {
            for (let dx = -3; dx <= 3; dx++) {
                expectRoundTripApprox(320 + dx, 320 + dy, groundHeight, mapSize, vp);
            }
        }
    });

    it('should round-trip with fractional viewpoint on varied terrain', () => {
        const mapSize = new MapSize(640, 640);
        const groundHeight = new Uint8Array(mapSize.width * mapSize.height);
        // Checkerboard of low/high
        for (let y = 0; y < mapSize.height; y++) {
            for (let x = 0; x < mapSize.width; x++) {
                groundHeight[mapSize.toIndex(x, y)] = ((x + y) % 2 === 0) ? 50 : 150;
            }
        }

        // Fractional viewpoint (occurs during scrolling/zooming)
        const vp = { x: 320.3, y: 320.7, zoom: 0.1 };

        for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [1, 1], [-1, -1], [2, -1]]) {
            expectRoundTrip(320 + dx, 320 + dy, groundHeight, mapSize, vp);
        }
    });
});

// ---------------------------------------------------------------------------
// heightToWorld shared constant
// ---------------------------------------------------------------------------

describe('heightToWorld', () => {
    it('should map 0 to 0', () => {
        expect(heightToWorld(0)).toBe(0);
    });

    it('should map 255 to TILE_HEIGHT_SCALE (20.0)', () => {
        expect(heightToWorld(255)).toBeCloseTo(20.0, 5);
    });

    it('should map 128 to approximately half the scale', () => {
        const expected = 128 * 20.0 / 255.0;
        expect(heightToWorld(128)).toBeCloseTo(expected, 5);
    });
});
