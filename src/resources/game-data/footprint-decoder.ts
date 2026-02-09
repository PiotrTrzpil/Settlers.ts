/**
 * Decode building footprint bitmasks from XML data.
 *
 * The buildingPosLines array contains signed 32-bit integers where each bit
 * represents whether a tile in that row is part of the building footprint.
 * Bit 31 (leftmost) corresponds to tile x=0, bit 0 (rightmost) to tile x=31.
 *
 * The hotspot (iHotSpotX, iHotSpotY) defines the anchor point for the building sprite.
 */

import type { BuildingInfo } from './types';
import type { TileCoord } from '@/game/coordinates';

/**
 * Decode buildingPosLines bitmask into tile coordinates.
 *
 * @param buildingPosLines Array of signed 32-bit integers representing each row's bitmask
 * @param hotSpotX X coordinate of the building's anchor point (in tile coords from left edge of bitmask)
 * @param hotSpotY Y coordinate of the building's anchor point (in tile coords from top of bitmask)
 * @returns Array of tile coordinates relative to the building's placement position (0,0)
 */
export function decodeBuildingFootprint(
    buildingPosLines: number[],
    hotSpotX: number,
    hotSpotY: number
): TileCoord[] {
    const tiles: TileCoord[] = [];

    for (let row = 0; row < buildingPosLines.length; row++) {
        // Treat as unsigned 32-bit by >>> 0
        const lineBits = buildingPosLines[row] >>> 0;

        // Check each bit position (bit 31 = x position 0, bit 0 = x position 31)
        for (let bit = 31; bit >= 0; bit--) {
            if ((lineBits & (1 << bit)) !== 0) {
                // Convert bit position to x coordinate
                // bit 31 = x=0, bit 30 = x=1, ..., bit 0 = x=31
                const tileX = 31 - bit;

                // Calculate position relative to hotspot
                // Building placement position (0,0) should correspond to hotspot in bitmask
                const relativeX = tileX - hotSpotX;
                const relativeY = row - hotSpotY;

                tiles.push({ x: relativeX, y: relativeY });
            }
        }
    }

    return tiles;
}

/**
 * Get the building footprint tiles from BuildingInfo.
 * Returns tiles relative to building placement position (0,0).
 */
export function getBuildingFootprintFromInfo(info: BuildingInfo): TileCoord[] {
    return decodeBuildingFootprint(
        info.buildingPosLines,
        info.hotSpotX,
        info.hotSpotY
    );
}

/**
 * Get absolute tile coordinates for a building placed at (x, y).
 *
 * @param info BuildingInfo with footprint data
 * @param placeX World X coordinate where building is placed
 * @param placeY World Y coordinate where building is placed
 * @returns Array of absolute world tile coordinates
 */
export function getBuildingFootprintAt(
    info: BuildingInfo,
    placeX: number,
    placeY: number
): TileCoord[] {
    const relativeFootprint = getBuildingFootprintFromInfo(info);
    return relativeFootprint.map(tile => ({
        x: placeX + tile.x,
        y: placeY + tile.y,
    }));
}

/**
 * Calculate bounding box of a building's footprint.
 */
export function getFootprintBounds(tiles: TileCoord[]): {
    minX: number;
    maxX: number;
    minY: number;
    maxY: number;
    width: number;
    height: number;
} {
    if (tiles.length === 0) {
        return { minX: 0, maxX: 0, minY: 0, maxY: 0, width: 0, height: 0 };
    }

    let minX = tiles[0].x;
    let maxX = tiles[0].x;
    let minY = tiles[0].y;
    let maxY = tiles[0].y;

    for (const tile of tiles) {
        if (tile.x < minX) minX = tile.x;
        if (tile.x > maxX) maxX = tile.x;
        if (tile.y < minY) minY = tile.y;
        if (tile.y > maxY) maxY = tile.y;
    }

    return {
        minX,
        maxX,
        minY,
        maxY,
        width: maxX - minX + 1,
        height: maxY - minY + 1,
    };
}
