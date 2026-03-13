/**
 * Feature serialization types used by Persistable implementations.
 *
 * These types define the shape of feature data stored under dynamic
 * persist keys in GameStateSnapshot. They are NOT fields on the snapshot
 * itself — feature data lives under dynamic keys via the PersistenceRegistry.
 *
 * With superjson at the boundary, Maps/Sets are preserved natively.
 * Entity/building IDs are Map keys rather than embedded fields.
 */

import type { TreeStage } from '../features/trees/tree-system';
import type { StoneStage } from '../features/stones/stone-system';

export interface SerializedTree {
    stage: TreeStage;
    progress: number;
    stumpTimer: number;
    currentOffset: number;
    variant?: number;
}

export interface SerializedStone {
    stage: StoneStage;
    variant: number;
    level: number;
}

export interface SerializedCrop {
    stage: number;
    cropType: number;
    progress: number;
    decayTimer: number;
    currentOffset: number;
}

export interface SerializedProductionControl {
    mode: string;
    recipeCount: number;
    roundRobinIndex: number;
    proportions: Map<number, number>;
    queue: number[];
    productionCounts: Map<number, number>;
}
