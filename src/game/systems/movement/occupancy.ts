/**
 * Unit-occupancy helpers shared by MovementSystem and BumpResolver.
 */

import { tileKey, type Tile } from '../../core/coordinates';

/** Entity occupying `key`, ignoring `selfId`. */
export function occupantAt(occupancy: Map<string, number>, key: string, selfId: number): number | undefined {
    const occupant = occupancy.get(key);
    if (occupant !== undefined && occupant !== selfId) {
        return occupant;
    }
    return undefined;
}

/** Move an entity from one tile to another, keeping the occupancy map in sync. */
export function relocateOccupant(occupancy: Map<string, number>, entityId: number, from: Tile, to: Tile): void {
    const oldKey = tileKey(from);
    if (occupancy.get(oldKey) === entityId) {
        occupancy.delete(oldKey);
    }
    occupancy.set(tileKey(to), entityId);
}
