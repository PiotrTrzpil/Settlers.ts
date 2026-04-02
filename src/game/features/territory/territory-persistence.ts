/**
 * TerritoryPersistence — saves/restores the per-tile ownership bitmap.
 *
 * Territory boundaries are order-dependent (first-come-first-served between
 * players). Recomputing from buildings after load produces shifted boundaries
 * if entity iteration order differs. Persisting the grid preserves exact state.
 *
 * Storage: 4 bits per tile (supports up to 15 players + unclaimed).
 * Two tiles are packed into each byte (high nibble = even tile, low nibble = odd).
 * The distanceGrid is rebuilt from registered buildings on restore.
 */

import type { Persistable } from '../../persistence/types';
import type { TerritoryManager } from './territory-manager';

export class TerritoryPersistence implements Persistable<Uint8Array> {
    readonly persistKey = 'territory';

    private manager: TerritoryManager | null = null;
    private pendingData: Uint8Array | null = null;

    /** Called from onTerrainReady after TerritoryManager is created. */
    setManager(manager: TerritoryManager): void {
        this.manager = manager;
        if (this.pendingData) {
            manager.restoreGrid(unpackGrid(this.pendingData));
            this.pendingData = null;
        }
    }

    serialize(): Uint8Array {
        if (!this.manager) {
            return new Uint8Array(0);
        }
        return packGrid(this.manager.snapshotGrid());
    }

    deserialize(data: Uint8Array): void {
        if (this.manager) {
            this.manager.restoreGrid(unpackGrid(data));
        } else {
            this.pendingData = data;
        }
    }
}

/** Pack one-byte-per-tile grid into 4 bits per tile (2 tiles per byte). */
function packGrid(grid: Uint8Array): Uint8Array {
    const packedLen = Math.ceil(grid.length / 2);
    const packed = new Uint8Array(packedLen);
    for (let i = 0; i < grid.length; i += 2) {
        const hi = grid[i]! & 0x0f;
        const lo = i + 1 < grid.length ? grid[i + 1]! & 0x0f : 0;
        packed[i >> 1] = (hi << 4) | lo;
    }
    return packed;
}

/** Unpack 4-bit-per-tile grid back to one byte per tile. */
function unpackGrid(packed: Uint8Array): Uint8Array {
    const grid = new Uint8Array(packed.length * 2);
    for (let i = 0; i < packed.length; i++) {
        const byte = packed[i]!;
        grid[i * 2] = (byte >> 4) & 0x0f;
        grid[i * 2 + 1] = byte & 0x0f;
    }
    return grid;
}
