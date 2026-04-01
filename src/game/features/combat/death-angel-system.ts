/**
 * DeathAngelSystem — drives timers for death angel entities and removes them when expired.
 *
 * Each angel is tracked with an elapsed timer. On each tick the timer advances;
 * when it exceeds ANGEL_DURATION the angel entity is removed via command.
 * The animation plays once and becomes invisible via hideOnComplete; this system
 * only handles the deferred entity cleanup.
 */

import type { TickSystem } from '../../core/tick-system';
import type { CommandExecutor } from '../../commands';
import { createLogger } from '@/utilities/logger';

const log = createLogger('DeathAngelSystem');

/** Duration in game-time seconds (dt is in seconds, not milliseconds). */
const ANGEL_DURATION = 3;

export interface DeathAngelSystemConfig {
    executeCommand: CommandExecutor;
}

export class DeathAngelSystem implements TickSystem {
    private readonly angels = new Map<number, number>();
    private readonly executeCommand: CommandExecutor;

    constructor(cfg: DeathAngelSystemConfig) {
        this.executeCommand = cfg.executeCommand;
    }

    /** Register a newly spawned angel for timed removal. */
    register(entityId: number): void {
        this.angels.set(entityId, 0);
    }

    /** Remove an angel from tracking (called on entity removal). */
    unregister(entityId: number): void {
        this.angels.delete(entityId);
    }

    tick(dt: number): void {
        const toRemove: number[] = [];

        for (const [entityId, elapsed] of this.angels) {
            const newElapsed = elapsed + dt;
            if (newElapsed >= ANGEL_DURATION) {
                toRemove.push(entityId);
            } else {
                this.angels.set(entityId, newElapsed);
            }
        }

        for (const entityId of toRemove) {
            this.angels.delete(entityId);
            this.executeCommand({ type: 'remove_entity', entityId });
            log.debug(`Removed death angel ${entityId}`);
        }
    }
}
