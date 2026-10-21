# Logistics & Task Assignment — Simplification Review

Review of logistics, task assignment, material requests, building/construction demand, and related settler-task plumbing. Goal: fewer error-prone paths, clearer ownership, useful abstractions.

> **Partly superseded (2026-10-21) by [`docs/designs/job-ownership.md`](../designs/job-ownership.md).**
> Job ownership, the "is this unit idle" question and the invariants now live there. Superseded here:
> `entity.jobId` (deleted — a unit's commitment `{ owner, ref }` is its identity; for a transport,
> `ref` = record id), `clearJobId` / `numericJobId` / `allocateJobId`, `TransportJobBuilder` (now the
> `Transport` JobKind handler, `features/logistics/transport-job-kind.ts`), `onCancel` / `transportData`
> (node `args` + `TransportJobStore`), the `carrier:transportCancelled` → lifecycle round-trip (cancel calls
> `jobs.cancel` directly; the event is a notification), `UnitDemandJobHandlers` (owners get direct
> handler calls), `unit-demand-loop.ts` (only `IntervalDrain` remains, in `systems/interval-drain.ts`) and
> `TaskDispatcher.assignJob` (jobs go through `JobService.assign`). Sections below that describe those
> are kept as history; the P2 items are still open.

---

## Mental model (current)

```
Standing orders                 Units in motion
───────────────                 ────────────────
MaterialRequestSystem ──┐
ConstructionRequestSystem┤──► DemandLedger
                        │         │ deficit = target − inventory − incoming
                        │         ▼
                        │   LogisticsDispatcher (tick)
                        │         │
                        │         ├─ RequestMatcher → supplies (fulfillment-matcher)
                        │         └─ CarrierAssigner → idle/busy carriers
                        │                   │
                        │                   ▼
                        │         TransportJobStore + TransportJobService
                        │                   │
                        │                   ▼
                        │         TransportJobBuilder → ChoreoJobState
                        │                   │
                        └──────────────────► JobRunner.assignJob()
                                              │
                                              ▼
                                    JobRunner → ChoreoSystem (transport executors)
                                              │
                                    MaterialTransfer + BuildingInventory
```

**Parallel assignment systems** (same shape, different domains):

| System | Demand | Candidate | Job |
|--------|--------|-----------|-----|
| Logistics | `DemandLedger` deficit | idle/busy carrier + supply | transport choreo |
| BuildingDemand | `Map<building, BuildingDemand>` | idle specialist / recruit | `WORKER_DISPATCH` |
| ConstructionSiteDemand | `Map<site, ConstructionWorkerDemand[]>` | digger/builder / recruit | dig/build choreos |
| Tower garrison / barracks | own maps | specialists / carriers | dispatch + reservation |

Carriers stay idle (`NullWorkHandler`); logistics **pushes** jobs. Workers **pull** work via idle search + work handlers.

---

## What’s already solid

These are keepers — don’t re-architect them away:

1. **DemandLedger (declarative standing orders)**  
   Deficit derived from inventory + jobs. Cancelled/delivered jobs re-open deficit automatically. Better than ticket queues.

2. **TransportJobRecord as SoT for material in motion**  
   Phase implies reservation (`claimsSourceStock`) and incoming (`isIncoming`). No separate reservation tables for transport stock claims.

3. **Late destination binding**  
   Walk target chosen at build time; landing slot at `depositDelivery`. Avoids dest-slot reservation races.

4. **IdleCarrierPool**  
   One “find nearest free carrier” API; busy = `entity.jobId != null` or unit reservation.

5. **TaskDispatcher as a narrow interface**  
   Domain features assign opaque `ChoreoJobState` without owning settler runtime.

6. **Transport executors isolated from generic inventory executors**  
   Dedicated `TRANSPORT_*` path is clearer than branching inside `GET_GOOD`/`PUT_GOOD`.

---

## Highest-impact pain points

### 1. Three IDs for “what is this unit doing?”

| ID | Type | Meaning |
|----|------|---------|
| `entity.jobId` | `number` | Busy flag / global identity |
| `TransportJobRecord.id` | `number` | Logistics record key |
| `ChoreoJobState.jobId` | `string` | Choreo name (`JOB_CARRIER_TRANSPORT_GOOD`) |

**Bug surface:** `TransportJobService.activate()` and `SettlerTaskSystem.assignJob()` each call `allocateJobId()`. For every transport, **two different numbers** are allocated. Logs/events use `record.id` in some places and string choreo IDs in others (`settler:taskCompleted.jobId` is the string).

**Simplify:** One numeric job id per assignment.

- Prefer: `activate` allocates; `assignJob` accepts optional `numericJobId` and reuses the transport record id.
- Put alignment in tests: after assign, `entity.jobId === transportRecord.id`.

### 2. Split ownership of `entity.jobId` / job end

Who clears busy state?

- `JobRunner.completeJob` / `interruptJob` → `clearJobId` (was `WorkerJobLifecycle`)
- `TransportJobService.cancel` → `clearJobId` (non-queued)
- `LogisticsDispatcher` on `settler:taskCompleted` → **again** `clearJobId`, then flush queued follow-up

Comments carefully avoid clearing on `deliver()` (animation still running) — good — but ownership is hard to hold in your head.

**Simplify:** Single owner: **settler-task lifecycle always owns `entity.jobId`**.

- Logistics never calls `clearJobId` except restore orphan cleanup.
- `TransportJobService.cancel` removes the record and emits `carrier:transportCancelled`; lifecycle interrupts the choreo and clears `jobId`.
- Queued follow-up only starts from `settler:taskCompleted` after lifecycle has already cleared.

### 3. Three nearly identical demand–assign loops

`BuildingDemandSystem` and `ConstructionSiteDemandSystem` share the same skeleton:

1. Create demand with `committedUnitId` / `workerId`
2. Tick drain (~1s)
3. Find idle specialist → assignJob
4. Else recruit carrier
5. On taskCompleted/Failed, string-match job IDs and commit/reset

Logistics is the material variant of the same idea (deficit → match → assign).

**New abstraction: `UnitDemandLoop<TDemand>`** (or a small shared helper module):

```ts
interface UnitDemandHandlers<T> {
  tryFulfill(demand: T): 'committed' | 'retry' | 'drop';
  ownsJob(jobId: string): boolean;
  onJobCompleted(unitId: number, demand: T): void;
  onJobFailed(unitId: number, demand: T): void;
  onUnitGone(unitId: number, demand: T): void;
}
```

Even lighter win: shared **`JobKind`** on `ChoreoJobState` instead of string job-id sets in demand handlers.

### 4. `TransportOps` closures on choreography

`TransportJobBuilder` attaches `ops.isValid/pickUp/deliver` and `onCancel` closures that capture builder deps. Harder to reason about, restore, or test.

**Simplify:** Drop `ops`. Transport executors look up the store by job id and call `TransportJobService` with deps. `transportData` becomes pure data (ids + positions).

### 5. Logistics layering is slightly over-split

`RequestMatcher` is a thin policy wrapper around free functions. Several exports appear unused outside the module (`canPotentiallyFulfill`, `estimateFulfillmentDistance`, `hasAnySupply`, `getTotalSupply`).

**Simplify:** delete/unexport dead API; keep `CarrierAssigner` separate (joint cost ranking is non-trivial); fix stale comments (e.g. StallDetector “cancels” vs diagnostics-only).

### 6. Carrier ranking cost is O(sources × carriers)

For each deficit order, up to N supplies; for each supply, scan all idle carriers + all PickedUp jobs.

**Later:** spatial idle-carrier index / player-partitioned caches.

### 7. Failure types are hard to handle

```ts
type AssignResult = AssignmentSuccess | 'no_carrier' | null;
```

Prefer a discriminated union with explicit reasons.

### 8. Settler-task still a wide facade

Further extract **`UnitJobService`** (`assignJob` / `assignMoveTask` / interrupt) vs **`WorkerAutonomy`** (idle search + handlers). Unify `JobAssigner` with `TaskDispatcher.assignJob` (no `as unknown as` cast).

*Status:* done — settler-tasks is split by concept into `JobRunner` (job lifecycle, `entity.jobId`, implements
`TaskDispatcher`), `WorkerAutonomy` (idle search), `WorkerAssignments` (home buildings) and `UnitVisualSync`;
`JobRunner` and `WorkerAssignments` are exported directly in `SettlerTaskExports`.

### 9. Storage capacity math is dense but local

`deliverySpace` / `foreignFreeSlotClaims` correctly model shared unclaimed storage. Optional extract: `DestCapacity.freeFor(building, material)`.

---

## Proposed abstractions (priority order)

### P0 — correctness / clarity (high ROI)

1. **Unify numeric job id** (`entity.jobId` === transport record id when on a transport job).
2. **Single owner of `clearJobId`** (settler lifecycle; logistics only cancels records / flushes queue; restore may clear orphan jobIds).
3. **Discriminated `AssignResult`**.
4. **`JobKind` on choreo** for completion routing instead of string sets.
5. **Delete dead logistics exports**.

### P1 — structural

6. **Pure `transportData`** — no `TransportOps` / `onCancel` closures.
7. **`UnitDemandLoop` shared helper** for building + construction.
8. **`UnitJobService`** extracted from `SettlerTaskSystem`.
9. **Merge `JobAssigner` with `TaskDispatcher.assignJob`**.

### P2 — performance / polish (when needed)

10. Spatial idle-carrier index.
11. `DestCapacity` / supply snapshot shared by matcher + diagnostics.
12. Incremental supply index if scans get hot.

### Avoid / low value

- Reintroducing ticket-based demand queues
- Merging logistics into settler-tasks again
- Making transport jobs fully choreography-owned without a store
- Giant “LogisticsEngine” god class

---

## Invariants

**Moved to [`docs/designs/job-ownership.md` → "Invariants"](../designs/job-ownership.md#invariants-replace-invariants-in-docsarchitecturelogistics-task-simplificationmd).**
The logistics invariants of this review (standing order ⇒ dispatcher may open jobs; phase is the
reservation; one active + one queued transport per carrier; deliver does not free the carrier;
construction complete cancels destination jobs; null work handlers never self-assign) are kept there
as invariants 9–14. The former invariants 4 and 8 (`entity.jobId` as the busy flag and its ownership)
are replaced by invariants 1–3 (idle ⇔ no commitment; only `JobService` writes commitments).

---

## Implementation status

| Item | Status |
|------|--------|
| This document | Done |
| P0.1 Unify numeric job id | Done; superseded (`entity.jobId` deleted — job-ownership.md) |
| P0.2 Single `clearJobId` ownership | Done; superseded (commitments — job-ownership.md) |
| P0.3 Discriminated `AssignResult` | Done |
| P1.6 Pure `transportData` (no TransportOps) | Done; superseded (node args — job-ownership.md) |
| P1.7 Unit demand loop helpers | Done; superseded (only `IntervalDrain` left, `systems/interval-drain.ts`) |
| P1.8 `UnitJobService` extract | Done |
| P1.9 Merge JobAssigner → TaskDispatcher | Done; superseded (`JobService.assign`) |
| P0.4 JobKind enum | Done; extended (one `JobKindHandler` per kind — job-ownership.md) |
| P0.5 Delete dead logistics exports | Done |
| P2.10 Spatial idle-carrier index | Done (`SpatialHash` + `IdleCarrierPool`) |
| P2.11 DestCapacity snapshot | Not started |
| P2.12 Incremental supply index | Not started |

### P0.1 — Unify numeric job id

- `SettlerTaskSystem.assignJob(..., numericJobId?: number)` uses the provided id when set; otherwise allocates.
- `TaskDispatcher` / `JobAssigner` pass through optional `numericJobId`.
- Carrier assignment paths (`CarrierAssigner`, flush queued, restore) pass `record.id`.
- After a successful transport assign: `entity.jobId === record.id`.

### P0.2 — Single `clearJobId` ownership

- `TransportJobService.cancel` does **not** clear `entity.jobId`.
- For **active** (non-queued) jobs, cancel removes the record and emits `carrier:transportCancelled`.
  Settler lifecycle (`handleTransportCancelled` → `interruptJob`) clears `jobId`.
- For **Queued** follow-ups, cancel only removes the record — no event (the running choreo /
  `entity.jobId` belong to the active record).
- `LogisticsDispatcher` no longer clears on `settler:taskCompleted` (lifecycle already cleared before the event).
- Restore still clears orphan carrier `jobId`s with no live transport record (no choreo path to run lifecycle).

### P0.3 — Discriminated `AssignResult`

```ts
type AssignResult =
  | { status: 'assigned'; record; carrierId; queued: boolean }
  | { status: 'no_carrier' }
  | { status: 'failed'; reason: 'reservation' | 'movement' };
```

### P1.6 — Pure `transportData`

- Removed `TransportOps` from `ChoreoJobState.transportData`.
- Transport executors look up `TransportJobStore` by `jobId` and call `TransportJobService`.
- Thin `onCancel` remains (store cancel on interrupt only).

### P1.7 — Unit demand loop

- `IntervalDrain`, `UnitDemandJobHandlers`, `handleDemandJobCompleted` / `Failed` in `systems/unit-demand-loop.ts`.
- Used by `BuildingDemandSystem` and `ConstructionSiteDemandSystem`.

### P1.8 — `UnitJobService`

- `assignJob` / `assignMoveTask` / `interruptJobForCleanup` live in `settler-tasks/unit-job-service.ts`.
- `SettlerTaskSystem` implements `TaskDispatcher` by delegation.

### P1.9 — Merge JobAssigner

- Deleted standalone `JobAssigner`; logistics takes `Pick<TaskDispatcher, 'assignJob'>` as `taskDispatcher`.

### P0.4 — JobKind

- `JobKind` enum on `ChoreoJobState` (`Work`, `WorkplaceDispatch`, `Construction`, `Transport`, `Barracks`, `Garrison`, `Recruit`).
- `choreo(id, kind)` sets kind; synthetic jobs tag their domain.
- `settler:taskCompleted` / `taskFailed` carry `kind`.
- Demand systems filter with `ownsKind(kind)` instead of string jobId sets.

### P0.5 — Dead logistics exports removed

- Deleted: `hasAnySupply`, `getTotalSupply`, `matchRequestToSupply`, `canPotentiallyFulfill`, `estimateFulfillmentDistance`, unused `RequestMatcher.matchRequest`.
- StallDetector public comment fixed (diagnostic only).

### P2.10 — Spatial idle-carrier index

- **`SpatialHash`** (`src/game/spatial-hash.ts`): reusable cell hash, same cellShift model as
  `SpatialGrid`, no territory, supports `clear()` for rebuilds of mobile sets.
- **`IdleCarrierPool`**: rebuilds idle carriers into `SpatialHash` once per `beginFrame()`;
  `findNearest*` expands radius via `nearbyIds` (same idea as `SpatialGrid.nearby`).
- **Why not `SpatialGrid`?** That index is for **static** map objects (trees/piles) with
  territory state and no move API. Carriers move every tick, so a rebuildable hash is correct.
- **Why not renderer `EntityGrid`?** Render-layer only; not for simulation queries.
- Call sites: `LogisticsDispatcher.tick` and `RecruitSystem` queue drain call `beginFrame()`.
