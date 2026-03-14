# Settler-Tasks ↔ Logistics Decoupling — Design

## Overview

Rearchitect the settler-tasks / logistics boundary so neither module imports the other. Today they have a bidirectional dependency: logistics reaches into settler-tasks for job assignment + worker state queries, and settler-tasks reaches into logistics for transport job lifecycle operations. The fix is structural — move transport choreography ownership to logistics and replace global `TransportJobOps` injection with per-job lifecycle hooks on `ChoreoJobState`.

## Current State

### What exists

Two feature modules with a circular dependency mediated by late binding:

**Logistics → settler-tasks** (13 call sites):
- `assignJob(carrierId, job, moveTo)` — dispatch a transport choreography to a carrier
- `getPositionResolver()` — resolve pile positions when building transport jobs
- `setTransportJobOps(ops)` — inject transport lifecycle callbacks back into settler-tasks
- `getActiveJobId()`, `getSettlerState()`, `getAssignedBuilding()`, `getWorkersForBuilding()` — diagnostics only

**Settler-tasks → logistics** (via injected `TransportJobOps`):
- Transport executors (`transport-executors.ts`) call `transportJobOps.getJob()`, `.pickUp()`, `.deliver()` during choreography execution
- `interruptJob()` calls `transportJobOps.cancel(job.transportData.jobId)` — transport-specific cleanup hardcoded in the generic task executor
- Type import: `TransportJobRecord` in `choreo-types.ts` (for `TransportJobOps` interface)

### What's wrong

1. **Transport-specific code lives in the generic task executor.** `WorkerJobLifecycle.interruptJob()` has `if (job.transportData) { this.transportJobOps.cancel(...) }` — the generic task system shouldn't know about transport jobs.

2. **Global injection for per-job concerns.** `TransportJobOps` is a single global object injected into `SettlerTaskSystem` via `setTransportJobOps()`, then threaded through `WorkerTaskExecutor` → `WorkerJobLifecycle` and `InventoryExecutorContext`. But transport ops are specific to each job — different jobs reference different transport records.

3. **Transport executors are registered from settler-tasks** but semantically belong to logistics — they're the choreography implementation of "move material from A to B," which is logistics' core responsibility.

4. **`SettlerTaskSystem` class leaks** into logistics. Diagnostics code (`logistics-snapshot.ts`, `bottleneck-detection.ts`) and feature wiring depend on the concrete class instead of narrow interfaces.

### What stays vs changes

- **Stays**: All runtime behavior, choreography execution model, ChoreoSystem plugin architecture, event-based lifecycle notifications
- **Changes**: Where transport executors live, how transport lifecycle is accessed, how logistics references settler-tasks

## Summary for Review

- **Interpretation**: Rearchitect so settler-tasks is a generic task execution engine with no transport knowledge, and logistics owns everything transport-specific including choreography executors.

- **Key decisions**:
  - Add a generic `onCancel` callback to `ChoreoJobState` — replaces the transport-specific cancel in `interruptJob` with a feature-agnostic hook
  - Add `ops: TransportOps` to `TransportData` — per-job lifecycle closures replace the global `TransportJobOps` injection. Logistics attaches closures when building transport jobs.
  - Move transport executor registration from settler-tasks to logistics — `LogisticsDispatcherFeature` registers `TRANSPORT_*` executors on `ChoreoSystem`, just like recruit-feature registers `TRANSFORM_*` executors
  - Extract `TaskDispatcher` and `WorkerStateQuery` interfaces — logistics depends on narrow interfaces, not the `SettlerTaskSystem` class

- **Assumptions**: Transport executors (`transport-executors.ts`) can move to logistics and still access `InventoryExecutorContext` deps (inventoryManager, materialTransfer, eventBus, constructionSiteManager) from feature context — these are all available in `LogisticsDispatcherFeature.create()`.

- **Scope**: Structural refactoring only — no behavioral changes. Transport jobs work identically, just wired differently.

## Conventions

- Feature modules import only from `index.ts` of other features
- `internal/` is private — never imported externally
- ChoreoSystem is the plugin registry — features register executors as closures capturing deps
- Optimistic programming: no optional chaining on required deps, fail loudly
- Config object pattern for 3+ constructor deps

## Architecture

### Subsystems

| # | Subsystem | Responsibility | Depends On | Files |
|---|-----------|---------------|------------|-------|
| 1 | Job lifecycle hooks | Add `onCancel` to `ChoreoJobState`, `TransportOps` to `TransportData` | — | `systems/choreo/types.ts` |
| 2 | Transport executor migration | Move transport executors to logistics, register from feature | 1 | logistics files |
| 3 | Settler-tasks cleanup | Remove `TransportJobOps`, transport-specific code, extract interfaces | 1 | settler-tasks files |
| 4 | Logistics wiring update | Build transport ops closures per-job, register executors, use interfaces | 1, 2, 3 | logistics feature files |
| 5 | Diagnostics decoupling | Use `WorkerStateQuery` interface instead of `SettlerTaskSystem` class | 3 | logistics snapshot/bottleneck files |

## Shared Contracts

```typescript
// ── systems/choreo/types.ts — additions ────────────────────────

/** Per-job lifecycle operations for carrier transport — attached as closures by the job creator. */
export interface TransportOps {
    /** Check if the transport job still exists (not cancelled externally). */
    isValid(): boolean;
    /** Transition job to picked-up phase. Returns false if job was cancelled. */
    pickUp(): boolean;
    /** Transition job to delivered phase. Returns false if job was cancelled. */
    deliver(): boolean;
}

// Add to existing TransportData interface:
export interface TransportData {
    // ...existing data fields (jobId, sourceBuildingId, destBuildingId, material, amount, sourcePos, destPos, slotId)...
    /** Lifecycle operations — closures over the specific TransportJobRecord, set by the job builder. */
    ops: TransportOps;
}

// Add to existing ChoreoJobState interface:
export interface ChoreoJobState {
    // ...existing fields...
    /** Called when the job is interrupted/cancelled. Feature-provided cleanup hook. */
    onCancel?: () => void;
}


// ── settler-tasks exports — new interfaces ─────────────────────

/** Narrow interface for assigning tasks to units. Used by logistics, building-demand, siege, etc. */
export interface TaskDispatcher {
    assignJob(entityId: number, job: ChoreoJobState, moveTo?: { x: number; y: number }): boolean;
    assignMoveTask(entityId: number, targetX: number, targetY: number): boolean;
    assignWorkerToBuilding(settlerId: number, buildingId: number): void;
    releaseWorkerAssignment(settlerId: number): void;
    findIdleSpecialist(unitType: UnitType, player: number, nearX: number, nearY: number): number | null;
}

/** Narrow read-only interface for querying worker state. Used by logistics diagnostics. */
export interface WorkerStateQuery {
    getActiveJobId(entityId: number): string | null;
    getSettlerState(entityId: number): SettlerState | null;
    getAssignedBuilding(settlerId: number): number | null;
    getWorkersForBuilding(buildingId: number): ReadonlySet<number>;
}

/** Position resolver for pile locations. Used by logistics TransportJobBuilder. */
// NOTE: TransportPositionResolver already exists in logistics/transport-job-builder.ts — keep it there.
```

## Subsystem Details

### 1. Job lifecycle hooks
**Files**: `src/game/systems/choreo/types.ts`
**Key decisions**:
- `TransportOps` is added to `TransportData` (not to `ChoreoJobState`) because it's transport-specific. Other future job types that need lifecycle hooks use `onCancel` on `ChoreoJobState` for generic cleanup.
- `onCancel` is generic — any feature can attach cleanup logic to any job. This replaces the `if (job.transportData) { cancel... }` pattern in `interruptJob`.
- No `cancel()` in `TransportOps` — cancellation from the settler-tasks side goes through the generic `onCancel` hook. `TransportOps` only has methods executors call during normal flow.
- Closures are fine — `ChoreoJobState` is transient (not persisted; `cancelReservedJobs()` is called on restore).

### 2. Transport executor migration
**Files**: Move `src/game/features/settler-tasks/internal/transport-executors.ts` → `src/game/features/logistics/internal/transport-executors.ts`

**Key decisions**:
- Transport executors stop using `ctx.transportJobOps.*` — they call `requireTransportData(job).ops.*` instead (existing pattern, throws if missing — no `!` needed). This removes the need for `TransportJobOps` on any context object.
- Transport executors still need `InventoryExecutorContext` deps (inventoryManager, materialTransfer, eventBus, constructionSiteManager). Two options:
  - **Option A**: Define a `TransportExecutorContext` in logistics with just what's needed, build it in `LogisticsDispatcherFeature.create()`, and capture it in the executor closures at registration time. This is the **cleaner approach** because transport executors don't need `getWorkerHomeBuilding` or the full `InventoryExecutorContext`.
  - **Option B**: Import `InventoryExecutorContext` from settler-tasks. Defeats the purpose.
  - **Choose Option A.**
- Registration moves from `registerCoreExecutors()` in `choreo-executors.ts` to `LogisticsDispatcherFeature.create()`, mirroring how recruit-feature registers `TRANSFORM_*` executors.
- Movement context for `TRANSPORT_GO_TO_SOURCE/DEST` — these use `moveToPosition` from settler-tasks. The `moveToPosition` function only needs `MovementContext` (gameState, buildingPositionResolver, handlerErrorLogger). Either:
  - Extract `moveToPosition` to `systems/choreo/` (it's a generic hex movement helper)
  - Or import it from settler-tasks (acceptable — it's a stateless utility, not a coupling concern)
  - **Choose**: extract to `systems/movement/` or re-export from settler-tasks as a utility. Decision deferred to implementation — either works.

### 3. Settler-tasks cleanup
**Files**: `settler-task-system.ts`, `choreo-types.ts`, `worker-task-executor.ts`, `worker-job-lifecycle.ts`, `choreo-executors.ts`, `types.ts`, `index.ts`

**Key decisions**:
- **Remove `TransportJobOps` entirely** from settler-tasks. Delete the interface from `choreo-types.ts`, the proxy in `SettlerTaskSystem` constructor, the `setTransportJobOps()` method, and the `_transportJobOps` field.
- **Remove `TransportJobOps` from `InventoryExecutorContext`** — executors that need transport ops use `job.transportData.ops` directly. Non-transport inventory executors (GET_GOOD, PUT_GOOD, etc.) are unaffected.
- **Replace transport-specific cancel in `interruptJob`**:
  ```typescript
  // BEFORE (transport-specific):
  if (job.transportData) {
      this.transportJobOps.cancel(job.transportData.jobId);
  }

  // AFTER (generic):
  job.onCancel?.();
  ```
- **Remove `TransportJobRecord` import** from `choreo-types.ts` — no longer needed.
- **Add `implements TaskDispatcher, WorkerStateQuery`** to `SettlerTaskSystem` — it already has all methods.
- **Export `TaskDispatcher` and `WorkerStateQuery`** from settler-tasks index.
- **Remove transport executor registrations** from `registerCoreExecutors()`.
- **`SettlerState`**: stays in `settler-tasks/types.ts`. The diagnostics code imports it — this is a type/enum import, not a structural coupling. Moving it to `core/` is optional polish.

### 4. Logistics wiring update
**Files**: `logistics-dispatcher-feature.ts`, `logistics-dispatcher.ts`, `transport-job-builder.ts`, `carrier-assigner.ts`, `pre-assignment-queue.ts`

**Key decisions**:
- **`TransportJobBuilder.build()` attaches `TransportOps` closures and `onCancel`**. It needs access to the job store and transport deps to create closures that capture the specific `record.id`:
  ```typescript
  // In TransportJobBuilder.build(record):
  const ops: TransportOps = {
      isValid: () => findJobById(this.jobStore, record.id) !== undefined,
      pickUp: () => { /* find record, call TransportJobService.pickUp */ },
      deliver: () => { /* find record, call TransportJobService.deliver */ },
  };
  job.transportData.ops = ops;  // transportData is set on the line above by choreo builder
  job.onCancel = () => { /* find record, call TransportJobService.cancel */ };
  ```
- **Expand `TransportJobBuilderConfig`** to include `jobStore` and `transportJobDeps` (or pass a closure factory).
- **Remove `createTransportJobOps()`** from `LogisticsDispatcher` — no longer needed.
- **Remove `setTransportJobOps()` call** from `LogisticsDispatcherFeature.create()`.
- **Register transport executors** in `LogisticsDispatcherFeature.create()`:
  ```typescript
  const transportCtx: TransportExecutorContext = {
      inventoryManager,
      materialTransfer,
      eventBus: ctx.eventBus,
      constructionSiteManager,
  };
  registerTransportExecutors(choreoSystem, movementCtx, transportCtx);
  ```
- **Use `TaskDispatcher` interface** instead of `SettlerTaskSystem` class. The `JobAssigner` interface in `carrier-assigner.ts` stays (it's a subset of `TaskDispatcher` — just `assignJob`).
- **`LogisticsDispatcherFeature` needs `ChoreoSystem` and `MovementContext`** (or builds its own movement context from available deps). Getting `ChoreoSystem` is easy — it's exported by settler-tasks. Getting `MovementContext` — logistics can build its own from `gameState`, `buildingPositionResolver` (via `TransportPositionResolver`), and a throttled logger.
- **`JobState` alias** — logistics files import `ChoreoJobState` directly from `systems/choreo` instead of `JobState` from settler-tasks.

### 5. Diagnostics decoupling
**Files**: `logistics-snapshot.ts`, `bottleneck-detection.ts`

**Key decisions**:
- `SnapshotConfig.settlerTaskSystem` → `workerStateQuery: WorkerStateQuery`
- `bottleneck-detection.ts` imports `SettlerState` from settler-tasks (enum value) — this is acceptable (enums are leaf dependencies). Alternatively, `WorkerStateQuery` could return a string and avoid the enum import.
- `logistics-dispatcher-feature.ts`: get settler-tasks exports, cast to `TaskDispatcher` and `WorkerStateQuery` interfaces.

## File Map

### New Files
| File | Subsystem | Purpose |
|------|-----------|---------|
| `src/game/features/logistics/internal/transport-executors.ts` | 2 | Transport choreography executors (moved from settler-tasks) |
| `src/game/features/logistics/internal/transport-executor-context.ts` | 2 | Context type + registration function for transport executors |

### Modified Files
| File | Change |
|------|--------|
| `src/game/systems/choreo/types.ts` | Add `TransportOps` interface, add `ops` to `TransportData`, add `onCancel` to `ChoreoJobState` |
| `src/game/features/settler-tasks/choreo-types.ts` | Remove `TransportJobOps` interface, remove `TransportJobRecord` import, remove `transportJobOps` from `InventoryExecutorContext` |
| `src/game/features/settler-tasks/settler-task-system.ts` | Remove `_transportJobOps`, `setTransportJobOps()`, proxy in constructor. Add `implements TaskDispatcher, WorkerStateQuery` |
| `src/game/features/settler-tasks/worker-task-executor.ts` | Remove `transportJobOps` from config and context wiring |
| `src/game/features/settler-tasks/internal/worker-job-lifecycle.ts` | Replace `if (job.transportData) transportJobOps.cancel(...)` with `job.onCancel?.()`. Remove `transportJobOps` field |
| `src/game/features/settler-tasks/choreo-executors.ts` | Remove transport executor imports and registrations |
| `src/game/features/settler-tasks/types.ts` | Export `TaskDispatcher` and `WorkerStateQuery` interfaces |
| `src/game/features/settler-tasks/index.ts` | Export `TaskDispatcher`, `WorkerStateQuery` |
| `src/game/features/logistics/transport-job-builder.ts` | Attach `TransportOps` closures and `onCancel` to built jobs |
| `src/game/features/logistics/logistics-dispatcher.ts` | Remove `createTransportJobOps()`. Remove `TransportJobOps` import |
| `src/game/features/logistics/logistics-dispatcher-feature.ts` | Remove `setTransportJobOps()` call. Register transport executors on ChoreoSystem. Use `TaskDispatcher` interface |
| `src/game/features/logistics/carrier-assigner.ts` | Import `ChoreoJobState` from `systems/choreo` instead of `JobState` from settler-tasks |
| `src/game/features/logistics/pre-assignment-queue.ts` | Same — use `ChoreoJobState` directly |
| `src/game/features/logistics/logistics-snapshot.ts` | Use `WorkerStateQuery` instead of `SettlerTaskSystem` |
| `src/game/features/logistics/bottleneck-detection.ts` | Use `WorkerStateQuery` instead of `SettlerTaskSystem` |
| `src/game/features/settler-tasks/internal/transport-executors.ts` | Delete (moved to logistics) |

### Files NOT changed
| File | Reason |
|------|--------|
| `src/game/features/settler-tasks/settler-tasks-feature.ts` | No transport deps to remove — `TransportJobOps` was injected later by logistics |
| `src/game/features/settler-tasks/internal/inventory-executors.ts` | Non-transport inventory executors stay. They use `InventoryExecutorContext` but don't need `transportJobOps` |

## Verification

- `pnpm lint` passes — no type errors, no circular import warnings
- `pnpm test:unit` passes — no behavioral changes
- Grep: no file in `settler-tasks/` imports from `logistics/` (zero reverse dependency)
- Grep: no file in `logistics/` imports `SettlerTaskSystem` class (uses interfaces only)
- Grep: `TransportJobOps` does not appear anywhere (deleted entirely)
- Grep: `setTransportJobOps` does not appear anywhere (deleted entirely)
- E2e: carriers still pick up and deliver materials correctly
