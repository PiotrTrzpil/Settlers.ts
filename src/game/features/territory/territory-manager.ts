/**
 * Territory Manager
 *
 * Computes and maintains territory zones created by towers and castles.
 * Provides O(1) territory ownership queries and boundary dot positions for rendering.
 *
 * Territory is recomputed lazily — only when queried after a building change.
 */

import { GRID_DELTA_X, GRID_DELTA_Y, NUMBER_OF_DIRECTIONS } from '../../systems/hex-directions';
import { TERRITORY_RADIUS, type TerritoryDot } from './territory-types';
import type { BuildingType } from '../../buildings/types';

// ── Screen-space thinning for boundary dots ──────────────────────────

/** Minimum screen-space distance² between accepted dots */
const MIN_DIST_SQ = 1.05;
const CELL_SIZE = 1.0;

function spatialCellKey(cx: number, cy: number): number {
    return cx * 100003 + cy;
}

/** Check if a screen-space point is too close to any already-accepted dot. */
function isTooClose(
    sx: number,
    sy: number,
    cx: number,
    cy: number,
    grid: Map<number, { sx: number; sy: number }[]>
): boolean {
    for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
            const bucket = grid.get(spatialCellKey(cx + dx, cy + dy));
            if (!bucket) continue;
            for (const p of bucket) {
                const dsx = sx - p.sx;
                const dsy = sy - p.sy;
                if (dsx * dsx + dsy * dsy < MIN_DIST_SQ) return true;
            }
        }
    }
    return false;
}

/**
 * Thin boundary dots in screen space so they form a single visual line.
 * Tile (x,y) → screen (x - y*0.5, y*0.5). Uses a spatial hash to skip
 * dots that are too close to an already-accepted dot.
 */
function thinDotsInScreenSpace(raw: TerritoryDot[]): TerritoryDot[] {
    const accepted: TerritoryDot[] = [];
    const grid = new Map<number, { sx: number; sy: number }[]>();

    for (const dot of raw) {
        const sx = dot.x - dot.y * 0.5;
        const sy = dot.y * 0.5;
        const cx = Math.floor(sx / CELL_SIZE);
        const cy = Math.floor(sy / CELL_SIZE);

        if (isTooClose(sx, sy, cx, cy, grid)) continue;

        accepted.push(dot);
        const key = spatialCellKey(cx, cy);
        let bucket = grid.get(key);
        if (!bucket) {
            bucket = [];
            grid.set(key, bucket);
        }
        bucket.push({ sx, sy });
    }

    return accepted;
}

// ── Types ────────────────────────────────────────────────────────────

/** Internal record for a territory-generating building */
interface TerritoryBuilding {
    readonly x: number;
    readonly y: number;
    readonly player: number;
    readonly radius: number;
}

/**
 * Manages territory zones created by towers and castles.
 *
 * The territory grid stores player ownership per tile (0 = unclaimed, N = player N+1).
 * Boundary dots are the subset of territory tiles that have at least one
 * non-owned neighbor, spaced out to avoid excessive rendering.
 */
export class TerritoryManager {
    /** Per-tile ownership: 0 = unclaimed, value = playerId + 1 */
    private readonly territoryGrid: Uint8Array;
    private readonly mapWidth: number;
    private readonly mapHeight: number;

    /** Cached boundary dots for rendering */
    private cachedBoundaryDots: TerritoryDot[] = [];

    /** Whether the grid needs recomputation */
    private dirty = true;

    /** Territory-generating buildings indexed by entity ID */
    private readonly buildings = new Map<number, TerritoryBuilding>();

    constructor(mapWidth: number, mapHeight: number) {
        this.mapWidth = mapWidth;
        this.mapHeight = mapHeight;
        this.territoryGrid = new Uint8Array(mapWidth * mapHeight);
    }

    // ─────────────────────────────────────────────────────────────
    // Building Registration
    // ─────────────────────────────────────────────────────────────

    /** Register a territory-generating building */
    addBuilding(entityId: number, x: number, y: number, player: number, buildingType: BuildingType): void {
        const radius = TERRITORY_RADIUS[buildingType];
        if (radius === undefined) return;

        this.buildings.set(entityId, { x, y, player, radius });
        this.dirty = true;
    }

    /** Remove a territory-generating building */
    removeBuilding(entityId: number): boolean {
        if (this.buildings.delete(entityId)) {
            this.dirty = true;
            return true;
        }
        return false;
    }

    /** Number of registered territory buildings */
    get buildingCount(): number {
        return this.buildings.size;
    }

    // ─────────────────────────────────────────────────────────────
    // Queries
    // ─────────────────────────────────────────────────────────────

    /** Check if a tile is within a specific player's territory */
    isInTerritory(x: number, y: number, player: number): boolean {
        this.recomputeIfDirty();
        if (x < 0 || y < 0 || x >= this.mapWidth || y >= this.mapHeight) return false;
        return this.territoryGrid[y * this.mapWidth + x] === player + 1;
    }

    /** Check if a tile is within any player's territory */
    isInAnyTerritory(x: number, y: number): boolean {
        this.recomputeIfDirty();
        if (x < 0 || y < 0 || x >= this.mapWidth || y >= this.mapHeight) return false;
        return this.territoryGrid[y * this.mapWidth + x] !== 0;
    }

    /** Get the owning player of a tile (-1 if unclaimed) */
    getOwner(x: number, y: number): number {
        this.recomputeIfDirty();
        if (x < 0 || y < 0 || x >= this.mapWidth || y >= this.mapHeight) return -1;
        const value = this.territoryGrid[y * this.mapWidth + x]!;
        return value === 0 ? -1 : value - 1;
    }

    /** Get boundary dots for rendering (cached, recomputed when dirty) */
    getBoundaryDots(): readonly TerritoryDot[] {
        this.recomputeIfDirty();
        return this.cachedBoundaryDots;
    }

    // ─────────────────────────────────────────────────────────────
    // Recomputation
    // ─────────────────────────────────────────────────────────────

    private recomputeIfDirty(): void {
        if (!this.dirty) return;
        this.dirty = false;
        this.recompute();
    }

    private recompute(): void {
        // Clear grid
        this.territoryGrid.fill(0);

        // Fill territory circles for each building
        for (const building of this.buildings.values()) {
            this.fillCircle(building.x, building.y, building.radius, building.player + 1);
        }

        // Compute boundary dots
        this.cachedBoundaryDots = this.computeBoundaryDots();
    }

    /**
     * Fill a territory zone that appears as a wide ellipse on screen.
     *
     * The isometric tile-to-screen transform is:
     *   screenX = dx - dy * 0.5
     *   screenY = dy * 0.5
     *
     * We squash the vertical axis by 0.7 to produce a flatter ellipse
     * that better matches the isometric perspective.
     */
    private fillCircle(cx: number, cy: number, radius: number, ownerValue: number): void {
        const screenR = radius * 0.5;
        const rSq = screenR * screenR;
        // Vertical squash: multiply sy² by (1/0.7)² ≈ 2.04 to shrink the shape 30% vertically
        const yScale = 1.0 / 0.7;

        // Generous tile-space bounding box (screen circle can extend ~radius in any tile axis)
        const minY = Math.max(0, cy - radius);
        const maxY = Math.min(this.mapHeight - 1, cy + radius);
        const minX = Math.max(0, cx - radius);
        const maxX = Math.min(this.mapWidth - 1, cx + radius);

        for (let y = minY; y <= maxY; y++) {
            const dy = y - cy;
            const sy = dy * 0.5;
            const rowOffset = y * this.mapWidth;
            for (let x = minX; x <= maxX; x++) {
                const dx = x - cx;
                const sx = dx - dy * 0.5;
                const scaledSy = sy * yScale;
                if (sx * sx + scaledSy * scaledSy <= rSq) {
                    this.territoryGrid[rowOffset + x] = ownerValue;
                }
            }
        }
    }

    /**
     * Find boundary tiles and thin them so dots form a single visual line.
     *
     * Raw boundary detection (owned tile with a non-owned hex neighbor) can produce
     * bands 2-3 tiles thick on edges where the screen-space circle cuts across
     * the hex grid at a shallow angle.  We thin by converting each candidate to
     * screen-space coordinates and skipping any dot that's too close to an
     * already-accepted dot.  A spatial hash makes the proximity check O(1).
     */
    private computeBoundaryDots(): TerritoryDot[] {
        const raw = this.collectRawBoundary();
        return thinDotsInScreenSpace(raw);
    }

    /** Collect all tiles that are owned and have at least one non-owned hex neighbor. */
    private collectRawBoundary(): TerritoryDot[] {
        const dots: TerritoryDot[] = [];
        const w = this.mapWidth;
        const h = this.mapHeight;

        for (let y = 0; y < h; y++) {
            const rowOffset = y * w;
            for (let x = 0; x < w; x++) {
                const owner = this.territoryGrid[rowOffset + x]!;
                if (owner === 0) continue;
                if (this.isBoundaryTile(x, y, owner)) {
                    dots.push({ x, y, player: owner - 1 });
                }
            }
        }
        return dots;
    }

    /** Check if a territory tile has at least one non-owned hex neighbor */
    private isBoundaryTile(x: number, y: number, owner: number): boolean {
        for (let d = 0; d < NUMBER_OF_DIRECTIONS; d++) {
            const nx = x + GRID_DELTA_X[d]!;
            const ny = y + GRID_DELTA_Y[d]!;

            // Map edge counts as boundary
            if (nx < 0 || ny < 0 || nx >= this.mapWidth || ny >= this.mapHeight) return true;

            if (this.territoryGrid[ny * this.mapWidth + nx] !== owner) return true;
        }
        return false;
    }
}
