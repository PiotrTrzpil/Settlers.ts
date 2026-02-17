/**
 * Terrain Module
 *
 * Single owner for map terrain data. Provides the TerrainData value object
 * and pure terrain-type query functions.
 *
 * Layer 0 (pure data) — safe to import from any layer.
 */

export { TerrainData } from './terrain-data';
export { isPassable, isBuildable, isRock, isMineBuildable } from './terrain-queries';
