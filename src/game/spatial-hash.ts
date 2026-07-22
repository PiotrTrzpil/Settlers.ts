/**
 * SpatialHash — lightweight entity-id spatial hash for mobile sets.
 *
 * Same cell model as SpatialGrid (power-of-two cellShift, range query over
 * overlapping cells) but:
 * - No territory ownership state
 * - No fixed map bounds (works before / without SpatialGrid)
 * - clear() for full rebuilds (entities that move every tick)
 * - Yields entity IDs; caller resolves entities
 *
 * Use SpatialGrid for static map objects (trees, stones, piles) + territory.
 * Use SpatialHash for frequently rebuilt query sets (e.g. idle carriers).
 */

import type { Tile } from './core/coordinates';

/** Default matches SpatialGrid's usual 16-tile cells (cellShift 4). */
const DEFAULT_CELL_SHIFT = 4;

export class SpatialHash {
    private readonly cellShift: number;
    readonly cellSize: number;

    /** cellKey → entity IDs in that cell */
    private readonly cells = new Map<number, number[]>();
    /** entityId → cellKey (for remove / replace) */
    private readonly entityCell = new Map<number, number>();

    constructor(cellShift: number = DEFAULT_CELL_SHIFT) {
        this.cellShift = cellShift;
        this.cellSize = 1 << cellShift;
    }

    get size(): number {
        return this.entityCell.size;
    }

    get isEmpty(): boolean {
        return this.entityCell.size === 0;
    }

    clear(): void {
        this.cells.clear();
        this.entityCell.clear();
    }

    /** Insert or re-bucket an entity at a tile. */
    add(entityId: number, tile: Tile): void {
        const prev = this.entityCell.get(entityId);
        const ck = this.cellKey(tile);
        if (prev === ck) {
            return;
        }
        if (prev !== undefined) {
            this.removeFromCell(prev, entityId);
        }
        let bucket = this.cells.get(ck);
        if (!bucket) {
            bucket = [];
            this.cells.set(ck, bucket);
        }
        bucket.push(entityId);
        this.entityCell.set(entityId, ck);
    }

    remove(entityId: number): void {
        const ck = this.entityCell.get(entityId);
        if (ck === undefined) {
            return;
        }
        this.entityCell.delete(entityId);
        this.removeFromCell(ck, entityId);
    }

    /**
     * Yield entity IDs in cells that may contain points within `radius` tiles
     * of center (axis-aligned cell range — same idea as SpatialGrid.nearby).
     * Caller must apply a precise distance filter.
     */
    *nearbyIds(center: Tile, radius: number): IterableIterator<number> {
        const shift = this.cellShift;
        const minCol = (center.x - radius) >> shift;
        const maxCol = (center.x + radius) >> shift;
        const minRow = (center.y - radius) >> shift;
        const maxRow = (center.y + radius) >> shift;

        for (let row = minRow; row <= maxRow; row++) {
            for (let col = minCol; col <= maxCol; col++) {
                const bucket = this.cells.get(this.pack(col, row));
                if (!bucket) {
                    continue;
                }
                for (const id of bucket) {
                    yield id;
                }
            }
        }
    }

    // ── Internal ────────────────────────────────────────────────

    private cellKey(tile: Tile): number {
        return this.pack(tile.x >> this.cellShift, tile.y >> this.cellShift);
    }

    /** Pack cell coords (supports large positive maps; same spirit as SpatialGrid keys). */
    private pack(cx: number, cy: number): number {
        // 16-bit each — fine for maps up to ~1M tiles per axis at cellShift 4
        return ((cy & 0xffff) << 16) | (cx & 0xffff);
    }

    private removeFromCell(ck: number, entityId: number): void {
        const bucket = this.cells.get(ck);
        if (!bucket) {
            return;
        }
        const idx = bucket.indexOf(entityId);
        if (idx !== -1) {
            bucket.splice(idx, 1);
        }
        if (bucket.length === 0) {
            this.cells.delete(ck);
        }
    }
}
