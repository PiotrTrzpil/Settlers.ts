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
     * Walk animation is driven by movement state — not by job/dispatch callers.
     * @param movementState - current movement controller state ('idle' | 'moving' | undefined)
     */
    updateIdleUnit(unit: Entity, idleState: IdleAnimationState, dt: number, movementState: string | undefined): void {
        if (movementState === 'moving') {
            this.ensureWalkAnimation(unit);
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
     * Ensure the unit has a looping walk sequence for its type / carried material.
     *
     * Callers that issue movement should NOT set animation themselves — the per-tick
     * movement visual sync (updateDirectionTracking / updateIdleUnit) owns this.
     * Does not require `playing` so blocked (isWaiting) units keep the walk sequence
     * without restarting every freeze tick.
     */
    ensureWalkAnimation(unit: Entity): void {
        const vs = this.visualService.getState(unit.id);
        const walkKey = this.walkSequenceKey(unit);
        if (!vs?.animation || vs.animation.sequenceKey !== walkKey || !vs.animation.loop) {
            this.startWalkAnimation(unit);
        }
    }

    /**
     * Start walk animation for a unit.
     * Prefer ensureWalkAnimation — only call this when forcing a fresh walk cycle.
     * Direction is synced from the movement controller in updateDirectionTracking.
     */
    startWalkAnimation(unit: Entity): void {
        this.visualService.applyIntent(unit.id, {
            sequence: this.walkSequenceKey(unit),
            loop: true,
            stopped: false,
        });
    }

    private walkSequenceKey(unit: Entity): string {
        const prefix = getPrefix(unit);
        if (unit.carrying) {
            return xmlKey(prefix, `WALK_${unit.carrying.material}`);
        }
        return xmlKey(prefix, 'WALK');
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
