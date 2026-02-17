/**
 * Re-exports terrain queries from systems layer.
 *
 * The actual implementations live in systems/terrain-queries.ts (Layer 1)
 * so that pathfinding, movement, and other systems can use them without
 * importing from the features layer.
 */
export { isPassable, isRock, isBuildable, isMineBuildable } from '../../systems/terrain-queries';
