/**
 * SpatialGrid — spatial hash with territory-aware cell states.
 *
 * Provides fast spatial + territory queries for map objects and stacked piles.
 * Cell size is 2^cellShift (default 16). Each cell tracks territory ownership
 * so queries can skip entire cells that belong to other players.
 *
 * Entity lifecycle: add(id, x, y) / remove(id). No move support needed —
 * trees, stones, crops, and piles don't move.
 *
 * Territory lifecycle: onTileOwnerChanged (pioneer claims), classifyCells
 * (tower build/destroy), rebuildAllCells (game load).
 */

import type { Entity, Tile } from './entity';

// ── Cell ownership ──────────────────────────────────────────────

export const enum CellOwnership {
    /** All tiles in cell are unclaimed */
    UNCLAIMED,
    /** All tiles owned by one player — skip per-entity getOwner */
    FULL,
    /** Mixed ownership — per-entity getOwner fallback required */
    BORDER,
}

interface CellState {
    ownership: CellOwnership;
    player: number; // sole/dominant owner (-1 for UNCLAIMED)
}

// ── SpatialGrid ─────────────────────────────────────────────────

export class SpatialGrid {
    private readonly cellShift: number;
    private readonly cellSize: number;
    private readonly maxCols: number;
    private readonly maxRows: number;
    private readonly mapWidth: number;
    private readonly mapHeight: number;
    private readonly resolve: (id: number) => Entity | undefined;
    private readonly getOwner: (tile: Tile) => number;

    /** cellKey → entity IDs in that cell */
    private readonly cells = new Map<number, Set<number>>();
    /** entityId → its cellKey (for remove) */
    private readonly entityCell = new Map<number, number>();

    /** Territory state per cell */
    private readonly cellState = new Map<number, CellState>();
    /** player → all cellKeys relevant to them (FULL + BORDER) */
    private readonly playerCells = new Map<number, Set<number>>();

    constructor(
        mapWidth: number,
        mapHeight: number,
        cellShift: number,
        resolve: (id: number) => Entity | undefined,
        getOwner: (tile: Tile) => number
    ) {
        this.mapWidth = mapWidth;
        this.mapHeight = mapHeight;
        this.cellShift = cellShift;
        this.cellSize = 1 << cellShift;
        this.maxCols = (mapWidth + this.cellSize - 1) >> cellShift;
        this.maxRows = (mapHeight + this.cellSize - 1) >> cellShift;
        this.resolve = resolve;
        this.getOwner = getOwner;
    }

    // ── Cell key ────────────────────────────────────────────────

    private cellKey(tile: Tile): number {
        return (tile.y >> this.cellShift) * this.maxCols + (tile.x >> this.cellShift);
    }

    // ── Entity lifecycle ────────────────────────────────────────

    add(entityId: number, tile: Tile): void {
        const ck = this.cellKey(tile);
        let set = this.cells.get(ck);
        if (!set) {
            set = new Set();
            this.cells.set(ck, set);
        }
        set.add(entityId);
        this.entityCell.set(entityId, ck);
    }

    remove(entityId: number): void {
        const ck = this.entityCell.get(entityId);
        if (ck === undefined) {
            return;
        }
        this.entityCell.delete(entityId);
        const set = this.cells.get(ck);
        if (set) {
            set.delete(entityId);
            if (set.size === 0) {
                this.cells.delete(ck);
            }
        }
    }

    // ── Queries ─────────────────────────────────────────────────

    /** Compute cell-coordinate range for a radius around center. */
    private cellRange(center: Tile, radius: number) {
        const shift = this.cellShift;
        return {
            minCol: Math.max(0, (center.x - radius) >> shift),
            maxCol: Math.min(this.maxCols - 1, (center.x + radius) >> shift),
            minRow: Math.max(0, (center.y - radius) >> shift),
            maxRow: Math.min(this.maxRows - 1, (center.y + radius) >> shift),
        };
    }

    /** Resolve all entities in a cell set. */
    private *yieldCell(set: Set<number>): IterableIterator<Entity> {
        for (const id of set) {
            const entity = this.resolve(id);
            if (entity) {
                yield entity;
            }
        }
    }

    /** Resolve entities in a cell set that are in a specific player's territory. */
    private *yieldCellForPlayer(set: Set<number>, player: number): IterableIterator<Entity> {
        for (const id of set) {
            const entity = this.resolve(id);
            if (entity && this.getOwner(entity) === player) {
                yield entity;
            }
        }
    }

    /** Iterate all entities within radius — no ownership filter. */
    *nearby(center: Tile, radius: number): IterableIterator<Entity> {
        const { minCol, maxCol, minRow, maxRow } = this.cellRange(center, radius);

        for (let row = minRow; row <= maxRow; row++) {
            for (let col = minCol; col <= maxCol; col++) {
                const set = this.cells.get(row * this.maxCols + col);
                if (set) {
                    yield* this.yieldCell(set);
                }
            }
        }
    }

    /** Yield entities from a single cell that belong to a player's territory. */
    private *yieldOwnedCell(ck: number, player: number): IterableIterator<Entity> {
        const set = this.cells.get(ck);
        if (!set) {
            return;
        }
        const state = this.cellState.get(ck);
        if (!state) {
            return;
        }

        if (state.ownership === CellOwnership.FULL && state.player === player) {
            yield* this.yieldCell(set);
        } else if (state.ownership === CellOwnership.BORDER) {
            yield* this.yieldCellForPlayer(set, player);
        }
    }

    /** Iterate entities within radius that belong to a specific player's territory. */
    *nearbyForPlayer(center: Tile, radius: number, player: number): IterableIterator<Entity> {
        const { minCol, maxCol, minRow, maxRow } = this.cellRange(center, radius);
        const owned = this.playerCells.get(player);
        if (!owned) {
            return;
        }

        for (let row = minRow; row <= maxRow; row++) {
            for (let col = minCol; col <= maxCol; col++) {
                const ck = row * this.maxCols + col;
                if (owned.has(ck)) {
                    yield* this.yieldOwnedCell(ck, player);
                }
            }
        }
    }

    // ── Territory updates ───────────────────────────────────────

    /** Called when a single tile changes ownership (pioneer expansion). */
    onTileOwnerChanged(tile: Tile, oldOwner: number, newOwner: number): void {
        const ck = this.cellKey(tile);
        const state = this.cellState.get(ck);

        if (!state || state.ownership === CellOwnership.UNCLAIMED) {
            // First tile claimed in this cell → becomes BORDER
            this.cellState.set(ck, { ownership: CellOwnership.BORDER, player: newOwner });
            this.addPlayerCell(newOwner, ck);
        } else if (state.ownership === CellOwnership.FULL) {
            if (state.player === newOwner) {
                // Already fully owned by same player — no-op
                return;
            }
            // Was fully owned by another player, now mixed
            state.ownership = CellOwnership.BORDER;
            this.addPlayerCell(newOwner, ck);
        } else {
            // BORDER — another tile changed
            this.addPlayerCell(newOwner, ck);
            if (oldOwner >= 0 && oldOwner !== newOwner) {
                // Old owner might still have tiles — keep in playerCells
                // (classifyCell would clean it up, but that's expensive per-tile)
            }
            this.maybePromoteCell(ck);
        }
    }

    /** Classify all cells overlapping a rectangular region (after tower build/destroy). */
    classifyCells(x1: number, y1: number, x2: number, y2: number): void {
        const shift = this.cellShift;
        const minCX = Math.max(0, x1 >> shift);
        const maxCX = Math.min(this.maxCols - 1, x2 >> shift);
        const minCY = Math.max(0, y1 >> shift);
        const maxCY = Math.min(this.maxRows - 1, y2 >> shift);

        for (let row = minCY; row <= maxCY; row++) {
            for (let col = minCX; col <= maxCX; col++) {
                this.classifyCell(row * this.maxCols + col, col, row);
            }
        }
    }

    /** Full rebuild of all cell states (game load, map init). */
    rebuildAllCells(): void {
        this.cellState.clear();
        this.playerCells.clear();
        for (let row = 0; row < this.maxRows; row++) {
            for (let col = 0; col < this.maxCols; col++) {
                this.classifyCell(row * this.maxCols + col, col, row);
            }
        }
    }

    // ── Private helpers ─────────────────────────────────────────

    private addPlayerCell(player: number, ck: number): void {
        let set = this.playerCells.get(player);
        if (!set) {
            set = new Set();
            this.playerCells.set(player, set);
        }
        set.add(ck);
    }

    /** Check if a BORDER cell can be promoted to FULL. */
    private maybePromoteCell(ck: number): void {
        const col = ck % this.maxCols;
        const row = (ck - col) / this.maxCols;
        this.classifyCell(ck, col, row);
    }

    /** Classify a single cell by scanning all its tiles. */
    private classifyCell(ck: number, col: number, row: number): void {
        const startX = col << this.cellShift;
        const startY = row << this.cellShift;
        const endX = Math.min(startX + this.cellSize, this.mapWidth);
        const endY = Math.min(startY + this.cellSize, this.mapHeight);

        // Remove this cell from all players first
        for (const [, pSet] of this.playerCells) {
            pSet.delete(ck);
        }

        const owners = new Set<number>();
        for (let y = startY; y < endY; y++) {
            for (let x = startX; x < endX; x++) {
                owners.add(this.getOwner({ x, y }));
            }
        }

        // Remove -1 (unclaimed) from the set for player analysis
        const hasUnclaimed = owners.has(-1);
        owners.delete(-1);

        if (owners.size === 0) {
            // All unclaimed
            this.cellState.set(ck, { ownership: CellOwnership.UNCLAIMED, player: -1 });
        } else if (owners.size === 1 && !hasUnclaimed) {
            // Fully owned by one player
            const player = owners.values().next().value!;
            this.cellState.set(ck, { ownership: CellOwnership.FULL, player });
            this.addPlayerCell(player, ck);
        } else {
            // Mixed — BORDER for each player present
            const dominantPlayer = owners.values().next().value!;
            this.cellState.set(ck, { ownership: CellOwnership.BORDER, player: dominantPlayer });
            for (const player of owners) {
                this.addPlayerCell(player, ck);
            }
        }
    }
}
