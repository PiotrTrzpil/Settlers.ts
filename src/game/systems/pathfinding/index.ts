/**
 * Pathfinding on the isometric diamond grid.
 *
 * A* with a hex heuristic, bucket priority queue, and path smoothing.
 * Units never block — only terrain and building/map-object occupancy do.
 */

export {
    findPathAStar,
    setPathDebugHook,
    type PathfindingTerrain,
    type PathfindingFailureInfo,
    type PathFindResult,
} from './astar';

export { BucketPriorityQueue } from './bucket-priority-queue';
export { getHexLine, groupDirectionRuns, setDirectionRunLength } from './hex-line';
export { smoothPath, type PathSmoothingParams } from './path-smoothing';
