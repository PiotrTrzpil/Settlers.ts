/**
 * RecruitSegments — the carrier → specialist transform as a reusable job prefix.
 *
 * A {@link RecruitSegment} is plain JSON data (it lives inside a JobKind's `params`): which unit
 * type the carrier becomes and where the transform's source is. Owners turn it into nodes inside
 * their own `JobKindHandler.build()` with {@link RecruitSegments.prefix} (walk to the source +
 * TRANSFORM_* node carrying `args.transform`) and append their continuation (walk to the site,
 * DIG_TILE, ENTER_BUILDING, …).
 *
 * The source reservation (tool pile / building materials) is keyed by the carrier and lives
 * exactly as long as the TRANSFORM_* node is pending: {@link RecruitSegments.reserve} makes it
 * before `jobs.assign`, the executor consumes it, and the node hooks release it (`onAbort`) or
 * re-make it after a load (`onRestore`). Owners never release anything themselves.
 *
 * See docs/designs/job-ownership.md ("Recruit migration notes").
 */

import type { GameState } from '../../game-state';
import type { BuildingType } from '../../buildings/building-type';
import type { UnitType } from '../../core/unit-types';
import { ChoreoTaskType, type ChoreoNode, type ChoreoNodeHooks, type JobBuild } from '../../systems/choreo';
import { choreo } from '../../systems/choreo/choreo-builder';
import type { InventorySide, MaterialCost } from './tool-source-resolver';
import type { TransformSource, UnitTransformer } from './unit-transformer';

/** Where the transform takes its tool / materials from. */
export type RecruitSourceKind = 'pile' | 'building' | 'direct';

/**
 * One transform, as JSON-serializable job params. Flat on purpose: `JobParams` allows one level of
 * nesting, so a segment fits as a param value (`{ recruit: RecruitSegment }`).
 */
export type RecruitSegment = {
    readonly targetUnitType: UnitType;
    readonly source: RecruitSourceKind;
    /** Tool pile entity id ('pile') / building id ('building'); null for 'direct'. */
    readonly sourceId: number | null;
    /**
     * Walk goal before the transform (the pile tile / the building slot or door); null for 'direct'
     * (the carrier transforms where it stands). Owners may replace it (e.g. a barracks door).
     */
    readonly at: { readonly x: number; readonly y: number } | null;
};

/** What a building charges for turning a carrier into a unit type (e.g. barracks recipe inputs). */
export interface BuildingRecruitCharge {
    readonly costs: readonly MaterialCost[];
    readonly side: InventorySide;
}

/** Resolves a building's charge; registered per building type by the owning feature. */
export type BuildingRecruitChargeFn = (buildingId: number, targetUnitType: UnitType) => BuildingRecruitCharge;

export interface RecruitSegments {
    /** The transform prefix nodes: walk to `segment.at` (goal on the source entity) + TRANSFORM_* with args. */
    nodes(segment: RecruitSegment): ChoreoNode[];
    /**
     * `nodes(segment)` followed by `continuation`'s nodes, as one JobBuild (jobId from the
     * continuation; initial targets = the source, or the continuation's for 'direct').
     */
    prefix(segment: RecruitSegment, continuation: JobBuild): JobBuild;
    /**
     * Reserve the segment's source for `carrierId` (keyed by the carrier). Call right before
     * `jobs.assign`; false ⇒ the source is gone / taken — do not assign. If the assign itself fails,
     * call {@link release}. Afterwards the TRANSFORM_* node owns the reservation.
     */
    reserve(carrierId: number, segment: RecruitSegment): boolean;
    /** Undo {@link reserve} when the job could not be assigned (the only manual release). */
    release(carrierId: number): void;
    /**
     * Register the charge of a building type's transforms ('building' sources). Needed because the
     * TRANSFORM_RECRUIT_BUILDING node only carries the building id — the hooks re-resolve the costs.
     */
    registerBuildingCharge(buildingType: BuildingType, charge: BuildingRecruitChargeFn): void;
    /** The registered charge of `buildingId` for `targetUnitType` (throws if its type registered none). */
    chargeFor(buildingId: number, targetUnitType: UnitType): BuildingRecruitCharge;
}

/** TRANSFORM_* task type per source kind. */
const TRANSFORM_TASK: Readonly<Record<RecruitSourceKind, ChoreoTaskType>> = {
    pile: ChoreoTaskType.TRANSFORM_RECRUIT,
    building: ChoreoTaskType.TRANSFORM_RECRUIT_BUILDING,
    direct: ChoreoTaskType.TRANSFORM_DIRECT,
};

/** Source kind per TRANSFORM_* task type (inverse of TRANSFORM_TASK). */
const SOURCE_OF_TASK: ReadonlyMap<ChoreoTaskType, RecruitSourceKind> = new Map(
    (Object.keys(TRANSFORM_TASK) as RecruitSourceKind[]).map(kind => [TRANSFORM_TASK[kind], kind])
);

/** Source kind of a TRANSFORM_* task type. */
function sourceKindOf(task: ChoreoTaskType): RecruitSourceKind {
    const kind = SOURCE_OF_TASK.get(task);
    if (kind === undefined) {
        throw new Error(`Task ${String(task)} is not a TRANSFORM_* task`);
    }
    return kind;
}

/** The transform args of a TRANSFORM_* node built by RecruitSegments (owned jobs). */
export function transformArgsOf(node: ChoreoNode): { readonly unitType: UnitType; readonly sourceId: number | null } {
    if (!node.args || node.args.task !== 'transform') {
        throw new Error(`${String(node.task)} node has no transform args`);
    }
    return node.args;
}

export class RecruitSegmentsImpl implements RecruitSegments {
    private readonly charges = new Map<BuildingType, BuildingRecruitChargeFn>();

    constructor(
        private readonly gameState: GameState,
        private readonly transformer: UnitTransformer
    ) {}

    nodes(segment: RecruitSegment): ChoreoNode[] {
        const task = TRANSFORM_TASK[segment.source];
        const args = { task: 'transform', unitType: segment.targetUnitType, sourceId: segment.sourceId } as const;
        const builder = choreo('RECRUIT_SEGMENT');
        if (segment.source !== 'direct') {
            builder.goTo(segment.at!, segment.sourceId!);
        }
        return builder.addNode(task, { args }).toJobBuild().nodes;
    }

    prefix(segment: RecruitSegment, continuation: JobBuild): JobBuild {
        const nodes = [...this.nodes(segment), ...continuation.nodes];
        if (segment.source === 'direct') {
            return { ...continuation, nodes };
        }
        return { ...continuation, nodes, targetId: segment.sourceId, targetPos: segment.at };
    }

    reserve(carrierId: number, segment: RecruitSegment): boolean {
        const source = this.resolve(segment.source, segment.sourceId, segment.targetUnitType);
        return source !== null && this.transformer.reserveTransform(carrierId, segment.targetUnitType, source);
    }

    release(carrierId: number): void {
        this.transformer.abortTransform(carrierId);
    }

    registerBuildingCharge(buildingType: BuildingType, charge: BuildingRecruitChargeFn): void {
        if (this.charges.has(buildingType)) {
            throw new Error(`Recruit charge already registered for building type ${buildingType}`);
        }
        this.charges.set(buildingType, charge);
    }

    chargeFor(buildingId: number, targetUnitType: UnitType): BuildingRecruitCharge {
        const building = this.gameState.getEntityOrThrow(buildingId, 'recruit charge building');
        const charge = this.charges.get(building.subType as BuildingType);
        if (!charge) {
            throw new Error(
                `No recruit charge registered for building type ${building.subType} (building ${buildingId})`
            );
        }
        return charge(buildingId, targetUnitType);
    }

    /**
     * Node hooks for TRANSFORM_* task types: irreversible once done; `onAbort` releases the
     * carrier's reservation; `onRestore` re-reserves it (false when the source is gone / taken).
     * The release is keyed by the unit, so it happens exactly once.
     */
    createTransformHooks(): ChoreoNodeHooks {
        return {
            irreversible: true,
            onAbort: unitId => this.transformer.abortTransform(unitId),
            onRestore: (unitId, node) => {
                const { unitType, sourceId } = transformArgsOf(node);
                const source = this.resolve(sourceKindOf(node.task), sourceId, unitType);
                return source !== null && this.transformer.reserveTransform(unitId, unitType, source);
            },
        };
    }

    /** Segment source → what to reserve; null when the source building no longer exists. */
    private resolve(kind: RecruitSourceKind, sourceId: number | null, unitType: UnitType): TransformSource | null {
        switch (kind) {
            case 'pile':
                return { kind: 'pile', pileEntityId: sourceId! };
            case 'building': {
                const buildingId = sourceId!;
                if (!this.gameState.getEntity(buildingId)) {
                    return null;
                }
                return { kind: 'building', buildingId, ...this.chargeFor(buildingId, unitType) };
            }
            case 'direct':
                return { kind: 'direct' };
        }
    }
}
