/**
 * Work handler contract — the plugin interface through which domain features tell the
 * job runtime what a worker searches for and what happens while it works.
 *
 * Domain-free: handlers are registered per search type by the owning feature
 * (trees, stones, crops, production, …) and resolved by the job runtime into the
 * {@link ChoreoExecutionScope} passed to every choreography executor.
 */

import type { Tile, TileWithEntity } from '../../core/coordinates';

// ─────────────────────────────────────────────────────────────
// Search area
// ─────────────────────────────────────────────────────────────

/** Bounded work area: building-centered with required radius. */
export interface BoundedArea {
    type: 'bounded';
    center: Tile;
    radius: number;
}

/** Self-centered area: settler's current position, no radius constraint. */
export interface SelfArea {
    type: 'self';
    origin: Tile;
}

/** Discriminated search area — handlers switch on type to get the right fields. */
export type SearchArea = BoundedArea | SelfArea;

/** Assert area is bounded — throws with context if wrong variant. */
export function asBounded(area: SearchArea): BoundedArea {
    if (area.type !== 'bounded') {
        throw new Error(`Expected bounded search area, got '${area.type}'`);
    }
    return area;
}

/** Assert area is self — throws with context if wrong variant. */
export function asSelf(area: SearchArea): SelfArea {
    if (area.type !== 'self') {
        throw new Error(`Expected self search area, got '${area.type}'`);
    }
    return area;
}

// ─────────────────────────────────────────────────────────────
// Work lifecycles
// ─────────────────────────────────────────────────────────────

/** Discriminator for WorkHandler union. */
export enum WorkHandlerType {
    /** Externally dispatched — no autonomous search (carriers, builders, diggers). */
    NULL = 'null',
    ENTITY = 'entity',
    POSITION = 'position',
}

/** Entity work lifecycle — shared by all handlers that produce entity targets. */
export interface EntityWorkLifecycle {
    canWork(targetId: number): boolean;
    shouldWaitForWork?: boolean;
    onWorkStart?(targetId: number, settlerId: number): void;
    onWorkTick(targetId: number, progress: number): boolean;
    onWorkComplete?(targetId: number, settlerX: number, settlerY: number, settlerId: number): void;
    onWorkInterrupt?(targetId: number, settlerId: number): void;
}

/** Position work lifecycle — shared by all handlers that produce position targets. */
export interface PositionWorkLifecycle {
    shouldWaitForWork?: boolean;
    onWorkAtPositionComplete(tile: Tile, settlerId: number): void;
    onSettlerRemoved?(settlerId: number, targetX?: number, targetY?: number): void;
}

// ─────────────────────────────────────────────────────────────
// Handler interfaces
// ─────────────────────────────────────────────────────────────

/** Handler for externally-dispatched settlers that never search autonomously. */
export interface NullWorkHandler {
    type: WorkHandlerType.NULL;
    shouldWaitForWork?: boolean;
}

/** Handler for entity-targeted work: SEARCH → GO_TO_TARGET → WORK_ON_ENTITY */
export interface EntityWorkHandler extends EntityWorkLifecycle {
    type: WorkHandlerType.ENTITY;
    findTarget(area: SearchArea, settlerId: number, player: number): TileWithEntity | null;
}

/** Handler for position-based work: SEARCH → GO_TO_POS → WORK */
export interface PositionWorkHandler extends PositionWorkLifecycle {
    type: WorkHandlerType.POSITION;
    findPosition(area: SearchArea, settlerId: number): Tile | null;
}

/** Discriminated union of all work handler types. */
export type WorkHandler = NullWorkHandler | EntityWorkHandler | PositionWorkHandler;
