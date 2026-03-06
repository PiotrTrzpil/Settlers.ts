# Transport & Task Persistence Design

Removes closure-based coupling between logistics and choreography, making both SettlerTaskSystem and LogisticsDispatcher fully persistable.

## Problem

`TransportData.callbacks` embeds three closures that capture a live `TransportJob` instance. This is the sole reason `ChoreoJobState` (and therefore `UnitRuntime`) is not serializable. `TransportJob` itself holds a `RequestFulfillment` state machine with live manager references, making it non-serializable too.

Everything else in both systems is already pure data.

## Solution Overview

1. **Replace callbacks with a job ID** — `TransportData` stores a `jobId: number` instead of closures. Transport executors resolve the live job via the dispatcher at call time.
2. **Split TransportJob into data + operations** — The mutable data becomes a flat record (`TransportJobRecord`). Lifecycle operations (`pickUp`, `deliver`, `cancel`) become methods on a stateless service that takes the record + manager deps.
3. **Persist both systems** — `UnitRuntime` is 100% serializable after step 1. `TransportJobRecord` + `InventoryReservation[]` are flat data after step 2.

## Coding Conventions

- Read `docs/optimistic.md` — optimistic programming is mandatory
- Read `docs/design-rules.md` — architecture patterns
- Use `getEntityOrThrow(id, 'context')` not `getEntity(id)!`
- No optional chaining on required deps
- Max 140 chars per line (TS)

## Shared Contracts

### TransportJobRecord (replaces TransportJob class)

Write to: `src/game/features/logistics/transport-job-record.ts`

```typescript
import type { EMaterialType } from '../../economy/material-type';

export enum TransportPhase {
    /** Inventory reserved, carrier en route to pickup */
    Reserved = 'reserved',
    /** Carrier picked up material, en route to delivery */
    PickedUp = 'picked-up',
    /** Cancelled — reservation released, request reset */
    Cancelled = 'cancelled',
    /** Delivered — request fulfilled */
    Delivered = 'delivered',
}

/** Flat, serializable transport job record. No closures, no manager refs. */
export interface TransportJobRecord {
    readonly id: number;
    readonly requestId: number;
    sourceBuilding: number;       // mutable: can be redirected
    readonly destBuilding: number;
    readonly material: EMaterialType;
    readonly amount: number;
    readonly carrierId: number;
    phase: TransportPhase;
}
```

### Updated TransportData (replaces callbacks with jobId)

In `src/game/features/settler-tasks/choreo-types.ts`, replace:

```typescript
// BEFORE
interface TransportData {
    callbacks: TransportCallbacks;
    sourceBuildingId: number;
    ...
}

// AFTER
interface TransportData {
    jobId: number;           // resolves to TransportJobRecord via dispatcher
    sourceBuildingId: number;
    ...
}
```

Remove the `TransportCallbacks` interface entirely.

### TransportJobOps (injected into executor context)

```typescript
/** Transport job lifecycle operations — injected into executor context. */
interface TransportJobOps {
    getJob(jobId: number): TransportJobRecord | undefined;
    pickUp(jobId: number): void;
    deliver(jobId: number): void;
    cancel(jobId: number): void;
}
```

Created by LogisticsDispatcher (which owns the activeJobs map and the service deps) and passed into SettlerTaskSystem. Thin lookup + delegation layer, not a closure over a specific job.

### TransportJobService (stateless lifecycle operations)

Write to: `src/game/features/logistics/transport-job-service.ts`

Stateless service that performs lifecycle transitions on `TransportJobRecord`. Takes manager deps as parameters (not stored as fields). Methods:

- `activate(requestId, sourceBuilding, destBuilding, material, amount, carrierId, deps) → TransportJobRecord | null` — creates reservation, marks request InProgress, returns record
- `pickUp(record, deps) → void` — consumes reservation (Reserved → PickedUp)
- `deliver(record, deps) → void` — fulfills request (PickedUp → Delivered)
- `cancel(record, reason, deps) → void` — releases reservation if Reserved, resets request (any → Cancelled)
- `redirectSource(record, newBuildingId, deps) → boolean` — transfers reservation to new building

`deps` is `{ reservationManager, requestManager, eventBus }`.

Each method mutates `record.phase` and calls into the managers. The logic is extracted 1:1 from the current `TransportJob` class + `RequestFulfillment` class, collapsed into a single module.

## Subsystem Details

### Subsystem 1 — TransportJobRecord + TransportJobService

**Goal**: Replace `TransportJob` class and `RequestFulfillment` class with flat data + stateless service.

**Files to create:**
- `src/game/features/logistics/transport-job-record.ts` — `TransportPhase` enum + `TransportJobRecord` interface
- `src/game/features/logistics/transport-job-service.ts` — stateless lifecycle operations

**Files to modify:**
- `src/game/features/logistics/logistics-dispatcher.ts` — change `activeJobs: Map<number, TransportJob>` to `Map<number, TransportJobRecord>`. Replace `TransportJob.create(...)` with `TransportJobService.activate(...)`. Replace `job.cancel()` with `TransportJobService.cancel(record, ...)`. Remove TransportJob import.
- `src/game/features/logistics/carrier-assigner.ts` — update type from `TransportJob` to `TransportJobRecord`
- `src/game/features/logistics/transport-job-builder.ts` — update to produce `TransportJobRecord` instead of `TransportJob`. Stop calling `toCallbacks()`. Set `transportData.jobId = record.id`.
- `src/game/features/logistics/stall-detector.ts` — update type if it accesses TransportJob fields

**Files to delete:**
- `src/game/features/logistics/transport-job.ts` — replaced by transport-job-record.ts + transport-job-service.ts
- `src/game/features/logistics/request-fulfillment.ts` — logic absorbed into transport-job-service.ts

**Migration notes:**
- `RequestFulfillment.activate()` → becomes the body of `TransportJobService.activate()`
- `RequestFulfillment.pickUp/deliver/cancel()` → becomes `TransportJobService.pickUp/deliver/cancel()`
- `TransportJob.consumeReservation()` was just `this.fulfillment.pickUp()` → now `TransportJobService.pickUp(record, deps)`
- `TransportJob.fulfillRequest()` was just `this.fulfillment.deliver()` → now `TransportJobService.deliver(record, deps)`
- `TransportJob.cancel()` called `this.fulfillment.cancel()` + emitted event → `TransportJobService.cancel()` does both
- `TransportJob.status` getter derived from fulfillment status → now just `record.phase` directly
- `TransportJob.toCallbacks()` is deleted entirely (callbacks pattern removed)
- The `nextJobId` counter moves to `TransportJobService`

### Subsystem 2 — Remove callbacks from TransportData

**Goal**: Replace `TransportData.callbacks` with `TransportData.jobId`.

**Files to modify:**
- `src/game/features/settler-tasks/choreo-types.ts`:
  - Remove `TransportCallbacks` interface
  - Change `TransportData.callbacks` to `TransportData.jobId: number`
- `src/game/features/settler-tasks/internal/transport-executors.ts`:
  - `executeTransportPickup`: instead of `callbacks.onPickedUp()`, resolve via `ctx.transportJobOps.pickUp(td.jobId)`
  - `executeTransportDelivery`: instead of `callbacks.onDelivered()`, call `ctx.transportJobOps.deliver(td.jobId)`
  - The executor context (`InventoryExecutorContext`) needs a new field: `transportJobOps: TransportJobOps`
- `src/game/features/settler-tasks/worker-task-executor.ts`:
  - Line 479: `job.transportData.callbacks.onCancelled()` → `this.transportJobOps.cancel(job.transportData.jobId)`
- `src/game/features/logistics/transport-job-builder.ts`:
  - Line 77: `callbacks: transportJob.toCallbacks()` → `jobId: record.id`

**Wiring**: LogisticsDispatcher creates the `TransportJobOps` implementation (it owns `activeJobs` and `TransportJobService` deps) and passes it to SettlerTaskSystem, which forwards it to WorkerTaskExecutor and the executor context.

### Subsystem 3 — Persist LogisticsDispatcher

**Goal**: Determine whether `LogisticsDispatcher` needs `Persistable`.

Since inventory `deserialize` resets reservations to 0, and requests `deserialize` resets in-progress to Pending, the dispatcher's state is derived: it re-creates jobs from pending requests + idle carriers each tick.

However, if SettlerTaskSystem is persisted (subsystem 4), carriers mid-transport have a `ChoreoJobState` with `transportData.jobId`. On restore, that jobId must resolve to a live record. Two options:

**Option A — Don't persist transport jobs.** On restore, any ChoreoJobState with `transportData` is cancelled (carrier drops material, goes idle). Dispatcher re-matches next tick. Simple, robust, minor efficiency loss.

**Option B — Persist transport jobs.** Restore `TransportJobRecord`s into `activeJobs`, re-create reservations from the records, carriers resume mid-delivery. More seamless but requires reservation reconstruction.

**Recommendation: Option A for initial implementation.** Option B can be added later.

**For Option A**, the SettlerTaskSystem deserialize just needs to detect `transportData` on a serialized job and skip it (restore unit as idle instead). No Persistable needed on the dispatcher.

### Subsystem 4 — Persist SettlerTaskSystem

**Goal**: `SettlerTaskSystem` implements `Persistable`.

**persistKey**: `'settlerTasks'`

**What to serialize per unit:**

```typescript
interface SerializedUnitRuntime {
    entityId: number;
    state: string;                  // SettlerState enum
    lastDirection: number;
    homeAssignment: { buildingId: number; hasVisited: boolean } | null;
    // Job state — only for non-transport jobs (transport jobs restart idle)
    job: SerializedChoreoJob | null;
}

interface SerializedChoreoJob {
    jobId: string;
    nodes: ChoreoNode[];            // already pure data
    nodeIndex: number;
    progress: number;
    visible: boolean;
    activeTrigger: string;
    targetId: number | null;
    targetPos: { x: number; y: number } | null;
    carryingGood: number | null;    // EMaterialType or null
    workStarted: boolean;
    // transportData omitted — transport jobs restart idle (Option A)
}
```

**serialize()**: Iterate runtimes map. For each unit:
- If the job has `transportData`, serialize the unit as idle (skip the job). The carrier will be re-dispatched.
- Otherwise, serialize the full ChoreoJobState (nodes are already pure data).
- Skip `moveTask` (user-initiated moves are ephemeral).
- Skip `idleState` (animation timers, reconstructed naturally).

**deserialize(data)**: For each entry:
- Look up the unit entity (must exist from entity restoration).
- Reconstruct the UnitRuntime with the serialized state.
- If job is present, set nodeIndex/progress to resume mid-choreography.
- Re-register building occupancy from homeAssignment.

**after**: `['carriers', 'constructionSites', 'buildingInventories']` — needs carriers registered and buildings with inventories.

### Subsystem 5 — Persist InventoryReservationManager

**Goal**: `InventoryReservationManager` implements `Persistable`.

**persistKey**: `'inventoryReservations'`

**Note**: Only needed for Option B (persist transport jobs). For Option A, reservations are released on save (inventory reservedAmounts reset to 0) and rebuilt by the dispatcher on next tick. Skip for initial implementation.

## Execution Order

**Phase 1** (can be parallel):
- Subsystem 1 — TransportJobRecord + TransportJobService (logistics files only)

**Phase 2** (depends on phase 1):
- Subsystem 2 — Remove callbacks from TransportData (choreo + executor files)

**Phase 3** (depends on phase 2):
- Subsystem 4 — Persist SettlerTaskSystem

**Integration**:
- Registration in GameServices
- Lint + test pass

## File Ownership Summary

| Subsystem | Creates | Modifies |
|-----------|---------|----------|
| 1 | transport-job-record.ts, transport-job-service.ts | logistics-dispatcher.ts, carrier-assigner.ts, transport-job-builder.ts, stall-detector.ts |
| 2 | — | choreo-types.ts, transport-executors.ts, worker-task-executor.ts, transport-job-builder.ts |
| 4 | — | settler-task-system.ts |
| Wire | — | game-services.ts |

## Deletes

- `src/game/features/logistics/transport-job.ts` — replaced by transport-job-record.ts + transport-job-service.ts
- `src/game/features/logistics/request-fulfillment.ts` — logic absorbed into transport-job-service.ts
