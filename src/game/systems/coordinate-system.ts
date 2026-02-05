/**
 * Shared coordinate system constants for the isometric tile engine.
 *
 * Coordinate system:
 * - World Y axis: smaller worldY = higher on screen, larger worldY = lower on screen
 * - Isometric grid: each tile row (tileY+1) shifts worldX by -0.5
 * - Height: higher terrain = smaller worldY = higher on screen
 *
 * Tile parallelogram (from landscape-vert.glsl):
 *
 *        (0,0)      (1,0)
 *         0 ---------- 5
 *        / \    B    /
 *       /   A  \   /
 *      /--------\/
 *     1 (-0.5,1)  2 (0.5,1)
 *
 *   Center: (0.25, 0.5)
 *
 * The formulas below MUST stay in sync with landscape-vert.glsl.
 */

/**
 * Maximum height range in world units.
 * Maps uint8 height [0, 255] to world-space [0, TILE_HEIGHT_SCALE].
 *
 * In GLSL: texelFetch(u_landHeightBuffer, ...).r * 20.0
 *   where .r is the uint8 value normalized to [0, 1] by the GPU.
 *
 * In TypeScript: h * TILE_HEIGHT_SCALE / 255.0
 *   where h is the raw uint8 value.
 */
export const TILE_HEIGHT_SCALE = 20.0;

/** X offset from tile origin to tile center in the parallelogram. */
export const TILE_CENTER_X = 0.25;

/** Y offset from tile origin to tile center in the parallelogram. */
export const TILE_CENTER_Y = 0.5;

/**
 * Convert a raw uint8 ground height to world-space height units.
 */
export function heightToWorld(h: number): number {
    return h * TILE_HEIGHT_SCALE / 255.0;
}

/**
 * Convert tile coordinates to world-space position.
 *
 * This is the canonical forward transform. It MUST match the landscape
 * vertex shader formula exactly (landscape-vert.glsl lines 172-178).
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
    const heightIndex = tileY * mapWidth + tileX;
    const h = (tileX >= 0 && tileX < mapWidth && tileY >= 0 && tileY < mapHeight)
        ? groundHeight[heightIndex]
        : 0;
    const hWorld = heightToWorld(h);

    const vpIntX = Math.floor(viewPointX);
    const vpIntY = Math.floor(viewPointY);
    const vpFracX = viewPointX - vpIntX;
    const vpFracY = viewPointY - vpIntY;

    const instancePosX = tileX - vpIntX;
    const instancePosY = tileY - vpIntY;

    const worldX = TILE_CENTER_X + instancePosX - instancePosY * 0.5 - vpFracX + vpFracY * 0.5;
    const worldY = (TILE_CENTER_Y + instancePosY - hWorld - vpFracY) * 0.5;

    return { worldX, worldY };
}

/**
 * Maximum number of height refinement iterations for screen-to-tile conversion.
 * On steep terrain, a single pass can pick the wrong tile because the initial
 * estimate ignores height. Each iteration refines the tile using the actual
 * height at the estimated position. 3 iterations converges on all practical terrain.
 */
export const MAX_SCREEN_TO_TILE_ITERATIONS = 3;
