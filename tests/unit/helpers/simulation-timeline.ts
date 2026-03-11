/**
 * Timeline auto-wiring for the Simulation harness.
 *
 * Intercepts EventBus.emit() and records every event to a TimelineRecorder,
 * extracting structured fields (entity IDs, positions, types) into dedicated
 * columns for efficient querying.
 *
 * This is internal plumbing — tests never import from this file directly.
 */

import { EventBus, type GameEvents } from '@/game/event-bus';
import { EntityType, UnitType } from '@/game/entity';
import { BuildingType } from '@/game/buildings/building-type';
import { EMaterialType } from '@/game/economy/material-type';
import { EventFmt } from '@/game/debug/event-formatting';
import type { TimelineRecorder, TimelineCategory } from './timeline-recorder';
import type { InventorySlot } from '@/game/systems/inventory/inventory-slot';

// ─── Formatting helpers ──────────────────────────────────────────

export function formatSlots(slots: InventorySlot[]): string {
    const parts: string[] = [];
    for (const slot of slots) {
        if (slot.currentAmount > 0 || slot.reservedAmount > 0) {
            const res = slot.reservedAmount > 0 ? `(r${slot.reservedAmount})` : '';
            parts.push(`${EMaterialType[slot.materialType]}×${slot.currentAmount}${res}`);
        }
    }
    return parts.join(',');
}

// ─── Category mapping ────────────────────────────────────────────

/** Map event namespace to timeline category (unmapped namespaces use the namespace itself). */
const CATEGORY_MAP: Record<string, TimelineCategory> = {
    building: 'building',
    unit: 'unit',
    settler: 'unit',
    carrier: 'carrier',
    inventory: 'inventory',
    logistics: 'logistics',
    entity: 'world',
    terrain: 'world',
    tree: 'world',
    crop: 'world',
    movement: 'movement',
    choreo: 'unit',
    combat: 'combat',
    'settler-location': 'unit',
    recruitment: 'unit',
    construction: 'building',
    production: 'building',
    barracks: 'building',
    garrison: 'building',
    pile: 'inventory',
    storage: 'inventory',
};

/** Entity ID field priority — first match wins. Paired with inferred entity type. */
const ENTITY_ID_KEYS: readonly { key: string; type: string }[] = [
    { key: 'unitId', type: 'Unit' },
    { key: 'buildingId', type: 'Building' },
    { key: 'entityId', type: '' }, // generic fallback (entity:*, tree:*, crop:*, pile:*)
];

/** Infer entity type from timeline category when entityId key didn't provide one. */
const CATEGORY_ENTITY_TYPE: Record<string, string> = {
    unit: 'Unit',
    building: 'Building',
    carrier: 'Unit',
};

/** Extract numeric field from payload by name, with fallback keys. */
function extractNum(payload: Record<string, unknown>, ...keys: string[]): number | undefined {
    for (const key of keys) {
        if (typeof payload[key] === 'number') return payload[key] as number;
    }
    return undefined;
}

/** Keys explicitly extracted into dedicated columns — excluded from `meta`. */
const EXTRACTED_KEYS = new Set([
    'unitId',
    'buildingId',
    'entityId',
    'player',
    'x',
    'y',
    'level',
    'unitType',
    'buildingType',
]);

/** Collect remaining payload fields as a JSON string, or undefined if empty. */
function buildMeta(payload: Record<string, unknown>, extracted: Set<string>): string | undefined {
    const rest: Record<string, unknown> = {};
    let hasKeys = false;
    for (const key of Object.keys(payload)) {
        if (!extracted.has(key)) {
            rest[key] = payload[key];
            hasKeys = true;
        }
    }
    return hasKeys ? JSON.stringify(rest) : undefined;
}

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
        recordTimelineEvent(timeline, getTickCount(), event as string, payload as Record<string, unknown>);
        return origEmit(event, payload);
    }) as typeof eventBus.emit;
}

function recordTimelineEvent(
    timeline: TimelineRecorder,
    tick: number,
    event: string,
    payload: Record<string, unknown>
): void {
    const colonIdx = event.indexOf(':');
    const namespace = colonIdx >= 0 ? event.slice(0, colonIdx) : event;
    const action = colonIdx >= 0 ? event.slice(colonIdx + 1) : event;

    const category = (CATEGORY_MAP[namespace] ?? namespace) as TimelineCategory;
    const label = action.replace(/[A-Z]/g, m => '_' + m.toLowerCase());

    // Extract structured fields from payload
    let entityId: number | undefined;
    let entityType: string | undefined;
    for (const { key, type } of ENTITY_ID_KEYS) {
        if (typeof payload[key] === 'number') {
            entityId = payload[key] as number;
            entityType = type || CATEGORY_ENTITY_TYPE[category] || undefined;
            break;
        }
    }
    const unitId = extractNum(payload, 'unitId');
    const buildingId = extractNum(payload, 'buildingId');
    const player = extractNum(payload, 'player');
    const x = extractNum(payload, 'x');
    const y = extractNum(payload, 'y');
    const level = typeof payload['level'] === 'string' ? payload['level'] : undefined;
    const rawEntityType = extractNum(payload, 'entityType');
    const rawUnitType = extractNum(payload, 'unitType');
    const rawBuildingType = extractNum(payload, 'buildingType');
    if (!entityType && rawEntityType !== undefined) {
        entityType = EntityType[rawEntityType];
    }
    const unitType = rawUnitType !== undefined ? UnitType[rawUnitType] : undefined;
    const buildingType = rawBuildingType !== undefined ? BuildingType[rawBuildingType] : undefined;

    // Use inventory slotType as label (preserves input/output distinction)
    const finalLabel = event === 'inventory:changed' ? (payload['slotType'] as string) : label;

    // Format using EventFmt when available, fall back to JSON
    const formatter = EventFmt[event as keyof typeof EventFmt] as ((e: unknown) => string) | undefined;
    const detail = formatter ? formatter(payload) : JSON.stringify(payload);

    // Collect remaining payload fields not explicitly extracted into `meta`
    const meta = buildMeta(payload, EXTRACTED_KEYS);

    timeline.record({
        tick,
        category,
        entityId,
        entityType,
        unitId,
        buildingId,
        player,
        x,
        y,
        event: finalLabel,
        detail,
        level,
        unitType,
        buildingType,
        meta,
    });
}
