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
import type { Tile } from '@/game/core/coordinates';

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
    private readonly mapWidth: number;
    private readonly mapHeight: number;

    /** Cached boundary dots for rendering */
    private cachedBoundaryDots: TerritoryDot[] = [];

    /** Whether the grid needs recomputation */
    private dirty = true;

    /** Whether boundary dots need recomputation (without full grid recompute) */
    private boundaryDirty = false;

    /** Callback for single-tile ownership changes (pioneer expansion) */
    onTileChanged?: (x: number, y: number, oldOwner: number, newOwner: number) => void;

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
    addBuilding(entityId: number, x: number, y: number, player: number, buildingType: BuildingType): void {
        const radius = TERRITORY_RADIUS[buildingType];
        if (radius === undefined) {
            return;
        }

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

    /**
     * Claim a single tile for a player (pioneer expansion path).
     * Does NOT trigger full recompute — only marks boundary dots dirty
     * and notifies the spatial index via onTileChanged.
     */
    claimTile(x: number, y: number, player: number): void {
        this.recomputeIfDirty(); // ensure grid is up to date before mutating
        const idx = y * this.mapWidth + x;
        const oldValue = this.territoryGrid[idx]!;
        const oldOwner = oldValue === 0 ? -1 : oldValue - 1;
        this.territoryGrid[idx] = player + 1;
        this.onTileChanged?.(x, y, oldOwner, player);
        this.boundaryDirty = true;
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
                this.onTileChanged?.(x, y, oldOwner, player);
            }
        }
        this.boundaryDirty = true;
    }

    // ─────────────────────────────────────────────────────────────
    // Queries
    // ─────────────────────────────────────────────────────────────

    /** Check if a tile is within a specific player's territory */
    isInTerritory(x: number, y: number, player: number): boolean {
        this.recomputeIfDirty();
        if (x < 0 || y < 0 || x >= this.mapWidth || y >= this.mapHeight) {
            return false;
        }
        return this.territoryGrid[y * this.mapWidth + x] === player + 1;
    }

    /** Check if a tile is within any player's territory */
    isInAnyTerritory(x: number, y: number): boolean {
        this.recomputeIfDirty();
        if (x < 0 || y < 0 || x >= this.mapWidth || y >= this.mapHeight) {
            return false;
        }
        return this.territoryGrid[y * this.mapWidth + x] !== 0;
    }

    /** Get the owning player of a tile (-1 if unclaimed) */
    getOwner(x: number, y: number): number {
        this.recomputeIfDirty();
        if (x < 0 || y < 0 || x >= this.mapWidth || y >= this.mapHeight) {
            return -1;
        }
        const value = this.territoryGrid[y * this.mapWidth + x]!;
        return value === 0 ? -1 : value - 1;
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

    private recompute(): void {
        // Snapshot old grid to detect changes
        const hasChangeListener = this.onTerritoryChanged !== undefined;
        const oldGrid = hasChangeListener ? new Uint8Array(this.territoryGrid) : null;

        // Clear grids
        this.territoryGrid.fill(0);
        this.distanceGrid.fill(Infinity);

        // Fill territory circles for each building — closest tower wins
        for (const building of this.buildings.values()) {
            this.fillCircle(building.x, building.y, building.radius, building.player + 1);
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
    private fillCircle(cx: number, cy: number, radius: number, ownerValue: number): void {
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
                const offset = this.getBoundaryOffset(x, y, owner);
                if (offset) {
                    dots.push({ x, y, player: owner - 1, offsetX: offset.ox, offsetY: offset.oy });
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
    private getBoundaryOffset(x: number, y: number, owner: number): { ox: number; oy: number } | null {
        let isBoundary = false;
        let enemyDx = 0;
        let enemyDy = 0;
        let enemyCount = 0;

        for (let d = 0; d < NUMBER_OF_DIRECTIONS; d++) {
            const nx = x + GRID_DELTA_X[d]!;
            const ny = y + GRID_DELTA_Y[d]!;

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
            return { ox: 0, oy: 0 };
        }
        // Normalize and pull inward (away from enemy neighbors)
        const len = Math.sqrt(enemyDx * enemyDx + enemyDy * enemyDy);
        const INWARD_OFFSET = 0.35;
        return { ox: (-enemyDx / len) * INWARD_OFFSET, oy: (-enemyDy / len) * INWARD_OFFSET };
    }
}
