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
import { EntityType, UnitType, Entity } from '../../entity';
import { EMaterialType } from '../../economy';
import { LogHandler } from '@/utilities/log-handler';
import { hexDistance } from '../hex-directions';
import {
    ANIMATION_SEQUENCES,
    carrySequenceKey,
    workSequenceKey,
} from '../../animation';
import type { AnimationService } from '../../animation/index';
import {
    TaskType,
    TaskResult,
    SearchType,
    SettlerState,
    type SettlerConfig,
    type TaskNode,
    type SettlerJobState,
    type CarrierJobState,
    type WorkHandler,
    type AnimationType,
} from './types';
import { loadSettlerConfigs, loadJobDefinitions, type SettlerConfigs, type JobDefinitions } from './loader';
import type { EventBus } from '../../event-bus';

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
    /** YAML-based job state (for workers) */
    job: SettlerJobState | null;
    /** Simple move task (for user commands) */
    moveTask: MoveTaskState | null;
    /** Last known direction (for change detection) */
    lastDirection: number;
    /** Idle animation state */
    idleState: IdleAnimationState;
}

/**
 * Manages all unit behaviors through task execution.
 */
export class SettlerTaskSystem implements TickSystem {
    private gameState: GameState;
    private animationService: AnimationService;
    private settlerConfigs: SettlerConfigs;
    private jobDefinitions: JobDefinitions;
    private workHandlers = new Map<SearchType, WorkHandler>();
    private runtimes = new Map<number, UnitRuntime>();
    private eventBus: EventBus | undefined;

    constructor(gameState: GameState, animationService: AnimationService) {
        this.gameState = gameState;
        this.animationService = animationService;
        this.settlerConfigs = loadSettlerConfigs();
        this.jobDefinitions = loadJobDefinitions();

        // Register built-in WORKPLACE handler for building workers
        this.registerWorkHandler(SearchType.WORKPLACE, this.createWorkplaceHandler());

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
                const settler = this.gameState.getEntity(settlerId);
                if (!settler) return null;

                const workplace = this.gameState.findNearestWorkplace(settler);
                if (!workplace) return null;

                return { entityId: workplace.id, x: workplace.x, y: workplace.y };
            },

            canWork: (targetId: number) => {
                // Can work when building has inputs and output space
                return this.gameState.inventoryManager.canStartProduction(targetId) &&
                       this.gameState.inventoryManager.canStoreOutput(targetId);
            },

            onWorkStart: (targetId: number) => {
                // Consume inputs when starting work
                this.gameState.inventoryManager.consumeProductionInputs(targetId);
            },

            onWorkTick: (_targetId: number, progress: number) => {
                // Complete when progress reaches 1.0
                return progress >= 1.0;
            },

            onWorkComplete: (targetId: number) => {
                // Produce outputs when work completes
                this.gameState.inventoryManager.produceOutput(targetId);
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
     */
    registerWorkHandler(searchType: SearchType, handler: WorkHandler): void {
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

        // Start walk animation
        const controller = this.gameState.movement.getController(entityId);
        const direction = controller?.direction ?? 0;
        this.startWalkAnimation(entity, direction);

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
        homeId: number,
    ): boolean {
        const entity = this.gameState.getEntity(entityId);
        if (!entity || entity.type !== EntityType.Unit || entity.subType !== UnitType.Carrier) {
            log.warn(`Cannot assign carrier job: entity ${entityId} is not a carrier`);
            return false;
        }

        // Get or create runtime
        const runtime = this.getRuntime(entityId);

        // Create carrier job state
        const carrierJob: CarrierJobState = {
            jobId: 'carrier.transport',
            taskIndex: 0,
            progress: 0,
            targetId: sourceBuildingId,
            targetPos: null,
            homeId,
            carryingGood: null,
            sourceBuildingId,
            destBuildingId,
            material,
            amount,
        };

        // Set runtime state
        runtime.state = SettlerState.WORKING;
        runtime.job = carrierJob;
        runtime.moveTask = null; // Clear any existing move task

        // Start movement to source building
        const sourceBuilding = this.gameState.getEntity(sourceBuildingId);
        if (!sourceBuilding) {
            log.warn(`Source building ${sourceBuildingId} not found`);
            return false;
        }

        const moveSuccess = this.gameState.movement.moveUnit(entityId, sourceBuilding.x, sourceBuilding.y);
        if (!moveSuccess) {
            log.warn(`Cannot path to source building ${sourceBuildingId}`);
            runtime.state = SettlerState.IDLE;
            runtime.job = null;
            return false;
        }

        // Start walk animation
        const controller = this.gameState.movement.getController(entityId);
        const direction = controller?.direction ?? 0;
        this.startWalkAnimation(entity, direction);

        log.debug(`Carrier ${entityId} assigned transport job: ${material} from ${sourceBuildingId} to ${destBuildingId}`);
        return true;
    }

    // ─────────────────────────────────────────────────────────────
    // Tick processing
    // ─────────────────────────────────────────────────────────────

    /** TickSystem interface */
    tick(dt: number): void {
        // Process ALL units (not just those with YAML configs)
        const allUnits = this.gameState.entities.filter(e => e.type === EntityType.Unit);

        for (const unit of allUnits) {
            this.updateUnit(unit, dt);
        }

        // Cleanup removed units
        for (const id of this.runtimes.keys()) {
            if (!this.gameState.getEntity(id)) {
                this.runtimes.delete(id);
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
            // Time for a random turn
            const animState = this.animationService.getState(unit.id);
            const currentDirection = animState?.direction ?? 0;
            const newDirection = this.getAdjacentDirection(currentDirection);
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
        return ((currentDirection + offset) % NUM_DIRECTIONS + NUM_DIRECTIONS) % NUM_DIRECTIONS;
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
        if (!handler) return;

        // Find home building (workplace) for this settler
        const homeBuilding = this.gameState.findNearestWorkplace(settler);

        // Get job definition to check what output the settler produces
        const jobId = `${UnitType[settler.subType].toLowerCase()}.${config.jobs[0]}`;
        const tasks = this.jobDefinitions.get(jobId);
        if (!tasks || tasks.length === 0) {
            log.warn(`No tasks found for job: ${jobId}`);
            return;
        }

        // Check if home building can store the output before starting work
        if (homeBuilding) {
            const pickupTask = tasks.find(t => t.task === TaskType.PICKUP && t.good !== undefined);
            if (pickupTask && pickupTask.good !== undefined) {
                const canStore = this.gameState.inventoryManager.canAcceptInput(homeBuilding.id, pickupTask.good, 1) ||
                                 this.gameState.inventoryManager.getInputSpace(homeBuilding.id, pickupTask.good) > 0 ||
                                 this.canStoreInOutput(homeBuilding.id, pickupTask.good);
                if (!canStore) {
                    // Output full - return home and wait there
                    this.returnHomeAndWait(settler, homeBuilding);
                    return;
                }
            }
        }

        // Search for work
        const target = handler.findTarget(settler.x, settler.y, settler.id);
        if (!target) return;

        runtime.state = SettlerState.WORKING;
        runtime.job = {
            jobId,
            taskIndex: 0,
            progress: 0,
            targetId: target.entityId,
            targetPos: { x: target.x, y: target.y },
            homeId: homeBuilding?.id ?? null,
            carryingGood: null,
        };

        log.debug(`Settler ${settler.id} starting job ${jobId}, target ${target.entityId}, home ${homeBuilding?.id ?? 'none'}`);
    }

    /**
     * Check if building can store a material in its output slot.
     */
    private canStoreInOutput(buildingId: number, materialType: EMaterialType): boolean {
        const inventory = this.gameState.inventoryManager.getInventory(buildingId);
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
        if (!controller) return;

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
        const job = runtime.job;
        if (!job) {
            runtime.state = SettlerState.IDLE;
            return;
        }

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

        default:
            log.warn(`Unhandled task type: ${task.task}`);
            return TaskResult.DONE;
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

    private executeGoToTarget(settler: Entity, job: SettlerJobState): TaskResult {
        if (!job.targetPos) return TaskResult.FAILED;
        return this.moveToPosition(settler, job.targetPos.x, job.targetPos.y);
    }

    private executeWorkOnEntity(
        settler: Entity,
        job: SettlerJobState,
        task: TaskNode,
        dt: number,
        handler?: WorkHandler
    ): TaskResult {
        if (!job.targetId || !handler) return TaskResult.FAILED;

        // Check target still valid / has materials
        if (!handler.canWork(job.targetId)) {
            // If handler says to wait, idle instead of failing
            if (handler.shouldWaitForWork) {
                return TaskResult.CONTINUE;
            }
            return TaskResult.FAILED;
        }

        // Start work on first tick (or when materials become available)
        if (!job.workStarted) {
            handler.onWorkStart?.(job.targetId);
            job.workStarted = true;
            job.progress = 0; // Reset progress when starting
        }

        // Remember previous progress for animation phase transition
        const prevProgress = job.progress;

        // Update progress
        const duration = task.duration ?? 1.0;
        job.progress += dt / duration;

        // Switch to pickup animation when log is ready (at 90% progress)
        // This threshold matches the tree system's trunk removal
        const PICKUP_THRESHOLD = 0.9;
        if (prevProgress < PICKUP_THRESHOLD && job.progress >= PICKUP_THRESHOLD) {
            this.applyTaskAnimation(settler, 'pickup');
        }

        // Update domain system
        const complete = handler.onWorkTick(job.targetId, job.progress);

        if (complete || job.progress >= 1) {
            handler.onWorkComplete?.(job.targetId, settler.x, settler.y);
            return TaskResult.DONE;
        }

        return TaskResult.CONTINUE;
    }

    private executePickup(settler: Entity, job: SettlerJobState, task: TaskNode): TaskResult {
        // Check if this is a carrier job (has sourceBuildingId)
        const carrierJob = job as CarrierJobState;
        if (carrierJob.sourceBuildingId !== undefined) {
            return this.executeCarrierPickup(settler, carrierJob);
        }

        // Regular settler pickup (e.g., woodcutter picking up LOG)
        job.carryingGood = task.good ?? null;
        return TaskResult.DONE;
    }

    /**
     * Execute carrier pickup - withdraw from source building inventory.
     */
    private executeCarrierPickup(settler: Entity, job: CarrierJobState): TaskResult {
        const entity = this.gameState.getEntity(settler.id);
        if (!entity) return TaskResult.FAILED;

        // Withdraw from source building
        const withdrawn = this.gameState.inventoryManager.withdrawOutput(
            job.sourceBuildingId,
            job.material,
            job.amount,
        );

        if (withdrawn === 0) {
            // Material no longer available
            log.warn(`Carrier ${settler.id}: material ${job.material} not available at building ${job.sourceBuildingId}`);
            return TaskResult.FAILED;
        }

        // Update carrier entity state
        if (entity.carrier) {
            entity.carrier.carryingMaterial = job.material;
            entity.carrier.carryingAmount = withdrawn;
        }

        // Update job state
        job.carryingGood = job.material;
        job.amount = withdrawn; // Update to actual withdrawn amount

        log.debug(`Carrier ${settler.id} picked up ${withdrawn} of ${job.material} from building ${job.sourceBuildingId}`);

        // Emit pickup complete event
        this.eventBus?.emit('carrier:pickupComplete', {
            entityId: settler.id,
            material: job.material,
            amount: withdrawn,
            fromBuilding: job.sourceBuildingId,
        });

        return TaskResult.DONE;
    }

    private executeGoHome(settler: Entity, job: SettlerJobState): TaskResult {
        if (!job.homeId) return TaskResult.FAILED;
        const building = this.gameState.getEntity(job.homeId);
        if (!building) return TaskResult.FAILED;
        return this.moveToPosition(settler, building.x, building.y);
    }

    private executeGoToSource(settler: Entity, job: SettlerJobState): TaskResult {
        const carrierJob = job as CarrierJobState;
        if (carrierJob.sourceBuildingId === undefined) return TaskResult.FAILED;
        const building = this.gameState.getEntity(carrierJob.sourceBuildingId);
        if (!building) return TaskResult.FAILED;
        return this.moveToPosition(settler, building.x, building.y);
    }

    private executeGoToDest(settler: Entity, job: SettlerJobState): TaskResult {
        const carrierJob = job as CarrierJobState;
        if (carrierJob.destBuildingId === undefined) return TaskResult.FAILED;
        const building = this.gameState.getEntity(carrierJob.destBuildingId);
        if (!building) return TaskResult.FAILED;
        return this.moveToPosition(settler, building.x, building.y);
    }

    private executeDropoff(settler: Entity, job: SettlerJobState): TaskResult {
        // Check if this is a carrier job (has destBuildingId)
        const carrierJob = job as CarrierJobState;
        if (carrierJob.destBuildingId !== undefined) {
            return this.executeCarrierDropoff(settler, carrierJob);
        }

        // Regular settler dropoff (e.g., woodcutter dropping off LOG at home)
        if (job.carryingGood === null || job.carryingGood === undefined) {
            return TaskResult.DONE;
        }

        if (!job.homeId) {
            log.warn(`Settler ${settler.id} has no home building for dropoff`);
            job.carryingGood = null;
            return TaskResult.DONE;
        }

        // Deposit to building inventory
        const inventory = this.gameState.inventoryManager.getInventory(job.homeId);
        if (inventory) {
            const deposited = this.gameState.inventoryManager.depositOutput(job.homeId, job.carryingGood, 1);
            if (deposited > 0) {
                log.debug(`Settler ${settler.id} deposited ${job.carryingGood} to building ${job.homeId}`);
            } else {
                log.warn(`Building ${job.homeId} output full, material lost`);
            }
        } else {
            log.warn(`Building ${job.homeId} has no inventory`);
        }

        job.carryingGood = null;
        return TaskResult.DONE;
    }

    /**
     * Execute carrier dropoff - deposit to destination building inventory.
     * Emits the critical 'carrier:deliveryComplete' event.
     */
    private executeCarrierDropoff(settler: Entity, job: CarrierJobState): TaskResult {
        const entity = this.gameState.getEntity(settler.id);
        if (!entity) return TaskResult.FAILED;

        const amount = entity.carrier?.carryingAmount ?? job.amount;
        const material = job.material;

        // Deposit to destination building
        const deposited = this.gameState.inventoryManager.depositInput(
            job.destBuildingId,
            material,
            amount,
        );

        const overflow = amount - deposited;
        if (overflow > 0) {
            log.warn(`Carrier ${settler.id}: ${overflow} of ${material} overflow at building ${job.destBuildingId}`);
        }

        // Clear carrier entity state
        if (entity.carrier) {
            entity.carrier.carryingMaterial = null;
            entity.carrier.carryingAmount = 0;
        }

        // Clear job state
        job.carryingGood = null;

        log.debug(`Carrier ${settler.id} delivered ${deposited} of ${material} to building ${job.destBuildingId}`);

        // CRITICAL: Emit delivery complete event (used by LogisticsDispatcher)
        this.eventBus?.emit('carrier:deliveryComplete', {
            entityId: settler.id,
            material,
            amount: deposited,
            toBuilding: job.destBuildingId,
            overflow,
        });

        return TaskResult.DONE;
    }

    private executeWork(_settler: Entity, job: SettlerJobState, task: TaskNode, dt: number): TaskResult {
        // Animation is applied by handleWorking at task start

        const duration = task.duration ?? 1.0;
        job.progress += dt / duration;

        if (job.progress >= 1) {
            return TaskResult.DONE;
        }

        return TaskResult.CONTINUE;
    }

    private completeJob(settler: Entity, runtime: UnitRuntime): void {
        log.debug(`Settler ${settler.id} completed job ${runtime.job?.jobId}`);
        runtime.state = SettlerState.IDLE;
        runtime.job = null;
        this.setIdleAnimation(settler);
        runtime.idleState.idleTime = 0;
    }

    private interruptJob(settler: Entity, config: SettlerConfig, runtime: UnitRuntime): void {
        const handler = this.workHandlers.get(config.search);
        // Only call onWorkInterrupt if work actually started (onWorkStart was called)
        if (handler && runtime.job?.targetId && runtime.job.workStarted) {
            handler.onWorkInterrupt?.(runtime.job.targetId);
        }

        log.debug(`Settler ${settler.id} interrupted job ${runtime.job?.jobId}`);
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
        if (entity.subType === UnitType.Carrier && carriedMaterial !== undefined && carriedMaterial !== null) {
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
            // Material-specific carry animation (from carrier state)
            const material = settler.carrier?.carryingMaterial ?? 0;
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
