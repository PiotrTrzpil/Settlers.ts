/**
 * Settler Task System - manages settler behaviors via task sequences.
 *
 * Settlers execute jobs (sequences of tasks) defined in YAML.
 * Domain systems (WoodcuttingSystem, etc.) register work handlers
 * that are called when settlers perform WORK_ON_ENTITY tasks.
 */

import type { GameState } from '../../game-state';
import type { TickSystem } from '../../tick-system';
import { EntityType, UnitType, Entity } from '../../entity';
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
    type WorkHandler,
    type AnimationType,
} from './types';
import { loadSettlerConfigs, loadJobDefinitions, type SettlerConfigs, type JobDefinitions } from './loader';
import { getWorkerWorkplace } from '../../unit-types';

const log = new LogHandler('SettlerTaskSystem');

/** Runtime state for each settler */
interface SettlerRuntime {
    state: SettlerState;
    job: SettlerJobState | null;
}

/**
 * Manages all settler behaviors through task execution.
 */
export class SettlerTaskSystem implements TickSystem {
    private gameState: GameState;
    private animationService: AnimationService;
    private settlerConfigs: SettlerConfigs;
    private jobDefinitions: JobDefinitions;
    private workHandlers = new Map<SearchType, WorkHandler>();
    private runtimes = new Map<number, SettlerRuntime>();

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

                const workplace = this.findHomeBuilding(settler);
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
                const inventory = this.gameState.inventoryManager.getInventory(targetId);
                if (!inventory) return;

                for (const slot of inventory.inputSlots) {
                    if (slot.currentAmount > 0) {
                        this.gameState.inventoryManager.withdrawInput(targetId, slot.materialType, 1);
                    }
                }
            },

            onWorkTick: (_targetId: number, progress: number) => {
                // Complete when progress reaches 1.0
                return progress >= 1.0;
            },

            onWorkComplete: (targetId: number) => {
                // Produce outputs when work completes
                const inventory = this.gameState.inventoryManager.getInventory(targetId);
                if (!inventory) return;

                for (const slot of inventory.outputSlots) {
                    this.gameState.inventoryManager.depositOutput(targetId, slot.materialType, 1);
                }
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
     * Check if a settler is currently working (not idle).
     */
    isWorking(entityId: number): boolean {
        const runtime = this.runtimes.get(entityId);
        return runtime?.state === SettlerState.WORKING;
    }

    /**
     * Register a work handler for a search type.
     * Domain systems call this to plug into the task system.
     */
    registerWorkHandler(searchType: SearchType, handler: WorkHandler): void {
        this.workHandlers.set(searchType, handler);
        log.debug(`Registered work handler for ${searchType}`);
    }

    /**
     * Find the nearest workplace building for a settler.
     */
    private findHomeBuilding(settler: Entity): Entity | null {
        const unitType = settler.subType as UnitType;
        const workplaceType = getWorkerWorkplace(unitType);

        if (workplaceType === undefined) {
            return null;
        }

        // Find nearest building of the correct type for this player
        let nearest: Entity | null = null;
        let nearestDistSq = Infinity;

        for (const entity of this.gameState.entities) {
            if (entity.type !== EntityType.Building) continue;
            if (entity.subType !== workplaceType) continue;
            if (entity.player !== settler.player) continue;

            const dx = entity.x - settler.x;
            const dy = entity.y - settler.y;
            const distSq = dx * dx + dy * dy;

            if (distSq < nearestDistSq) {
                nearestDistSq = distSq;
                nearest = entity;
            }
        }

        return nearest;
    }

    /** TickSystem interface */
    tick(dt: number): void {
        // Process all settlers that have configs
        for (const [unitType, config] of this.settlerConfigs) {
            const settlers = this.gameState.entities.filter(
                e => e.type === EntityType.Unit && e.subType === unitType
            );

            for (const settler of settlers) {
                this.updateSettler(settler, config, dt);
            }
        }

        // Cleanup removed settlers
        for (const id of this.runtimes.keys()) {
            if (!this.gameState.getEntity(id)) {
                this.runtimes.delete(id);
            }
        }
    }

    private getRuntime(settlerId: number): SettlerRuntime {
        let runtime = this.runtimes.get(settlerId);
        if (!runtime) {
            runtime = { state: SettlerState.IDLE, job: null };
            this.runtimes.set(settlerId, runtime);
        }
        return runtime;
    }

    private updateSettler(settler: Entity, config: SettlerConfig, dt: number): void {
        const runtime = this.getRuntime(settler.id);

        switch (runtime.state) {
        case SettlerState.IDLE:
            this.handleIdle(settler, config, runtime);
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

    private handleIdle(settler: Entity, config: SettlerConfig, runtime: SettlerRuntime): void {
        const handler = this.workHandlers.get(config.search);
        if (!handler) return;

        // Search for work
        const target = handler.findTarget(settler.x, settler.y, settler.id);
        if (!target) return;

        // Start the first job in the settler's job list
        const jobId = `${UnitType[settler.subType].toLowerCase()}.${config.jobs[0]}`;
        const tasks = this.jobDefinitions.get(jobId);
        if (!tasks || tasks.length === 0) {
            log.warn(`No tasks found for job: ${jobId}`);
            return;
        }

        // Find home building (workplace) for this settler
        const homeBuilding = this.findHomeBuilding(settler);

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

    private handleWorking(settler: Entity, config: SettlerConfig, runtime: SettlerRuntime, dt: number): void {
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
        runtime: SettlerRuntime,
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

    private executeGoToTarget(settler: Entity, job: SettlerJobState): TaskResult {
        if (!job.targetPos) return TaskResult.FAILED;

        const controller = this.gameState.movement.getController(settler.id);
        if (!controller) return TaskResult.FAILED;

        // Check if we're adjacent to target using proper hex distance
        const dist = hexDistance(settler.x, settler.y, job.targetPos.x, job.targetPos.y);

        // Only complete when adjacent AND not moving
        if (dist <= 1 && controller.state === 'idle') {
            return TaskResult.DONE;
        }

        // Start moving if idle and not yet adjacent
        if (controller.state === 'idle' && dist > 1) {
            const moved = this.gameState.movement.moveUnit(
                settler.id,
                job.targetPos.x,
                job.targetPos.y
            );
            if (!moved) return TaskResult.FAILED;
        }

        return TaskResult.CONTINUE;
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

    private executePickup(_settler: Entity, job: SettlerJobState, task: TaskNode): TaskResult {
        // TODO: Actually pick up the good
        job.carryingGood = task.good ?? null;
        return TaskResult.DONE;
    }

    private executeGoHome(settler: Entity, job: SettlerJobState): TaskResult {
        if (!job.homeId) {
            log.warn(`Settler ${settler.id} has no home building`);
            return TaskResult.FAILED;
        }

        const homeBuilding = this.gameState.getEntity(job.homeId);
        if (!homeBuilding) {
            log.warn(`Home building ${job.homeId} no longer exists`);
            return TaskResult.FAILED;
        }

        const controller = this.gameState.movement.getController(settler.id);
        if (!controller) return TaskResult.FAILED;

        // Check if we're adjacent to home building
        const dist = hexDistance(settler.x, settler.y, homeBuilding.x, homeBuilding.y);

        if (dist <= 1 && controller.state === 'idle') {
            return TaskResult.DONE;
        }

        // Start movement if idle
        if (controller.state === 'idle') {
            this.gameState.movement.moveUnit(settler.id, homeBuilding.x, homeBuilding.y);
        }

        return TaskResult.CONTINUE;
    }

    private executeDropoff(settler: Entity, job: SettlerJobState): TaskResult {
        if (!job.carryingGood) {
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

    private executeWork(_settler: Entity, job: SettlerJobState, task: TaskNode, dt: number): TaskResult {
        // Animation is applied by handleWorking at task start

        const duration = task.duration ?? 1.0;
        job.progress += dt / duration;

        if (job.progress >= 1) {
            return TaskResult.DONE;
        }

        return TaskResult.CONTINUE;
    }

    private completeJob(settler: Entity, runtime: SettlerRuntime): void {
        log.debug(`Settler ${settler.id} completed job ${runtime.job?.jobId}`);
        runtime.state = SettlerState.IDLE;
        runtime.job = null;
        this.setIdleAnimation(settler);
    }

    private interruptJob(settler: Entity, config: SettlerConfig, runtime: SettlerRuntime): void {
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
            // Material-specific carry animation
            const material = settler.carriedMaterial ?? 0;
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
