/**
 * WorkerJobLifecycle — extracted job start/complete/interrupt and node-tick helpers.
 *
 * These methods were moved out of WorkerTaskExecutor to keep that class under
 * the max-lines limit while preserving the same logic.
 */

import { type Entity, UnitType } from '../../../entity';
import { createLogger } from '@/utilities/logger';
import { hexDistance } from '../../../systems/hex-directions';
import { TaskResult, SettlerState, type SettlerConfig } from '../types';
import {
    ChoreoTaskType,
    createChoreoJobState,
    type ChoreoJobState,
    type ChoreoNode,
    type ChoreoJob,
    type JobPartResolution,
    type MovementContext,
    type WorkContext,
    type TriggerSystem,
    type JobPartResolver,
} from '../choreo-types';
import type { ChoreoSystem } from '../../../systems/choreo';
import type { WorkHandlerRegistry } from '../work-handler-registry';
import type { IdleAnimationController } from '../idle-animation-controller';
import type { GameState } from '../../../game-state';
import type { EventBus } from '../../../event-bus';
import type { MaterialTransfer } from '../../material-transfer';
import type { ISettlerBuildingLocationManager } from '../../settler-location';
import type { ThrottledLogger } from '@/utilities/throttled-logger';
import { getBuildingDoorPos } from '../../../data/game-data-access';
import { BuildingType } from '../../../buildings/building-type';
import { safeCall } from '../safe-call';
import type { WorkerRuntimeState } from '../worker-task-executor';

const log = createLogger('WorkerJobLifecycle');

export interface WorkerJobLifecycleCfg {
    choreoSystem: ChoreoSystem;
    handlerRegistry: WorkHandlerRegistry;
    animController: IdleAnimationController;
    jobPartResolver: JobPartResolver;
    locationManager: ISettlerBuildingLocationManager;
    gameState: GameState;
    triggerSystem: TriggerSystem;
    materialTransfer: MaterialTransfer;
    handlerErrorLogger: ThrottledLogger;
    eventBus: EventBus;
    getWorkerHomeBuilding: (id: number) => number | null;
    /** Mutable context objects shared with WorkerTaskExecutor — mutated in-place each tick */
    movementCtx: MovementContext;
    workCtx: WorkContext;
    /** Dynamic getter for verbose flag */
    getVerbose: () => boolean;
}

export class WorkerJobLifecycle {
    private readonly choreoSystem: ChoreoSystem;
    private readonly handlerRegistry: WorkHandlerRegistry;
    private readonly animController: IdleAnimationController;
    private readonly jobPartResolver: JobPartResolver;
    private readonly locationManager: ISettlerBuildingLocationManager;
    private readonly gameState: GameState;
    private readonly triggerSystem: TriggerSystem;
    private readonly materialTransfer: MaterialTransfer;
    private readonly handlerErrorLogger: ThrottledLogger;
    private readonly eventBus: EventBus;
    private readonly getWorkerHomeBuilding: (id: number) => number | null;
    private readonly movementCtx: MovementContext;
    private readonly workCtx: WorkContext;
    private readonly getVerbose: () => boolean;

    constructor(cfg: WorkerJobLifecycleCfg) {
        this.choreoSystem = cfg.choreoSystem;
        this.handlerRegistry = cfg.handlerRegistry;
        this.animController = cfg.animController;
        this.jobPartResolver = cfg.jobPartResolver;
        this.locationManager = cfg.locationManager;
        this.gameState = cfg.gameState;
        this.triggerSystem = cfg.triggerSystem;
        this.materialTransfer = cfg.materialTransfer;
        this.handlerErrorLogger = cfg.handlerErrorLogger;
        this.eventBus = cfg.eventBus;
        this.getWorkerHomeBuilding = cfg.getWorkerHomeBuilding;
        this.movementCtx = cfg.movementCtx;
        this.workCtx = cfg.workCtx;
        this.getVerbose = cfg.getVerbose;
    }

    private get verbose(): boolean {
        return this.getVerbose();
    }

    startJob(
        settler: Entity,
        runtime: WorkerRuntimeState,
        selected: ChoreoJob,
        entityTarget: { entityId: number; x: number; y: number } | null,
        homeBuilding: Entity | null,
        positionTarget?: { x: number; y: number } | null
    ): void {
        if (this.locationManager.isInside(settler.id)) {
            this.locationManager.exitBuilding(settler.id);
        }
        runtime.state = SettlerState.WORKING;

        const jobState = createChoreoJobState(selected.id, selected.nodes);
        if (entityTarget) {
            jobState.targetId = entityTarget.entityId;
            jobState.targetPos = { x: entityTarget.x, y: entityTarget.y };
        } else if (positionTarget) {
            jobState.targetPos = { x: positionTarget.x, y: positionTarget.y };
        }
        runtime.job = jobState;

        const posStr = positionTarget ? `(${positionTarget.x},${positionTarget.y})` : 'none';
        log.debug(
            `Settler ${settler.id} starting choreo job ${selected.id}, ` +
                `target ${entityTarget?.entityId ?? 'none'}, pos ${posStr}, ` +
                `home ${homeBuilding?.id ?? 'none'}`
        );

        this.eventBus.emit('settler:taskStarted', {
            unitId: settler.id,
            unitType: settler.subType as UnitType,
            jobId: selected.id,
            targetId: entityTarget?.entityId ?? null,
            targetPos: jobState.targetPos,
            homeBuilding: homeBuilding?.id ?? null,
        });
    }

    completeJob(settler: Entity, runtime: WorkerRuntimeState): void {
        if (!runtime.job) {
            return;
        }
        const job = runtime.job;

        if (job.activeTrigger) {
            const homeId = this.getWorkerHomeBuilding(settler.id);
            if (homeId !== null) {
                this.triggerSystem.stopTrigger(homeId, job.activeTrigger);
            }
        }

        const controller = this.gameState.movement.getController(settler.id);
        if (controller) {
            controller.busy = false;
        }

        log.debug(`Settler ${settler.id} completed job ${job.jobId}`);

        // Clear job reference and state BEFORE emitting, so that listeners calling
        // assignJob won't see a stale job and recurse into interruptJobForCleanup.
        runtime.state = SettlerState.IDLE;
        runtime.job = null;

        this.eventBus.emit('settler:taskCompleted', {
            unitId: settler.id,
            unitType: settler.subType as UnitType,
            jobId: job.jobId,
        });

        if (this.locationManager.isInside(settler.id)) {
            // Workers with a home assignment exit to search for new work.
            // Units placed inside by dispatch jobs (garrison, worker dispatch)
            // stay inside — the job intentionally placed them there.
            if (runtime.homeAssignment) {
                this.locationManager.exitBuilding(settler.id);
            }
        } else {
            settler.hidden = false;
        }
        this.animController.setIdleAnimation(settler);

        if (runtime.homeAssignment) {
            const home = this.gameState.getEntity(runtime.homeAssignment.buildingId);
            if (home) {
                const door = getBuildingDoorPos(home.x, home.y, home.race, home.subType as BuildingType);
                if (hexDistance(settler.x, settler.y, door.x, door.y) <= 1) {
                    this.locationManager.enterBuilding(settler.id, home.id);
                }
            }
        }
    }

    interruptJob(settler: Entity, config: SettlerConfig, runtime: WorkerRuntimeState): void {
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

        if (job.activeTrigger) {
            const homeId = this.getWorkerHomeBuilding(settler.id);
            if (homeId !== null) {
                this.triggerSystem.stopTrigger(homeId, job.activeTrigger);
            }
        }

        if (this.locationManager.isInside(settler.id)) {
            this.locationManager.exitBuilding(settler.id);
        }

        const controller = this.gameState.movement.getController(settler.id);
        if (controller) {
            controller.busy = false;
        }

        log.debug(`Settler ${settler.id} interrupted job ${job.jobId}`);

        const failedNode = job.nodes[job.nodeIndex];
        const failedStep = failedNode ? ChoreoTaskType[failedNode.task] : 'unknown';

        this.eventBus.emit('settler:taskFailed', {
            unitId: settler.id,
            unitType: settler.subType as UnitType,
            jobId: job.jobId,
            nodeIndex: job.nodeIndex,
            failedStep,
            targetId: job.targetId ?? null,
            workStarted: job.workStarted,
            wasCarrying: !!settler.carrying,
            level: 'warn',
        });

        runtime.state = SettlerState.INTERRUPTED;
        this.animController.setIdleAnimation(settler);
    }

    returnHomeAndWait(
        settler: Entity,
        homeBuilding: Entity,
        reason?: 'output_full' | 'cant_work' | 'first_visit'
    ): void {
        // Settler is already inside their building — nothing to do.
        // This can happen when enterBuilding() removed the movement controller
        // but the settler hasn't marked hasVisited yet on the next idle tick.
        if (this.locationManager.isInside(settler.id)) {
            return;
        }

        const controller = this.gameState.movement.getController(settler.id);
        if (!controller) {
            this.handlerErrorLogger.error(
                `Settler ${settler.id} has no movement controller in returnHomeAndWait`,
                new Error(`Settler ${settler.id} has no movement controller`)
            );
            return;
        }

        const door = getBuildingDoorPos(
            homeBuilding.x,
            homeBuilding.y,
            homeBuilding.race,
            homeBuilding.subType as BuildingType
        );
        const dist = hexDistance(settler.x, settler.y, door.x, door.y);

        if (dist <= 1) {
            if (this.verbose && reason) {
                this.emitWaitingAtHome(settler, homeBuilding, reason);
            }
            this.locationManager.enterBuilding(settler.id, homeBuilding.id);
            this.animController.setIdleAnimation(settler);
            return;
        }

        if (controller.state === 'idle') {
            if (this.verbose && reason) {
                this.emitWaitingAtHome(settler, homeBuilding, reason);
            }
            this.gameState.movement.moveUnit(settler.id, door.x, door.y);
            this.animController.startWalkAnimation(settler, controller.direction);
        }
    }

    prepareNodeTick(settler: Entity, config: SettlerConfig, job: ChoreoJobState, node: ChoreoNode): void {
        if (job.progress < 0) {
            this.applyChoreoAnimation(settler, node);
            if (this.verbose) {
                this.emitNodeStarted(settler, job, node);
            }

            const buildingId = this.getWorkerHomeBuilding(settler.id);
            if (buildingId !== null) {
                const isInside = this.locationManager.isInside(settler.id);
                if (!node.visible && !isInside) {
                    this.locationManager.enterBuilding(settler.id, buildingId);
                } else if (node.visible && isInside) {
                    this.locationManager.exitBuilding(settler.id);
                }
            } else {
                settler.hidden = !node.visible;
            }

            job.progress = 0;
        }

        const entityHandler = this.handlerRegistry.getEntityHandler(config.search);
        const positionHandler = this.handlerRegistry.getPositionHandler(config.plantSearch ?? config.search);
        this.movementCtx.entityHandler = entityHandler;
        this.movementCtx.positionHandler = positionHandler;
        this.workCtx.entityHandler = entityHandler;
        this.workCtx.positionHandler = positionHandler;
    }

    advanceToNextNode(settler: Entity, job: ChoreoJobState, nodes: readonly ChoreoNode[]): void {
        if (this.verbose) {
            const completedNode = nodes[job.nodeIndex]!;
            this.eventBus.emit('choreo:nodeCompleted', {
                unitId: settler.id,
                jobId: job.jobId,
                nodeIndex: job.nodeIndex,
                task: ChoreoTaskType[completedNode.task],
            });
        }
        if (job.activeTrigger) {
            const buildingId = this.getWorkerHomeBuilding(settler.id);
            if (buildingId !== null) {
                this.triggerSystem.stopTrigger(buildingId, job.activeTrigger);
            }
            job.activeTrigger = '';
        }
        job.nodeIndex++;
        job.progress = -1;
        job.workStarted = false;
        job.pathRetryCountdown = 0;
        job.pathRetryCount = 0;
        const completedTask = nodes[job.nodeIndex - 1]!.task;
        // Preserve targetPos when the next node is also GO_TO_TARGET — some choreographies
        // (e.g. Viking JOB_FARMERGRAIN_PLANT) split the walk into multiple legs that all
        // share the same target position set at job start.
        const nextNode = nodes[job.nodeIndex];
        const nextIsGoToTarget =
            nextNode &&
            (nextNode.task === ChoreoTaskType.GO_TO_TARGET || nextNode.task === ChoreoTaskType.GO_TO_TARGET_ROUGHLY);
        if (completedTask !== ChoreoTaskType.SEARCH && !nextIsGoToTarget) {
            job.targetPos = null;
        }
    }

    executeNode(settler: Entity, job: ChoreoJobState, node: ChoreoNode, dt: number): TaskResult {
        try {
            return this.choreoSystem.execute(settler, job, node, dt);
        } catch (e) {
            this.handlerErrorLogger.error(
                `Executor crash: settler=${settler.id} job=${job.jobId} nodeIdx=${job.nodeIndex} task=${node.task}`,
                e instanceof Error ? e : new Error(String(e))
            );
            return TaskResult.FAILED;
        }
    }

    private applyChoreoAnimation(settler: Entity, node: ChoreoNode): void {
        if (!node.jobPart) {
            return;
        }
        const resolution: JobPartResolution = this.jobPartResolver.resolve(node.jobPart, settler);
        this.animController.applyChoreoAnimation(settler, resolution);
        if (this.verbose) {
            this.eventBus.emit('choreo:animationApplied', {
                unitId: settler.id,
                jobPart: node.jobPart,
                sequenceKey: resolution.sequenceKey,
                loop: resolution.loop,
            });
        }
    }

    private emitNodeStarted(settler: Entity, job: ChoreoJobState, node: ChoreoNode): void {
        this.eventBus.emit('choreo:nodeStarted', {
            unitId: settler.id,
            jobId: job.jobId,
            nodeIndex: job.nodeIndex,
            nodeCount: job.nodes.length,
            task: ChoreoTaskType[node.task],
            jobPart: node.jobPart,
            duration: node.duration,
        });
    }

    private emitWaitingAtHome(
        settler: Entity,
        home: Entity,
        reason: 'output_full' | 'cant_work' | 'first_visit'
    ): void {
        this.eventBus.emit('choreo:waitingAtHome', {
            unitId: settler.id,
            homeBuilding: home.id,
            reason,
        });
    }
}
