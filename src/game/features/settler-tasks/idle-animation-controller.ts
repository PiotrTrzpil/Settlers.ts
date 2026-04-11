/**
 * Idle animation controller for settler units.
 *
 * Manages idle turning, walk animation, task animation application,
 * and the transition between idle and working animation states.
 * Stateless service — caller provides the per-unit idle state.
 *
 * Direction rule: all direction changes go through MovementController.setDirection().
 * The per-tick sync in UnitStateMachine.updateDirectionTracking() propagates to the
 * visual service — this class never calls visualService.setDirection() directly.
 */

import type { Entity } from '../../entity';
import { UnitType } from '../../entity';
import { xmlKey } from '../../animation/animation';
import { UNIT_XML_PREFIX } from '../../renderer/sprite-metadata';
import type { EntityVisualService } from '../../animation/entity-visual-service';
import type { MovementSystem } from '../../systems/movement';
import type { EDirection } from '../../systems/hex-directions';
import type { JobPartResolution } from './choreo-types';

/** Number of sprite directions (matches hex grid) */
const NUM_DIRECTIONS = 6;

/** Idle animation state for random turning */
export interface IdleAnimationState {
    idleTime: number;
    nextIdleTurnTime: number;
}

/** Minimal RNG interface needed by the controller */
export interface RngSource {
    next(): number;
    nextBool(): boolean;
}

function getPrefix(unit: Entity): string {
    const prefix = UNIT_XML_PREFIX[unit.subType as UnitType];
    if (!prefix) {
        throw new Error(`No XML prefix for UnitType ${unit.subType as UnitType}`);
    }
    return prefix;
}

export class IdleAnimationController {
    constructor(
        private readonly visualService: EntityVisualService,
        private readonly rng: RngSource,
        private readonly movementSystem: MovementSystem
    ) {}

    /** Create initial idle animation state with a randomised first turn time. */
    createIdleState(): IdleAnimationState {
        return {
            idleTime: 0,
            nextIdleTurnTime: 2 + this.rng.next() * 4,
        };
    }

    /**
     * Update idle behaviour for a unit that is not executing a job.
     * Handles the case where the unit might be moving (pushed) or standing.
     * @param movementState - current movement controller state ('idle' | 'moving' | undefined)
     * @param movementDirection - current facing direction from the movement controller
     */
    updateIdleUnit(unit: Entity, idleState: IdleAnimationState, dt: number, movementState: string | undefined): void {
        // If unit is moving (e.g., pushed), play walk animation
        if (movementState === 'moving') {
            const vs = this.visualService.getState(unit.id);
            const prefix = getPrefix(unit);
            const walkKey = unit.carrying ? xmlKey(prefix, `WALK_${unit.carrying.material}`) : xmlKey(prefix, 'WALK');
            if (!vs?.animation?.playing || vs.animation.sequenceKey !== walkKey) {
                this.startWalkAnimation(unit);
            }
            idleState.idleTime = 0;
            return;
        }

        // Ensure idle animation — reset any playing animation to idle pose
        const vs = this.visualService.getState(unit.id);
        if (!vs?.animation || vs.animation.playing) {
            this.setIdleAnimation(unit);
        }
        this.updateIdleTurning(unit, idleState, dt);
    }

    /**
     * Handle random idle turning for standing units.
     * Writes to movement controller only — visual sync happens in updateDirectionTracking.
     */
    updateIdleTurning(unit: Entity, idleState: IdleAnimationState, dt: number): void {
        idleState.idleTime += dt;

        if (idleState.idleTime >= idleState.nextIdleTurnTime) {
            const controller = this.movementSystem.getController(unit.id);
            if (!controller) {
                return;
            }
            const newDirection = this.getAdjacentDirection(controller.direction);
            controller.setDirection(newDirection as EDirection);

            idleState.idleTime = 0;
            idleState.nextIdleTurnTime = 2 + this.rng.next() * 4;
        }
    }

    /**
     * Apply animation from a choreography node's resolved job part.
     * Called by WorkerTaskExecutor when advancing to a new node.
     */
    applyChoreoAnimation(settler: Entity, resolution: JobPartResolution): void {
        this.visualService.applyIntent(settler.id, {
            sequence: resolution.sequenceKey,
            loop: resolution.loop,
            stopped: resolution.stopped,
            reverse: resolution.reverse,
        });
    }

    /**
     * Start walk animation for a unit (used for move tasks and external movement).
     * Direction is already set on the controller by the caller — visual sync
     * happens in updateDirectionTracking.
     */
    startWalkAnimation(unit: Entity): void {
        const prefix = getPrefix(unit);
        let sequence: string;
        if (unit.carrying) {
            sequence = xmlKey(prefix, `WALK_${unit.carrying.material}`);
        } else {
            sequence = xmlKey(prefix, 'WALK');
        }
        this.visualService.applyIntent(unit.id, { sequence, loop: true, stopped: false });
        // Direction is read from the controller by the per-tick sync — no direct visual write.
    }

    /**
     * Set idle animation (stopped on frame 0 of WALK).
     */
    setIdleAnimation(settler: Entity): void {
        this.visualService.applyIntent(settler.id, {
            sequence: xmlKey(getPrefix(settler), 'WALK'),
            loop: false,
            stopped: true,
        });
    }

    /** Get an adjacent direction for idle turning. */
    private getAdjacentDirection(currentDirection: number): number {
        const offset = this.rng.nextBool() ? 1 : -1;
        return (((currentDirection + offset) % NUM_DIRECTIONS) + NUM_DIRECTIONS) % NUM_DIRECTIONS;
    }
}
