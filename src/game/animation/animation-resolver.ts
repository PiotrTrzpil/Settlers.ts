/**
 * Animation Resolver — derives animation from entity state.
 *
 * Pure function that maps (task, movement, carrying) to an animation intent.
 * The settler-task-system calls this once per tick instead of imperatively
 * calling play/stop at scattered points.
 */

import { ANIMATION_SEQUENCES, carrySequenceKey, workSequenceKey } from '../animation';
import { UnitType, type Entity } from '../entity';
import type { AnimationType } from '../systems/settler-tasks/types';

/** What animation should play on an entity */
export interface AnimationIntent {
    /** Sequence key (e.g., 'walk', 'default', 'work.0', 'carry_5') */
    sequence: string;
    /** Whether the animation should loop */
    loop: boolean;
    /** If true, freeze on frame 0 (idle pose) */
    stopped: boolean;
}

const IDLE_INTENT: AnimationIntent = { sequence: ANIMATION_SEQUENCES.DEFAULT, loop: false, stopped: true };

/**
 * Resolve a task's semantic animation type to a concrete AnimationIntent.
 *
 * This replaces the scattered resolveSequenceKey() + shouldLoop() + special-case
 * logic that was spread across settler-task-system and task-executors.
 */
export function resolveTaskAnimation(anim: AnimationType, entity: Entity): AnimationIntent {
    switch (anim) {
    case 'walk':
        return resolveWalkIntent(entity);

    case 'carry':
        if (!entity.carrying) {
            throw new Error(
                `Cannot play 'carry' animation for entity ${entity.id} (${UnitType[entity.subType]}): ` +
                        `no material being carried. Check PICKUP task runs before GO_HOME with carry anim.`
            );
        }
        return { sequence: carrySequenceKey(entity.carrying.material), loop: true, stopped: false };

    case 'chop':
    case 'harvest':
    case 'mine':
    case 'hammer':
    case 'dig':
    case 'plant':
    case 'work':
        return { sequence: workSequenceKey(0), loop: true, stopped: false };

    case 'pickup':
    case 'dropoff':
        return { sequence: workSequenceKey(0), loop: false, stopped: false };

    case 'idle':
    default:
        return IDLE_INTENT;
    }
}

/**
 * Resolve walk intent — carriers with material use carry animation.
 */
function resolveWalkIntent(entity: Entity): AnimationIntent {
    if (entity.carrying) {
        return { sequence: carrySequenceKey(entity.carrying.material), loop: true, stopped: false };
    }
    return { sequence: ANIMATION_SEQUENCES.WALK, loop: true, stopped: false };
}
