/**
 * Worker task executor.
 *
 * Handles job selection, execution, completion, and interruption for
 * workers (woodcutter, builder, etc.) that use YAML-defined job sequences.
 * Distinct from carrier jobs which use externally-assigned CarrierJobState.
 */

import type { Entity } from '../../entity';
import { UnitType, clearCarrying } from '../../entity';
import { LogHandler } from '@/utilities/log-handler';
import { ThrottledLogger } from '@/utilities/throttled-logger';
import { hexDistance } from '../../systems/hex-directions';
import {
    TaskType,
    TaskResult,
    SettlerState,
    type SettlerConfig,
    type TaskNode,
    type WorkerJobData,
    type JobState,
    type EntityWorkHandler,
} from './types';
import { executeTask, type TaskContext } from './task-executors';
import type { JobDefinitions } from './loader';
import { isOutputFull, findNearestWorkplace } from './work-handlers';
import type { WorkHandlerRegistry } from './work-handler-registry';
import type { IdleAnimationController } from './idle-animation-controller';
import type { GameState } from '../../game-state';

const log = new LogHandler('WorkerTaskExecutor');

/** Per-unit state needed by the worker executor (subset of UnitRuntime). */
export interface WorkerRuntimeState {
    state: SettlerState;
    job: JobState | null;
    assignedBuilding: number | null;
}

/** Building occupancy map (read-only view for finding workplaces). */
export type OccupancyMap = ReadonlyMap<number, number>;

export class WorkerTaskExecutor {
    constructor(
        private readonly gameState: GameState,
        private readonly jobDefinitions: JobDefinitions,
        private readonly handlerRegistry: WorkHandlerRegistry,
        private readonly animController: IdleAnimationController,
        private readonly taskContext: TaskContext,
        private readonly handlerErrorLogger: ThrottledLogger,
        private readonly missingHandlerLogger: ThrottledLogger
    ) {}

    /**
     * Handle a worker in IDLE state: find a target and start a job.
     */
    handleIdle(
        settler: Entity,
        config: SettlerConfig,
        runtime: WorkerRuntimeState,
        buildingOccupants: OccupancyMap,
        claimBuilding: (runtime: WorkerRuntimeState, buildingId: number) => void,
        releaseBuilding: (runtime: WorkerRuntimeState) => void
    ): void {
        const entityHandler = this.handlerRegistry.getEntityHandler(config.search);
        const positionHandler = this.handlerRegistry.getPositionHandler(config.search);

        if (!entityHandler && !positionHandler) {
            this.missingHandlerLogger.warn(
                `No work handler registered for search type: ${config.search}. ` +
                    `Settler ${settler.id} (${UnitType[settler.subType]}) will stay idle until feature is implemented.`
            );
            return;
        }

        const homeBuilding = this.resolveHomeBuilding(
            settler,
            runtime,
            buildingOccupants,
            claimBuilding,
            releaseBuilding
        );

        // Entity handlers search for a target; position handlers start self-searching jobs directly
        const entityTarget = entityHandler ? this.findEntityTarget(entityHandler, settler) : null;
        if (entityTarget === undefined) return; // error already logged

        const selected = this.selectJob(settler, config, entityTarget);
        if (!selected) return;

        if (homeBuilding && isOutputFull(homeBuilding, selected.tasks, this.taskContext.inventoryManager)) {
            this.returnHomeAndWait(settler, homeBuilding);
            return;
        }

        settler.hidden = false;
        runtime.state = SettlerState.WORKING;
        runtime.job = {
            type: 'worker',
            jobId: selected.jobId,
            taskIndex: 0,
            progress: 0,
            data: this.buildWorkerJobData(entityTarget),
        };

        log.debug(
            `Settler ${settler.id} starting job ${selected.jobId}, target ${entityTarget?.entityId ?? 'none'}, home ${homeBuilding?.id ?? 'none'}`
        );
    }

    /**
     * Handle a worker in WORKING state: advance the current task.
     */
    handleWorking(settler: Entity, config: SettlerConfig, runtime: WorkerRuntimeState, dt: number): void {
        // Job MUST exist when state is WORKING — crash if invariant violated
        const job = runtime.job!;

        const tasks = this.jobDefinitions.get(job.jobId);
        if (!tasks || job.taskIndex >= tasks.length) {
            this.completeJob(settler, runtime);
            return;
        }

        const task = tasks[job.taskIndex]!;

        // Apply animation for current task (on first tick of task)
        if (job.progress === 0) {
            this.animController.applyTaskAnimation(settler, task);
        }

        const entityHandler = this.handlerRegistry.getEntityHandler(config.search);
        const positionHandler = this.handlerRegistry.getPositionHandler(config.search);
        const result = executeTask(settler, job, task, dt, this.taskContext, entityHandler, positionHandler);

        switch (result) {
        case TaskResult.DONE:
            job.taskIndex++;
            job.progress = 0;
            // Apply animation for next task if there is one
            if (job.taskIndex < tasks.length) {
                this.animController.applyTaskAnimation(settler, tasks[job.taskIndex]!);
            }
            break;

        case TaskResult.FAILED:
            this.interruptJob(settler, config, runtime);
            break;

        case TaskResult.CONTINUE:
            // Keep going next tick
            break;
        }
    }

    /**
     * Complete a job and return to idle state.
     */
    completeJob(settler: Entity, runtime: WorkerRuntimeState): void {
        log.debug(`Settler ${settler.id} completed job ${runtime.job!.jobId}`);
        runtime.state = SettlerState.IDLE;
        runtime.job = null;
        this.animController.setIdleAnimation(settler);

        // Hide settler if they finished at their home building
        if (runtime.assignedBuilding) {
            const home = this.gameState.getEntity(runtime.assignedBuilding);
            if (home && hexDistance(settler.x, settler.y, home.x, home.y) <= 1) {
                settler.hidden = true;
            }
        }
    }

    /**
     * Interrupt a job (target gone, pathfinding failure, etc.).
     * Calls onWorkInterrupt on the entity handler if work had started.
     */
    interruptJob(settler: Entity, config: SettlerConfig, runtime: WorkerRuntimeState): void {
        const entityHandler = this.handlerRegistry.getEntityHandler(config.search);
        const job = runtime.job!;

        // Only call onWorkInterrupt on entity handlers when work actually started
        if (entityHandler && job.type === 'worker' && job.data.targetId && job.workStarted) {
            try {
                entityHandler.onWorkInterrupt?.(job.data.targetId);
            } catch (e) {
                const err = e instanceof Error ? e : new Error(String(e));
                this.handlerErrorLogger.error(`onWorkInterrupt failed for target ${job.data.targetId}`, err);
            }
        }

        // Clear carrying state if unit was carrying material
        if (settler.carrying) {
            clearCarrying(settler);
        }

        log.debug(`Settler ${settler.id} interrupted job ${job.jobId}`);
        runtime.state = SettlerState.INTERRUPTED;
        this.animController.setIdleAnimation(settler);
    }

    /**
     * Find an entity work handler's target, catching errors at the system boundary.
     */
    findEntityTarget(
        handler: EntityWorkHandler,
        settler: Entity
    ): { entityId: number; x: number; y: number } | null | undefined {
        try {
            return handler.findTarget(settler.x, settler.y, settler.id);
        } catch (e) {
            const err = e instanceof Error ? e : new Error(String(e));
            this.handlerErrorLogger.error(`findTarget failed for settler ${settler.id}`, err);
            return undefined;
        }
    }

    // ─────────────────────────────────────────────────────────────
    // Private helpers
    // ─────────────────────────────────────────────────────────────

    private buildWorkerJobData(target: { entityId: number; x: number; y: number } | null): WorkerJobData {
        return {
            targetId: target?.entityId ?? null,
            targetPos: target ? { x: target.x, y: target.y } : null,
            carryingGood: null,
        };
    }

    /**
     * Resolve the home building for a settler: reuse existing assignment or find a new one.
     * Claims the building immediately so no other worker can take it.
     */
    private resolveHomeBuilding(
        settler: Entity,
        runtime: WorkerRuntimeState,
        buildingOccupants: OccupancyMap,
        claimBuilding: (runtime: WorkerRuntimeState, buildingId: number) => void,
        releaseBuilding: (runtime: WorkerRuntimeState) => void
    ): Entity | null {
        if (runtime.assignedBuilding !== null) {
            const existing = this.gameState.getEntity(runtime.assignedBuilding);
            if (existing) return existing;
            // Building was destroyed — release stale assignment
            releaseBuilding(runtime);
        }
        const building = findNearestWorkplace(this.gameState, settler, buildingOccupants);
        if (building) {
            claimBuilding(runtime, building.id);
        }
        return building;
    }

    /**
     * Select the best job for a settler based on target availability.
     *
     * Priority: entity-target jobs first (harvest, chop, etc.) since they have
     * concrete work to do, then self-searching jobs (plant) as fallback.
     */
    private selectJob(
        settler: Entity,
        config: SettlerConfig,
        target: { entityId: number; x: number; y: number } | null
    ): { jobId: string; tasks: TaskNode[] } | null {
        const prefix = UnitType[settler.subType]!.toLowerCase();

        // Phase 1: If a target entity was found, try jobs that need one
        if (target) {
            for (const jobName of config.jobs) {
                const jobId = `${prefix}.${jobName}`;
                const tasks = this.jobDefinitions.get(jobId);
                if (!tasks?.length) continue;
                if (this.jobNeedsEntityTarget(tasks[0]!)) {
                    return { jobId, tasks };
                }
            }
        }

        // Phase 2: Try self-searching jobs (SEARCH_POS) that don't need an initial target
        for (const jobName of config.jobs) {
            const jobId = `${prefix}.${jobName}`;
            const tasks = this.jobDefinitions.get(jobId);
            if (!tasks?.length) continue;
            if (this.jobIsSelfSearching(tasks[0]!)) {
                return { jobId, tasks };
            }
        }

        return null;
    }

    /** Check if a job's first task requires an entity target from findTarget. */
    private jobNeedsEntityTarget(firstTask: TaskNode): boolean {
        return (
            firstTask.task === TaskType.GO_TO_TARGET ||
            firstTask.task === TaskType.GO_ADJACENT_POS ||
            firstTask.task === TaskType.WORK_ON_ENTITY
        );
    }

    /**
     * Check if a job is self-searching (starts with SEARCH_POS).
     * Only these jobs can be started without an external target.
     * Jobs like carrier.transport (GO_TO_SOURCE) need external assignment via assignJob().
     */
    private jobIsSelfSearching(firstTask: TaskNode): boolean {
        return firstTask.task === TaskType.SEARCH_POS;
    }

    /**
     * Make settler return to home building and wait there.
     * Used when output is full and settler can't work.
     */
    private returnHomeAndWait(settler: Entity, homeBuilding: Entity): void {
        const controller = this.gameState.movement.getController(settler.id);
        if (!controller) {
            throw new Error(`Settler ${settler.id} (${UnitType[settler.subType]}) has no movement controller`);
        }

        const dist = hexDistance(settler.x, settler.y, homeBuilding.x, homeBuilding.y);

        // If already at home, hide inside building
        if (dist <= 1) {
            settler.hidden = true;
            this.animController.setIdleAnimation(settler);
            return;
        }

        // If not moving, start moving home
        if (controller.state === 'idle') {
            this.gameState.movement.moveUnit(settler.id, homeBuilding.x, homeBuilding.y);
            this.animController.startWalkAnimation(settler, controller.direction);
        }
    }
}
