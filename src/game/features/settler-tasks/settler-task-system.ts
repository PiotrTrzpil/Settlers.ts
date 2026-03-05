/**
 * Settler Task System - manages ALL unit behaviors via tasks.
 *
 * Coordinator that wires together sub-systems:
 * - WorkHandlerRegistry: domain handler registration and lookup
 * - UnitStateMachine: per-unit IDLE/WORKING/INTERRUPTED state transitions
 * - WorkerTaskExecutor: choreography-driven job execution (XML-defined)
 * - IdleAnimationController: idle turning and animation helpers
 *
 * Domain systems (WoodcuttingSystem, etc.) register work handlers
 * that are called when settlers perform WORK_ON_ENTITY tasks.
 */

import type { GameState } from '../../game-state';
import type { TickSystem } from '../../tick-system';
import { EntityType, UnitType, type Entity } from '../../entity';
import { LogHandler } from '@/utilities/log-handler';
import { ThrottledLogger } from '@/utilities/throttled-logger';
import { sortedEntries } from '@/utilities/collections';
import { SearchType, SettlerState, type JobState, type WorkHandler, type SettlerConfig } from './types';
import { buildAllSettlerConfigs } from '../../settler-data-access';
import type { EventBus } from '../../event-bus';
import type { BuildingInventoryManager, BuildingPileRegistry } from '../inventory';
import type { PileRegistry } from '../inventory/pile-registry';
import type { CarrierManager } from '../carriers';
import { createWorkplaceHandler, createCarrierHandler } from './work-handlers';
import type { EntityVisualService } from '../../animation/entity-visual-service';
import { WorkHandlerRegistry } from './work-handler-registry';
import { IdleAnimationController } from './idle-animation-controller';
import { WorkerTaskExecutor } from './worker-task-executor';
import { UnitStateMachine, type UnitRuntime } from './unit-state-machine';
import { JobChoreographyStore } from './job-choreography-store';
import { BuildingPositionResolverImpl } from './building-position-resolver';
import { JobPartResolverImpl } from './job-part-resolver';
import { TriggerSystemImpl } from '../building-overlays/trigger-system';
import { getGameDataLoader } from '@/resources/game-data';
import type { ChoreoContext } from './choreo-types';
import type { WorkAreaStore } from '../work-areas/work-area-store';
import type { BuildingOverlayManager } from '../building-overlays/building-overlay-manager';
import type { OreVeinData } from '../ore-veins/ore-vein-data';
import type { ProductionControlManager } from '../production-control';
import type { BarracksTrainingManager } from '../barracks';
import type { ConstructionSiteManager } from '../building-construction/construction-site-manager';
import type { Command, CommandResult } from '../../commands';

const log = new LogHandler('SettlerTaskSystem');

/** How often to run the orphan-runtime safety net (in ticks) */
const ORPHAN_CHECK_INTERVAL = 60;

/** Local alias — Map from UnitType to settler config. */
type SettlerConfigs = Map<UnitType, SettlerConfig>;

/** Configuration for SettlerTaskSystem dependencies */
export interface SettlerTaskSystemConfig {
    gameState: GameState;
    visualService: EntityVisualService;
    inventoryManager: BuildingInventoryManager;
    carrierManager: CarrierManager;
    eventBus: EventBus;
    /** Lazy getter — pile slot registry for live entity lookup. */
    getPileSlotRegistry: () => PileRegistry | null;
    /** Lazy getter — pile registry may be set after construction (game data load). */
    getPileRegistry: () => BuildingPileRegistry | null;
    /** Work area store for resolving building work-center positions. */
    workAreaStore: WorkAreaStore;
    /** Building overlay manager for trigger-driven overlay animations. */
    buildingOverlayManager: BuildingOverlayManager;
    /** Lazy getter — resolved on first use (production control may init after construction). */
    getProductionControlManager?: () => ProductionControlManager;
    /** Lazy getter — resolved on first use (barracks training manager inits after construction). */
    getBarracksTrainingManager?: () => BarracksTrainingManager;
    /** Construction site manager — used to filter out buildings still under construction. */
    constructionSiteManager: ConstructionSiteManager;
    /** Command executor for entity creation/removal during simulation. */
    executeCommand: (cmd: Command) => CommandResult;
}

/**
 * Manages all unit behaviors through task execution.
 */
export class SettlerTaskSystem implements TickSystem {
    private readonly gameState: GameState;
    private readonly inventoryManager: BuildingInventoryManager;
    private readonly settlerConfigs: SettlerConfigs;
    private readonly choreographyStore: JobChoreographyStore;
    private readonly handlerRegistry: WorkHandlerRegistry;
    private readonly animController: IdleAnimationController;
    private readonly choreoContext: ChoreoContext;
    private readonly buildingPositionResolver: BuildingPositionResolverImpl;
    private readonly workerExecutor: WorkerTaskExecutor;
    private readonly stateMachine: UnitStateMachine;
    private readonly runtimes = new Map<number, UnitRuntime>();
    /** Tracks how many workers are assigned to each building (for occupancy limits). */
    private readonly buildingOccupants = new Map<number, number>();
    /** Per-tile ore data — set after terrain is loaded via setOreVeinData(). */
    private oreVeinData: OreVeinData | undefined;
    /** Tick counter for throttling the orphan-runtime safety net */
    private ticksSinceOrphanCheck = 0;

    constructor(config: SettlerTaskSystemConfig) {
        this.gameState = config.gameState;
        this.inventoryManager = config.inventoryManager;

        this.settlerConfigs = buildAllSettlerConfigs();
        this.choreographyStore = new JobChoreographyStore();

        // Throttled loggers shared across sub-systems
        const handlerErrorLogger = new ThrottledLogger(log, 2000);
        const missingHandlerLogger = new ThrottledLogger(log, 5000);

        const jobPartResolver = new JobPartResolverImpl();
        const triggerSystem = new TriggerSystemImpl({
            overlayManager: config.buildingOverlayManager,
            gameState: this.gameState,
            dataLoader: getGameDataLoader(),
        });

        this.buildingPositionResolver = new BuildingPositionResolverImpl({
            gameState: this.gameState,
            getPileSlotRegistry: config.getPileSlotRegistry,
            getPileRegistry: config.getPileRegistry,
            workAreaStore: config.workAreaStore,
        });

        const choreoContext: ChoreoContext = {
            gameState: this.gameState,
            inventoryManager: this.inventoryManager,
            carrierManager: config.carrierManager,
            eventBus: config.eventBus,
            handlerErrorLogger,
            jobPartResolver,
            buildingPositionResolver: this.buildingPositionResolver,
            triggerSystem,
            getWorkerHomeBuilding: this.getAssignedBuilding.bind(this),
            executeCommand: config.executeCommand,
            get barracksTrainingManager() {
                return config.getBarracksTrainingManager?.();
            },
        };

        this.choreoContext = choreoContext;
        this.handlerRegistry = new WorkHandlerRegistry();

        this.animController = new IdleAnimationController(config.visualService, this.gameState.rng);

        const constructionSiteManager = config.constructionSiteManager;
        this.workerExecutor = new WorkerTaskExecutor({
            gameState: this.gameState,
            choreographyStore: this.choreographyStore,
            handlerRegistry: this.handlerRegistry,
            animController: this.animController,
            choreoContext,
            handlerErrorLogger,
            missingHandlerLogger,
            isBuildingAvailable: (buildingId: number) => !constructionSiteManager.hasSite(buildingId),
        });

        this.stateMachine = new UnitStateMachine({
            gameState: this.gameState,
            visualService: config.visualService,
            settlerConfigs: this.settlerConfigs,
            animController: this.animController,
            workerExecutor: this.workerExecutor,
            buildingOccupants: this.buildingOccupants,
            claimBuilding: this.claimBuilding.bind(this),
            releaseBuilding: this.releaseBuilding.bind(this),
        });

        // Register built-in WORKPLACE handler for building workers
        this.handlerRegistry.register(
            SearchType.WORKPLACE,
            createWorkplaceHandler(
                this.gameState,
                this.inventoryManager,
                this.getAssignedWorkplace.bind(this),
                () => this.oreVeinData,
                config.getProductionControlManager
            )
        );

        // Register GOOD handler for carriers (they get jobs assigned externally by LogisticsDispatcher)
        this.handlerRegistry.register(SearchType.GOOD, createCarrierHandler());

        log.debug(
            `Loaded ${this.settlerConfigs.size} settler configs, ${this.choreographyStore.cacheSize} cached jobs`
        );
    }

    /** Expose the building position resolver for external consumers (logistics transport job builder). */
    getPositionResolver(): BuildingPositionResolverImpl {
        return this.buildingPositionResolver;
    }

    /** Expose the choreography store for external consumers (logistics transport job builder). */
    getChoreographyStore(): JobChoreographyStore {
        return this.choreographyStore;
    }

    // ─────────────────────────────────────────────────────────────
    // Query API
    // ─────────────────────────────────────────────────────────────

    /**
     * Check if a settler is managed by this system (has active job or is a known type).
     * Other systems should check this before manipulating settler animation.
     */
    isManaged(entityId: number): boolean {
        const entity = this.gameState.getEntity(entityId);
        if (!entity || entity.type !== EntityType.Unit) return false;
        return this.settlerConfigs.has(entity.subType as UnitType);
    }

    /**
     * Check if a unit is currently working (has active job or move task).
     */
    isWorking(entityId: number): boolean {
        const runtime = this.runtimes.get(entityId);
        if (!runtime) return false;
        return runtime.state === SettlerState.WORKING || runtime.moveTask !== null;
    }

    hasMoveTask(entityId: number): boolean {
        const runtime = this.runtimes.get(entityId);
        return runtime !== undefined && runtime.moveTask !== null;
    }

    /**
     * Return debug info for all managed unit runtimes (for e2e diagnostics).
     * Safe to call at any time — returns plain serializable objects.
     */
    getDebugInfo(): Array<{
        entityId: number;
        state: string;
        jobId: string | null;
        jobType: string | null;
        taskIndex: number | null;
        progress: number | null;
        targetId: number | null;
        carryingGood: number | null;
        assignedBuilding: number | null;
    }> {
        const result = [];
        for (const [entityId, runtime] of this.runtimes) {
            result.push(this.buildDebugEntry(entityId, runtime));
        }
        return result;
    }

    private buildDebugEntry(entityId: number, runtime: UnitRuntime) {
        const job = runtime.job;
        if (!job) {
            return {
                entityId,
                state: runtime.state,
                jobId: null,
                jobType: null,
                taskIndex: null,
                progress: null,
                targetId: null,
                carryingGood: null,
                assignedBuilding: runtime.homeAssignment?.buildingId ?? null,
            };
        }
        return {
            entityId,
            state: runtime.state,
            jobId: job.jobId,
            jobType: job.type,
            taskIndex: job.nodeIndex,
            progress: job.progress,
            targetId: job.targetId,
            carryingGood: job.carryingGood,
            assignedBuilding: runtime.homeAssignment?.buildingId ?? null,
        };
    }

    // ─────────────────────────────────────────────────────────────
    // Work handler registration (delegated to registry)
    // ─────────────────────────────────────────────────────────────

    /**
     * Register a work handler for a search type.
     * Domain systems call this to plug into the task system.
     * A search type can have one entity handler and one position handler.
     */
    registerWorkHandler(searchType: SearchType, handler: WorkHandler): void {
        this.handlerRegistry.register(searchType, handler);
    }

    /** Get the assigned building ID for a settler, or null if unassigned. */
    getAssignedBuilding(settlerId: number): number | null {
        return this.runtimes.get(settlerId)?.homeAssignment?.buildingId ?? null;
    }

    /** Get the assigned building entity for a settler (for workplace handler). */
    private getAssignedWorkplace(settlerId: number): Entity | null {
        const buildingId = this.getAssignedBuilding(settlerId);
        if (buildingId === null) return null;
        return this.gameState.getEntity(buildingId) ?? null;
    }

    /** Provide ore vein data for mine production checks (called from GameServices.setTerrainData). */
    setOreVeinData(data: OreVeinData): void {
        this.oreVeinData = data;
    }

    // ─────────────────────────────────────────────────────────────
    // Building occupancy tracking
    // ─────────────────────────────────────────────────────────────

    /** Assign a building to a worker, incrementing its occupant count. */
    private claimBuilding(runtime: UnitRuntime, buildingId: number): void {
        runtime.homeAssignment = { buildingId, hasVisited: false };
        this.buildingOccupants.set(buildingId, (this.buildingOccupants.get(buildingId) ?? 0) + 1);
    }

    /** Release a worker's building assignment, decrementing its occupant count. */
    private releaseBuilding(runtime: UnitRuntime): void {
        if (!runtime.homeAssignment) return;
        const id = runtime.homeAssignment.buildingId;
        const count = this.buildingOccupants.get(id);
        if (count === undefined)
            throw new Error(`No occupant count for building ${id} in SettlerTaskSystem.releaseBuilding`);
        if (count <= 1) {
            this.buildingOccupants.delete(id);
        } else {
            this.buildingOccupants.set(id, count - 1);
        }
        runtime.homeAssignment = null;
    }

    // ─────────────────────────────────────────────────────────────
    // Public API for assigning tasks
    // ─────────────────────────────────────────────────────────────

    /**
     * Assign a simple move task to a unit (for user-initiated movement).
     * This interrupts any current job and starts movement to the target.
     * @returns true if movement was started successfully
     */
    assignMoveTask(entityId: number, targetX: number, targetY: number): boolean {
        const entity = this.gameState.getEntity(entityId);
        if (!entity || entity.type !== EntityType.Unit) {
            return false;
        }

        // Start movement via MovementSystem
        const moveSuccess = this.gameState.movement.moveUnit(entityId, targetX, targetY);
        if (!moveSuccess) {
            return false;
        }

        const runtime = this.getRuntime(entityId);

        // Interrupt any current job
        if (runtime.job) {
            const config = this.settlerConfigs.get(entity.subType as UnitType);
            if (config) {
                this.interruptJobForCleanup(entity, config, runtime);
            }
            runtime.job = null;
        }

        // Player is moving this worker away — release building assignment
        this.releaseBuilding(runtime);

        entity.hidden = false;
        runtime.moveTask = { type: 'move', targetX, targetY };
        runtime.state = SettlerState.WORKING;

        // Start walk animation (controller MUST exist after successful moveUnit)
        const controller = this.gameState.movement.getController(entityId)!;
        this.animController.startWalkAnimation(entity, controller.direction);

        log.debug(`Unit ${entityId} assigned move task to (${targetX}, ${targetY})`);
        return true;
    }

    /**
     * Cancel any active move task for a unit.
     */
    cancelMoveTask(entityId: number): void {
        const runtime = this.runtimes.get(entityId);
        if (runtime?.moveTask) {
            runtime.moveTask = null;
            // Don't change state - let tick() handle transition to idle
        }
    }

    /**
     * Assign an externally-constructed job to a unit.
     * Used by LogisticsDispatcher for carrier transport jobs and potentially
     * for future external job assignments (military orders, etc.).
     *
     * Interrupts any current job and optionally starts movement.
     *
     * @param entityId Entity ID of the unit
     * @param job The job state to assign
     * @param moveTo Optional initial movement target
     * @returns true if the job was assigned (movement started if requested)
     */
    assignJob(entityId: number, job: JobState, moveTo?: { x: number; y: number }): boolean {
        const entity = this.gameState.getEntityOrThrow(entityId, 'unit for job assignment');
        const runtime = this.getRuntime(entityId);

        // Interrupt any current job
        if (runtime.job) {
            const config = this.settlerConfigs.get(entity.subType as UnitType);
            if (config) {
                this.interruptJobForCleanup(entity, config, runtime);
            }
            runtime.job = null;
        }

        // Start movement if target position provided
        if (moveTo) {
            const moveSuccess = this.gameState.movement.moveUnit(entityId, moveTo.x, moveTo.y);
            if (!moveSuccess) {
                return false;
            }
        }

        entity.hidden = false;
        runtime.state = SettlerState.WORKING;
        runtime.job = job;
        runtime.moveTask = null;

        // Start walk animation if moving
        if (moveTo) {
            const controller = this.gameState.movement.getController(entityId)!;
            this.animController.startWalkAnimation(entity, controller.direction);
        }

        log.debug(`Unit ${entityId} assigned job ${job.jobId}`);
        return true;
    }

    // ─────────────────────────────────────────────────────────────
    // Tick processing
    // ─────────────────────────────────────────────────────────────

    /**
     * Called by GameLoop when an entity is removed.
     * Handles both settler removal (interrupt jobs, release building) and
     * building removal (release all workers assigned to it).
     */
    // eslint-disable-next-line sonarjs/cognitive-complexity -- complex cleanup for active tasks
    onEntityRemoved(entityId: number): void {
        // If a building was destroyed, release all workers assigned to it
        if (this.buildingOccupants.has(entityId)) {
            this.onBuildingRemoved(entityId);
        }

        // Settler removal — interrupt and clean up runtime
        const runtime = this.runtimes.get(entityId);
        if (!runtime) return;

        const entity = this.gameState.getEntity(entityId);
        if (entity) {
            const config = this.settlerConfigs.get(entity.subType as UnitType);
            if (config && runtime.job) {
                this.interruptJobForCleanup(entity, config, runtime);
            }
        } else if (runtime.job?.targetId && runtime.job.workStarted) {
            // Entity already gone — call onWorkInterrupt directly
            const entityHandler = this.handlerRegistry.findEntityHandlerForJob(runtime.job.jobId, this.settlerConfigs);
            if (entityHandler) {
                try {
                    entityHandler.onWorkInterrupt?.(runtime.job.targetId);
                } catch (e) {
                    const err = e instanceof Error ? e : new Error(String(e));
                    log.error(`onWorkInterrupt failed for entity ${entityId}`, err);
                }
            }
        }

        this.releaseBuilding(runtime);
        this.runtimes.delete(entityId);
    }

    /** Release and interrupt all workers assigned to a destroyed building so they return to idle. */
    private onBuildingRemoved(buildingId: number): void {
        this.buildingOccupants.delete(buildingId);
        for (const [settlerId, runtime] of sortedEntries(this.runtimes)) {
            if (runtime.homeAssignment?.buildingId !== buildingId) continue;

            runtime.homeAssignment = null;

            // Interrupt active job so the worker stops immediately
            if (runtime.job) {
                const entity = this.gameState.getEntity(settlerId);
                if (entity) {
                    const config = this.settlerConfigs.get(entity.subType as UnitType);
                    if (config) {
                        this.interruptJobForCleanup(entity, config, runtime);
                    }
                }
                runtime.job = null;
            }

            // Cancel any in-progress movement (move tasks or raw movement toward building)
            if (runtime.moveTask) {
                runtime.moveTask = null;
            }
            this.gameState.movement.getController(settlerId)?.clearPath();
        }
    }

    /** TickSystem interface */
    tick(dt: number): void {
        for (const entity of this.gameState.entities) {
            if (entity.type === EntityType.Unit) {
                try {
                    const runtime = this.getRuntime(entity.id);
                    this.stateMachine.updateUnit(entity, runtime, dt);
                } catch (e) {
                    const err = e instanceof Error ? e : new Error(String(e));
                    log.error(`Unhandled error updating unit ${entity.id}`, err);
                }
            }
        }

        this.cleanOrphanedRuntimes();
    }

    /** Safety net: clean up runtimes for entities removed without onEntityRemoved signal. */
    private cleanOrphanedRuntimes(): void {
        if (++this.ticksSinceOrphanCheck >= ORPHAN_CHECK_INTERVAL) {
            this.ticksSinceOrphanCheck = 0;
            for (const id of this.runtimes.keys()) {
                if (!this.gameState.getEntity(id)) {
                    this.onEntityRemoved(id);
                }
            }
        }
    }

    // ─────────────────────────────────────────────────────────────
    // Internal helpers
    // ─────────────────────────────────────────────────────────────

    private getRuntime(entityId: number): UnitRuntime {
        let runtime = this.runtimes.get(entityId);
        if (!runtime) {
            runtime = {
                state: SettlerState.IDLE,
                job: null,
                moveTask: null,
                lastDirection: 0,
                idleState: this.animController.createIdleState(),
                homeAssignment: null,
            };
            this.runtimes.set(entityId, runtime);
        }
        return runtime;
    }

    /**
     * Clean up a current job for entity removal or task reassignment.
     * Completes the job if all nodes were already executed; interrupts otherwise.
     */
    private interruptJobForCleanup(entity: Entity, config: SettlerConfig, runtime: UnitRuntime): void {
        const job = runtime.job!;
        if (job.nodeIndex >= job.nodes.length) {
            this.workerExecutor.completeJob(entity, runtime);
        } else {
            this.workerExecutor.interruptJob(entity, config, runtime);
        }
    }
}
