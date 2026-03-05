/**
 * Coordinate System Tests - Core Transforms
 *
 * Tests the individual coordinate transformation functions.
 * Round-trip correctness is the primary concern — if forward and inverse
 * transforms compose to identity, the individual steps are correct.
 *
 * See coordinate-system.ts for full documentation of coordinate spaces.
 */

import { describe, it, expect } from 'vitest';
import {
    heightToWorld,
    worldToHeight,
    screenToNdc,
    ndcToScreen,
    ndcToWorld,
    worldToNdc,
    tileToWorld,
    worldToTileFractional,
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
// Height Conversion Round-Trip
// ═══════════════════════════════════════════════════════════════════════════

describe('heightToWorld / worldToHeight round-trip', () => {
    it('should round-trip all representative values', () => {
        for (const h of [0, 64, 128, 192, 255]) {
            const world = heightToWorld(h);
            const back = worldToHeight(world);
            expect(back).toBe(h);
        }
    });

    it('should map boundary values correctly', () => {
        expect(heightToWorld(0)).toBe(0);
        expect(heightToWorld(255)).toBeCloseTo(20.0, 5);
        expect(worldToHeight(0)).toBe(0);
        expect(worldToHeight(20)).toBe(255);
    });
});

// ═══════════════════════════════════════════════════════════════════════════
// Screen <-> NDC Round-Trip
// ═══════════════════════════════════════════════════════════════════════════

describe('screenToNdc / ndcToScreen round-trip', () => {
    const W = 1000,
        H = 800;

    it('should round-trip representative screen points', () => {
        const testPoints = [
            { x: 0, y: 0 }, // top-left
            { x: 500, y: 400 }, // center
            { x: 250, y: 200 },
            { x: 750, y: 600 },
            { x: W, y: H }, // bottom-right
        ];

        for (const pt of testPoints) {
            const ndc = screenToNdc(pt.x, pt.y, W, H);
            const back = ndcToScreen(ndc.ndcX, ndc.ndcY, W, H);
            expect(back.screenX).toBeCloseTo(pt.x, 5);
            expect(back.screenY).toBeCloseTo(pt.y, 5);
        }
    });
});

// ═══════════════════════════════════════════════════════════════════════════
// NDC <-> World Round-Trip
// ═══════════════════════════════════════════════════════════════════════════

describe('ndcToWorld / worldToNdc round-trip', () => {
    const zoom = 0.1;
    const aspect = 1.25;

    it('should round-trip NDC points through world space', () => {
        const points = [
            { ndcX: 0, ndcY: 0 },
            { ndcX: 0.5, ndcY: 0.5 },
            { ndcX: -0.5, ndcY: -0.5 },
            { ndcX: 0.9, ndcY: -0.9 },
        ];

        for (const pt of points) {
            const world = ndcToWorld(pt.ndcX, pt.ndcY, zoom, aspect);
            const back = worldToNdc(world.worldX, world.worldY, zoom, aspect);
            expect(back.ndcX).toBeCloseTo(pt.ndcX, 10);
            expect(back.ndcY).toBeCloseTo(pt.ndcY, 10);
        }
    });

    it('smaller zoom yields larger world range', () => {
        const w1 = ndcToWorld(1, 0, 0.1, aspect);
        const w2 = ndcToWorld(1, 0, 0.2, aspect);
        expect(Math.abs(w1.worldX)).toBeGreaterThan(Math.abs(w2.worldX));
    });
});

// ═══════════════════════════════════════════════════════════════════════════
// World <-> Tile Round-Trip
// ═══════════════════════════════════════════════════════════════════════════

describe('tileToWorld / worldToTileFractional round-trip', () => {
    it('should round-trip tiles across various heights and viewpoints', () => {
        const cases = [
            { tile: { x: 320, y: 320 }, h: 0, vp: { x: 320, y: 320 } },
            { tile: { x: 320, y: 320 }, h: 10, vp: { x: 320, y: 320 } },
            { tile: { x: 320, y: 320 }, h: 20, vp: { x: 320, y: 320 } },
            { tile: { x: 100, y: 100 }, h: 5, vp: { x: 100, y: 100 } },
            { tile: { x: 320, y: 320 }, h: 5, vp: { x: 320.5, y: 320.5 } },
            { tile: { x: 100, y: 200 }, h: 5, vp: { x: 100.25, y: 200.75 } },
            { tile: { x: 325, y: 325 }, h: 5, vp: { x: 320, y: 320 } },
            { tile: { x: 315, y: 315 }, h: 5, vp: { x: 320, y: 320 } },
            { tile: { x: 330, y: 317 }, h: 5, vp: { x: 320, y: 320 } },
        ];

        for (const { tile, h, vp } of cases) {
            const world = tileToWorld(tile.x, tile.y, h, vp.x, vp.y);
            const back = worldToTileFractional(world.worldX, world.worldY, h, vp.x, vp.y);
            expect(Math.round(back.tileX)).toBe(tile.x);
            expect(Math.round(back.tileY)).toBe(tile.y);
        }
    });
});

// ═══════════════════════════════════════════════════════════════════════════
// Full Screen -> Tile: Input Validation and Boundary Behavior
// ═══════════════════════════════════════════════════════════════════════════

describe('screenToTile', () => {
    it('returns null for degenerate inputs (zero canvas, zero/negative zoom)', () => {
        const base = {
            screenX: 500,
            screenY: 400,
            canvasWidth: 1000,
            canvasHeight: 800,
            zoom: 0.1,
            viewPointX: 320,
            viewPointY: 320,
            mapWidth: 640,
            mapHeight: 640,
            groundHeight: FLAT_HEIGHT,
        };

        expect(screenToTile({ ...base, canvasWidth: 0 })).toBeNull();
        expect(screenToTile({ ...base, canvasHeight: 0 })).toBeNull();
        expect(screenToTile({ ...base, zoom: 0 })).toBeNull();
        expect(screenToTile({ ...base, zoom: -0.1 })).toBeNull();
    });

    it('clamps extreme screen coords to map bounds', () => {
        const base = {
            canvasWidth: 1000,
            canvasHeight: 800,
            zoom: 0.1,
            viewPointX: 320,
            viewPointY: 320,
            mapWidth: 640,
            mapHeight: 640,
            groundHeight: FLAT_HEIGHT,
        };

        for (const [sx, sy] of [
            [-10000, -10000],
            [10000, 10000],
        ]) {
            const result = screenToTile({ ...base, screenX: sx!, screenY: sy! });
            expect(result).not.toBeNull();
            expect(result!.x).toBeGreaterThanOrEqual(0);
            expect(result!.x).toBeLessThan(640);
            expect(result!.y).toBeGreaterThanOrEqual(0);
            expect(result!.y).toBeLessThan(640);
        }
    });
});

// ═══════════════════════════════════════════════════════════════════════════
// tileToScreen: Spatial Relationships
// ═══════════════════════════════════════════════════════════════════════════

describe('tileToScreen', () => {
    it('tile at viewpoint is near screen center; offset tile is further away', () => {
        const base = {
            canvasWidth: 1000,
            canvasHeight: 800,
            zoom: 0.1,
            viewPointX: 320,
            viewPointY: 320,
            mapWidth: 640,
            mapHeight: 640,
            groundHeight: FLAT_HEIGHT,
        };

        const center = tileToScreen({ ...base, tileX: 320, tileY: 320 });
        const offset = tileToScreen({ ...base, tileX: 330, tileY: 330 });

        // Center tile near screen center
        expect(center.screenX).toBeGreaterThan(300);
        expect(center.screenX).toBeLessThan(700);

        // Offset tile is at a different position
        expect(offset.screenX).not.toBeCloseTo(center.screenX, 0);
        expect(offset.screenY).not.toBeCloseTo(center.screenY, 0);
    });
});

// ═══════════════════════════════════════════════════════════════════════════
// tileToWorldPos Convenience Function
// ═══════════════════════════════════════════════════════════════════════════

describe('tileToWorldPos', () => {
    it('matches tileToWorld with looked-up height, and handles out-of-bounds', () => {
        // In-bounds
        const result = tileToWorldPos(320, 320, FLAT_HEIGHT, 640, 640, 320, 320);
        const expected = tileToWorld(320, 320, heightToWorld(128), 320, 320);
        expect(result.worldX).toBeCloseTo(expected.worldX, 10);
        expect(result.worldY).toBeCloseTo(expected.worldY, 10);

        // Out-of-bounds uses height=0
        const oob = tileToWorldPos(-1, -1, FLAT_HEIGHT, 640, 640, 320, 320);
        const oobExpected = tileToWorld(-1, -1, 0, 320, 320);
        expect(oob.worldX).toBeCloseTo(oobExpected.worldX, 10);
        expect(oob.worldY).toBeCloseTo(oobExpected.worldY, 10);
    });
});
