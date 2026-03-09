/**
 * Unit state machine for settler task processing.
 *
 * Coordinates the IDLE → WORKING → INTERRUPTED state transitions for settler
 * units with choreography job configs. Delegates all job execution to
 * WorkerTaskExecutor (both XML-defined and inline transport jobs).
 *
 * Handles:
 * - Per-tick state dispatch (idle/working/interrupted)
 * - Move task monitoring and completion
 * - Direction change detection and animation sync
 * - Idle animation for both configured and unconfigured units
 */

import type { Entity } from '../../entity';
import { UnitType } from '../../entity';
import { createLogger } from '@/utilities/logger';
import { SearchType, SettlerState, type SettlerConfig, type JobState, type HomeAssignment } from './types';
import type { IdleAnimationController, IdleAnimationState } from './idle-animation-controller';
import type { WorkerTaskExecutor, WorkerRuntimeState, OccupancyMap } from './worker-task-executor';
import type { GameState } from '../../game-state';
import type { EntityVisualService } from '../../animation/entity-visual-service';

/** Settler configs keyed by UnitType (from settler-data-access.ts). */
type SettlerConfigs = Map<UnitType, SettlerConfig>;

const log = createLogger('UnitStateMachine');

/** Ticks to rest after completing a job before searching for new work (~1 second at 30 tps). */
const POST_JOB_REST_TICKS = 30;

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
    /** Workplace building assignment — null when unassigned or building destroyed. */
    homeAssignment: HomeAssignment | null;
    /** Ticks remaining before next idle work search (0 = search now). */
    idleSearchCooldown: number;
}

export interface UnitStateMachineConfig {
    gameState: GameState;
    visualService: EntityVisualService;
    settlerConfigs: SettlerConfigs;
    animController: IdleAnimationController;
    workerExecutor: WorkerTaskExecutor;
    buildingOccupants: Map<number, number>;
    /** Returns true if the entity is actively in combat (fighting or pursuing). */
    isInCombat: (entityId: number) => boolean;
    claimBuilding: (runtime: UnitRuntime, buildingId: number) => void;
    releaseBuilding: (runtime: UnitRuntime) => void;
    /** Ticks to wait between idle work searches (0 = every tick). */
    idleSearchCooldown: number;
}

export class UnitStateMachine {
    private readonly gameState: GameState;
    private readonly visualService: EntityVisualService;
    private readonly settlerConfigs: SettlerConfigs;
    private readonly animController: IdleAnimationController;
    private readonly workerExecutor: WorkerTaskExecutor;
    private readonly buildingOccupants: Map<number, number>;
    private readonly isInCombat: (entityId: number) => boolean;
    private readonly claimBuilding: (runtime: UnitRuntime, buildingId: number) => void;
    private readonly releaseBuilding: (runtime: UnitRuntime) => void;
    private readonly idleSearchCooldown: number;

    /** Pre-bound closures for handleIdle — avoids allocating new closures per call. */
    private readonly boundClaimBuilding: (r: WorkerRuntimeState, buildingId: number) => void;
    private readonly boundReleaseBuilding: (r: WorkerRuntimeState) => void;

    constructor(cfg: UnitStateMachineConfig) {
        this.gameState = cfg.gameState;
        this.visualService = cfg.visualService;
        this.settlerConfigs = cfg.settlerConfigs;
        this.animController = cfg.animController;
        this.workerExecutor = cfg.workerExecutor;
        this.buildingOccupants = cfg.buildingOccupants;
        this.isInCombat = cfg.isInCombat;
        this.claimBuilding = cfg.claimBuilding;
        this.releaseBuilding = cfg.releaseBuilding;
        this.idleSearchCooldown = cfg.idleSearchCooldown;

        this.boundClaimBuilding = (r, buildingId) => cfg.claimBuilding(r as UnitRuntime, buildingId);
        this.boundReleaseBuilding = r => cfg.releaseBuilding(r as UnitRuntime);
    }

    /**
     * Process one tick for a single unit.
     */
    updateUnit(unit: Entity, runtime: UnitRuntime, dt: number): void {
        const config = this.settlerConfigs.get(unit.subType as UnitType);

        // Handle move task first (takes priority)
        if (runtime.moveTask) {
            this.updateDirectionTracking(unit, runtime);
            this.updateMoveTask(unit, runtime);
            return;
        }

        // Handle choreography-based jobs for configured settlers
        if (config) {
            // Working path calls updateDirectionTracking itself (after executor, for mid-tick direction changes)
            if (runtime.state !== SettlerState.WORKING) {
                this.updateDirectionTracking(unit, runtime);
            }
            this.updateSettler(unit, config, runtime, dt);
            return;
        }

        // Skip idle updates for units actively in combat (combat system manages their animation)
        if (this.isInCombat(unit.id)) return;

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
            // Only set direction if entity has an active animation
            const vs = this.visualService.getState(unit.id);
            if (vs?.animation) {
                this.visualService.setDirection(unit.id, currentDirection);
            }
            runtime.lastDirection = currentDirection;
        }

        // Freeze walk animation when blocked waiting for an occupied tile
        const vs = this.visualService.getState(unit.id);
        if (vs?.animation) {
            if (controller.isWaiting && vs.animation.playing) {
                vs.animation.playing = false;
            } else if (!controller.isWaiting && !vs.animation.playing && controller.state === 'moving') {
                vs.animation.playing = true;
            }
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
    // Settler state dispatch
    // ─────────────────────────────────────────────────────────────

    private updateSettler(settler: Entity, config: SettlerConfig, runtime: UnitRuntime, dt: number): void {
        switch (runtime.state) {
        case SettlerState.IDLE:
            // Carriers are passively assigned jobs by LogisticsDispatcher — skip idle search entirely.
            // All other settlers actively search for work on a cooldown.
            if (config.search !== SearchType.GOOD) {
                if (runtime.idleSearchCooldown > 0) {
                    runtime.idleSearchCooldown--;
                } else {
                    this.handleIdle(settler, config, runtime);
                }
            }
            // Also handle idle turning when not working (handleIdle may change state to WORKING)
            // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- handleIdle mutates runtime.state
            if (runtime.state === SettlerState.IDLE) {
                const controller = this.gameState.movement.getController(settler.id);
                this.animController.updateIdleUnit(
                    settler,
                    runtime.idleState,
                    dt,
                    controller?.state,
                    controller?.direction
                );
            }
            break;

        case SettlerState.WORKING:
            this.handleWorking(settler, config, runtime, dt);
            break;

        case SettlerState.INTERRUPTED:
            // Return to idle after interruption — search immediately on next tick
            runtime.state = SettlerState.IDLE;
            runtime.job = null;
            runtime.idleSearchCooldown = 0;
            break;
        }
    }

    private handleIdle(settler: Entity, config: SettlerConfig, runtime: UnitRuntime): void {
        const found = this.workerExecutor.handleIdle(
            settler,
            config,
            runtime as WorkerRuntimeState,
            this.buildingOccupants as OccupancyMap,
            this.boundClaimBuilding,
            this.boundReleaseBuilding
        );
        if (!found) {
            runtime.idleSearchCooldown = this.idleSearchCooldown;
        }
    }

    private handleWorking(settler: Entity, config: SettlerConfig, runtime: UnitRuntime, dt: number): void {
        this.workerExecutor.handleWorking(settler, config, runtime as WorkerRuntimeState, dt);

        // Sync direction immediately after task execution (FACE_POS sets it mid-tick, avoid one-frame lag)
        this.updateDirectionTracking(settler, runtime);

        if (runtime.state !== SettlerState.WORKING) {
            // Interrupted → search immediately to recover.
            // Job completed → brief rest for home-building workers (matches S4 pacing).
            // Roaming workers (diggers, builders) work continuously — no rest between cycles.
            const hasHome = !!(runtime as WorkerRuntimeState).homeAssignment;
            runtime.idleSearchCooldown = runtime.state === SettlerState.IDLE && hasHome ? POST_JOB_REST_TICKS : 0;
        }
    }
}
