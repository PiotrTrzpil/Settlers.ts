import { CARDINAL_OFFSETS, tileKey, BuildingType, getBuildingFootprint } from '../entity';
import { MapSize } from '@/utilities/map-size';
import { TerritoryMap, NO_OWNER } from './territory';

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
 */
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

    // If the player already has buildings, require territory
    if (hasBuildings) {
        const owner = territory.getOwner(x, y);
        if (owner !== player && owner !== NO_OWNER) {
            return false; // Can't build in enemy territory
        }
        // Allow building in own territory or unclaimed land adjacent to own territory
        if (owner === NO_OWNER) {
            let adjacentToOwn = false;
            for (const [dx, dy] of CARDINAL_OFFSETS) {
                const nx = x + dx;
                const ny = y + dy;
                if (nx >= 0 && nx < mapSize.width && ny >= 0 && ny < mapSize.height) {
                    if (territory.isOwnedBy(nx, ny, player)) {
                        adjacentToOwn = true;
                        break;
                    }
                }
            }
            if (!adjacentToOwn) {
                return false;
            }
        }
    }

    return true;
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

    // Check if entire footprint is within map bounds
    for (const tile of footprint) {
        if (tile.x < 0 || tile.x >= mapSize.width ||
            tile.y < 0 || tile.y >= mapSize.height) {
            return false;
        }
    }

    // Check all tiles in footprint for basic requirements
    for (const tile of footprint) {
        const idx = mapSize.toIndex(tile.x, tile.y);

        // Check terrain type
        if (!isBuildable(groundType[idx])) {
            return false;
        }

        // Check occupancy
        if (tileOccupancy.has(tileKey(tile.x, tile.y))) {
            return false;
        }

        // Check territory - no tile can be in enemy territory
        if (hasBuildings) {
            const owner = territory.getOwner(tile.x, tile.y);
            if (owner !== player && owner !== NO_OWNER) {
                return false;
            }
        }
    }

    // For territory: at least one tile must be in own territory or adjacent to it
    if (hasBuildings) {
        let hasValidTerritory = false;
        for (const tile of footprint) {
            const owner = territory.getOwner(tile.x, tile.y);
            if (owner === player) {
                hasValidTerritory = true;
                break;
            }
            // Check if adjacent to own territory
            for (const [dx, dy] of CARDINAL_OFFSETS) {
                const nx = tile.x + dx;
                const ny = tile.y + dy;
                if (nx >= 0 && nx < mapSize.width &&
                    ny >= 0 && ny < mapSize.height) {
                    if (territory.isOwnedBy(nx, ny, player)) {
                        hasValidTerritory = true;
                        break;
                    }
                }
            }
            if (hasValidTerritory) break;
        }
        if (!hasValidTerritory) {
            return false;
        }
    }

    // Check slope across entire footprint
    let minHeight = 255;
    let maxHeight = 0;
    for (const tile of footprint) {
        const h = groundHeight[mapSize.toIndex(tile.x, tile.y)];
        minHeight = Math.min(minHeight, h);
        maxHeight = Math.max(maxHeight, h);
    }

    if (maxHeight - minHeight > MAX_SLOPE_DIFF) {
        return false;
    }

    return true;
}
