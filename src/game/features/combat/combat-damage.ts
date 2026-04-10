/**
 * Combat damage & death — extracted from combat-system.ts.
 *
 * Handles damage application, event emission, death cascades (clearing
 * stale locks and retargeting surviving combatants), and entity removal.
 */

import type { CombatState } from './combat-state';
import type { EventBus } from '../../event-bus';
import type { CommandExecutor } from '../../commands';
import { createLogger } from '@/utilities/logger';

const log = createLogger('CombatDamage');

export interface CombatDamageContext {
    states: Map<number, CombatState>;
    lockedTargets: Map<number, { targetId: number; reason: string }>;
    pursuitTimers: Map<number, number>;
    eventBus: EventBus;
    executeCommand: CommandExecutor;
    getMovementController: (entityId: number) => { state: string; clearPath(): void } | undefined;
    transitionToIdle: (state: CombatState) => void;
}

/** Core damage logic: decrement health, emit event, kill if dead. */
export function inflictDamage(ctx: CombatDamageContext, attackerId: number, targetId: number, damage: number): void {
    const targetState = ctx.states.get(targetId)!;

    targetState.health -= damage;

    ctx.eventBus.emit('combat:unitAttacked', {
        unitId: attackerId,
        targetId,
        damage,
        remainingHealth: Math.max(0, targetState.health),
    });

    if (targetState.health <= 0) {
        killUnit(ctx, targetState, attackerId);
    }
}

function killUnit(ctx: CombatDamageContext, state: CombatState, killedBy: number): void {
    log.debug(`Unit ${state.entityId} killed by ${killedBy}`);

    // Emit event FIRST — siege system may re-lock surviving units synchronously
    ctx.eventBus.emit('combat:unitDefeated', {
        unitId: state.entityId,
        defeatedBy: killedBy,
        level: 'info',
    });

    // Auto-clear stale locks pointing to the dead unit (skip units re-locked by event handlers)
    for (const [id, lock] of ctx.lockedTargets) {
        if (lock.targetId === state.entityId) {
            ctx.lockedTargets.delete(id);
        }
    }
    ctx.lockedTargets.delete(state.entityId);

    // Clear non-locked combatants targeting the dead unit (locked ones were re-assigned above)
    for (const other of ctx.states.values()) {
        if (other.targetId === state.entityId && !ctx.lockedTargets.has(other.entityId)) {
            other.targetId = null;
            ctx.pursuitTimers.delete(other.entityId);
            const controller = ctx.getMovementController(other.entityId);
            if (controller && controller.state !== 'idle') {
                controller.clearPath();
            }
            ctx.transitionToIdle(other);
        }
    }

    // Remove entity from game (triggers entity:removed → unregister)
    ctx.executeCommand({ type: 'remove_entity', entityId: state.entityId });
}
