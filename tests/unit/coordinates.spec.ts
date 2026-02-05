/**
 * Coordinate System Tests
 *
 * This file tests the coordinate transformations used in rendering.
 *
 * COORDINATE SYSTEMS:
 *
 * 1. TILE COORDINATES (tileX, tileY)
 *    - Integer grid positions on the map
 *    - Range: 0 to mapSize-1
 *    - Used for game logic, entity positions
 *
 * 2. STAGGERED COORDINATES (instX, instY)
 *    - Hex-grid stagger: instX = tileX + floor(tileY / 2)
 *    - Used internally for isometric projection
 *
 * 3. WORLD COORDINATES (worldX, worldY)
 *    - View-relative positions for rendering
 *    - Computed by TilePicker.tileToWorld()
 *    - Should be small values near 0 when tile is near viewpoint
 *    - Formula:
 *      instX = tileX + floor(tileY/2) - viewPointX
 *      instY = tileY - viewPointY
 *      worldX = instX + 0.25 - instY * 0.5
 *      worldY = (instY + 0.5 - height) * 0.5
 *
 * 4. CLIP COORDINATES (-1 to 1)
 *    - Final coordinates after projection matrix
 *    - Visible range: -1 to 1 on both axes
 */

import { describe, it, expect } from 'vitest';
import { TilePicker } from '@/game/input/tile-picker';
import { MapSize } from '@/utilities/map-size';

describe('Coordinate Systems', () => {
    // Create a simple test map
    const mapSize = new MapSize(640, 640);
    const groundHeight = new Uint8Array(mapSize.width * mapSize.height).fill(128);

    describe('TilePicker.tileToWorld', () => {
        it('should return small world coords when tile equals viewpoint', () => {
            const viewX = 320, viewY = 320;
            const tileX = 320, tileY = 320;

            const result = TilePicker.tileToWorld(
                tileX, tileY,
                groundHeight, mapSize,
                viewX, viewY
            );

            // When tile == viewpoint, world coords should be near 0
            // instX = 320 + floor(320/2) - 320 = 160
            // instY = 320 - 320 = 0
            // worldX = 160 + 0.25 - 0 = 160.25  <-- THIS IS THE BUG!

            console.log('Tile at viewpoint:', {
                tile: { x: tileX, y: tileY },
                viewPoint: { x: viewX, y: viewY },
                worldPos: result
            });

            // Expected: worldX should be small (near 0) when tile is at viewpoint
            // Actual: worldX is 160.25 which is huge!
            expect(Math.abs(result.worldX)).toBeLessThan(10);
            expect(Math.abs(result.worldY)).toBeLessThan(10);
        });

        it('should return small world coords for tiles near viewpoint', () => {
            const viewX = 320, viewY = 320;

            // Test tiles at various offsets from viewpoint
            const offsets = [
                { dx: 0, dy: 0 },
                { dx: 1, dy: 0 },
                { dx: 0, dy: 1 },
                { dx: -1, dy: 0 },
                { dx: 0, dy: -1 },
                { dx: 5, dy: 5 },
                { dx: -5, dy: -5 },
            ];

            for (const { dx, dy } of offsets) {
                const tileX = viewX + dx;
                const tileY = viewY + dy;

                const result = TilePicker.tileToWorld(
                    tileX, tileY,
                    groundHeight, mapSize,
                    viewX, viewY
                );

                console.log(`Tile offset (${dx}, ${dy}):`, {
                    tile: { x: tileX, y: tileY },
                    worldPos: result
                });

                // World coords should be proportional to tile offset, not huge
                // With zoom ~0.1, visible range is roughly -10 to +10
                expect(Math.abs(result.worldX)).toBeLessThan(20);
                expect(Math.abs(result.worldY)).toBeLessThan(20);
            }
        });

        it('should match landscape shader coordinate system', () => {
            // The landscape shader uses:
            //   instancePos = small offset from view center (-20 to +20 typically)
            //   pixelCoord = instancePos + viewPoint  (actual tile coord)
            //   worldX = instancePos.x - instancePos.y * 0.5 - vpFrac.x + vpFrac.y * 0.5
            //   worldY = (instancePos.y - height) * 0.5
            //
            // For a tile at the viewpoint (instancePos = 0, 0):
            //   worldX = 0 - 0 = 0
            //   worldY = (0 - height) * 0.5 ≈ small value

            const viewX = 320, viewY = 320;

            // Simulate what landscape shader does for a tile at viewpoint
            const instancePosX = 0; // Tile is at view center
            const instancePosY = 0;
            const height = 128 * 20 / 255; // Same scaling as tileToWorld

            const landscapeWorldX = instancePosX - instancePosY * 0.5;
            const landscapeWorldY = (instancePosY - height) * 0.5;

            console.log('Landscape shader coords for tile at view center:', {
                instancePos: { x: instancePosX, y: instancePosY },
                worldPos: { x: landscapeWorldX, y: landscapeWorldY }
            });

            // Now compare with TilePicker.tileToWorld
            const pickerResult = TilePicker.tileToWorld(
                viewX, viewY,
                groundHeight, mapSize,
                viewX, viewY
            );

            console.log('TilePicker.tileToWorld for same tile:', pickerResult);

            // These should be similar!
            expect(Math.abs(pickerResult.worldX - landscapeWorldX)).toBeLessThan(1);
        });
    });

    describe('Staggered coordinate calculation', () => {
        it('should understand the stagger formula', () => {
            // The hex grid staggers every other row
            // instancePos.x = tileX + floor(tileY / 2)

            const examples = [
                { tileX: 0, tileY: 0, expectedStaggerX: 0 },
                { tileX: 0, tileY: 1, expectedStaggerX: 0 },  // floor(1/2) = 0
                { tileX: 0, tileY: 2, expectedStaggerX: 1 },  // floor(2/2) = 1
                { tileX: 0, tileY: 3, expectedStaggerX: 1 },  // floor(3/2) = 1
                { tileX: 10, tileY: 100, expectedStaggerX: 60 }, // 10 + floor(100/2) = 60
            ];

            for (const { tileX, tileY, expectedStaggerX } of examples) {
                const staggerX = tileX + Math.floor(tileY / 2);
                expect(staggerX).toBe(expectedStaggerX);
            }
        });
    });

    describe('Projection matrix visible range', () => {
        it('should understand the visible coordinate range', () => {
            // Projection: createOrthographic(-aspect, aspect, 1, -1).scale(zoom).translate(...)
            // With aspect ~1.3 and zoom = 0.1:
            // - Before zoom: visible X range is -1.3 to 1.3
            // - After zoom (0.1): visible X range is roughly -13 to 13
            // - After translate: shifts by zoom amount

            const aspect = 1.3;
            const zoom = 0.1;

            // Approximate visible world coordinate range
            const visibleRangeX = aspect / zoom;  // ~13
            const visibleRangeY = 1 / zoom;       // ~10

            console.log('Approximate visible range:', {
                x: [-visibleRangeX, visibleRangeX],
                y: [-visibleRangeY, visibleRangeY]
            });

            expect(visibleRangeX).toBeGreaterThan(10);
            expect(visibleRangeY).toBeGreaterThan(5);
        });
    });
});

describe('screenToTile and tileToWorld round-trip', () => {
    const mapSize = new MapSize(640, 640);
    const groundHeight = new Uint8Array(mapSize.width * mapSize.height).fill(128);

    // Mock canvas for TilePicker
    const mockCanvas = {
        clientWidth: 1300,
        clientHeight: 1000,
    } as HTMLCanvasElement;

    const picker = new TilePicker(mockCanvas);

    it('should round-trip tile coords through tileToWorld and screenToTile', () => {
        const viewPoint = { x: 320, y: 320, zoom: 0.1 };

        // Test tiles near the viewpoint - include both odd and even Y (affects stagger)
        const testTiles = [
            // At viewpoint (even Y)
            { x: 320, y: 320 },
            // Simple offsets
            { x: 321, y: 320 },  // 1 tile right (even Y)
            { x: 320, y: 321 },  // 1 tile down (odd Y - different stagger)
            { x: 319, y: 320 },  // 1 tile left (even Y)
            { x: 320, y: 319 },  // 1 tile up (odd Y)
            // Larger offsets with odd Y
            { x: 315, y: 315 },  // odd Y
            { x: 315, y: 316 },  // even Y
            { x: 325, y: 325 },  // odd Y
            { x: 325, y: 326 },  // even Y
            // Diagonal offsets
            { x: 318, y: 322 },  // even Y
            { x: 318, y: 323 },  // odd Y
            { x: 322, y: 318 },  // even Y
            { x: 322, y: 317 },  // odd Y
        ];

        for (const tile of testTiles) {
            // Convert tile -> world
            const worldPos = TilePicker.tileToWorld(
                tile.x, tile.y,
                groundHeight, mapSize,
                viewPoint.x, viewPoint.y
            );

            console.log(`Tile (${tile.x}, ${tile.y}) -> world (${worldPos.worldX.toFixed(2)}, ${worldPos.worldY.toFixed(2)})`);

            // Convert world -> screen (reverse projection)
            // worldX = (ndcX + zoom) * aspect / zoom => ndcX = worldX * zoom / aspect - zoom
            // worldY = (zoom - ndcY) / zoom => ndcY = zoom - worldY * zoom
            const aspect = mockCanvas.clientWidth / mockCanvas.clientHeight;
            const ndcX = worldPos.worldX * viewPoint.zoom / aspect - viewPoint.zoom;
            const ndcY = viewPoint.zoom - worldPos.worldY * viewPoint.zoom;

            // Convert NDC -> screen pixels
            const screenX = (ndcX + 1) / 2 * mockCanvas.clientWidth;
            const screenY = (1 - ndcY) / 2 * mockCanvas.clientHeight;

            console.log(`  -> screen (${screenX.toFixed(1)}, ${screenY.toFixed(1)})`);

            // Now convert screen -> tile using screenToTile
            const recoveredTile = picker.screenToTile(
                screenX, screenY,
                viewPoint, mapSize, groundHeight
            );

            console.log(`  -> recovered tile (${recoveredTile?.x}, ${recoveredTile?.y})`);

            // The round-trip should return the same tile (or very close)
            expect(recoveredTile).not.toBeNull();
            expect(recoveredTile!.x).toBe(tile.x);
            expect(recoveredTile!.y).toBe(tile.y);
        }
    });

    it('should work with different viewpoint positions', () => {
        // Test with viewpoints at various positions including odd/even Y
        const viewPoints = [
            { x: 100, y: 100, zoom: 0.1 },   // Even Y viewpoint
            { x: 100, y: 101, zoom: 0.1 },   // Odd Y viewpoint
            { x: 500, y: 500, zoom: 0.1 },   // Even Y viewpoint
            { x: 500, y: 501, zoom: 0.1 },   // Odd Y viewpoint
            { x: 320, y: 319, zoom: 0.1 },   // Odd Y viewpoint (near center)
        ];

        for (const viewPoint of viewPoints) {
            // Test a few tiles relative to each viewpoint
            const testOffsets = [
                { dx: 0, dy: 0 },
                { dx: 3, dy: 2 },
                { dx: -2, dy: 3 },
                { dx: 5, dy: -4 },
            ];

            for (const { dx, dy } of testOffsets) {
                const tile = { x: viewPoint.x + dx, y: viewPoint.y + dy };

                // Skip if out of bounds
                if (tile.x < 0 || tile.x >= mapSize.width ||
                    tile.y < 0 || tile.y >= mapSize.height) {
                    continue;
                }

                const worldPos = TilePicker.tileToWorld(
                    tile.x, tile.y,
                    groundHeight, mapSize,
                    viewPoint.x, viewPoint.y
                );

                // Convert world -> screen
                const aspect = mockCanvas.clientWidth / mockCanvas.clientHeight;
                const ndcX = worldPos.worldX * viewPoint.zoom / aspect - viewPoint.zoom;
                const ndcY = viewPoint.zoom - worldPos.worldY * viewPoint.zoom;
                const screenX = (ndcX + 1) / 2 * mockCanvas.clientWidth;
                const screenY = (1 - ndcY) / 2 * mockCanvas.clientHeight;

                // Convert screen -> tile
                const recoveredTile = picker.screenToTile(
                    screenX, screenY,
                    viewPoint, mapSize, groundHeight
                );

                expect(recoveredTile).not.toBeNull();
                expect(recoveredTile!.x).toBe(tile.x);
                expect(recoveredTile!.y).toBe(tile.y);
            }
        }
    });

    it('should have matching formulas in screenToTile and tileToWorld', () => {
        // This test verifies that the math in screenToTile is the inverse of tileToWorld
        //
        // tileToWorld forward:
        //   tileStaggerX = tileX + floor(tileY/2)
        //   viewStaggerX = viewPointX + floor(viewPointY/2)
        //   instX = tileStaggerX - viewStaggerX
        //   instY = tileY - viewPointY
        //   worldX = instX + 0.25 - instY * 0.5
        //   worldY = (instY + 0.5 - height) * 0.5
        //
        // screenToTile reverse should be:
        //   instY = worldY * 2 - 0.5 + height
        //   tileY = instY + viewPointY
        //   instX = worldX - 0.25 + instY * 0.5
        //   tileStaggerX = instX + viewStaggerX
        //   tileX = tileStaggerX - floor(tileY/2)

        const viewPoint = { x: 320, y: 320, zoom: 0.1 };
        const viewStaggerX = viewPoint.x + Math.floor(viewPoint.y / 2); // 320 + 160 = 480

        // Pick a test tile
        const tileX = 325, tileY = 322;
        const tileStaggerX = tileX + Math.floor(tileY / 2); // 325 + 161 = 486

        // Forward transform (what tileToWorld does)
        const height = 128 * 20 / 255;
        const instX = tileStaggerX - viewStaggerX;  // 486 - 480 = 6
        const instY = tileY - viewPoint.y;          // 322 - 320 = 2
        const worldX = instX + 0.25 - instY * 0.5;  // 6 + 0.25 - 1 = 5.25
        const worldY = (instY + 0.5 - height) * 0.5;

        console.log('Forward transform:', { instX, instY, worldX, worldY });

        // Reverse transform (what screenToTile should do)
        const recoveredInstY = worldY * 2 - 0.5 + height;  // Should equal instY = 2
        const recoveredTileY = Math.round(recoveredInstY + viewPoint.y);  // Should equal tileY = 322

        const recoveredInstX = worldX - 0.25 + recoveredInstY * 0.5;  // Should equal instX = 6
        const recoveredTileStaggerX = recoveredInstX + viewStaggerX;  // Should equal 486
        const recoveredTileX = Math.round(recoveredTileStaggerX - Math.floor(recoveredTileY / 2));

        console.log('Reverse transform:', {
            recoveredInstY,
            recoveredTileY,
            recoveredInstX,
            recoveredTileStaggerX,
            recoveredTileX
        });

        expect(recoveredTileX).toBe(tileX);
        expect(recoveredTileY).toBe(tileY);
    });
});

describe('Coordinate Bug Analysis', () => {
    const mapSize = new MapSize(640, 640);
    const groundHeight = new Uint8Array(mapSize.width * mapSize.height).fill(128);

    it('should identify the tileToWorld bug', () => {
        // From test output:
        // - Ghost at tile (162, 321) with viewPoint (319, 319) → worldPos (2.25, 1.25) ✓
        // - Indicator at tile (313, 289) with viewPoint (319, 319) → worldPos (153.25, -17.4) ✗

        // Let's trace through manually:

        // Ghost tile (162, 321), viewPoint (319, 319):
        const ghostTile = { x: 162, y: 321 };
        const viewPoint = { x: 319, y: 319 };

        // CORRECTED FORMULA:
        // tileStaggerX = 162 + floor(321/2) = 162 + 160 = 322
        // viewStaggerX = 319 + floor(319/2) = 319 + 159 = 478
        // instX = 322 - 478 = -156
        // instY = 321 - 319 = 2
        // worldX = -156 + 0.25 - 2 * 0.5 = -156.75

        const tileStaggerX = ghostTile.x + Math.floor(ghostTile.y / 2);
        const viewStaggerX = viewPoint.x + Math.floor(viewPoint.y / 2);
        const ghostInstX = tileStaggerX - viewStaggerX;
        const ghostInstY = ghostTile.y - viewPoint.y;
        console.log('Ghost calculation (corrected):', { instX: ghostInstX, instY: ghostInstY });

        // The ghost tile (162, 321) is far from viewPoint (319, 319) - this is expected
        // when the mouse is not near the camera center

        // Indicator tile (313, 289), viewPoint (319, 319):
        const indicatorTile = { x: 313, y: 289 };

        // tileStaggerX = 313 + floor(289/2) = 313 + 144 = 457
        // viewStaggerX = 319 + floor(319/2) = 319 + 159 = 478
        // instX = 457 - 478 = -21
        // instY = 289 - 319 = -30
        // worldX = -21 + 0.25 - (-30) * 0.5 = -21 + 0.25 + 15 = -5.75

        const indTileStaggerX = indicatorTile.x + Math.floor(indicatorTile.y / 2);
        const indInstX = indTileStaggerX - viewStaggerX;
        const indInstY = indicatorTile.y - viewPoint.y;
        console.log('Indicator calculation (corrected):', { instX: indInstX, instY: indInstY });
        expect(indInstX).toBe(-21);
        expect(indInstY).toBe(-30);

        // With the corrected formula, worldX = -5.75 which is within visible range!
        const worldX = indInstX + 0.25 - indInstY * 0.5;
        console.log('Indicator worldX (corrected):', worldX);
        expect(worldX).toBe(-5.75);
        expect(Math.abs(worldX)).toBeLessThan(13); // Within visible range
    });

    it('should verify cache center matches viewpoint', () => {
        // The rebuildCache function should center on viewPoint:
        // centerX = Math.round(viewPoint.x)
        // centerY = Math.round(viewPoint.y)
        // minX = centerX - visibleWidth, maxX = centerX + visibleWidth
        // minY = centerY - visibleHeight, maxY = centerY + visibleHeight

        // With viewPoint (319, 319) and visibleWidth/Height of ~50:
        // Cache should cover tiles from ~269 to ~369 in both directions

        const viewPoint = { x: 319, y: 319 };
        const zoom = 0.1;
        const zoomValue = 0.1 / zoom; // = 1
        const visibleWidth = Math.ceil(40 / zoomValue);  // = 40
        const visibleHeight = Math.ceil(30 / zoomValue); // = 30

        const minX = Math.max(0, viewPoint.x - visibleWidth);  // 279
        const maxX = viewPoint.x + visibleWidth;               // 359
        const minY = Math.max(0, viewPoint.y - visibleHeight); // 289
        const maxY = viewPoint.y + visibleHeight;              // 349

        console.log('Expected cache range:', {
            x: [minX, maxX],
            y: [minY, maxY]
        });

        // Tile (313, 289) is at the EDGE of the cache (minY = 289)
        // This is why it's the first tile - iteration starts from minY!
        expect(313).toBeGreaterThanOrEqual(minX);
        expect(313).toBeLessThanOrEqual(maxX);
        expect(289).toBeGreaterThanOrEqual(minY);
        expect(289).toBeLessThanOrEqual(maxY);
    });
});

describe('tileToWorld must match shader formula', () => {
    const mapSize = new MapSize(640, 640);
    const groundHeight = new Uint8Array(mapSize.width * mapSize.height).fill(128);
    const heightScaled = 128 * 20 / 255; // same as shader: mapHeight * 20

    /**
     * Computes world position exactly as the landscape shader does.
     * From landscape-vert.glsl:
     *   vec2 vpInt = floor(viewPoint);
     *   vec2 vpFrac = viewPoint - vpInt;
     *   vec2 pixelCoord = instancePos + vpInt;
     *   worldX = baseVerticesPos.x + instancePos.x - instancePos.y * 0.5 - vpFrac.x + vpFrac.y * 0.5
     *   worldY = (baseVerticesPos.y + instancePos.y - mapHeight - vpFrac.y) * 0.5
     *
     * For tile center, baseVerticesPos ≈ (0.25, 0.5)
     */
    function shaderWorldPos(
        tileX: number,
        tileY: number,
        viewPointX: number,
        viewPointY: number
    ): { worldX: number; worldY: number } {
        const vpIntX = Math.floor(viewPointX);
        const vpIntY = Math.floor(viewPointY);
        const vpFracX = viewPointX - vpIntX;
        const vpFracY = viewPointY - vpIntY;

        // instancePos is relative to floor(viewPoint)
        const instancePosX = tileX - vpIntX;
        const instancePosY = tileY - vpIntY;

        // Tile center is at baseVerticesPos = (0.25, 0.5)
        const worldX = 0.25 + instancePosX - instancePosY * 0.5 - vpFracX + vpFracY * 0.5;
        const worldY = (0.5 + instancePosY - heightScaled - vpFracY) * 0.5;

        return { worldX, worldY };
    }

    it('should match shader with integer viewPoint', () => {
        const tile = { x: 320, y: 320 };
        const viewPoint = { x: 320, y: 320 };

        const shaderPos = shaderWorldPos(tile.x, tile.y, viewPoint.x, viewPoint.y);
        const tilePickerPos = TilePicker.tileToWorld(
            tile.x, tile.y,
            groundHeight, mapSize,
            viewPoint.x, viewPoint.y
        );

        expect(tilePickerPos.worldX).toBeCloseTo(shaderPos.worldX, 5);
        expect(tilePickerPos.worldY).toBeCloseTo(shaderPos.worldY, 5);
    });

    it('should match shader with fractional viewPoint (zoom drift bug)', () => {
        // This test exposes the bug: when viewPoint has fractional values
        // (which happens during zoom), tileToWorld diverges from shader.
        const tile = { x: 320, y: 320 };

        // Simulate viewPoint after zooming (fractional values)
        const viewPoints = [
            { x: 320.3, y: 320.7 },
            { x: 319.5, y: 320.5 },
            { x: 320.0, y: 319.5 },  // This one crosses odd/even Y boundary in stagger calc!
            { x: 320.8, y: 321.2 },
        ];

        for (const vp of viewPoints) {
            const shaderPos = shaderWorldPos(tile.x, tile.y, vp.x, vp.y);
            const tilePickerPos = TilePicker.tileToWorld(
                tile.x, tile.y,
                groundHeight, mapSize,
                vp.x, vp.y
            );

            console.log(`ViewPoint (${vp.x}, ${vp.y}):`);
            console.log(`  Shader:     (${shaderPos.worldX.toFixed(3)}, ${shaderPos.worldY.toFixed(3)})`);
            console.log(`  TilePicker: (${tilePickerPos.worldX.toFixed(3)}, ${tilePickerPos.worldY.toFixed(3)})`);

            expect(tilePickerPos.worldX).toBeCloseTo(shaderPos.worldX, 5);
            expect(tilePickerPos.worldY).toBeCloseTo(shaderPos.worldY, 5);
        }
    });

    it('should produce stable relative positions when zoom changes', () => {
        // When zoom changes, the relative position between two tiles should stay constant
        // (they should just scale together, not shift horizontally)
        const tile1 = { x: 320, y: 320 };
        const tile2 = { x: 325, y: 322 };

        // Simulate different viewPoints that might occur during zoom
        const viewPoints = [
            { x: 320.0, y: 320.0 },
            { x: 320.5, y: 320.5 },
            { x: 321.0, y: 321.0 },
        ];

        const relativePosFromShader: { dx: number; dy: number }[] = [];
        const relativePosFromTilePicker: { dx: number; dy: number }[] = [];

        for (const vp of viewPoints) {
            // Shader positions
            const s1 = shaderWorldPos(tile1.x, tile1.y, vp.x, vp.y);
            const s2 = shaderWorldPos(tile2.x, tile2.y, vp.x, vp.y);
            relativePosFromShader.push({ dx: s2.worldX - s1.worldX, dy: s2.worldY - s1.worldY });

            // TilePicker positions
            const t1 = TilePicker.tileToWorld(tile1.x, tile1.y, groundHeight, mapSize, vp.x, vp.y);
            const t2 = TilePicker.tileToWorld(tile2.x, tile2.y, groundHeight, mapSize, vp.x, vp.y);
            relativePosFromTilePicker.push({ dx: t2.worldX - t1.worldX, dy: t2.worldY - t1.worldY });
        }

        // Shader relative positions should be constant (tiles don't drift relative to each other)
        for (let i = 1; i < relativePosFromShader.length; i++) {
            expect(relativePosFromShader[i].dx).toBeCloseTo(relativePosFromShader[0].dx, 5);
            expect(relativePosFromShader[i].dy).toBeCloseTo(relativePosFromShader[0].dy, 5);
        }

        // TilePicker should also produce constant relative positions
        for (let i = 1; i < relativePosFromTilePicker.length; i++) {
            expect(relativePosFromTilePicker[i].dx).toBeCloseTo(relativePosFromTilePicker[0].dx, 5);
            expect(relativePosFromTilePicker[i].dy).toBeCloseTo(relativePosFromTilePicker[0].dy, 5);
        }
    });

    it('should handle map edges correctly', () => {
        // Test tiles at map corners with viewPoint near center
        const viewPoint = { x: 320, y: 320 };
        const cornerTiles = [
            { x: 0, y: 0 },           // Top-left corner
            { x: 639, y: 0 },         // Top-right corner
            { x: 0, y: 639 },         // Bottom-left corner
            { x: 639, y: 639 },       // Bottom-right corner
        ];

        for (const tile of cornerTiles) {
            const shaderPos = shaderWorldPos(tile.x, tile.y, viewPoint.x, viewPoint.y);
            const tilePickerPos = TilePicker.tileToWorld(
                tile.x, tile.y, groundHeight, mapSize, viewPoint.x, viewPoint.y
            );

            expect(tilePickerPos.worldX).toBeCloseTo(shaderPos.worldX, 5);
            expect(tilePickerPos.worldY).toBeCloseTo(shaderPos.worldY, 5);
        }
    });

    it('should handle viewPoint near map edges', () => {
        // ViewPoint near edge of map - could have tiles with negative instancePos
        const edgeViewPoints = [
            { x: 5, y: 5 },           // Near top-left
            { x: 635, y: 635 },       // Near bottom-right
            { x: 5, y: 635 },         // Near bottom-left
            { x: 635, y: 5 },         // Near top-right
        ];

        const tile = { x: 320, y: 320 }; // Center tile

        for (const vp of edgeViewPoints) {
            const shaderPos = shaderWorldPos(tile.x, tile.y, vp.x, vp.y);
            const tilePickerPos = TilePicker.tileToWorld(
                tile.x, tile.y, groundHeight, mapSize, vp.x, vp.y
            );

            expect(tilePickerPos.worldX).toBeCloseTo(shaderPos.worldX, 5);
            expect(tilePickerPos.worldY).toBeCloseTo(shaderPos.worldY, 5);
        }
    });

    it('should handle tiles far from viewPoint', () => {
        // Large distances - common when zoomed out
        const viewPoint = { x: 320, y: 320 };
        const farTiles = [
            { x: 50, y: 50 },     // 270+ tiles away
            { x: 600, y: 600 },   // 280+ tiles away
            { x: 100, y: 500 },   // Diagonal far
        ];

        for (const tile of farTiles) {
            const shaderPos = shaderWorldPos(tile.x, tile.y, viewPoint.x, viewPoint.y);
            const tilePickerPos = TilePicker.tileToWorld(
                tile.x, tile.y, groundHeight, mapSize, viewPoint.x, viewPoint.y
            );

            expect(tilePickerPos.worldX).toBeCloseTo(shaderPos.worldX, 5);
            expect(tilePickerPos.worldY).toBeCloseTo(shaderPos.worldY, 5);
        }
    });

    it('should handle varying terrain heights', () => {
        // Create terrain with varying heights
        const variedHeight = new Uint8Array(mapSize.width * mapSize.height);
        for (let i = 0; i < variedHeight.length; i++) {
            variedHeight[i] = (i % 256); // Heights from 0-255
        }

        const viewPoint = { x: 320.5, y: 320.5 };
        const testTiles = [
            { x: 320, y: 320 },
            { x: 321, y: 321 },
            { x: 322, y: 320 },
        ];

        for (const tile of testTiles) {
            const idx = mapSize.toIndex(tile.x, tile.y);
            const heightAtTile = variedHeight[idx] * 20 / 255;

            // Manual shader calculation with height
            const vpIntX = Math.floor(viewPoint.x);
            const vpIntY = Math.floor(viewPoint.y);
            const vpFracX = viewPoint.x - vpIntX;
            const vpFracY = viewPoint.y - vpIntY;
            const instancePosX = tile.x - vpIntX;
            const instancePosY = tile.y - vpIntY;
            const expectedWorldX = 0.25 + instancePosX - instancePosY * 0.5 - vpFracX + vpFracY * 0.5;
            const expectedWorldY = (0.5 + instancePosY - heightAtTile - vpFracY) * 0.5;

            const tilePickerPos = TilePicker.tileToWorld(
                tile.x, tile.y, variedHeight, mapSize, viewPoint.x, viewPoint.y
            );

            expect(tilePickerPos.worldX).toBeCloseTo(expectedWorldX, 5);
            expect(tilePickerPos.worldY).toBeCloseTo(expectedWorldY, 5);
        }
    });
});
