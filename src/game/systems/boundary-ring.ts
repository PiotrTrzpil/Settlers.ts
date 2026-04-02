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

// ── Spatial clustering ───────────────────────────────────────────

/** Gap threshold: dots further apart than this form separate clusters. */
const CLUSTER_GAP = 3;

/** Path-compressing find for union-find array. */
function ufFind(parent: Int32Array, i: number): number {
    while (parent[i] !== i) {
        parent[i] = parent[parent[i]!]!;
        i = parent[i]!;
    }
    return i;
}

/** Union two elements by root. */
function ufUnion(parent: Int32Array, a: number, b: number): void {
    const ra = ufFind(parent, a);
    const rb = ufFind(parent, b);
    if (ra !== rb) {
        parent[ra] = rb;
    }
}

/** Grid cell key for spatial hashing. */
function clusterCellKey(sx: number, sy: number): number {
    return Math.floor(sy / CLUSTER_GAP) * 100003 + Math.floor(sx / CLUSTER_GAP);
}

/**
 * Split dots into spatially connected clusters using a grid hash + union-find.
 * Dots in adjacent grid cells (gap ≤ CLUSTER_GAP) are merged into one cluster.
 * Separates isolated patches (captured footprints, pioneer expansions) from the
 * main territory so angular binning works per-cluster.
 */
function spatialClusters<T>(dots: ScreenDot<T>[]): ScreenDot<T>[][] {
    if (dots.length <= 1) {
        return [dots];
    }

    const parent = new Int32Array(dots.length);
    for (let i = 0; i < parent.length; i++) {
        parent[i] = i;
    }

    const cells = hashDotsIntoCells(dots, parent);
    mergeAdjacentCells(dots, cells, parent);
    return collectClusters(dots, parent);
}

/** Hash dots into grid cells, merging dots that land in the same cell. */
function hashDotsIntoCells<T>(dots: ScreenDot<T>[], parent: Int32Array): Map<number, number[]> {
    const cells = new Map<number, number[]>();
    for (let i = 0; i < dots.length; i++) {
        const key = clusterCellKey(dots[i]!.sx, dots[i]!.sy);
        let bucket = cells.get(key);
        if (!bucket) {
            bucket = [];
            cells.set(key, bucket);
        }
        if (bucket.length > 0) {
            ufUnion(parent, i, bucket[0]!);
        }
        bucket.push(i);
    }
    return cells;
}

/** Merge dots in neighboring grid cells (8-connected). */
function mergeAdjacentCells<T>(dots: ScreenDot<T>[], cells: Map<number, number[]>, parent: Int32Array): void {
    for (let i = 0; i < dots.length; i++) {
        const cx = Math.floor(dots[i]!.sx / CLUSTER_GAP);
        const cy = Math.floor(dots[i]!.sy / CLUSTER_GAP);
        for (let dy = -1; dy <= 1; dy++) {
            for (let dx = -1; dx <= 1; dx++) {
                if (dx === 0 && dy === 0) {
                    continue;
                }
                const neighbor = cells.get((cy + dy) * 100003 + (cx + dx));
                if (neighbor) {
                    ufUnion(parent, i, neighbor[0]!);
                }
            }
        }
    }
}

/** Group dots by their union-find root into separate cluster arrays. */
function collectClusters<T>(dots: ScreenDot<T>[], parent: Int32Array): ScreenDot<T>[][] {
    const clusterMap = new Map<number, ScreenDot<T>[]>();
    for (let i = 0; i < dots.length; i++) {
        const root = ufFind(parent, i);
        let cluster = clusterMap.get(root);
        if (!cluster) {
            cluster = [];
            clusterMap.set(root, cluster);
        }
        cluster.push(dots[i]!);
    }
    return Array.from(clusterMap.values());
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
 * Distance-prune within a single cluster, returning ScreenDots (not unwrapped).
 */
function distancePruneToScreenDots<T extends BoundaryDot>(
    candidates: ScreenDot<T>[],
    minDistSq: number
): ScreenDot<T>[] {
    if (minDistSq <= 0) {
        return candidates;
    }
    const accepted: ScreenDot<T>[] = [];
    const hash = new Map<number, ScreenDot<T>[]>();

    for (const sd of candidates) {
        if (hasNearby(sd, hash, minDistSq)) {
            continue;
        }
        accepted.push(sd);
        addToHash(hash, sd);
    }

    return accepted;
}

function addToHash<T>(hash: Map<number, ScreenDot<T>[]>, sd: ScreenDot<T>): void {
    const hKey = hashKey(Math.floor(sd.sx), Math.floor(sd.sy));
    let bucket = hash.get(hKey);
    if (!bucket) {
        bucket = [];
        hash.set(hKey, bucket);
    }
    bucket.push(sd);
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

    const byPlayer = projectAndGroupByPlayer(raw);

    // Angular-bin each spatial cluster independently so isolated patches
    // (e.g. captured tower footprints) aren't swallowed by a distant main territory.
    // Large clusters get distance-pruned to remove thick bands; small clusters
    // skip distance pruning since angular binning alone is sufficient.
    const result: T[] = [];
    for (const group of byPlayer.values()) {
        for (const cluster of spatialClusters(group)) {
            thinCluster(cluster, minSpacing, result);
        }
    }

    return result;
}

/** Project tiles to screen space and group by player. */
function projectAndGroupByPlayer<T extends BoundaryDot>(raw: T[]): Map<number, ScreenDot<T>[]> {
    const byPlayer = new Map<number, ScreenDot<T>[]>();
    for (const dot of raw) {
        const sd: ScreenDot<T> = { dot, sx: dot.x - dot.y * 0.5, sy: dot.y * 0.5 };
        let group = byPlayer.get(dot.player);
        if (!group) {
            group = [];
            byPlayer.set(dot.player, group);
        }
        group.push(sd);
    }
    return byPlayer;
}

/** Angular-bin and optionally distance-prune a single cluster, appending results. */
function thinCluster<T extends BoundaryDot>(cluster: ScreenDot<T>[], minSpacing: number, out: T[]): void {
    const SMALL_CLUSTER_THRESHOLD = 30;
    const binned = angularBin(cluster, minSpacing);
    if (cluster.length >= SMALL_CLUSTER_THRESHOLD) {
        const minDistSq = minSpacing * minSpacing;
        for (const sd of distancePruneToScreenDots(binned, minDistSq)) {
            out.push(sd.dot);
        }
    } else {
        for (const sd of binned) {
            out.push(sd.dot);
        }
    }
}
