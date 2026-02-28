/**
 * Settler Task System - manages ALL unit behaviors via tasks.
 *
 * Coordinator that wires together sub-systems:
 * - WorkHandlerRegistry: domain handler registration and lookup
 * - UnitStateMachine: per-unit IDLE/WORKING/INTERRUPTED state transitions
 * - WorkerTaskExecutor: YAML worker job execution
 * - CarrierTaskExecutor: carrier transport job execution
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
import { SearchType, SettlerState, type JobState, type WorkHandler, type SettlerConfig } from './types';
import type { TaskContext } from './task-executors';
import { loadJobDefinitions, type SettlerConfigs, type JobDefinitions } from './loader';
import { buildAllSettlerConfigs } from '../../settler-data-access';
import type { EventBus } from '../../event-bus';
import type { BuildingInventoryManager, InventoryVisualizer } from '../inventory';
import type { CarrierManager } from '../carriers';
import { createWorkplaceHandler, createCarrierHandler } from './work-handlers';
import type { EntityVisualService } from '../../animation/entity-visual-service';
import { WorkHandlerRegistry } from './work-handler-registry';
import { IdleAnimationController } from './idle-animation-controller';
import { WorkerTaskExecutor } from './worker-task-executor';
import { CarrierTaskExecutor } from './carrier-task-executor';
import { UnitStateMachine, type UnitRuntime } from './unit-state-machine';

const log = new LogHandler('SettlerTaskSystem');

/** How often to run the orphan-runtime safety net (in ticks) */
const ORPHAN_CHECK_INTERVAL = 60;

/** Configuration for SettlerTaskSystem dependencies */
export interface SettlerTaskSystemConfig {
    gameState: GameState;
    visualService: EntityVisualService;
    inventoryManager: BuildingInventoryManager;
    carrierManager: CarrierManager;
    eventBus: EventBus;
    /** Lazy getter — resolved on first use (breaks circular init dependency). */
    getInventoryVisualizer: () => InventoryVisualizer;
}

/**
 * Manages all unit behaviors through task execution.
 */
export class SettlerTaskSystem implements TickSystem {
    private readonly gameState: GameState;
    private readonly inventoryManager: BuildingInventoryManager;
    private readonly settlerConfigs: SettlerConfigs;
    private readonly jobDefinitions: JobDefinitions;
    private readonly handlerRegistry: WorkHandlerRegistry;
    private readonly animController: IdleAnimationController;
    private readonly workerExecutor: WorkerTaskExecutor;
    private readonly carrierExecutor: CarrierTaskExecutor;
    private readonly stateMachine: UnitStateMachine;
    private readonly runtimes = new Map<number, UnitRuntime>();
    /** Tracks how many workers are assigned to each building (for occupancy limits). */
    private readonly buildingOccupants = new Map<number, number>();
    /** Tick counter for throttling the orphan-runtime safety net */
    private ticksSinceOrphanCheck = 0;

    constructor(config: SettlerTaskSystemConfig) {
        this.gameState = config.gameState;
        this.inventoryManager = config.inventoryManager;

        this.settlerConfigs = buildAllSettlerConfigs();
        this.jobDefinitions = loadJobDefinitions();

        // Throttled loggers shared across sub-systems
        const handlerErrorLogger = new ThrottledLogger(log, 2000);
        const missingHandlerLogger = new ThrottledLogger(log, 5000);

        // Build task context — inventoryVisualizer is resolved lazily
        const getViz = config.getInventoryVisualizer;
        const taskContext: TaskContext = {
            gameState: this.gameState,
            inventoryManager: this.inventoryManager,
            get inventoryVisualizer() {
                return getViz();
            },
            carrierManager: config.carrierManager,
            eventBus: config.eventBus,
            handlerErrorLogger,
            getWorkerHomeBuilding: (settlerId: number) => {
                return this.runtimes.get(settlerId)?.assignedBuilding ?? null;
            },
        };

        this.handlerRegistry = new WorkHandlerRegistry();

        this.animController = new IdleAnimationController(config.visualService, this.gameState.rng);

        this.workerExecutor = new WorkerTaskExecutor(
            this.gameState,
            this.jobDefinitions,
            this.handlerRegistry,
            this.animController,
            taskContext,
            handlerErrorLogger,
            missingHandlerLogger
        );

        this.carrierExecutor = new CarrierTaskExecutor(this.jobDefinitions, this.animController, taskContext);

        this.stateMachine = new UnitStateMachine(
            this.gameState,
            config.visualService,
            this.settlerConfigs,
            this.animController,
            this.workerExecutor,
            this.carrierExecutor,
            this.buildingOccupants,
            (runtime, buildingId) => this.claimBuilding(runtime, buildingId),
            runtime => this.releaseBuilding(runtime)
        );

        // Register built-in WORKPLACE handler for building workers
        this.handlerRegistry.register(
            SearchType.WORKPLACE,
            createWorkplaceHandler(this.gameState, this.inventoryManager, (settlerId: number) => {
                const runtime = this.runtimes.get(settlerId);
                if (!runtime?.assignedBuilding) return null;
                return this.gameState.getEntity(runtime.assignedBuilding) ?? null;
            })
        );

        // Register GOOD handler for carriers (they get jobs assigned externally by LogisticsDispatcher)
        this.handlerRegistry.register(SearchType.GOOD, createCarrierHandler());

        log.debug(`Loaded ${this.settlerConfigs.size} settler configs, ${this.jobDefinitions.size} jobs`);
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
            const job = runtime.job;
            const carryingGood = job?.data.carryingGood ?? null;
            result.push({
                entityId,
                state: runtime.state,
                jobId: job?.jobId ?? null,
                jobType: job?.type ?? null,
                taskIndex: job?.taskIndex ?? null,
                progress: job?.progress ?? null,
                targetId: job?.type === 'worker' ? (job.data.targetId ?? null) : null,
                carryingGood,
                assignedBuilding: runtime.assignedBuilding,
            });
        }
        return result;
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

    // ─────────────────────────────────────────────────────────────
    // Building occupancy tracking
    // ─────────────────────────────────────────────────────────────

    /** Assign a building to a worker, incrementing its occupant count. */
    private claimBuilding(runtime: UnitRuntime, buildingId: number): void {
        runtime.assignedBuilding = buildingId;
        this.buildingOccupants.set(buildingId, (this.buildingOccupants.get(buildingId) ?? 0) + 1);
    }

    /** Release a worker's building assignment, decrementing its occupant count. */
    private releaseBuilding(runtime: UnitRuntime): void {
        if (runtime.assignedBuilding === null) return;
        const count = this.buildingOccupants.get(runtime.assignedBuilding) ?? 1;
        if (count <= 1) {
            this.buildingOccupants.delete(runtime.assignedBuilding);
        } else {
            this.buildingOccupants.set(runtime.assignedBuilding, count - 1);
        }
        runtime.assignedBuilding = null;
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
        } else if (runtime.job?.type === 'worker' && runtime.job.data.targetId && runtime.job.workStarted) {
            // Entity already gone — call onWorkInterrupt directly
            const entityHandler = this.handlerRegistry.findEntityHandlerForJob(runtime.job.jobId, this.settlerConfigs);
            if (entityHandler) {
                try {
                    entityHandler.onWorkInterrupt?.(runtime.job.data.targetId);
                } catch (e) {
                    const err = e instanceof Error ? e : new Error(String(e));
                    log.error(`onWorkInterrupt failed for entity ${entityId}`, err);
                }
            }
        }

        this.releaseBuilding(runtime);
        this.runtimes.delete(entityId);
    }

    /** Release all workers assigned to a destroyed building so they can find new workplaces. */
    private onBuildingRemoved(buildingId: number): void {
        this.buildingOccupants.delete(buildingId);
        for (const runtime of this.runtimes.values()) {
            if (runtime.assignedBuilding === buildingId) {
                runtime.assignedBuilding = null;
            }
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
                assignedBuilding: null,
            };
            this.runtimes.set(entityId, runtime);
        }
        return runtime;
    }

    /**
     * Interrupt a job for cleanup purposes (entity removal or task reassignment).
     * Delegates to the appropriate executor based on job type.
     */
    private interruptJobForCleanup(entity: Entity, config: SettlerConfig, runtime: UnitRuntime): void {
        if (runtime.job!.type === 'carrier') {
            this.carrierExecutor.interruptJob(entity, runtime);
        } else {
            this.workerExecutor.interruptJob(entity, config, runtime);
        }
    }
}
