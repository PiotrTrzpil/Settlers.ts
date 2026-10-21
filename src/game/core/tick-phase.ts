/**
 * Tick phases — the declared execution order of tick systems.
 *
 * Every tick system is registered with a phase. Each tick, systems run in ascending
 * phase order. Within one phase, systems run in registration order (for feature systems:
 * feature load order, then the order of the feature's `systems` array). Phases are what
 * pin simulation order — reordering `FeatureRegistry.loadAll([...])` or adding a feature
 * dependency only affects systems that share a phase. When two systems from different
 * features must run in a fixed relative order, give them distinct phases instead of
 * relying on load order.
 *
 * A feature declares a default `tickPhase` for its systems; an individual system can run
 * in another phase via a `{ system, phase }` entry in the feature's `systems` array.
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
    /** Construction progress, residence spawning, construction material requests (building-construction). */
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
    /** Worker/tool demand for operational buildings (BuildingDemandSystem). */
    Demand,
    /** Digger/builder demand for construction sites (ConstructionSiteDemandSystem) — after building demand. */
    ConstructionDemand,
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

/** A feature `systems` entry: a bare system (runs in the feature's `tickPhase`) or a system with its own phase. */
export type FeatureTickSystem = TickSystem | PhasedTickSystem;

/** True when the entry carries its own phase (`{ system, phase }`), false for a bare TickSystem. */
export function isPhasedTickSystem(entry: FeatureTickSystem): entry is PhasedTickSystem {
    return 'system' in entry && 'phase' in entry;
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
