/**
 * Fluent builder for ChoreoJobState — ergonomic alternative to verbose node literals.
 *
 * Lives in systems/choreo/ (layer 0) so it can be used by both systems and features.
 * Does NOT break XML-parsed jobs — ChoreoNode interface is unchanged.
 */

import type { GameState } from '@/game/game-state';
import type { TerrainData } from '@/game/terrain';
import { findBuildingApproachTile } from '@/game/buildings/approach';
import { ChoreoTaskType, createChoreoJobState, type ChoreoNode, type ChoreoJobState } from './types';
import type { UnitType } from '@/game/core/unit-types';
import type { Tile } from '@/game/core/coordinates';

// ─────────────────────────────────────────────────────────────
// Context injection for building-aware helpers
// ─────────────────────────────────────────────────────────────

/** Context needed by goToDoor to resolve approach tiles at build time. */
export interface ChoreoBuilderContext {
    gameState: GameState;
    terrain: TerrainData;
}

let _context: ChoreoBuilderContext | null = null;

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
    private readonly waypoints: Array<{ x: number; y: number; entityId?: number }> = [];
    private _targetId: number | null = null;
    private _targetPos: Tile | null = null;
    private _metadata: Record<string, number | string> | undefined;
    private _goToCount = 0;

    /**
     * Inject context for building-aware helpers (goToDoor etc.).
     * Called once at startup; reused across all subsequent builds.
     */
    static withContext(ctx: ChoreoBuilderContext): typeof ChoreoBuilder {
        _context = ctx;
        return ChoreoBuilder;
    }

    constructor(private readonly jobId: string) {}

    /** Add a GO_TO_TARGET node. First call sets targetPos; subsequent calls push waypoints. */
    goTo(x: number, y: number, entityId?: number): this {
        this.nodes.push(node(ChoreoTaskType.GO_TO_TARGET));
        if (this._goToCount === 0) {
            this._targetPos = { x, y };
            if (entityId !== undefined) {
                this._targetId = entityId;
            }
        }
        this.waypoints.push(entityId !== undefined ? { x, y, entityId } : { x, y });
        this._goToCount++;
        return this;
    }

    /** Add a TRANSFORM_RECRUIT node and stash unitType in metadata. */
    transformRecruit(targetUnitType: UnitType): this {
        this.nodes.push(node(ChoreoTaskType.TRANSFORM_RECRUIT));
        this.meta({ unitType: targetUnitType });
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
    goToDoor(buildingId: number): this {
        if (!_context) {
            throw new Error(
                'ChoreoBuilder: context not set — call ' + 'ChoreoBuilder.withContext() before using goToDoor'
            );
        }
        const building = _context.gameState.getEntityOrThrow(buildingId, 'ChoreoBuilder.goToDoor');
        const tile = findBuildingApproachTile(building, _context.terrain, _context.gameState);
        return this.goTo(tile.x, tile.y, buildingId);
    }

    /**
     * goToDoor + ENTER_BUILDING — walk to building and go inside.
     * Stashes buildingId in metadata as `enterBuildingId`.
     */
    goToDoorAndEnter(buildingId: number): this {
        return this.goToDoor(buildingId).meta({ enterBuildingId: buildingId }).enterBuilding();
    }

    /** Add an ENTER_BUILDING node. */
    enterBuilding(): this {
        this.nodes.push(node(ChoreoTaskType.ENTER_BUILDING));
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

    /** Add a CHANGE_TYPE_AT_BARRACKS node. */
    changeTypeAtBarracks(): this {
        this.nodes.push(node(ChoreoTaskType.CHANGE_TYPE_AT_BARRACKS));
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

    /** Merge typed metadata. */
    meta(data: Record<string, number | string>): this {
        if (!this._metadata) {
            this._metadata = {};
        }
        Object.assign(this._metadata, data);
        return this;
    }

    /** Build the final ChoreoJobState. */
    build(): ChoreoJobState {
        const job = createChoreoJobState(this.jobId, this.nodes, true);
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

/** Start building a choreography job. */
export function choreo(jobId: string): ChoreoBuilder {
    return new ChoreoBuilder(jobId);
}
