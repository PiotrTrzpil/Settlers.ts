/**
 * Fluent builder for synthetic choreography jobs — ergonomic alternative to verbose node literals.
 *
 * Lives in systems/choreo/ (layer 0) so it can be used by both systems and features.
 *
 * Two outputs:
 * - {@link ChoreoBuilder.toJobBuild} — the owned-job path: a {@link JobBuild} for a
 *   `JobKindHandler.build()`. Every `goTo` node carries its walk `goal`; ENTER_BUILDING
 *   carries `args.enterBuilding`. No metadata / waypoints.
 * - {@link ChoreoBuilder.build} — TRANSITIONAL legacy path (deleted in Cleanup): a ready
 *   ChoreoJobState for `TaskDispatcher.assignJob` with waypoints + metadata.
 */

import type { GameState } from '@/game/game-state';
import type { TerrainData } from '@/game/terrain';
import { findBuildingApproachTile } from '@/game/buildings/approach';
import { ChoreoTaskType, JobKind, createChoreoJobState, type ChoreoNode, type ChoreoJobState } from './types';
import type { JobBuild } from './job-kind';
import type { UnitType } from '@/game/core/unit-types';
import type { Tile, TileWithEntityOpt } from '@/game/core/coordinates';

// ─────────────────────────────────────────────────────────────
// Context for building-aware helpers
// ─────────────────────────────────────────────────────────────

/** Context needed by goToDoor to resolve approach tiles at build time. */
export interface ChoreoBuilderContext {
    gameState: GameState;
    terrain: TerrainData;
}

// ─────────────────────────────────────────────────────────────
// Node factory with defaults
// ─────────────────────────────────────────────────────────────

const NODE_DEFAULTS: ChoreoNode = {
    task: ChoreoTaskType.WAIT,
    jobPart: '',
    x: 0,
    y: 0,
    duration: 0,
    dir: -1,
    forward: true,
    visible: true,
    useWork: false,
    entity: '',
    trigger: '',
};

/** Create a single ChoreoNode with sensible defaults. */
export function node(task: ChoreoTaskType, overrides?: Partial<ChoreoNode>): ChoreoNode {
    return { ...NODE_DEFAULTS, task, ...overrides };
}

// ─────────────────────────────────────────────────────────────
// Fluent builder
// ─────────────────────────────────────────────────────────────

export class ChoreoBuilder {
    private readonly nodes: ChoreoNode[] = [];
    private readonly waypoints: Array<TileWithEntityOpt> = [];
    /** Walk goal per GO_TO node index — attached to the nodes only by toJobBuild(). */
    private readonly goals = new Map<number, TileWithEntityOpt>();
    private _targetId: number | null = null;
    private _targetPos: Tile | null = null;
    private _metadata: Record<string, number | string> | undefined;
    private _goToCount = 0;
    private _kind: JobKind;

    constructor(
        private readonly jobId: string,
        kind: JobKind = JobKind.Work
    ) {
        this._kind = kind;
    }

    /** Override domain JobKind (for demand-system event routing). */
    kind(kind: JobKind): this {
        this._kind = kind;
        return this;
    }

    /**
     * Add a GO_TO_TARGET node walking to `tile` (or to the entity: building door / next to a map object).
     * First call sets targetPos/targetId; every call records the node's walk goal.
     */
    goTo(tile: Tile, entityId?: number): this {
        const goal: TileWithEntityOpt =
            entityId !== undefined ? { x: tile.x, y: tile.y, entityId } : { x: tile.x, y: tile.y };
        this.goals.set(this.nodes.length, goal);
        this.nodes.push(node(ChoreoTaskType.GO_TO_TARGET));
        if (this._goToCount === 0) {
            this._targetPos = tile;
            if (entityId !== undefined) {
                this._targetId = entityId;
            }
        }
        this.waypoints.push(goal);
        this._goToCount++;
        return this;
    }

    // TRANSITIONAL (deleted in Cleanup): the recruit-specific legacy helpers below stash data in
    // metadata. Owned jobs get their TRANSFORM_* nodes from the recruit feature's RecruitSegments.

    /** Add a TRANSFORM_RECRUIT node and stash unitType in metadata. */
    transformRecruit(targetUnitType: UnitType): this {
        this.nodes.push(node(ChoreoTaskType.TRANSFORM_RECRUIT));
        this.meta({ unitType: targetUnitType });
        return this;
    }

    /** Add a TRANSFORM_RECRUIT_BUILDING node and stash unitType + reservationId in metadata. */
    transformRecruitBuilding(targetUnitType: UnitType, reservationId: number): this {
        this.nodes.push(node(ChoreoTaskType.TRANSFORM_RECRUIT_BUILDING));
        this.meta({ unitType: targetUnitType, reservationId });
        return this;
    }

    /** Add a TRANSFORM_DIRECT node and stash unitType in metadata. */
    transformDirect(targetUnitType: UnitType): this {
        this.nodes.push(node(ChoreoTaskType.TRANSFORM_DIRECT));
        this.meta({ unitType: targetUnitType });
        return this;
    }

    /**
     * GO_TO_TARGET node targeting the approach tile of the given building.
     * Resolves approach tile via findBuildingApproachTile at build time.
     */
    goToDoor(buildingId: number, ctx: ChoreoBuilderContext): this {
        const building = ctx.gameState.getEntityOrThrow(buildingId, 'ChoreoBuilder.goToDoor');
        const tile = findBuildingApproachTile(building, ctx.terrain, ctx.gameState);
        return this.goTo(tile, buildingId);
    }

    /**
     * goToDoor + ENTER_BUILDING — walk to building and go inside.
     * The ENTER_BUILDING node carries `args.enterBuilding`; the legacy build() also stashes
     * `metadata.enterBuildingId`.
     */
    goToDoorAndEnter(buildingId: number, ctx: ChoreoBuilderContext): this {
        return this.goToDoor(buildingId, ctx).meta({ enterBuildingId: buildingId }).enterBuilding(buildingId);
    }

    /** Add an ENTER_BUILDING node entering `buildingId`. */
    enterBuilding(buildingId: number): this {
        this.nodes.push(node(ChoreoTaskType.ENTER_BUILDING, { args: { task: 'enterBuilding', buildingId } }));
        return this;
    }

    /** Add a WAIT_VIRTUAL node with visible:false. */
    hidden(duration: number, trigger?: string): this {
        // eslint-disable-next-line no-restricted-syntax -- trigger is an optional parameter; '' is the correct default when not provided
        this.nodes.push(node(ChoreoTaskType.WAIT_VIRTUAL, { duration, visible: false, trigger: trigger ?? '' }));
        return this;
    }

    /** Add a WAIT node. */
    wait(duration: number): this {
        this.nodes.push(node(ChoreoTaskType.WAIT, { duration }));
        return this;
    }

    /** Add an arbitrary node. */
    addNode(task: ChoreoTaskType, overrides?: Partial<ChoreoNode>): this {
        this.nodes.push(node(task, overrides));
        return this;
    }

    /** Set the target entity ID. */
    target(entityId: number): this {
        this._targetId = entityId;
        return this;
    }

    /** TRANSITIONAL (deleted in Cleanup): merge legacy metadata. Owned jobs use node args. */
    meta(data: Record<string, number | string>): this {
        if (!this._metadata) {
            this._metadata = {};
        }
        Object.assign(this._metadata, data);
        return this;
    }

    /**
     * Owned-job output for `JobKindHandler.build()`: nodes (GO_TO nodes with their walk goal,
     * synthetic nodes with their args) + the initial targets. Pure data.
     */
    toJobBuild(): JobBuild {
        const nodes = this.nodes.map((n, i) => {
            const goal = this.goals.get(i);
            return goal ? { ...n, goal } : n;
        });
        return { jobId: this.jobId, nodes, targetId: this._targetId, targetPos: this._targetPos };
    }

    /**
     * TRANSITIONAL (deleted in Cleanup): the legacy ChoreoJobState for `TaskDispatcher.assignJob`
     * (waypoints + metadata, no node goals, broadcast routing). New code uses {@link toJobBuild}.
     */
    build(): ChoreoJobState {
        const job = createChoreoJobState(this.jobId, this.nodes, true, this._kind);
        if (this._targetId !== null) {
            job.targetId = this._targetId;
        }
        if (this._targetPos) {
            job.targetPos = this._targetPos;
        }
        if (this.waypoints.length > 1) {
            job.waypoints = this.waypoints;
        }
        if (this._metadata) {
            job.metadata = this._metadata;
        }
        return job;
    }
}

/**
 * Start building a synthetic choreography job.
 * @param kind Domain category for demand event routing (defaults to Work).
 */
export function choreo(jobId: string, kind: JobKind = JobKind.Work): ChoreoBuilder {
    return new ChoreoBuilder(jobId, kind);
}
