/**
 * Animation Resolver — derives animation from entity state.
 *
 * Pure function that maps (task, movement, carrying) to an animation intent.
 * The settler-task-system calls this once per tick instead of imperatively
 * calling play/stop at scattered points.
 *
 * Since military unit levels are encoded in UnitType (e.g. Swordsman2, Swordsman3),
 * each level variant has its own registered 'default'/'walk' sequences. No level-specific
 * sequence keys needed.
 */

import { ANIMATION_SEQUENCES, carrySequenceKey, fightSequenceKey, workSequenceKey } from '../animation';
import { UnitType, type Entity } from '../entity';
import type { AnimationType } from '../features/settler-tasks/types';

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
const WALK_INTENT: AnimationIntent = { sequence: ANIMATION_SEQUENCES.WALK, loop: true, stopped: false };

/** Resolve idle intent — all levels use 'default' since each level has its own UnitType. */
function resolveIdleIntent(_entity: Entity): AnimationIntent {
    return IDLE_INTENT;
}

/** Resolve fight intent — use level-specific fight animation. */
function resolveFightIntent(entity: Entity): AnimationIntent {
    const level = entity.level ?? 1;
    return { sequence: fightSequenceKey(level - 1), loop: true, stopped: false };
}

/** Resolve walk intent — carriers with material use carry animation. */
function resolveWalkIntent(entity: Entity): AnimationIntent {
    if (entity.carrying) {
        return { sequence: carrySequenceKey(entity.carrying.material), loop: true, stopped: false };
    }
    return WALK_INTENT;
}

/** Resolve carry intent — entity must be carrying a material. */
function resolveCarryIntent(entity: Entity): AnimationIntent {
    if (!entity.carrying) {
        throw new Error(
            `Cannot play 'carry' animation for entity ${entity.id} (${UnitType[entity.subType]}): ` +
                `no material being carried. Check PICKUP task runs before GO_HOME with carry anim.`
        );
    }
    return { sequence: carrySequenceKey(entity.carrying.material), loop: true, stopped: false };
}

/** Generic work animation (looping) — used for chop, harvest, mine, hammer, dig, plant, work. */
function resolveWorkIntent(_entity: Entity): AnimationIntent {
    return { sequence: workSequenceKey(0), loop: true, stopped: false };
}

/** Short work animation (non-looping) — used for pickup and dropoff. */
function resolveShortWorkIntent(_entity: Entity): AnimationIntent {
    return { sequence: workSequenceKey(0), loop: false, stopped: false };
}

/**
 * Strategy map from AnimationType to resolver function.
 * Each entry resolves a semantic animation type to a concrete AnimationIntent.
 * TypeScript enforces exhaustive coverage of all AnimationType values.
 */
const animationResolvers: Record<AnimationType, (entity: Entity) => AnimationIntent> = {
    walk: resolveWalkIntent,
    idle: resolveIdleIntent,
    carry: resolveCarryIntent,
    pickup: resolveShortWorkIntent,
    dropoff: resolveShortWorkIntent,
    chop: resolveWorkIntent,
    harvest: resolveWorkIntent,
    plant: resolveWorkIntent,
    mine: resolveWorkIntent,
    hammer: resolveWorkIntent,
    dig: resolveWorkIntent,
    fight: resolveFightIntent,
    work: resolveWorkIntent,
};

/**
 * Resolve a task's semantic animation type to a concrete AnimationIntent.
 *
 * This replaces the scattered resolveSequenceKey() + shouldLoop() + special-case
 * logic that was spread across settler-task-system and task-executors.
 */
export function resolveTaskAnimation(anim: AnimationType, entity: Entity): AnimationIntent {
    return animationResolvers[anim](entity);
}
