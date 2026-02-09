/**
 * Lightweight typed event bus for decoupling game systems.
 * Features register event handlers instead of being called directly.
 */

import type { BuildingState } from './features/building-construction';

/** Event map defining all game events and their payloads */
export interface GameEvents {
    'building:removed': { entityId: number; buildingState: BuildingState };
}

type EventHandler<T> = (payload: T) => void;

export class EventBus {
    private handlers = new Map<string, Set<EventHandler<any>>>();

    /** Register an event handler */
    on<K extends keyof GameEvents>(event: K, handler: EventHandler<GameEvents[K]>): void {
        if (!this.handlers.has(event as string)) {
            this.handlers.set(event as string, new Set());
        }
        this.handlers.get(event as string)!.add(handler);
    }

    /** Remove an event handler */
    off<K extends keyof GameEvents>(event: K, handler: EventHandler<GameEvents[K]>): void {
        this.handlers.get(event as string)?.delete(handler);
    }

    /** Emit an event to all registered handlers */
    emit<K extends keyof GameEvents>(event: K, payload: GameEvents[K]): void {
        const handlers = this.handlers.get(event as string);
        if (!handlers) return;
        for (const handler of handlers) {
            handler(payload);
        }
    }

    /** Remove all handlers */
    clear(): void {
        this.handlers.clear();
    }
}
