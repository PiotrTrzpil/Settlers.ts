/**
 * Travel cost — the single distance metric for logistics decisions.
 *
 * Supply ranking (fulfillment-matcher) and carrier ranking (carrier-assigner)
 * previously mixed hex distance with squared Euclidean distance, so the
 * top-N supply cutoff and the final carrier choice disagreed about geometry.
 * All logistics comparisons go through this function instead.
 *
 * Hex distance is the true walking metric on the hex grid. Costs are additive:
 * compare trips by summing leg costs.
 */

import { hexDistance } from '../../systems/hex-directions';

/** Walking cost between two tiles. Additive across legs. */
export function travelCost(ax: number, ay: number, bx: number, by: number): number {
    return hexDistance(ax, ay, bx, by);
}
