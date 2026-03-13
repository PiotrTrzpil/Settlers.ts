/**
 * Lightweight typed event bus for decoupling game systems.
 * Features register event handlers instead of being called directly.
 *
 * Error isolation: Handlers that throw are caught and logged with throttling.
 * One bad handler won't crash the loop or prevent other handlers from running.
 */

// Re-export all event types from the dedicated event-types module
export {
    type TrainingRecipe,
    ProductionMode,
    type GameEventLevel,
    type GameEventBase,
    type GameEvents,
} from './event-types';

import type { GameEvents, GameEventLevel } from './event-types';
import { LogHandler } from '@/utilities/log-handler';
import { ThrottledLogger } from '@/utilities/throttled-logger';

export type EventHandler<T> = (payload: T) => void;

const log = new LogHandler('EventBus');

export class EventBus {
    private handlers = new Map<string, Set<EventHandler<any>>>();

    /**
     * When true, handler errors are re-thrown instead of caught.
     * Enable in tests so failures surface immediately.
     */
    public strict = false;

    /** Called when a handler error is logged for the first time (throttled). Set by the owning layer. */
    onHandlerError: ((event: string, err: Error) => void) | null = null;

    /** Per-event throttled logger to prevent error spam */
    private errorLoggers = new Map<string, ThrottledLogger>();

    /** Get or create throttled logger for an event type */
    private getErrorLogger(event: string): ThrottledLogger {
        let logger = this.errorLoggers.get(event);
        if (!logger) {
            logger = new ThrottledLogger(log, 2000);
            this.errorLoggers.set(event, logger);
        }
        return logger;
    }

    /** Register an event handler */
    on<K extends keyof GameEvents>(event: K, handler: EventHandler<GameEvents[K]>): void {
        if (!this.handlers.has(event as string)) {
            this.handlers.set(event as string, new Set());
        }
        this.handlers.get(event as string)!.add(handler); // OK: set() above guarantees entry exists
    }

    /** Remove an event handler */
    off<K extends keyof GameEvents>(event: K, handler: EventHandler<GameEvents[K]>): void {
        this.handlers.get(event as string)?.delete(handler);
    }

    /**
     * Emit an event to all registered handlers.
     * Each handler is called in isolation - if one throws, others still run.
     * Errors are logged with throttling, and a toast is shown on first failure.
     */
    emit<K extends keyof GameEvents>(event: K, payload: GameEvents[K] & { level?: GameEventLevel }): void {
        const handlers = this.handlers.get(event as string);
        if (!handlers) {
            return;
        }

        for (const handler of handlers) {
            if (this.strict) {
                handler(payload);
                continue;
            }
            try {
                handler(payload);
            } catch (e) {
                const err = e instanceof Error ? e : new Error(String(e));
                const logged = this.getErrorLogger(event as string).error(
                    `Handler for '${event as string}' threw`,
                    err
                );
                if (logged) {
                    this.onHandlerError?.(event as string, err);
                }
            }
        }
    }

    /** Remove all handlers */
    clear(): void {
        this.handlers.clear();
        this.errorLoggers.clear();
    }
}

/**
 * Helper class to manage event subscriptions and unsubscribe all at once.
 * Reduces boilerplate when a system needs to track multiple event handlers.
 *
 * @example
 * ```ts
 * class MySystem {
 *     private subscriptions = new EventSubscriptionManager();
 *
 *     registerEvents(eventBus: EventBus): void {
 *         this.subscriptions.subscribe(eventBus, 'unit:movementStopped', (payload) => {
 *             this.handleMovementStopped(payload.entityId);
 *         });
 *     }
 *
 *     unregisterEvents(): void {
 *         this.subscriptions.unsubscribeAll();
 *     }
 * }
 * ```
 */
export class EventSubscriptionManager {
    private subscriptions: Array<{
        eventBus: EventBus;
        event: keyof GameEvents;
        handler: EventHandler<any>;
    }> = [];

    /**
     * Subscribe to an event and track the subscription for later cleanup.
     */
    subscribe<K extends keyof GameEvents>(eventBus: EventBus, event: K, handler: EventHandler<GameEvents[K]>): void {
        eventBus.on(event, handler);
        this.subscriptions.push({ eventBus, event, handler });
    }

    /**
     * Unsubscribe from all tracked events.
     * Call this in unregisterEvents() to clean up all handlers.
     */
    unsubscribeAll(): void {
        for (const { eventBus, event, handler } of this.subscriptions) {
            eventBus.off(event, handler);
        }
        this.subscriptions = [];
    }

    /**
     * Get the number of active subscriptions.
     * Useful for testing/debugging.
     */
    get count(): number {
        return this.subscriptions.length;
    }
}
