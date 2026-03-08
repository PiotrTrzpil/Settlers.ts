/**
 * Idle animation controller for settler units.
 *
 * Manages idle turning, walk animation, task animation application,
 * and the transition between idle and working animation states.
 * Stateless service — caller provides the per-unit idle state.
 */

import type { Entity } from '../../entity';
import { UnitType } from '../../entity';
import { EMaterialType } from '../../economy';
import { xmlKey } from '../../animation/animation';
import { UNIT_XML_PREFIX } from '../../renderer/sprite-metadata';
import type { EntityVisualService } from '../../animation/entity-visual-service';
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
    if (!prefix) throw new Error(`No XML prefix for UnitType ${UnitType[unit.subType] ?? unit.subType}`);
    return prefix;
}

export class IdleAnimationController {
    constructor(
        private readonly visualService: EntityVisualService,
        private readonly rng: RngSource
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
    updateIdleUnit(
        unit: Entity,
        idleState: IdleAnimationState,
        dt: number,
        movementState: string | undefined,
        movementDirection: number = 0
    ): void {
        // If unit is moving (e.g., pushed), play walk animation
        if (movementState === 'moving') {
            const vs = this.visualService.getState(unit.id);
            const prefix = getPrefix(unit);
            const walkKey = unit.carrying
                ? xmlKey(prefix, `WALK_${EMaterialType[unit.carrying.material]}`)
                : xmlKey(prefix, 'WALK');
            if (!vs?.animation?.playing || vs.animation.sequenceKey !== walkKey) {
                this.startWalkAnimation(unit, movementDirection);
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
     */
    updateIdleTurning(unit: Entity, idleState: IdleAnimationState, dt: number): void {
        idleState.idleTime += dt;

        if (idleState.idleTime >= idleState.nextIdleTurnTime) {
            // Animation state may be missing during cleanup
            const vs = this.visualService.getState(unit.id);
            if (!vs?.animation) return;
            const newDirection = this.getAdjacentDirection(vs.animation.direction);
            this.visualService.setDirection(unit.id, newDirection);

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
        });
    }

    /**
     * Start walk animation for a unit (used for move tasks and external movement).
     */
    startWalkAnimation(unit: Entity, direction: number): void {
        const prefix = getPrefix(unit);
        let sequence: string;
        if (unit.carrying) {
            const materialName = EMaterialType[unit.carrying.material];
            if (!materialName) throw new Error(`Unknown EMaterialType: ${unit.carrying.material}`);
            sequence = xmlKey(prefix, `WALK_${materialName}`);
        } else {
            sequence = xmlKey(prefix, 'WALK');
        }
        this.visualService.applyIntent(unit.id, { sequence, loop: true, stopped: false });
        this.visualService.setDirection(unit.id, direction);
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
