/**
 * Map API - Map and terrain functions
 * Implements the Map.* Lua table
 */

import { LogHandler } from '@/utilities/log-handler';
import type { LuaRuntime } from '../lua-runtime';
import type { IMapLandscape } from '@/resources/map/imap-landscape';
import { isPassable, isBuildable } from '@/game/features/placement';

const log = new LogHandler('MapAPI');

export interface MapAPIContext {
    mapWidth: number;
    mapHeight: number;
    /** Optional landscape data for terrain queries */
    landscape?: IMapLandscape;
    /** Ground height array for direct access */
    groundHeight?: Uint8Array;
    /** Ground type array for direct access */
    groundType?: Uint8Array;
}

/**
 * Register the Map API with the Lua runtime
 */
export function registerMapAPI(runtime: LuaRuntime, context: MapAPIContext): void {
    // Create Map table
    runtime.createTable('Map');

    // Map.Width() - Returns map width in tiles
    runtime.registerFunction('Map', 'Width', () => {
        return context.mapWidth;
    });

    // Map.Height() - Returns map height in tiles
    runtime.registerFunction('Map', 'Height', () => {
        return context.mapHeight;
    });

    // Map.GetHeight(x, y) - Returns terrain height at position
    runtime.registerFunction('Map', 'GetHeight', (x: number, y: number) => {
        // Bounds check
        if (x < 0 || x >= context.mapWidth || y < 0 || y >= context.mapHeight) {
            return 0;
        }

        // Try landscape interface first
        if (context.landscape) {
            const heights = context.landscape.getGroundHeight();
            const idx = y * context.mapWidth + x;
            return heights[idx] || 0;
        }

        // Fall back to direct array
        if (context.groundHeight) {
            const idx = y * context.mapWidth + x;
            return context.groundHeight[idx] || 0;
        }

        return 0;
    });

    // Map.SetHeight(x, y, height) - Set terrain height at position
    runtime.registerFunction('Map', 'SetHeight', (x: number, y: number, height: number) => {
        // Bounds check
        if (x < 0 || x >= context.mapWidth || y < 0 || y >= context.mapHeight) {
            return false;
        }

        if (context.groundHeight) {
            const idx = y * context.mapWidth + x;
            context.groundHeight[idx] = height;
            return true;
        }

        log.debug(`SetHeight(${x}, ${y}, ${height}) - no terrain data available`);
        return false;
    });

    // Map.GetTerrainType(x, y) - Returns terrain type at position
    runtime.registerFunction('Map', 'GetTerrainType', (x: number, y: number) => {
        // Bounds check
        if (x < 0 || x >= context.mapWidth || y < 0 || y >= context.mapHeight) {
            return 0;
        }

        // Try landscape interface first
        if (context.landscape) {
            const types = context.landscape.getGroundType();
            const idx = y * context.mapWidth + x;
            return types[idx] || 0;
        }

        // Fall back to direct array
        if (context.groundType) {
            const idx = y * context.mapWidth + x;
            return context.groundType[idx] || 0;
        }

        return 0;
    });

    // Map.GetResourceAt(x, y) - Returns resource/gameplay attributes at position
    // Note: In S4ModApi, byte 3 is gameplayAttributes (founding stone, fog of war),
    // but the map file format may store resource data here. Returns raw byte value.
    runtime.registerFunction('Map', 'GetResourceAt', (x: number, y: number) => {
        // Bounds check
        if (x < 0 || x >= context.mapWidth || y < 0 || y >= context.mapHeight) {
            return 0;
        }

        if (context.landscape?.getGameplayAttributes) {
            const attributes = context.landscape.getGameplayAttributes();
            const idx = y * context.mapWidth + x;
            return attributes[idx] || 0;
        }

        return 0;
    });

    // Map.IsPointValid(x, y) - Check if coordinates are within map bounds
    runtime.registerFunction('Map', 'IsPointValid', (x: number, y: number) => {
        return x >= 0 && x < context.mapWidth && y >= 0 && y < context.mapHeight;
    });

    // Map.IsWalkable(x, y) - Check if a tile is walkable (units can traverse)
    runtime.registerFunction('Map', 'IsWalkable', (x: number, y: number) => {
        // Bounds check
        if (x < 0 || x >= context.mapWidth || y < 0 || y >= context.mapHeight) {
            return false;
        }

        let terrainType = 0;

        if (context.landscape) {
            const types = context.landscape.getGroundType();
            const idx = y * context.mapWidth + x;
            terrainType = types[idx] || 0;
        } else if (context.groundType) {
            const idx = y * context.mapWidth + x;
            terrainType = context.groundType[idx] || 0;
        }

        // Use the placement module's passability check
        return isPassable(terrainType);
    });

    // Map.IsBuildable(x, y) - Check if a tile can have buildings placed on it
    runtime.registerFunction('Map', 'IsBuildable', (x: number, y: number) => {
        // Bounds check
        if (x < 0 || x >= context.mapWidth || y < 0 || y >= context.mapHeight) {
            return false;
        }

        let terrainType = 0;

        if (context.landscape) {
            const types = context.landscape.getGroundType();
            const idx = y * context.mapWidth + x;
            terrainType = types[idx] || 0;
        } else if (context.groundType) {
            const idx = y * context.mapWidth + x;
            terrainType = context.groundType[idx] || 0;
        }

        // Use the placement module's buildability check
        return isBuildable(terrainType);
    });

    // Map.GetOwner(x, y) - Returns player who owns territory at position
    runtime.registerFunction('Map', 'GetOwner', (_x: number, _y: number) => {
        // TODO: Implement territory ownership lookup
        return -1; // -1 means no owner
    });

    // Map.FlattenGround(x, y, range) - Flatten terrain in area
    runtime.registerFunction('Map', 'FlattenGround', (x: number, y: number, range: number) => {
        if (!context.groundHeight) {
            log.debug(`FlattenGround(${x}, ${y}, ${range}) - no terrain data available`);
            return false;
        }

        // Calculate average height in area
        let totalHeight = 0;
        let count = 0;

        for (let dy = -range; dy <= range; dy++) {
            for (let dx = -range; dx <= range; dx++) {
                const tx = x + dx;
                const ty = y + dy;
                if (tx >= 0 && tx < context.mapWidth && ty >= 0 && ty < context.mapHeight) {
                    const idx = ty * context.mapWidth + tx;
                    totalHeight += context.groundHeight[idx];
                    count++;
                }
            }
        }

        if (count === 0) return false;

        const avgHeight = Math.round(totalHeight / count);

        // Set all tiles to average height
        for (let dy = -range; dy <= range; dy++) {
            for (let dx = -range; dx <= range; dx++) {
                const tx = x + dx;
                const ty = y + dy;
                if (tx >= 0 && tx < context.mapWidth && ty >= 0 && ty < context.mapHeight) {
                    const idx = ty * context.mapWidth + tx;
                    context.groundHeight[idx] = avgHeight;
                }
            }
        }

        return true;
    });

    log.debug('Map API registered');
}
