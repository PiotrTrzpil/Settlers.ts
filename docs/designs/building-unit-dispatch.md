# Building-Unit Dispatch — Design

## Overview

Unify recruitment, garrisoning, and worker assignment using the **choreography system** as the single execution engine. Today these systems each reimplement "walk to building + enter" with bespoke state machines, arrival detectors, and lifecycle tracking. The choreo system already handles movement, sequencing, interruption, and dynamic job composition — we just need to express the full pipeline as choreo jobs.

The new `ChoreoBuilder` (already implemented in `systems/choreo/choreo-builder.ts`) plus two new task types (`ENTER_BUILDING`, `ENTER_GARRISON`) and a `goToDoor(buildingId)` builder helper make this possible.

## Current State

- **What exists**: Three separate "dispatch unit to building" implementations:
  - **Worker assignment** (SettlerTaskSystem): `claimBuilding` → `markApproaching` → worker enters building implicitly during job choreography. No explicit arrival detection for the initial walk.
  - **Tower garrison** (TowerGarrisonManager): `markEnRoute` → `reserve` + `markApproaching` → `assignMoveTask` → `ArrivalDetector.onMovementStopped` → `tryFinalizeAtDoor` → `finalizeGarrison` → `enterBuilding`. Custom arrival detector, custom en-route tracking.
  - **Recruitment** (UnitTransformer): Builds choreo jobs dynamically (`createRecruitmentJob`, `createDirectTransformJob`), but procurement and dispatch are two disconnected phases linked by events (`recruitment:completed` → `assignWorkerToBuilding`).
  - **Barracks** (BarracksTrainingManager): Builds choreo jobs dynamically (`buildTrainingJob`), but soldier is free after training — no dispatch to garrison.

- **What stays**:
  - `SettlerBuildingLocationManager` as single source of truth for approaching/inside state
  - `UnitReservationRegistry` for preventing double-dispatch
  - Domain-specific slot logic (garrison roles, worker occupancy limits)
  - Candidate selection policies (AutoGarrisonSystem, RecruitSystem demand queue)
  - `ChoreoSystem` executor dispatch (unchanged — just gains new task type executors)
  - Siege system (different pattern — positional combat, not "enter building")

- **What changes**:
  - All "walk to building + enter" flows become choreo jobs using the builder
  - Procurement + dispatch become a single composed choreo job (no event-based handoff)
  - `goToDoor(buildingId)` builder helper resolves approach tile and pushes waypoint
  - `goToDoorAndEnter(buildingId)` / `goToDoorAndGarrison(buildingId)` for the common 2-node suffix
  - `ArrivalDetector` deleted — choreo movement nodes handle arrival
  - `UnitTransformer.handleCompleted` no longer needs `assignWorkerToBuilding` — it's just more nodes in the same job

## Summary for Review

- **Interpretation**: Instead of extracting a new `DispatchLifecycle` abstraction, lean into the choreo system that already solves movement, sequencing, and interruption. Every "get unit to building" flow becomes a choreo job. Procurement (transform, training) is the prefix; dispatch (walk + enter) is the suffix. The builder composes them.
- **Key decisions**:
  - **Choreo-first, no new dispatch abstraction** — the choreo system IS the dispatch lifecycle. `ENTER_BUILDING` and `ENTER_GARRISON` are just new executor nodes.
  - **`goToDoor(buildingId)` on ChoreoBuilder** — resolves approach tile at build time, pushes a `GO_TO_TARGET` waypoint. Needs `GameState` + `TerrainData` context, so the builder gains an optional context parameter.
  - **`goToDoorAndEnter(buildingId)` / `goToDoorAndGarrison(buildingId)`** — convenience methods that emit `goToDoor` + `enterBuilding`/`enterGarrison` as two nodes.
  - **All dispatches reserve during approach** — `ENTER_BUILDING` executor releases reservation on entry; `ENTER_GARRISON` executor transitions to permanent 'garrison' reservation.
  - **Single choreo job for recruit→dispatch** — `goTo(pile).transformRecruit(type).goToDoorAndEnter(buildingId)` replaces the current 2-phase flow (UnitTransformer emits event → SettlerTaskSystem assigns building).
  - **BuildingDemand orchestrator** — replaces `RecruitSystem.pendingDemand`. Selects candidates and builds the right choreo job for the situation. Only tracks `Pending` (no candidate) vs `Committed` (job assigned). No `Procuring`/`Dispatching` phases — the choreo job handles everything.
- **Assumptions**:
  - `goToDoor` resolves approach tile at job-build time. If the tile becomes blocked later, the `GO_TO_TARGET` executor's existing retry logic handles it.
  - Siege is out of scope — different pattern (positional combat, not "enter building").
  - Barracks → garrison chaining is a future extension (trivially composable once this is in place).
- **Scope**:
  - ChoreoBuilder extensions: `goToDoor`, `goToDoorAndEnter`, `goToDoorAndGarrison`, context injection
  - New executors: `ENTER_BUILDING`, `ENTER_GARRISON`
  - Migrate existing dynamic jobs to builder (recruitment-job.ts, barracks-training-manager.ts)
  - BuildingDemand orchestrator for worker buildings (replaces RecruitSystem demand logic)
  - Garrison migration: replace ArrivalDetector + en-route tracking with choreo jobs
  - Does NOT change: player-queued recruitment (`enqueue`), barracks training trigger, XML-parsed job definitions

## Conventions

- Optimistic programming: no `?.` on required deps, no silent fallbacks, crash loudly
- Event names: `"domain:pastTense"` (e.g., `'settler-location:approachInterrupted'`)
- Features don't import systems; systems don't import features — communicate via events/callbacks
- Max 140 char lines, max complexity 15 per function
- `internal/` for module-private files
- Builder lives in `systems/choreo/` (layer 0 — no feature deps). `goToDoor` needs GameState/TerrainData — inject via context object, not direct import.

## Architecture

### How each flow becomes a choreo job

| Flow | Choreo Job |
|------|-----------|
| Idle specialist → workplace | `choreo('WORKER_DISPATCH').goToDoorAndEnter(buildingId).build()` |
| Carrier → tool → specialist → workplace | `choreo('RECRUIT_TO_WORKPLACE').goTo(pile).transformRecruit(type).goToDoorAndEnter(buildingId).build()` |
| Carrier → direct transform → workplace | `choreo('DIRECT_RECRUIT_TO_WORKPLACE').transformDirect(type).goToDoorAndEnter(buildingId).build()` |
| Idle soldier → garrison tower | `choreo('GARRISON_DISPATCH').goToDoorAndGarrison(towerId).build()` |
| Barracks training (existing, migrated) | `choreo('BARRACKS_TRAINING').goTo(door).hidden(dur, 'BARRACKS_TRAINING').changeTypeAtBarracks().target(barracksId).build()` |
| Barracks → garrison (future) | `choreo('BARRACKS_TO_GARRISON').goTo(door).hidden(dur).changeTypeAtBarracks().goToDoorAndGarrison(towerId).target(barracksId).build()` |

### Subsystems

| # | Subsystem | Responsibility | Depends On | Files |
|---|-----------|---------------|------------|-------|
| 1 | ChoreoBuilder extensions | `goToDoor`, `goToDoorAndEnter`, `goToDoorAndGarrison`, context injection | — | `src/game/systems/choreo/choreo-builder.ts` |
| 2 | New executors | `ENTER_BUILDING` and `ENTER_GARRISON` choreo task executors | — | `src/game/features/settler-tasks/internal/dispatch-executors.ts` |
| 3 | Migrate existing jobs | Rewrite `createRecruitmentJob`, `createDirectTransformJob`, `buildTrainingJob` to use builder | 1 | `src/game/systems/recruit/recruitment-job.ts`, `src/game/features/barracks/barracks-training-manager.ts` |
| 4 | BuildingDemand | Orchestrates "building needs worker": candidate selection → build choreo job → assign. Replaces `pendingDemand` in RecruitSystem. | 1, 2 | `src/game/features/building-demand/building-demand-system.ts` |
| 5 | Garrison migration | Replace ArrivalDetector + en-route state machine with choreo jobs via builder | 1, 2 | `src/game/features/tower-garrison/tower-garrison-manager.ts`, `tower-garrison-feature.ts`, `internal/garrison-commands.ts` |
| 6 | RecruitSystem cleanup | Remove `pendingDemand`, auto-demand event listeners, `tryFulfillDemand`. Keep player-queued `enqueue`/`drainQueue`. | 4 | `src/game/systems/recruit/recruit-system.ts` |
| 7 | UnitTransformer cleanup | Remove `buildingId` threading and `assignWorkerToBuilding` callback — building dispatch is now part of the choreo job. | 3 | `src/game/systems/recruit/unit-transformer.ts` |
| 8 | Tests | Verify all flows, migrate existing tests | all | `tests/unit/` |

## Shared Contracts

```typescript
// ── src/game/systems/choreo/choreo-builder.ts — new methods ──

/** Context needed by goToDoor to resolve approach tiles at build time. */
export interface ChoreoBuilderContext {
    gameState: GameState;
    terrain: TerrainData;
}

export class ChoreoBuilder {
    /** Inject context for building-aware helpers. Called once, reused across builds. */
    static withContext(ctx: ChoreoBuilderContext): typeof ChoreoBuilder;

    /** GO_TO_TARGET node targeting the approach tile of the given building.
     *  Resolves approach tile via findBuildingApproachTile at build time. */
    goToDoor(buildingId: number): this;

    /** goToDoor + ENTER_BUILDING — the common "walk to building and go inside" suffix. */
    goToDoorAndEnter(buildingId: number): this;

    /** goToDoor + ENTER_GARRISON — the common "walk to tower and garrison" suffix. */
    goToDoorAndGarrison(buildingId: number): this;
}

// ── src/game/systems/choreo/types.ts — already added ──

enum ChoreoTaskType {
    // ... existing ...
    ENTER_BUILDING = 'ENTER_BUILDING',
    ENTER_GARRISON = 'ENTER_GARRISON',
}

interface ChoreoJobState {
    // ... existing ...
    waypoints?: Array<{ x: number; y: number; entityId?: number }>;
    metadata?: Record<string, number | string>;
}

// ── src/game/features/building-demand/types.ts ──

export interface BuildingDemand {
    buildingId: number;
    unitType: UnitType;
    toolMaterial: EMaterialType | null;
    player: number;
    race: Race;
    /** null = no candidate yet. Set when choreo job is assigned. */
    committedUnitId: number | null;
}
```

## Subsystem Details

### 1. ChoreoBuilder Extensions
**Files**: `src/game/systems/choreo/choreo-builder.ts`
**Key decisions**:
- Context injection pattern: `ChoreoBuilder.withContext(ctx)` returns a factory function (or sets a module-level context). The builder uses it in `goToDoor` to look up the building entity and call `findBuildingApproachTile`. This keeps the builder in `systems/` (layer 0) — it depends on GameState/TerrainData via an injected context, not a direct import of feature code.
- Alternative: `goToDoor` could accept `{x, y}` directly (caller resolves). But that defeats the purpose — we want the builder to encapsulate the approach-tile resolution so callers just pass `buildingId`.
- `goToDoorAndEnter(buildingId)` = `goToDoor(buildingId).enterBuilding()` with building ID stashed in metadata (`metadata.enterBuildingId`).
- `goToDoorAndGarrison(buildingId)` = `goToDoor(buildingId).enterGarrison()` with building ID stashed in metadata (`metadata.garrisonTowerId`).

### 2. New Executors
**Files**: `src/game/features/settler-tasks/internal/dispatch-executors.ts`
**Key decisions**:
- `ENTER_BUILDING` executor:
  - Reads `job.metadata.enterBuildingId` (or last waypoint's entityId)
  - Calls `locationManager.enterBuilding(settler.id, buildingId)`
  - Releases unit reservation (worker is now "at home", player can move them)
  - Returns `TaskResult.DONE`
- `ENTER_GARRISON` executor:
  - Reads `job.metadata.garrisonTowerId`
  - Calls `garrisonManager.finalizeGarrison(unitId, towerId)` (which transitions reservation to 'garrison', enters building, emits event)
  - Returns `TaskResult.DONE`
- Both registered on `ChoreoSystem` in their respective feature's `create()` function (same pattern as `TRANSFORM_RECRUIT` in recruit-feature)
- Both executors are `ControlExecutorFn` — they need a new `DispatchContext` or extend `ControlContext` with `locationManager` + `garrisonManager`

### 3. Migrate Existing Jobs
**Files**: `src/game/systems/recruit/recruitment-job.ts`, `src/game/features/barracks/barracks-training-manager.ts`
**Key decisions**:
- `createRecruitmentJob` → `choreo('AUTO_RECRUIT').goTo(pile.x, pile.y, pileEntityId).transformRecruit(targetUnitType).target(pileEntityId).build()`
- `createDirectTransformJob` → `choreo('AUTO_RECRUIT').transformDirect(targetUnitType).build()`
- `buildTrainingJob` → `choreo('BARRACKS_TRAINING').goTo(doorX, doorY).hidden(durationFrames, 'BARRACKS_TRAINING').changeTypeAtBarracks().target(barracksId).build()`
- These are pure refactors — same behavior, cleaner code. `carryingGood` hack eliminated (use `metadata.unitType` instead).
- **Must update** `TRANSFORM_RECRUIT` executor to read `job.metadata.unitType` instead of `job.carryingGood`. Also update `TRANSFORM_DIRECT` executor.

### 4. BuildingDemand
**Files**: `src/game/features/building-demand/building-demand-system.ts`, `src/game/features/building-demand/building-demand-feature.ts`
**Depends on**: Subsystems 1, 2
**Key decisions**:
- New feature module registered in FeatureRegistry. Depends on `settler-tasks`, `recruit`, `settler-location`.
- Owns `Map<number, BuildingDemand>` keyed by buildingId.
- Tick-driven: iterates pending demands, tries to fulfill each:
  1. Find idle specialist (via `settlerTaskSystem.findIdleSpecialist`) → build `WORKER_DISPATCH` job → assign via `settlerTaskSystem.assignJob` → done
  2. Find idle carrier (via existing carrier search) → build `RECRUIT_TO_WORKPLACE` or `DIRECT_RECRUIT_TO_WORKPLACE` job → assign → done
  3. No candidate available → retry next tick
- Listens to `building:completed` (with worker info) and `building:workerLost` to create demands
- Listens to `building:removed` to cancel demands
- On job completion/failure: `settlerTaskSystem` emits `settler:taskCompleted` / `settler:taskFailed` — demand system listens to clean up the `committedUnitId`
- Replaces: `RecruitSystem.pendingDemand`, `RecruitSystem.drainDemand`, `RecruitSystem.tryFulfillDemand`, the `building:completed`/`building:workerLost` listeners in RecruitSystem, and the `buildingId` threading in UnitTransformer
- Does NOT handle: construction worker demands (Builder/Digger auto-recruit) — those stay in RecruitSystem since they're capped roaming workers, not building-assigned
- Does NOT handle: garrison demands — garrison keeps its own auto-dispatch but migrates to choreo jobs

### 5. Garrison Migration
**Files**: `src/game/features/tower-garrison/tower-garrison-manager.ts`, `tower-garrison-feature.ts`, `internal/garrison-commands.ts`
**Depends on**: Subsystems 1, 2
**Key decisions**:
- `markEnRoute` replaced: garrison commands now build a `GARRISON_DISPATCH` choreo job and assign it via `settlerTaskSystem.assignJob(unitId, job)`
- `cancelEnRoute` removed — interrupting the choreo job handles cleanup (interruptJob releases reservation via `onForcedRelease`)
- `ArrivalDetector` deleted entirely — `ENTER_GARRISON` executor calls `finalizeGarrison`
- `tryFinalizeAtDoor` kept for "already at door" case (garrison command when unit is standing there)
- `isEnRoute` query: check if unit has an active choreo job with `ENTER_GARRISON` node, OR check `locationManager.isCommitted()`
- `getEnRouteEntries` / `getEnRouteSlotCounts`: still query `locationManager.getApproaching()` — unchanged
- `onTerrainReady`: re-builds `GARRISON_DISPATCH` jobs for approaching units (same as today, but using builder)
- Remove `unit:movementStopped` listener from feature wiring (no more ArrivalDetector)

### 6. RecruitSystem Cleanup
**Files**: `src/game/systems/recruit/recruit-system.ts`
**Depends on**: Subsystem 4
**Key decisions**:
- Remove: `pendingDemand`, `drainDemand`, `tryFulfillDemand`, `autoTimer`, `findIdleSpecialist` callback, `assignWorkerToBuilding` callback
- Remove: `building:completed` and `building:workerLost` event listeners (moved to BuildingDemand)
- Keep: `enqueue`/`dequeue`/`getQueuedCount` (player-queued recruitment), `drainQueue` (player queue processing), `resolveDispatch` (carrier + tool finding for player queue)
- Keep: `construction:workerNeeded` listener (Builder/Digger auto-recruit with caps)
- The `pendingDemand` array for Builder/Digger stays (renamed to `constructionDemand` for clarity) — these are capped roaming workers, not building-assigned
- Config interface simplified: remove `findIdleSpecialist`, `assignWorkerToBuilding`

### 7. UnitTransformer Cleanup
**Files**: `src/game/systems/recruit/unit-transformer.ts`
**Key decisions**:
- Remove `buildingId` from `PendingTransform` and from `requestTransform`/`requestDirectTransform` signatures
- Remove `assignWorkerToBuilding` callback from config and `handleCompleted`
- The building dispatch is now baked into the choreo job itself (`goToDoorAndEnter` nodes after `transformRecruit`)
- `handleCompleted` still handles: release reservation, release tool pile, mutate entity subType, remove from carrier registry, emit `unit:transformed`
- Serialization: no change needed (buildingId was never serialized)

### 8. Tests
**Files**: `tests/unit/`
**Key decisions**:
- Existing integration tests for garrison and worker assignment should pass (behavior unchanged)
- Update `building-worker-auto-recruit.spec.ts` to verify full choreo pipeline
- Add test: recruit-to-workplace as single job (carrier transforms then walks to building — one continuous job, not two phases)
- Add test: garrison dispatch via choreo (soldier walks to tower, ENTER_GARRISON fires)
- Add test: building destroyed mid-approach interrupts choreo job correctly

## File Map

### New Files
| File | Subsystem | Purpose |
|------|-----------|---------|
| `src/game/features/settler-tasks/internal/dispatch-executors.ts` | 2 | `ENTER_BUILDING` and `ENTER_GARRISON` choreo executors |
| `src/game/features/building-demand/building-demand-system.ts` | 4 | Demand tracking and fulfillment |
| `src/game/features/building-demand/building-demand-feature.ts` | 4 | Feature module wiring |
| `src/game/features/building-demand/types.ts` | 4 | BuildingDemand interface |

### Modified Files
| File | Change |
|------|--------|
| `src/game/systems/choreo/choreo-builder.ts` | Add `goToDoor`, `goToDoorAndEnter`, `goToDoorAndGarrison`, context injection |
| `src/game/systems/recruit/recruitment-job.ts` | Rewrite with builder, eliminate `carryingGood` hack |
| `src/game/systems/recruit/recruit-system.ts` | Remove building-worker demand logic, keep player queue + construction demands |
| `src/game/systems/recruit/unit-transformer.ts` | Remove `buildingId` threading and `assignWorkerToBuilding` |
| `src/game/features/barracks/barracks-training-manager.ts` | Rewrite `buildTrainingJob` with builder |
| `src/game/features/tower-garrison/tower-garrison-manager.ts` | Replace en-route state machine with choreo jobs |
| `src/game/features/tower-garrison/tower-garrison-feature.ts` | Remove ArrivalDetector wiring, remove `unit:movementStopped` listener |
| `src/game/features/tower-garrison/internal/garrison-commands.ts` | Build GARRISON_DISPATCH choreo job instead of calling markEnRoute |
| `src/game/features/settler-tasks/internal/control-executors.ts` | Update TRANSFORM_RECRUIT/TRANSFORM_DIRECT to read `job.metadata.unitType` instead of `job.carryingGood` |
| `src/game/features/recruit/recruit-feature.ts` | Register ENTER_BUILDING executor; simplify RecruitSystem config |
| `src/game/event-bus.ts` | No new events needed (existing events sufficient) |

### Deleted Files
| File | Reason |
|------|--------|
| `src/game/features/tower-garrison/internal/arrival-detector.ts` | Replaced by ENTER_GARRISON choreo executor |

## Verification
1. **Worker dispatch (idle specialist)**: Place WoodcutterHut → idle woodcutter nearby → `WORKER_DISPATCH` job assigned → walks to door → `ENTER_BUILDING` fires → worker inside, starts working
2. **Worker dispatch (recruit)**: Place WoodcutterHut → no idle woodcutter → carrier recruited → `RECRUIT_TO_WORKPLACE` job → walks to pile → transforms → walks to building → `ENTER_BUILDING` → starts working (one continuous job)
3. **Garrison dispatch**: Auto-garrison finds empty tower → `GARRISON_DISPATCH` job → swordsman walks to door → `ENTER_GARRISON` fires → `finalizeGarrison` → unit garrisoned
4. **Building destroyed mid-approach**: Dispatch job active → building removed → `settler-location:approachInterrupted` → choreo job interrupted → reservation released
5. **Save/load round-trip**: Save with en-route units → load → `onTerrainReady` rebuilds choreo jobs → units resume walking → arrive and finalize
6. **Player-queued recruitment unchanged**: Player clicks recruit button → `enqueue` → `drainQueue` → carrier transforms (no building assignment — that's for building demands only)
7. **Construction workers unchanged**: Construction site needs builder → `construction:workerNeeded` → RecruitSystem auto-recruits builder with cap
