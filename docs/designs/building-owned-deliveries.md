# Transport Single Source of Truth — Design

## Overview

Consolidate the transport system from 5 scattered data stores into **one source of truth**: `TransportJobStore`. Eliminate `InventoryReservationManager`, `InFlightTracker`, `InventorySlot.reservedAmount`, and strip `RequestManager` to a stateless demand queue. `entity.carrying` stays (physical material location + animation).

## Current State

### What exists: 5 stores tracking the same delivery

```
MaterialRequestSystem ──creates──▶ RequestManager (status, carrier, source)
                                       │
LogisticsDispatcher ──────────────────▶│──matches──▶ InventoryReservationManager (source-side locks)
                                       │              │
                                       │              ▼
                                       │         InventorySlot.reservedAmount (slot-level lock)
                                       │
                                       ├──creates──▶ TransportJobRecord (phase, source, dest, carrier)
                                       │
                                       └──tracks───▶ InFlightTracker (dest-side counts)

Carrier pickup ──sets──▶ entity.carrying (physical material on carrier)
```

Every query crosses multiple stores:
- "What's reserved at building X?" → InventoryReservationManager + InventorySlot.reservedAmount
- "What's in flight to building X?" → InFlightTracker
- "Is request assigned?" → RequestManager.status + TransportJobRecord
- "What is carrier carrying?" → entity.carrying + TransportJobRecord.phase

### What changes

| Current store | Fate | Replaced by |
|--------------|------|-------------|
| `InventoryReservationManager` | **Deleted** | Query: `jobStore.getReservedAmount(building, material)` |
| `InFlightTracker` | **Deleted** | Query: `jobStore.getInFlightAmount(building, material)` |
| `InventorySlot.reservedAmount` | **Removed** | Derived from job store on demand |
| `RequestManager` (status, carrier, source fields) | **Stripped** | Becomes stateless demand queue |
| `ResourceRequest.status/assignedCarrier/sourceBuilding/assignedAt` | **Removed** | Job existence IS the assignment |
| `RequestStatus` enum | **Deleted** | Not needed — demands are either queued or consumed |

### What stays

| Component | Why |
|-----------|-----|
| `entity.carrying` | Physical material location during transit. Conservation law enforcement. Worker (non-transport) jobs. Animation sprite selection. Cannot be removed. |
| `MaterialTransfer` | Atomic inventory↔carrier transfers. Conservation safety net (drop on entity death). |
| `TransportJobRecord` | Already tracks full lifecycle. Becomes the single source of truth. |
| `RequestManager` (simplified) | Demand queue with dirty-set optimization. Avoids scanning all buildings every tick. |

## Summary for Review

- **Interpretation**: Make `TransportJobRecord` the single source of truth for all in-progress deliveries. Everything else is either derived (reservations, in-flight counts) or a simple input queue (demand). `entity.carrying` stays because it's the physical location of material during transit.
- **Key decisions**: (1) Demand queue is transient — not persisted, recomputed from inventory on load. (2) Supply matching queries the job store for reserved amounts instead of a separate reservation manager. (3) `InventorySlot.reservedAmount` is removed — double-booking prevention comes from the job store query. (4) `withdrawReservedOutput` becomes plain `withdrawOutput` — the job phase transition IS the reservation release.
- **Assumptions**: Production never withdraws from output slots that carriers need (production writes to output, carriers read from output — no conflict). The only double-booking risk is two carriers being assigned the same source material, which the job store query prevents.
- **Scope**: Full refactor of logistics data ownership. Touches ~25 files. No behavioral change — all existing integration tests should pass.

## Conventions

- Optimistic programming: no `?.` on required deps, throw with context, no silent fallbacks
- Feature modules: own their state, register with GameLoop, expose query interfaces
- Max 250 lines/function, 600 lines/file, cyclomatic complexity 15
- Events: `"domain:pastTenseVerb"` format
- `getEntityOrThrow(id, 'context')` for entity lookups
- Deterministic iteration: sort by ID before iterating maps

## Architecture

### Subsystems

| # | Subsystem | Responsibility | Depends On | Files |
|---|-----------|---------------|------------|-------|
| 1 | TransportJobStore | Single source of truth: indexed job records + derived queries | — | `transport-job-store.ts` (new) |
| 2 | DemandQueue | Stripped RequestManager: prioritized demand entries, no lifecycle state | 1 | `demand-queue.ts` (new, replaces `request-manager.ts`) |
| 3 | Demand scanners | Update demand queue from inventory state + job store | 1, 2 | `material-request-system.ts`, `construction-request-system.ts` |
| 4 | Supply matching | Match demands to sources, query job store for available supply | 1 | `fulfillment-matcher.ts`, `request-matcher.ts` |
| 5 | Dispatcher + assignment | Orchestrate matching, create jobs, assign carriers | 1, 2, 4 | `logistics-dispatcher.ts`, `carrier-assigner.ts`, `transport-job-builder.ts` |
| 6 | Job lifecycle | Phase transitions on job records (activate, pickUp, deliver, cancel) | 1 | `transport-job-service.ts` |
| 7 | Inventory slot cleanup | Remove `reservedAmount`, simplify slot operations | — | `inventory-slot.ts`, `building-inventory.ts` |
| 8 | Stall detection | Query job store for stalled jobs (replaces request-based stall detection) | 1 | `stall-detector.ts` |
| 9 | Debug + snapshot | Update debug/CLI/snapshot to read from job store | 1 | `logistics-snapshot.ts`, `useBuildingDebugInfo.ts`, `timeline-recording.ts` |
| 10 | Deletion + barrel cleanup | Delete eliminated files, update barrel exports, update event bus types | — | `index.ts`, `event-bus.ts`, persistence files |

## Shared Contracts

```typescript
// ── transport-job-store.ts (NEW) ──

import type { TransportJobRecord } from './transport-job-record';
import type { EMaterialType } from '../../economy/material-type';
import type { TransportPhase } from './transport-job-record';
import type { PersistentIndexedMap, Index } from '...';

/**
 * Single source of truth for all active transport jobs.
 * Wraps PersistentIndexedMap with derived query methods that replace
 * InventoryReservationManager, InFlightTracker, and RequestManager status tracking.
 */
export class TransportJobStore {
    /** Primary store: carrierId → TransportJobRecord */
    readonly jobs: PersistentIndexedMap<TransportJobRecord>;

    /** Index: building ID → carrier IDs (both source and dest) */
    readonly byBuilding: Index<number, number>;

    /** Index: transport phase → carrier IDs */
    readonly byPhase: Index<TransportPhase, number>;

    /** Index: demandId → carrier ID (1:1, for demand consumption tracking) */
    readonly byDemand: Index<number, number>;

    // ── Derived queries (replace InventoryReservationManager) ──

    /** Total amount reserved at a source building for a material (phase=Reserved). */
    getReservedAmount(sourceBuilding: number, material: EMaterialType): number;

    /** Unreserved supply = slot.currentAmount - getReservedAmount(). */
    getAvailableSupply(sourceBuilding: number, material: EMaterialType, currentAmount: number): number;

    // ── Derived queries (replace InFlightTracker) ──

    /** Total amount in flight toward a destination building for a material (phase=PickedUp). */
    getInFlightAmount(destBuilding: number, material: EMaterialType): number;

    // ── Derived queries (replace RequestManager status tracking) ──

    /** Count of active jobs targeting a building+material as destination. */
    getActiveJobCountForDest(destBuilding: number, material: EMaterialType): number;

    /** Check if a demand ID already has a job (prevents double-assignment). */
    hasDemand(demandId: number): boolean;

    /** Get all jobs for a building (source or dest). */
    getJobsForBuilding(buildingId: number): TransportJobRecord[];
}
```

```typescript
// ── demand-queue.ts (NEW — replaces request-manager.ts) ──

import type { EMaterialType } from '../../economy/material-type';

export enum DemandPriority {
    High = 0,    // military, critical
    Normal = 1,  // production, construction
    Low = 2,     // stockpiling, storage imports
}

/** A demand for material delivery. No lifecycle state — just "building X needs material Y". */
export interface DemandEntry {
    readonly id: number;
    readonly buildingId: number;
    readonly materialType: EMaterialType;
    readonly amount: number;
    readonly priority: DemandPriority;
    readonly timestamp: number;  // game time for deterministic ordering
}

/**
 * Prioritized demand queue. No status tracking, no carrier assignment.
 * Demands are added by scanners, consumed by the dispatcher, and
 * automatically re-created if the underlying need persists.
 */
export class DemandQueue {
    /** Add a demand. Returns the created entry. */
    addDemand(buildingId: number, material: EMaterialType, amount: number, priority: DemandPriority): DemandEntry;

    /** Get all demands sorted by priority then timestamp. Cached, rebuilt on mutation. */
    getSortedDemands(): readonly DemandEntry[];

    /** Remove a single demand by ID (consumed by dispatcher when job is created). */
    consumeDemand(demandId: number): boolean;

    /** Remove all demands for a building (building destroyed). */
    cancelDemandsForBuilding(buildingId: number): number;

    /** Count active demands for a building+material. Used by scanners. */
    countDemands(buildingId: number, material: EMaterialType): number;

    /** Game time tracking for deterministic timestamps. */
    advanceTime(dt: number): void;
}
```

```typescript
// ── transport-job-record.ts (unchanged) ──

export interface TransportJobRecord {
    readonly id: number;
    readonly demandId: number;      // was: requestId — renamed for clarity
    sourceBuilding: number;         // mutable: can be redirected
    readonly destBuilding: number;
    readonly material: EMaterialType;
    readonly amount: number;
    readonly carrierId: number;
    phase: TransportPhase;
}
```

```typescript
// ── transport-job-service.ts (simplified TransportJobDeps) ──

export interface TransportJobDeps {
    jobStore: TransportJobStore;
    demandQueue: DemandQueue;
    eventBus: EventBus;
    // inventoryManager needed for slot-level withdrawal on pickup
    inventoryManager: BuildingInventoryManager;
}
```

```typescript
// ── inventory-slot.ts (simplified — no reservation) ──

export interface InventorySlot {
    materialType: EMaterialType;
    currentAmount: number;
    maxCapacity: number;
    // reservedAmount: REMOVED
}

// Deleted functions: reserve(), releaseReservation(), withdrawReserved(), getUnreservedAmount()
// withdrawOutput() replaces withdrawReservedOutput() — just a plain withdrawal
```

## Subsystem Details

### 1. TransportJobStore
**Files**: `src/game/features/logistics/transport-job-store.ts` (new)
**Key decisions**:
- Wraps the existing `PersistentIndexedMap<TransportJobRecord>` (currently inline in LogisticsDispatcher)
- Derived queries iterate the `byBuilding` index filtered by phase+material. These are O(jobs-per-building), typically 1-5. No performance concern.
- `getReservedAmount()` sums `job.amount` where `sourceBuilding === X && material === M && phase === Reserved`
- `getInFlightAmount()` sums `job.amount` where `destBuilding === X && material === M && phase === PickedUp`
- `getActiveJobCountForDest()` counts jobs where `destBuilding === X && material === M && phase in [Reserved, PickedUp]`
- `byDemand` index: maps demandId → carrierId for O(1) "is this demand already assigned?" checks

### 2. DemandQueue
**Files**: `src/game/features/logistics/demand-queue.ts` (new, replaces `request-manager.ts`)
**Key decisions**:
- **Not persisted.** On game load, demand scanners run on first tick and recompute all demands from inventory state + job store. This eliminates request persistence entirely.
- No status enum. No `assignedCarrier`. No `sourceBuilding`. No `assignedAt`. Just (id, buildingId, material, amount, priority, timestamp).
- Sorted cache with dirty flag (same pattern as current RequestManager.pendingCache).
- Emits `logistics:demandCreated` and `logistics:demandConsumed` events (replaces requestCreated/Assigned/Fulfilled/Reset/Removed).
- `countDemands()` replaces `getRequestsForBuilding().filter(...)` — used by scanners to avoid over-requesting.

### 3. Demand scanners
**Files**: `src/game/features/material-requests/material-request-system.ts`, `src/game/features/building-construction/construction-request-system.ts`
**Depends on**: Subsystems 1, 2
**Key decisions**:
- `MaterialRequestSystem.requestMaterials()`: `needed = slotCapacity - currentAmount - demandQueue.countDemands(building, material) - jobStore.getActiveJobCountForDest(building, material)`
- `ConstructionRequestSystem.ensureRequestsForMaterial()`: `cap = remaining - jobStore.getInFlightAmount(building, material) - demandQueue.countDemands(building, material)`. No more separate InFlightTracker injection.
- Dirty-set mechanism unchanged. Event names update: listen for `logistics:demandConsumed` instead of `logistics:requestFulfilled`.
- On job cancellation: carrier drops material (existing MaterialTransfer.drop), inventory is still short → dirty-set fires → demand re-created automatically next tick. No explicit "reset to pending" needed.

### 4. Supply matching
**Files**: `src/game/features/logistics/fulfillment-matcher.ts`, `src/game/features/logistics/request-matcher.ts`
**Depends on**: Subsystem 1
**Key decisions**:
- `MatchOptions.reservationManager` replaced by `MatchOptions.jobStore: TransportJobStore`
- `iterateMatchCandidates()`: instead of `reservationManager.getReservedAmount()`, calls `jobStore.getReservedAmount(supply.buildingId, material)` to compute effective available supply
- `DemandEntry` has the same fields the matcher reads (`buildingId`, `materialType`, `amount`) — drop-in replacement for `ResourceRequest` in matcher signatures
- `RequestMatcher` renamed to `SupplyMatcher` for clarity

### 5. Dispatcher + assignment
**Files**: `src/game/features/logistics/logistics-dispatcher.ts`, `src/game/features/logistics/carrier-assigner.ts`
**Depends on**: Subsystems 1, 2, 4
**Key decisions**:
- `LogisticsDispatcher` no longer creates `InventoryReservationManager` or `InFlightTrackerImpl` — replaced by job store queries
- `assignPendingRequests()` → `assignPendingDemands()`: iterates `demandQueue.getSortedDemands()`, matches supply, creates job via `TransportJobService.activate()`, then `demandQueue.consumeDemand(demandId)`
- `TransportJobService.activate()` now: (1) verifies available supply via `jobStore.getReservedAmount()`, (2) creates job record (phase=Reserved), (3) adds to job store. No separate reservation object. The job's existence at phase=Reserved IS the reservation.
- `handleBuildingDestroyed()` simplified: just iterate `jobStore.getJobsForBuilding()`, cancel relevant jobs. No separate reservation cleanup step.
- `PreAssignmentQueue` deps simplified: `TransportJobDeps` no longer includes reservation manager or in-flight tracker.

### 6. Job lifecycle
**Files**: `src/game/features/logistics/transport-job-service.ts`
**Depends on**: Subsystem 1
**Key decisions**:
- `activate()`: creates `TransportJobRecord` with phase=Reserved, adds to job store. Verifies unreserved supply via `jobStore.getAvailableSupply()`. If insufficient → returns null. No `InventoryReservationManager.createReservation()`.
- `pickUp()`: asserts phase=Reserved, transitions to PickedUp. Calls `inventoryManager.withdrawOutput()` (plain withdrawal, no reserved/unreserved distinction). The phase transition removes it from "reserved" queries.
- `deliver()`: asserts phase=PickedUp, transitions to Delivered. Emits fulfillment event.
- `cancel()`: if Reserved → just delete job (reservation released implicitly). If PickedUp → carrier drops material via MaterialTransfer (existing behavior). Emits cancel event.
- `redirectSource()`: updates `sourceBuilding` on job record, reindexes in job store. No reservation transfer needed.
- `TransportJobDeps` simplified: `{ jobStore, demandQueue, eventBus, inventoryManager }`

### 7. Inventory slot cleanup
**Files**: `src/game/systems/inventory/inventory-slot.ts`, `src/game/systems/inventory/building-inventory.ts`
**Key decisions**:
- Remove `reservedAmount` field from `InventorySlot`
- Delete functions: `reserve()`, `releaseReservation()`, `withdrawReserved()`, `getUnreservedAmount()`
- `BuildingInventoryManager`: delete `reserveOutput()`, `releaseOutputReservation()`, `withdrawReservedOutput()`, `getUnreservedOutputAmount()`
- `withdrawOutput()` becomes the sole withdrawal method — no reserved/unreserved distinction
- Serialization: remove `reserved` field from `SerializedInventorySlot`

### 8. Stall detection
**Files**: `src/game/features/logistics/stall-detector.ts`
**Depends on**: Subsystem 1
**Key decisions**:
- Instead of querying `requestManager.getStalledRequests()`, query job store directly: find jobs where phase is Reserved and creation time exceeds timeout
- Add `createdAt: number` field to `TransportJobRecord` for stall detection (game time)
- `StallDetectorConfig` takes `jobStore` instead of `requestManager`

### 9. Debug + snapshot
**Files**: `src/game/features/logistics/logistics-snapshot.ts`, `src/composables/useBuildingDebugInfo.ts`, `src/game/debug/timeline-recording.ts`
**Depends on**: Subsystem 1
**Key decisions**:
- `gatherRequests()` → `gatherDemands()` — reads from demand queue (simpler, no status)
- `gatherReservations()` → removed (reservations are derived from jobs, already shown in `gatherTransportJobs()`)
- `gatherTransportJobs()` — already reads from activeJobs, enriched with phase info
- `useBuildingDebugInfo.ts`: query `jobStore.getJobsForBuilding()` instead of `requestManager.getRequestsForBuilding()`
- `timeline-recording.ts`: remove `slot.reservedAmount` from formatted output
- `formatSlots()` in timeline: no reservedAmount to display

### 10. Deletion + barrel cleanup
**Files**: `src/game/features/logistics/index.ts`, `src/game/event-bus.ts`, persistence files
**Key decisions**:
- **Delete files**: `inventory-reservation.ts`, `in-flight-tracker.ts`, `request-manager.ts`, `resource-request.ts`, `request-manager-feature.ts`
- **New files**: `transport-job-store.ts`, `demand-queue.ts`, `demand-queue-feature.ts`
- Barrel: remove all `RequestManager`, `RequestStatus`, `InventoryReservation`, `InFlightTracker` exports. Add `TransportJobStore`, `DemandQueue`, `DemandEntry`, `DemandPriority`.
- Event bus: remove `logistics:requestCreated/Assigned/Fulfilled/Reset/Removed`. Add `logistics:demandCreated`, `logistics:demandConsumed`. Keep `logistics:noMatch`, `logistics:noCarrier`, `logistics:buildingCleanedUp`.
- `game-services.ts`: expose `demandQueue` and `jobStore` instead of `requestManager`
- `game-state-persistence.ts`: remove `SerializedRequest` type, remove request persistence. Job store persistence already handled by `PersistentIndexedMap`.

## File Map

### New Files
| File | Subsystem | Purpose |
|------|-----------|---------|
| `src/game/features/logistics/transport-job-store.ts` | 1 | Single source of truth: indexed jobs + derived queries |
| `src/game/features/logistics/demand-queue.ts` | 2 | Stateless prioritized demand queue |
| `src/game/features/logistics/demand-queue-feature.ts` | 2 | Feature module registration for DemandQueue |

### Deleted Files
| File | Reason |
|------|--------|
| `src/game/features/logistics/inventory-reservation.ts` | Reservations derived from job store |
| `src/game/features/logistics/in-flight-tracker.ts` | In-flight derived from job store |
| `src/game/features/logistics/request-manager.ts` | Replaced by demand-queue.ts |
| `src/game/features/logistics/resource-request.ts` | Replaced by DemandEntry in demand-queue.ts |
| `src/game/features/logistics/request-manager-feature.ts` | Replaced by demand-queue-feature.ts |

### Modified Files
| File | Change |
|------|--------|
| `src/game/systems/inventory/inventory-slot.ts` | Remove `reservedAmount`, delete reservation functions |
| `src/game/systems/inventory/building-inventory.ts` | Remove reservation methods, simplify withdrawal |
| `src/game/features/logistics/transport-job-service.ts` | Simplified deps, no reservation manager |
| `src/game/features/logistics/transport-job-record.ts` | `requestId` → `demandId`, add `createdAt` |
| `src/game/features/logistics/logistics-dispatcher.ts` | Own TransportJobStore, remove reservation/in-flight instantiation |
| `src/game/features/logistics/logistics-dispatcher-feature.ts` | Wire TransportJobStore, remove reservation persistence |
| `src/game/features/logistics/carrier-assigner.ts` | Use TransportJobStore deps |
| `src/game/features/logistics/request-matcher.ts` | Rename to supply-matcher, use job store for available supply |
| `src/game/features/logistics/fulfillment-matcher.ts` | `MatchOptions.reservationManager` → `MatchOptions.jobStore` |
| `src/game/features/logistics/pre-assignment-queue.ts` | Simplified TransportJobDeps |
| `src/game/features/logistics/stall-detector.ts` | Query job store instead of request manager |
| `src/game/features/logistics/match-diagnostics.ts` | Accept DemandEntry instead of ResourceRequest |
| `src/game/features/logistics/fulfillment-diagnostics.ts` | Accept DemandEntry, use job store |
| `src/game/features/logistics/logistics-snapshot.ts` | Read from demand queue + job store |
| `src/game/features/logistics/throttled-emitter.ts` | No change (generic) |
| `src/game/features/logistics/index.ts` | Update barrel exports |
| `src/game/features/material-requests/material-request-system.ts` | Use DemandQueue + TransportJobStore |
| `src/game/features/material-requests/material-request-feature.ts` | Wire DemandQueue instead of RequestManager |
| `src/game/features/building-construction/construction-request-system.ts` | Use DemandQueue + TransportJobStore |
| `src/game/features/building-construction/building-construction-feature.ts` | Wire new deps |
| `src/game/game-services.ts` | Expose demandQueue + jobStore |
| `src/game/event-bus.ts` | Replace request events with demand events |
| `src/game/state/game-state-persistence.ts` | Remove SerializedRequest type |
| `src/game/debug/event-formatting.ts` | Update event formatters |
| `src/game/debug/timeline-recording.ts` | Remove reservedAmount from slot formatting |
| `src/composables/useBuildingDebugInfo.ts` | Query job store instead of request manager |
| `tests/unit/economy/fulfillment-matcher.spec.ts` | Update to use job store |
| `tests/unit/economy/transport-job.spec.ts` | Update to use simplified deps |
| `tests/unit/integration/economy/carrier-inventory.spec.ts` | Update service references |

## Verification
- All existing logistics integration tests pass (behavioral equivalence)
- Carrier picks up reserved material without double-booking (two carriers never grab same source stock)
- Building destruction correctly cancels all jobs referencing it and drops carried material
- Game save/load round-trip: jobs restored, demands recomputed on first tick, carriers resume mid-transport
- Construction site parallel delivery still works (multiple carriers, capped by job store query)
