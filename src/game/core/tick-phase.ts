/**
 * Tick phases — the declared execution order of tick systems.
 *
 * Every tick system is registered with a phase. Each tick, systems run in ascending
 * phase order. Within one phase, systems run in registration order (for feature systems:
 * feature load order, then the order of the feature's `systems` array). Phases are what
 * pin simulation order — reordering `FeatureRegistry.loadAll([...])` or adding a feature
 * dependency only affects systems that share a phase.
 *
 * Changing this order changes simulation results (determinism, replays). The full
 * expected sequence is asserted by `tests/unit/core/tick-order.spec.ts`.
 *
 * The enum's member name doubles as the debug display label (features panel, error labels).
 */

import type { TickSystem } from './tick-system';

export enum TickPhase {
    /** Deferred callbacks scheduled for this tick (TickScheduler) — runs before anything moves. */
    Scheduler,
    /** Unit movement along paths (MovementSystem). */
    Movement,
    /** Building overlay animations. */
    BuildingOverlays,
    /** Construction progress, residence spawning, construction material requests. */
    Construction,
    /** Unit combat and death angels. */
    Combat,
    /** Settler job/task execution (SettlerTaskSystem). */
    SettlerTasks,
    /** Tree and crop growth. */
    Nature,
    /** Ore resource sign lifetimes. */
    ResourceSigns,
    /** Carrier → specialist recruitment. */
    Recruitment,
    /** Building material request generation. */
    MaterialRequests,
    /** Carrier transport job dispatch (LogisticsDispatcher). */
    Logistics,
    /** Barracks training, garrisons, tower combat, sieges. */
    Military,
    /** Worker/tool demand for buildings and construction sites. */
    Demand,
    /** Victory/defeat evaluation. */
    Victory,
    /** AI players. */
    AI,
    /** Lua map scripts (registered asynchronously after game start). */
    Scripting,
}

/** A tick system paired with the phase it runs in. */
export interface PhasedTickSystem {
    readonly system: TickSystem;
    readonly phase: TickPhase;
}

/** Display label for a phase (the enum member name). */
export function tickPhaseLabel(phase: TickPhase): string {
    return TickPhase[phase];
}

/**
 * Insert `entry` into `list` (kept sorted by phase) after all entries of the same or an
 * earlier phase — i.e. a stable insertion that preserves registration order within a phase.
 */
export function insertByTickPhase<T extends { readonly phase: TickPhase }>(list: T[], entry: T): void {
    let index = list.length;
    while (index > 0 && list[index - 1]!.phase > entry.phase) {
        index--;
    }
    list.splice(index, 0, entry);
}
