import { MapSize } from '@/utilities/map-size';

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
    // Water: 0-8 - not buildable
    if (groundTypeValue <= 8) return false;
    // Rock: 32 - not buildable
    if (groundTypeValue === 32) return false;
    // Beach: 48 - not buildable
    if (groundTypeValue === 48) return false;
    // Swamp: 80, 81 - not buildable
    if (groundTypeValue === 80 || groundTypeValue === 81) return false;
    // Snow: 128, 129 - not buildable
    if (groundTypeValue === 128 || groundTypeValue === 129) return false;
    // Mud: 144, 145 - not buildable
    if (groundTypeValue === 144 || groundTypeValue === 145) return false;

    // Grass (16, 18, 24, 25), Desert (64, 65), paths (28, 29), transitions - buildable
    return true;
}

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

    // Check terrain is buildable
    if (!isBuildable(groundType[idx])) {
        return false;
    }

    // Check tile is not occupied
    const key = x + ',' + y;
    if (tileOccupancy.has(key)) {
        return false;
    }

    // Check slope: max height difference with 4 neighbors <= 2
    const centerHeight = groundHeight[idx];
    const neighbors = [
        [x - 1, y], [x + 1, y],
        [x, y - 1], [x, y + 1]
    ];

    for (const [nx, ny] of neighbors) {
        if (nx < 0 || nx >= mapSize.width || ny < 0 || ny >= mapSize.height) {
            continue;
        }
        const neighborHeight = groundHeight[mapSize.toIndex(nx, ny)];
        if (Math.abs(centerHeight - neighborHeight) > 2) {
            return false;
        }
    }

    return true;
}
