import { CARDINAL_OFFSETS, tileKey, BuildingType, getBuildingFootprint } from '../entity';
import { MapSize } from '@/utilities/map-size';
import { TerritoryMap, NO_OWNER } from '../buildings/territory';

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

/**
 * Check if a building can be placed, considering territory ownership.
 * The first building per player is free (no territory required).
 * Subsequent buildings must be within the player's territory or adjacent to it.
 *
 * NOTE: Territory checks are currently disabled for easier testing.
 * Set ENABLE_TERRITORY_CHECKS = true to re-enable.
 */
const ENABLE_TERRITORY_CHECKS = false;

export function canPlaceBuildingWithTerritory(
    groundType: Uint8Array,
    groundHeight: Uint8Array,
    mapSize: MapSize,
    tileOccupancy: Map<string, number>,
    territory: TerritoryMap,
    x: number,
    y: number,
    player: number,
    hasBuildings: boolean,
    buildingType?: BuildingType
): boolean {
    // If building type is specified, use multi-tile validation
    if (buildingType !== undefined) {
        return canPlaceBuildingFootprint(
            groundType, groundHeight, mapSize, tileOccupancy,
            territory, x, y, player, hasBuildings, buildingType
        );
    }

    // Legacy single-tile validation
    if (!canPlaceBuilding(groundType, groundHeight, mapSize, tileOccupancy, x, y)) {
        return false;
    }

    if (!ENABLE_TERRITORY_CHECKS || !hasBuildings) {
        return true;
    }

    // Check territory ownership
    const tile = { x, y };
    if (isInEnemyTerritory(tile, territory, player)) {
        return false;
    }

    // Allow building in own territory or unclaimed land adjacent to own territory
    const owner = territory.getOwner(x, y);
    if (owner === NO_OWNER && !isAdjacentToOwnTerritory(tile, territory, player, mapSize)) {
        return false;
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

/** Check if a tile is in enemy territory */
function isInEnemyTerritory(
    tile: TileCoord,
    territory: TerritoryMap,
    player: number
): boolean {
    const owner = territory.getOwner(tile.x, tile.y);
    return owner !== player && owner !== NO_OWNER;
}

/** Check if a tile is adjacent to player's territory */
function isAdjacentToOwnTerritory(
    tile: TileCoord,
    territory: TerritoryMap,
    player: number,
    mapSize: MapSize
): boolean {
    for (const [dx, dy] of CARDINAL_OFFSETS) {
        const nx = tile.x + dx;
        const ny = tile.y + dy;
        if (nx < 0 || nx >= mapSize.width || ny < 0 || ny >= mapSize.height) continue;
        if (territory.isOwnedBy(nx, ny, player)) return true;
    }
    return false;
}

/** Check if any footprint tile has valid territory access */
function hasValidTerritoryAccess(
    footprint: TileCoord[],
    territory: TerritoryMap,
    player: number,
    mapSize: MapSize
): boolean {
    for (const tile of footprint) {
        if (territory.getOwner(tile.x, tile.y) === player) return true;
        if (isAdjacentToOwnTerritory(tile, territory, player, mapSize)) return true;
    }
    return false;
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
    territory: TerritoryMap,
    x: number,
    y: number,
    player: number,
    hasBuildings: boolean,
    buildingType: BuildingType
): boolean {
    const footprint = getBuildingFootprint(x, y, buildingType);

    if (!isFootprintInBounds(footprint, mapSize)) return false;

    for (const tile of footprint) {
        if (!isTileBuildable(tile, groundType, mapSize, tileOccupancy)) return false;
        if (ENABLE_TERRITORY_CHECKS && hasBuildings && isInEnemyTerritory(tile, territory, player)) {
            return false;
        }
    }

    if (ENABLE_TERRITORY_CHECKS && hasBuildings) {
        if (!hasValidTerritoryAccess(footprint, territory, player, mapSize)) return false;
    }

    return isFootprintSlopeValid(footprint, groundHeight, mapSize);
}
