# Push-Based Worker-Building Assignment — Design

## Overview

Replace the pull model (idle settlers scan all buildings every 10 ticks) with a push model (buildings emit demands when they need workers). This eliminates the O(settlers × buildings) idle scan, the main perf bottleneck in SettlerTaskSystem (~28ms/frame).

## Current State

- **What exists**: `WorkerTaskExecutor.handleIdle()` calls `resolveHomeBuilding()` → `findNearestWorkplace()` which does a brute-force scan of all player buildings for every idle workplace-settler. This runs every `IDLE_SEARCH_COOLDOWN=10` ticks per idle settler.
- **What stays**:
  - `claimBuilding`/`releaseBuilding` in SettlerTaskSystem (occupancy tracking)
  - `assignInitialBuildingWorkers` (map-load assignment)
  - `handleIdle` still runs for work-target search (finding trees, stones, etc.) — just no longer searches for buildings
  - Roaming workers (Builder, Digger, Carrier) unchanged — they use CONSTRUCTION/CONSTRUCTION_DIG/GOOD handlers, not WORKPLACE
  - Auto-recruitment pipeline in RecruitSystem (carrier→specialist transformation)
- **What gets deleted**:
  - `findNearestWorkplace()` in `work-handlers.ts`
  - `resolveHomeBuilding()` in `worker-task-executor.ts`
  - Building-search logic inside `handleIdle` — the `claimBuilding`/`releaseBuilding` params, the "no_home" skip path
  - `OccupancyMap` type export from `worker-task-executor.ts`
  - `boundClaimBuilding`/`boundReleaseBuilding` closures in `UnitStateMachine`

## Summary for Review

- **Interpretation**: Buildings own their worker demand. When a building needs a worker (construction completes, worker dies, worker reassigned), it emits a demand. RecruitSystem first tries to assign an existing idle specialist, falling back to carrier recruitment. Settlers no longer scan for buildings.
- **Key decisions**:
  - All logic lives in RecruitSystem — no new services. It already has the demand queue, carrier search, and fulfillment loop. Adding idle-specialist-first is a small extension to `tryFulfillDemand`.
  - SettlerTaskSystem exposes two callbacks for RecruitSystem: `findIdleSpecialist(unitType, player, nearX, nearY)` and `assignWorkerToBuilding(settlerId, buildingId)`
  - Idle specialists are preferred over carrier recruitment (no transformation delay)
  - `buildingId` threaded through the transform pipeline so the transformed specialist gets auto-assigned
  - Diggers/builders are explicitly excluded — they're roaming workers, not building-assigned
- **Assumptions**:
  - A specialist can only work at buildings matching its type (existing `getWorkerBuildingTypes` logic)
  - When a worker dies, a new demand is created immediately (no cooldown)
  - When a building is destroyed, any pending demand for it is discarded (existing `demand.buildingId` check handles this)
- **Scope**: Worker-building assignment only. Does not change how workers find work targets (trees, ores, etc.) once assigned.

## Conventions

- Optimistic programming: no `?.` on required deps, no silent fallbacks, crash loudly
- Event names: `"domain:pastTense"` (e.g., `'building:workerLost'`)
- TickSystem for per-frame behavior; events for cross-system communication
- Features don't import systems; systems don't import features — communicate via events
- Deterministic iteration: sort maps/sets by key for replay consistency
- Max 140 char lines, max complexity 15 per function

## Architecture

### Subsystems

| # | Subsystem | Responsibility | Depends On | Files |
|---|-----------|---------------|------------|-------|
| 1 | Demand Events | Emit `building:workerLost` when building loses worker; expose callbacks for external assignment | — | `src/game/features/settler-tasks/settler-task-system.ts`, `src/game/event-bus.ts` |
| 2 | Recruit Integration | Listen for `building:workerLost` + `building:completed`; try idle specialists first in `tryFulfillDemand`; thread `buildingId` through transform pipeline; auto-assign on completion | 1 | `src/game/systems/recruit/recruit-system.ts`, `src/game/systems/recruit/unit-transformer.ts` |
| 3 | Idle Loop Cleanup | Remove building-search from handleIdle; settlers with no `homeAssignment` simply skip work search (for WORKPLACE type) | — | `src/game/features/settler-tasks/worker-task-executor.ts`, `src/game/features/settler-tasks/unit-state-machine.ts`, `src/game/features/settler-tasks/work-handlers.ts` |
| 4 | Tests | Update auto-recruit tests, add idle-specialist-claims-building test | 1,2,3 | `tests/unit/integration/world/building-worker-auto-recruit.spec.ts` |

## Shared Contracts

```typescript
// ── event-bus.ts — new events ──

/** Emitted when a building's worker is lost (died, reassigned by player move command).
 *  NOT emitted when the building itself is destroyed. */
'building:workerLost': {
    buildingId: number;
    buildingType: BuildingType;
    settlerId: number;
    player: number;
    race: Race;
};

// ── settler-task-system.ts — new public API (callbacks for RecruitSystem) ──

/** Find nearest idle specialist of given type with no home assignment.
 *  Returns entity ID or null. */
findIdleSpecialist(unitType: UnitType, player: number, nearX: number, nearY: number): number | null;

/** Assign a settler to a building externally (from recruit system).
 *  Calls claimBuilding internally. */
assignWorkerToBuilding(settlerId: number, buildingId: number): void;

// ── recruit-system.ts — modified WorkerDemand ──

interface WorkerDemand {
    unitType: UnitType;
    toolMaterial: EMaterialType | null;
    tileX: number;
    tileY: number;
    player: number;
    race: Race;                    // NEW — needed for idle specialist lookup
    cap?: number;
    buildingId?: number;           // existing, now always set for building worker demands
}

// ── unit-transformer.ts — modified PendingTransform ──

interface PendingTransform {
    carrierId: number;
    targetUnitType: UnitType;
    toolMaterial: EMaterialType | null;
    pileEntityId: number;
    buildingId?: number;           // NEW — auto-assign on completion
}
```

## Subsystem Details

### 1. Demand Events
**Files**: `src/game/features/settler-tasks/settler-task-system.ts`, `src/game/event-bus.ts`
**Key decisions**:
- `building:workerLost` emitted from `releaseBuilding` when the building still exists — covers worker death (`onEntityRemoved`), player move (`assignMoveTask`), and approach interruption
- Do NOT emit when the building itself is being destroyed (`onBuildingRemoved` path sets `homeAssignment = null` directly, not via `releaseBuilding`)
- `findIdleSpecialist`: iterates `runtimes`, finds settlers with `state === IDLE && homeAssignment === null` and matching `UnitType`, returns nearest to `(nearX, nearY)`
- `assignWorkerToBuilding`: calls `claimBuilding(runtime, buildingId)` internally — same path as before, just triggered externally

### 2. Recruit Integration
**Files**: `src/game/systems/recruit/recruit-system.ts`, `src/game/systems/recruit/unit-transformer.ts`
**Key decisions**:
- `tryFulfillDemand` gains a new first step: if `demand.buildingId` is set, call `findIdleSpecialist()` callback. If found, call `assignWorkerToBuilding()` callback → demand fulfilled, return true.
- Only then fall back to carrier transformation (existing logic)
- `building:workerLost` listener creates a new `WorkerDemand` with `buildingId` (same shape as `building:completed` demands)
- Existing `building:completed` listener already sets `buildingId` — just add `race` field
- `requestTransform` / `requestDirectTransform` gain optional `buildingId` param, stored in `PendingTransform`
- On `handleCompleted`: if `pendingTransform.buildingId` is set and building still exists, call `assignWorkerToBuilding(carrierId, buildingId)` after type mutation
- Construction worker demands (Builder/Digger) unchanged — no `buildingId`, have `cap`
- RecruitSystem receives `findIdleSpecialist` and `assignWorkerToBuilding` as constructor config callbacks (no direct import of SettlerTaskSystem)

### 3. Idle Loop Cleanup
**Files**: `src/game/features/settler-tasks/worker-task-executor.ts`, `src/game/features/settler-tasks/unit-state-machine.ts`, `src/game/features/settler-tasks/work-handlers.ts`
**Key decisions**:
- `handleIdle` no longer receives `buildingOccupants`, `claimBuilding`, `releaseBuilding` params
- `resolveHomeBuilding()` deleted entirely
- For WORKPLACE settlers: if `homeAssignment === null`, skip work search (emit `idleSkipped` with `no_home`). Building assignment now comes from external push only.
- For non-WORKPLACE settlers (TREE, STONE, CONSTRUCTION, etc.): `handleIdle` unchanged — they find work targets, not buildings
- `UnitStateMachine.handleIdle` simplified: no longer passes building occupancy closures
- Delete `findNearestWorkplace` from `work-handlers.ts`
- Remove `OccupancyMap` type, `boundClaimBuilding`, `boundReleaseBuilding`

### 4. Tests
**Files**: `tests/unit/integration/world/building-worker-auto-recruit.spec.ts`
**Key decisions**:
- Existing tests should still pass (carrier→specialist flow unchanged, just adds auto-assignment)
- New test: "idle specialist claims vacant building" — place a building, have an idle specialist nearby, verify assignment without carrier transformation
- New test: "worker death triggers re-recruitment" — assign worker, kill it, verify new demand created and fulfilled
- New test: "player moves worker away triggers re-recruitment" — assign move task, verify building gets new worker

## File Map

### New Files
None.

### Modified Files
| File | Change |
|------|--------|
| `src/game/event-bus.ts` | Add `building:workerLost` event |
| `src/game/features/settler-tasks/settler-task-system.ts` | Emit `building:workerLost` on worker release; add `findIdleSpecialist()` and `assignWorkerToBuilding()` public methods |
| `src/game/systems/recruit/recruit-system.ts` | Try idle specialists first in `tryFulfillDemand`; listen for `building:workerLost`; add `race` to WorkerDemand; receive assignment callbacks in config |
| `src/game/systems/recruit/unit-transformer.ts` | Thread `buildingId` through PendingTransform; auto-assign on `handleCompleted` |
| `src/game/features/settler-tasks/worker-task-executor.ts` | Remove `resolveHomeBuilding`, building occupancy params from `handleIdle` |
| `src/game/features/settler-tasks/unit-state-machine.ts` | Remove `boundClaimBuilding`/`boundReleaseBuilding`, simplify `handleIdle` call |
| `src/game/features/settler-tasks/work-handlers.ts` | Delete `findNearestWorkplace` |
| `tests/unit/integration/world/building-worker-auto-recruit.spec.ts` | Add idle-specialist and re-recruitment tests |

### Deleted Exports
| Symbol | File | Reason |
|--------|------|--------|
| `findNearestWorkplace` | `work-handlers.ts` | No longer needed |
| `OccupancyMap` | `worker-task-executor.ts` | No longer passed to handleIdle |

## Verification
1. **Existing auto-recruit**: Place WoodcutterHut without spawning worker → carrier transforms → woodcutter auto-assigned to building → starts working
2. **Idle specialist assignment**: Idle woodcutter exists, place new WoodcutterHut → woodcutter assigned without carrier transformation
3. **Worker death re-recruitment**: Kill a building's worker → `building:workerLost` → new demand → carrier transforms → new worker assigned
4. **Player moves worker**: Player move-commands a worker away → building gets new worker (idle specialist or recruited carrier)
5. **Building destroyed**: Destroy building → no demand emitted, any pending demand discarded
6. **Roaming workers unaffected**: Builders/diggers still find construction sites via CONSTRUCTION/CONSTRUCTION_DIG handlers
