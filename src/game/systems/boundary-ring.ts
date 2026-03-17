/**
 * Isometric Boundary Ring — Even-Spacing Algorithm
 *
 * Shared algorithm for thinning raw boundary tiles into evenly-spaced dot rings.
 * Used by both territory rendering and work area visualization.
 *
 * Algorithm:
 *   1. Project tiles to screen space (isometric transform, 0.7 vertical squash).
 *   2. Group by player, then angular-bin each group from its centroid —
 *      divides 360° into equal slices and keeps one dot per slice.
 *   3. Distance prune across all players to clean up inter-player overlaps.
 *
 * The angular binning approach guarantees uniform spacing around the boundary
 * regardless of how the hex grid aligns with the isometric ellipse.
 */

// ── Isometric projection ──────────────────────────────────────────────

/** Vertical squash to match isometric perspective (tiles appear 30% shorter vertically). */
const Y_SCALE = 1.0 / 0.7;

/** Squared isometric distance from center for a tile offset (dx, dy). */
export function isoDistSq(dx: number, dy: number): number {
    const sx = dx - dy * 0.5;
    const sy = dy * 0.5 * Y_SCALE;
    return sx * sx + sy * sy;
}

/** Check if a tile offset (dx, dy) from center is inside the isometric ellipse. */
export function isInsideIsoEllipse(dx: number, dy: number, rSq: number): boolean {
    return isoDistSq(dx, dy) <= rSq;
}

// ── Types ─────────────────────────────────────────────────────────────

/** Minimum dot type — both TerritoryDot and WorkAreaDot satisfy this. */
export interface BoundaryDot {
    readonly x: number;
    readonly y: number;
    readonly player: number;
}

interface ScreenDot<T> {
    readonly dot: T;
    readonly sx: number;
    readonly sy: number;
}

// ── Angular binning ──────────────────────────────────────────────────

const DEFAULT_MIN_SPACING = 1.2;

/**
 * Angular bin: divide 360° around the group centroid into equal slices
 * and keep only the best candidate per slice (closest to average boundary distance).
 */
function angularBin<T>(items: ScreenDot<T>[], minSpacing: number): ScreenDot<T>[] {
    if (items.length <= 1) {
        return items;
    }

    // Centroid
    let cx = 0;
    let cy = 0;
    for (const p of items) {
        cx += p.sx;
        cy += p.sy;
    }
    cx /= items.length;
    cy /= items.length;

    // Angle + distance from centroid
    let totalDist = 0;
    const withMeta = items.map(p => {
        const angle = Math.atan2(p.sy - cy, p.sx - cx);
        const dist = Math.hypot(p.sx - cx, p.sy - cy);
        totalDist += dist;
        return { sd: p, angle, dist };
    });

    // Estimate perimeter → number of angular bins
    const avgDist = totalDist / withMeta.length;
    const perimeter = 2 * Math.PI * avgDist;
    const numBins = Math.max(8, Math.round(perimeter / minSpacing));
    const binSize = (2 * Math.PI) / numBins;

    // Keep the dot closest to average distance in each angular bin
    const bins = new Map<number, (typeof withMeta)[0]>();
    for (const p of withMeta) {
        const idx = Math.floor((p.angle + Math.PI) / binSize);
        const existing = bins.get(idx);
        if (!existing || Math.abs(p.dist - avgDist) < Math.abs(existing.dist - avgDist)) {
            bins.set(idx, p);
        }
    }

    return Array.from(bins.values()).map(b => b.sd);
}

// ── Distance pruning ─────────────────────────────────────────────────

function hashKey(cx: number, cy: number): number {
    return cx * 100003 + cy;
}

/** Check if a bucket has a same-player dot within minDistSq of the candidate. */
function bucketHasNearby<T extends BoundaryDot>(sd: ScreenDot<T>, bucket: ScreenDot<T>[], minDistSq: number): boolean {
    for (const p of bucket) {
        if (p.dot.player !== sd.dot.player) {
            continue;
        }
        const dsx = sd.sx - p.sx;
        const dsy = sd.sy - p.sy;
        if (dsx * dsx + dsy * dsy < minDistSq) {
            return true;
        }
    }
    return false;
}

/**
 * Check if a screen-space point is too close to a same-player already-accepted dot.
 * Cross-player dots are allowed to coexist so both boundaries remain visible.
 */
function hasNearby<T extends BoundaryDot>(
    sd: ScreenDot<T>,
    hash: Map<number, ScreenDot<T>[]>,
    minDistSq: number
): boolean {
    const hx = Math.floor(sd.sx);
    const hy = Math.floor(sd.sy);
    for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
            const bucket = hash.get(hashKey(hx + dx, hy + dy));
            if (bucket && bucketHasNearby(sd, bucket, minDistSq)) {
                return true;
            }
        }
    }
    return false;
}

/**
 * Remove dots that are too close to an already-accepted same-player neighbor.
 * Cross-player dots coexist; visual separation is handled by inward offsets.
 */
function distancePrune<T extends BoundaryDot>(candidates: ScreenDot<T>[], minDistSq: number): T[] {
    const accepted: T[] = [];
    const hash = new Map<number, ScreenDot<T>[]>();

    for (const sd of candidates) {
        if (hasNearby(sd, hash, minDistSq)) {
            continue;
        }

        accepted.push(sd.dot);
        const hKey = hashKey(Math.floor(sd.sx), Math.floor(sd.sy));
        let bucket = hash.get(hKey);
        if (!bucket) {
            bucket = [];
            hash.set(hKey, bucket);
        }
        bucket.push(sd);
    }

    return accepted;
}

// ── Public API ────────────────────────────────────────────────────────

/**
 * Thin boundary dots to evenly-spaced positions.
 *
 * Two-phase approach:
 *   1. **Angular binning** — group dots by player, compute centroid per group,
 *      divide 360° into equal angular slices, keep one dot per slice (the one
 *      closest to the average boundary distance). Guarantees uniform angular
 *      spacing around the boundary.
 *   2. **Distance prune** — reject any dot too close to an already-accepted dot
 *      (handles inter-player boundary overlaps).
 *
 * @param minSpacing - Desired screen-space distance between dots.
 */
export function thinDotsInScreenSpace<T extends BoundaryDot>(raw: T[], minSpacing = DEFAULT_MIN_SPACING): T[] {
    if (raw.length <= 1) {
        return [...raw];
    }

    // Project to screen space
    const projected: ScreenDot<T>[] = raw.map(dot => ({
        dot,
        sx: dot.x - dot.y * 0.5,
        sy: dot.y * 0.5,
    }));

    // Group by player for independent angular binning
    const byPlayer = new Map<number, ScreenDot<T>[]>();
    for (const sd of projected) {
        let group = byPlayer.get(sd.dot.player);
        if (!group) {
            group = [];
            byPlayer.set(sd.dot.player, group);
        }
        group.push(sd);
    }

    const binned: ScreenDot<T>[] = [];
    for (const group of byPlayer.values()) {
        binned.push(...angularBin(group, minSpacing));
    }

    // Final distance prune for inter-player overlap
    const minDistSq = minSpacing * minSpacing;
    return distancePrune(binned, minDistSq);
}
