/**
 * DeathAngelSystem — drives timers for death angel entities and removes them when expired.
 *
 * Each angel is tracked with an elapsed timer. On each tick the timer advances;
 * when it exceeds ANGEL_DURATION_MS the angel entity is removed via command.
 * The system also re-applies the idle animation each tick to counteract
 * idle-animation-controller interference.
 */

import type { TickSystem } from '../../tick-system';
import type { EntityVisualService } from '../../animation/entity-visual-service';
import type { Command, CommandResult } from '../../commands';
import { createLogger } from '@/utilities/logger';

const log = createLogger('DeathAngelSystem');

const ANGEL_DURATION_MS = 3000;

interface AngelEntry {
    entityId: number;
    elapsedMs: number;
}

export interface DeathAngelSystemConfig {
    visualService: EntityVisualService;
    executeCommand: (cmd: Command) => CommandResult;
}

export class DeathAngelSystem implements TickSystem {
    private readonly angels = new Map<number, AngelEntry>();
    private readonly visualService: EntityVisualService;
    private readonly executeCommand: (cmd: Command) => CommandResult;

    constructor(cfg: DeathAngelSystemConfig) {
        this.visualService = cfg.visualService;
        this.executeCommand = cfg.executeCommand;
    }

    /** Register a newly spawned angel for timed removal. */
    register(entityId: number): void {
        this.angels.set(entityId, { entityId, elapsedMs: 0 });
    }

    /** Remove an angel from tracking (called on entity removal). */
    unregister(entityId: number): void {
        this.angels.delete(entityId);
    }

    tick(dt: number): void {
        const toRemove: number[] = [];

        for (const [entityId, entry] of this.angels) {
            try {
                entry.elapsedMs += dt;

                if (entry.elapsedMs >= ANGEL_DURATION_MS) {
                    toRemove.push(entityId);
                    continue;
                }

                // Re-apply idle animation to counteract idle-animation-controller interference.
                // play() with same sequence key just sets playing = true without restarting.
                this.visualService.play(entityId, 'idle', { loop: false });
            } catch (e) {
                const err = e instanceof Error ? e : new Error(String(e));
                log.error(`Error updating angel ${entityId}`, err);
                toRemove.push(entityId);
            }
        }

        for (const entityId of toRemove) {
            this.angels.delete(entityId);
            this.executeCommand({ type: 'remove_entity', entityId });
        }
    }
}
