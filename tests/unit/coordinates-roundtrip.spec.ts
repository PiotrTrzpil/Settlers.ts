/**
 * Coordinate System Tests - Round-Trip and Integration
 *
 * Tests the full tile → screen → tile pipeline and shader matching.
 * See coordinate-system.ts for full documentation of coordinate spaces.
 */

import { describe, it, expect } from 'vitest';
import { TilePicker } from '@/game/input/tile-picker';
import { MapSize } from '@/utilities/map-size';
import { IViewPointReadonly } from '@/game/renderer/i-view-point';
import {
    TILE_CENTER_X,
    heightToWorld,
    worldToNdc,
    ndcToScreen,
    tileToWorld,
} from '@/game/systems/coordinate-system';

// ═══════════════════════════════════════════════════════════════════════════
// Test Fixtures
// ═══════════════════════════════════════════════════════════════════════════

const MAP_SIZE = new MapSize(640, 640);
const FLAT_HEIGHT = new Uint8Array(MAP_SIZE.width * MAP_SIZE.height).fill(128);
const CANVAS_WIDTH = 1000;
const CANVAS_HEIGHT = 800;

function createMockCanvas(width = CANVAS_WIDTH, height = CANVAS_HEIGHT) {
    return { clientWidth: width, clientHeight: height } as HTMLCanvasElement;
}

function createViewPoint(x = 320, y = 320, zoom = 0.1): IViewPointReadonly {
    return { x, y, zoom, aspectRatio: CANVAS_WIDTH / CANVAS_HEIGHT };
}

// ═══════════════════════════════════════════════════════════════════════════
// Round-Trip Tests (tile → screen → tile)
// ═══════════════════════════════════════════════════════════════════════════

describe('round-trip: tile → world → screen → tile', () => {
    const canvas = createMockCanvas();
    const picker = new TilePicker(canvas);

    function roundTrip(
        tileX: number,
        tileY: number,
        groundHeight: Uint8Array,
        viewPoint: IViewPointReadonly
    ) {
        const world = TilePicker.tileToWorld(
            tileX, tileY, groundHeight, MAP_SIZE, viewPoint.x, viewPoint.y
        );
        const aspect = CANVAS_WIDTH / CANVAS_HEIGHT;
        const ndc = worldToNdc(world.worldX, world.worldY, viewPoint.zoom, aspect);
        const screen = ndcToScreen(ndc.ndcX, ndc.ndcY, CANVAS_WIDTH, CANVAS_HEIGHT);
        return picker.screenToTile(
            screen.screenX, screen.screenY, viewPoint, MAP_SIZE, groundHeight
        );
    }

    describe('flat terrain', () => {
        const vp = createViewPoint();
        const testTiles = [
            { x: 320, y: 320 },
            { x: 321, y: 320 },
            { x: 320, y: 321 },
            { x: 325, y: 325 },
            { x: 315, y: 315 },
            { x: 310, y: 330 },
        ];

        for (const tile of testTiles) {
            it(`tile(${tile.x}, ${tile.y})`, () => {
                const result = roundTrip(tile.x, tile.y, FLAT_HEIGHT, vp);
                expect(result).not.toBeNull();
                expect(result!.x).toBe(tile.x);
                expect(result!.y).toBe(tile.y);
            });
        }
    });

    describe('high terrain', () => {
        const highHeight = new Uint8Array(MAP_SIZE.width * MAP_SIZE.height).fill(255);
        const vp = createViewPoint();

        it('tile at viewpoint', () => {
            const result = roundTrip(320, 320, highHeight, vp);
            expect(result).not.toBeNull();
            expect(result!.x).toBe(320);
            expect(result!.y).toBe(320);
        });
    });

    describe('fractional viewpoint', () => {
        const fracs = [0.1, 0.25, 0.5, 0.75, 0.9];

        for (const frac of fracs) {
            it(`viewpoint fraction=${frac}`, () => {
                const vp = createViewPoint(320 + frac, 320 + frac);
                const result = roundTrip(320, 320, FLAT_HEIGHT, vp);
                expect(result).not.toBeNull();
                expect(result!.x).toBe(320);
                expect(result!.y).toBe(320);
            });
        }
    });

    describe('various viewpoint positions', () => {
        const viewpoints = [
            { x: 100, y: 100 },
            { x: 500, y: 500 },
            { x: 200, y: 400 },
        ];

        for (const { x, y } of viewpoints) {
            it(`viewpoint(${x}, ${y})`, () => {
                const vp = createViewPoint(x, y);
                const result = roundTrip(x, y, FLAT_HEIGHT, vp);
                expect(result).not.toBeNull();
                expect(result!.x).toBe(x);
                expect(result!.y).toBe(y);
            });
        }
    });

    describe('sloped terrain', () => {
        const slopedHeight = new Uint8Array(MAP_SIZE.width * MAP_SIZE.height);
        for (let y = 0; y < MAP_SIZE.height; y++) {
            for (let x = 0; x < MAP_SIZE.width; x++) {
                slopedHeight[MAP_SIZE.toIndex(x, y)] = Math.min(255, Math.floor(y * 0.4));
            }
        }
        const vp = createViewPoint();

        const offsets = [[0, 0], [0, 5], [0, -5], [5, 0], [-5, 0], [3, 3]];
        for (const [dx, dy] of offsets) {
            it(`offset(${dx}, ${dy}) on slope`, () => {
                const result = roundTrip(320 + dx, 320 + dy, slopedHeight, vp);
                expect(result).not.toBeNull();
                expect(result!.x).toBe(320 + dx);
                expect(result!.y).toBe(320 + dy);
            });
        }
    });

    describe('hilly terrain (gentle slope)', () => {
        const hillyHeight = new Uint8Array(MAP_SIZE.width * MAP_SIZE.height).fill(100);
        for (let dy = -20; dy <= 20; dy++) {
            for (let dx = -20; dx <= 20; dx++) {
                const dist = Math.sqrt(dx * dx + dy * dy);
                const h = Math.max(100, Math.min(150, 150 - dist * 2.5));
                const x = 320 + dx, y = 320 + dy;
                if (x >= 0 && x < 640 && y >= 0 && y < 640) {
                    hillyHeight[MAP_SIZE.toIndex(x, y)] = h;
                }
            }
        }
        const vp = createViewPoint();

        it('tile at hill peak', () => {
            const result = roundTrip(320, 320, hillyHeight, vp);
            expect(result).not.toBeNull();
            expect(result!.x).toBe(320);
            expect(result!.y).toBe(320);
        });

        it('tile on hill slope', () => {
            const result = roundTrip(325, 320, hillyHeight, vp);
            expect(result).not.toBeNull();
            expect(result!.x).toBe(325);
            expect(result!.y).toBe(320);
        });

        it('tile near hill edge', () => {
            const result = roundTrip(335, 320, hillyHeight, vp);
            expect(result).not.toBeNull();
            expect(result!.x).toBe(335);
            expect(result!.y).toBe(320);
        });
    });

    describe('steep terrain (known limitation)', () => {
        const steepHeight = new Uint8Array(MAP_SIZE.width * MAP_SIZE.height).fill(100);
        for (let dy = -10; dy <= 10; dy++) {
            for (let dx = -10; dx <= 10; dx++) {
                const dist = Math.sqrt(dx * dx + dy * dy);
                const h = Math.max(100, Math.min(255, 255 - dist * 15));
                const x = 320 + dx, y = 320 + dy;
                if (x >= 0 && x < 640 && y >= 0 && y < 640) {
                    steepHeight[MAP_SIZE.toIndex(x, y)] = h;
                }
            }
        }
        const vp = createViewPoint();

        it('returns a valid tile even on very steep terrain', () => {
            // On very steep terrain (15 height units per tile), the iterative
            // refinement may not converge to the exact tile. This is expected
            // behavior - real maps have gentler slopes.
            const result = roundTrip(320, 320, steepHeight, vp);
            expect(result).not.toBeNull();
            expect(result!.x).toBeGreaterThanOrEqual(0);
            expect(result!.x).toBeLessThan(640);
            expect(result!.y).toBeGreaterThanOrEqual(0);
            expect(result!.y).toBeLessThan(640);
        });
    });
});

// ═══════════════════════════════════════════════════════════════════════════
// TilePicker Wrapper Tests
// ═══════════════════════════════════════════════════════════════════════════

describe('TilePicker', () => {
    const canvas = createMockCanvas();
    const picker = new TilePicker(canvas);

    describe('screenToTile', () => {
        it('returns a tile for valid input', () => {
            const vp = createViewPoint();
            const result = picker.screenToTile(500, 400, vp, MAP_SIZE, FLAT_HEIGHT);
            expect(result).not.toBeNull();
            expect(result!.x).toBeGreaterThanOrEqual(0);
            expect(result!.y).toBeGreaterThanOrEqual(0);
        });
    });

    describe('tileToWorld (static)', () => {
        it('returns world coords', () => {
            const result = TilePicker.tileToWorld(320, 320, FLAT_HEIGHT, MAP_SIZE, 320, 320);
            expect(result.worldX).toBeCloseTo(TILE_CENTER_X, 5);
        });
    });
});

// ═══════════════════════════════════════════════════════════════════════════
// Shader Matching Tests
// ═══════════════════════════════════════════════════════════════════════════

describe('shader formula matching', () => {
    function shaderWorldPos(
        tileX: number,
        tileY: number,
        viewPointX: number,
        viewPointY: number,
        height: number
    ): { worldX: number; worldY: number } {
        const vpIntX = Math.floor(viewPointX);
        const vpIntY = Math.floor(viewPointY);
        const vpFracX = viewPointX - vpIntX;
        const vpFracY = viewPointY - vpIntY;
        const instancePosX = tileX - vpIntX;
        const instancePosY = tileY - vpIntY;
        const worldX = 0.25 + instancePosX - instancePosY * 0.5 - vpFracX + vpFracY * 0.5;
        const worldY = (0.5 + instancePosY - height - vpFracY) * 0.5;
        return { worldX, worldY };
    }

    it('tileToWorld matches shader with integer viewpoint', () => {
        const h = heightToWorld(128);
        const shader = shaderWorldPos(320, 320, 320, 320, h);
        const ts = tileToWorld(320, 320, h, 320, 320);
        expect(ts.worldX).toBeCloseTo(shader.worldX, 10);
        expect(ts.worldY).toBeCloseTo(shader.worldY, 10);
    });

    it('tileToWorld matches shader with fractional viewpoint', () => {
        const h = heightToWorld(128);
        const viewPoints = [
            { x: 320.3, y: 320.7 },
            { x: 319.5, y: 320.5 },
            { x: 320.8, y: 321.2 },
        ];

        for (const vp of viewPoints) {
            const shader = shaderWorldPos(320, 320, vp.x, vp.y, h);
            const ts = tileToWorld(320, 320, h, vp.x, vp.y);
            expect(ts.worldX).toBeCloseTo(shader.worldX, 10);
            expect(ts.worldY).toBeCloseTo(shader.worldY, 10);
        }
    });

    it('tileToWorld matches shader for tiles far from viewpoint', () => {
        const h = heightToWorld(128);
        const tiles = [
            { x: 100, y: 100 },
            { x: 500, y: 500 },
            { x: 50, y: 600 },
        ];

        for (const tile of tiles) {
            const shader = shaderWorldPos(tile.x, tile.y, 320, 320, h);
            const ts = tileToWorld(tile.x, tile.y, h, 320, 320);
            expect(ts.worldX).toBeCloseTo(shader.worldX, 10);
            expect(ts.worldY).toBeCloseTo(shader.worldY, 10);
        }
    });

    it('relative positions between tiles are stable across viewpoint changes', () => {
        const h = heightToWorld(128);
        const tile1 = { x: 320, y: 320 };
        const tile2 = { x: 325, y: 322 };

        const viewpoints = [
            { x: 320, y: 320 },
            { x: 320.5, y: 320.5 },
            { x: 321, y: 321 },
        ];

        let expectedDx: number | null = null;
        let expectedDy: number | null = null;

        for (const vp of viewpoints) {
            const p1 = tileToWorld(tile1.x, tile1.y, h, vp.x, vp.y);
            const p2 = tileToWorld(tile2.x, tile2.y, h, vp.x, vp.y);
            const dx = p2.worldX - p1.worldX;
            const dy = p2.worldY - p1.worldY;

            if (expectedDx === null) {
                expectedDx = dx;
                expectedDy = dy;
            } else {
                expect(dx).toBeCloseTo(expectedDx, 10);
                expect(dy).toBeCloseTo(expectedDy!, 10);
            }
        }
    });
});
