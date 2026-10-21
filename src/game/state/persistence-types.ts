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
import type { CommitmentOwner } from '../systems/unit-commitment';
import type { JobKind, JobParams } from '../systems/choreo/job-kind';
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

/** Serialized unit runtime — minimal state for resume-on-load. Idle units without a home are not saved. */
export interface SerializedUnitRuntime {
    /** Entity ID of the unit */
    id: number;
    /** Building assignment */
    home?: { buildingId: number; hasVisited: boolean };
    /** Who owned the unit at save time. Absent ⇔ idle (or owned by a `persist: false` owner / a legacy job). */
    commitment?: SerializedCommitment;
}

/** A unit's commitment: a job, a move task, or a hold (neither). */
export interface SerializedCommitment {
    owner: CommitmentOwner;
    ref: number;
    reserved: boolean;
    /** The owned job. Absent ⇒ hold (or move). */
    job?: SerializedJob;
    /** Move target for owner 'player-move' / 'siege' move commitments. */
    moveTarget?: Tile;
}

/** An owned job: rebuilt on load through `JobKindHandler.build(params)`; nodes are never saved. */
export interface SerializedJob {
    kind: JobKind;
    params: JobParams;
    /** Raw node index at save time; snapping to a safe node happens on resume. */
    nodeIndex: number;
    targetId?: number;
    targetPos?: Tile;
    approachPos?: Tile;
}
