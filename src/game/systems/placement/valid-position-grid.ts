/**
 * Precomputed grid of valid building positions.
 *
 * Evaluates tiles in a spiral-outward pattern from the camera center,
 * supporting chunked computation to avoid frame drops. Provides O(1)
 * validity lookups and incremental patching after placement.
 */

import { MapSize } from '@/utilities/map-size';
import { BuildingType, getBuildingFootprint, getBuildingBlockArea, Tile } from '../../entity';
import type { Race } from '../../core/race';
import type { PlacementContext, PlacementFilter } from './types';
import { validateBuildingPlacement } from './internal/building-validator';
import { computeHeightRange } from './slope';
import { getAllNeighbors } from '../../systems/hex-directions';

export interface ValidPositionEntry {
    x: number;
    y: number;
    heightRange: number;
}

export interface GridComputeRequest {
    buildingType: BuildingType;
    race: Race;
    player: number;
    centerX: number;
    centerY: number;
    placementFilter: PlacementFilter | null;
}

/**
 * Precomputed grid storing valid building positions for a specific
 * building type + race + player combination. Tiles are evaluated in
 * concentric rectangular rings expanding from the camera center.
 */
export class ValidPositionGrid {
    private readonly request: GridComputeRequest;
    private readonly ctx: PlacementContext;
    private readonly mapWidth: number;
    private readonly mapHeight: number;
    private readonly mapSizeRef: MapSize;
    private readonly groundHeightRef: Uint8Array;

    /** O(1) lookup set using tile index (y * width + x) */
    private readonly validSet = new Set<number>();
    /** Ordered list of valid positions for the renderer */
    private readonly positions: ValidPositionEntry[] = [];
    /** Index into positions by tile index, for fast removal during patching */
    private readonly positionIndexByTile = new Map<number, number>();

    /**
     * Size-based difficulty multiplier for height range.
     * Larger buildings need more digging to level, so the same raw slope
     * should look "harder" (more orange/red) than on a small building.
     * Uses a gentle power curve: (blockTiles / 4) ^ 0.3
     */
    private readonly sizeWeight: number;

    /** Current spiral ring radius */
    private ring = 0;
    /** Position within the current ring perimeter */
    private ringPos = 0;
    /** Total tiles in the current ring perimeter (0 for ring 0 which is just center) */
    private ringPerimeter = 0;
    private complete = false;

    constructor(
        request: GridComputeRequest,
        mapSize: MapSize,
        groundType: Uint8Array,
        groundHeight: Uint8Array,
        groundOccupancy: Map<string, number>,
        buildingFootprint: ReadonlySet<string>,
        isReplaceableOccupant?: (entityId: number) => boolean
    ) {
        this.request = request;
        this.mapSizeRef = mapSize;
        this.mapWidth = mapSize.width;
        this.mapHeight = mapSize.height;
        this.groundHeightRef = groundHeight;

        // Compute block area size once — same for every position of this building type.
        // Reference size = 4 (a 2×2 building). Exponent 0.3 gives gentle scaling:
        //   4 tiles → 1.0×,  20 tiles → 1.6×,  100 tiles → 2.6×
        const refBlockArea = getBuildingBlockArea(0, 0, request.buildingType, request.race);
        this.sizeWeight = refBlockArea.length > 0 ? (refBlockArea.length / 4) ** 0.3 : 1;

        this.ctx = {
            groundType,
            groundHeight,
            mapSize,
            groundOccupancy,
            buildingFootprint,
            race: request.race,
            placementFilter: request.placementFilter,
            player: request.player,
            isReplaceableOccupant,
        };
    }

    /**
     * Run one chunk of computation. Advances the spiral by up to
     * `maxTiles` tiles. Returns true when the entire map has been evaluated.
     */
    computeChunk(maxTiles: number): boolean {
        if (this.complete) {
            return true;
        }

        let processed = 0;

        while (processed < maxTiles) {
            if (this.ring === 0 && this.ringPos === 0) {
                // Ring 0: evaluate center tile only
                this.evaluateTile(this.request.centerX, this.request.centerY);
                processed++;
                this.ring = 1;
                this.ringPos = 0;
                this.ringPerimeter = computeRingPerimeter(1);

                if (this.isRingFullyOutOfBounds(1)) {
                    this.complete = true;
                    return true;
                }
                continue;
            }

            // Evaluate tiles along the current ring
            const { x, y } = this.getRingTile(this.ring, this.ringPos);
            this.evaluateTile(x, y);
            processed++;
            this.ringPos++;

            if (this.ringPos >= this.ringPerimeter) {
                // Advance to next ring
                this.ring++;
                this.ringPos = 0;
                this.ringPerimeter = computeRingPerimeter(this.ring);

                if (this.isRingFullyOutOfBounds(this.ring)) {
                    this.complete = true;
                    return true;
                }
            }
        }

        return false;
    }

    /** O(1) check if position is valid. */
    isValid(x: number, y: number): boolean {
        return this.validSet.has(this.mapSizeRef.toIndex(x, y));
    }

    /** Get entry with height range for rendering. Returns null if not valid. */
    getEntry(x: number, y: number): ValidPositionEntry | null {
        const idx = this.mapSizeRef.toIndex(x, y);
        const posIdx = this.positionIndexByTile.get(idx);
        if (posIdx === undefined) {
            return null;
        }
        return this.positions[posIdx]!;
    }

    /** All computed valid positions (for renderer). */
    getPositions(): readonly ValidPositionEntry[] {
        return this.positions;
    }

    /**
     * Invalidate positions around a newly placed building.
     * Placing a building never creates new valid spots nearby, so only removals are needed.
     */
    patchAfterPlacement(placedX: number, placedY: number, placedType: BuildingType, race: Race): void {
        const footprint = getBuildingFootprint(placedX, placedY, placedType, race);

        // Collect all tiles that could be affected: footprint tiles + their neighbors
        const affectedKeys = new Set<number>();
        for (const tile of footprint) {
            addTileAndNeighborsToSet(tile.x, tile.y, this.mapSizeRef, affectedKeys);
        }

        // Expand by checking positions within a wider radius (~5 tiles for large footprints).
        // Any valid position whose own footprint overlaps the affected zone needs re-validation.
        const tilesToRevalidate = this.collectPositionsNearAffectedZone(affectedKeys);

        for (const tileIdx of tilesToRevalidate) {
            const tx = tileIdx % this.mapWidth;
            const ty = Math.floor(tileIdx / this.mapWidth);
            const result = validateBuildingPlacement(tx, ty, this.request.buildingType, this.ctx);

            if (!result.canPlace && this.validSet.has(tileIdx)) {
                this.removePosition(tileIdx);
            }
        }
    }

    /** Whether all tiles have been evaluated. */
    get isComplete(): boolean {
        return this.complete;
    }

    /** Number of valid positions found so far. */
    get count(): number {
        return this.validSet.size;
    }

    /** The building type this grid was built for. */
    get buildingType(): BuildingType {
        return this.request.buildingType;
    }

    /** The race this grid was built for. */
    get race(): Race {
        return this.request.race;
    }

    // ---- Private helpers ----

    /** Evaluate a single tile and add to valid set if placement succeeds. */
    private evaluateTile(x: number, y: number): void {
        if (x < 0 || x >= this.mapWidth || y < 0 || y >= this.mapHeight) {
            return;
        }

        const result = validateBuildingPlacement(x, y, this.request.buildingType, this.ctx);
        if (!result.canPlace) {
            return;
        }

        // Use block area (inner building body) for height range — consistent with slope check.
        // Weight by building size so larger buildings show more orange/red at the same raw slope.
        const blockArea = getBuildingBlockArea(x, y, this.request.buildingType, this.request.race);
        const heightRange = computeHeightRange(blockArea, this.groundHeightRef, this.mapSizeRef) * this.sizeWeight;

        const idx = this.mapSizeRef.toIndex(x, y);
        this.validSet.add(idx);
        this.positionIndexByTile.set(idx, this.positions.length);
        this.positions.push({ x, y, heightRange });
    }

    /**
     * Remove a position from the valid set and positions array.
     * Uses swap-and-pop for O(1) removal from the array.
     */
    private removePosition(tileIdx: number): void {
        this.validSet.delete(tileIdx);

        const posIdx = this.positionIndexByTile.get(tileIdx);
        if (posIdx === undefined) {
            return;
        }

        const lastIdx = this.positions.length - 1;
        if (posIdx !== lastIdx) {
            // Swap with last element
            const lastEntry = this.positions[lastIdx]!;
            this.positions[posIdx] = lastEntry;
            const lastTileIdx = this.mapSizeRef.toIndex(lastEntry.x, lastEntry.y);
            this.positionIndexByTile.set(lastTileIdx, posIdx);
        }
        this.positions.pop();
        this.positionIndexByTile.delete(tileIdx);
    }

    /**
     * Collect valid positions that are near the affected zone and need re-validation.
     * A position needs re-checking if its footprint could overlap the affected tiles.
     * We expand the affected zone by a radius of ~5 tiles to cover large building footprints.
     */
    private collectPositionsNearAffectedZone(affectedTiles: Set<number>): number[] {
        const expandedZone = new Set<number>();

        // Expand affected zone by 5 tiles in each direction to catch buildings
        // whose anchor is outside the zone but whose footprint overlaps it.
        for (const tileIdx of affectedTiles) {
            const tx = tileIdx % this.mapWidth;
            const ty = Math.floor(tileIdx / this.mapWidth);
            for (let dy = -5; dy <= 5; dy++) {
                for (let dx = -5; dx <= 5; dx++) {
                    const nx = tx + dx;
                    const ny = ty + dy;
                    if (nx >= 0 && nx < this.mapWidth && ny >= 0 && ny < this.mapHeight) {
                        expandedZone.add(this.mapSizeRef.toIndex(nx, ny));
                    }
                }
            }
        }

        const result: number[] = [];
        for (const idx of expandedZone) {
            if (this.validSet.has(idx)) {
                result.push(idx);
            }
        }
        return result;
    }

    /**
     * Check if an entire ring is fully outside the map bounds.
     * A ring at distance `r` from center spans from (centerX - r) to (centerX + r)
     * and (centerY - r) to (centerY + r). If that entire rectangle is outside
     * map bounds, we are done.
     */
    private isRingFullyOutOfBounds(r: number): boolean {
        const cx = this.request.centerX;
        const cy = this.request.centerY;
        return cx - r >= this.mapWidth || cx + r < 0 || cy - r >= this.mapHeight || cy + r < 0;
    }

    /**
     * Get the (x, y) coordinates for a tile at position `pos` within ring `r`.
     *
     * Ring `r` is a rectangular perimeter of tiles where max(|dx|, |dy|) == r
     * relative to the center. We walk the perimeter: top edge, right edge,
     * bottom edge, left edge.
     */
    private getRingTile(r: number, pos: number): Tile {
        const cx = this.request.centerX;
        const cy = this.request.centerY;
        const sideLen = 2 * r;

        if (pos < sideLen) {
            // Top edge: y = cy - r, x goes from cx - r to cx + r - 1
            return { x: cx - r + pos, y: cy - r };
        }
        const pos1 = pos - sideLen;
        if (pos1 < sideLen) {
            // Right edge: x = cx + r, y goes from cy - r + 1 to cy + r
            return { x: cx + r, y: cy - r + 1 + pos1 };
        }
        const pos2 = pos1 - sideLen;
        if (pos2 < sideLen) {
            // Bottom edge: y = cy + r, x goes from cx + r - 1 to cx - r
            return { x: cx + r - 1 - pos2, y: cy + r };
        }
        const pos3 = pos2 - sideLen;
        // Left edge: x = cx - r, y goes from cy + r - 1 to cy - r + 1
        return { x: cx - r, y: cy + r - 1 - pos3 };
    }
}

/** Compute the perimeter length of a rectangular ring at distance `r`. */
function computeRingPerimeter(r: number): number {
    // Rectangle from (-r, -r) to (+r, +r), perimeter = 4 * (2r) = 8r
    return 8 * r;
}

/** Add a tile and all its hex neighbors to a set (by tile index). */
function addTileAndNeighborsToSet(x: number, y: number, mapSize: MapSize, set: Set<number>): void {
    if (x >= 0 && x < mapSize.width && y >= 0 && y < mapSize.height) {
        set.add(mapSize.toIndex(x, y));
    }
    for (const n of getAllNeighbors({ x, y })) {
        if (n.x >= 0 && n.x < mapSize.width && n.y >= 0 && n.y < mapSize.height) {
            set.add(mapSize.toIndex(n.x, n.y));
        }
    }
}
