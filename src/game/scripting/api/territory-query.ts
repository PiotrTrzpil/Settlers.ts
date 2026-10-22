/**
 * Territory lookups shared by the Game.* and Map.* Lua APIs.
 */

import type { Tile } from '@/game/core/coordinates';

/** Minimal territory interface the Lua APIs need (implemented by TerritoryManager). */
export interface TerritoryQuery {
    /** Owning player of a tile, or -1 if unclaimed / out of bounds. */
    getOwner(tile: Tile): number;
}

export interface CircleArea {
    x: number;
    y: number;
    range: number;
}

/**
 * True when every in-bounds tile within `range` of (x, y) belongs to `player`.
 * Uses the same Euclidean radius as EntityQuery.inRadius.
 */
export function isAreaOwned(
    territory: TerritoryQuery,
    player: number,
    area: CircleArea,
    mapWidth: number,
    mapHeight: number
): boolean {
    const r = Math.max(0, Math.floor(area.range));
    const r2 = r * r;
    const minY = Math.max(0, area.y - r);
    const maxY = Math.min(mapHeight - 1, area.y + r);
    const minX = Math.max(0, area.x - r);
    const maxX = Math.min(mapWidth - 1, area.x + r);
    if (minX > maxX || minY > maxY) {
        return false;
    }
    for (let ty = minY; ty <= maxY; ty++) {
        const dy = ty - area.y;
        for (let tx = minX; tx <= maxX; tx++) {
            const dx = tx - area.x;
            if (dx * dx + dy * dy <= r2 && territory.getOwner({ x: tx, y: ty }) !== player) {
                return false;
            }
        }
    }
    return true;
}
