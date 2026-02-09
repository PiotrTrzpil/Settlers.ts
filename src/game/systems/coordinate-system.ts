/**
 * Coordinate System for the Isometric Tile Engine
 *
 * This module contains all coordinate transformation math.
 * All functions are pure and stateless.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * COORDINATE SPACES
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * 1. SCREEN SPACE (screenX, screenY)
 *    - Canvas pixel coordinates
 *    - Origin: top-left corner
 *    - Range: [0, canvasWidth) × [0, canvasHeight)
 *
 * 2. NDC SPACE (ndcX, ndcY)
 *    - Normalized Device Coordinates
 *    - Range: [-1, 1] × [-1, 1]
 *    - Center: (0, 0)
 *
 * 3. WORLD SPACE (worldX, worldY)
 *    - Camera-relative rendering coordinates
 *    - Used by the projection matrix
 *    - Smaller worldY = higher on screen
 *
 * 4. TILE SPACE (tileX, tileY)
 *    - Integer grid positions on the map
 *    - Range: [0, mapWidth) × [0, mapHeight)
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * TILE PARALLELOGRAM (from landscape-vert.glsl)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 *        (0,0)      (1,0)
 *         0 ────────── 5
 *        / \    B    /
 *       /   A  \   /
 *      /────────\/
 *     1         2
 * (-0.5,1)   (0.5,1)
 *
 *   Parallelogram center: (0.25, 0.5)
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * TRANSFORM FORMULAS
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Forward (tile → world):
 *   instanceX = tileX - vpIntX
 *   instanceY = tileY - vpIntY
 *   worldX = 0.25 + instanceX - instanceY * 0.5 - vpFracX + vpFracY * 0.5
 *   worldY = (0.5 + instanceY - height - vpFracY) * 0.5
 *
 * Reverse (world → tile):
 *   instanceY = worldY * 2 - 0.5 + height + vpFracY
 *   instanceX = worldX - 0.25 + instanceY * 0.5 + vpFracX - vpFracY * 0.5
 *   tileX = round(instanceX + vpIntX)
 *   tileY = round(instanceY + vpIntY)
 *
 * These formulas MUST stay in sync with landscape-vert.glsl.
 */

// ═══════════════════════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Height scale factor.
 * Maps uint8 height [0, 255] to world-space [0, TILE_HEIGHT_SCALE].
 *
 * In GLSL: `texelFetch(...).r * 20.0` (GPU normalizes uint8 to [0,1])
 * In TypeScript: `h * 20.0 / 255.0`
 */
export const TILE_HEIGHT_SCALE = 20.0;

/** X offset to parallelogram center. */
export const TILE_CENTER_X = 0.25;

/** Y offset to parallelogram center. */
export const TILE_CENTER_Y = 0.5;

/** Maximum height refinement iterations for screen-to-tile conversion. */
export const MAX_HEIGHT_ITERATIONS = 5;

// ═══════════════════════════════════════════════════════════════════════════
// HEIGHT CONVERSION
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Convert raw uint8 height to world-space height.
 */
export function heightToWorld(h: number): number {
    return (h * TILE_HEIGHT_SCALE) / 255.0;
}

/**
 * Convert world-space height to raw uint8 height.
 */
export function worldToHeight(hWorld: number): number {
    return Math.round((hWorld * 255.0) / TILE_HEIGHT_SCALE);
}

// ═══════════════════════════════════════════════════════════════════════════
// VIEWPOINT HELPERS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Split a viewpoint coordinate into integer and fractional parts.
 * The integer part is used for tile lookups, the fractional for smooth scrolling.
 */
export function splitViewPoint(vp: number): { int: number; frac: number } {
    const int = Math.floor(vp);
    return { int, frac: vp - int };
}

// ═══════════════════════════════════════════════════════════════════════════
// SCREEN ↔ NDC CONVERSION
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Convert screen pixel coordinates to NDC.
 */
export function screenToNdc(
    screenX: number,
    screenY: number,
    canvasWidth: number,
    canvasHeight: number
): { ndcX: number; ndcY: number } {
    return {
        ndcX: (screenX / canvasWidth) * 2 - 1,
        ndcY: 1 - (screenY / canvasHeight) * 2,
    };
}

/**
 * Convert NDC to screen pixel coordinates.
 */
export function ndcToScreen(
    ndcX: number,
    ndcY: number,
    canvasWidth: number,
    canvasHeight: number
): { screenX: number; screenY: number } {
    return {
        screenX: ((ndcX + 1) / 2) * canvasWidth,
        screenY: ((1 - ndcY) / 2) * canvasHeight,
    };
}

// ═══════════════════════════════════════════════════════════════════════════
// NDC ↔ WORLD CONVERSION (Camera projection)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Convert NDC to world coordinates (reverse camera projection).
 *
 * Camera projection formula:
 *   ndcX = worldX * zoom / aspect - zoom
 *   ndcY = -worldY * zoom + zoom
 *
 * Reverse:
 *   worldX = (ndcX + zoom) * aspect / zoom
 *   worldY = (zoom - ndcY) / zoom
 */
export function ndcToWorld(
    ndcX: number,
    ndcY: number,
    zoom: number,
    aspect: number
): { worldX: number; worldY: number } {
    return {
        worldX: ((ndcX + zoom) * aspect) / zoom,
        worldY: (zoom - ndcY) / zoom,
    };
}

/**
 * Convert world coordinates to NDC (camera projection).
 */
export function worldToNdc(
    worldX: number,
    worldY: number,
    zoom: number,
    aspect: number
): { ndcX: number; ndcY: number } {
    return {
        ndcX: (worldX * zoom) / aspect - zoom,
        ndcY: -worldY * zoom + zoom,
    };
}

// ═══════════════════════════════════════════════════════════════════════════
// WORLD ↔ TILE CONVERSION (Isometric transform)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Convert tile coordinates to world position.
 * This is the canonical forward transform matching landscape-vert.glsl.
 */
export function tileToWorld(
    tileX: number,
    tileY: number,
    heightWorld: number,
    viewPointX: number,
    viewPointY: number
): { worldX: number; worldY: number } {
    const vpX = splitViewPoint(viewPointX);
    const vpY = splitViewPoint(viewPointY);

    const instanceX = tileX - vpX.int;
    const instanceY = tileY - vpY.int;

    return {
        worldX:
            TILE_CENTER_X +
            instanceX -
            instanceY * 0.5 -
            vpX.frac +
            vpY.frac * 0.5,
        worldY: (TILE_CENTER_Y + instanceY - heightWorld - vpY.frac) * 0.5,
    };
}

/**
 * Convert world position to tile coordinates (single iteration).
 * Returns fractional tile coordinates - caller should round.
 */
export function worldToTileFractional(
    worldX: number,
    worldY: number,
    heightWorld: number,
    viewPointX: number,
    viewPointY: number
): { tileX: number; tileY: number } {
    const vpX = splitViewPoint(viewPointX);
    const vpY = splitViewPoint(viewPointY);

    // Reverse the forward transform
    const instanceY = worldY * 2 - TILE_CENTER_Y + heightWorld + vpY.frac;
    const instanceX =
        worldX - TILE_CENTER_X + instanceY * 0.5 + vpX.frac - vpY.frac * 0.5;

    return {
        tileX: instanceX + vpX.int,
        tileY: instanceY + vpY.int,
    };
}

// ═══════════════════════════════════════════════════════════════════════════
// FULL SCREEN → TILE CONVERSION
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Parameters for screen-to-tile conversion.
 */
export interface ScreenToTileParams {
    screenX: number;
    screenY: number;
    canvasWidth: number;
    canvasHeight: number;
    zoom: number;
    viewPointX: number;
    viewPointY: number;
    mapWidth: number;
    mapHeight: number;
    groundHeight: Uint8Array;
}

/**
 * Convert screen coordinates to tile coordinates.
 *
 * Uses iterative height refinement: the initial estimate assumes height=0,
 * then each iteration refines using the actual terrain height.
 *
 * Returns null if the result is outside map bounds (should not happen
 * with clamping, but provides type safety).
 */
export function screenToTile(params: ScreenToTileParams): { x: number; y: number } | null {
    const {
        screenX,
        screenY,
        canvasWidth,
        canvasHeight,
        zoom,
        viewPointX,
        viewPointY,
        mapWidth,
        mapHeight,
        groundHeight,
    } = params;

    // Validate inputs
    if (canvasWidth <= 0 || canvasHeight <= 0 || zoom <= 0) {
        return null;
    }

    const aspect = canvasWidth / canvasHeight;

    // Screen → NDC → World
    const ndc = screenToNdc(screenX, screenY, canvasWidth, canvasHeight);
    const world = ndcToWorld(ndc.ndcX, ndc.ndcY, zoom, aspect);

    // Initial estimate with height = 0
    let tile = worldToTileFractional(
        world.worldX,
        world.worldY,
        0,
        viewPointX,
        viewPointY
    );

    let tileX = clamp(Math.round(tile.tileX), 0, mapWidth - 1);
    let tileY = clamp(Math.round(tile.tileY), 0, mapHeight - 1);

    // Iterative height refinement
    for (let iter = 0; iter < MAX_HEIGHT_ITERATIONS; iter++) {
        const idx = tileY * mapWidth + tileX;
        const h = groundHeight[idx];
        const hWorld = heightToWorld(h);

        tile = worldToTileFractional(
            world.worldX,
            world.worldY,
            hWorld,
            viewPointX,
            viewPointY
        );

        const newTileX = clamp(Math.round(tile.tileX), 0, mapWidth - 1);
        const newTileY = clamp(Math.round(tile.tileY), 0, mapHeight - 1);

        // Converged when tile doesn't change
        if (newTileX === tileX && newTileY === tileY) {
            break;
        }

        tileX = newTileX;
        tileY = newTileY;
    }

    return { x: tileX, y: tileY };
}

// ═══════════════════════════════════════════════════════════════════════════
// FULL TILE → SCREEN CONVERSION
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Parameters for tile-to-screen conversion.
 */
export interface TileToScreenParams {
    tileX: number;
    tileY: number;
    canvasWidth: number;
    canvasHeight: number;
    zoom: number;
    viewPointX: number;
    viewPointY: number;
    mapWidth: number;
    mapHeight: number;
    groundHeight: Uint8Array;
}

/**
 * Convert tile coordinates to screen coordinates.
 */
export function tileToScreen(params: TileToScreenParams): { screenX: number; screenY: number } {
    const {
        tileX,
        tileY,
        canvasWidth,
        canvasHeight,
        zoom,
        viewPointX,
        viewPointY,
        mapWidth,
        groundHeight,
    } = params;

    const aspect = canvasWidth / canvasHeight;

    // Get height at tile
    const idx = tileY * mapWidth + tileX;
    const hWorld = heightToWorld(groundHeight[idx]);

    // Tile → World → NDC → Screen
    const world = tileToWorld(tileX, tileY, hWorld, viewPointX, viewPointY);
    const ndc = worldToNdc(world.worldX, world.worldY, zoom, aspect);
    return ndcToScreen(ndc.ndcX, ndc.ndcY, canvasWidth, canvasHeight);
}

// ═══════════════════════════════════════════════════════════════════════════
// CONVENIENCE FUNCTIONS (for entity rendering)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Convert tile to world position, looking up height from the ground array.
 * This is the most common use case for entity rendering.
 */
export function tileToWorldPos(
    tileX: number,
    tileY: number,
    groundHeight: Uint8Array,
    mapWidth: number,
    mapHeight: number,
    viewPointX: number,
    viewPointY: number
): { worldX: number; worldY: number } {
    const idx = tileY * mapWidth + tileX;
    const h =
        tileX >= 0 && tileX < mapWidth && tileY >= 0 && tileY < mapHeight
            ? groundHeight[idx]
            : 0;
    const hWorld = heightToWorld(h);
    return tileToWorld(tileX, tileY, hWorld, viewPointX, viewPointY);
}

// ═══════════════════════════════════════════════════════════════════════════
// UTILITY
// ═══════════════════════════════════════════════════════════════════════════

function clamp(value: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, value));
}

// Legacy export for backwards compatibility
export const MAX_SCREEN_TO_TILE_ITERATIONS = MAX_HEIGHT_ITERATIONS;
