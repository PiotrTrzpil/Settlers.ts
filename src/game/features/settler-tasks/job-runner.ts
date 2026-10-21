/**
 * JobRunner — runs a unit's work.
 *
 * The only place a choreography job is started and advanced node by node; how a job ends
 * (complete / fail / preempt / cancel) is JobOutcomes. Sets the unit's commitment when a job
 * or move starts. Move tasks (player / siege moves) run in MoveTaskRunner.
 *
 * Implements TaskDispatcher (move assignment) and WorkerStateQuery.
 * Node execution goes to the kernel ChoreoSystem with an explicit ChoreoExecutionScope
 * (the unit's home building + its work handlers). Never decides *what* to work on —
 * that is WorkerAutonomy (idle search) or JobService (owned jobs).
 */

import { UnitType, type Entity, type Tile, type TileWithEntity } from '../../entity';
import { createLogger } from '@/utilities/logger';
import type { ThrottledLogger } from '@/utilities/throttled-logger';
import type { GameState } from '../../game-state';
import type { EventBus } from '../../event-bus';
import { JobKind, type ChoreoSystem, type ChoreoExecutionScope } from '../../systems/choreo';
import type { CommitmentOwner, UnitCommitmentWriter } from '../../systems/unit-commitment';
import type { ISettlerBuildingLocationManager } from '../settler-location';
import {
    TaskResult,
    SettlerState,
    type JobState,
    type SettlerConfig,
    type TaskDispatcher,
    type WorkerStateQuery,
} from './types';
import { ChoreoTaskType, type ChoreoJob, type ChoreoNode, type JobPartResolver } from './choreo-types';
import type { WorkHandlerRegistry } from './work-handler-registry';
import type { IdleAnimationController } from './idle-animation-controller';
import type { UnitRuntime, UnitRuntimeStore } from './unit-runtime';
import { createTargetedJobState, homeBuildingIdOf, isPileActionNode, resetForNextNode } from './internal/job-progress';
import { emitTaskStarted, emitNodeStarted, emitNodeCompleted, emitAnimationApplied } from './internal/job-events';
import type { JobOutcomes } from './internal/job-outcomes';
import { stopActiveTrigger, type JobTeardownDeps } from './internal/job-teardown';
import type { MoveTaskRunner } from './internal/move-tasks';

const log = createLogger('JobRunner');

export interface JobRunnerConfig {
    gameState: GameState;
    eventBus: EventBus;
    choreoSystem: ChoreoSystem;
    runtimes: UnitRuntimeStore;
    handlerRegistry: WorkHandlerRegistry;
    animController: IdleAnimationController;
    jobPartResolver: JobPartResolver;
    locationManager: ISettlerBuildingLocationManager;
    outcomes: JobOutcomes;
    moveTasks: MoveTaskRunner;
    commitmentWriter: UnitCommitmentWriter;
    teardown: JobTeardownDeps;
    handlerErrorLogger: ThrottledLogger;
}

export class JobRunner implements TaskDispatcher, WorkerStateQuery {
    private readonly gameState: GameState;
    private readonly eventBus: EventBus;
    private readonly choreoSystem: ChoreoSystem;
    private readonly runtimes: UnitRuntimeStore;
    private readonly handlerRegistry: WorkHandlerRegistry;
    private readonly animController: IdleAnimationController;
    private readonly jobPartResolver: JobPartResolver;
    private readonly locationManager: ISettlerBuildingLocationManager;
    private readonly outcomes: JobOutcomes;
    private readonly moveTasks: MoveTaskRunner;
    private readonly writer: UnitCommitmentWriter;
    private readonly teardown: JobTeardownDeps;
    private readonly handlerErrorLogger: ThrottledLogger;

    /** Enable verbose choreography events (nodeStarted, nodeCompleted, animationApplied, waitingAtHome) */
    verbose = false;

    constructor(cfg: JobRunnerConfig) {
        this.gameState = cfg.gameState;
        this.eventBus = cfg.eventBus;
        this.choreoSystem = cfg.choreoSystem;
        this.runtimes = cfg.runtimes;
        this.handlerRegistry = cfg.handlerRegistry;
        this.animController = cfg.animController;
        this.jobPartResolver = cfg.jobPartResolver;
        this.locationManager = cfg.locationManager;
        this.outcomes = cfg.outcomes;
        this.moveTasks = cfg.moveTasks;
        this.writer = cfg.commitmentWriter;
        this.teardown = cfg.teardown;
        this.handlerErrorLogger = cfg.handlerErrorLogger;
    }

    // ─────────────────────────────────────────────────────────────
    // Queries (WorkerStateQuery)
    // ─────────────────────────────────────────────────────────────

    getActiveJobId(entityId: number): string | null {
        // eslint-disable-next-line no-restricted-syntax -- optional chaining; null when source is absent
        return this.runtimes.get(entityId)?.job?.jobId ?? null;
    }

    getSettlerState(entityId: number): SettlerState | null {
        // eslint-disable-next-line no-restricted-syntax -- Map.get() returns undefined for missing keys
        return this.runtimes.get(entityId)?.state ?? null;
    }

    /** True while the unit runs a job or a move task. */
    isWorking(entityId: number): boolean {
        const runtime = this.runtimes.get(entityId);
        if (!runtime) {
            return false;
        }
        return runtime.state === SettlerState.WORKING || runtime.moveTask !== null;
    }

    hasMoveTask(entityId: number): boolean {
        const runtime = this.runtimes.get(entityId);
        return runtime !== undefined && runtime.moveTask !== null;
    }

    // ─────────────────────────────────────────────────────────────
    // Assignment (JobService) and move tasks (TaskDispatcher)
    // ─────────────────────────────────────────────────────────────

    /**
     * Start a job on a unit, preempting whatever owns it now (its owner gets onFailed 'preempted' /
     * onPreempted), and commit the unit to the job's owner. Returns false when `moveTo` is unreachable
     * (the previous job has ended by then).
     */
    startAssignedJob(entityId: number, job: JobState, reserved: boolean, moveTo?: Tile): boolean {
        const entity = this.gameState.getEntityOrThrow(entityId, 'unit for job assignment');
        const runtime = this.runtimes.getOrCreate(entityId);

        this.outcomes.takeOver(entity, runtime, job.kind);

        if (moveTo) {
            const moveSuccess = this.gameState.movement.moveUnit(entityId, moveTo);
            if (!moveSuccess) {
                return false;
            }
        }

        runtime.state = SettlerState.WORKING;
        runtime.job = job;
        runtime.moveTask = null;
        this.writer.set(entityId, { owner: job.kind, ref: job.ref, reserved, hasJob: true });

        log.debug(`Unit ${entityId} assigned job ${job.jobId} (${job.kind}, ref ${job.ref})`);
        return true;
    }

    /** Move task (player move / siege move) — see MoveTaskRunner. */
    assignMoveTask(entityId: number, target: Tile, owner: CommitmentOwner = 'player-move'): boolean {
        return this.moveTasks.assign(entityId, target, owner);
    }

    // ─────────────────────────────────────────────────────────────
    // Per-tick execution
    // ─────────────────────────────────────────────────────────────

    /** Run the current node of a WORKING unit's job; completes, advances or fails as the node reports. */
    tickJob(settler: Entity, config: SettlerConfig, runtime: UnitRuntime, dt: number): void {
        if (!runtime.job) {
            throw new Error(
                `tickJob: settler ${settler.id} (${settler.subType as UnitType}) ` +
                    `is in WORKING state but has no job. ` +
                    `homeAssignment=${homeBuildingIdOf(runtime)}`
            );
        }
        const job = runtime.job;
        const nodes = job.nodes;
        if (job.nodeIndex >= nodes.length) {
            this.outcomes.complete(settler, runtime);
            return;
        }

        const node = nodes[job.nodeIndex]!;
        this.prepareNodeTick(settler, runtime, job, node);
        const scope = this.createExecutionScope(runtime, config);

        const controller = isPileActionNode(node) ? this.gameState.movement.getController(settler.id) : undefined;
        if (controller) {
            controller.busy = true;
        }

        const result = this.executeNode(settler, job, node, dt, scope);

        if (controller && result !== TaskResult.CONTINUE) {
            controller.busy = false;
        }

        switch (result) {
            case TaskResult.DONE:
                this.advanceToNextNode(settler, runtime, job);
                break;
            case TaskResult.FAILED:
                this.outcomes.fail(settler, runtime, 'failed');
                break;
            case TaskResult.CONTINUE:
                break;
        }
    }

    /** An interrupted unit returns to idle on its next tick (its job was cleared when it ended). */
    clearInterrupted(runtime: UnitRuntime): void {
        runtime.state = SettlerState.IDLE;
    }

    // ─────────────────────────────────────────────────────────────
    // Job lifecycle
    // ─────────────────────────────────────────────────────────────

    /** Start a Work job chosen by the unit's own idle search (WorkerAutonomy). */
    startJob(
        settler: Entity,
        runtime: UnitRuntime,
        selected: ChoreoJob,
        entityTarget: TileWithEntity | null,
        homeBuilding: Entity | null,
        positionTarget: Tile | null
    ): void {
        if (this.locationManager.isInside(settler.id)) {
            this.locationManager.exitBuilding(settler.id);
        }
        runtime.state = SettlerState.WORKING;

        const ref = homeBuilding?.id ?? -1;
        const jobState = createTargetedJobState(selected, entityTarget, positionTarget, ref);
        runtime.job = jobState;
        this.writer.set(settler.id, { owner: JobKind.Work, ref, reserved: false, hasJob: true });

        const posStr = positionTarget ? `(${positionTarget.x},${positionTarget.y})` : 'none';
        log.debug(
            `Settler ${settler.id} starting choreo job ${selected.id}, ` +
                // eslint-disable-next-line no-restricted-syntax -- nullable field with display/config default
                `target ${entityTarget?.entityId ?? 'none'}, pos ${posStr}, ` +
                // eslint-disable-next-line no-restricted-syntax -- nullable field with display/config default
                `home ${homeBuilding?.id ?? 'none'}`
        );

        emitTaskStarted(this.eventBus, settler, jobState, homeBuilding);
    }

    // ─────────────────────────────────────────────────────────────
    // Node helpers
    // ─────────────────────────────────────────────────────────────

    /** First tick of a node: apply its animation and enter/leave the home building per `node.visible`. */
    private prepareNodeTick(settler: Entity, runtime: UnitRuntime, job: JobState, node: ChoreoNode): void {
        if (job.progress >= 0) {
            return;
        }
        this.applyChoreoAnimation(settler, node);
        if (this.verbose) {
            emitNodeStarted(this.eventBus, settler, job, node);
        }

        // Location manager is the sole owner of entity.hidden — all visibility
        // transitions go through enterBuilding / exitBuilding.
        const buildingId = homeBuildingIdOf(runtime);
        if (buildingId !== null) {
            const isInside = this.locationManager.isInside(settler.id);
            if (!node.visible && !isInside) {
                this.locationManager.enterBuilding(settler.id, buildingId);
            } else if (node.visible && isInside) {
                this.locationManager.exitBuilding(settler.id);
            }
        } else if (!node.visible) {
            // All visible=false nodes (WAIT_VIRTUAL) belong to settlers with a home building.
            throw new Error(
                `prepareNodeTick: settler ${settler.id} has visible=false node ` +
                    `(${ChoreoTaskType[node.task]}) but no home building — cannot hide without a building`
            );
        }

        job.progress = 0;
    }

    /** The unit's workplace and the work handlers registered for its search types. */
    private createExecutionScope(runtime: UnitRuntime, config: SettlerConfig): ChoreoExecutionScope {
        return {
            homeBuildingId: homeBuildingIdOf(runtime),
            entityHandler: this.handlerRegistry.getEntityHandler(config.search),
            positionHandler: this.handlerRegistry.getPositionHandler(config.plantSearch ?? config.search),
        };
    }

    private executeNode(
        settler: Entity,
        job: JobState,
        node: ChoreoNode,
        dt: number,
        scope: ChoreoExecutionScope
    ): TaskResult {
        try {
            return this.choreoSystem.execute(settler, job, node, dt, scope);
        } catch (e) {
            this.handlerErrorLogger.error(
                `Executor crash: settler=${settler.id} job=${job.jobId} nodeIdx=${job.nodeIndex} task=${node.task}`,
                e instanceof Error ? e : new Error(String(e))
            );
            return TaskResult.FAILED;
        }
    }

    private advanceToNextNode(settler: Entity, runtime: UnitRuntime, job: JobState): void {
        if (this.verbose) {
            emitNodeCompleted(this.eventBus, settler, job);
        }
        if (job.activeTrigger) {
            stopActiveTrigger(this.teardown, runtime, job);
            job.activeTrigger = '';
        }
        resetForNextNode(job);
    }

    private applyChoreoAnimation(settler: Entity, node: ChoreoNode): void {
        // Empty jobPart is normal for builder-made GO_TO nodes — walk animation is
        // owned by UnitVisualSync when the movement controller is moving, not by jobs.
        if (!node.jobPart) {
            return;
        }
        const resolution = this.jobPartResolver.resolve(node.jobPart, settler);
        if (!node.forward) {
            resolution.reverse = true;
        }
        this.animController.applyChoreoAnimation(settler, resolution);
        if (this.verbose) {
            emitAnimationApplied(this.eventBus, settler, node, resolution);
        }
    }
}
