/**
 * PathfindingService wraps the low-level findPath function with terrain and occupancy
 * state, providing a cleaner API for movement-related pathfinding operations.
 */

import { TileCoord } from '../../entity';
import { findPath } from '../pathfinding';

/**
 * Terrain data required by the pathfinding service.
 */
export interface PathfindingTerrain {
    groundType: Uint8Array;
    groundHeight: Uint8Array;
    mapWidth: number;
    mapHeight: number;
}

/**
 * Interface for the pathfinding service.
 * Extracted so MovementSystem and CollisionResolver can depend on this abstraction.
 */
export interface IPathfinder {
    /**
     * Find a path from start to goal, optionally ignoring occupancy.
     * Returns null if no path exists.
     */
    findPath(
        startX: number,
        startY: number,
        goalX: number,
        goalY: number,
        ignoreOccupancy: boolean
    ): TileCoord[] | null;

    /** Returns true if terrain data has been set. */
    hasTerrainData(): boolean;
}

/**
 * Concrete pathfinding service that wraps A* with terrain and occupancy context.
 */
export class PathfindingService implements IPathfinder {
    private terrain: PathfindingTerrain | undefined;
    private occupancy: Map<string, number> | undefined;
    private buildingOccupancy: Set<string> = new Set();

    /**
     * Set the terrain data used for all subsequent pathfinding calls.
     */
    setTerrainData(groundType: Uint8Array, groundHeight: Uint8Array, mapWidth: number, mapHeight: number): void {
        this.terrain = { groundType, groundHeight, mapWidth, mapHeight };
    }

    /**
     * Set the tile occupancy map used for obstacle-aware pathfinding.
     */
    setOccupancy(occupancy: Map<string, number>): void {
        this.occupancy = occupancy;
    }

    /**
     * Set the building occupancy set — these tiles always block pathfinding.
     */
    setBuildingOccupancy(buildingOccupancy: Set<string>): void {
        this.buildingOccupancy = buildingOccupancy;
    }

    /** Returns true if terrain data has been loaded. */
    hasTerrainData(): boolean {
        return this.terrain !== undefined;
    }

    /**
     * Find a path between two points.
     *
     * @param startX Starting X coordinate
     * @param startY Starting Y coordinate
     * @param goalX Goal X coordinate
     * @param goalY Goal Y coordinate
     * @param ignoreOccupancy When true, ignores unit occupancy (buildings always block)
     * @returns Array of waypoints (not including start), or null if unreachable
     */
    findPath(
        startX: number,
        startY: number,
        goalX: number,
        goalY: number,
        ignoreOccupancy: boolean
    ): TileCoord[] | null {
        if (!this.terrain || !this.occupancy) return null;

        return findPath(
            startX,
            startY,
            goalX,
            goalY,
            this.terrain.groundType,
            this.terrain.groundHeight,
            this.terrain.mapWidth,
            this.terrain.mapHeight,
            this.occupancy,
            this.buildingOccupancy,
            ignoreOccupancy
        );
    }
}
