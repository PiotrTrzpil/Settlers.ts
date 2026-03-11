/**
 * Timeline auto-wiring for the Simulation harness.
 *
 * Intercepts EventBus.emit() and records every event to a TimelineRecorder,
 * using the shared extraction logic from timeline-recording.ts.
 *
 * This is internal plumbing — tests never import from this file directly.
 */

import { EventBus, type GameEvents } from '@/game/event-bus';
import {
    recordTimelineEvent,
    formatSlots,
    CATEGORY_MAP,
    ENTITY_ID_KEYS,
    EXTRACTED_KEYS,
    CATEGORY_ENTITY_TYPE,
    extractNum,
    buildMeta,
} from '@/game/debug/timeline-recording';
import type { TimelineRecorder } from './timeline-recorder';

// Re-export shared helpers so existing test code that imports from here still works
export { formatSlots, CATEGORY_MAP, ENTITY_ID_KEYS, EXTRACTED_KEYS, CATEGORY_ENTITY_TYPE, extractNum, buildMeta };

// ─── Timeline wiring ─────────────────────────────────────────────

/**
 * Auto-wire ALL events from an EventBus to a TimelineRecorder.
 *
 * Wraps `eventBus.emit` so every event is captured automatically — no
 * manual wiring needed when new events are added to GameEvents.
 *
 * Category, label, and entity ID are derived from the event name and payload:
 *   - `building:placed`  → category=building, label=placed, entityId from payload
 *   - `settler:taskStarted` → category=unit, label=task_started, unitId from payload
 */
export function wireSimulationTimeline(
    eventBus: EventBus,
    timeline: TimelineRecorder,
    getTickCount: () => number
): void {
    const origEmit = eventBus.emit.bind(eventBus);
    eventBus.emit = (<K extends keyof GameEvents>(event: K, payload: GameEvents[K]) => {
        const entry = recordTimelineEvent(getTickCount(), event as string, payload as Record<string, unknown>);
        timeline.record(entry as import('./timeline-recorder').TimelineEntry);
        return origEmit(event, payload);
    }) as typeof eventBus.emit;
}
