/**
 * OreVeinPersistence — Persistable implementation for prospected tiles.
 *
 * Serializes `OreVeinData.prospected` as a sparse list of tile indices
 * where prospected[i] === 1 (typically <1% of the map).
 */

import type { Persistable } from '../../persistence/types';
import type { OreVeinData } from './ore-vein-data';

/** Sparse list of prospected tile indices. */
type SerializedProspectedTiles = number[];

export class OreVeinPersistence implements Persistable<SerializedProspectedTiles> {
    readonly persistKey = 'prospectedTiles';

    constructor(private readonly oreVeinData: OreVeinData) {}

    serialize(): SerializedProspectedTiles {
        return collectProspectedIndices(this.oreVeinData);
    }

    deserialize(data: SerializedProspectedTiles): void {
        for (const idx of data) {
            if (idx < this.oreVeinData.prospected.length) {
                this.oreVeinData.prospected[idx] = 1;
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
