/* eslint-disable max-lines */
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
import { EntityType, UnitType, Entity, getCarrierState } from '../../entity';
import { EMaterialType } from '../../economy';
import { LogHandler } from '@/utilities/log-handler';
import { ThrottledLogger } from '@/utilities/throttled-logger';
import { hexDistance } from '../hex-directions';
import { ANIMATION_SEQUENCES, carrySequenceKey, workSequenceKey } from '../../animation';
import type { AnimationService } from '../../animation/index';
import {
    TaskType,
    TaskResult,
    SearchType,
    SettlerState,
    type SettlerConfig,
    type TaskNode,
    type CarrierJobState,
    type JobState,
    type WorkHandler,
    type AnimationType,
} from './types';
import { loadSettlerConfigs, loadJobDefinitions, type SettlerConfigs, type JobDefinitions } from './loader';
import type { EventBus } from '../../event-bus';
import type { BuildingInventoryManager } from '../../features/inventory';

const log = new LogHandler('SettlerTaskSystem');

/** Number of sprite directions (matches hex grid) */
const NUM_DIRECTIONS = 6;

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
}

/**
 * Manages all unit behaviors through task execution.
 */
export class SettlerTaskSystem implements TickSystem {
    private gameState: GameState;
    private animationService: AnimationService;
    private inventoryManager: BuildingInventoryManager;
    private settlerConfigs: SettlerConfigs;
    private jobDefinitions: JobDefinitions;
    private workHandlers = new Map<SearchType, WorkHandler>();
    private runtimes = new Map<number, UnitRuntime>();
    private eventBus!: EventBus; // MUST be set via setEventBus
    /** Throttled logger for handler errors (prevents flooding from broken domain systems) */
    private handlerErrorLogger = new ThrottledLogger(log, 2000);
    /** Throttled logger for missing handler warnings (prevents spam when feature not yet implemented) */
    private missingHandlerLogger = new ThrottledLogger(log, 5000);

    constructor(config: SettlerTaskSystemConfig) {
        this.gameState = config.gameState;
        this.animationService = config.animationService;
        this.inventoryManager = config.inventoryManager;
        this.settlerConfigs = loadSettlerConfigs();
        this.jobDefinitions = loadJobDefinitions();

        // Register built-in WORKPLACE handler for building workers
        this.registerWorkHandler(SearchType.WORKPLACE, this.createWorkplaceHandler());

        // Register GOOD handler for carriers (they get jobs assigned externally by LogisticsDispatcher)
        this.registerWorkHandler(SearchType.GOOD, this.createCarrierHandler());

        log.debug(`Loaded ${this.settlerConfigs.size} settler configs, ${this.jobDefinitions.size} jobs`);
    }

    /**
     * Set event bus for emitting carrier events.
     */
    setEventBus(eventBus: EventBus): void {
        this.eventBus = eventBus;
    }

    /**
     * Create a handler for WORKPLACE search type.
     * Building workers find their workplace, wait for materials, then produce.
     */
    private createWorkplaceHandler(): WorkHandler {
        return {
            // Worker waits at building for materials instead of failing
            shouldWaitForWork: true,

            findTarget: (_x: number, _y: number, settlerId?: number) => {
                if (settlerId === undefined) return null;
                // Settler MUST exist if we're searching for its target
                const settler = this.gameState.getEntityOrThrow(settlerId, 'settler for findTarget');

                const workplace = this.gameState.findNearestWorkplace(settler);
                if (!workplace) return null;

                return { entityId: workplace.id, x: workplace.x, y: workplace.y };
            },

            canWork: (targetId: number) => {
                // Can work when building has inputs and output space
                return (
                    this.inventoryManager.canStartProduction(targetId) && this.inventoryManager.canStoreOutput(targetId)
                );
            },

            onWorkStart: (targetId: number) => {
                // Consume inputs when starting work
                this.inventoryManager.consumeProductionInputs(targetId);
            },

            onWorkTick: (_targetId: number, progress: number) => {
                // Complete when progress reaches 1.0
                return progress >= 1.0;
            },

            onWorkComplete: (targetId: number) => {
                // Produce outputs when work completes
                this.inventoryManager.produceOutput(targetId);
            },
        };
    }

    /**
     * Create a handler for GOOD search type (carriers).
     *
     * Carriers don't find work themselves - they get jobs assigned externally
     * by LogisticsDispatcher via assignCarrierJob(). This handler exists to
     * prevent "no handler registered" errors when carriers are idle.
     *
     * Returns null from findTarget() which makes the carrier stay idle until
     * a job is assigned externally.
     */
    private createCarrierHandler(): WorkHandler {
        return {
            // Carrier waits for work to be assigned externally
            shouldWaitForWork: true,

            findTarget: () => {
                // Carriers don't self-search - jobs are assigned by LogisticsDispatcher
                return null;
            },

            canWork: () => {
                // Never called since findTarget returns null
                return false;
            },

            onWorkTick: () => {
                // Never called since findTarget returns null
                return false;
            },
        };
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

    /**
     * Check if a unit has an active move task.
     */
    hasMoveTask(entityId: number): boolean {
        const runtime = this.runtimes.get(entityId);
        return runtime?.moveTask !== null;
    }

    /**
     * Register a work handler for a search type.
     * Domain systems call this to plug into the task system.
     * Throws if a handler is already registered for this type.
     */
    registerWorkHandler(searchType: SearchType, handler: WorkHandler): void {
        if (this.workHandlers.has(searchType)) {
            throw new Error(
                `Work handler already registered for ${searchType}. ` + `Each SearchType must have exactly one handler.`
            );
        }
        this.workHandlers.set(searchType, handler);
        log.debug(`Registered work handler for ${searchType}`);
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
     * Assign a carrier transport job.
     * Called by CarrierSystem when a delivery job is assigned.
     *
     * @param entityId Entity ID of the carrier
     * @param sourceBuildingId Building to pickup from
     * @param destBuildingId Building to deliver to
     * @param material Material type to transport
     * @param amount Amount to transport
     * @param homeId Carrier's home building (for return after delivery)
     * @returns true if job was assigned successfully
     */
    assignCarrierJob(
        entityId: number,
        sourceBuildingId: number,
        destBuildingId: number,
        material: EMaterialType,
        amount: number,
        homeId: number
    ): boolean {
        // Entity MUST exist and be a carrier - caller should have validated
        const entity = this.gameState.getEntityOrThrow(entityId, 'carrier for job assignment');
        if (entity.type !== EntityType.Unit || entity.subType !== UnitType.Carrier) {
            throw new Error(`Entity ${entityId} is not a carrier (type=${entity.type}, subType=${entity.subType})`);
        }

        // Get or create runtime
        const runtime = this.getRuntime(entityId);

        // Create carrier job state (composed structure)
        const carrierJob: CarrierJobState = {
            type: 'carrier',
            jobId: 'carrier.transport',
            taskIndex: 0,
            progress: 0,
            data: {
                sourceBuildingId,
                destBuildingId,
                material,
                amount,
                homeId,
                carryingGood: null,
            },
        };

        // Set runtime state
        runtime.state = SettlerState.WORKING;
        runtime.job = carrierJob;
        runtime.moveTask = null; // Clear any existing move task

        // Buildings MUST exist - caller should have validated
        const sourceBuilding = this.gameState.getEntityOrThrow(sourceBuildingId, 'source building for carrier job');
        this.gameState.getEntityOrThrow(destBuildingId, 'destination building for carrier job');

        // Note: Inventory reservation is handled by LogisticsDispatcher via InventoryReservationManager.
        // We don't reserve here - the logistics layer already reserved when creating the job.

        const moveSuccess = this.gameState.movement.moveUnit(entityId, sourceBuilding.x, sourceBuilding.y);
        if (!moveSuccess) {
            log.warn(`Cannot path to source building ${sourceBuildingId}`);
            runtime.state = SettlerState.IDLE;
            runtime.job = null;
            return false;
        }

        // Start walk animation (controller MUST exist after successful moveUnit)
        const controller = this.gameState.movement.getController(entityId)!;
        this.startWalkAnimation(entity, controller.direction);

        log.debug(
            `Carrier ${entityId} assigned transport job: ${amount} of ${material} from ${sourceBuildingId} to ${destBuildingId}`
        );
        return true;
    }

    // ─────────────────────────────────────────────────────────────
    // Tick processing
    // ─────────────────────────────────────────────────────────────

    /**
     * Called by GameLoop when an entity is removed.
     * Properly interrupts work in progress so domain systems can clean up.
     */
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
            const handler = this.findHandlerForJob(runtime.job.jobId);
            if (handler) {
                try {
                    handler.onWorkInterrupt?.(runtime.job.data.targetId);
                } catch (e) {
                    const err = e instanceof Error ? e : new Error(String(e));
                    this.handlerErrorLogger.error(`onWorkInterrupt failed for entity ${entityId}`, err);
                }
            }
        }

        this.runtimes.delete(entityId);
    }

    /** Reverse-lookup: find the work handler for a given jobId like "woodcutter.work" */
    private findHandlerForJob(jobId: string): WorkHandler | undefined {
        for (const [unitType, config] of this.settlerConfigs) {
            const prefix = UnitType[unitType].toLowerCase();
            for (const jobName of config.jobs) {
                if (`${prefix}.${jobName}` === jobId) {
                    return this.workHandlers.get(config.search);
                }
            }
        }
        return undefined;
    }

    /** TickSystem interface */
    tick(dt: number): void {
        // Process ALL units (not just those with YAML configs)
        const allUnits = this.gameState.entities.filter(e => e.type === EntityType.Unit);

        for (const unit of allUnits) {
            this.updateUnit(unit, dt);
        }

        // Safety net: clean up runtimes for entities removed without onEntityRemoved signal.
        // Uses onEntityRemoved so domain handlers get proper cleanup notification.
        for (const id of this.runtimes.keys()) {
            if (!this.gameState.getEntity(id)) {
                this.onEntityRemoved(id);
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
            // Also handle idle turning when not working
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

    private handleIdle(settler: Entity, config: SettlerConfig, runtime: UnitRuntime): void {
        const handler = this.workHandlers.get(config.search);
        if (!handler) {
            // Log warning instead of throwing - missing handlers are missing features, not crashes
            this.missingHandlerLogger.warn(
                `No work handler registered for search type: ${config.search}. ` +
                    `Settler ${settler.id} (${UnitType[settler.subType]}) will stay idle until feature is implemented.`
            );
            return;
        }

        const homeBuilding = this.gameState.findNearestWorkplace(settler);
        const jobId = `${UnitType[settler.subType].toLowerCase()}.${config.jobs[0]}`;
        const tasks = this.jobDefinitions.get(jobId);
        if (!tasks || tasks.length === 0) {
            throw new Error(`No tasks found for job: ${jobId}. Check YAML job definitions.`);
        }

        // Check if home building can store output before starting work
        if (homeBuilding && this.isOutputFull(homeBuilding, tasks)) {
            this.returnHomeAndWait(settler, homeBuilding);
            return;
        }

        // Search for work (handler call is a system boundary)
        let target: ReturnType<WorkHandler['findTarget']>;
        try {
            target = handler.findTarget(settler.x, settler.y, settler.id);
        } catch (e) {
            const err = e instanceof Error ? e : new Error(String(e));
            this.handlerErrorLogger.error(`findTarget failed for settler ${settler.id}`, err);
            return;
        }
        if (!target) return;

        runtime.state = SettlerState.WORKING;
        runtime.job = {
            type: 'worker',
            jobId,
            taskIndex: 0,
            progress: 0,
            data: {
                targetId: target.entityId,
                targetPos: { x: target.x, y: target.y },
                homeId: homeBuilding?.id ?? null,
                carryingGood: null,
            },
        };

        log.debug(
            `Settler ${settler.id} starting job ${jobId}, target ${target.entityId}, home ${homeBuilding?.id ?? 'none'}`
        );
    }

    /**
     * Check if the home building's output is full for the job's pickup material.
     */
    private isOutputFull(homeBuilding: Entity, tasks: TaskNode[]): boolean {
        const pickupTask = tasks.find(t => t.task === TaskType.PICKUP && t.good !== undefined);
        if (!pickupTask || pickupTask.good === undefined) return false;

        return (
            !this.inventoryManager.canAcceptInput(homeBuilding.id, pickupTask.good, 1) &&
            this.inventoryManager.getInputSpace(homeBuilding.id, pickupTask.good) <= 0 &&
            !this.canStoreInOutput(homeBuilding.id, pickupTask.good)
        );
    }

    /**
     * Check if building can store a material in its output slot.
     */
    private canStoreInOutput(buildingId: number, materialType: EMaterialType): boolean {
        const inventory = this.inventoryManager.getInventory(buildingId);
        if (!inventory) return false;

        const slot = inventory.outputSlots.find(s => s.materialType === materialType);
        if (!slot) return false;

        return slot.currentAmount < slot.maxCapacity;
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

        // If already at home, just stay idle
        if (dist <= 1) {
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

        const task = tasks[job.taskIndex];

        // Apply animation for current task (on first tick of task)
        if (job.progress === 0) {
            this.applyTaskAnimation(settler, task.anim);
        }

        const result = this.executeTask(settler, config, runtime, task, dt);

        switch (result) {
        case TaskResult.DONE:
            job.taskIndex++;
            job.progress = 0;
            // Apply animation for next task if there is one
            if (job.taskIndex < tasks.length) {
                this.applyTaskAnimation(settler, tasks[job.taskIndex].anim);
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

    private executeTask(
        settler: Entity,
        config: SettlerConfig,
        runtime: UnitRuntime,
        task: TaskNode,
        dt: number
    ): TaskResult {
        const job = runtime.job!;
        const handler = this.workHandlers.get(config.search);

        switch (task.task) {
        case TaskType.GO_TO_TARGET:
            return this.executeGoToTarget(settler, job);

        case TaskType.WORK_ON_ENTITY:
            return this.executeWorkOnEntity(settler, job, task, dt, handler);

        case TaskType.PICKUP:
            return this.executePickup(settler, job, task);

        case TaskType.GO_HOME:
            return this.executeGoHome(settler, job);

        case TaskType.GO_TO_SOURCE:
            return this.executeGoToSource(settler, job);

        case TaskType.GO_TO_DEST:
            return this.executeGoToDest(settler, job);

        case TaskType.STAY:
            // Worker stays indefinitely - animation set by task.anim in YAML
            return TaskResult.CONTINUE;

        case TaskType.DROPOFF:
            return this.executeDropoff(settler, job);

        case TaskType.WORK:
            return this.executeWork(settler, job, task, dt);

        case TaskType.SEARCH_POS:
            return this.executeSearchPos(settler, job, handler);

        case TaskType.GO_TO_POS:
            return this.executeGoToPos(settler, job);

        case TaskType.WAIT:
            return this.executeWait(job, task, dt);

        default:
            throw new Error(
                `Unhandled task type: ${task.task} in job ${job.jobId} (settler ${settler.id}). ` +
                        `Add implementation in executeTask() or remove from jobs.yaml.`
            );
        }
    }

    /**
     * Helper to move settler adjacent to a target position.
     */
    private moveToPosition(settler: Entity, targetX: number, targetY: number): TaskResult {
        const controller = this.gameState.movement.getController(settler.id);
        if (!controller) return TaskResult.FAILED;

        const dist = hexDistance(settler.x, settler.y, targetX, targetY);

        if (dist <= 1 && controller.state === 'idle') {
            return TaskResult.DONE;
        }

        if (controller.state === 'idle') {
            const moved = this.gameState.movement.moveUnit(settler.id, targetX, targetY);
            if (!moved) return TaskResult.FAILED;
        }

        return TaskResult.CONTINUE;
    }

    private executeGoToTarget(settler: Entity, job: JobState): TaskResult {
        if (job.type !== 'worker') return TaskResult.FAILED;
        if (!job.data.targetPos) return TaskResult.FAILED;
        return this.moveToPosition(settler, job.data.targetPos.x, job.data.targetPos.y);
    }

    // eslint-disable-next-line complexity -- handler boundary requires per-call guards
    private executeWorkOnEntity(
        settler: Entity,
        job: JobState,
        task: TaskNode,
        dt: number,
        handler?: WorkHandler
    ): TaskResult {
        if (job.type !== 'worker') return TaskResult.FAILED;
        if (!job.data.targetId || !handler) return TaskResult.FAILED;

        const targetId = job.data.targetId;

        // Check target still valid / has materials.
        // Handler calls are a system boundary — guard against domain errors.
        try {
            if (!handler.canWork(targetId)) {
                if (handler.shouldWaitForWork) {
                    return TaskResult.CONTINUE;
                }
                return TaskResult.FAILED;
            }
        } catch (e) {
            const err = e instanceof Error ? e : new Error(String(e));
            this.handlerErrorLogger.error(`canWork failed for target ${targetId}`, err);
            return TaskResult.FAILED;
        }

        // Start work on first tick (or when materials become available)
        if (!job.workStarted) {
            try {
                handler.onWorkStart?.(targetId);
            } catch (e) {
                const err = e instanceof Error ? e : new Error(String(e));
                this.handlerErrorLogger.error(`onWorkStart failed for target ${targetId}`, err);
                return TaskResult.FAILED;
            }
            job.workStarted = true;
            job.progress = 0;
        }

        // Remember previous progress for animation phase transition
        const prevProgress = job.progress;

        // Update progress
        const duration = task.duration ?? 1.0;
        job.progress += dt / duration;

        // Switch to pickup animation when log is ready (at 90% progress)
        const PICKUP_THRESHOLD = 0.9;
        if (prevProgress < PICKUP_THRESHOLD && job.progress >= PICKUP_THRESHOLD) {
            this.applyTaskAnimation(settler, 'pickup');
        }

        // Update domain system
        let complete: boolean;
        try {
            complete = handler.onWorkTick(targetId, job.progress);
        } catch (e) {
            const err = e instanceof Error ? e : new Error(String(e));
            this.handlerErrorLogger.error(`onWorkTick failed for target ${targetId}`, err);
            return TaskResult.FAILED;
        }

        if (complete || job.progress >= 1) {
            try {
                handler.onWorkComplete?.(targetId, settler.x, settler.y);
            } catch (e) {
                const err = e instanceof Error ? e : new Error(String(e));
                this.handlerErrorLogger.error(`onWorkComplete failed for target ${targetId}`, err);
                // Work is done regardless — don't leave settler stuck
            }
            return TaskResult.DONE;
        }

        return TaskResult.CONTINUE;
    }

    private executePickup(settler: Entity, job: JobState, task: TaskNode): TaskResult {
        // Use discriminated union to determine job type
        if (job.type === 'carrier') {
            return this.executeCarrierPickup(settler, job);
        }

        // Regular settler pickup (e.g., woodcutter picking up LOG)
        job.data.carryingGood = task.good ?? null;
        return TaskResult.DONE;
    }

    /**
     * Execute carrier pickup - withdraw from source building inventory.
     * Inventory was reserved by LogisticsDispatcher via InventoryReservationManager.
     * The reserved withdrawal releases the slot reservation and withdraws atomically.
     */
    private executeCarrierPickup(settler: Entity, job: CarrierJobState): TaskResult {
        const entity = this.gameState.getEntityOrThrow(settler.id, 'carrier');
        const { sourceBuildingId, material, amount: requestedAmount } = job.data;

        // Withdraw from reserved amount (atomic: release slot reservation + withdraw)
        const withdrawn = this.inventoryManager.withdrawReservedOutput(sourceBuildingId, material, requestedAmount);

        if (withdrawn === 0) {
            // Material no longer available (reservation may have been released due to building destruction)
            log.warn(`Carrier ${settler.id}: material ${material} not available at building ${sourceBuildingId}`);

            // Emit pickup failed event so logistics can reassign
            this.eventBus!.emit('carrier:pickupFailed', {
                entityId: settler.id,
                material,
                fromBuilding: sourceBuildingId,
                requestedAmount,
            });

            return TaskResult.FAILED;
        }

        // Update carrier entity state
        const carrierState = getCarrierState(entity);
        carrierState.carryingMaterial = material;
        carrierState.carryingAmount = withdrawn;

        // Update job state
        job.data.carryingGood = material;
        job.data.amount = withdrawn;

        // Log if partial pickup occurred
        if (withdrawn < requestedAmount) {
            log.debug(`Carrier ${settler.id} picked up ${withdrawn}/${requestedAmount} of ${material} (partial)`);
        } else {
            log.debug(`Carrier ${settler.id} picked up ${withdrawn} of ${material} from building ${sourceBuildingId}`);
        }

        // Emit pickup complete event (includes actual amount for logistics tracking)
        this.eventBus!.emit('carrier:pickupComplete', {
            entityId: settler.id,
            material,
            amount: withdrawn,
            fromBuilding: sourceBuildingId,
        });

        return TaskResult.DONE;
    }

    private executeGoHome(settler: Entity, job: JobState): TaskResult {
        const homeId = job.data.homeId;
        if (!homeId) return TaskResult.FAILED;
        const building = this.gameState.getEntityOrThrow(homeId, 'home building');
        return this.moveToPosition(settler, building.x, building.y);
    }

    private executeGoToSource(settler: Entity, job: JobState): TaskResult {
        if (job.type !== 'carrier') return TaskResult.FAILED;
        const building = this.gameState.getEntityOrThrow(job.data.sourceBuildingId, 'source building');
        return this.moveToPosition(settler, building.x, building.y);
    }

    private executeGoToDest(settler: Entity, job: JobState): TaskResult {
        if (job.type !== 'carrier') return TaskResult.FAILED;
        const building = this.gameState.getEntityOrThrow(job.data.destBuildingId, 'destination building');
        return this.moveToPosition(settler, building.x, building.y);
    }

    private executeDropoff(settler: Entity, job: JobState): TaskResult {
        // Use discriminated union to determine job type
        if (job.type === 'carrier') {
            return this.executeCarrierDropoff(settler, job);
        }

        // Regular settler dropoff (e.g., woodcutter dropping off LOG at home)
        if (job.data.carryingGood == null) {
            return TaskResult.DONE;
        }

        if (!job.data.homeId) {
            throw new Error(
                `Settler ${settler.id} (${UnitType[settler.subType]}) has no home building for dropoff. Job started incorrectly.`
            );
        }

        const homeId = job.data.homeId;
        const carryingGood = job.data.carryingGood;

        // Deposit to building inventory (optimistic - assumes inventory exists)
        const deposited = this.inventoryManager.depositOutput(homeId, carryingGood, 1);
        if (deposited > 0) {
            log.debug(`Settler ${settler.id} deposited ${carryingGood} to building ${homeId}`);
        } else {
            log.warn(`Building ${homeId} output full, material lost`);
        }

        job.data.carryingGood = null;
        return TaskResult.DONE;
    }

    /**
     * Execute carrier dropoff - deposit to destination building inventory.
     * Emits the critical 'carrier:deliveryComplete' event.
     */
    private executeCarrierDropoff(settler: Entity, job: CarrierJobState): TaskResult {
        const entity = this.gameState.getEntityOrThrow(settler.id, 'carrier');
        const carrierState = getCarrierState(entity);
        const { destBuildingId, material } = job.data;

        const amount = carrierState.carryingAmount;

        // Deposit to destination building
        const deposited = this.inventoryManager.depositInput(destBuildingId, material, amount);

        const overflow = amount - deposited;
        if (overflow > 0) {
            log.warn(`Carrier ${settler.id}: ${overflow} of ${material} overflow at building ${destBuildingId}`);
        }

        // Clear carrier entity state
        carrierState.carryingMaterial = null;
        carrierState.carryingAmount = 0;

        // Clear job state
        job.data.carryingGood = null;

        log.debug(`Carrier ${settler.id} delivered ${deposited} of ${material} to building ${destBuildingId}`);

        // CRITICAL: Emit delivery complete event (used by LogisticsDispatcher)
        this.eventBus!.emit('carrier:deliveryComplete', {
            entityId: settler.id,
            material,
            amount: deposited,
            toBuilding: destBuildingId,
            overflow,
        });

        return TaskResult.DONE;
    }

    private executeWork(_settler: Entity, job: JobState, task: TaskNode, dt: number): TaskResult {
        // Animation is applied by handleWorking at task start

        const duration = task.duration ?? 1.0;
        job.progress += dt / duration;

        if (job.progress >= 1) {
            return TaskResult.DONE;
        }

        return TaskResult.CONTINUE;
    }

    /**
     * Search for a position using the work handler's findTarget.
     * Used by foresters/farmers to find where to plant.
     * Stores result in job.data.targetPos for subsequent GO_TO_POS task.
     */
    private executeSearchPos(settler: Entity, job: JobState, handler?: WorkHandler): TaskResult {
        if (job.type !== 'worker') return TaskResult.FAILED;
        if (!handler) {
            throw new Error(
                `Settler ${settler.id} (${UnitType[settler.subType]}): SEARCH_POS task requires a work handler`
            );
        }

        // Use findTarget to search for a valid position (handler is a system boundary)
        let target: ReturnType<WorkHandler['findTarget']>;
        try {
            target = handler.findTarget(settler.x, settler.y, settler.id);
        } catch (e) {
            const err = e instanceof Error ? e : new Error(String(e));
            this.handlerErrorLogger.error(`findTarget (SEARCH_POS) failed for settler ${settler.id}`, err);
            return TaskResult.FAILED;
        }
        if (!target) {
            if (handler.shouldWaitForWork) {
                return TaskResult.CONTINUE;
            }
            log.debug(`Settler ${settler.id}: no position found for SEARCH_POS`);
            return TaskResult.FAILED;
        }

        // Store position for GO_TO_POS task
        job.data.targetPos = { x: target.x, y: target.y };
        // Also store target entity if provided (e.g., for planting near a building)
        if (target.entityId) {
            job.data.targetId = target.entityId;
        }

        log.debug(`Settler ${settler.id}: found position (${target.x}, ${target.y}) for planting`);
        return TaskResult.DONE;
    }

    /**
     * Move to the position stored in job.data.targetPos.
     * Used after SEARCH_POS to move to the found position.
     */
    private executeGoToPos(settler: Entity, job: JobState): TaskResult {
        if (job.type !== 'worker') return TaskResult.FAILED;
        if (!job.data.targetPos) {
            throw new Error(
                `Settler ${settler.id} (${UnitType[settler.subType]}): GO_TO_POS requires targetPos from a preceding SEARCH_POS task. Check job YAML.`
            );
        }
        return this.moveToPosition(settler, job.data.targetPos.x, job.data.targetPos.y);
    }

    /**
     * Wait for a specified duration.
     * Uses task.duration to determine wait time.
     */
    private executeWait(job: JobState, task: TaskNode, dt: number): TaskResult {
        const duration = task.duration ?? 1.0;
        job.progress += dt / duration;

        if (job.progress >= 1) {
            return TaskResult.DONE;
        }

        return TaskResult.CONTINUE;
    }

    private completeJob(settler: Entity, runtime: UnitRuntime): void {
        log.debug(`Settler ${settler.id} completed job ${runtime.job!.jobId}`);
        runtime.state = SettlerState.IDLE;
        runtime.job = null;
        this.setIdleAnimation(settler);
        runtime.idleState.idleTime = 0;
    }

    private interruptJob(settler: Entity, config: SettlerConfig, runtime: UnitRuntime): void {
        const handler = this.workHandlers.get(config.search);
        // Job MUST exist — all callers verify runtime.job is non-null before calling
        const job = runtime.job!;

        // Only call onWorkInterrupt if work actually started (onWorkStart was called)
        if (handler && job.type === 'worker' && job.data.targetId && job.workStarted) {
            try {
                handler.onWorkInterrupt?.(job.data.targetId);
            } catch (e) {
                const err = e instanceof Error ? e : new Error(String(e));
                this.handlerErrorLogger.error(`onWorkInterrupt failed for target ${job.data.targetId}`, err);
            }
        }

        // Note: Carrier reservations are handled by LogisticsDispatcher via InventoryReservationManager.
        // LogisticsDispatcher listens for carrier:removed and carrier:pickupFailed events to release reservations.

        // Clear carrier state if carrier was carrying material
        const carryingGood = job.data.carryingGood;
        if (settler.carrier && carryingGood != null) {
            settler.carrier.carryingMaterial = null;
            settler.carrier.carryingAmount = 0;
        }

        log.debug(`Settler ${settler.id} interrupted job ${job.jobId}`);
        runtime.state = SettlerState.INTERRUPTED;
        this.setIdleAnimation(settler);
    }

    // ─────────────────────────────────────────────────────────────
    // Animation helpers (uses AnimationService)
    // ─────────────────────────────────────────────────────────────

    /**
     * Start walk animation for a unit.
     */
    private startWalkAnimation(unit: Entity, direction: number): void {
        const sequenceKey = this.getWalkSequenceKey(unit);
        this.animationService.play(unit.id, sequenceKey, { loop: true, direction });
    }

    /**
     * Determine the correct walk sequence key for a unit.
     * Carriers carrying a material use a material-specific carry sequence.
     */
    private getWalkSequenceKey(entity: Entity): string {
        const carriedMaterial = entity.carrier?.carryingMaterial;
        if (entity.subType === UnitType.Carrier && carriedMaterial != null) {
            return carrySequenceKey(carriedMaterial);
        }
        return ANIMATION_SEQUENCES.WALK;
    }

    /**
     * Apply animation for a task action.
     * Maps semantic animation types to sequence keys.
     */
    private applyTaskAnimation(settler: Entity, anim: AnimationType, direction?: number): void {
        const sequenceKey = this.resolveSequenceKey(settler, anim);
        const loop = this.shouldLoop(anim);

        this.animationService.play(settler.id, sequenceKey, { loop, direction });
    }

    /**
     * Set idle animation (stopped, default pose).
     */
    private setIdleAnimation(settler: Entity): void {
        this.animationService.play(settler.id, ANIMATION_SEQUENCES.DEFAULT, { loop: false });
        this.animationService.stop(settler.id);
    }

    /**
     * Map semantic animation types to legacy sequence keys.
     * SpriteRenderManager registers animations with these keys.
     */
    private resolveSequenceKey(settler: Entity, anim: AnimationType): string {
        switch (anim) {
        case 'walk':
            return ANIMATION_SEQUENCES.WALK;

        case 'carry': {
            // Material-specific carry animation (carrier MUST have material for carry anim)
            const material = settler.carrier!.carryingMaterial!;
            return carrySequenceKey(material);
        }

        case 'chop':
        case 'harvest':
        case 'mine':
        case 'hammer':
        case 'dig':
        case 'plant':
        case 'work':
            // All work actions use work.0 sequence
            return workSequenceKey(0);

        case 'pickup':
        case 'dropoff':
            // Pickup/dropoff use work.1 (bending down animation)
            return workSequenceKey(1);

        case 'idle':
        default:
            return ANIMATION_SEQUENCES.DEFAULT;
        }
    }

    /**
     * Determine if animation should loop.
     */
    private shouldLoop(anim: AnimationType): boolean {
        switch (anim) {
        // Movement animations loop
        case 'walk':
        case 'carry':
            return true;

            // Work animations loop
        case 'chop':
        case 'harvest':
        case 'mine':
        case 'hammer':
        case 'dig':
        case 'plant':
        case 'work':
            return true;

            // One-shot animations
        case 'idle':
        case 'pickup':
        case 'dropoff':
        default:
            return false;
        }
    }
}
