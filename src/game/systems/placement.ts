import { CARDINAL_OFFSETS, tileKey, BuildingType, getBuildingFootprint } from '../entity';
import { MapSize } from '@/utilities/map-size';
import type { PlacementEntityType } from '../input/render-state';

/**
 * Terrain passability and buildability based on LandscapeType enum values.
 * The groundType array stores raw landscape type values from the map file.
 */

/** Check if a terrain type is passable (units can walk on it) */
export function isPassable(groundTypeValue: number): boolean {
    // Water: 0-8
    if (groundTypeValue <= 8) return false;
    // Rock: 32
    if (groundTypeValue === 32) return false;
    // Everything else is passable
    return true;
}

/** Check if a terrain type is buildable (buildings can be placed on it) */
export function isBuildable(groundTypeValue: number): boolean {
    if (!isPassable(groundTypeValue)) return false;
    // Beach: 48 - not buildable
    if (groundTypeValue === 48) return false;
    // Swamp: 80, 81 - not buildable
    if (groundTypeValue === 80 || groundTypeValue === 81) return false;
    // Snow: 128, 129 - not buildable
    if (groundTypeValue === 128 || groundTypeValue === 129) return false;
    // Mud: 144, 145 - not buildable
    if (groundTypeValue === 144 || groundTypeValue === 145) return false;

    // River: 96-99 - not buildable
    if (groundTypeValue >= 96 && groundTypeValue <= 99) return false;
    // Grass (16, 18, 24, 25), Desert (64, 65), paths (28, 29), transitions - buildable
    return true;
}

const MAX_SLOPE_DIFF = 2;

/**
 * Check if a building can be placed at tile (x, y).
 * Rules:
 * 1. Terrain is buildable
 * 2. Tile is not occupied
 * 3. Slope is within threshold (max height diff with neighbors <= 2)
 */
export function canPlaceBuilding(
    groundType: Uint8Array,
    groundHeight: Uint8Array,
    mapSize: MapSize,
    tileOccupancy: Map<string, number>,
    x: number,
    y: number
): boolean {
    const idx = mapSize.toIndex(x, y);

    if (!isBuildable(groundType[idx])) {
        return false;
    }

    if (tileOccupancy.has(tileKey(x, y))) {
        return false;
    }

    // Check slope: max height difference with 4 neighbors
    const centerHeight = groundHeight[idx];

    for (const [dx, dy] of CARDINAL_OFFSETS) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || nx >= mapSize.width || ny < 0 || ny >= mapSize.height) {
            continue;
        }
        const neighborHeight = groundHeight[mapSize.toIndex(nx, ny)];
        if (Math.abs(centerHeight - neighborHeight) > MAX_SLOPE_DIFF) {
            return false;
        }
    }

    return true;
}

interface TileCoord { x: number; y: number }

/** Check if all footprint tiles are within map bounds */
function isFootprintInBounds(footprint: TileCoord[], mapSize: MapSize): boolean {
    return footprint.every(t =>
        t.x >= 0 && t.x < mapSize.width && t.y >= 0 && t.y < mapSize.height
    );
}

/** Check if a single tile meets basic building requirements */
function isTileBuildable(
    tile: TileCoord,
    groundType: Uint8Array,
    mapSize: MapSize,
    tileOccupancy: Map<string, number>
): boolean {
    const idx = mapSize.toIndex(tile.x, tile.y);
    if (!isBuildable(groundType[idx])) return false;
    if (tileOccupancy.has(tileKey(tile.x, tile.y))) return false;
    return true;
}

/** Check slope across entire footprint */
function isFootprintSlopeValid(
    footprint: TileCoord[],
    groundHeight: Uint8Array,
    mapSize: MapSize
): boolean {
    let minHeight = 255;
    let maxHeight = 0;
    for (const tile of footprint) {
        const h = groundHeight[mapSize.toIndex(tile.x, tile.y)];
        minHeight = Math.min(minHeight, h);
        maxHeight = Math.max(maxHeight, h);
    }
    return maxHeight - minHeight <= MAX_SLOPE_DIFF;
}

/**
 * Check if a building with multi-tile footprint can be placed.
 * The (x, y) is the top-left corner of the building footprint.
 */
export function canPlaceBuildingFootprint(
    groundType: Uint8Array,
    groundHeight: Uint8Array,
    mapSize: MapSize,
    tileOccupancy: Map<string, number>,
    x: number,
    y: number,
    buildingType: BuildingType
): boolean {
    const footprint = getBuildingFootprint(x, y, buildingType);

    if (!isFootprintInBounds(footprint, mapSize)) return false;

    for (const tile of footprint) {
        if (!isTileBuildable(tile, groundType, mapSize, tileOccupancy)) return false;
    }

    return isFootprintSlopeValid(footprint, groundHeight, mapSize);
}

// ─────────────────────────────────────────────────────────────────────────────
// Resource Placement Validation
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Check if a resource can be placed at tile (x, y).
 * Rules:
 * 1. Position is within map bounds
 * 2. Terrain is passable (not water, rock)
 * 3. Tile is not occupied
 */
export function canPlaceResource(
    groundType: Uint8Array,
    mapSize: MapSize,
    tileOccupancy: Map<string, number>,
    x: number,
    y: number
): boolean {
    // Bounds check
    if (x < 0 || y < 0 || x >= mapSize.width || y >= mapSize.height) {
        return false;
    }

    const idx = mapSize.toIndex(x, y);

    // Must be passable terrain
    if (!isPassable(groundType[idx])) {
        return false;
    }

    // Must not be occupied
    if (tileOccupancy.has(tileKey(x, y))) {
        return false;
    }

    return true;
}

// ─────────────────────────────────────────────────────────────────────────────
// Unified Placement Validation
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Game context for placement validation.
 * Provides all necessary data to validate any placement type.
 */
export interface PlacementContext {
    groundType: Uint8Array;
    groundHeight: Uint8Array;
    mapSize: MapSize;
    tileOccupancy: Map<string, number>;
}

/**
 * Unified placement validation for any entity type.
 * Delegates to type-specific validators.
 *
 * @param entityType The type of entity being placed
 * @param subType The specific subtype (BuildingType, EMaterialType, etc)
 * @param x X coordinate
 * @param y Y coordinate
 * @param ctx Game context for validation
 * @returns true if placement is valid
 */
export function canPlaceEntity(
    entityType: PlacementEntityType,
    subType: number,
    x: number,
    y: number,
    ctx: PlacementContext
): boolean {
    switch (entityType) {
    case 'building':
        return canPlaceBuildingFootprint(
            ctx.groundType,
            ctx.groundHeight,
            ctx.mapSize,
            ctx.tileOccupancy,
            x,
            y,
            subType as BuildingType
        );

    case 'resource':
        return canPlaceResource(
            ctx.groundType,
            ctx.mapSize,
            ctx.tileOccupancy,
            x,
            y
        );

    default:
        // Unknown entity type - reject
        return false;
    }
}

/**
 * Create a placement validator function for use with placement modes.
 * Captures game context and returns a function matching the mode's validator signature.
 *
 * @param entityType The entity type being validated
 * @param getContext Function to get current game context
 * @returns Validator function for the placement mode
 */
export function createPlacementValidator(
    entityType: PlacementEntityType,
    getContext: () => PlacementContext | null
): (x: number, y: number, subType: number) => boolean {
    return (x: number, y: number, subType: number) => {
        const ctx = getContext();
        if (!ctx) return false;
        return canPlaceEntity(entityType, subType, x, y, ctx);
    };
}
