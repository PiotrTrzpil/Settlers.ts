/**
 * Settler Task System - manages ALL unit behaviors via tasks.
 *
 * This system is the single source of truth for unit behavior and animation:
 * - Workers execute job sequences defined in YAML
 * - All units (including non-workers) can receive move tasks from user commands
 * - Handles walk/idle animations for all units
 * - Handles idle turning when units have no task
 *
 * Domain systems (WoodcuttingSystem, etc.) register work handlers
 * that are called when settlers perform WORK_ON_ENTITY tasks.
 */

import type { GameState } from '../../game-state';
import type { TickSystem } from '../../tick-system';
import { EntityType, UnitType, Entity, clearCarrying } from '../../entity';
import { LogHandler } from '@/utilities/log-handler';
import { ThrottledLogger } from '@/utilities/throttled-logger';
import { hexDistance } from '../../systems/hex-directions';
import { ANIMATION_SEQUENCES } from '../../animation';
import { resolveTaskAnimation, type AnimationService } from '../../animation/index';
import {
    TaskType,
    TaskResult,
    SearchType,
    SettlerState,
    type SettlerConfig,
    type TaskNode,
    type WorkerJobData,
    type JobState,
    type EntityWorkHandler,
    type PositionWorkHandler,
    type WorkHandler,
} from './types';
import { executeTask, type TaskContext } from './task-executors';
import { loadSettlerConfigs, loadJobDefinitions, type SettlerConfigs, type JobDefinitions } from './loader';
import type { EventBus } from '../../event-bus';
import type { BuildingInventoryManager, InventoryVisualizer } from '../inventory';
import type { CarrierManager } from '../carriers';
import { createWorkplaceHandler, createCarrierHandler, isOutputFull, findNearestWorkplace } from './work-handlers';

const log = new LogHandler('SettlerTaskSystem');

/** Number of sprite directions (matches hex grid) */
const NUM_DIRECTIONS = 6;

/** How often to run the orphan-runtime safety net (in ticks) */
const ORPHAN_CHECK_INTERVAL = 60;

/** Simple move task state (for user-initiated movement) */
interface MoveTaskState {
    type: 'move';
    targetX: number;
    targetY: number;
}

/** Idle animation state for random turning */
interface IdleAnimationState {
    idleTime: number;
    nextIdleTurnTime: number;
}

/** Runtime state for each unit */
interface UnitRuntime {
    state: SettlerState;
    /** Job state - either worker or carrier job */
    job: JobState | null;
    /** Simple move task (for user commands) */
    moveTask: MoveTaskState | null;
    /** Last known direction (for change detection) */
    lastDirection: number;
    /** Idle animation state */
    idleState: IdleAnimationState;
}

/** Configuration for SettlerTaskSystem dependencies */
export interface SettlerTaskSystemConfig {
    gameState: GameState;
    animationService: AnimationService;
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
    private gameState: GameState;
    private animationService: AnimationService;
    private inventoryManager: BuildingInventoryManager;
    private carrierManager: CarrierManager;
    private settlerConfigs: SettlerConfigs;
    private jobDefinitions: JobDefinitions;
    private entityHandlers = new Map<SearchType, EntityWorkHandler>();
    private positionHandlers = new Map<SearchType, PositionWorkHandler>();
    private runtimes = new Map<number, UnitRuntime>();
    private readonly eventBus: EventBus;
    /** Throttled logger for handler errors (prevents flooding from broken domain systems) */
    private handlerErrorLogger = new ThrottledLogger(log, 2000);
    /** Throttled logger for missing handler warnings (prevents spam when feature not yet implemented) */
    private missingHandlerLogger = new ThrottledLogger(log, 5000);
    /** Context object passed to task executor functions */
    private readonly taskContext: TaskContext;
    /** Tick counter for throttling the orphan-runtime safety net */
    private ticksSinceOrphanCheck = 0;

    constructor(config: SettlerTaskSystemConfig) {
        this.gameState = config.gameState;
        this.animationService = config.animationService;
        this.inventoryManager = config.inventoryManager;
        this.carrierManager = config.carrierManager;
        this.eventBus = config.eventBus;
        this.settlerConfigs = loadSettlerConfigs();
        this.jobDefinitions = loadJobDefinitions();

        // Register built-in WORKPLACE handler for building workers
        this.registerWorkHandler(SearchType.WORKPLACE, createWorkplaceHandler(this.gameState, this.inventoryManager));

        // Register GOOD handler for carriers (they get jobs assigned externally by LogisticsDispatcher)
        this.registerWorkHandler(SearchType.GOOD, createCarrierHandler());

        // Build task context eagerly — inventoryVisualizer is resolved lazily via getter
        const getViz = config.getInventoryVisualizer;
        this.taskContext = {
            gameState: this.gameState,
            inventoryManager: this.inventoryManager,
            get inventoryVisualizer() {
                return getViz();
            },
            carrierManager: this.carrierManager,
            eventBus: this.eventBus,
            handlerErrorLogger: this.handlerErrorLogger,
        };

        log.debug(`Loaded ${this.settlerConfigs.size} settler configs, ${this.jobDefinitions.size} jobs`);
    }

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
     * Register a work handler for a search type.
     * Domain systems call this to plug into the task system.
     * A search type can have one entity handler and one position handler.
     */
    registerWorkHandler(searchType: SearchType, handler: WorkHandler): void {
        if (handler.type === 'entity') {
            if (this.entityHandlers.has(searchType)) {
                throw new Error(`Entity work handler already registered for ${searchType}.`);
            }
            this.entityHandlers.set(searchType, handler);
        } else {
            if (this.positionHandlers.has(searchType)) {
                throw new Error(`Position work handler already registered for ${searchType}.`);
            }
            this.positionHandlers.set(searchType, handler);
        }
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

        // Get or create runtime
        const runtime = this.getRuntime(entityId);

        // Interrupt any current job
        if (runtime.job) {
            const config = this.settlerConfigs.get(entity.subType as UnitType);
            if (config) {
                this.interruptJob(entity, config, runtime);
            }
            runtime.job = null;
        }

        // Set up move task
        entity.hidden = false;
        runtime.moveTask = {
            type: 'move',
            targetX,
            targetY,
        };
        runtime.state = SettlerState.WORKING;

        // Start walk animation (controller MUST exist after successful moveUnit)
        const controller = this.gameState.movement.getController(entityId)!;
        this.startWalkAnimation(entity, controller.direction);

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
                this.interruptJob(entity, config, runtime);
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

        // Set runtime state
        entity.hidden = false;
        runtime.state = SettlerState.WORKING;
        runtime.job = job;
        runtime.moveTask = null;

        // Start walk animation if moving
        if (moveTo) {
            const controller = this.gameState.movement.getController(entityId)!;
            this.startWalkAnimation(entity, controller.direction);
        }

        log.debug(`Unit ${entityId} assigned job ${job.jobId}`);
        return true;
    }

    // ─────────────────────────────────────────────────────────────
    // Tick processing
    // ─────────────────────────────────────────────────────────────

    /**
     * Called by GameLoop when an entity is removed.
     * Properly interrupts work in progress so domain systems can clean up.
     */
    // eslint-disable-next-line sonarjs/cognitive-complexity -- complex cleanup for active tasks
    onEntityRemoved(entityId: number): void {
        const runtime = this.runtimes.get(entityId);
        if (!runtime) return;

        const entity = this.gameState.getEntity(entityId);
        if (entity) {
            const config = this.settlerConfigs.get(entity.subType as UnitType);
            if (config && runtime.job) {
                this.interruptJob(entity, config, runtime);
            }
        } else if (runtime.job?.type === 'worker' && runtime.job.data.targetId && runtime.job.workStarted) {
            // Entity already gone — call onWorkInterrupt directly
            const entityHandler = this.findEntityHandlerForJob(runtime.job.jobId);
            if (entityHandler) {
                try {
                    entityHandler.onWorkInterrupt?.(runtime.job.data.targetId);
                } catch (e) {
                    const err = e instanceof Error ? e : new Error(String(e));
                    this.handlerErrorLogger.error(`onWorkInterrupt failed for entity ${entityId}`, err);
                }
            }
        }

        this.runtimes.delete(entityId);
    }

    /** Reverse-lookup: find the entity work handler for a given jobId like "woodcutter.work" */
    private findEntityHandlerForJob(jobId: string): EntityWorkHandler | undefined {
        for (const [unitType, config] of this.settlerConfigs) {
            const prefix = UnitType[unitType].toLowerCase();
            for (const jobName of config.jobs) {
                if (`${prefix}.${jobName}` === jobId) {
                    return this.entityHandlers.get(config.search);
                }
            }
        }
        return undefined;
    }

    /** TickSystem interface */
    tick(dt: number): void {
        // Process ALL units (not just those with YAML configs)
        for (const entity of this.gameState.entities) {
            if (entity.type === EntityType.Unit) {
                this.updateUnit(entity, dt);
            }
        }

        // Safety net: clean up runtimes for entities removed without onEntityRemoved signal.
        // Runs every ~60 ticks since onEntityRemoved is the primary cleanup path.
        if (++this.ticksSinceOrphanCheck >= ORPHAN_CHECK_INTERVAL) {
            this.ticksSinceOrphanCheck = 0;
            for (const id of this.runtimes.keys()) {
                if (!this.gameState.getEntity(id)) {
                    this.onEntityRemoved(id);
                }
            }
        }
    }

    private getRuntime(entityId: number): UnitRuntime {
        let runtime = this.runtimes.get(entityId);
        if (!runtime) {
            runtime = {
                state: SettlerState.IDLE,
                job: null,
                moveTask: null,
                lastDirection: 0,
                idleState: {
                    idleTime: 0,
                    nextIdleTurnTime: 2 + this.gameState.rng.next() * 4,
                },
            };
            this.runtimes.set(entityId, runtime);
        }
        return runtime;
    }

    private updateUnit(unit: Entity, dt: number): void {
        const runtime = this.getRuntime(unit.id);
        const config = this.settlerConfigs.get(unit.subType as UnitType);

        // Update direction tracking and animation
        this.updateDirectionTracking(unit, runtime);

        // Handle move task first (takes priority)
        if (runtime.moveTask) {
            this.updateMoveTask(unit, runtime);
            return;
        }

        // Handle YAML-based jobs for configured settlers
        if (config) {
            this.updateSettler(unit, config, runtime, dt);
            return;
        }

        // Handle idle state for non-configured units
        this.updateIdleUnit(unit, runtime, dt);
    }

    /**
     * Track direction changes and update animation direction.
     */
    private updateDirectionTracking(unit: Entity, runtime: UnitRuntime): void {
        const controller = this.gameState.movement.getController(unit.id);
        if (!controller) return;

        const currentDirection = controller.direction;
        if (currentDirection !== runtime.lastDirection) {
            // Direction changed - update animation
            this.animationService.setDirection(unit.id, currentDirection);
            runtime.lastDirection = currentDirection;
        }
    }

    /**
     * Update a simple move task.
     */
    private updateMoveTask(unit: Entity, runtime: UnitRuntime): void {
        const controller = this.gameState.movement.getController(unit.id);
        if (!controller) {
            // No movement controller - cancel task
            runtime.moveTask = null;
            runtime.state = SettlerState.IDLE;
            this.setIdleAnimation(unit);
            return;
        }

        // Check if movement is complete
        if (controller.state === 'idle') {
            // Movement finished
            runtime.moveTask = null;
            runtime.state = SettlerState.IDLE;
            this.setIdleAnimation(unit);
            runtime.idleState.idleTime = 0;
            log.debug(`Unit ${unit.id} completed move task`);
        }
        // Otherwise keep waiting for movement to complete
    }

    /**
     * Update idle state for non-configured units (random turning, etc.)
     */
    private updateIdleUnit(unit: Entity, runtime: UnitRuntime, dt: number): void {
        const controller = this.gameState.movement.getController(unit.id);

        // If unit is moving (e.g., pushed), play walk animation
        if (controller?.state === 'moving') {
            // Ensure walk animation is playing
            const animState = this.animationService.getState(unit.id);
            if (!animState?.playing || animState.sequenceKey !== ANIMATION_SEQUENCES.WALK) {
                this.startWalkAnimation(unit, controller.direction);
            }
            runtime.idleState.idleTime = 0;
            return;
        }

        // Reset animation if still playing (e.g., walk animation from combat pursuit)
        const animState = this.animationService.getState(unit.id);
        if (animState?.playing) {
            this.setIdleAnimation(unit);
        }

        // Unit is idle - handle idle turning
        this.updateIdleTurning(unit, runtime, dt);
    }

    /**
     * Handle random idle turning for standing units.
     */
    private updateIdleTurning(unit: Entity, runtime: UnitRuntime, dt: number): void {
        const idleState = runtime.idleState;
        idleState.idleTime += dt;

        if (idleState.idleTime >= idleState.nextIdleTurnTime) {
            // Animation state may be missing during cleanup
            const animState = this.animationService.getState(unit.id);
            if (!animState) return;
            const newDirection = this.getAdjacentDirection(animState.direction);
            this.animationService.setDirection(unit.id, newDirection);

            // Reset timer
            idleState.idleTime = 0;
            idleState.nextIdleTurnTime = 2 + this.gameState.rng.next() * 4;
        }
    }

    /**
     * Get an adjacent direction for idle turning.
     */
    private getAdjacentDirection(currentDirection: number): number {
        const offset = this.gameState.rng.nextBool() ? 1 : -1;
        return (((currentDirection + offset) % NUM_DIRECTIONS) + NUM_DIRECTIONS) % NUM_DIRECTIONS;
    }

    // ─────────────────────────────────────────────────────────────
    // YAML-based settler job handling (existing logic)
    // ─────────────────────────────────────────────────────────────

    private updateSettler(settler: Entity, config: SettlerConfig, runtime: UnitRuntime, dt: number): void {
        switch (runtime.state) {
        case SettlerState.IDLE:
            this.handleIdle(settler, config, runtime);
            // Also handle idle turning when not working (handleIdle may change state to WORKING)
            // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- handleIdle mutates runtime.state
            if (runtime.state === SettlerState.IDLE) {
                this.updateIdleTurning(settler, runtime, dt);
            }
            break;

        case SettlerState.WORKING:
            this.handleWorking(settler, config, runtime, dt);
            break;

        case SettlerState.INTERRUPTED:
            // Return to idle after interruption
            runtime.state = SettlerState.IDLE;
            runtime.job = null;
            break;
        }
    }

    /** Find an entity target via an EntityWorkHandler, catching errors at the system boundary. */
    private findEntityTarget(
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

    private buildWorkerJobData(
        target: { entityId: number; x: number; y: number } | null,
        homeBuilding: Entity | null
    ): WorkerJobData {
        return {
            targetId: target?.entityId ?? null,
            targetPos: target ? { x: target.x, y: target.y } : null,
            homeId: homeBuilding?.id ?? null,
            carryingGood: null,
        };
    }

    private handleIdle(settler: Entity, config: SettlerConfig, runtime: UnitRuntime): void {
        const entityHandler = this.entityHandlers.get(config.search);
        const positionHandler = this.positionHandlers.get(config.search);

        if (!entityHandler && !positionHandler) {
            this.missingHandlerLogger.warn(
                `No work handler registered for search type: ${config.search}. ` +
                    `Settler ${settler.id} (${UnitType[settler.subType]}) will stay idle until feature is implemented.`
            );
            return;
        }

        const homeBuilding = findNearestWorkplace(this.gameState, settler);

        // Entity handlers search for a target; position handlers start self-searching jobs directly
        const entityTarget = entityHandler ? this.findEntityTarget(entityHandler, settler) : null;
        if (entityTarget === undefined) return; // error already logged

        const selected = this.selectJob(settler, config, entityTarget);
        if (!selected) return;

        if (homeBuilding && isOutputFull(homeBuilding, selected.tasks, this.inventoryManager)) {
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
            data: this.buildWorkerJobData(entityTarget, homeBuilding),
        };

        log.debug(
            `Settler ${settler.id} starting job ${selected.jobId}, target ${entityTarget?.entityId ?? 'none'}, home ${homeBuilding?.id ?? 'none'}`
        );
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

    /**
     * Check if a job's first task requires an entity target from findTarget.
     */
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
            this.setIdleAnimation(settler);
            return;
        }

        // If not moving, start moving home
        if (controller.state === 'idle') {
            this.gameState.movement.moveUnit(settler.id, homeBuilding.x, homeBuilding.y);
            this.startWalkAnimation(settler, controller.direction);
        }
    }

    private handleWorking(settler: Entity, config: SettlerConfig, runtime: UnitRuntime, dt: number): void {
        // Job MUST exist when state is WORKING — crash if invariant violated
        const job = runtime.job!;

        const tasks = this.jobDefinitions.get(job.jobId);
        if (!tasks || job.taskIndex >= tasks.length) {
            // Job complete
            this.completeJob(settler, runtime);
            return;
        }

        const task = tasks[job.taskIndex]!;

        // Apply animation for current task (on first tick of task)
        if (job.progress === 0) {
            this.applyTaskAnimation(settler, task);
        }

        const entityHandler = this.entityHandlers.get(config.search);
        const positionHandler = this.positionHandlers.get(config.search);
        const result = executeTask(settler, job, task, dt, this.taskContext, entityHandler, positionHandler);

        switch (result) {
        case TaskResult.DONE:
            job.taskIndex++;
            job.progress = 0;
            // Sync direction immediately (FACE_POS sets it mid-tick, avoid one-frame lag)
            this.updateDirectionTracking(settler, runtime);
            // Apply animation for next task if there is one
            if (job.taskIndex < tasks.length) {
                this.applyTaskAnimation(settler, tasks[job.taskIndex]!);
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

    private completeJob(settler: Entity, runtime: UnitRuntime): void {
        const homeId = runtime.job!.data.homeId;
        log.debug(`Settler ${settler.id} completed job ${runtime.job!.jobId}`);
        runtime.state = SettlerState.IDLE;
        runtime.job = null;
        this.setIdleAnimation(settler);
        runtime.idleState.idleTime = 0;

        // Hide settler if they finished at their home building
        if (homeId) {
            const home = this.gameState.getEntity(homeId);
            if (home && hexDistance(settler.x, settler.y, home.x, home.y) <= 1) {
                settler.hidden = true;
            }
        }
    }

    private interruptJob(settler: Entity, config: SettlerConfig, runtime: UnitRuntime): void {
        const entityHandler = this.entityHandlers.get(config.search);
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

        // Note: Carrier reservations are handled by LogisticsDispatcher via InventoryReservationManager.
        // LogisticsDispatcher listens for carrier:removed and carrier:pickupFailed events to release reservations.

        // Clear carrying state if unit was carrying material
        if (settler.carrying) {
            clearCarrying(settler);
        }

        log.debug(`Settler ${settler.id} interrupted job ${job.jobId}`);
        runtime.state = SettlerState.INTERRUPTED;
        this.setIdleAnimation(settler);
    }

    // ─────────────────────────────────────────────────────────────
    // Animation helpers
    // ─────────────────────────────────────────────────────────────

    /**
     * Apply animation for the current task. Resolves semantic animation type
     * to a concrete sequence key via AnimationResolver, then applies it.
     */
    private applyTaskAnimation(settler: Entity, task: TaskNode): void {
        const intent = resolveTaskAnimation(task.anim, settler);
        this.animationService.applyIntent(settler.id, intent);
    }

    /**
     * Start walk animation for a unit (used for move tasks and external movement).
     */
    private startWalkAnimation(unit: Entity, direction: number): void {
        const intent = resolveTaskAnimation('walk', unit);
        this.animationService.applyIntent(unit.id, intent);
        this.animationService.setDirection(unit.id, direction);
    }

    /**
     * Set idle animation (stopped, default pose).
     */
    private setIdleAnimation(settler: Entity): void {
        this.animationService.play(settler.id, ANIMATION_SEQUENCES.DEFAULT, { loop: false });
        this.animationService.stop(settler.id);
    }
}
