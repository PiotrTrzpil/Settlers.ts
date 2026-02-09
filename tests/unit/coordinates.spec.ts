/**
 * Coordinate System Tests - Core Transforms
 *
 * Tests the individual coordinate transformation functions.
 * See coordinate-system.ts for full documentation of coordinate spaces.
 */

import { describe, it, expect } from 'vitest';
import {
    // Constants
    TILE_HEIGHT_SCALE,
    TILE_CENTER_X,
    TILE_CENTER_Y,
    MAX_HEIGHT_ITERATIONS,
    // Height conversion
    heightToWorld,
    worldToHeight,
    // Viewpoint helpers
    splitViewPoint,
    // Screen ↔ NDC
    screenToNdc,
    ndcToScreen,
    // NDC ↔ World
    ndcToWorld,
    worldToNdc,
    // World ↔ Tile
    tileToWorld,
    worldToTileFractional,
    // Full conversions
    screenToTile,
    tileToScreen,
    tileToWorldPos,
} from '@/game/systems/coordinate-system';

// ═══════════════════════════════════════════════════════════════════════════
// Test Fixtures
// ═══════════════════════════════════════════════════════════════════════════

const MAP_SIZE = { width: 640, height: 640 };
const FLAT_HEIGHT = new Uint8Array(MAP_SIZE.width * MAP_SIZE.height).fill(128);

// ═══════════════════════════════════════════════════════════════════════════
// Constants Tests
// ═══════════════════════════════════════════════════════════════════════════

describe('coordinate-system constants', () => {
    it('TILE_HEIGHT_SCALE should be 20.0 (matching shader)', () => {
        expect(TILE_HEIGHT_SCALE).toBe(20.0);
    });

    it('TILE_CENTER_X should be 0.25 (parallelogram center)', () => {
        expect(TILE_CENTER_X).toBe(0.25);
    });

    it('TILE_CENTER_Y should be 0.5 (parallelogram center)', () => {
        expect(TILE_CENTER_Y).toBe(0.5);
    });

    it('MAX_HEIGHT_ITERATIONS should be at least 3', () => {
        expect(MAX_HEIGHT_ITERATIONS).toBeGreaterThanOrEqual(3);
    });
});

// ═══════════════════════════════════════════════════════════════════════════
// Height Conversion Tests
// ═══════════════════════════════════════════════════════════════════════════

describe('heightToWorld / worldToHeight', () => {
    it('should map 0 → 0', () => {
        expect(heightToWorld(0)).toBe(0);
    });

    it('should map 255 → 20.0 (max height)', () => {
        expect(heightToWorld(255)).toBeCloseTo(20.0, 5);
    });

    it('should map 128 → ~10.04 (mid height)', () => {
        expect(heightToWorld(128)).toBeCloseTo(128 * 20 / 255, 5);
    });

    it('should round-trip: height → world → height', () => {
        for (const h of [0, 64, 128, 192, 255]) {
            const world = heightToWorld(h);
            const back = worldToHeight(world);
            expect(back).toBe(h);
        }
    });

    it('worldToHeight should round correctly', () => {
        expect(worldToHeight(10)).toBe(128);
        expect(worldToHeight(0)).toBe(0);
        expect(worldToHeight(20)).toBe(255);
    });
});

// ═══════════════════════════════════════════════════════════════════════════
// Viewpoint Helper Tests
// ═══════════════════════════════════════════════════════════════════════════

describe('splitViewPoint', () => {
    it('should split integer correctly', () => {
        const r = splitViewPoint(320);
        expect(r.int).toBe(320);
        expect(r.frac).toBeCloseTo(0, 10);
    });

    it('should split positive fractional correctly', () => {
        const r = splitViewPoint(320.75);
        expect(r.int).toBe(320);
        expect(r.frac).toBeCloseTo(0.75, 10);
    });

    it('should split small fractional correctly', () => {
        const r = splitViewPoint(320.001);
        expect(r.int).toBe(320);
        expect(r.frac).toBeCloseTo(0.001, 10);
    });

    it('should handle negative values (floor behavior)', () => {
        const r = splitViewPoint(-5.25);
        expect(r.int).toBe(-6);
        expect(r.frac).toBeCloseTo(0.75, 10);
    });

    it('should handle zero', () => {
        const r = splitViewPoint(0);
        expect(r.int).toBe(0);
        expect(r.frac).toBe(0);
    });
});

// ═══════════════════════════════════════════════════════════════════════════
// Screen ↔ NDC Tests
// ═══════════════════════════════════════════════════════════════════════════

describe('screenToNdc / ndcToScreen', () => {
    const W = 1000, H = 800;

    describe('screenToNdc', () => {
        it('center → (0, 0)', () => {
            const r = screenToNdc(500, 400, W, H);
            expect(r.ndcX).toBeCloseTo(0, 10);
            expect(r.ndcY).toBeCloseTo(0, 10);
        });

        it('top-left → (-1, 1)', () => {
            const r = screenToNdc(0, 0, W, H);
            expect(r.ndcX).toBeCloseTo(-1, 10);
            expect(r.ndcY).toBeCloseTo(1, 10);
        });

        it('bottom-right → (1, -1)', () => {
            const r = screenToNdc(W, H, W, H);
            expect(r.ndcX).toBeCloseTo(1, 10);
            expect(r.ndcY).toBeCloseTo(-1, 10);
        });

        it('top-right → (1, 1)', () => {
            const r = screenToNdc(W, 0, W, H);
            expect(r.ndcX).toBeCloseTo(1, 10);
            expect(r.ndcY).toBeCloseTo(1, 10);
        });

        it('bottom-left → (-1, -1)', () => {
            const r = screenToNdc(0, H, W, H);
            expect(r.ndcX).toBeCloseTo(-1, 10);
            expect(r.ndcY).toBeCloseTo(-1, 10);
        });
    });

    describe('ndcToScreen', () => {
        it('(0, 0) → center', () => {
            const r = ndcToScreen(0, 0, W, H);
            expect(r.screenX).toBeCloseTo(500, 10);
            expect(r.screenY).toBeCloseTo(400, 10);
        });

        it('(-1, 1) → top-left', () => {
            const r = ndcToScreen(-1, 1, W, H);
            expect(r.screenX).toBeCloseTo(0, 10);
            expect(r.screenY).toBeCloseTo(0, 10);
        });
    });

    describe('round-trip', () => {
        const testPoints = [
            { x: 0, y: 0 },
            { x: 250, y: 200 },
            { x: 750, y: 600 },
            { x: 100, y: 700 },
        ];

        for (const pt of testPoints) {
            it(`screen(${pt.x}, ${pt.y}) → NDC → screen`, () => {
                const ndc = screenToNdc(pt.x, pt.y, W, H);
                const back = ndcToScreen(ndc.ndcX, ndc.ndcY, W, H);
                expect(back.screenX).toBeCloseTo(pt.x, 5);
                expect(back.screenY).toBeCloseTo(pt.y, 5);
            });
        }
    });
});

// ═══════════════════════════════════════════════════════════════════════════
// NDC ↔ World Tests
// ═══════════════════════════════════════════════════════════════════════════

describe('ndcToWorld / worldToNdc', () => {
    const zoom = 0.1;
    const aspect = 1.25;

    describe('round-trip at various points', () => {
        const points = [
            { ndcX: 0, ndcY: 0 },
            { ndcX: 0.5, ndcY: 0.5 },
            { ndcX: -0.5, ndcY: -0.5 },
            { ndcX: 0.9, ndcY: -0.9 },
        ];

        for (const pt of points) {
            it(`NDC(${pt.ndcX}, ${pt.ndcY}) → world → NDC`, () => {
                const world = ndcToWorld(pt.ndcX, pt.ndcY, zoom, aspect);
                const back = worldToNdc(world.worldX, world.worldY, zoom, aspect);
                expect(back.ndcX).toBeCloseTo(pt.ndcX, 10);
                expect(back.ndcY).toBeCloseTo(pt.ndcY, 10);
            });
        }
    });

    describe('zoom affects world range', () => {
        it('smaller zoom → larger world range', () => {
            const w1 = ndcToWorld(1, 0, 0.1, aspect);
            const w2 = ndcToWorld(1, 0, 0.2, aspect);
            expect(Math.abs(w1.worldX)).toBeGreaterThan(Math.abs(w2.worldX));
        });
    });

    describe('aspect ratio affects X scaling', () => {
        it('wider aspect → larger world X range', () => {
            const w1 = ndcToWorld(1, 0, zoom, 1.0);
            const w2 = ndcToWorld(1, 0, zoom, 2.0);
            expect(w2.worldX).toBeGreaterThan(w1.worldX);
        });
    });
});

// ═══════════════════════════════════════════════════════════════════════════
// World ↔ Tile Tests
// ═══════════════════════════════════════════════════════════════════════════

describe('tileToWorld / worldToTileFractional', () => {
    describe('tile at viewpoint', () => {
        it('should produce worldX = TILE_CENTER_X when tile = viewpoint, height = 0', () => {
            const world = tileToWorld(320, 320, 0, 320, 320);
            expect(world.worldX).toBeCloseTo(TILE_CENTER_X, 10);
        });

        it('should produce worldY = (TILE_CENTER_Y - height) * 0.5 when tile = viewpoint', () => {
            const h = 5;
            const world = tileToWorld(320, 320, h, 320, 320);
            expect(world.worldY).toBeCloseTo((TILE_CENTER_Y - h) * 0.5, 10);
        });
    });

    describe('round-trip with various heights', () => {
        const heights = [0, 5, 10, 15, 20];
        for (const h of heights) {
            it(`height=${h}`, () => {
                const world = tileToWorld(320, 320, h, 320, 320);
                const tile = worldToTileFractional(world.worldX, world.worldY, h, 320, 320);
                expect(Math.round(tile.tileX)).toBe(320);
                expect(Math.round(tile.tileY)).toBe(320);
            });
        }
    });

    describe('round-trip with various viewpoints', () => {
        const viewpoints = [
            { x: 100, y: 100 },
            { x: 320, y: 320 },
            { x: 500, y: 500 },
            { x: 320.5, y: 320.5 },
            { x: 100.25, y: 200.75 },
        ];

        for (const vp of viewpoints) {
            it(`viewpoint=(${vp.x}, ${vp.y})`, () => {
                const tileX = Math.floor(vp.x);
                const tileY = Math.floor(vp.y);
                const world = tileToWorld(tileX, tileY, 5, vp.x, vp.y);
                const tile = worldToTileFractional(world.worldX, world.worldY, 5, vp.x, vp.y);
                expect(Math.round(tile.tileX)).toBe(tileX);
                expect(Math.round(tile.tileY)).toBe(tileY);
            });
        }
    });

    describe('tiles offset from viewpoint', () => {
        const offsets = [
            { dx: 0, dy: 0 },
            { dx: 1, dy: 0 },
            { dx: 0, dy: 1 },
            { dx: -1, dy: 0 },
            { dx: 0, dy: -1 },
            { dx: 5, dy: 5 },
            { dx: -5, dy: -5 },
            { dx: 10, dy: -3 },
        ];

        for (const { dx, dy } of offsets) {
            it(`offset=(${dx}, ${dy})`, () => {
                const tileX = 320 + dx;
                const tileY = 320 + dy;
                const world = tileToWorld(tileX, tileY, 5, 320, 320);
                const tile = worldToTileFractional(world.worldX, world.worldY, 5, 320, 320);
                expect(Math.round(tile.tileX)).toBe(tileX);
                expect(Math.round(tile.tileY)).toBe(tileY);
            });
        }
    });
});

// ═══════════════════════════════════════════════════════════════════════════
// Full Screen → Tile Conversion Tests
// ═══════════════════════════════════════════════════════════════════════════

describe('screenToTile', () => {
    describe('input validation', () => {
        it('returns null for zero canvas width', () => {
            const result = screenToTile({
                screenX: 500, screenY: 400,
                canvasWidth: 0, canvasHeight: 800,
                zoom: 0.1,
                viewPointX: 320, viewPointY: 320,
                mapWidth: 640, mapHeight: 640,
                groundHeight: FLAT_HEIGHT,
            });
            expect(result).toBeNull();
        });

        it('returns null for zero canvas height', () => {
            const result = screenToTile({
                screenX: 500, screenY: 400,
                canvasWidth: 1000, canvasHeight: 0,
                zoom: 0.1,
                viewPointX: 320, viewPointY: 320,
                mapWidth: 640, mapHeight: 640,
                groundHeight: FLAT_HEIGHT,
            });
            expect(result).toBeNull();
        });

        it('returns null for zero zoom', () => {
            const result = screenToTile({
                screenX: 500, screenY: 400,
                canvasWidth: 1000, canvasHeight: 800,
                zoom: 0,
                viewPointX: 320, viewPointY: 320,
                mapWidth: 640, mapHeight: 640,
                groundHeight: FLAT_HEIGHT,
            });
            expect(result).toBeNull();
        });

        it('returns null for negative zoom', () => {
            const result = screenToTile({
                screenX: 500, screenY: 400,
                canvasWidth: 1000, canvasHeight: 800,
                zoom: -0.1,
                viewPointX: 320, viewPointY: 320,
                mapWidth: 640, mapHeight: 640,
                groundHeight: FLAT_HEIGHT,
            });
            expect(result).toBeNull();
        });
    });

    describe('clamping to map bounds', () => {
        it('clamps extreme negative screen coords to map bounds', () => {
            const result = screenToTile({
                screenX: -10000, screenY: -10000,
                canvasWidth: 1000, canvasHeight: 800,
                zoom: 0.1,
                viewPointX: 320, viewPointY: 320,
                mapWidth: 640, mapHeight: 640,
                groundHeight: FLAT_HEIGHT,
            });
            expect(result).not.toBeNull();
            expect(result!.x).toBeGreaterThanOrEqual(0);
            expect(result!.x).toBeLessThan(640);
            expect(result!.y).toBeGreaterThanOrEqual(0);
            expect(result!.y).toBeLessThan(640);
        });

        it('clamps extreme positive screen coords to map bounds', () => {
            const result = screenToTile({
                screenX: 10000, screenY: 10000,
                canvasWidth: 1000, canvasHeight: 800,
                zoom: 0.1,
                viewPointX: 320, viewPointY: 320,
                mapWidth: 640, mapHeight: 640,
                groundHeight: FLAT_HEIGHT,
            });
            expect(result).not.toBeNull();
            expect(result!.x).toBeGreaterThanOrEqual(0);
            expect(result!.x).toBeLessThan(640);
            expect(result!.y).toBeGreaterThanOrEqual(0);
            expect(result!.y).toBeLessThan(640);
        });
    });

    describe('height refinement', () => {
        it('handles flat terrain (height=128)', () => {
            const result = screenToTile({
                screenX: 500, screenY: 400,
                canvasWidth: 1000, canvasHeight: 800,
                zoom: 0.1,
                viewPointX: 320, viewPointY: 320,
                mapWidth: 640, mapHeight: 640,
                groundHeight: FLAT_HEIGHT,
            });
            expect(result).not.toBeNull();
        });

        it('handles max height terrain (height=255)', () => {
            const maxHeight = new Uint8Array(640 * 640).fill(255);
            const result = screenToTile({
                screenX: 500, screenY: 400,
                canvasWidth: 1000, canvasHeight: 800,
                zoom: 0.1,
                viewPointX: 320, viewPointY: 320,
                mapWidth: 640, mapHeight: 640,
                groundHeight: maxHeight,
            });
            expect(result).not.toBeNull();
        });

        it('handles min height terrain (height=0)', () => {
            const minHeight = new Uint8Array(640 * 640).fill(0);
            const result = screenToTile({
                screenX: 500, screenY: 400,
                canvasWidth: 1000, canvasHeight: 800,
                zoom: 0.1,
                viewPointX: 320, viewPointY: 320,
                mapWidth: 640, mapHeight: 640,
                groundHeight: minHeight,
            });
            expect(result).not.toBeNull();
        });

        it('handles sloped terrain', () => {
            const slopedHeight = new Uint8Array(640 * 640);
            for (let y = 0; y < 640; y++) {
                for (let x = 0; x < 640; x++) {
                    slopedHeight[y * 640 + x] = Math.min(255, y);
                }
            }
            const result = screenToTile({
                screenX: 500, screenY: 400,
                canvasWidth: 1000, canvasHeight: 800,
                zoom: 0.1,
                viewPointX: 320, viewPointY: 320,
                mapWidth: 640, mapHeight: 640,
                groundHeight: slopedHeight,
            });
            expect(result).not.toBeNull();
        });
    });
});

// ═══════════════════════════════════════════════════════════════════════════
// Full Tile → Screen Conversion Tests
// ═══════════════════════════════════════════════════════════════════════════

describe('tileToScreen', () => {
    it('tile at viewpoint should be near screen center', () => {
        const result = tileToScreen({
            tileX: 320, tileY: 320,
            canvasWidth: 1000, canvasHeight: 800,
            zoom: 0.1,
            viewPointX: 320, viewPointY: 320,
            mapWidth: 640, mapHeight: 640,
            groundHeight: FLAT_HEIGHT,
        });
        expect(result.screenX).toBeGreaterThan(300);
        expect(result.screenX).toBeLessThan(700);
        expect(result.screenY).toBeGreaterThan(100);
        expect(result.screenY).toBeLessThan(600);
    });

    it('tiles further from viewpoint should be further from center', () => {
        const center = tileToScreen({
            tileX: 320, tileY: 320,
            canvasWidth: 1000, canvasHeight: 800,
            zoom: 0.1,
            viewPointX: 320, viewPointY: 320,
            mapWidth: 640, mapHeight: 640,
            groundHeight: FLAT_HEIGHT,
        });

        const offset = tileToScreen({
            tileX: 330, tileY: 330,
            canvasWidth: 1000, canvasHeight: 800,
            zoom: 0.1,
            viewPointX: 320, viewPointY: 320,
            mapWidth: 640, mapHeight: 640,
            groundHeight: FLAT_HEIGHT,
        });

        expect(offset.screenX).not.toBeCloseTo(center.screenX, 0);
        expect(offset.screenY).not.toBeCloseTo(center.screenY, 0);
    });
});

// ═══════════════════════════════════════════════════════════════════════════
// tileToWorldPos Convenience Function Tests
// ═══════════════════════════════════════════════════════════════════════════

describe('tileToWorldPos', () => {
    it('looks up height and returns world position', () => {
        const result = tileToWorldPos(320, 320, FLAT_HEIGHT, 640, 640, 320, 320);
        const expected = tileToWorld(320, 320, heightToWorld(128), 320, 320);
        expect(result.worldX).toBeCloseTo(expected.worldX, 10);
        expect(result.worldY).toBeCloseTo(expected.worldY, 10);
    });

    it('handles out-of-bounds tiles gracefully (returns height=0)', () => {
        const result = tileToWorldPos(-1, -1, FLAT_HEIGHT, 640, 640, 320, 320);
        const expected = tileToWorld(-1, -1, 0, 320, 320);
        expect(result.worldX).toBeCloseTo(expected.worldX, 10);
        expect(result.worldY).toBeCloseTo(expected.worldY, 10);
    });
});
