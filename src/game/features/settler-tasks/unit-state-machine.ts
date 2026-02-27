/**
 * Unit state machine for settler task processing.
 *
 * Coordinates the IDLE → WORKING → INTERRUPTED state transitions for settler
 * units with YAML-defined job configs. Delegates to WorkerTaskExecutor or
 * CarrierTaskExecutor based on the active job type.
 *
 * Handles:
 * - Per-tick state dispatch (idle/working/interrupted)
 * - Move task monitoring and completion
 * - Direction change detection and animation sync
 * - Idle animation for both configured and unconfigured units
 */

import type { Entity } from '../../entity';
import { UnitType } from '../../entity';
import { LogHandler } from '@/utilities/log-handler';
import { SettlerState, type SettlerConfig, type JobState } from './types';
import type { SettlerConfigs } from './loader';
import type { IdleAnimationController, IdleAnimationState } from './idle-animation-controller';
import type { WorkerTaskExecutor, WorkerRuntimeState, OccupancyMap } from './worker-task-executor';
import type { CarrierTaskExecutor, CarrierRuntimeState } from './carrier-task-executor';
import type { GameState } from '../../game-state';
import type { AnimationService } from '../../animation/index';

const log = new LogHandler('UnitStateMachine');

/** Simple move task state (for user-initiated movement) */
export interface MoveTaskState {
    type: 'move';
    targetX: number;
    targetY: number;
}

/** Full runtime state for each unit. */
export interface UnitRuntime {
    state: SettlerState;
    /** Job state — either worker or carrier job */
    job: JobState | null;
    /** Simple move task (for user commands) */
    moveTask: MoveTaskState | null;
    /** Last known direction (for change detection) */
    lastDirection: number;
    /** Idle animation state */
    idleState: IdleAnimationState;
    /** Building this worker is assigned to (reserved exclusively via occupancy tracking) */
    assignedBuilding: number | null;
}

export class UnitStateMachine {
    constructor(
        private readonly gameState: GameState,
        private readonly animationService: AnimationService,
        private readonly settlerConfigs: SettlerConfigs,
        private readonly animController: IdleAnimationController,
        private readonly workerExecutor: WorkerTaskExecutor,
        private readonly carrierExecutor: CarrierTaskExecutor,
        private readonly buildingOccupants: Map<number, number>,
        private readonly claimBuilding: (runtime: UnitRuntime, buildingId: number) => void,
        private readonly releaseBuilding: (runtime: UnitRuntime) => void
    ) {}

    /**
     * Process one tick for a single unit.
     */
    updateUnit(unit: Entity, runtime: UnitRuntime, dt: number): void {
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
        const controller = this.gameState.movement.getController(unit.id);
        this.animController.updateIdleUnit(unit, runtime.idleState, dt, controller?.state, controller?.direction);
    }

    // ─────────────────────────────────────────────────────────────
    // Direction tracking
    // ─────────────────────────────────────────────────────────────

    /**
     * Detect direction changes and sync the animation direction accordingly.
     */
    updateDirectionTracking(unit: Entity, runtime: UnitRuntime): void {
        const controller = this.gameState.movement.getController(unit.id);
        if (!controller) return;

        const currentDirection = controller.direction;
        if (currentDirection !== runtime.lastDirection) {
            this.animationService.setDirection(unit.id, currentDirection);
            runtime.lastDirection = currentDirection;
        }
    }

    // ─────────────────────────────────────────────────────────────
    // Move task
    // ─────────────────────────────────────────────────────────────

    /**
     * Advance a user-initiated move task.
     */
    private updateMoveTask(unit: Entity, runtime: UnitRuntime): void {
        const controller = this.gameState.movement.getController(unit.id);
        if (!controller) {
            // No movement controller — cancel task
            runtime.moveTask = null;
            runtime.state = SettlerState.IDLE;
            this.animController.setIdleAnimation(unit);
            return;
        }

        if (controller.state === 'idle') {
            // Movement finished
            runtime.moveTask = null;
            runtime.state = SettlerState.IDLE;
            this.animController.setIdleAnimation(unit);
            runtime.idleState.idleTime = 0;
            log.debug(`Unit ${unit.id} completed move task`);
        }
        // Otherwise keep waiting for movement to complete
    }

    // ─────────────────────────────────────────────────────────────
    // YAML settler state dispatch
    // ─────────────────────────────────────────────────────────────

    private updateSettler(settler: Entity, config: SettlerConfig, runtime: UnitRuntime, dt: number): void {
        switch (runtime.state) {
        case SettlerState.IDLE:
            this.handleIdle(settler, config, runtime);
            // Also handle idle turning when not working (handleIdle may change state to WORKING)
            // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- handleIdle mutates runtime.state
            if (runtime.state === SettlerState.IDLE) {
                // Ensure idle animation state exists (units that never worked won't have one)
                if (!this.animationService.getState(settler.id)) {
                    this.animController.setIdleAnimation(settler);
                }
                this.animController.updateIdleTurning(settler, runtime.idleState, dt);
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
        this.workerExecutor.handleIdle(
            settler,
            config,
            runtime as WorkerRuntimeState,
            this.buildingOccupants as OccupancyMap,
            (r, buildingId) => this.claimBuilding(r as UnitRuntime, buildingId),
            r => this.releaseBuilding(r as UnitRuntime)
        );
    }

    private handleWorking(settler: Entity, config: SettlerConfig, runtime: UnitRuntime, dt: number): void {
        const job = runtime.job!;

        if (job.type === 'carrier') {
            this.carrierExecutor.handleWorking(settler, runtime as CarrierRuntimeState, dt);
        } else {
            this.workerExecutor.handleWorking(settler, config, runtime as WorkerRuntimeState, dt);
        }

        // Sync direction immediately after task execution (FACE_POS sets it mid-tick, avoid one-frame lag)
        this.updateDirectionTracking(settler, runtime);
    }
}
