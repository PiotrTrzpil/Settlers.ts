/**
 * JobRunner — runs a unit's work.
 *
 * The only place a choreography job is started, advanced node by node, completed or
 * interrupted, and the only owner of `entity.jobId` for live units (set on assign,
 * cleared on complete / interrupt). Also runs player move tasks.
 *
 * Implements TaskDispatcher (external job and move assignment) and WorkerStateQuery.
 * Node execution goes to the kernel ChoreoSystem with an explicit ChoreoExecutionScope
 * (the unit's home building + its work handlers). Never decides *what* to work on —
 * that is WorkerAutonomy (idle search) or an external dispatcher.
 */

import {
    EntityType,
    UnitType,
    BuildingType,
    clearJobId,
    getEntityIfType,
    tileKey,
    type Entity,
    type Tile,
    type TileWithEntity,
} from '../../entity';
import { createLogger } from '@/utilities/logger';
import type { ThrottledLogger } from '@/utilities/throttled-logger';
import { hexDistance } from '../../systems/hex-directions';
import { getBuildingDoorPos } from '../../data/game-data-access';
import type { GameState } from '../../game-state';
import type { EventBus } from '../../event-bus';
import type { ChoreoSystem, ChoreoExecutionScope } from '../../systems/choreo';
import type { TriggerSystem } from '../building-overlays';
import type { MaterialTransfer } from '../material-transfer';
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
import type { WorkerAssignments } from './worker-assignments';
import { safeCall } from './safe-call';
import { createTargetedJobState, homeBuildingIdOf, isPileActionNode, resetForNextNode } from './internal/job-progress';
import {
    emitTaskStarted,
    emitTaskFailed,
    emitNodeStarted,
    emitNodeCompleted,
    emitAnimationApplied,
} from './internal/job-events';

const log = createLogger('JobRunner');

export interface JobRunnerConfig {
    gameState: GameState;
    eventBus: EventBus;
    choreoSystem: ChoreoSystem;
    runtimes: UnitRuntimeStore;
    assignments: WorkerAssignments;
    settlerConfigs: ReadonlyMap<UnitType, SettlerConfig>;
    handlerRegistry: WorkHandlerRegistry;
    animController: IdleAnimationController;
    jobPartResolver: JobPartResolver;
    locationManager: ISettlerBuildingLocationManager;
    triggerSystem: TriggerSystem;
    materialTransfer: MaterialTransfer;
    handlerErrorLogger: ThrottledLogger;
}

export class JobRunner implements TaskDispatcher, WorkerStateQuery {
    private readonly gameState: GameState;
    private readonly eventBus: EventBus;
    private readonly choreoSystem: ChoreoSystem;
    private readonly runtimes: UnitRuntimeStore;
    private readonly assignments: WorkerAssignments;
    private readonly settlerConfigs: ReadonlyMap<UnitType, SettlerConfig>;
    private readonly handlerRegistry: WorkHandlerRegistry;
    private readonly animController: IdleAnimationController;
    private readonly jobPartResolver: JobPartResolver;
    private readonly locationManager: ISettlerBuildingLocationManager;
    private readonly triggerSystem: TriggerSystem;
    private readonly materialTransfer: MaterialTransfer;
    private readonly handlerErrorLogger: ThrottledLogger;

    /** Enable verbose choreography events (nodeStarted, nodeCompleted, animationApplied, waitingAtHome) */
    verbose = false;

    constructor(cfg: JobRunnerConfig) {
        this.gameState = cfg.gameState;
        this.eventBus = cfg.eventBus;
        this.choreoSystem = cfg.choreoSystem;
        this.runtimes = cfg.runtimes;
        this.assignments = cfg.assignments;
        this.settlerConfigs = cfg.settlerConfigs;
        this.handlerRegistry = cfg.handlerRegistry;
        this.animController = cfg.animController;
        this.jobPartResolver = cfg.jobPartResolver;
        this.locationManager = cfg.locationManager;
        this.triggerSystem = cfg.triggerSystem;
        this.materialTransfer = cfg.materialTransfer;
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
    // External assignment (TaskDispatcher)
    // ─────────────────────────────────────────────────────────────

    /**
     * Assign a choreography job to a unit, ending any current job first.
     * @param numericJobId When set (e.g. transport record id), reused as entity.jobId so the unit
     *   and domain job share one numeric identity. When omitted, allocates a new id.
     */
    assignJob(entityId: number, job: JobState, moveTo?: Tile, numericJobId?: number): boolean {
        const entity = this.gameState.getEntityOrThrow(entityId, 'unit for job assignment');
        const runtime = this.runtimes.getOrCreate(entityId);

        if (runtime.job) {
            const config = this.settlerConfigs.get(entity.subType as UnitType);
            if (config) {
                this.endJobForTakeover(entity, config, runtime);
            }
            runtime.job = null;
        }

        if (moveTo) {
            const moveSuccess = this.gameState.movement.moveUnit(entityId, moveTo);
            if (!moveSuccess) {
                return false;
            }
        }

        runtime.state = SettlerState.WORKING;
        runtime.job = job;
        runtime.moveTask = null;

        const jobNumericId = numericJobId ?? this.gameState.allocateJobId();
        entity.jobId = jobNumericId;

        log.debug(`Unit ${entityId} assigned job ${job.jobId} (numeric id ${jobNumericId})`);
        return true;
    }

    /** Player-style move: ends the current job, releases the home assignment, walks to `target`. */
    assignMoveTask(entityId: number, target: Tile): boolean {
        const entity = getEntityIfType(this.gameState, entityId, EntityType.Unit);
        if (!entity) {
            return false;
        }

        let moveTo: Tile = target;
        if (this.gameState.buildingOccupancy.has(tileKey(moveTo))) {
            const building = this.gameState.getGroundEntityAt(moveTo);
            if (building && building.type === EntityType.Building) {
                moveTo = getBuildingDoorPos(building, building.race, building.subType as BuildingType);
            }
        }

        const moveSuccess = this.gameState.movement.moveUnit(entityId, moveTo);
        if (!moveSuccess) {
            return false;
        }

        const runtime = this.runtimes.getOrCreate(entityId);
        const unitConfig = this.settlerConfigs.get(entity.subType as UnitType);
        if (runtime.job) {
            if (unitConfig) {
                this.endJobForTakeover(entity, unitConfig, runtime);
            }
            runtime.job = null;
        }

        if (unitConfig) {
            const posHandler = this.handlerRegistry.getPositionHandler(unitConfig.plantSearch ?? unitConfig.search);
            posHandler?.onSettlerRemoved?.(entityId, target.x, target.y);
        }

        this.assignments.release(entityId, runtime);

        runtime.moveTask = { type: 'move', targetX: target.x, targetY: target.y };
        runtime.state = SettlerState.WORKING;

        log.debug(`Unit ${entityId} assigned move task to (${target.x}, ${target.y})`);
        return true;
    }

    cancelMoveTask(entityId: number): void {
        const runtime = this.runtimes.get(entityId);
        if (runtime?.moveTask) {
            runtime.moveTask = null;
        }
    }

    /**
     * End the current job so another owner can take over: complete it when all nodes ran,
     * otherwise interrupt it. Caller drops `runtime.job` afterwards.
     */
    endJobForTakeover(entity: Entity, config: SettlerConfig, runtime: UnitRuntime): void {
        if (runtime.job!.nodeIndex >= runtime.job!.nodes.length) {
            this.completeJob(entity, runtime);
        } else {
            this.interruptJob(entity, config, runtime);
        }
    }

    // ─────────────────────────────────────────────────────────────
    // Per-tick execution
    // ─────────────────────────────────────────────────────────────

    /** Advance a user-initiated move task; ends it when the unit stops moving. */
    tickMoveTask(unit: Entity, runtime: UnitRuntime): void {
        const controller = this.gameState.movement.getController(unit.id);
        if (!controller) {
            // No movement controller — cancel task
            runtime.moveTask = null;
            runtime.state = SettlerState.IDLE;
            this.animController.setIdleAnimation(unit);
            return;
        }

        if (controller.state === 'idle') {
            runtime.moveTask = null;
            runtime.state = SettlerState.IDLE;
            this.animController.setIdleAnimation(unit);
            runtime.idleState.idleTime = 0;
            log.debug(`Unit ${unit.id} completed move task`);
        }
    }

    /** Run the current node of a WORKING unit's job; completes, advances or interrupts as the node reports. */
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
            this.completeJob(settler, runtime);
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
                this.interruptJob(settler, config, runtime);
                break;
            case TaskResult.CONTINUE:
                break;
        }
    }

    /** An interrupted unit returns to idle on its next tick. */
    clearInterrupted(runtime: UnitRuntime): void {
        runtime.state = SettlerState.IDLE;
        runtime.job = null;
    }

    // ─────────────────────────────────────────────────────────────
    // Job lifecycle
    // ─────────────────────────────────────────────────────────────

    /** Start a job chosen by the unit's own idle search (WorkerAutonomy). */
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

        const jobState = createTargetedJobState(selected, entityTarget, positionTarget);
        runtime.job = jobState;

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

    private completeJob(settler: Entity, runtime: UnitRuntime): void {
        if (!runtime.job) {
            return;
        }
        const job = runtime.job;

        this.stopActiveTrigger(runtime, job);

        const controller = this.gameState.movement.getController(settler.id);
        if (controller) {
            controller.busy = false;
        }

        log.debug(`Settler ${settler.id} completed job ${job.jobId}`);

        // Clear job reference and state BEFORE emitting, so that listeners calling
        // assignJob won't see a stale job and recurse into endJobForTakeover.
        runtime.state = SettlerState.IDLE;
        runtime.job = null;
        clearJobId(settler);

        this.eventBus.emit('settler:taskCompleted', {
            unitId: settler.id,
            unitType: settler.subType as UnitType,
            jobId: job.jobId,
            kind: job.kind,
        });

        if (this.locationManager.isInside(settler.id) && runtime.homeAssignment) {
            // Workers with a home assignment exit to search for new work.
            // Units placed inside by dispatch jobs (garrison, worker dispatch)
            // stay inside — the job intentionally placed them there.
            this.locationManager.exitBuilding(settler.id);
        }
        // No else — location manager is the sole owner of entity.hidden.
        // If settler is not inside a building, it's already visible.
        this.animController.setIdleAnimation(settler);

        if (runtime.homeAssignment) {
            const home = this.gameState.getEntity(runtime.homeAssignment.buildingId);
            if (home) {
                const door = getBuildingDoorPos(home, home.race, home.subType as BuildingType);
                if (hexDistance(settler.x, settler.y, door.x, door.y) <= 1) {
                    this.locationManager.enterBuilding(settler.id, home.id);
                }
            }
        }
    }

    /**
     * Interrupt a job (target gone, pathfinding failure, reassignment, …).
     * Must NOT be called when the job has already completed all nodes — use completeJob.
     */
    private interruptJob(settler: Entity, config: SettlerConfig, runtime: UnitRuntime): void {
        if (!runtime.job) {
            return;
        }

        const entityHandler = this.handlerRegistry.getEntityHandler(config.search);
        const job = runtime.job;

        job.onCancel?.();

        if (entityHandler && job.targetId && job.workStarted) {
            safeCall(
                () => entityHandler.onWorkInterrupt?.(job.targetId!, settler.id),
                this.handlerErrorLogger,
                `onWorkInterrupt failed for target ${job.targetId}`
            );
        }

        this.materialTransfer.drop(settler.id);

        this.stopActiveTrigger(runtime, job);

        // Only exit building for workers with a home assignment. Garrisoned units
        // (no homeAssignment) must stay inside — mirrors the completeJob logic.
        if (this.locationManager.isInside(settler.id) && runtime.homeAssignment) {
            this.locationManager.exitBuilding(settler.id);
        }

        const controller = this.gameState.movement.getController(settler.id);
        if (controller) {
            controller.busy = false;
        }

        log.debug(`Settler ${settler.id} interrupted job ${job.jobId}`);

        clearJobId(settler);
        emitTaskFailed(this.eventBus, settler, job);

        runtime.state = SettlerState.INTERRUPTED;
        this.animController.setIdleAnimation(settler);
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
            this.stopActiveTrigger(runtime, job);
            job.activeTrigger = '';
        }
        resetForNextNode(job);
    }

    /** Stop the building overlay trigger a work node started, if the unit still has a home. */
    private stopActiveTrigger(runtime: UnitRuntime, job: JobState): void {
        if (!job.activeTrigger) {
            return;
        }
        const homeId = homeBuildingIdOf(runtime);
        if (homeId !== null) {
            this.triggerSystem.stopTrigger(homeId, job.activeTrigger);
        }
    }

    private applyChoreoAnimation(settler: Entity, node: ChoreoNode): void {
        // Empty jobPart is normal for synthetic builder GO_TO nodes — walk animation is
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
