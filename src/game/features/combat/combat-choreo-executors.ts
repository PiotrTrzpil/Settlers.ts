/**
 * Military choreography node executors — HEAL_ENTITY and ATTACK_REACTION.
 *
 * Both are duration-only stubs for now: they keep the unit busy for the node's duration
 * but apply no combat effect yet. Registered on the kernel ChoreoSystem by the combat feature.
 */

import type { Entity } from '../../entity';
import type { GameState } from '../../game-state';
import { createLogger } from '@/utilities/logger';
import {
    ChoreoTaskType,
    TaskResult,
    framesToSeconds,
    tickDuration,
    type ChoreoSystem,
    type ChoreoJobState,
    type ChoreoNode,
} from '../../systems/choreo';

const log = createLogger('CombatChoreoExecutors');

/**
 * Healer work — restore health to a target entity.
 *
 * Duration-based: advances job.progress over node.duration frames (default 2 s).
 * The actual HP mutation will be applied by the health/combat system when it exists;
 * this executor only signals "healer is busy healing" for the correct duration.
 */
function executeHealEntity(
    settler: Entity,
    job: ChoreoJobState,
    node: ChoreoNode,
    dt: number,
    gameState: GameState
): TaskResult {
    if (job.targetId === null) {
        log.debug(`executeHealEntity: settler ${settler.id} has no target`);
        return TaskResult.FAILED;
    }

    // Use nullable getEntity — the target may have been destroyed mid-heal.
    const target = gameState.getEntity(job.targetId);
    if (!target) {
        log.debug(`executeHealEntity: target ${job.targetId} no longer exists, settler ${settler.id} aborts`);
        return TaskResult.FAILED;
    }

    const duration = node.duration > 0 ? framesToSeconds(node.duration) : 2.0;
    const result = tickDuration(job, dt, duration);
    if (result === TaskResult.DONE) {
        log.warn(
            `executeHealEntity: settler ${settler.id} finished healing target ${job.targetId} — HP mutation not implemented, heal skipped`
        );
    }
    return result;
}

/**
 * Combat response — react to being attacked.
 *
 * Duration-based wait that represents a defensive/reaction animation.
 * Defaults to 0.5 s when node.duration is not set.
 * The actual fight-back or retreat logic will be added by the combat system.
 */
function executeAttackReaction(settler: Entity, job: ChoreoJobState, node: ChoreoNode, dt: number): TaskResult {
    const duration = node.duration > 0 ? framesToSeconds(node.duration) : 0.5;
    const result = tickDuration(job, dt, duration);
    if (result === TaskResult.DONE) {
        log.warn(
            `executeAttackReaction: settler ${settler.id} completed reaction — combat logic not implemented, reaction skipped`
        );
    }
    return result;
}

/** Register HEAL_ENTITY and ATTACK_REACTION. */
export function registerCombatExecutors(choreoSystem: ChoreoSystem, gameState: GameState): void {
    choreoSystem.register(ChoreoTaskType.HEAL_ENTITY, (s, j, n, dt) => executeHealEntity(s, j, n, dt, gameState));
    choreoSystem.register(ChoreoTaskType.ATTACK_REACTION, executeAttackReaction);
}
