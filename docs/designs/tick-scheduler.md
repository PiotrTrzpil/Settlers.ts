# TickScheduler — Design

## Overview

A priority-queue-based deferred callback system that replaces per-tick cooldown counters and tick accumulators across the codebase. Systems schedule work N ticks in the future; the scheduler drains due callbacks each tick with zero cost for sleeping entries.

## Current State

- **Cooldown counters**: `idleSearchCooldown` in UnitRuntime is decremented every tick per idle settler. 200 idle settlers = 200 decrements/tick for no work.
- **Tick accumulators**: `AutoGarrisonSystem`, `BuildingSiegeSystem`, and `SettlerTaskSystem` (orphan check) use `tickCounter++; if (counter < N) return;` patterns.
- **What stays**: The `TickSystem` interface and `GameLoop` registration are unchanged. Systems still implement `tick(dt)`.
- **What changes**: Cooldown/accumulator patterns get replaced with `scheduler.schedule(N, callback)` calls. The per-unit `idleSearchCooldown` field becomes a scheduler entry instead of a hot-loop decrement.

## Summary for Review

- **Interpretation**: Build a standalone TickScheduler that lives in `src/game/systems/` as infrastructure. It implements `TickSystem`, is registered in GameLoop, and is injected into features that need deferred callbacks. No persistence — scheduled callbacks are transient (features re-schedule on load).
- **Key decisions**: Uses a monotonic tick counter (not `dt`-based time) for determinism. The scheduler's `tick()` increments its own counter — no global tick counter needed. Callbacks are grouped by target tick in a `Map<tick, callback[]>` (O(1) lookup) rather than a heap (simpler, same perf for the access pattern). Handles are opaque numbers for cancellation.
- **Assumptions**: Callbacks are fire-once (not recurring). Recurring patterns call `schedule()` again at the end of their callback. Callbacks run synchronously within the tick. No persistence needed — features re-establish their schedules on init/load.
- **Scope**: Subsystem 1 builds the scheduler. Subsystem 2 migrates existing tick-accumulator systems. Per-unit idle cooldown migration (subsystem 3) is the highest-value change but touches the most code.

## Conventions

- Optimistic programming: no `?.` or `?? fallback` on required deps. Throw with context.
- Config interface for 3+ constructor params.
- Deterministic iteration: sort entity IDs before processing.
- Systems in `src/game/systems/` must not import from `src/game/features/`.
- `TickSystem` interface: `tick(dt: number): void`, optional `onEntityRemoved`, `destroy`.
- Readonly return types for queries.

## Architecture

### Subsystems

| # | Subsystem | Responsibility | Depends On | Files |
|---|-----------|---------------|------------|-------|
| 1 | TickScheduler core | Priority queue, schedule/cancel API, tick drain | — | `src/game/systems/tick-scheduler.ts` |
| 2 | System-level migration | Replace tick accumulators in AutoGarrison, BuildingSiege, SettlerTask orphan check | 1 | Modified system files |
| 3 | Per-unit idle cooldown migration | Replace `idleSearchCooldown` decrement loop with scheduler entries | 1 | `settler-task-system.ts`, `unit-state-machine.ts` |
| 4 | Wiring | Instantiate in GameServices, inject into features | 1 | `game-services.ts` |
| 5 | Tests | Unit tests for scheduler, integration test for migration | 1 | `tests/unit/systems/tick-scheduler.spec.ts` |

## Shared Contracts

```typescript
/** Opaque handle returned by schedule(), used for cancellation. */
export type ScheduleHandle = number;

/** Sentinel value for "no scheduled callback". */
export const NO_HANDLE: ScheduleHandle = 0;

export class TickScheduler implements TickSystem {
    /** Schedule a callback to fire after `delayTicks` ticks (minimum 1). */
    schedule(delayTicks: number, callback: () => void): ScheduleHandle;

    /** Cancel a pending callback. No-op if already fired or invalid handle. */
    cancel(handle: ScheduleHandle): void;

    /** Returns true if the handle refers to a still-pending callback. */
    isPending(handle: ScheduleHandle): boolean;

    /** Current monotonic tick count (for debugging / diagnostics). */
    get currentTick(): number;

    // TickSystem
    tick(dt: number): void;
    onEntityRemoved?(entityId: number): void;
    destroy(): void;
}
```

## Subsystem Details

### 1. TickScheduler core
**Files**: `src/game/systems/tick-scheduler.ts`
**Key decisions**:
- Internal storage: `Map<number, Array<{ handle: ScheduleHandle; callback: () => void }>>` keyed by absolute target tick. This is O(1) per drain tick — no heap extraction needed since we always drain the current tick.
- `Set<ScheduleHandle>` for cancelled handles (tombstone approach). On drain, skip cancelled entries and clean the set.
- Handle counter starts at 1 (0 is `NO_HANDLE` sentinel).
- `delayTicks` minimum is 1 — scheduling for "this tick" (delay 0) is disallowed to prevent infinite loops of callbacks scheduling more callbacks in the same tick.
- Callbacks that throw are caught and logged (don't break the drain loop), matching GameLoop's error isolation pattern.
- `onEntityRemoved` is a no-op — the scheduler doesn't track entity ownership. Features cancel their own handles when entities are removed.
- `destroy()` clears all internal state.

### 2. System-level migration
**Files**: Modified files only
**Depends on**: Subsystem 1, 4
**Key decisions**:
- `AutoGarrisonSystem`: Remove `tickAccumulator`. In constructor (or an init method), schedule the first scan. At end of `runScan()`, schedule the next one: `this.scanHandle = scheduler.schedule(SCAN_INTERVAL_TICKS, () => this.runScanAndReschedule())`.
- `BuildingSiegeSystem`: Same pattern — replace `tickCounter` with recurring self-schedule.
- `SettlerTaskSystem` orphan check (`ORPHAN_CHECK_INTERVAL = 60`): Same pattern.
- All three already have their logic in a separate method (`runScan`, etc.), so the refactor is mechanical: delete counter field, delete counter logic from `tick()`, add schedule call.

### 3. Per-unit idle cooldown migration
**Files**: `src/game/features/settler-tasks/settler-task-system.ts`, `src/game/features/settler-tasks/unit-state-machine.ts`
**Depends on**: Subsystem 1, 4
**Key decisions**:
- Remove `idleSearchCooldown` field from `UnitRuntime`. Instead, when a settler becomes idle after work or is created, call `scheduler.schedule(IDLE_SEARCH_COOLDOWN, () => markReadyForSearch(settlerId))`.
- The state machine's `updateSettler` for IDLE state changes from "decrement cooldown, if 0 search" to "if marked ready, search". The "marked ready" flag is a simple boolean or the absence of a pending handle.
- On entity removal, cancel the pending handle. Store `Map<entityId, ScheduleHandle>` in SettlerTaskSystem for cleanup.
- Initial stagger is preserved: currently `entityId % IDLE_SEARCH_COOLDOWN` offsets the initial cooldown. With the scheduler, schedule with `entityId % IDLE_SEARCH_COOLDOWN` as the initial delay.

### 4. Wiring
**Files**: `src/game/game-services.ts`
**Key decisions**:
- Create `TickScheduler` early in GameServices (it has no dependencies).
- Register with `featureRegistry.registerSystem(tickScheduler, 'Core')`.
- Expose as a property: `get tickScheduler(): TickScheduler`.
- Pass into feature configs that need it (SettlerTaskSystem, AutoGarrisonSystem, BuildingSiegeSystem configs gain a `tickScheduler` field).

### 5. Tests
**Files**: `tests/unit/systems/tick-scheduler.spec.ts`
**Key decisions**:
- Pure unit tests (no game state needed): schedule, cancel, drain ordering, delay=0 rejection, callback-throws-doesnt-break-drain, handle reuse safety, `isPending` correctness.
- One integration-style test using TestSimulation: verify that a system using the scheduler fires its callback at the right tick.

## File Map

### New Files
| File | Subsystem | Purpose |
|------|-----------|---------|
| `src/game/systems/tick-scheduler.ts` | 1 | TickScheduler class |
| `tests/unit/systems/tick-scheduler.spec.ts` | 5 | Unit tests |

### Modified Files
| File | Change |
|------|--------|
| `src/game/game-services.ts` | Instantiate TickScheduler, expose property, pass to features |
| `src/game/features/tower-garrison/tower-garrison-auto-system.ts` | Replace tickAccumulator with scheduler |
| `src/game/features/building-siege/building-siege-system.ts` | Replace tickCounter with scheduler |
| `src/game/features/settler-tasks/settler-task-system.ts` | Replace orphan check counter, wire idle cooldown via scheduler |
| `src/game/features/settler-tasks/unit-state-machine.ts` | Remove `idleSearchCooldown` decrement, use scheduler-driven flag |

## Verification
- Schedule a callback with delay 5 → fires on tick 5, not before
- Cancel a handle → callback never fires
- Schedule 3 callbacks for the same tick → all fire in insertion order
- Callback that throws → remaining callbacks for that tick still fire
- AutoGarrisonSystem scans every 30 ticks (same behavior, no accumulator field)
- 200 idle settlers with staggered cooldowns → only ~20 search per tick (same distribution as before)
