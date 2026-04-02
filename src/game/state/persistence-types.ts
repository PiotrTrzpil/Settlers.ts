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
import type { SettlerState } from '../features/settler-tasks/types';
import type { Tile } from '@/game/core/coordinates';

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

/** Serialized unit runtime — minimal state for resume-on-load. */
export interface SerializedUnitRuntime {
    /** Entity ID of the unit */
    id: number;
    /** Settler state at save time */
    state: SettlerState;
    /** Move task target (if unit was moving via player command) */
    moveTarget?: Tile;
    /** Active job intent (if unit was working) */
    job?: SerializedJobIntent;
    /** Building assignment */
    home?: { buildingId: number; hasVisited: boolean };
}

/**
 * Minimal job state for resuming a choreography job.
 * Stores the job ID and current node index so the job can
 * restart from the beginning of the current (or previous movement) node.
 */
export interface SerializedJobIntent {
    jobId: string;
    /** Node index to resume from (snapped back to last movement/search node). */
    nodeIndex: number;
    /** Target entity ID if the job had acquired one (e.g., tree to chop). */
    targetId?: number;
    /** Target position if the job had one. */
    targetPos?: Tile;
}
