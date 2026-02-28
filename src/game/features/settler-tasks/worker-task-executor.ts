/**
 * Worker task executor.
 *
 * Handles job selection, execution, completion, and interruption for
 * workers (woodcutter, builder, etc.) that use XML choreography job sequences.
 * Distinct from carrier jobs which use externally-assigned CarrierJobState.
 */

import type { Entity } from '../../entity';
import { UnitType, clearCarrying } from '../../entity';
import { LogHandler } from '@/utilities/log-handler';
import type { ThrottledLogger } from '@/utilities/throttled-logger';
import { hexDistance } from '../../systems/hex-directions';
import { JobType, TaskResult, SettlerState, type SettlerConfig, type JobState, type EntityWorkHandler } from './types';
import type { ChoreoContext, ChoreoJobState, ChoreoNode, ChoreoJob, JobPartResolution } from './choreo-types';
import { ChoreoTaskType, createChoreoJobState } from './choreo-types';
import { CHOREO_EXECUTOR_MAP } from './choreo-executors';
import type { JobChoreographyStore } from './job-choreography-store';
import type { WorkHandlerRegistry } from './work-handler-registry';
import type { IdleAnimationController } from './idle-animation-controller';
import type { GameState } from '../../game-state';
import { EMaterialType } from '../../economy';
import { raceToRaceId } from '../../game-data-access';
import { findNearestWorkplace } from './work-handlers';

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
        private readonly choreographyStore: JobChoreographyStore,
        private readonly handlerRegistry: WorkHandlerRegistry,
        private readonly animController: IdleAnimationController,
        private readonly choreoContext: ChoreoContext,
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

        // Output full check — look for PUT_GOOD or RESOURCE_GATHERING nodes in the job
        if (homeBuilding && this.isOutputFull(homeBuilding, selected)) {
            this.returnHomeAndWait(settler, homeBuilding);
            return;
        }

        settler.hidden = false;
        runtime.state = SettlerState.WORKING;

        const jobState = createChoreoJobState(selected.id);
        if (entityTarget) {
            jobState.targetId = entityTarget.entityId;
            jobState.targetPos = { x: entityTarget.x, y: entityTarget.y };
        }
        runtime.job = jobState;

        log.debug(
            `Settler ${settler.id} starting choreo job ${selected.id}, ` +
                `target ${entityTarget?.entityId ?? 'none'}, home ${homeBuilding?.id ?? 'none'}`
        );
    }

    /**
     * Handle a worker in WORKING state: advance the current choreography node.
     */
    handleWorking(settler: Entity, config: SettlerConfig, runtime: WorkerRuntimeState, dt: number): void {
        // Job MUST exist when state is WORKING — crash if invariant violated
        const job = runtime.job as ChoreoJobState;

        const raceId = raceToRaceId(settler.race);
        const choreoJob = this.choreographyStore.getJob(raceId, job.jobId);
        if (!choreoJob || job.nodeIndex >= choreoJob.nodes.length) {
            this.completeJob(settler, runtime);
            return;
        }

        const node = choreoJob.nodes[job.nodeIndex]!;

        // Apply animation for current node (on first tick)
        if (job.progress === 0) {
            this.applyChoreoAnimation(settler, node);
        }

        // Set visibility from node
        settler.hidden = !node.visible;

        // Build per-tick context with work handlers
        const entityHandler = this.handlerRegistry.getEntityHandler(config.search);
        const positionHandler = this.handlerRegistry.getPositionHandler(config.search);
        const ctx: ChoreoContext = {
            ...this.choreoContext,
            entityHandler,
            positionHandler,
        };

        // Execute via choreo executor map
        const executor = CHOREO_EXECUTOR_MAP[node.task];
        const result = executor(settler, job, node, dt, ctx);

        switch (result) {
        case TaskResult.DONE:
            // Stop active trigger when leaving a node
            if (job.activeTrigger) {
                this.choreoContext.triggerSystem.stopTrigger(
                    this.choreoContext.getWorkerHomeBuilding(settler.id) ?? 0,
                    job.activeTrigger
                );
                job.activeTrigger = '';
            }
            job.nodeIndex++;
            job.progress = 0;
            job.workStarted = false;
            // Reset targetPos for next node (it may need fresh resolution)
            job.targetPos = null;
            // Apply animation for next node if there is one
            if (job.nodeIndex < choreoJob.nodes.length) {
                this.applyChoreoAnimation(settler, choreoJob.nodes[job.nodeIndex]!);
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
        const job = runtime.job!;

        // Stop any active trigger
        if (job.type === JobType.CHOREO && job.activeTrigger) {
            const homeId = this.choreoContext.getWorkerHomeBuilding(settler.id);
            if (homeId !== null) {
                this.choreoContext.triggerSystem.stopTrigger(homeId, job.activeTrigger);
            }
        }

        log.debug(`Settler ${settler.id} completed job ${job.jobId}`);
        runtime.state = SettlerState.IDLE;
        runtime.job = null;
        settler.hidden = false;
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
        if (entityHandler && job.type === JobType.CHOREO && job.targetId && job.workStarted) {
            try {
                entityHandler.onWorkInterrupt?.(job.targetId);
            } catch (e) {
                const err = e instanceof Error ? e : new Error(String(e));
                this.handlerErrorLogger.error(`onWorkInterrupt failed for target ${job.targetId}`, err);
            }
        }

        // Stop any active trigger
        if (job.type === JobType.CHOREO && job.activeTrigger) {
            const homeId = this.choreoContext.getWorkerHomeBuilding(settler.id);
            if (homeId !== null) {
                this.choreoContext.triggerSystem.stopTrigger(homeId, job.activeTrigger);
            }
        }

        // Clear carrying state if unit was carrying material
        if (settler.carrying) {
            clearCarrying(settler);
        }

        // Restore visibility
        settler.hidden = false;

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
     * Select the best choreo job for a settler based on target availability.
     *
     * Iterates config.jobs (XML job IDs like 'JOB_WOODCUTTER_WORK') and picks
     * the first job whose first node matches the available target type:
     * - Entity-target jobs (GO_TO_TARGET, etc.) need an external entity target.
     * - Self-searching jobs (SEARCH) can start without one.
     */
    private selectJob(
        settler: Entity,
        config: SettlerConfig,
        target: { entityId: number; x: number; y: number } | null
    ): ChoreoJob | null {
        const raceId = raceToRaceId(settler.race);

        for (const jobId of config.jobs) {
            const job = this.choreographyStore.getJob(raceId, jobId);
            if (!job?.nodes.length) continue;

            const firstNode = job.nodes[0]!;

            // Entity-target jobs need a target
            if (target && this.jobNeedsEntityTarget(firstNode)) {
                return job;
            }

            // Self-searching jobs (SEARCH node first) don't need external target
            if (firstNode.task === ChoreoTaskType.SEARCH) {
                return job;
            }
        }

        return null;
    }

    /** Check if a job's first node requires an entity target from findTarget. */
    private jobNeedsEntityTarget(firstNode: ChoreoNode): boolean {
        return (
            firstNode.task === ChoreoTaskType.GO_TO_TARGET ||
            firstNode.task === ChoreoTaskType.GO_TO_TARGET_ROUGHLY ||
            firstNode.task === ChoreoTaskType.WORK_ON_ENTITY
        );
    }

    /** Apply choreography animation for a node via the JobPartResolver. */
    private applyChoreoAnimation(settler: Entity, node: ChoreoNode): void {
        if (!node.jobPart) return;
        const resolution: JobPartResolution = this.choreoContext.jobPartResolver.resolve(node.jobPart, settler);
        this.animController.applyChoreoAnimation(settler, resolution);
    }

    /**
     * Check if a building's output is full for the goods produced by this choreo job.
     * Looks for PUT_GOOD or RESOURCE_GATHERING nodes that declare an output good.
     */
    private isOutputFull(homeBuilding: Entity, job: ChoreoJob): boolean {
        const outputNode = job.nodes.find(
            n => n.task === ChoreoTaskType.PUT_GOOD || n.task === ChoreoTaskType.RESOURCE_GATHERING
        );
        if (!outputNode || !outputNode.entity) return false;

        const material = this.parseMaterial(outputNode.entity);
        if (material === null) return false;

        const id = homeBuilding.id;
        const inv = this.choreoContext.inventoryManager;
        if (inv.canAcceptInput(id, material, 1)) return false;
        if (inv.getInputSpace(id, material) > 0) return false;

        const inventory = inv.getInventory(id);
        if (!inventory) return false;
        const outputSlot = inventory.outputSlots.find(s => s.materialType === material);
        if (outputSlot && outputSlot.currentAmount < outputSlot.maxCapacity) return false;

        return true;
    }

    /** Parse a material string (e.g. 'GOOD_LOG' or 'LOG') to EMaterialType, or null. */
    private parseMaterial(entity: string): EMaterialType | null {
        const key = entity.replace(/^GOOD_/, '');
        const value = EMaterialType[key as keyof typeof EMaterialType] as EMaterialType | undefined;
        return value ?? null;
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
