# Entity Job ID — Design

## Overview

Add a universal numeric `jobId` field to `Entity` so units are self-describing about their current activity. This eliminates the dual-state problem where `TransportJobStore` (persistent) and `ChoreoSystem` (transient) independently track what a carrier is doing — diverging on hot-reload or save/load. Transport jobs become fully transient (not persisted), and on restore the system reconstructs them from entity state + slot reservations. Garrison units also get proper job IDs — both en-route and inside towers — enabling reliable restore from entity state alone.

## Current State

- **Entity** has no field indicating what job it's doing. That information lives in `SettlerTaskSystem.runtimes` (transient `IndexedMap<entityId, UnitRuntime>`) and, for carriers, duplicated in `TransportJobStore.jobs` (persisted `PersistentIndexedMap`).
- **Worker jobs** (woodcutter, miner, etc.) are serialized as `SerializedJobIntent` in `settler-task-persistence.ts` — job ID + safe node index. On restore, the choreography is re-walked from the snapped node. This works because worker choreos come from the XML choreography store (non-synthetic).
- **Transport jobs** are `synthetic: true` (built by `TransportJobBuilder`) so they're excluded from `settler-task-persistence`. Instead, `TransportJobRecord` is persisted in the job store, and `onRestoreComplete` tries to reconcile. This is where the divergence bug lives.
- **Slot reservations** (`PileSlot.reservations`) are keyed by `jobId` (transport job ID), not `carrierId`.
- **Garrison en-route** units use `WORKER_DISPATCH` (synthetic choreo) to walk to a tower. Once inside, the job completes and `runtime.job = null`. The unit is tracked by `UnitReservationRegistry` (purpose `'garrison'`) and `entity.hidden = true`. On restore, en-route units are rebuilt in `tower-garrison-feature.ts` `onTerrainReady()` by scanning `locationManager.getEnRouteEntries()` — fragile, depends on location manager's approaching status surviving restore.
- **Garrisoned units** (inside tower) have no job — tracked only by `garrisons` Map in `TowerGarrisonManager` + `UnitReservationRegistry`. On restore, the garrisons map is rebuilt by scanning buildings, then units inside are detected via location manager. No direct link from entity to tower.

### What stays
- `UnitRuntime` and the choreo execution pipeline — these remain the runtime execution engine
- `SerializedJobIntent` for worker job persistence — workers have XML-based choreos that can re-walk
- `TransportJobBuilder` and transport executor choreographies
- `SlotReservation` structure (but keyed differently)

### What changes
- `Entity` gets a numeric `jobId` field
- A global job ID counter lives on `GameState` (persisted)
- `TransportJobStore.jobs` stops being persisted
- Slot reservations re-key from `jobId` to `carrierId`
- `onRestoreComplete` for logistics becomes entity-scan reconstruction
- `isTransportBusy` derives from `entity.jobId` instead of `jobStore.jobs.has()`
- Garrison creates proper job records with numeric IDs for units inside towers

### What gets deleted
- `PersistentIndexedMap` usage for transport jobs → plain `IndexedMap`
- `persistence: [jobStore.jobs, jobStore.nextJobIdStore]` from logistics-dispatcher-feature
- `reconcileOrphanedJobs()` / old `cancelReservedJobs()`
- `nextJobIdStore` in TransportJobStore — replaced by global counter

## Summary for Review

- **Interpretation**: Add `entity.jobId` (numeric) as the single source of truth for "is this unit busy?". All job types — transport, choreo, garrison — share one global ID counter. Transport job records become transient. Garrison gets a proper `GarrisonJobRecord` so garrisoned units have a real job ID linking them to their tower.
- **Key decisions**: (1) `jobId` is `number | undefined` on Entity, allocated from `GameState.nextJobId` global counter. (2) Slot reservations re-key from transport `jobId` to `carrierId` so reservations survive independently of job records. (3) Garrison creates a `GarrisonJobRecord` (jobId → buildingId mapping) stored in `TowerGarrisonManager`. On restore, scan entities for garrison jobIds and rebuild the garrisons map. (4) `isTransportBusy` reads `entity.jobId != null` — any active job means busy.
- **Assumptions**: Worker job persistence continues via `SerializedJobIntent` (no changes to that path). Workers also get numeric jobIds set via `assignJob`, but their persistence path is unchanged.
- **Scope**: Entity field + global counter + transport transient + slot re-key + garrison job records + restore reconstruction.

## Conventions

- Optimistic programming: no `?.` on required deps, `getEntityOrThrow`, fail loudly
- 3+ constructor deps → use `*Config` interface
- Features own their state, not GameState — but `Entity` is the exception (shared across all systems)
- `entity.jobId` is nullable-by-design (idle units have none) — `?.` is OK here
- File max 600 lines TS, function max 250 lines (aim ≤80), complexity max 15
- Event format: `"<domain>:<past-tense>"`
- No `Pick`/`Omit` in public interfaces

## Architecture

### Subsystems

| # | Subsystem | Responsibility | Depends On | Files |
|---|-----------|---------------|------------|-------|
| 1 | Entity field & global counter | Add `jobId` to Entity, `nextJobId` counter to GameState | — | `src/game/entity.ts`, `src/game/game-state.ts` |
| 2 | Slot re-key | Change slot reservations from jobId to carrierId | — | `src/game/systems/inventory/pile-slot.ts`, `src/game/systems/inventory/building-inventory.ts` |
| 3 | Job store transient | Remove persistence from transport jobs, use global counter | 1, 2 | `src/game/features/logistics/transport-job-store.ts`, `src/game/features/logistics/transport-job-service.ts` |
| 4 | Restore reconstruction | Rebuild transport jobs from entity state on restore | 1, 2, 3 | `src/game/features/logistics/logistics-dispatcher.ts`, `src/game/features/logistics/logistics-dispatcher-feature.ts` |
| 5 | Busy check simplification | Derive `isTransportBusy` from entity.jobId | 1 | `src/game/features/carriers/carrier-feature.ts`, `src/game/systems/idle-carrier-pool.ts` |
| 6 | Runtime sync | Set/clear entity.jobId in assignJob/completeJob/interruptJob | 1 | `src/game/features/settler-tasks/settler-task-system.ts`, `src/game/features/settler-tasks/internal/worker-job-lifecycle.ts` |
| 7 | Garrison jobs | Proper job records for garrisoned units, restore from entity state | 1, 6 | `src/game/features/tower-garrison/tower-garrison-manager.ts`, `src/game/features/tower-garrison/tower-garrison-feature.ts` |

## Shared Contracts

```typescript
// ── Entity (entity.ts) ──────────────────────────────────────

export interface Entity {
    // ... existing fields ...

    /**
     * Numeric job identifier. Set when a job is assigned, cleared when the job
     * completes or is interrupted. Undefined means the unit is idle.
     * Persisted with the entity.
     *
     * Allocated from GameState.allocateJobId(). All job types share one ID space.
     */
    jobId?: number;
}

// ── GameState additions ─────────────────────────────────────

// Global monotonic counter for job IDs (persisted)
allocateJobId(): number;

// ── SlotReservation (pile-slot.ts) ───────────────────────────

export interface SlotReservation {
    /** Carrier entity ID that owns this reservation. */
    readonly carrierId: number;
    /** Amount reserved. */
    readonly amount: number;
}

// ── BuildingInventoryManager signature changes ───────────────

reserveSlot(slotId: number, carrierId: number, amount: number): void;
unreserveSlot(slotId: number, carrierId: number): void;
// New: find reservation by carrier (for restore reconstruction)
findReservationByCarrier(carrierId: number): { slotId: number; slot: PileSlot } | undefined;

// ── GarrisonJobRecord (tower-garrison types.ts) ──────────────

/** Links a garrisoned unit to its tower via a proper job ID. */
export interface GarrisonJobRecord {
    readonly jobId: number;
    readonly unitId: number;
    readonly buildingId: number;
}
```

## Subsystem Details

### 1. Entity field & global counter
**Files**: `src/game/entity.ts`, `src/game/game-state.ts`
**Key decisions**:
- `jobId` is `number | undefined` — numeric, not string. Allocated from a global counter.
- Add `clearJobId(entity)` helper alongside existing `clearCarrying(entity)`
- `GameState` gets a persisted `nextJobId` counter and `allocateJobId()` method. This counter survives save/load so IDs don't collide with entity.jobId values that were persisted on entities.
- Field is optional (undefined = idle) — consistent with `carrying`, `hidden`, `level`

### 2. Slot re-key
**Files**: `src/game/systems/inventory/pile-slot.ts`, `src/game/systems/inventory/building-inventory.ts`
**Key decisions**:
- `SlotReservation` drops `jobId`, keeps `carrierId` as the primary key — carriers are the stable identity that survives restore
- `reserveSlot` / `unreserveSlot` change signature: `carrierId` replaces `jobId` as the lookup key
- Add `findReservationByCarrier(carrierId)` — scans all slots for a reservation by this carrier. Used during restore to find where a carrier was delivering. Linear scan is fine — only runs once on restore.
- All callers of `reserveSlot` / `unreserveSlot` must be updated (transport-job-service.ts `activate`, `deliver`, `cancel`)

### 3. Job store transient
**Files**: `src/game/features/logistics/transport-job-store.ts`, `src/game/features/logistics/transport-job-service.ts`
**Depends on**: Subsystems 1, 2
**Key decisions**:
- `TransportJobStore.jobs` changes from `PersistentIndexedMap` to plain `IndexedMap` — no serialization
- Delete `nextJobIdStore` — transport job IDs come from `GameState.allocateJobId()` now
- `TransportJobService.deliver()` and `cancel()` clear `entity.jobId`
- `entity.jobId` is set by `assignJob()` in subsystem 6 — keeps the single sync point
- Update `reserveSlot` / `unreserveSlot` calls to pass `carrierId` instead of `record.id`

### 4. Restore reconstruction
**Files**: `src/game/features/logistics/logistics-dispatcher.ts`, `src/game/features/logistics/logistics-dispatcher-feature.ts`
**Depends on**: Subsystems 1, 2, 3
**Key decisions**:
- `onRestoreComplete` calls `rebuildFromEntities()` instead of `reconcileOrphanedJobs()`
- `rebuildFromEntities()` logic:
  1. Scan all carrier entities with `entity.jobId != null`
  2. For carriers with `entity.carrying` set: find their slot reservation via `findReservationByCarrier(carrierId)`, reconstruct a `TransportJobRecord` in PickedUp phase, build delivery-only choreo, assign via `assignJob`
  3. For carriers without `entity.carrying` (Reserved phase that never picked up): clear `entity.jobId`, release slot reservation — demand will be re-created by scanners
  4. Skip carriers whose jobId belongs to a non-transport job (workers temporarily carrying goods have `carrying` set but their jobId is a worker choreo — filter by checking `UnitType === Carrier`)
- Delete `reconcileOrphanedJobs()` entirely
- Remove `persistence: [jobStore.jobs, jobStore.nextJobIdStore]` — replace with `persistence: []`

**Behavior** (non-obvious):
- The reconstructed `TransportJobRecord` gets a fresh job ID from `GameState.allocateJobId()` — doesn't need to match the old ID since slot reservations are keyed by carrierId
- `rebuildFromEntities` must run after `carrierRegistry.rebuildFromEntities()` (carrier feature's onRestoreComplete) so carriers are registered

### 5. Busy check simplification
**Files**: `src/game/features/carriers/carrier-feature.ts`, `src/game/systems/idle-carrier-pool.ts`
**Depends on**: Subsystem 1
**Key decisions**:
- `isTransportBusy` closure changes to `(carrierId) => gameState.getEntity(carrierId)?.jobId != null` — reads directly from entity, no job store lookup
- `setIsTransportBusy` late-binding mechanism can stay (avoids circular dependency) but the closure body simplifies
- Alternatively: `IdleCarrierPool` reads `entity.jobId` directly and `setIsTransportBusy` is removed entirely. Prefer this if it doesn't create import issues.

### 6. Runtime sync
**Files**: `src/game/features/settler-tasks/settler-task-system.ts`, `src/game/features/settler-tasks/internal/worker-job-lifecycle.ts`
**Depends on**: Subsystem 1
**Key decisions**:
- `assignJob()`: allocate a numeric ID from `GameState.allocateJobId()`, set `entity.jobId = id`. Store this ID on the `ChoreoJobState` as well (or just on the entity — the runtime doesn't need it).
- `completeJob()`: clear `entity.jobId` (set to undefined)
- `interruptJob()`: clear `entity.jobId`
- This makes `entity.jobId` always in sync with `runtime.job` — the entity is the persistent mirror of the transient runtime
- `isTransportBusy` checks `entity.jobId != null` (any job = busy). A carrier with ANY active job is busy.

### 7. Garrison jobs
**Files**: `src/game/features/tower-garrison/tower-garrison-manager.ts`, `src/game/features/tower-garrison/tower-garrison-feature.ts`, `src/game/features/tower-garrison/types.ts`
**Depends on**: Subsystems 1, 6
**Key decisions**:
- **En-route** units get `entity.jobId` automatically via subsystem 6 (`assignJob` sets it when the `WORKER_DISPATCH` choreo is assigned). When the job completes (unit enters building), `completeJob()` clears it.
- **Garrisoned** units get a new `entity.jobId` allocated by `finalizeGarrison()`. This is a separate job representing "occupy this tower". `TowerGarrisonManager` maintains a `Map<number, GarrisonJobRecord>` (keyed by unitId) mapping jobId → buildingId. This is NOT persisted — rebuilt from entity state on restore.
- `finalizeGarrison()` flow: `completeJob()` clears the WORKER_DISPATCH jobId → `finalizeGarrison()` allocates a new jobId via `GameState.allocateJobId()`, sets `entity.jobId`, creates a `GarrisonJobRecord`.
- `ejectUnit()`: clears `entity.jobId`, removes the `GarrisonJobRecord`.
- On restore (`onRestoreComplete`): scan all unit entities. If `entity.hidden === true` and entity is inside a garrison-capable building (check location manager), allocate a fresh garrison jobId, set `entity.jobId`, create a `GarrisonJobRecord`, add to garrisons map. This replaces the current building-scan approach with entity-driven reconstruction.
- En-route restore (`onTerrainReady`): unchanged — scans location manager for approaching units, re-dispatches them. `assignJob` will set `entity.jobId` naturally.

**Behavior** (non-obvious):
- `completeJob()` runs first and clears `entity.jobId`. Then the `settler-location:entered` event fires, which triggers `finalizeGarrison()`. `finalizeGarrison()` allocates a NEW jobId — no conflict with the cleared one. Verify this event ordering: `completeJob` in `worker-job-lifecycle.ts` clears `runtime.job` and sets state to IDLE *before* emitting `settler:taskCompleted`. The location manager's `enterBuilding` is called *during* the ENTER_BUILDING node execution (before completeJob). So actually `settler-location:entered` fires BEFORE `completeJob` clears jobId. **Fix**: `finalizeGarrison` should be called from `settler:taskCompleted` event (which fires after jobId is cleared), not from `settler-location:entered`. Or: add a dedicated `garrison:readyToFinalize` event emitted after completeJob.

## File Map

### New Files
None.

### Modified Files

| File | Change |
|------|--------|
| `src/game/entity.ts` | Add `jobId?: number` field, add `clearJobId()` helper |
| `src/game/game-state.ts` | Add persisted `nextJobId` counter, `allocateJobId()` method |
| `src/game/systems/inventory/pile-slot.ts` | Re-key `SlotReservation`: drop `jobId`, keep `carrierId` |
| `src/game/systems/inventory/building-inventory.ts` | Update `reserveSlot`/`unreserveSlot` signatures, add `findReservationByCarrier()` |
| `src/game/features/logistics/transport-job-store.ts` | `IndexedMap` instead of `PersistentIndexedMap`, remove `nextJobIdStore`, use `GameState.allocateJobId()` |
| `src/game/features/logistics/transport-job-service.ts` | Update `reserveSlot`/`unreserveSlot` calls, clear `entity.jobId` in deliver/cancel |
| `src/game/features/logistics/logistics-dispatcher.ts` | Replace `reconcileOrphanedJobs()` with `rebuildFromEntities()` |
| `src/game/features/logistics/logistics-dispatcher-feature.ts` | Remove persistence array, update `onRestoreComplete` |
| `src/game/features/carriers/carrier-feature.ts` | Simplify `isTransportBusy` to read `entity.jobId` |
| `src/game/systems/idle-carrier-pool.ts` | Potentially read `entity.jobId` directly |
| `src/game/features/settler-tasks/settler-task-system.ts` | Set `entity.jobId` via `allocateJobId()` in `assignJob()` |
| `src/game/features/settler-tasks/internal/worker-job-lifecycle.ts` | Clear `entity.jobId` in `completeJob()` and `interruptJob()` |
| `src/game/features/tower-garrison/types.ts` | Add `GarrisonJobRecord` interface |
| `src/game/features/tower-garrison/tower-garrison-manager.ts` | Maintain `GarrisonJobRecord` map, set/clear `entity.jobId` in finalizeGarrison/ejectUnit |
| `src/game/features/tower-garrison/tower-garrison-feature.ts` | Rebuild garrison state from entity.jobId + entity.hidden on restore |

### Deleted code
| Location | What |
|----------|------|
| `transport-job-store.ts` | `PersistentIndexedMap` usage, `nextJobIdStore` field |
| `logistics-dispatcher.ts` | `reconcileOrphanedJobs()` method |
| `logistics-dispatcher-feature.ts` | `persistence: [jobStore.jobs, jobStore.nextJobIdStore]` |
| `pile-slot.ts` | `SlotReservation.jobId` field |

## Verification

1. **Hot reload with active transport**: Start a game, let carriers pick up materials, hot-reload. Carriers should resume delivery without stalling.
2. **Save/load round-trip**: Save mid-delivery, load. Carriers holding materials reconstruct their delivery jobs and complete them.
3. **Building destroyed mid-delivery**: Destroy a destination building while carrier is en route. Job should cancel, carrier drops material.
4. **Idle carrier availability**: After all deliveries complete, `entity.jobId` is cleared and carriers appear in the idle pool for new assignments.
5. **Garrison save/load**: Garrison units, save, load. Units inside towers have `entity.jobId` set, garrison manager rebuilds its state from entity scan.
6. **Garrison en-route save/load**: Send unit to garrison, save mid-walk, load. Unit is re-dispatched to the tower and `entity.jobId` is set by `assignJob`.
7. **Ungarrison**: Eject a unit from a tower. `entity.jobId` is cleared, unit becomes available.
