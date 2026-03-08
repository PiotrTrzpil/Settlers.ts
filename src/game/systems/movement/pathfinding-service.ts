/**
 * PathfindingService wraps the low-level findPathAStar function with terrain and
 * building occupancy state, providing a cleaner API for movement-related pathfinding.
 *
 * Unit occupancy is never considered during pathfinding — units always path through
 * other units and resolve collisions locally via bump-or-wait.
 */

import { TileCoord } from '../../entity';
import { findPathAStar, type PathfindingTerrain } from '../pathfinding';

/**
 * Interface for the pathfinding service.
 * Units always pathfind ignoring other units — only terrain and buildings block.
 */
export interface IPathfinder {
    /** Find a path from start to goal. Returns null if no path exists. */
    findPath(startX: number, startY: number, goalX: number, goalY: number): TileCoord[] | null;

    /** Returns true if terrain data has been set. */
    hasTerrainData(): boolean;
}

/**
 * Concrete pathfinding service that wraps A* with terrain and building occupancy context.
 */
export class PathfindingService implements IPathfinder {
    private terrain: PathfindingTerrain | undefined;
    private buildingOccupancy: Set<string> = new Set();
    private tileOccupancy: Map<string, number> = new Map();

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
     * Set tile occupancy map — used only for building tunnel identification
     * (determining which entity owns footprint tiles), NOT for blocking.
     */
    setTileOccupancy(tileOccupancy: Map<string, number>): void {
        this.tileOccupancy = tileOccupancy;
    }

    /** Returns true if terrain data has been loaded. */
    hasTerrainData(): boolean {
        return this.terrain !== undefined;
    }

    /**
     * Find a path between two points. Only terrain and buildings are obstacles;
     * unit occupancy is never considered.
     *
     * @param startX Starting X coordinate
     * @param startY Starting Y coordinate
     * @param goalX Goal X coordinate
     * @param goalY Goal Y coordinate
     * @returns Array of waypoints (not including start), or null if unreachable
     */
    findPath(startX: number, startY: number, goalX: number, goalY: number): TileCoord[] | null {
        if (!this.terrain) {
            throw new Error('PathfindingService.findPath: terrain data not set');
        }

        return findPathAStar(startX, startY, goalX, goalY, this.terrain, this.tileOccupancy, this.buildingOccupancy);
    }
}
