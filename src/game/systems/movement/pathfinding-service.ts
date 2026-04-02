/**
 * PathfindingService wraps the low-level findPathAStar function with terrain and
 * building occupancy state, providing a cleaner API for movement-related pathfinding.
 *
 * Unit occupancy is used as a cost penalty (1.5x) during pathfinding — units prefer
 * to path around crowded tiles but can still path through them.
 */

import { Tile } from '../../entity';
import { findPathAStar, type PathfindingTerrain } from '../pathfinding';

/**
 * Interface for the pathfinding service.
 * Units pathfind with a cost penalty on occupied tiles — only terrain and buildings fully block.
 */
export interface IPathfinder {
    /** Find a path from start to goal. Returns null if no path exists. */
    findPath(startX: number, startY: number, goalX: number, goalY: number): Tile[] | null;

    /** Returns true if terrain data has been set. */
    hasTerrainData(): boolean;
}

/**
 * Concrete pathfinding service that wraps A* with terrain and building occupancy context.
 */
export class PathfindingService implements IPathfinder {
    private terrain: PathfindingTerrain | undefined;
    private buildingOccupancy: Set<string> = new Set();
    private unitOccupancy: Map<string, number> | undefined;
    private pathfindingEntityId: number | undefined;

    /**
     * Set the terrain data used for all subsequent pathfinding calls.
     */
    setTerrainData(groundType: Uint8Array, groundHeight: Uint8Array, mapWidth: number, mapHeight: number): void {
        this.terrain = { groundType, groundHeight, mapWidth, mapHeight };
    }

    /**
     * Set the building occupancy set — these tiles always block pathfinding.
     */
    setBuildingOccupancy(buildingOccupancy: Set<string>): void {
        this.buildingOccupancy = buildingOccupancy;
    }

    /**
     * Set the unit occupancy map — these tiles receive a cost penalty during pathfinding.
     */
    setUnitOccupancy(unitOccupancy: Map<string, number>): void {
        this.unitOccupancy = unitOccupancy;
    }

    /**
     * Set the entity ID of the unit being pathfound for, so its own tile is excluded from penalty.
     */
    setPathfindingEntityId(entityId: number | undefined): void {
        this.pathfindingEntityId = entityId;
    }

    /** Returns true if terrain data has been loaded. */
    hasTerrainData(): boolean {
        return this.terrain !== undefined;
    }

    /**
     * Find a path between two points. Terrain and buildings block; unit-occupied
     * tiles are penalized but not blocked.
     *
     * @param startX Starting X coordinate
     * @param startY Starting Y coordinate
     * @param goalX Goal X coordinate
     * @param goalY Goal Y coordinate
     * @returns Array of waypoints (not including start), or null if unreachable
     */
    findPath(startX: number, startY: number, goalX: number, goalY: number): Tile[] | null {
        if (!this.terrain) {
            throw new Error('PathfindingService.findPath: terrain data not set');
        }

        return findPathAStar(
            startX,
            startY,
            goalX,
            goalY,
            this.terrain,
            this.buildingOccupancy,
            this.unitOccupancy,
            this.pathfindingEntityId
        );
    }
}
