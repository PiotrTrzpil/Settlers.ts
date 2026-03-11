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
export {
    findPathAStar,
    type PathfindingTerrain,
    type PathfindingFailureInfo,
    consumeLastPathfindingFailure,
} from './astar';

// Data structures
export { BucketPriorityQueue } from './bucket-priority-queue';

// Hex line utilities
export { getHexLine, isHexLinePassable, groupDirectionRuns, setDirectionRunLength } from './hex-line';

// Path post-processing
export { smoothPath, type PathSmoothingParams } from './path-smoothing';

// Backward-compatible alias
import { findPathAStar, type PathfindingTerrain } from './astar';
import { TileCoord } from '../../entity';

/**
 * Find a path between two points on the hex grid.
 *
 * This is the main entry point for pathfinding. It wraps findPathAStar
 * with a simpler signature for backward compatibility.
 *
 * Unit occupancy is never considered — only terrain and buildings block.
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
    buildingOccupancy: Set<string>
): TileCoord[] | null {
    const terrain: PathfindingTerrain = {
        groundType,
        groundHeight,
        mapWidth,
        mapHeight,
    };

    return findPathAStar(startX, startY, goalX, goalY, terrain, buildingOccupancy);
}
