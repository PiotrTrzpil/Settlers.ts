/**
 * Pathfinding module - re-exports from modular implementation.
 *
 * For new code, prefer importing directly from '@/game/systems/pathfinding/'.
 * This file maintains backward compatibility.
 */

export { findPath, findPathAStar, type TerrainData } from './pathfinding/index';
export { BucketPriorityQueue } from './pathfinding/bucket-priority-queue';
export { getHexLine, cubeRound, isHexLinePassable } from './pathfinding/hex-line';
export { smoothPath, type PathSmoothingParams } from './pathfinding/path-smoothing';
