/**
 * ThrottledEmitter
 *
 * Emits a keyed event at most once per cooldown period.
 * Extracts the duplicated throttle pattern from LogisticsDispatcher
 * (noMatchCooldowns / noCarrierCooldowns).
 */
import type { EventBus, GameEvents } from '../../event-bus';

export class ThrottledEmitter<E extends keyof GameEvents> {
    private readonly cooldowns = new Map<string, number>();
    private elapsedTime = 0;

    constructor(
        private readonly eventBus: EventBus,
        private readonly eventName: E,
        private readonly cooldownSec: number
    ) {}

    /** Advance the internal clock. Call once per tick with delta time in seconds. */
    advance(dt: number): void {
        this.elapsedTime += dt;
    }

    /** Emit the event if the key hasn't been emitted within the cooldown period. */
    tryEmit(key: string, payload: GameEvents[E]): void {
        const lastEmit = this.cooldowns.get(key) ?? -Infinity;
        if (this.elapsedTime - lastEmit < this.cooldownSec) {
            return;
        }
        this.cooldowns.set(key, this.elapsedTime);
        this.eventBus.emit(this.eventName, payload);
    }
}
