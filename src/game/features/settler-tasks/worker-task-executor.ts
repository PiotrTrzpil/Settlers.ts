/**
 * Worker task executor.
 *
 * Handles job selection, execution, completion, and interruption for all
 * settlers that use choreography job sequences (XML-defined).
 */

import type { Entity } from '../../entity';
import type { CoreDeps } from '../feature';
import { UnitType } from '../../entity';
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
    ChoreoJob,
    MovementContext,
    WorkContext,
    InventoryExecutorContext,
    ControlContext,
    BuildingPositionResolver,
    TriggerSystem,
    JobPartResolver,
    TransportJobOps,
} from './choreo-types';
import { ChoreoTaskType } from './choreo-types';
import { registerCoreExecutors } from './choreo-executors';
import type { ChoreoSystem } from '../../systems/choreo';
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
import { getBuildingDoorPos, getWorkerBuildingTypes } from '../../data/game-data-access';
import { BuildingType } from '../../buildings/building-type';
import type { ISettlerBuildingLocationManager } from '../settler-location';
import { findNearestWorkplace } from './work-handlers';
import { JobSelector } from './job-selector';
import { safeCall } from './safe-call';
import { WorkerJobLifecycle } from './internal/worker-job-lifecycle';

/** Per-unit state needed by the worker executor (subset of UnitRuntime). */
export interface WorkerRuntimeState {
    state: SettlerState;
    job: JobState | null;
    homeAssignment: HomeAssignment | null;
}

/** Building occupancy map (read-only view for finding workplaces). */
export type OccupancyMap = ReadonlyMap<number, number>;

export interface WorkerTaskExecutorConfig extends CoreDeps {
    choreoSystem: ChoreoSystem;
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
    locationManager: ISettlerBuildingLocationManager;
    getBarracksTrainingManager?: () => BarracksTrainingManager | undefined;
    executeCommand?: (cmd: Command) => CommandResult;
}

export class WorkerTaskExecutor {
    private readonly gameState: GameState;
    private readonly choreographyStore: JobChoreographyStore;
    private readonly handlerRegistry: WorkHandlerRegistry;
    private readonly handlerErrorLogger: ThrottledLogger;
    private readonly missingHandlerLogger: ThrottledLogger;
    private readonly isBuildingAvailable?: (buildingId: number) => boolean;
    private readonly jobSelector: JobSelector;
    private readonly eventBus: EventBus;
    private readonly inventoryManager: BuildingInventoryManager;
    private readonly getWorkerHomeBuilding: (settlerId: number) => number | null;
    private readonly buildingPositionResolver: BuildingPositionResolver;

    // Pre-built context objects — handler fields updated in-place per tick (no allocation)
    private readonly movementCtx: MovementContext;
    private readonly workCtx: WorkContext;
    private readonly inventoryCtx: InventoryExecutorContext;
    private readonly controlCtx: ControlContext;

    private readonly lifecycle: WorkerJobLifecycle;

    /** Enable verbose choreography events (nodeStarted, nodeCompleted, animationApplied, waitingAtHome) */
    verbose = false;

    constructor(cfg: WorkerTaskExecutorConfig) {
        this.gameState = cfg.gameState;
        this.choreographyStore = cfg.choreographyStore;
        this.handlerRegistry = cfg.handlerRegistry;
        this.handlerErrorLogger = cfg.handlerErrorLogger;
        this.missingHandlerLogger = cfg.missingHandlerLogger;
        this.isBuildingAvailable = cfg.isBuildingAvailable;
        this.jobSelector = new JobSelector(cfg.choreographyStore);
        this.eventBus = cfg.eventBus;
        this.inventoryManager = cfg.inventoryManager;
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

        this.lifecycle = new WorkerJobLifecycle({
            choreoSystem: cfg.choreoSystem,
            handlerRegistry: cfg.handlerRegistry,
            animController: cfg.animController,
            jobPartResolver: cfg.jobPartResolver,
            locationManager: cfg.locationManager,
            gameState: cfg.gameState,
            triggerSystem: cfg.triggerSystem,
            materialTransfer: cfg.materialTransfer,
            transportJobOps: cfg.transportJobOps,
            handlerErrorLogger: cfg.handlerErrorLogger,
            eventBus: cfg.eventBus,
            getWorkerHomeBuilding: cfg.getWorkerHomeBuilding,
            movementCtx: this.movementCtx,
            workCtx: this.workCtx,
            getVerbose: () => this.verbose,
        });

        // Register core executors — TRANSFORM_RECRUIT/DIRECT are registered by recruit feature later.
        registerCoreExecutors(cfg.choreoSystem, this.movementCtx, this.workCtx, this.inventoryCtx, this.controlCtx);
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
        if (!homeBuilding && getWorkerBuildingTypes(settler.race, settler.subType as UnitType)) {
            this.emitIdleSkipped(settler.id, 'no_home', null);
            return false;
        }

        // Worker is inside their building — still search for work.
        // If work is found, startJob() calls exitBuilding().
        // If not, they stay inside (returnHomeAndWait is a no-op when already inside).

        // First visit: worker must walk to their building before starting work
        if (homeBuilding && !runtime.homeAssignment!.hasVisited) {
            if (this.isAtHomeBuilding(settler, homeBuilding)) {
                runtime.homeAssignment!.hasVisited = true;
            } else {
                this.lifecycle.returnHomeAndWait(settler, homeBuilding, 'first_visit');
                return false;
            }
        }

        const targets = this.findTargets(settler, entityHandler, positionHandler, homeBuilding);
        if (!targets) return false; // error already logged

        const selected = this.jobSelector.selectJob(settler, config, targets.entity, homeBuilding, targets.position);
        if (!selected) {
            const reason = !targets.entity && !targets.position ? 'no_target' : 'no_job';
            this.emitIdleSkipped(settler.id, reason, homeBuilding);
            return false;
        }

        if (this.shouldWaitBeforeStarting(settler, homeBuilding, selected, entityHandler, targets.entity)) return false;

        this.lifecycle.startJob(settler, runtime, selected, targets.entity, homeBuilding, targets.position);
        return true;
    }

    /** Emit choreo:idleSkipped if verbose logging is on. */
    private emitIdleSkipped(
        unitId: number,
        reason: 'inside_building' | 'no_home' | 'no_target' | 'no_job',
        homeBuilding: Entity | null
    ): void {
        if (!this.verbose) return;
        this.eventBus.emit('choreo:idleSkipped', { unitId, reason, homeBuilding: homeBuilding?.id ?? null });
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
            this.lifecycle.returnHomeAndWait(settler, homeBuilding, 'output_full');
            return true;
        }
        if (entityHandler?.canWork && entityTarget && !entityHandler.canWork(entityTarget.entityId)) {
            if (homeBuilding) {
                this.lifecycle.returnHomeAndWait(settler, homeBuilding, 'cant_work');
            }
            return true;
        }
        return false;
    }

    /**
     * Handle a worker in WORKING state: advance the current choreography node.
     */
    handleWorking(settler: Entity, config: SettlerConfig, runtime: WorkerRuntimeState, dt: number): void {
        if (!runtime.job) {
            throw new Error(
                `handleWorking: settler ${settler.id} (${UnitType[settler.subType]}) ` +
                    `is in WORKING state but has no job. ` +
                    `homeAssignment=${runtime.homeAssignment?.buildingId ?? null}`
            );
        }
        const job = runtime.job;

        const nodes = job.nodes;
        if (job.nodeIndex >= nodes.length) {
            this.lifecycle.completeJob(settler, runtime);
            return;
        }

        const node = nodes[job.nodeIndex]!;
        this.lifecycle.prepareNodeTick(settler, config, job, node);

        const isPileAction = node.task === ChoreoTaskType.GET_GOOD || node.task === ChoreoTaskType.PUT_GOOD;
        const controller = isPileAction ? this.gameState.movement.getController(settler.id) : undefined;
        if (controller) controller.busy = true;

        const result = this.lifecycle.executeNode(settler, job, node, dt);

        if (controller && result !== TaskResult.CONTINUE) {
            controller.busy = false;
        }

        switch (result) {
        case TaskResult.DONE:
            this.lifecycle.advanceToNextNode(settler, job, nodes);
            break;
        case TaskResult.FAILED:
            this.lifecycle.interruptJob(settler, config, runtime);
            break;
        case TaskResult.CONTINUE:
            break;
        }
    }

    /** Complete a job and return to idle state. */
    completeJob(settler: Entity, runtime: WorkerRuntimeState): void {
        this.lifecycle.completeJob(settler, runtime);
    }

    /**
     * Interrupt a job (target gone, pathfinding failure, etc.).
     * Must NOT be called when the job has already completed all nodes —
     * use completeJob for that case. Callers should check `isJobDone()` first.
     */
    interruptJob(settler: Entity, config: SettlerConfig, runtime: WorkerRuntimeState): void {
        this.lifecycle.interruptJob(settler, config, runtime);
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

    /**
     * Check if a building's output is full for the goods produced by this choreo job.
     * Looks for PUT_GOOD / PUT_GOOD_VIRTUAL / RESOURCE_GATHERING / RESOURCE_GATHERING_VIRTUAL
     * nodes that declare an output good.
     */
    private isOutputFull(homeBuilding: Entity, job: ChoreoJob): boolean {
        const outputNode = job.nodes.find(
            n =>
                n.task === ChoreoTaskType.PUT_GOOD ||
                n.task === ChoreoTaskType.PUT_GOOD_VIRTUAL ||
                n.task === ChoreoTaskType.RESOURCE_GATHERING ||
                n.task === ChoreoTaskType.RESOURCE_GATHERING_VIRTUAL
        );
        if (!outputNode?.entity) return false;

        const material = this.parseMaterial(outputNode.entity);
        if (material === null) return false;

        const slot = this.inventoryManager.getOutputSlot(homeBuilding.id, material);
        return slot !== undefined && slot.currentAmount >= slot.maxCapacity;
    }

    /** Parse a material string (e.g. 'GOOD_LOG' or 'LOG') to EMaterialType, or null. */
    private parseMaterial(entity: string): EMaterialType | null {
        const key = entity.replace(/^GOOD_/, '');
        const value = EMaterialType[key as keyof typeof EMaterialType] as EMaterialType | undefined;
        return value ?? null;
    }
}
