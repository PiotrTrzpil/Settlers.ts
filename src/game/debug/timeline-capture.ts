/**
 * Browser-side timeline capture — monkey-patches EventBus.emit() to record
 * all game events and flush them in batches via a callback.
 *
 * Lazy: only patches when at least one subscriber exists (zero overhead otherwise).
 */

import type { EventBus, GameEventLevel, GameEvents } from '../event-bus';
import type { SerializedTimelineEntry } from '@/game/cli/types';
import { recordTimelineEvent } from '@/game/debug/timeline-recording';

/** Max entries per flush batch. */
const FLUSH_SIZE = 200;

/** Flush interval in milliseconds. */
const FLUSH_INTERVAL_MS = 500;

type EmitFn = EventBus['emit'];

export class TimelineCapture {
    private eventBus: EventBus | null = null;
    private getTickCount: (() => number) | null = null;
    private originalEmit: EmitFn | null = null;
    private buffer: SerializedTimelineEntry[] = [];
    private flushTimer: ReturnType<typeof setInterval> | null = null;
    private subscriberCount = 0;
    private started = false;

    /** Set this to receive flushed entry batches (e.g. send over WS). */
    onFlush: ((entries: SerializedTimelineEntry[]) => void) | null = null;

    /**
     * Bind to an EventBus. Does NOT start capturing until the first subscriber
     * calls addSubscriber().
     */
    start(eventBus: EventBus, getTickCount: () => number): void {
        this.eventBus = eventBus;
        this.getTickCount = getTickCount;
        this.started = true;
    }

    /** Tear down — restore emit, flush remaining, clear interval. */
    stop(): void {
        this.unpatchEmit();
        this.flushBuffer();
        this.clearInterval();
        this.eventBus = null;
        this.getTickCount = null;
        this.started = false;
        this.subscriberCount = 0;
    }

    /** A new external subscriber wants timeline data. */
    addSubscriber(): void {
        this.subscriberCount++;
        if (this.subscriberCount === 1) {
            this.activate();
        }
    }

    /** An external subscriber disconnected. */
    removeSubscriber(): void {
        if (this.subscriberCount <= 0) {
            throw new Error('TimelineCapture.removeSubscriber: no subscribers to remove');
        }
        this.subscriberCount--;
        if (this.subscriberCount === 0) {
            this.deactivate();
        }
    }

    /** Current number of active subscribers. */
    get subscribers(): number {
        return this.subscriberCount;
    }

    // ── Private ────────────────────────────────────────────────

    /** Patch emit and start the flush interval. */
    private activate(): void {
        if (!this.started) {
            throw new Error('TimelineCapture.activate: not started — call start() first');
        }
        this.patchEmit();
        this.startInterval();
    }

    /** Restore emit, flush remaining, stop interval. */
    private deactivate(): void {
        this.unpatchEmit();
        this.flushBuffer();
        this.clearInterval();
    }

    private patchEmit(): void {
        const bus = this.eventBus!;
        this.originalEmit = bus.emit.bind(bus);
        // eslint-disable-next-line @typescript-eslint/no-this-alias -- needed for emit closure
        const capture = this;

        bus.emit = (<K extends keyof GameEvents>(
            event: K,
            payload: GameEvents[K] & { level?: GameEventLevel }
        ): void => {
            const entry = recordTimelineEvent(
                capture.getTickCount!(),
                event as string,
                payload as Record<string, unknown>
            );
            capture.buffer.push(entry);
            if (capture.buffer.length >= FLUSH_SIZE) {
                capture.flushBuffer();
            }
            capture.originalEmit!(event, payload);
        }) as EventBus['emit'];
    }

    private unpatchEmit(): void {
        if (this.originalEmit && this.eventBus) {
            this.eventBus.emit = this.originalEmit;
            this.originalEmit = null;
        }
    }

    private startInterval(): void {
        this.flushTimer = setInterval(() => this.flushBuffer(), FLUSH_INTERVAL_MS);
    }

    private clearInterval(): void {
        if (this.flushTimer !== null) {
            clearInterval(this.flushTimer);
            this.flushTimer = null;
        }
    }

    private flushBuffer(): void {
        if (this.buffer.length === 0) {
            return;
        }
        const entries = this.buffer;
        this.buffer = [];
        this.onFlush?.(entries);
    }
}
