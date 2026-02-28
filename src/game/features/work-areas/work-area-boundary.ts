/**
 * Work Area Boundary Computation
 *
 * Thin wrapper around the shared isometric boundary ring algorithm.
 * Computes boundary dots for a work area circle — uses the same
 * ellipse projection and screen-space thinning as the territory system.
 */

import { computeCircleBoundaryDots, type BoundaryDot } from '../../systems/boundary-ring';

export type WorkAreaDot = BoundaryDot;

/**
 * Compute boundary dot positions for a single work area circle.
 *
 * @param cx - Center X (tiles)
 * @param cy - Center Y (tiles)
 * @param radius - Radius in tiles (from XML workingAreaRadius)
 * @param player - Player index for dot coloring
 * @param mapWidth - Map width for bounds clamping
 * @param mapHeight - Map height for bounds clamping
 */
export function computeWorkAreaBoundaryDots(
    cx: number,
    cy: number,
    radius: number,
    player: number,
    mapWidth: number,
    mapHeight: number
): WorkAreaDot[] {
    return computeCircleBoundaryDots(cx, cy, radius, player, mapWidth, mapHeight);
}
