/**
 * Terrain passability and buildability checks.
 * Based on LandscapeType enum values from the map file.
 *
 * These are part of the public API — used by movement, pathfinding,
 * commands, and other modules beyond placement validation.
 */

/**
 * Check if a terrain type is passable (units can walk on it).
 */
export function isPassable(groundTypeValue: number): boolean {
    // Water: 0-8
    if (groundTypeValue <= 8) return false;
    // Rock: 32
    if (groundTypeValue === 32) return false;
    // Everything else is passable
    return true;
}

/**
 * Check if a terrain type is buildable (buildings can be placed on it).
 */
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
