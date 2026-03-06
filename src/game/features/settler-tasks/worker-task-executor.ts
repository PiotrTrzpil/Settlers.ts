/**
 * Worker task executor.
 *
 * Handles job selection, execution, completion, and interruption for all
 * settlers that use choreography job sequences (XML-defined).
 */

import type { Entity } from '../../entity';
import type { CoreDeps } from '../feature';
import { UnitType } from '../../entity';
import { createLogger } from '@/utilities/logger';
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
import type {
    ChoreoJobState,
    ChoreoNode,
    ChoreoJob,
    JobPartResolution,
    MovementContext,
    WorkContext,
    InventoryExecutorContext,
    ControlContext,
    BuildingPositionResolver,
    TriggerSystem,
    JobPartResolver,
    TransportJobOps,
} from './choreo-types';
import { ChoreoTaskType, createChoreoJobState } from './choreo-types';
import {
    ExecutorCategory,
    TASK_CATEGORY,
    MOVEMENT_EXECUTORS,
    WORK_EXECUTORS,
    INVENTORY_EXECUTORS,
    CONTROL_EXECUTORS,
} from './choreo-executors';
import type { JobChoreographyStore } from './job-choreography-store';
import type { WorkHandlerRegistry } from './work-handler-registry';
import type { IdleAnimationController } from './idle-animation-controller';
import type { GameState } from '../../game-state';
import type { EventBus } from '../../event-bus';
import type { BuildingInventoryManager } from '../inventory';
import type { MaterialTransfer } from '../material-transfer';
import type { BarracksTrainingManager } from '../barracks';
import type { Command, CommandResult } from '../../commands';
import { EMaterialType } from '../../economy';
import { getBuildingDoorPos, getWorkerBuildingTypes } from '../../game-data-access';
import { BuildingType } from '../../buildings/building-type';
import { findNearestWorkplace } from './work-handlers';
import { JobSelector } from './job-selector';
import { safeCall } from './safe-call';

const log = createLogger('WorkerTaskExecutor');

/** Per-unit state needed by the worker executor (subset of UnitRuntime). */
export interface WorkerRuntimeState {
    state: SettlerState;
    job: JobState | null;
    homeAssignment: HomeAssignment | null;
}

/** Building occupancy map (read-only view for finding workplaces). */
export type OccupancyMap = ReadonlyMap<number, number>;

export interface WorkerTaskExecutorConfig extends CoreDeps {
    choreographyStore: JobChoreographyStore;
    handlerRegistry: WorkHandlerRegistry;
    animController: IdleAnimationController;
    handlerErrorLogger: ThrottledLogger;
    missingHandlerLogger: ThrottledLogger;
    isBuildingAvailable?: (buildingId: number) => boolean;
    inventoryManager: BuildingInventoryManager;
    buildingPositionResolver: BuildingPositionResolver;
    triggerSystem: TriggerSystem;
    getWorkerHomeBuilding: (settlerId: number) => number | null;
    jobPartResolver: JobPartResolver;
    materialTransfer: MaterialTransfer;
    transportJobOps: TransportJobOps;
    getBarracksTrainingManager?: () => BarracksTrainingManager | undefined;
    executeCommand?: (cmd: Command) => CommandResult;
}

export class WorkerTaskExecutor {
    private readonly gameState: GameState;
    private readonly choreographyStore: JobChoreographyStore;
    private readonly handlerRegistry: WorkHandlerRegistry;
    private readonly animController: IdleAnimationController;
    private readonly handlerErrorLogger: ThrottledLogger;
    private readonly missingHandlerLogger: ThrottledLogger;
    private readonly isBuildingAvailable?: (buildingId: number) => boolean;
    private readonly jobSelector: JobSelector;

    // Service references used directly by the executor (not passed to category executors)
    private readonly eventBus: EventBus;
    private readonly inventoryManager: BuildingInventoryManager;
    private readonly jobPartResolver: JobPartResolver;
    private readonly materialTransfer: MaterialTransfer;
    private readonly transportJobOps: TransportJobOps;
    private readonly triggerSystem: TriggerSystem;
    private readonly getWorkerHomeBuilding: (settlerId: number) => number | null;
    private readonly buildingPositionResolver: BuildingPositionResolver;

    // Pre-built context objects — handler fields updated in-place per tick (no allocation)
    private readonly movementCtx: MovementContext;
    private readonly workCtx: WorkContext;
    private readonly inventoryCtx: InventoryExecutorContext;
    private readonly controlCtx: ControlContext;

    /** Enable verbose choreography events (nodeStarted, nodeCompleted, animationApplied, waitingAtHome) */
    verbose = false;

    constructor(cfg: WorkerTaskExecutorConfig) {
        this.gameState = cfg.gameState;
        this.choreographyStore = cfg.choreographyStore;
        this.handlerRegistry = cfg.handlerRegistry;
        this.animController = cfg.animController;
        this.handlerErrorLogger = cfg.handlerErrorLogger;
        this.missingHandlerLogger = cfg.missingHandlerLogger;
        this.isBuildingAvailable = cfg.isBuildingAvailable;
        this.jobSelector = new JobSelector(cfg.choreographyStore);

        // Store service references for direct use
        this.eventBus = cfg.eventBus;
        this.inventoryManager = cfg.inventoryManager;
        this.jobPartResolver = cfg.jobPartResolver;
        this.materialTransfer = cfg.materialTransfer;
        this.transportJobOps = cfg.transportJobOps;
        this.triggerSystem = cfg.triggerSystem;
        this.getWorkerHomeBuilding = cfg.getWorkerHomeBuilding;
        this.buildingPositionResolver = cfg.buildingPositionResolver;

        // Pre-built context objects — handler fields mutated in-place each tick (zero allocation)
        this.movementCtx = {
            gameState: cfg.gameState,
            buildingPositionResolver: cfg.buildingPositionResolver,
            getWorkerHomeBuilding: cfg.getWorkerHomeBuilding,
            handlerErrorLogger: cfg.handlerErrorLogger,
            entityHandler: undefined,
            positionHandler: undefined,
        };

        this.workCtx = {
            gameState: cfg.gameState,
            triggerSystem: cfg.triggerSystem,
            getWorkerHomeBuilding: cfg.getWorkerHomeBuilding,
            handlerErrorLogger: cfg.handlerErrorLogger,
            entityHandler: undefined,
            positionHandler: undefined,
        };

        this.inventoryCtx = {
            inventoryManager: cfg.inventoryManager,
            getWorkerHomeBuilding: cfg.getWorkerHomeBuilding,
            materialTransfer: cfg.materialTransfer,
            eventBus: cfg.eventBus,
            transportJobOps: cfg.transportJobOps,
        };

        const getBarracksTrainingManager = cfg.getBarracksTrainingManager;
        this.controlCtx = {
            gameState: cfg.gameState,
            eventBus: cfg.eventBus,
            handlerErrorLogger: cfg.handlerErrorLogger,
            get barracksTrainingManager() {
                return getBarracksTrainingManager?.();
            },
            executeCommand: cfg.executeCommand,
            inventoryManager: cfg.inventoryManager,
        };
    }

    /**
     * Handle a worker in IDLE state: find a target and start a job.
     * @returns true if a job was started, false if the settler remains idle.
     */
    handleIdle(
        settler: Entity,
        config: SettlerConfig,
        runtime: WorkerRuntimeState,
        buildingOccupants: OccupancyMap,
        claimBuilding: (runtime: WorkerRuntimeState, buildingId: number) => void,
        releaseBuilding: (runtime: WorkerRuntimeState) => void
    ): boolean {
        const entityHandler = this.handlerRegistry.getEntityHandler(config.search);
        // Position handler may be registered under a separate plantSearch type (e.g. GRAIN_SEED_POS)
        const positionHandler = this.handlerRegistry.getPositionHandler(config.plantSearch ?? config.search);

        if (!entityHandler && !positionHandler) {
            this.missingHandlerLogger.warn(
                `No work handler registered for search type: ${config.search}. ` +
                    `Settler ${settler.id} (${UnitType[settler.subType]}) will stay idle until feature is implemented.`
            );
            return false;
        }

        const homeBuilding = this.resolveHomeBuilding(
            settler,
            runtime,
            buildingOccupants,
            claimBuilding,
            releaseBuilding
        );

        // Workers with workplace buildings must have an assigned workplace before starting work
        if (!homeBuilding && getWorkerBuildingTypes(settler.race, settler.subType as UnitType)) return false;

        // First visit: worker must walk to their building before starting work
        if (homeBuilding && !runtime.homeAssignment!.hasVisited) {
            if (this.isAtHomeBuilding(settler, homeBuilding)) {
                runtime.homeAssignment!.hasVisited = true;
            } else {
                this.returnHomeAndWait(settler, homeBuilding, 'first_visit');
                return false;
            }
        }

        const targets = this.findTargets(settler, entityHandler, positionHandler, homeBuilding);
        if (!targets) return false; // error already logged

        const selected = this.jobSelector.selectJob(settler, config, targets.entity, homeBuilding, targets.position);
        if (!selected) return false;

        if (this.shouldWaitBeforeStarting(settler, homeBuilding, selected, entityHandler, targets.entity)) return false;

        this.startJob(settler, runtime, selected, targets.entity, homeBuilding, targets.position);
        return true;
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
            this.returnHomeAndWait(settler, homeBuilding, 'output_full');
            return true;
        }
        if (entityHandler?.canWork && entityTarget && !entityHandler.canWork(entityTarget.entityId)) {
            if (homeBuilding) {
                this.returnHomeAndWait(settler, homeBuilding, 'cant_work');
            }
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

        this.eventBus.emit('settler:taskStarted', {
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

        // Apply animation once on the true first tick of this node.
        // progress < 0 is the sentinel set by advanceToNextNode / createChoreoJobState.
        if (job.progress < 0) {
            this.applyChoreoAnimation(settler, node);
            if (this.verbose) {
                this.emitNodeStarted(settler, job, node);
            }
            job.progress = 0;
        }

        // Set visibility from node
        settler.hidden = !node.visible;

        // Update handler fields in-place (no allocation) for movement/work contexts
        const entityHandler = this.handlerRegistry.getEntityHandler(config.search);
        const positionHandler = this.handlerRegistry.getPositionHandler(config.plantSearch ?? config.search);
        this.movementCtx.entityHandler = entityHandler;
        this.movementCtx.positionHandler = positionHandler;
        this.workCtx.entityHandler = entityHandler;
        this.workCtx.positionHandler = positionHandler;

        // Execute via category-scoped executor dispatch
        const result = this.executeNode(settler, job, node, dt);

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
        if (this.verbose) {
            const completedNode = nodes[job.nodeIndex]!;
            this.eventBus.emit('choreo:nodeCompleted', {
                unitId: settler.id,
                jobId: job.jobId,
                nodeIndex: job.nodeIndex,
                task: ChoreoTaskType[completedNode.task],
            });
        }
        // Stop active trigger when leaving a node
        if (job.activeTrigger) {
            const buildingId = this.getWorkerHomeBuilding(settler.id);
            if (buildingId !== null) {
                this.triggerSystem.stopTrigger(buildingId, job.activeTrigger);
            }
            job.activeTrigger = '';
        }
        job.nodeIndex++;
        job.progress = -1; // sentinel: next tick is "first tick" of the new node
        job.workStarted = false;
        job.pathRetryCountdown = 0;
        // Reset targetPos between nodes. Transport jobs read positions directly from
        // transportData (sourcePos/destPos) so they don't rely on cross-node targetPos.
        job.targetPos = null;
        // Animation for the next node is applied on its first tick (progress sentinel = -1).
    }

    /** Execute a single choreography node, catching executor crashes. */
    private executeNode(settler: Entity, job: ChoreoJobState, node: ChoreoNode, dt: number): TaskResult {
        const category = TASK_CATEGORY[node.task];
        try {
            switch (category) {
            case ExecutorCategory.MOVEMENT:
                return MOVEMENT_EXECUTORS[node.task as keyof typeof MOVEMENT_EXECUTORS](
                    settler,
                    job,
                    node,
                    dt,
                    this.movementCtx
                );
            case ExecutorCategory.WORK:
                return WORK_EXECUTORS[node.task as keyof typeof WORK_EXECUTORS](
                    settler,
                    job,
                    node,
                    dt,
                    this.workCtx
                );
            case ExecutorCategory.INVENTORY:
                return INVENTORY_EXECUTORS[node.task as keyof typeof INVENTORY_EXECUTORS](
                    settler,
                    job,
                    node,
                    dt,
                    this.inventoryCtx
                );
            case ExecutorCategory.CONTROL:
                return CONTROL_EXECUTORS[node.task as keyof typeof CONTROL_EXECUTORS](
                    settler,
                    job,
                    node,
                    dt,
                    this.controlCtx
                );
            default:
                return TaskResult.FAILED;
            }
        } catch (e) {
            this.handlerErrorLogger.error(
                `Executor crash: settler=${settler.id} job=${job.jobId} nodeIdx=${job.nodeIndex} task=${node.task}`,
                e instanceof Error ? e : new Error(String(e))
            );
            return TaskResult.FAILED;
        }
    }

    /**
     * Complete a job and return to idle state.
     */
    completeJob(settler: Entity, runtime: WorkerRuntimeState): void {
        const job = runtime.job!;

        // Stop any active trigger
        if (job.activeTrigger) {
            const homeId = this.getWorkerHomeBuilding(settler.id);
            if (homeId !== null) {
                this.triggerSystem.stopTrigger(homeId, job.activeTrigger);
            }
        }

        log.debug(`Settler ${settler.id} completed job ${job.jobId}`);

        this.eventBus.emit('settler:taskCompleted', {
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
            this.transportJobOps.cancel(job.transportData.jobId);
        }

        // Drop carried material as free pile (no-op if not carrying)
        this.materialTransfer.drop(settler.id);

        // Stop any active trigger
        if (job.activeTrigger) {
            const homeId = this.getWorkerHomeBuilding(settler.id);
            if (homeId !== null) {
                this.triggerSystem.stopTrigger(homeId, job.activeTrigger);
            }
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
        this.eventBus.emit('settler:taskFailed', {
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
            () => handler.findTarget(settler.x, settler.y, settler.id, settler.player),
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
            return this.buildingPositionResolver.resolvePosition(homeBuilding.id, 0, 0, true);
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

    /** Emit verbose choreo:waitingAtHome event. */
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

    /** Emit verbose choreo:nodeStarted event. */
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

    /** Apply choreography animation for a node via the JobPartResolver. */
    private applyChoreoAnimation(settler: Entity, node: ChoreoNode): void {
        if (!node.jobPart) return;
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
        const inv = this.inventoryManager;
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
     * Used when output is full, settler can't work, or first visit.
     * Emits choreo:waitingAtHome once on the transition (movement start or entering hidden).
     */
    private returnHomeAndWait(
        settler: Entity,
        homeBuilding: Entity,
        reason?: 'output_full' | 'cant_work' | 'first_visit'
    ): void {
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
            if (this.verbose && reason && !settler.hidden) {
                this.emitWaitingAtHome(settler, homeBuilding, reason);
            }
            settler.hidden = true;
            this.animController.setIdleAnimation(settler);
            return;
        }

        // If not moving, start moving home
        if (controller.state === 'idle') {
            if (this.verbose && reason) {
                this.emitWaitingAtHome(settler, homeBuilding, reason);
            }
            this.gameState.movement.moveUnit(settler.id, door.x, door.y);
            this.animController.startWalkAnimation(settler, controller.direction);
        }
    }
}
