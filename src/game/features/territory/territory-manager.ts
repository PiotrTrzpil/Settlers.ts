/**
 * Territory Manager
 *
 * Computes and maintains territory zones created by towers and castles.
 * Provides O(1) territory ownership queries and boundary dot positions for rendering.
 *
 * Territory is recomputed lazily — only when queried after a building change.
 * Overlapping zones use distance-based priority: each tile belongs to the
 * closest tower/castle, creating equidistant borders between players.
 */

import { GRID_DELTA_X, GRID_DELTA_Y, NUMBER_OF_DIRECTIONS } from '../../systems/hex-directions';
import { TERRITORY_RADIUS, type TerritoryDot } from './territory-types';
import type { BuildingType } from '../../buildings/types';
import { thinDotsInScreenSpace, isoDistSq } from '../../systems/boundary-ring';
import { type ComponentStore, mapStore } from '../../ecs';
import type { Tile, Offset } from '@/game/core/coordinates';

// ── Types ────────────────────────────────────────────────────────────

/** Internal record for a territory-generating building */
interface TerritoryBuilding {
    readonly x: number;
    readonly y: number;
    readonly player: number;
    readonly radius: number;
}

/** A tile whose ownership changed during recomputation */
export interface TerritoryChange {
    readonly x: number;
    readonly y: number;
    readonly oldOwner: number;
    readonly newOwner: number;
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
    /** Per-tile squared isometric distance to the owning building */
    private readonly distanceGrid: Float32Array;
    /** Per-tile connected component ID (0 = unclaimed/unlabeled). */
    private readonly componentGrid: Uint32Array;
    private readonly mapWidth: number;
    private readonly mapHeight: number;

    /** Cached boundary dots for rendering */
    private cachedBoundaryDots: TerritoryDot[] = [];

    /** Whether the grid needs recomputation */
    private dirty = true;

    /** Whether boundary dots need recomputation (without full grid recompute) */
    private boundaryDirty = false;

    /** Whether connected components need recomputation */
    private componentDirty = true;

    /** Callback for single-tile ownership changes (pioneer expansion) */
    onTileChanged?: (tile: Tile, oldOwner: number, newOwner: number) => void;

    /** Callback after full recomputation (tower build/destroy) */
    onRecomputed?: () => void;

    /**
     * Callback with tiles that changed ownership during recomputation.
     * Used by territory-feature to destroy buildings / displace units on lost territory.
     */
    onTerritoryChanged?: (changes: TerritoryChange[]) => void;

    /** Territory-generating buildings indexed by entity ID */
    private readonly buildings = new Map<number, TerritoryBuilding>();

    /** Uniform read-only view for cross-cutting queries */
    readonly store: ComponentStore<TerritoryBuilding> = mapStore(this.buildings);

    constructor(mapWidth: number, mapHeight: number) {
        this.mapWidth = mapWidth;
        this.mapHeight = mapHeight;
        this.territoryGrid = new Uint8Array(mapWidth * mapHeight);
        this.distanceGrid = new Float32Array(mapWidth * mapHeight);
        this.componentGrid = new Uint32Array(mapWidth * mapHeight);
    }

    // ─────────────────────────────────────────────────────────────
    // Persistence
    // ─────────────────────────────────────────────────────────────

    /** Snapshot the territory grid for serialization (one byte per tile). */
    snapshotGrid(): Uint8Array {
        this.recomputeIfDirty();
        return new Uint8Array(this.territoryGrid);
    }

    /**
     * Restore the territory grid from a snapshot and rebuild the distance grid
     * from registered buildings. Suppresses the pending recompute so the
     * restored ownership is used as-is (preserving order-dependent boundaries).
     */
    restoreGrid(territory: Uint8Array): void {
        this.territoryGrid.set(territory);
        this.rebuildDistanceGrid();
        this.dirty = false;
        this.boundaryDirty = true;
        this.componentDirty = true;
        this.onRecomputed?.();
    }

    /** Recompute distanceGrid from buildings without touching territoryGrid. */
    private rebuildDistanceGrid(): void {
        this.distanceGrid.fill(Infinity);
        for (const building of this.buildings.values()) {
            const ownerValue = building.player + 1;
            const screenR = building.radius * 0.5;
            const rSq = screenR * screenR;
            const minY = Math.max(0, building.y - building.radius);
            const maxY = Math.min(this.mapHeight - 1, building.y + building.radius);
            const minX = Math.max(0, building.x - building.radius);
            const maxX = Math.min(this.mapWidth - 1, building.x + building.radius);
            for (let y = minY; y <= maxY; y++) {
                const dy = y - building.y;
                const rowOffset = y * this.mapWidth;
                for (let x = minX; x <= maxX; x++) {
                    const dx = x - building.x;
                    const distSq = isoDistSq(dx, dy);
                    if (distSq > rSq) {
                        continue;
                    }
                    const idx = rowOffset + x;
                    if (this.territoryGrid[idx] === ownerValue && distSq < this.distanceGrid[idx]!) {
                        this.distanceGrid[idx] = distSq;
                    }
                }
            }
        }
    }

    // ─────────────────────────────────────────────────────────────
    // Building Registration
    // ─────────────────────────────────────────────────────────────

    /** Register a territory-generating building */
    addBuilding(entityId: number, tile: Tile, player: number, buildingType: BuildingType): void {
        const radius = TERRITORY_RADIUS[buildingType];
        if (radius === undefined) {
            return;
        }

        this.buildings.set(entityId, { x: tile.x, y: tile.y, player, radius });
        this.dirty = true;
        this.componentDirty = true;
    }

    /** Remove a territory-generating building */
    removeBuilding(entityId: number): boolean {
        if (this.buildings.delete(entityId)) {
            this.dirty = true;
            this.componentDirty = true;
            return true;
        }
        return false;
    }

    /** Number of registered territory buildings */
    get buildingCount(): number {
        return this.buildings.size;
    }

    /**
     * Claim a single tile for a player (pioneer expansion path).
     * Does NOT trigger full recompute — only marks boundary dots dirty
     * and notifies the spatial index via onTileChanged.
     */
    claimTile(tile: Tile, player: number): void {
        this.recomputeIfDirty(); // ensure grid is up to date before mutating
        const idx = tile.y * this.mapWidth + tile.x;
        const oldValue = this.territoryGrid[idx]!;
        const oldOwner = oldValue === 0 ? -1 : oldValue - 1;
        this.territoryGrid[idx] = player + 1;
        this.onTileChanged?.(tile, oldOwner, player);
        this.boundaryDirty = true;
        this.componentDirty = true;
    }

    /**
     * Claim a set of tiles for a player (e.g. captured tower footprint).
     * Writes directly to the computed grid — does NOT trigger recompute.
     */
    claimTiles(tiles: readonly Tile[], player: number): void {
        this.recomputeIfDirty();
        const ownerValue = player + 1;
        for (const { x, y } of tiles) {
            const idx = y * this.mapWidth + x;
            const oldValue = this.territoryGrid[idx]!;
            const oldOwner = oldValue === 0 ? -1 : oldValue - 1;
            if (oldOwner !== player) {
                this.territoryGrid[idx] = ownerValue;
                this.distanceGrid[idx] = 0;
                this.onTileChanged?.({ x, y }, oldOwner, player);
            }
        }
        this.boundaryDirty = true;
        this.componentDirty = true;
    }

    // ─────────────────────────────────────────────────────────────
    // Queries
    // ─────────────────────────────────────────────────────────────

    /** Check if a tile is within a specific player's territory */
    isInTerritory(tile: Tile, player: number): boolean {
        this.recomputeIfDirty();
        if (tile.x < 0 || tile.y < 0 || tile.x >= this.mapWidth || tile.y >= this.mapHeight) {
            return false;
        }
        return this.territoryGrid[tile.y * this.mapWidth + tile.x] === player + 1;
    }

    /** Check if a tile is within any player's territory */
    isInAnyTerritory(tile: Tile): boolean {
        this.recomputeIfDirty();
        if (tile.x < 0 || tile.y < 0 || tile.x >= this.mapWidth || tile.y >= this.mapHeight) {
            return false;
        }
        return this.territoryGrid[tile.y * this.mapWidth + tile.x] !== 0;
    }

    /** Get the owning player of a tile (-1 if unclaimed) */
    getOwner(tile: Tile): number {
        this.recomputeIfDirty();
        if (tile.x < 0 || tile.y < 0 || tile.x >= this.mapWidth || tile.y >= this.mapHeight) {
            return -1;
        }
        const value = this.territoryGrid[tile.y * this.mapWidth + tile.x]!;
        return value === 0 ? -1 : value - 1;
    }

    /**
     * Check if two tiles in the same player's territory are connected
     * (reachable through contiguous same-player territory tiles).
     * Returns false if either tile is not owned by the given player.
     */
    areConnected(a: Tile, b: Tile, player: number): boolean {
        this.recomputeIfDirty();
        this.ensureComponentsComputed();
        const ownerValue = player + 1;
        const idx1 = a.y * this.mapWidth + a.x;
        const idx2 = b.y * this.mapWidth + b.x;
        if (this.territoryGrid[idx1] !== ownerValue || this.territoryGrid[idx2] !== ownerValue) {
            return false;
        }
        const c1 = this.componentGrid[idx1];
        const c2 = this.componentGrid[idx2];
        return c1 === c2 && c1 !== 0;
    }

    /** Get boundary dots for rendering (cached, recomputed when dirty) */
    getBoundaryDots(): readonly TerritoryDot[] {
        this.recomputeIfDirty();
        if (this.boundaryDirty) {
            this.boundaryDirty = false;
            this.cachedBoundaryDots = this.computeBoundaryDots();
        }
        return this.cachedBoundaryDots;
    }

    // ─────────────────────────────────────────────────────────────
    // Recomputation
    // ─────────────────────────────────────────────────────────────

    private recomputeIfDirty(): void {
        if (!this.dirty) {
            return;
        }
        this.dirty = false;
        this.recompute();
        this.onRecomputed?.();
    }

    /** Recompute connected components if dirty. */
    private ensureComponentsComputed(): void {
        if (!this.componentDirty) {
            return;
        }
        this.componentDirty = false;
        this.computeComponents();
    }

    /**
     * Flood-fill connected components over the territory grid.
     * Each contiguous region of same-player tiles gets a unique component ID.
     */
    private computeComponents(): void {
        const comp = this.componentGrid;
        const grid = this.territoryGrid;
        const len = this.mapWidth * this.mapHeight;
        comp.fill(0);

        let nextId = 0;
        const queue: number[] = [];

        for (let i = 0; i < len; i++) {
            if (grid[i] === 0 || comp[i] !== 0) {
                continue;
            }
            nextId++;
            comp[i] = nextId;
            queue.length = 0;
            queue.push(i);
            this.bfsFloodComponent(nextId, grid[i]!, queue, comp);
        }
    }

    /** BFS flood-fill a single component from the seeded queue. */
    private bfsFloodComponent(componentId: number, owner: number, queue: number[], comp: Uint32Array): void {
        const grid = this.territoryGrid;
        const w = this.mapWidth;
        const h = this.mapHeight;
        let head = 0;

        while (head < queue.length) {
            const idx = queue[head++]!;
            const cx = idx % w;
            const cy = (idx - cx) / w;

            for (let d = 0; d < NUMBER_OF_DIRECTIONS; d++) {
                const nx = cx + GRID_DELTA_X[d]!;
                const ny = cy + GRID_DELTA_Y[d]!;
                if (nx < 0 || ny < 0 || nx >= w || ny >= h) {
                    continue;
                }
                const nIdx = ny * w + nx;
                if (grid[nIdx] === owner && comp[nIdx] === 0) {
                    comp[nIdx] = componentId;
                    queue.push(nIdx);
                }
            }
        }
    }

    private recompute(): void {
        // Snapshot old grid to detect changes
        const hasChangeListener = this.onTerritoryChanged !== undefined;
        const oldGrid = hasChangeListener ? new Uint8Array(this.territoryGrid) : null;

        // Clear grids
        this.territoryGrid.fill(0);
        this.distanceGrid.fill(Infinity);

        // Fill territory circles for each building — closest tower wins
        for (const building of this.buildings.values()) {
            this.fillCircle(building, building.radius, building.player + 1);
        }

        // Notify about changed tiles
        if (hasChangeListener && oldGrid) {
            const changes = this.collectChanges(oldGrid);
            if (changes.length > 0) {
                this.onTerritoryChanged!(changes);
            }
        }

        // Compute boundary dots
        this.cachedBoundaryDots = this.computeBoundaryDots();
    }

    /**
     * Fill a territory zone that appears as a wide ellipse on screen.
     * Uses distance-based priority: if a tile is already claimed by a different
     * player's closer tower, the existing claim is kept. This creates equidistant
     * borders between overlapping territories.
     */
    private fillCircle(center: Tile, radius: number, ownerValue: number): void {
        const { x: cx, y: cy } = center;
        const screenR = radius * 0.5;
        const rSq = screenR * screenR;

        // Generous tile-space bounding box (screen circle can extend ~radius in any tile axis)
        const minY = Math.max(0, cy - radius);
        const maxY = Math.min(this.mapHeight - 1, cy + radius);
        const minX = Math.max(0, cx - radius);
        const maxX = Math.min(this.mapWidth - 1, cx + radius);

        for (let y = minY; y <= maxY; y++) {
            const dy = y - cy;
            const rowOffset = y * this.mapWidth;
            for (let x = minX; x <= maxX; x++) {
                const dx = x - cx;
                const distSq = isoDistSq(dx, dy);
                if (distSq > rSq) {
                    continue;
                }
                const idx = rowOffset + x;
                const existing = this.territoryGrid[idx]!;
                // Only claim unclaimed tiles or same-player tiles where this tower is closer.
                // Different-player territory is never overwritten — territory is first-come-first-served
                // between players (matching Settlers 4 mechanics where placement order matters).
                if ((existing === 0 || existing === ownerValue) && distSq < this.distanceGrid[idx]!) {
                    this.territoryGrid[idx] = ownerValue;
                    this.distanceGrid[idx] = distSq;
                }
            }
        }
    }

    /** Compare old and new grids, returning tiles that changed ownership. */
    private collectChanges(oldGrid: Uint8Array): TerritoryChange[] {
        const changes: TerritoryChange[] = [];
        const len = this.territoryGrid.length;
        for (let i = 0; i < len; i++) {
            const oldVal = oldGrid[i]!;
            const newVal = this.territoryGrid[i]!;
            if (oldVal !== newVal) {
                const x = i % this.mapWidth;
                const y = (i / this.mapWidth) | 0;
                changes.push({
                    x,
                    y,
                    oldOwner: oldVal === 0 ? -1 : oldVal - 1,
                    newOwner: newVal === 0 ? -1 : newVal - 1,
                });
            }
        }
        return changes;
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
                if (owner === 0) {
                    continue;
                }
                const offset = this.getBoundaryOffset({ x, y }, owner);
                if (offset) {
                    dots.push({ x, y, player: owner - 1, offsetX: offset.dx, offsetY: offset.dy });
                }
            }
        }
        return dots;
    }

    /**
     * If the tile is a boundary tile, compute an inward offset.
     * At player-vs-player borders, dots are pulled inward (~0.35 tiles) so both
     * players' dots are visible side by side. At territory-vs-unclaimed borders,
     * no offset is applied.
     * Returns null if the tile is not a boundary tile.
     */
    private getBoundaryOffset(tile: Tile, owner: number): Offset | null {
        let isBoundary = false;
        let enemyDx = 0;
        let enemyDy = 0;
        let enemyCount = 0;

        for (let d = 0; d < NUMBER_OF_DIRECTIONS; d++) {
            const nx = tile.x + GRID_DELTA_X[d]!;
            const ny = tile.y + GRID_DELTA_Y[d]!;

            if (nx < 0 || ny < 0 || nx >= this.mapWidth || ny >= this.mapHeight) {
                isBoundary = true;
                continue;
            }

            const neighbor = this.territoryGrid[ny * this.mapWidth + nx]!;
            if (neighbor === owner) {
                continue;
            }
            isBoundary = true;
            // Track direction toward enemy territory (not unclaimed)
            if (neighbor !== 0) {
                enemyDx += GRID_DELTA_X[d]!;
                enemyDy += GRID_DELTA_Y[d]!;
                enemyCount++;
            }
        }

        if (!isBoundary) {
            return null;
        }
        if (enemyCount === 0) {
            return { dx: 0, dy: 0 };
        }
        // Normalize and pull inward (away from enemy neighbors)
        const len = Math.sqrt(enemyDx * enemyDx + enemyDy * enemyDy);
        const INWARD_OFFSET = 0.35;
        return { dx: (-enemyDx / len) * INWARD_OFFSET, dy: (-enemyDy / len) * INWARD_OFFSET };
    }
}
