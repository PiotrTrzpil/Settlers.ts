/**
 * Pure terrain type queries — passability, buildability, rock detection.
 *
 * These are Layer 0 (pure data) so that any module can query terrain
 * without importing from the features or systems layers.
 *
 * Based on LandscapeType enum values from the map file.
 */

/**
 * Check if a terrain type is passable (units can walk on it).
 */
export function isPassable(groundTypeValue: number): boolean {
    // Water: 0-8
    if (groundTypeValue <= 8) return false;
    // Snow: 128, 129 - not passable
    if (groundTypeValue === 128 || groundTypeValue === 129) return false;
    // Everything else (including rock) is passable
    return true;
}

/**
 * Check if a terrain type is rock/mountain terrain.
 * Rock terrain is only buildable by mines.
 */
export function isRock(groundTypeValue: number): boolean {
    return groundTypeValue === 32;
}

/**
 * Check if a terrain type is buildable for normal (non-mine) buildings.
 */
export function isBuildable(groundTypeValue: number): boolean {
    if (!isPassable(groundTypeValue)) return false;
    // Rock: 32 - only mines can build here (see isMineBuildable)
    if (groundTypeValue === 32) return false;
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

/**
 * Check if a terrain type is buildable for mine buildings.
 * Mines can only be placed on rock/mountain terrain.
 */
export function isMineBuildable(groundTypeValue: number): boolean {
    return isRock(groundTypeValue);
}
