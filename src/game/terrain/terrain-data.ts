/**
 * TerrainData — single owner for map terrain arrays and dimensions.
 *
 * Layer 0 (pure data): no imports from features, systems, or game state.
 * Created once from the map loader and shared by reference throughout the
 * engine. The typed arrays inside are mutated in-place by construction
 * terrain leveling; the reference to TerrainData itself stays stable.
 */

import { MapSize } from '@/utilities/map-size';
import { isPassable, isBuildable, isRock, isMineBuildable } from './terrain-queries';
import type { Tile } from '@/game/core/coordinates';

export class TerrainData {
    constructor(
        public readonly groundType: Uint8Array,
        public readonly groundHeight: Uint8Array,
        public readonly mapSize: MapSize,
        public readonly terrainAttributes: Uint8Array | null = null
    ) {}

    /** Check if tile is dark land (bit 6 of terrain attributes). */
    isDarkLand(tile: Tile): boolean {
        if (!this.terrainAttributes) {
            return false;
        }
        return (this.terrainAttributes[this.mapSize.toIndex(tile)]! & 0x40) !== 0;
    }

    /** Map width in tiles */
    get width(): number {
        return this.mapSize.width;
    }

    /** Map height in tiles */
    get height(): number {
        return this.mapSize.height;
    }

    /** Convert tile coordinates to a flat array index */
    toIndex(tile: Tile): number {
        return this.mapSize.toIndex(tile);
    }

    /** Check if coordinates are within map bounds */
    isInBounds(tile: Tile): boolean {
        return tile.x >= 0 && tile.x < this.mapSize.width && tile.y >= 0 && tile.y < this.mapSize.height;
    }

    /** Get ground height at tile coordinates */
    getHeight(tile: Tile): number {
        return this.groundHeight[this.mapSize.toIndex(tile)]!;
    }

    /** Get ground type value at tile coordinates */
    getType(tile: Tile): number {
        return this.groundType[this.mapSize.toIndex(tile)]!;
    }

    /** Check if tile is passable (units can walk on it) */
    isPassable(tile: Tile): boolean {
        return isPassable(this.groundType[this.mapSize.toIndex(tile)]!);
    }

    /** Check if tile is buildable for normal buildings */
    isBuildable(tile: Tile): boolean {
        return isBuildable(this.groundType[this.mapSize.toIndex(tile)]!);
    }

    /** Check if tile is rock/mountain terrain */
    isRock(tile: Tile): boolean {
        return isRock(this.groundType[this.mapSize.toIndex(tile)]!);
    }

    /** Check if tile is buildable for mine buildings */
    isMineBuildable(tile: Tile): boolean {
        return isMineBuildable(this.groundType[this.mapSize.toIndex(tile)]!);
    }
}
