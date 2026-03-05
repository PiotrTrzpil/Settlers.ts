# Architecture Review: Logistics & Choreography Engine

**Date:** 2026-03-05
**Scope:** `features/logistics/`, `features/settler-tasks/`, `features/carriers/`, `features/material-requests/`, `systems/movement/`

---

## Executive Summary

The logistics and choreography engine is **well-architected overall**, with clean separation between demand generation (MaterialRequestSystem), supply matching (RequestMatcher/FulfillmentMatcher), dispatch orchestration (LogisticsDispatcher), and physical execution (SettlerTaskSystem + choreo executors). The XML-driven choreography system is a strong design choice that faithfully reproduces original Settlers 4 behavior while keeping domain logic extensible.

However, several structural concerns exist around **cross-feature coupling**, **dual-purpose executors**, **ownership ambiguity for carrier lifecycle**, and **determinism risks**. These are elaborated below with specific findings and recommendations.

---

## 1. Separation of Concerns

### 1.1 Strengths

**Clean layer decomposition.** The logistics pipeline follows a clear data-flow direction:

```
MaterialRequestSystem (demand) → RequestManager (queue)
    → LogisticsDispatcher (orchestration)
        → RequestMatcher (supply matching)
        → CarrierAssigner (resource allocation)
            → TransportJob (lifecycle owner)
            → SettlerTaskSystem (execution)
```

Each component has a single, well-documented responsibility:
- `RequestManager` — pure CRUD + priority queue for requests
- `RequestMatcher` — stateless supply-finding with territory/service-area filtering
- `CarrierAssigner` — finds idle carriers and creates transport jobs
- `TransportJob` — owns reservation + request status lifecycle (guaranteed exactly-once complete/cancel)
- `LogisticsDispatcher` — integration layer that composes the above per tick

**TransportJob ownership model.** `TransportJob` is the single owner of the reservation-request lifecycle. Every constructed job will eventually call exactly one of `complete()` or `cancel()`. This eliminates an entire class of resource leak bugs. The state machine (`active → picked-up → completed|cancelled`) is simple and auditable.

**Executor dispatch map with exhaustiveness checking.** `CHOREO_EXECUTOR_MAP` as a `Record<ChoreoTaskType, ChoreoExecutorFn>` provides compile-time proof that every task type has an executor. Adding a new `ChoreoTaskType` without an executor produces a type error. This is excellent.

**Composition over inheritance in SettlerTaskSystem.** The system is decomposed into focused sub-components: `UnitStateMachine` (state dispatch), `WorkerTaskExecutor` (job selection + execution), `WorkHandlerRegistry` (domain handler lookup), `IdleAnimationController` (visual), `JobChoreographyStore` (data). Each can be tested and reasoned about independently.

### 1.2 Concerns

#### CONCERN 1: Inventory executors have transport-specific branching (Separation of Concerns violation)

**Files:** `settler-tasks/internal/inventory-executors.ts` (lines 94-136, 167-214)

`executeGetGood` and `executePutGood` contain an `if (job.transportData)` branch that handles carrier transport logic: calling `TransportJob.pickup()`, emitting `carrier:pickupComplete`/`carrier:deliveryComplete` events, updating `CarrierManager` status, and pre-setting `job.targetPos` for the next movement node.

This means a single executor function contains two entirely different behaviors depending on whether the settler is a worker or a carrier. The carrier branch:
- Knows about `TransportJob` internals (pickup/complete)
- Emits carrier-specific events
- Directly calls `ctx.carrierManager.setStatus()`
- Manages `job.targetPos` for the next node (cross-node coupling)

**Impact:** The choreo executor layer — which should be a thin mapping from task types to actions — becomes aware of the transport domain. Adding a new transport mode (e.g., donkeys, ships) would require modifying these executors rather than extending the system.

**Recommendation:** Extract transport-specific logic into dedicated executors or a transport execution strategy. The `CHOREO_EXECUTOR_MAP` could dispatch to different executor implementations based on `job.transportData` presence, or transport jobs could use distinct `ChoreoTaskType` entries (e.g., `TRANSPORT_PICKUP`, `TRANSPORT_DELIVER`).

#### CONCERN 2: `SettlerTaskSystem.buildTransportJob()` couples task system to logistics domain

**File:** `settler-tasks/settler-task-system.ts` (lines 392-416)

The `SettlerTaskSystem` has a method `buildTransportJob()` that:
- Takes a `TransportJob` (from `features/logistics/`)
- Resolves pile positions via `buildingPositionResolver`
- Looks up `JOB_CARRIER_TRANSPORT_GOOD` from the choreography store
- Creates and populates a `ChoreoJobState` with transport-specific fields (`managedTargetPos`, `transportData`)

This creates a hard dependency from `settler-tasks` → `logistics`, violating the principle that the task execution engine should be domain-agnostic. The task system should execute any job sequence without needing to understand what logistics transport means.

**Recommendation:** Move `buildTransportJob()` to `CarrierAssigner` or a dedicated `TransportJobBuilder` in the logistics feature. The logistics feature should construct the full `JobState` (with positions resolved) and pass it to `settlerTaskSystem.assignJob()` as an opaque job. The settler task system should not import `TransportJob`.

#### CONCERN 3: `CarrierManager` is too thin — carrier lifecycle is split across three features

**Files:** `carriers/carrier-manager.ts`, `logistics/carrier-assigner.ts`, `settler-tasks/internal/inventory-executors.ts`

The `CarrierManager` only tracks `{entityId, status}`. But carrier lifecycle management is actually distributed:

| Responsibility | Location |
|---|---|
| State storage | `CarrierManager` (carriers feature) |
| Job assignment + status → Walking | `CarrierAssigner` (logistics feature) |
| Status → PickingUp / Delivering | Implicitly via choreo node progression (never explicitly set) |
| Status → Idle (on delivery) | `executePutGood` in inventory-executors (settler-tasks feature) |
| Status → Idle (on removal) | `LogisticsDispatcher.handleCarrierRemoved` (logistics feature) |

Three separate features mutate carrier status. The `CarrierStatus` enum has four values (`Idle`, `Walking`, `PickingUp`, `Delivering`) but only `Idle` and `Walking` are ever explicitly set in code. `PickingUp` and `Delivering` are defined but appear unused — carrier status jumps directly from `Walking` to `Idle` on delivery.

**Impact:** Carrier state transitions are non-obvious and scattered. There's no single place that documents or enforces the valid state machine. The unused `PickingUp`/`Delivering` states suggest either incomplete implementation or dead code.

**Recommendation:**
1. Audit whether `PickingUp`/`Delivering` are needed. If not, remove them.
2. Centralize status transitions in `CarrierManager` behind validated methods (e.g., `startTransport()`, `completeTransport()`), so the manager enforces valid transitions rather than being a passive data bag.
3. Consider whether `CarrierManager` should own the transport job reference, rather than `LogisticsDispatcher.activeJobs`.

---

## 2. Interactions & Data Flow

### 2.1 Strengths

**Event-driven coordination.** Systems communicate via typed events on the `EventBus`:
- `carrier:assigned`, `carrier:deliveryComplete`, `carrier:pickupFailed` — logistics lifecycle
- `settler:taskStarted`, `settler:taskCompleted`, `settler:taskFailed` — task execution
- `carrier:removed`, `building:destroyed` — cleanup triggers

This keeps systems loosely coupled. The `LogisticsDispatcher` subscribes to carrier/building events for cleanup without needing to call into the task system directly.

**Reservation system prevents over-commitment.** `InventoryReservationManager` creates slot-level reservations at the source building when a transport job is created. This prevents multiple carriers from being dispatched for the same goods. The reservation is atomically released on pickup (via `withdrawReservedOutput`) or on cancellation. This is critical for correctness.

**Throttled event emission.** `LogisticsDispatcher` throttles `logistics:noCarrier` and `logistics:noMatch` events with a 5-second cooldown per (building, material) pair. This prevents event storms when many buildings are requesting materials that can't be supplied.

### 2.2 Concerns

#### CONCERN 4: Dual cleanup paths for transport job cancellation

**Files:** `logistics/logistics-dispatcher.ts`, `settler-tasks/worker-task-executor.ts`

Transport jobs can be cancelled via two independent paths:

1. **From logistics side:** `LogisticsDispatcher.handleCarrierRemoved()` calls `job.cancel()` and deletes from `activeJobs`.
2. **From task side:** `WorkerTaskExecutor.interruptJob()` calls `job.transportData.transportJob.cancel()` when a choreo job is interrupted.

Both paths call `TransportJob.cancel()`, which is idempotent (safe to call twice). However, only path 1 removes the job from `LogisticsDispatcher.activeJobs`. When path 2 fires (e.g., pathfinding failure during transport), the cancelled job remains in `activeJobs` until the next `carrier:deliveryComplete` or `carrier:pickupFailed` event cleans it up — but those events won't fire because the job was already cancelled.

The `StallDetector` serves as a safety net (30s timeout), but that's a long window where `activeJobs` holds a stale reference.

**Recommendation:** When `WorkerTaskExecutor.interruptJob()` cancels a transport job, it should emit an event (e.g., `carrier:transportCancelled`) that `LogisticsDispatcher` listens to for cleanup. Alternatively, `TransportJob.cancel()` could emit the cleanup event directly, since it owns the lifecycle.

#### CONCERN 5: `findAvailableCarrier` ignores spatial locality

**File:** `logistics/carrier-assigner.ts` (lines 140-149)

`findAvailableCarrier` iterates all carriers for the player and returns the first idle one found, ignoring the `_serviceHubs` parameter entirely (note the underscore prefix — it's explicitly unused). This means a carrier on the opposite side of the map may be assigned to a transport that a nearby carrier could handle.

**Impact:** Suboptimal carrier assignment leads to long transport times and inefficient logistics. In large maps with many carriers, this is a significant gameplay concern.

**Recommendation:** Use spatial proximity as a factor in carrier selection. At minimum, prefer carriers closer to the source building. The `_serviceHubs` parameter was clearly intended for zone-based carrier selection — implement it or remove the parameter to avoid confusion.

#### CONCERN 6: `MaterialRequestSystem.tick()` iterates ALL buildings every tick

**File:** `material-requests/material-request-system.ts` (lines 47-61)

Every tick, the system iterates every building entity, checks inventory config, filters construction sites, and evaluates input slot levels. For a map with hundreds of buildings, this is O(n) per tick regardless of whether any building actually needs materials.

**Impact:** Performance concern at scale. Most buildings have sufficient materials most of the time.

**Recommendation:** Switch to event-driven request creation. Buildings could emit an event when their input inventory drops below the threshold (on withdrawal), and the system creates a request in response. Alternatively, maintain a dirty set of buildings that need re-evaluation and only iterate that subset.

---

## 3. Coherence & Consistency

### 3.1 Strengths

**Consistent executor signature.** All 31 choreo executors share the same `ChoreoExecutorFn` signature: `(settler, job, node, dt, ctx) => TaskResult`. This uniformity simplifies the dispatch loop and makes it easy to add new task types.

**Consistent config object pattern.** All systems with 3+ dependencies use a `*Config` interface (`LogisticsDispatcherConfig`, `CarrierAssignerConfig`, `SettlerTaskSystemConfig`, etc.), following design rule 4.4.

**Consistent lifecycle management.** `EventSubscriptionManager` in `LogisticsDispatcher` and similar patterns ensure event handlers are properly cleaned up on destroy/HMR.

### 3.2 Concerns

#### CONCERN 7: Inconsistent event systems — `EventBus` vs `RequestManager` private event system

**Files:** `event-bus.ts`, `logistics/request-manager.ts` (lines 452-484)

`RequestManager` implements its own private event system (`on`/`off`/`emit`) with a `RequestManagerEvents` interface. This is separate from the game-wide `EventBus` that all other systems use.

The `RequestManager` events (`requestAdded`, `requestFulfilled`, `requestReset`, etc.) are structurally identical to what could be `EventBus` events following the `logistics:requestAdded` naming convention.

**Impact:** Two event systems in the same domain means:
- Inconsistent subscription patterns (global `eventBus.on()` vs `requestManager.on()`)
- `RequestManager` events are invisible to debug tools that monitor the `EventBus`
- No centralized event logging/tracing for the logistics pipeline
- `RequestManager` can't participate in the `EventSubscriptionManager` cleanup pattern

**Recommendation:** Migrate `RequestManager` events to the global `EventBus` under the `logistics:` namespace. The `RequestManager` should accept `EventBus` as a dependency and emit through it. Its private event system can be removed.

#### CONCERN 8: `StallDetector` uses wall-clock time in game logic

**File:** `logistics/stall-detector.ts`, `logistics/request-manager.ts` (line 190, 327)

`RequestManager.assignRequest()` stores `Date.now()` as `assignedAt`. `StallDetector` and `RequestManager.getStalledRequests()` compare this against `Date.now()` with a 30-second timeout.

Using wall-clock time in game simulation logic violates determinism rule 8.1 from `design-rules.md`. If the game is paused, runs at different speeds, or is replayed, wall-clock timeouts will behave differently.

**Impact:** Stall detection is non-deterministic. A paused game will timeout all in-progress requests. A game running at 2x speed will take the same wall-clock time to detect stalls, even though twice as many game ticks have elapsed.

**Recommendation:** Replace `Date.now()` with a game-tick counter or accumulated game time from the tick loop. `StallDetector` already receives `dt` (game delta time) and accumulates it — extend this to the request age tracking as well.

#### CONCERN 9: `ChoreoContext` is a wide service bag

**File:** `settler-tasks/choreo-types.ts` (lines 276-282)

`ChoreoContext` composes `MovementContext`, `WorkContext`, `InventoryContext`, and `TransportContext` into a single interface with 12+ fields. Every executor receives this full context even though most executors only need a small subset.

The file defines phase-specific sub-interfaces (`MovementContext`, `WorkContext`, `InventoryContext`, `TransportContext`) — but they are only documentation artifacts. In practice, `ChoreoContext` is always passed as the full bag.

**Impact:** Each executor has access to services it doesn't need, which:
- Makes it harder to understand what an executor actually depends on
- Makes testing harder (must mock the entire context)
- Creates temptation to reach for convenient-but-inappropriate services

**Recommendation:** This is a moderate concern. The sub-interfaces already provide documentation value. For a stricter approach, executors could receive only their phase-specific context (e.g., movement executors get `MovementContext`, inventory executors get `InventoryContext`), with the dispatch layer narrowing the context. However, the current approach is pragmatic and the overhead of strict narrowing may not be justified.

#### CONCERN 10: `GO_TO_SOURCE_PILE` and `GO_TO_DESTINATION_PILE` are aliases for `GO_TO_POS`

**File:** `settler-tasks/internal/movement-executors.ts` (lines 212-213)

```typescript
export const executeGoToSourcePile: ChoreoExecutorFn = executeGoToPos;
export const executeGoToDestinationPile: ChoreoExecutorFn = executeGoToPos;
```

These are raw aliases — they share the same function reference. For worker settlers, this works because the XML node's `(x, y)` encodes the pile offset. But for carrier transport jobs, `job.targetPos` is pre-set by the transport branch of `executeGetGood` (for the destination pile) and by `buildTransportJob` (for the source pile), bypassing the building-relative resolution in `executeGoToPos`.

**Impact:** The executor named "go to source pile" actually just does "go to building-relative position." For carriers, it goes to a position that was pre-set in `job.targetPos` by a completely different executor. This coupling between the GET_GOOD executor (which sets `job.targetPos` for the NEXT node) and the movement executor (which reads it) is implicit and fragile.

**Recommendation:** Make the data flow explicit. Either:
1. Give pile-movement executors their own implementation that reads from `job.transportData.destPos` directly, or
2. Document the cross-node `targetPos` contract clearly in the `ChoreoJobState` interface and add assertions.

---

## 4. Structural Observations

### 4.1 Feature boundary analysis

| Feature | Files | External imports from feature | Assessment |
|---|---|---|---|
| `logistics/` | 14 files | Clean public API via `index.ts` | Good encapsulation |
| `settler-tasks/` | 15 files + `internal/` | Imports from `logistics/transport-job`, `carriers/` | Coupling concern (see CONCERN 2) |
| `carriers/` | 3 files | Minimal, mostly types | Well-isolated |
| `material-requests/` | 1 file | Imports from `logistics/`, `inventory/` | Appropriate |

### 4.2 Dependency graph

```
material-requests ──→ logistics (RequestManager, RequestPriority)
                  ──→ inventory (BuildingInventoryManager)

logistics ──→ carriers (CarrierManager, CarrierStatus)
          ──→ settler-tasks (SettlerTaskSystem)
          ──→ inventory (BuildingInventoryManager)
          ──→ service-areas (ServiceAreaManager)
          ──→ territory (TerritoryManager)

settler-tasks ──→ logistics (TransportJob) ← BIDIRECTIONAL CONCERN
              ──→ carriers (CarrierManager, CarrierStatus)
              ──→ inventory (BuildingInventoryManager)

carriers ──→ (no feature dependencies) ← GOOD
```

The `logistics ↔ settler-tasks` bidirectional dependency is the most significant structural issue. `logistics` depends on `settler-tasks` for job assignment; `settler-tasks` depends on `logistics` for `TransportJob` in the inventory executors. This creates a conceptual cycle, though TypeScript's type-only imports may avoid a literal circular import.

### 4.3 Testing surface

The decomposition into small, focused classes is excellent for testability:
- `TransportJob` can be tested with mock deps (reservation manager, request manager, inventory manager)
- `RequestMatcher` and `FulfillmentMatcher` are pure functions with no side effects
- `StallDetector` has a simple tick-based interface
- Each choreo executor can be tested with mock context

---

## 5. Summary of Recommendations

### Priority 1 (Architectural)

| # | Issue | Recommendation |
|---|---|---|
| C2 | `buildTransportJob` in SettlerTaskSystem | Move to logistics feature; task system should not know about TransportJob |
| C4 | Dual cleanup paths for cancelled transport | Add event-driven cleanup to prevent stale activeJobs entries |
| C8 | Wall-clock time in game logic | Replace `Date.now()` with game-tick time for determinism |

### Priority 2 (Design)

| # | Issue | Recommendation |
|---|---|---|
| C1 | Transport branching in inventory executors | Extract carrier-specific logic into dedicated executor strategy |
| C3 | Carrier lifecycle split across 3 features | Centralize state transitions; audit unused CarrierStatus values |
| C5 | Carrier assignment ignores proximity | Implement spatial carrier selection |
| C7 | Dual event systems | Migrate RequestManager events to global EventBus |

### Priority 3 (Quality)

| # | Issue | Recommendation |
|---|---|---|
| C6 | MaterialRequestSystem O(n) every tick | Consider event-driven or dirty-set approach |
| C9 | Wide ChoreoContext service bag | Document phase-specific usage; optionally narrow |
| C10 | Implicit cross-node targetPos coupling | Make data flow explicit with assertions or dedicated executors |

---

## 6. Overall Assessment

The logistics and choreography engine demonstrates strong architectural fundamentals:

- **TransportJob as lifecycle owner** is the standout design — it eliminates an entire category of resource leak and double-operation bugs.
- **XML-driven choreography** faithfully reproduces original game behavior while keeping the execution engine generic and data-driven.
- **Exhaustive executor dispatch** provides compile-time safety that every task type is handled.
- **Throttled events and stall detection** show defensive engineering against common real-time system failure modes.

The primary structural concern is the **bidirectional coupling between `logistics` and `settler-tasks`**, where the task system has transport-specific knowledge that should live in the logistics feature. Resolving this would make the choreography engine truly domain-agnostic — able to execute any job sequence without knowing whether it's a woodcutter chopping or a carrier delivering.

The **determinism violation** in stall detection is a correctness risk that should be addressed before any multiplayer or replay features are implemented.

Overall, this is a well-considered architecture that follows the project's documented design rules with a few localized exceptions that are worth addressing as the system matures.
