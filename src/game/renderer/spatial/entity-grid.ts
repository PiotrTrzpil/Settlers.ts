/**
 * EntityGrid - Spatial index for fast entity culling.
 *
 * Divides the map into a grid of cells. Each cell tracks which entities
 * are in it. Visibility queries return only entities in visible cells,
 * avoiding O(n) iteration over all entities.
 *
 * Key features:
 * 1. O(1) cell lookup based on tile coordinates
 * 2. O(visible_cells * avg_entities_per_cell) query complexity
 * 3. Automatic dirty tracking for incremental updates
 * 4. Thread-safe for read-only queries
 *
 * Usage:
 *   const grid = new EntityGrid(mapWidth, mapHeight, 32);
 *   grid.rebuild(entities);  // Initial build or after major changes
 *   grid.update(entity, oldX, oldY);  // Incremental update
 *   const visible = grid.queryVisible(tileBounds);
 */

import { Entity } from '../../entity';
import { Bounds } from '../frame-context';

// ═══════════════════════════════════════════════════════════════════════════
// CONFIGURATION
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Default cell size in tiles.
 * 32x32 is a good balance: not too many cells, not too many entities per cell.
 */
const DEFAULT_CELL_SIZE = 32;

// ═══════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════

/**
 * A single cell in the grid.
 */
interface GridCell {
    /** Entities currently in this cell */
    entities: Entity[];
    /** Whether this cell needs update */
    dirty: boolean;
}

/**
 * Statistics for debugging/profiling.
 */
export interface GridStats {
    cellCount: number;
    totalEntities: number;
    maxEntitiesPerCell: number;
    avgEntitiesPerCell: number;
    emptyCells: number;
    queriedCells: number;  // From last query
    returnedEntities: number;  // From last query
}

// ═══════════════════════════════════════════════════════════════════════════
// IMPLEMENTATION
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Spatial grid for fast entity lookups.
 */
export class EntityGrid {
    private readonly cellSize: number;
    private readonly gridWidth: number;
    private readonly gridHeight: number;
    private readonly cells: GridCell[];

    // Entity position tracking for efficient updates
    private readonly entityCells: Map<number, number>;  // entityId -> cellIndex

    // Last query stats
    private lastQueryCells = 0;
    private lastQueryEntities = 0;

    /**
     * Create a new entity grid.
     *
     * @param mapWidth Map width in tiles
     * @param mapHeight Map height in tiles
     * @param cellSize Cell size in tiles (default 32)
     */
    constructor(mapWidth: number, mapHeight: number, cellSize = DEFAULT_CELL_SIZE) {
        this.cellSize = cellSize;
        this.gridWidth = Math.ceil(mapWidth / cellSize);
        this.gridHeight = Math.ceil(mapHeight / cellSize);

        // Initialize cells
        const cellCount = this.gridWidth * this.gridHeight;
        this.cells = new Array(cellCount);
        for (let i = 0; i < cellCount; i++) {
            this.cells[i] = { entities: [], dirty: false };
        }

        this.entityCells = new Map();
    }

    /**
     * Get the cell index for a tile coordinate.
     */
    private getCellIndex(tileX: number, tileY: number): number {
        const cellX = Math.floor(tileX / this.cellSize);
        const cellY = Math.floor(tileY / this.cellSize);

        // Clamp to grid bounds
        const clampedX = Math.max(0, Math.min(cellX, this.gridWidth - 1));
        const clampedY = Math.max(0, Math.min(cellY, this.gridHeight - 1));

        return clampedY * this.gridWidth + clampedX;
    }

    /**
     * Rebuild the entire grid from a list of entities.
     * Call this on initial load or after major changes.
     */
    public rebuild(entities: Entity[]): void {
        // Clear all cells
        for (const cell of this.cells) {
            cell.entities.length = 0;
            cell.dirty = false;
        }
        this.entityCells.clear();

        // Add all entities
        for (const entity of entities) {
            const cellIndex = this.getCellIndex(entity.x, entity.y);
            this.cells[cellIndex].entities.push(entity);
            this.entityCells.set(entity.id, cellIndex);
        }
    }

    /**
     * Update an entity's position in the grid.
     * Call when an entity moves.
     *
     * @param entity The entity that moved
     * @param oldX Previous tile X
     * @param oldY Previous tile Y
     */
    public updateEntity(entity: Entity, oldX: number, oldY: number): void {
        const oldCellIndex = this.getCellIndex(oldX, oldY);
        const newCellIndex = this.getCellIndex(entity.x, entity.y);

        // No change needed if same cell
        if (oldCellIndex === newCellIndex) return;

        // Remove from old cell
        const oldCell = this.cells[oldCellIndex];
        const idx = oldCell.entities.indexOf(entity);
        if (idx !== -1) {
            // Swap with last element and pop (O(1) removal)
            const last = oldCell.entities.pop()!;
            if (idx < oldCell.entities.length) {
                oldCell.entities[idx] = last;
            }
        }

        // Add to new cell
        this.cells[newCellIndex].entities.push(entity);
        this.entityCells.set(entity.id, newCellIndex);
    }

    /**
     * Add a new entity to the grid.
     */
    public addEntity(entity: Entity): void {
        const cellIndex = this.getCellIndex(entity.x, entity.y);
        this.cells[cellIndex].entities.push(entity);
        this.entityCells.set(entity.id, cellIndex);
    }

    /**
     * Remove an entity from the grid.
     */
    public removeEntity(entity: Entity): void {
        const cellIndex = this.entityCells.get(entity.id);
        if (cellIndex === undefined) return;

        const cell = this.cells[cellIndex];
        const idx = cell.entities.indexOf(entity);
        if (idx !== -1) {
            const last = cell.entities.pop()!;
            if (idx < cell.entities.length) {
                cell.entities[idx] = last;
            }
        }

        this.entityCells.delete(entity.id);
    }

    /**
     * Query all entities within the given tile bounds.
     * This is the main performance-critical method.
     *
     * @param bounds Tile bounds to query
     * @param out Optional output array (reused to avoid allocation)
     * @returns Array of entities in the bounds
     */
    public queryVisible(bounds: Bounds, out: Entity[] = []): Entity[] {
        out.length = 0;

        // Convert tile bounds to cell bounds
        const minCellX = Math.max(0, Math.floor(bounds.minX / this.cellSize));
        const maxCellX = Math.min(this.gridWidth - 1, Math.floor(bounds.maxX / this.cellSize));
        const minCellY = Math.max(0, Math.floor(bounds.minY / this.cellSize));
        const maxCellY = Math.min(this.gridHeight - 1, Math.floor(bounds.maxY / this.cellSize));

        this.lastQueryCells = 0;

        // Iterate over visible cells
        for (let cy = minCellY; cy <= maxCellY; cy++) {
            for (let cx = minCellX; cx <= maxCellX; cx++) {
                const cellIndex = cy * this.gridWidth + cx;
                const cell = this.cells[cellIndex];
                this.lastQueryCells++;

                // Add all entities from this cell
                // Note: We don't do fine-grained bounds check here because
                // the world bounds check in FrameContext will filter them
                for (const entity of cell.entities) {
                    out.push(entity);
                }
            }
        }

        this.lastQueryEntities = out.length;
        return out;
    }

    /**
     * Get statistics about the grid.
     */
    public getStats(): GridStats {
        let totalEntities = 0;
        let maxEntities = 0;
        let emptyCells = 0;

        for (const cell of this.cells) {
            const count = cell.entities.length;
            totalEntities += count;
            if (count > maxEntities) maxEntities = count;
            if (count === 0) emptyCells++;
        }

        return {
            cellCount: this.cells.length,
            totalEntities,
            maxEntitiesPerCell: maxEntities,
            avgEntitiesPerCell: totalEntities / (this.cells.length - emptyCells) || 0,
            emptyCells,
            queriedCells: this.lastQueryCells,
            returnedEntities: this.lastQueryEntities,
        };
    }

    /**
     * Clear all entities from the grid.
     */
    public clear(): void {
        for (const cell of this.cells) {
            cell.entities.length = 0;
        }
        this.entityCells.clear();
    }
}
