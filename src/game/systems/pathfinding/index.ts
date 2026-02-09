/**
 * Pathfinding module for hex grid navigation.
 *
 * Provides A* pathfinding with:
 * - Hex-aware heuristics
 * - Bucket priority queue for fast uniform-cost search
 * - Path smoothing to reduce zigzags
 * - Line-of-sight utilities for direct movement
 *
 * Usage:
 *   import { findPath } from '@/game/systems/pathfinding';
 *   const path = findPath(0, 0, 10, 10, terrain, occupancy);
 */

// Core A* algorithm
export { findPathAStar, type TerrainData } from './astar';

// Data structures
export { BucketPriorityQueue } from './bucket-priority-queue';

// Hex line utilities
export { getHexLine, cubeRound, isHexLinePassable } from './hex-line';

// Path post-processing
export { smoothPath, type PathSmoothingParams } from './path-smoothing';

// Backward-compatible alias
import { findPathAStar, type TerrainData } from './astar';
import { TileCoord } from '../../entity';

/**
 * Find a path between two points on the hex grid.
 *
 * This is the main entry point for pathfinding. It wraps findPathAStar
 * with a simpler signature for backward compatibility.
 *
 * @param startX Starting X coordinate
 * @param startY Starting Y coordinate
 * @param goalX Goal X coordinate
 * @param goalY Goal Y coordinate
 * @param groundType Terrain type array
 * @param groundHeight Height map array
 * @param mapWidth Map width in tiles
 * @param mapHeight Map height in tiles
 * @param tileOccupancy Map of occupied tiles
 * @param ignoreOccupancy If true, ignore occupancy for path planning
 * @returns Path waypoints or null if no path exists
 */
export function findPath(
    startX: number,
    startY: number,
    goalX: number,
    goalY: number,
    groundType: Uint8Array,
    groundHeight: Uint8Array,
    mapWidth: number,
    mapHeight: number,
    tileOccupancy: Map<string, number>,
    ignoreOccupancy: boolean = false
): TileCoord[] | null {
    const terrain: TerrainData = {
        groundType,
        groundHeight,
        mapWidth,
        mapHeight
    };

    return findPathAStar(
        startX, startY,
        goalX, goalY,
        terrain,
        tileOccupancy,
        ignoreOccupancy
    );
}
