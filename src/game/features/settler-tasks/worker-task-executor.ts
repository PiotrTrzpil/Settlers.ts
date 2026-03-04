/**
 * Worker task executor.
 *
 * Handles job selection, execution, completion, and interruption for all
 * settlers that use choreography job sequences (XML-defined).
 */

import type { Entity } from '../../entity';
import { UnitType, clearCarrying } from '../../entity';
import { LogHandler } from '@/utilities/log-handler';
import type { ThrottledLogger } from '@/utilities/throttled-logger';
import { hexDistance } from '../../systems/hex-directions';
import {
    TaskResult,
    SettlerState,
    type SettlerConfig,
    type JobState,
    type EntityWorkHandler,
    type PositionWorkHandler,
    type HomeAssignment,
} from './types';
import type { ChoreoContext, ChoreoJobState, ChoreoNode, ChoreoJob, JobPartResolution } from './choreo-types';
import { ChoreoTaskType, createChoreoJobState } from './choreo-types';
import { CHOREO_EXECUTOR_MAP } from './choreo-executors';
import type { JobChoreographyStore } from './job-choreography-store';
import type { WorkHandlerRegistry } from './work-handler-registry';
import type { IdleAnimationController } from './idle-animation-controller';
import type { GameState } from '../../game-state';
import { EMaterialType } from '../../economy';
import { getBuildingDoorPos, getWorkerBuildingTypes } from '../../game-data-access';
import { BuildingType } from '../../buildings/building-type';
import { findNearestWorkplace } from './work-handlers';
import { JobSelector } from './job-selector';
import { safeCall } from './safe-call';

const log = new LogHandler('WorkerTaskExecutor');

/** Per-unit state needed by the worker executor (subset of UnitRuntime). */
export interface WorkerRuntimeState {
    state: SettlerState;
    job: JobState | null;
    homeAssignment: HomeAssignment | null;
}

/** Building occupancy map (read-only view for finding workplaces). */
export type OccupancyMap = ReadonlyMap<number, number>;

export interface WorkerTaskExecutorConfig {
    gameState: GameState;
    choreographyStore: JobChoreographyStore;
    handlerRegistry: WorkHandlerRegistry;
    animController: IdleAnimationController;
    choreoContext: ChoreoContext;
    handlerErrorLogger: ThrottledLogger;
    missingHandlerLogger: ThrottledLogger;
    isBuildingAvailable?: (buildingId: number) => boolean;
}

export class WorkerTaskExecutor {
    private readonly gameState: GameState;
    private readonly choreographyStore: JobChoreographyStore;
    private readonly handlerRegistry: WorkHandlerRegistry;
    private readonly animController: IdleAnimationController;
    private readonly choreoContext: ChoreoContext;
    private readonly handlerErrorLogger: ThrottledLogger;
    private readonly missingHandlerLogger: ThrottledLogger;
    private readonly isBuildingAvailable?: (buildingId: number) => boolean;
    private readonly jobSelector: JobSelector;

    constructor(cfg: WorkerTaskExecutorConfig) {
        this.gameState = cfg.gameState;
        this.choreographyStore = cfg.choreographyStore;
        this.handlerRegistry = cfg.handlerRegistry;
        this.animController = cfg.animController;
        this.choreoContext = cfg.choreoContext;
        this.handlerErrorLogger = cfg.handlerErrorLogger;
        this.missingHandlerLogger = cfg.missingHandlerLogger;
        this.isBuildingAvailable = cfg.isBuildingAvailable;
        this.jobSelector = new JobSelector(cfg.choreographyStore);
    }

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
        // Position handler may be registered under a separate plantSearch type (e.g. GRAIN_SEED_POS)
        const positionHandler = this.handlerRegistry.getPositionHandler(config.plantSearch ?? config.search);

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

        // Workers with workplace buildings must have an assigned workplace before starting work
        if (!homeBuilding && getWorkerBuildingTypes(settler.race, settler.subType as UnitType)) return;

        // First visit: worker must walk to their building before starting work
        if (homeBuilding && !runtime.homeAssignment!.hasVisited) {
            if (this.isAtHomeBuilding(settler, homeBuilding)) {
                runtime.homeAssignment!.hasVisited = true;
            } else {
                this.returnHomeAndWait(settler, homeBuilding);
                return;
            }
        }

        const targets = this.findTargets(settler, entityHandler, positionHandler, homeBuilding);
        if (!targets) return; // error already logged

        const selected = this.jobSelector.selectJob(settler, config, targets.entity, homeBuilding, targets.position);
        if (!selected) return;

        if (this.shouldWaitBeforeStarting(settler, homeBuilding, selected, entityHandler, targets.entity)) return;

        this.startJob(settler, runtime, selected, targets.entity, homeBuilding, targets.position);
    }

    /** Find entity and position targets for a settler. Returns null if a handler errored. */
    private findTargets(
        settler: Entity,
        entityHandler: EntityWorkHandler | undefined,
        positionHandler: PositionWorkHandler | undefined,
        homeBuilding: Entity | null
    ): { entity: { entityId: number; x: number; y: number } | null; position: { x: number; y: number } | null } | null {
        const entity = entityHandler ? this.findEntityTarget(entityHandler, settler) : null;
        if (entity === undefined) return null;

        const position =
            !entity && positionHandler ? this.findPositionTarget(positionHandler, settler, homeBuilding) : null;
        if (position === undefined) return null;

        return { entity, position };
    }

    /** Check if the settler should wait (output full or input unavailable) instead of starting. */
    private shouldWaitBeforeStarting(
        settler: Entity,
        homeBuilding: Entity | null,
        job: ChoreoJob,
        entityHandler: EntityWorkHandler | undefined,
        entityTarget: { entityId: number; x: number; y: number } | null
    ): boolean {
        if (homeBuilding && this.isOutputFull(homeBuilding, job)) {
            this.returnHomeAndWait(settler, homeBuilding);
            return true;
        }
        if (entityHandler?.canWork && entityTarget && !entityHandler.canWork(entityTarget.entityId)) {
            if (homeBuilding) this.returnHomeAndWait(settler, homeBuilding);
            return true;
        }
        return false;
    }

    /** Start a choreo job for a settler. */
    private startJob(
        settler: Entity,
        runtime: WorkerRuntimeState,
        selected: ChoreoJob,
        entityTarget: { entityId: number; x: number; y: number } | null,
        homeBuilding: Entity | null,
        positionTarget?: { x: number; y: number } | null
    ): void {
        settler.hidden = false;
        runtime.state = SettlerState.WORKING;

        const jobState = createChoreoJobState(selected.id, selected.nodes);
        if (entityTarget) {
            jobState.targetId = entityTarget.entityId;
            jobState.targetPos = { x: entityTarget.x, y: entityTarget.y };
        } else if (positionTarget) {
            // Position-only target (e.g. forester planting spot) — no entity ID
            jobState.targetPos = { x: positionTarget.x, y: positionTarget.y };
        }
        runtime.job = jobState;

        const posStr = positionTarget ? `(${positionTarget.x},${positionTarget.y})` : 'none';
        log.debug(
            `Settler ${settler.id} starting choreo job ${selected.id}, ` +
                `target ${entityTarget?.entityId ?? 'none'}, pos ${posStr}, ` +
                `home ${homeBuilding?.id ?? 'none'}`
        );

        this.choreoContext.eventBus.emit('settler:taskStarted', {
            unitId: settler.id,
            jobId: selected.id,
            targetId: entityTarget?.entityId ?? null,
            targetPos: jobState.targetPos,
            homeBuilding: homeBuilding?.id ?? null,
        });
    }

    /**
     * Handle a worker in WORKING state: advance the current choreography node.
     */
    handleWorking(settler: Entity, config: SettlerConfig, runtime: WorkerRuntimeState, dt: number): void {
        // Job MUST exist when state is WORKING — crash if invariant violated
        const job = runtime.job as ChoreoJobState;

        const nodes = job.nodes;
        if (job.nodeIndex >= nodes.length) {
            this.completeJob(settler, runtime);
            return;
        }

        const node = nodes[job.nodeIndex]!;

        // Apply animation for current node (on first tick)
        if (job.progress === 0) {
            this.applyChoreoAnimation(settler, node);
        }

        // Set visibility from node
        settler.hidden = !node.visible;

        // Build per-tick context with work handlers
        // Position handler may be under a separate plantSearch type (e.g. GRAIN_SEED_POS for farmer)
        const entityHandler = this.handlerRegistry.getEntityHandler(config.search);
        const positionHandler = this.handlerRegistry.getPositionHandler(config.plantSearch ?? config.search);
        const ctx: ChoreoContext = {
            ...this.choreoContext,
            entityHandler,
            positionHandler,
        };

        // Execute via choreo executor map
        const executor = CHOREO_EXECUTOR_MAP[node.task];
        const result =
            safeCall(
                () => executor(settler, job, node, dt, ctx),
                this.handlerErrorLogger,
                `Executor crash: settler=${settler.id} job=${job.jobId} nodeIdx=${job.nodeIndex} task=${node.task}`
            ) ?? TaskResult.FAILED;

        switch (result) {
        case TaskResult.DONE:
            this.advanceToNextNode(settler, job, nodes);
            break;

        case TaskResult.FAILED:
            this.interruptJob(settler, config, runtime);
            break;

        case TaskResult.CONTINUE:
            // Keep going next tick
            break;
        }
    }

    /** Advance to the next choreography node after the current one completes. */
    private advanceToNextNode(settler: Entity, job: ChoreoJobState, nodes: readonly ChoreoNode[]): void {
        // Stop active trigger when leaving a node
        if (job.activeTrigger) {
            const buildingId = this.choreoContext.getWorkerHomeBuilding(settler.id);
            if (buildingId !== null) {
                this.choreoContext.triggerSystem.stopTrigger(buildingId, job.activeTrigger);
            }
            job.activeTrigger = '';
        }
        job.nodeIndex++;
        job.progress = 0;
        job.workStarted = false;
        // Reset targetPos unless executors manage it between nodes (e.g. transport jobs
        // pre-set the next movement target in GET_GOOD / PUT_GOOD transport branches).
        if (!job.managedTargetPos) {
            job.targetPos = null;
        }
        // Apply animation for next node if there is one
        if (job.nodeIndex < nodes.length) {
            this.applyChoreoAnimation(settler, nodes[job.nodeIndex]!);
        }
    }

    /**
     * Complete a job and return to idle state.
     */
    completeJob(settler: Entity, runtime: WorkerRuntimeState): void {
        const job = runtime.job!;

        // Stop any active trigger
        if (job.activeTrigger) {
            const homeId = this.choreoContext.getWorkerHomeBuilding(settler.id);
            if (homeId !== null) {
                this.choreoContext.triggerSystem.stopTrigger(homeId, job.activeTrigger);
            }
        }

        log.debug(`Settler ${settler.id} completed job ${job.jobId}`);

        this.choreoContext.eventBus.emit('settler:taskCompleted', {
            unitId: settler.id,
            jobId: job.jobId,
        });

        runtime.state = SettlerState.IDLE;
        runtime.job = null;
        settler.hidden = false;
        this.animController.setIdleAnimation(settler);

        // Hide settler if they finished at their home building
        if (runtime.homeAssignment) {
            const home = this.gameState.getEntity(runtime.homeAssignment.buildingId);
            if (home && hexDistance(settler.x, settler.y, home.x, home.y) <= 1) {
                settler.hidden = true;
            }
        }
    }

    /**
     * Interrupt a job (target gone, pathfinding failure, etc.).
     * Calls onWorkInterrupt on the entity handler if work had started.
     *
     * Must NOT be called when the job has already completed all nodes —
     * use completeJob for that case. Callers should check `isJobDone()` first.
     */
    interruptJob(settler: Entity, config: SettlerConfig, runtime: WorkerRuntimeState): void {
        const entityHandler = this.handlerRegistry.getEntityHandler(config.search);
        const job = runtime.job!;

        // Only call onWorkInterrupt on entity handlers when work actually started
        if (entityHandler && job.targetId && job.workStarted) {
            safeCall(
                () => entityHandler.onWorkInterrupt?.(job.targetId!),
                this.handlerErrorLogger,
                `onWorkInterrupt failed for target ${job.targetId}`
            );
        }

        // Cancel transport job if active (releases reservation + resets request)
        if (job.transportData) {
            job.transportData.transportJob.cancel();
        }

        // Stop any active trigger
        if (job.activeTrigger) {
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

        const failedNode = job.nodes[job.nodeIndex];
        let failedStep: string;
        if (failedNode) {
            failedStep = ChoreoTaskType[failedNode.task];
        } else if (job.nodeIndex >= job.nodes.length) {
            failedStep = 'END';
        } else {
            failedStep = 'unknown';
        }
        this.choreoContext.eventBus.emit('settler:taskFailed', {
            unitId: settler.id,
            jobId: job.jobId,
            nodeIndex: job.nodeIndex,
            failedStep,
            targetId: job.targetId ?? null,
            workStarted: job.workStarted,
            wasCarrying: !!settler.carrying,
        });

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
        return safeCall(
            () => handler.findTarget(settler.x, settler.y, settler.id),
            this.handlerErrorLogger,
            `findTarget failed for settler ${settler.id}`
        );
    }

    /**
     * Find a position work handler's target, catching errors at the system boundary.
     * Used for plant/seed jobs when no entity target is available.
     */
    private findPositionTarget(
        handler: PositionWorkHandler,
        settler: Entity,
        homeBuilding: Entity | null
    ): { x: number; y: number } | null | undefined {
        const center = this.getSearchCenter(handler, settler, homeBuilding);
        return safeCall(
            () => handler.findPosition(center.x, center.y, settler.id),
            this.handlerErrorLogger,
            `findPosition failed for settler ${settler.id}`
        );
    }

    /** Get the search center for a position handler — work area center or settler position. */
    private getSearchCenter(
        handler: PositionWorkHandler,
        settler: Entity,
        homeBuilding: Entity | null
    ): { x: number; y: number } {
        if (handler.useWorkAreaCenter && homeBuilding) {
            return this.choreoContext.buildingPositionResolver.resolvePosition(homeBuilding.id, 0, 0, true);
        }
        return settler;
    }

    // ─────────────────────────────────────────────────────────────
    // Private helpers
    // ─────────────────────────────────────────────────────────────

    /** Check whether a settler is at their home building's door. */
    private isAtHomeBuilding(settler: Entity, homeBuilding: Entity): boolean {
        const door = getBuildingDoorPos(
            homeBuilding.x,
            homeBuilding.y,
            homeBuilding.race,
            homeBuilding.subType as BuildingType
        );
        return hexDistance(settler.x, settler.y, door.x, door.y) <= 1;
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
        if (runtime.homeAssignment !== null) {
            const existing = this.gameState.getEntity(runtime.homeAssignment.buildingId);
            if (existing) return existing;
            // Building was destroyed — release stale assignment
            releaseBuilding(runtime);
        }
        const building = findNearestWorkplace(this.gameState, settler, buildingOccupants, this.isBuildingAvailable);
        if (building) {
            claimBuilding(runtime, building.id);
        }
        return building;
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

        const door = getBuildingDoorPos(
            homeBuilding.x,
            homeBuilding.y,
            homeBuilding.race,
            homeBuilding.subType as BuildingType
        );
        const dist = hexDistance(settler.x, settler.y, door.x, door.y);

        // If already at home, hide inside building
        if (dist <= 1) {
            settler.hidden = true;
            this.animController.setIdleAnimation(settler);
            return;
        }

        // If not moving, start moving home
        if (controller.state === 'idle') {
            this.gameState.movement.moveUnit(settler.id, door.x, door.y);
            this.animController.startWalkAnimation(settler, controller.direction);
        }
    }
}
