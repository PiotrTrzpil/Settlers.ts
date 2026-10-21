/**
 * Choreography types — feature-layer extensions.
 *
 * Re-exports pure data types from systems/choreo/ and adds the
 * feature-dependent context interfaces and executor function signatures.
 */

import type { Entity, Tile } from '../../entity';
import type { GameState } from '../../game-state';
import type { PileSide } from '../inventory';
import type { ThrottledLogger } from '@/utilities/throttled-logger';
import type { TriggerSystem } from '../building-overlays';
import type { TaskResult, ChoreoJobState, ChoreoNode, ChoreoExecutionScope, SearchArea } from '../../systems/choreo';

// Re-export everything from systems/choreo (including JobKind) so existing importers don't need to change paths.
export {
    ChoreoTaskType,
    JobKind,
    parseChoreoTaskType,
    type ChoreoNode,
    type ChoreoJob,
    type TransportData,
    type ChoreoJobState,
    createChoreoJobState,
    CHOREO_FPS,
    framesToSeconds,
    tickDuration,
    choreo,
    node,
    ChoreoBuilder,
    type ChoreoExecutionScope,
    type BoundedArea,
    type SelfArea,
    type SearchArea,
    asBounded,
    asSelf,
} from '../../systems/choreo';

// ─────────────────────────────────────────────────────────────
// JobPart resolution
// ─────────────────────────────────────────────────────────────

/** JobPart resolution result for animation playback. */
export interface JobPartResolution {
    sequenceKey: string;
    loop: boolean;
    stopped: boolean;
    /** When true, the animation plays in reverse (last frame first). */
    reverse?: boolean;
}

/** Resolves jobPart strings to animation sequence keys. */
export interface JobPartResolver {
    resolve(jobPart: string, settler: Entity): JobPartResolution;
}

/** Converts building-relative tile offset to world hex coordinates. */
export interface BuildingPositionResolver {
    /** Resolve (buildingId, offset, useWork) → world hex position. */
    resolvePosition(buildingId: number, offset: Tile, useWork: boolean): Tile;
    /**
     * Tile of a building's pile for a jobInfo.xml material ('GOOD_LOG') on the given side.
     * Pass-through to the inventory: pile tiles are fixed on the slots at slot creation.
     * Throws if the building has no such pile.
     */
    getPilePosition(buildingId: number, material: string, side: PileSide): Tile;
    /** Check whether this building type has a work area. */
    hasWorkArea(buildingId: number): boolean;
    /** Get the work area center (absolute world tile) for a building. */
    getWorkAreaCenter(buildingId: number): Tile;
    /** Get the work area radius (in tiles) for a building. */
    getWorkAreaRadius(buildingId: number): number;
}

// ─────────────────────────────────────────────────────────────
// Search area resolution
// ─────────────────────────────────────────────────────────────

/**
 * Resolve the search area for a work handler.
 *
 * Home building with work area → BoundedArea (center + radius from building).
 * Otherwise → SelfArea (settler position).
 */
export function resolveSearchArea(
    settler: Tile,
    homeBuildingId: number | null,
    resolver: BuildingPositionResolver
): SearchArea {
    if (homeBuildingId !== null && resolver.hasWorkArea(homeBuildingId)) {
        return {
            type: 'bounded',
            center: resolver.getWorkAreaCenter(homeBuildingId),
            radius: resolver.getWorkAreaRadius(homeBuildingId),
        };
    }
    return { type: 'self', origin: settler };
}

// ─────────────────────────────────────────────────────────────
// Executor context interfaces — each typed to the minimum needed
// ─────────────────────────────────────────────────────────────

/**
 * Context required by movement-phase executors (GO_TO_TARGET, GO_HOME, SEARCH, …).
 * Stable services only — per-unit state (work handlers) arrives via ChoreoExecutionScope.
 */
export interface MovementContext {
    gameState: GameState;
    buildingPositionResolver: BuildingPositionResolver;
    getWorkerHomeBuilding: (settlerId: number) => number | null;
    handlerErrorLogger: ThrottledLogger;
}

/**
 * Context required by work-phase executors (WORK, WORK_ON_ENTITY, PRODUCE_VIRTUAL, …).
 * Stable services only — the home building and work handlers arrive via ChoreoExecutionScope.
 */
export interface WorkContext {
    gameState: GameState;
    triggerSystem: TriggerSystem;
    handlerErrorLogger: ThrottledLogger;
}

// ─────────────────────────────────────────────────────────────
// Category-scoped executor function types
// ─────────────────────────────────────────────────────────────

/** Movement executor — GO_TO_*, SEARCH, GO_HOME, GO_VIRTUAL */
export type MovementExecutorFn = (
    settler: Entity,
    job: ChoreoJobState,
    node: ChoreoNode,
    dt: number,
    ctx: MovementContext,
    scope: ChoreoExecutionScope
) => TaskResult;

/** Work executor — WORK, WORK_ON_ENTITY, PLANT, *_VIRTUAL, PRODUCE_VIRTUAL */
export type WorkExecutorFn = (
    settler: Entity,
    job: ChoreoJobState,
    node: ChoreoNode,
    dt: number,
    ctx: WorkContext,
    scope: ChoreoExecutionScope
) => TaskResult;
