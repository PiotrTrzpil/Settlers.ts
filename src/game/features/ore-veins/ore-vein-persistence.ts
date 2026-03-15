/**
 * OreVeinPersistence — Persistable implementation for prospected tiles.
 *
 * Serializes `OreVeinData.prospected` as a sparse list of tile indices
 * where prospected[i] === 1 (typically <1% of the map).
 *
 * `OreVeinData` is created in `onTerrainReady`, so deserialization buffers
 * the data until `setOreVeinData()` is called.
 */

import type { Persistable } from '../../persistence/types';
import type { OreVeinData } from './ore-vein-data';

/** Sparse list of prospected tile indices. */
type SerializedProspectedTiles = number[];

export class OreVeinPersistence implements Persistable<SerializedProspectedTiles> {
    readonly persistKey = 'prospectedTiles';

    private oreVeinData: OreVeinData | null = null;
    private pendingData: SerializedProspectedTiles | null = null;

    /**
     * Called from `onTerrainReady` after `OreVeinData` is created.
     * Applies any buffered deserialization data immediately.
     */
    setOreVeinData(data: OreVeinData): void {
        this.oreVeinData = data;
        if (this.pendingData !== null) {
            this.applyProspectedTiles(data, this.pendingData);
            this.pendingData = null;
        }
    }

    serialize(): SerializedProspectedTiles {
        if (this.oreVeinData === null) {
            return [];
        }
        return collectProspectedIndices(this.oreVeinData);
    }

    deserialize(data: SerializedProspectedTiles): void {
        if (this.oreVeinData !== null) {
            this.applyProspectedTiles(this.oreVeinData, data);
        } else {
            this.pendingData = data;
        }
    }

    private applyProspectedTiles(oreVeinData: OreVeinData, indices: SerializedProspectedTiles): void {
        for (const idx of indices) {
            if (idx < oreVeinData.prospected.length) {
                oreVeinData.prospected[idx] = 1;
            }
        }
    }
}

function collectProspectedIndices(oreVeinData: OreVeinData): number[] {
    const indices: number[] = [];
    const { prospected } = oreVeinData;
    for (let i = 0; i < prospected.length; i++) {
        if (prospected[i] === 1) {
            indices.push(i);
        }
    }
    return indices;
}
