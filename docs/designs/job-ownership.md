# Job Ownership & Unit Commitment — Design

## Overview

Every unit gets **one commitment record** (who owns it, which demand/record/tower, whether the player may move it), and every
job gets **exactly one owner**: a `JobKindHandler` registered with the job runtime that builds the job's nodes from plain
`params` and is called directly on completion, failure and unit removal. Jobs of every kind are saved and restored the same
way (`{ kind, params, nodeIndex, targets }` → `handler.build(params)` → resume), so the per-feature restore code and the
broadcast-and-filter routing over `settler:task*` go away. This is issues 1 and 2 of `reviews/arch-review-2026-10-20-2035.md`,
checked against the code as it is after phases 1–4.

## Current State

### Who knows that a unit is busy (today)

| Store | File | Stores | Read by | Unit removed | Job failed | Building removed | Save/restore |
|---|---|---|---|---|---|---|---|
| `entity.jobId` | `entity.ts:99-109` | numeric id; set by `JobRunner.assignJob` (`job-runner.ts:170`), garrison `finalizeGarrison` (`tower-garrison-manager.ts:356`) | `IdleCarrierPool` (`idle-carrier-pool.ts:69,157,176`), `restoreJobs` | stale | cleared by `interruptJob` | — | persisted in entity table; orphans cleared **only for carriers** (`logistics-dispatcher.ts:233-244`). Autonomy jobs (`startJob`, `:316`) **never set it** |
| `UnitRuntime.state/job/moveTask` | `settler-tasks/unit-runtime.ts:23-37` | IDLE/WORKING/INTERRUPTED, job, move | `findIdleSpecialist` (`worker-assignments.ts:168`), `isWorking` | runtime deleted via TickSystem path (after every cleanup handler) | → INTERRUPTED | `onBuildingRemoved` (lifecycle) | XML jobs as intent; **synthetic jobs dropped** (`settler-task-persistence.ts:75,102`) |
| `UnitReservationRegistry` | `systems/unit-reservation.ts` | `purpose` + `onForcedRelease` | move commands (`move-commands.ts:70,147`), combat (`combat-feature.ts:37`), siege (`building-siege-system.ts:106,139,176`, `siege-helpers.ts:134`), auto-garrison, IdleCarrierPool | `onForcedRelease` at priority -100 | each owner releases by hand | — | **not persisted**; garrison re-reserves in `onRestoreComplete` |
| `TransportJobRecord.carrierId` | `logistics/transport-job-record.ts:36` | carrier ↔ record (`byCarrier` index) | dispatcher, executors | **never cancelled** — Reserved/Queued keep claiming stock; PickedUp makes `carrier-assigner.ts:217` throw | `onCancel` → `cancel` → `carrier:transportCancelled` → lifecycle interrupts **again** (likely double `taskFailed`) | `handleBuildingDestroyed` (LOGISTICS prio) | records persisted (`demand-ledger-feature.ts:34`); `restoreJobs` rebuilds choreos by phase |
| `ConstructionWorkerDemand.workerId/reservedTileIndex` | `construction-worker-demands.ts:25-44` | demand + `demandByWorker` | demand system | **never released** — demand stays bound to a dead unit | `release` | `removeSite` (no job cancel) | not persisted; `rebuildFromSites` → all unbound, re-dispatched; builders keep a stale `entity.jobId` |
| `BuildingDemand.committedUnitId` | `building-demand/types.ts:9-17` | committed unit | O(n) `findByUnit` scan (`building-demand-system.ts:76`) | **never cleared** — building never gets a worker | `committedUnitId=null` | demand deleted | `persistence:'none'`; replayed via `forEachCompletedBuilding` |
| Garrison `garrisonJobs` + slots | `tower-garrison-manager.ts:49-67` | unit→tower (persisted), slots | manager | `handleForcedRelease` | `taskFailed` listener with **no kind filter** (`tower-garrison-feature.ts:112`) | `removeTower` | `garrisonJobs` persisted; en-route **WORKER_DISPATCH rebuilt by hand** (`tower-garrison-feature.ts:162-197`) |
| `BarracksTrainingManager.activeTrainings` | `barracks-training-manager.ts:52` | barracks→carrier | manager | **never cleared — barracks stuck** | **never cleared** (`trainingInterrupted` never emitted) | `removeBarracks` | not persisted; in-flight training and consumed recipe lost |
| `UnitTransformer.pending` + `ToolSourceResolver` reservations | `unit-transformer.ts:74`, `tool-source-resolver.ts:43-48` | carrier→pending transform; pile / building material handles | executors | `onForcedRelease` | `taskFailed` (no kind filter) → `recruitment:failed`; **building material reservation leaks** | — | not persisted, lost |
| Siege `sieges` / assault | `building-siege-system.ts:57` | defender / door attackers | siege | defender removed outside combat → **attacker reservations leak** (`:201-204`) | n/a (move tasks) | `building:removed` | not persisted |
| Settler location | `settler-building-location-manager.ts:31` | Approaching / Inside (owns `entity.hidden`) | garrison en-route derivation, lifecycle | DEFAULT handler | — | `approachInterrupted` | persisted |
| `CombatSystem.isInCombat` | `combat-system.ts:134` | transient combat status | settler-task tick, move commands, siege | `unregister` | — | — | not persisted |
| AI `getIdleMilitaryUnits` | `ai-player/internal/military-planner.ts:122-133` | "empty path" = idle | AI | — | — | — | — |

**Root cause of every "unit died" leak:** `GameState.removeEntity` deletes the entity *before* emitting `entity:removed`
(`game-state.ts:444-448`), so `SettlerLifecycleCoordinator.onEntityRemoved` (`settler-lifecycle.ts:105-118`, run as a TickSystem
*after* all cleanup-registry handlers) never reaches `endJobForTakeover`. On death **no `onCancel`, no `settler:taskFailed`**
fire; only reservation `onForcedRelease` and per-feature cleanup handlers run. Dispatchers that have neither leak.

### Job kinds and their builders (today)

| `JobKind` (`systems/choreo/types.ts:181`) | jobId strings / builder | Uses | Completion / failure routing | Restore |
|---|---|---|---|---|
| `Work` | XML + `registerSyntheticJob` (pioneer `PIONEER_CLAIM_TILE`), `createTargetedJobState` | `targetId/targetPos/approachPos` | none (autonomy re-searches) | `SerializedJobIntent`, snapped to safe node |
| `Transport` | `TransportJobBuilder.build/buildDeliveryOnly` (`transport-job-builder.ts:54,75`) | `transportData`, `onCancel`, `carryingGood`, `targetPos` | `taskCompleted` (no kind filter) → flush queued (`logistics-dispatcher.ts:182`); failure via `onCancel` | `restoreJobs()` by record phase |
| `WorkplaceDispatch` | `WORKER_DISPATCH` (`building-demand-system.ts:256`), `AUTO_RECRUIT` (`recruitment-job.ts:18,32`), `BUILDING_RECRUIT` (`recruit-system.ts:284`) | `metadata.enterBuildingId`, `metadata.unitType`, waypoints | `unit-demand-loop` filter + O(n) scan; `unit:recruited`; transformer's `taskFailed` | demands replayed; jobs lost |
| `Construction` | `DIG_TILE`, `BUILD_STEP`, `RECRUIT_DIGGER/BUILDER` (`construction-jobs.ts`) | `metadata.siteId/tileIndex/unitType`, waypoints, `targetId` | `unit-demand-loop`; completion **reassigns the next job inside the handler** | demands rebuilt unbound; jobs lost |
| `Garrison` | `WORKER_DISPATCH` (`garrison-dispatch.ts:41`, restore `tower-garrison-feature.ts:192`) | `metadata.enterBuildingId` | `taskCompleted` any kind + location check (`tower-garrison-manager.ts:73`) | hand-rebuilt from location manager |
| `Barracks` | `BARRACKS_TRAINING` (`barracks-training-manager.ts:267`) | `metadata.unitType/reservationId`, `targetId` | only `unit:recruited` | lost |
| `Recruit` | **never created** — player-queued recruits use `WorkplaceDispatch` | | | |

Siege / tower assault and combat **do not use jobs** (move tasks + `moveUnit`); siege capture uses `dispatchUnitToGarrison`.

### What stays vs changes
- **Stays**: `ChoreoSystem` executor plugin model; `TransportJobStore` as SoT for material in motion (phase = reservation);
  `DemandLedger`; settler-location as SoT for inside/approaching/`entity.hidden`; `WorkerAssignments` (home building) as a
  separate long-lived concept; XML resume by safe-node snapping; `settler:task*` events (as notifications only).
- **Changes**: job = data + owner handler; one commitment record per unit; uniform persistence; unit removal handled at the
  start of cleanup in one place; owners called directly.
- **Deleted**: `ChoreoJobState.{transportData, waypoints, metadata, onCancel, synthetic}`, `TransportData`,
  `systems/unit-demand-loop.ts` (`UnitDemandJobHandlers`; `IntervalDrain` moves), `UnitReservationRegistry` +
  `ctx.unitReservation`, `entity.jobId` + `clearJobId`, `garrisonJobs` store, `carrier:transportCancelled` round-trip,
  hand-written job rebuilds (`restoreJobs` rebuild branch, garrison en-route rebuild), `numericJobId` on `assignJob`.

## Summary for Review

- **Interpretation**: implement the review's "commitment record + JobKind handler registry", but based on the current code,
  and fix the unit-death leaks this exposes, which are real bugs today.
- **One owner per job**: each `JobKind` is registered once by its feature, with `build / onCompleted / onFailed / onUnitRemoved`
  and an optional `resumeIndex`. XML jobs are kind `Work` with `params = { choreoJobId }`, owned by settler-tasks itself.
- **Data moves into nodes**: `metadata`, `waypoints` and `transportData` become typed **node args** and **node goals**. They are
  produced by `build(params)` and never persisted. `onCancel` becomes `handler.onFailed` plus per-task-type **node abort hooks**
  (used by the recruit transform).
- **One "idle" definition**: a unit is idle if and only if it has no commitment. Commitments are stored in a kernel
  `UnitCommitments` store that combat and siege can read; only settler-tasks writes to it. A commitment can exist without a job
  ("hold": a garrisoned unit, a siege door attacker). This replaces `UnitReservationRegistry`, `entity.jobId` and
  `garrisonJobs`.
- **Unit removal**: one cleanup handler at the earliest priority tears down the job and calls the owner. This fixes the leaks in
  construction, building-demand, barracks, transport and siege.
- **Restore**: saved commitments and jobs are applied when settler-tasks deserializes. Owners rebuild their domain state from
  commitments in `onRestoreComplete`. A new final `onRestoreResume` pass then rebuilds the nodes and resumes each job. If a
  resume fails, the owner gets `onFailed`, the same path as a live failure.
- **Assumptions**: old saves need not load. The format is versioned (`SNAPSHOT_VERSION`, exact match), so we bump it and stale
  saves are rejected by the existing notice. See Decisions. A job with a recruit prefix stays reserved for the whole job,
  not only until the transform; this is a small behaviour change.
- **Scope**: kinds Work, Transport, WorkplaceDispatch, Construction, Garrison, Barracks, Recruit; siege holds; readers (AI,
  combat, IdleCarrierPool, debug). Out of scope: combat ownership, persisting the recruit queue or siege state, pioneer
  activation state.

## Conventions

- Optimistic programming (`docs/optimistic.md`): `getEntityOrThrow`, no `?.`/`??` on required deps, throw with context. A missing
  handler for a kind is a startup assertion, like `ChoreoSystem.assertAllRegistered`.
- Nullable by design here: `UnitCommitments.get()` (idle ⇒ undefined); node `args`/`goal` (only synthetic nodes carry them).
- Registration over import (Rule 2.3): features register their kind handlers and node hooks in `create()`; settler-tasks must
  not import owner features.
- Layers: shared types go in `src/game/systems/` (domain-free, ids only). The job runtime is `features/settler-tasks`. Domain
  handlers stay in their own features.
- Config objects for 3+ deps (Rule 4.4); deterministic iteration (Rule 8.2), so `unitsOwnedBy` returns ascending ids.
- Size: TS files ≤ 600 lines (aim ≤ 400), functions ≤ 80 lines, complexity ≤ 15. **`job-runner.ts` is 539 lines and must be
  split by the Core subsystem before it grows** (see the File Map).
- Events: `settler:taskCompleted/Failed` remain as **notifications only** (timeline, debug, tests). After the Cleanup phase, no
  feature subscribes to them for routing.
- Tests: integration tests in `tests/unit/integration/`, real data only, run once and tee to a file (`.claude/rules/testing.md`,
  `docs/testing/guide.md`). Use `sim.saveAndRestore()` (`tests/unit/helpers/test-simulation.ts:568`).

## Architecture

### Subsystems

| Subsystem | Responsibility | Depends On | Files (owned) |
|---|---|---|---|
| Core: commitment & job runtime | kernel `UnitCommitments`; `JobKindHandler` registry; JobRunner assign/complete/fail/cancel/remove routing; node args/goals/hooks; builder; `Work` kind; unit-removal cleanup; persistence + resume; FeatureContext wiring | — | `systems/choreo/*`, `systems/unit-commitment.ts`, `systems/entity-cleanup-registry.ts`, `features/settler-tasks/**`, `features/settler-location/enter-building-executor.ts`, `features/feature.ts`, `features/feature-registry.ts`, `game-services.ts`, `state/persistence-types.ts`, `state/game-state-persistence.ts` |
| Transport migration | `Transport` handler; record-driven build/resume; carrier death; IdleCarrierPool idle definition | Core | `features/logistics/**`, `features/carriers/**` |
| Recruit migration | `RecruitSegment` builder, TRANSFORM_* node args + abort/restore hooks; reservations keyed by unit; `Recruit` kind for queue/direct transforms | Core | `features/recruit/**` |
| Workplace-dispatch migration | `WorkplaceDispatch` handler; demand lookup by ref; death/restore | Core, Recruit (contract only) | `features/building-demand/**` |
| Construction migration | `Construction` handler; dig/build chain; demand rebinding from commitments on restore | Core, Recruit (contract only) | `features/building-construction/construction-jobs.ts`, `construction-site-demand.ts`, `construction-worker-demands.ts`, `internal/construction-executors.ts`, `building-construction-feature.ts` |
| Garrison migration | `Garrison` handler (en-route); garrisoned = hold; slots rebuilt from holds; delete `garrisonJobs` | Core | `features/tower-garrison/**` |
| Barracks migration | `Barracks` handler; failure/death clears training; training survives restore | Core, Recruit (contract only) | `features/barracks/**` |
| Readers & siege migration | siege holds instead of reservations; AI/combat/debug read commitments | Core | `features/building-siege/**`, `features/combat/combat-feature.ts`, `features/ai-player/internal/military-planner.ts`, `src/composables/useLogisticsDebug.ts`, `src/game/cli/commands/economy.ts` |
| Cleanup | delete the legacy path and fields; update docs | all migrations | see File Map ("Cleanup") |

**Transition rule.** The Core subsystem ships the new API **alongside** the legacy path, so each migration can land on its own.
A job assigned as a legacy `ChoreoJobState` (built with `choreo().build()`, without a `JobSpec`) keeps the current behaviour:
broadcast, `synthetic` exclusion, `onCancel`. `UnitCommitments.isReserved` temporarily ORs the legacy
`UnitReservationRegistry`. The Cleanup subsystem deletes both. Migrations never edit files owned by another subsystem; where a
migration needs a Core change, Core provides it up front, as listed in Shared Contracts.

## Shared Contracts

> The Core subsystem shipped these contracts with a few small deltas (`JobBuild.jobId`,
> `JobKindHandler.restorable`, explicit hold owners with `onPreempted`, `ChoreoBuilder.toJobBuild()`).
> **Read "Core implementation notes" at the end of this doc for the API as actually shipped.**

```ts
// ── src/game/systems/choreo/job-kind.ts (new, domain-free) ─────────────────────────

/** One owner per kind. `Recruit` is now used: player-queued and direct transforms. */
export enum JobKind {
    Work = 'work',                       // XML / registered choreographies — owner: settler-tasks
    Transport = 'transport',             // owner: logistics            ref = TransportJobRecord.id
    WorkplaceDispatch = 'workplace-dispatch', // owner: building-demand ref = buildingId
    Construction = 'construction',       // owner: building-construction ref = siteId
    Garrison = 'garrison',               // owner: tower-garrison       ref = towerId
    Barracks = 'barracks',               // owner: barracks             ref = barracksId
    Recruit = 'recruit',                 // owner: recruit              ref = 0 (queue keyed by params.unitType)
}

/** Plain, JSON-serializable params. Each kind narrows it with its own interface. */
export type JobParamValue = number | string | boolean | null | { readonly x: number; readonly y: number };
export type JobParams = Readonly<Record<string, JobParamValue | Readonly<Record<string, JobParamValue>>>>;

/** What a dispatcher hands to JobRunner. */
export interface JobSpec<P extends JobParams = JobParams> {
    readonly kind: JobKind;
    readonly ref: number;          // owner's own key (record / demand / tower id) — see table below
    readonly params: P;
    readonly reserved: boolean;    // player move commands rejected while true
}

/** Output of build(): a pure function of params + current world state (no captured closures). */
export interface JobBuild {
    readonly nodes: ChoreoNode[];
    readonly targetId?: number | null;
    readonly targetPos?: Tile | null;
    readonly carryingGood?: EMaterialType | null;
}

export type JobFailureReason =
    | 'failed'          // a node returned FAILED / executor threw
    | 'preempted'       // another assignJob / player move took the unit
    | 'restoreFailed';  // resume after load was impossible

export interface JobFailureInfo {
    readonly reason: JobFailureReason;
    readonly nodeIndex: number;
    readonly failedStep: string;
}

export interface JobKindHandler<P extends JobParams = JobParams> {
    readonly kind: JobKind;
    /** Persist this kind's jobs/commitments (false only for kinds whose domain state is not persisted). */
    readonly persist: boolean;
    build(unitId: number, params: P): JobBuild;
    /** Commitment is already cleared; calling JobService.assign() for the same unit here is allowed. */
    onCompleted(unitId: number, ref: number, params: P): void;
    /** Commitment cleared, runtime torn down, unit already INTERRUPTED; may reassign. */
    onFailed(unitId: number, ref: number, params: P, info: JobFailureInfo): void;
    /** Entity is already gone from GameState; only domain bookkeeping is allowed. */
    onUnitRemoved(unitId: number, ref: number, params: P): void;
    /**
     * Restore: called with the generically snapped index (see Resume semantics). Return the index to resume at,
     * or null to abandon (→ onFailed reason 'restoreFailed'). Default: identity.
     */
    resumeIndex?(unitId: number, ref: number, params: P, snappedIndex: number, nodes: readonly ChoreoNode[]): number | null;
}

// ── src/game/systems/choreo/types.ts (changed) ────────────────────────────────────

/** Typed per-node data for synthetic nodes — replaces job.metadata / transportData. Ids only. */
export type ChoreoNodeArgs =
    | { readonly task: 'enterBuilding'; readonly buildingId: number }
    | { readonly task: 'digTile'; readonly siteId: number; readonly tileIndex: number }
    | { readonly task: 'buildStep'; readonly siteId: number }
    | { readonly task: 'transform'; readonly unitType: UnitType; readonly sourceId: number | null }
    | { readonly task: 'transport'; readonly recordId: number };

export interface ChoreoNode {
    /* …existing XML fields unchanged… */
    /** Walk goal for synthetic GO_TO/TRANSPORT_GO_TO nodes — replaces job.waypoints index counting. */
    goal?: TileWithEntityOpt;
    args?: ChoreoNodeArgs;
}

export interface ChoreoJobState {
    readonly type: 'choreo';
    readonly kind: JobKind;
    readonly ref: number;
    readonly params: JobParams;
    jobId: string;                 // display / XML id ("JOB_WOODCUTTER_WORK", "DIG_TILE")
    nodes: ChoreoNode[];
    nodeIndex: number;
    progress: number;
    visible: boolean;
    activeTrigger: string;
    targetId: number | null;
    targetPos: Tile | null;
    approachPos: Tile | null;
    carryingGood: EMaterialType | null;
    workStarted: boolean;
    pathRetryCountdown: number;
    pathRetryCount: number;
    // removed: transportData, waypoints, metadata, onCancel, synthetic
}

// ── src/game/systems/choreo/choreo-system.ts (extended) ───────────────────────────

export interface ChoreoNodeHooks {
    /** Node's side effect is irreversible once it completed — resume never snaps back across it. */
    readonly irreversible?: boolean;
    /** Job ended (failed / preempted / cancelled / unit removed) before this node completed. */
    onAbort?(unitId: number, node: ChoreoNode): void;
    /** Restore: job resumes at or before this node. false ⇒ resume impossible (→ restoreFailed). */
    onRestore?(unitId: number, node: ChoreoNode): boolean;
}
// ChoreoSystem.register(taskType, executor, hooks?: ChoreoNodeHooks)
// ChoreoSystem.hooksFor(taskType): ChoreoNodeHooks | undefined

// ── src/game/systems/unit-commitment.ts (new kernel store; replaces unit-reservation.ts) ──

export type CommitmentOwner = JobKind | 'player-move' | 'siege';

export interface UnitCommitment {
    readonly owner: CommitmentOwner;
    readonly ref: number;
    readonly reserved: boolean;
    /** False for holds (garrisoned unit, siege attacker): owned, but no job runs. */
    readonly hasJob: boolean;
}

/** Read side — in FeatureContext as `ctx.unitCommitments` (combat, siege, carriers, AI, debug). */
export interface UnitCommitmentQuery {
    get(unitId: number): UnitCommitment | undefined;   // undefined ⇔ idle
    isIdle(unitId: number): boolean;
    isReserved(unitId: number): boolean;
    /** Ascending unit ids. ref omitted ⇒ all units of that owner. */
    unitsOwnedBy(owner: CommitmentOwner, ref?: number): readonly number[];
}
// Write side (set/clear) is package-internal: only settler-tasks' JobService mutates it.

// ── src/game/features/settler-tasks (exported as SettlerTaskExports.jobs) ──────────

export interface HoldOwnerHandler {
    readonly owner: CommitmentOwner;
    readonly persist: boolean;
    onUnitRemoved(unitId: number, ref: number): void;
}

export interface JobService {
    registerKind<P extends JobParams>(handler: JobKindHandler<P>): void;
    registerHoldOwner(handler: HoldOwnerHandler): void;   // JobKind handlers are hold owners implicitly
    /** Builds via the kind handler; preempts any current job (old owner gets onFailed 'preempted'). */
    assign<P extends JobParams>(unitId: number, spec: JobSpec<P>, opts?: { moveTo?: Tile }): boolean;
    /** Owner-initiated stop. Runs teardown + node abort hooks; does NOT call the owner back. */
    cancel(unitId: number, owner: CommitmentOwner): void;
    /** Commitment without a job (garrisoned, siege). Replaces reserve()/updateReservation(). */
    hold(unitId: number, owner: CommitmentOwner, ref: number, reserved: boolean): void;
    /** Ends a hold (or no-op if the unit's commitment has another owner — asserts owner when held). */
    releaseHold(unitId: number, owner: CommitmentOwner): void;
    readonly commitments: UnitCommitmentQuery;
}
// TaskDispatcher.assignMoveTask(unitId, target, owner: 'player-move' | 'siege' = 'player-move') — move commitment.
```

**Persistence format (`state/persistence-types.ts`, `SNAPSHOT_VERSION` 17 → 18):**

```ts
export interface SerializedUnitRuntime {
    id: number;
    home?: { buildingId: number; hasVisited: boolean };
    commitment?: SerializedCommitment;      // absent ⇔ idle
}
export interface SerializedCommitment {
    owner: CommitmentOwner;
    ref: number;
    reserved: boolean;
    job?: SerializedJob;                    // absent ⇒ hold (or move)
    moveTarget?: Tile;                      // owner 'player-move' / 'siege'
}
export interface SerializedJob {
    kind: JobKind;
    params: JobParams;
    nodeIndex: number;                      // raw index; snapping happens on resume
    targetId?: number;
    targetPos?: Tile;
    approachPos?: Tile;
}
// Removed: SerializedJobIntent, SerializedUnitRuntime.state (never read), entity.jobId, snapshot.nextJobId
// (TransportJobRecord ids move to the store's own persisted counter).
```

**Per-kind contract (owners implement; Core only routes):**

| Kind | ref | params | build → nodes | reserved | resume |
|---|---|---|---|---|---|
| Work | home building id or -1 | `{ choreoJobId }` | `JobChoreographyStore.getJob(race, id)` (XML + registered, e.g. pioneer) | no | generic snap; saved targets overlaid |
| Transport | record id | `{ recordId }` | full or delivery leg from the **record's phase**; goals from slot positions; `args.transport.recordId` | no | record missing/Queued ⇒ null; PickedUp ⇒ ≥ index of `TRANSPORT_GO_TO_DEST` |
| WorkplaceDispatch | building id | `{ buildingId, recruit: RecruitSegment \| null }` | [recruit segment] + goToDoor + ENTER_BUILDING | `recruit !== null` | building missing ⇒ null |
| Construction | site id | `{ siteId, role, tileIndex: number \| null, workPos, recruit: RecruitSegment \| null }` | [recruit segment] + goTo + DIG_TILE/BUILD_STEP | `recruit !== null` | site missing ⇒ null |
| Garrison | tower id | `{ towerId }` | goToDoor + ENTER_BUILDING | yes | tower missing ⇒ null |
| Barracks | barracks id | `{ barracksId, recipeIndex, unitType }` | goTo door + TRANSFORM_RECRUIT_BUILDING + WAIT(FIGHT) | yes | barracks missing ⇒ null |
| Recruit | 0 | `{ segment: RecruitSegment }` | recruit segment only | yes | via node hook |
| hold: Garrison | tower id | — | — | yes | slots rebuilt from holds |
| hold: siege | building id | — | — | yes | `persist: false` (dropped on save, as today) |

```ts
// ── src/game/features/recruit (public, implemented by Recruit migration) ─────────
export type RecruitSource =
    | { readonly kind: 'pile'; readonly pileId: number; readonly x: number; readonly y: number }
    | { readonly kind: 'building'; readonly buildingId: number; readonly side: InventorySide }
    | { readonly kind: 'direct' };
export interface RecruitSegment { readonly targetUnitType: UnitType; readonly source: RecruitSource }
export interface RecruitSegments {
    /** Nodes for the transform prefix (goTo source + TRANSFORM_* with args). Append the continuation after it. */
    nodes(segment: RecruitSegment): ChoreoNode[];
    /** Reserve tool pile / building materials for this carrier (keyed by unitId). false ⇒ do not assign. */
    reserve(carrierId: number, segment: RecruitSegment): boolean;
}
// RecruitSystem.dispatchRecruitment(...) keeps choosing (carrier, source) and calls back
// `buildSpec(carrierId, segment) => JobSpec` instead of today's `buildJob(candidate) => ChoreoJobState`.
```

## Key Decisions

- **XML jobs are kind `Work`, with `params = { choreoJobId }`.** The handler belongs to settler-tasks (`work-job-kind.ts`). Its
  callbacks are no-ops: WorkerAutonomy picks up idle units on its own. This gives one save path for every job.
- **Params are what the owner needs to rebuild; nodes are never saved.** `build()` may read the current world (inventory
  slots, door tiles). On restore that is the same as today's `restoreJobs` rebuild. A build must never capture closures.
- **Node args/goals replace metadata/waypoints/transportData.** Executors read `node.args` and `node.goal`. ENTER_BUILDING and
  TRANSFORM_* are shared by several kinds, so their data belongs to the node and not to any kind's params. The mutable
  `transportData.amount` goes away; executors read the `TransportJobRecord`.
- **`onCancel` is split by meaning.** Kind-level cleanup (cancelling a transport record) moves to `onFailed`/`onUnitRemoved`.
  Node-level pending state (the recruit transform's tool and material reservations) moves to the `onAbort` hook of that task
  type. Recruit then no longer needs to know which kind wraps it, and the `pending.has` filter on `settler:taskFailed` goes
  away.
- **Commitment ≠ job ≠ home.** A commitment is the current owner. The home assignment (`WorkerAssignments`) stays the long-term
  workplace. Settler-location stays the truth for inside/approaching. Combat stays a separate transient status and is not an
  owner (it moves units via `moveUnit`). Folding it in would mean redesigning combat, so it is out of scope.
- **`UnitReservationRegistry` is folded in.** Once every reservation is the `reserved` flag of a commitment, the registry would
  duplicate data that is already there. `purpose` becomes `owner` + `ref`, which is better for debugging. `onForcedRelease`
  becomes `onUnitRemoved`.
- **`entity.jobId` is deleted.** The commitment covers the busy flag; the transport identity becomes `ref` = record id. This
  supersedes invariants 4 and 8 of `logistics-task-simplification.md` and the busy-check part of `entity-job-id.md`.
- **Holds** model "owned, no job": garrisoned units, and siege defenders and attackers. `garrisonJobs` is just a persisted hold,
  so it is deleted.
- **Owner-initiated `cancel` never calls the owner back.** This removes the re-entrant `TransportJobService.cancel` →
  `carrier:transportCancelled` → `interruptJob` → `onCancel` loop (likely double `taskFailed` today).
- **Preemption is reported.** When `assign`/`assignMoveTask` takes over a unit, the previous owner gets
  `onFailed('preempted')`. Today the owner only learns of this through the broadcast.
- **Idle has one definition**, `commitments.isIdle(id)`. `IdleCarrierPool` additionally excludes carriers on a player move
  (today they count as idle and get hijacked). `findIdleSpecialist` = idle and no home. The AI = idle and not hidden.

### Resume semantics (generalised safe-node snapping)

For a saved job at index `i`: build the nodes, then find `w` = the index after the last node at or before `i` whose hooks say
`irreversible`, or 0 if there is none. Resume at the nearest `SAFE_RESUME_TASKS` node in `[w, i]`, searching backwards. Add
`TRANSPORT_GO_TO_SOURCE/DEST` to that set. If no safe node is found, resume at `w`. Then call `handler.resumeIndex(...)`, and
`onRestore` for every node from the resume index on that has the hook (recruit transform: re-reserve the source). If any of
these return null or false, the job is abandoned and the owner gets `onFailed('restoreFailed')`.
- Mark `irreversible`: TRANSFORM_RECRUIT / TRANSFORM_DIRECT / TRANSFORM_RECRUIT_BUILDING, DIG_TILE, BUILD_STEP, ENTER_BUILDING,
  TRANSPORT_PICKUP, TRANSPORT_DELIVER. XML task types are not marked, so XML resume behaves exactly as today.
- Saved targets (`targetId/targetPos/approachPos`) are overlaid after build. GO_TO nodes with a `goal` override them anyway.
- Units whose commitment owner has `persist: false` are saved without a commitment and come back idle, as today for siege.

### Restore ordering (explicit)

The order in which these run matters:
- `deserializeAll`. `settlerTasks` (still `after: ['constructionSites']`) restores home assignments, move tasks and
  **commitment records**. Jobs are stored as pending `SerializedJob` and are **not built yet**.
- `onRestoreComplete`, in load order. Owners rebuild their derived domain state *from commitments*:
  - Construction rebinds demands from `unitsOwnedBy(Construction)` + params, and restores `reservedTileIndex`.
  - Garrison: `initTower`, then slots from Garrison holds.
  - Barracks: `activeTrainings` from Barracks commitments.
  - Building-demand: `committedUnitId` from WorkplaceDispatch commitments.
  - Logistics cancels Queued records and records with no matching commitment.
- **New `FeatureInstance.onRestoreResume?()`**, called by `FeatureRegistry` after every `onRestoreComplete`. Settler-tasks uses it
  to build and resume all pending jobs. Any `onFailed('restoreFailed')` therefore reaches owners whose state is already
  rebuilt.

### Event ordering (explicit)

- **Unit removed.** The new `CLEANUP_PRIORITY.COMMITMENTS = -100` replaces `RESERVATIONS` and is registered by settler-tasks. In
  one handler, in this order:
  - job teardown: stop the trigger, `onWorkInterrupt` if work started, node `onAbort` for every node not yet completed;
  - owner `onUnitRemoved`;
  - home assignment release, runtime and commitment delete;
  - notification `settler:jobAborted { reason: 'unitRemoved' }`.

  After that comes EARLY (material-transfer drops carried goods, after transport already cancelled the record), then DEFAULT
  (settler-location, movement controller, …). The TickSystem `onEntityRemoved` path keeps only the "building removed" branch.
  The dead `cleanupSettlerHandlers` branch is deleted.
- **Job completed.** Clear the job and commitment, then `handler.onCompleted` (may assign again), then emit
  `settler:taskCompleted`, then post-processing (exit building if home, idle animation, re-enter home). This keeps today's order:
  garrison's finalize must run before the "exit if homeAssignment" check.
- **Job failed.** Teardown (material drop, trigger, exit building) and node `onAbort`, then clear the commitment and set state
  INTERRUPTED, then `handler.onFailed` (may assign again), then emit `settler:taskFailed`. This fixes today's order, where state
  is set to INTERRUPTED *after* listeners have run.
- **Building removed.** Owners call `cancel(unitId, owner)` for `unitsOwnedBy(kind, buildingId)` from their existing
  `building:removed` handling. Settler-location's `approachInterrupted` stays for home approaches (lifecycle).

### Invariants (replace "Invariants" in `docs/architecture/logistics-task-simplification.md`)

1. A unit has at most one commitment. `commitments.get(id) === undefined` if and only if the unit is idle. There is no other
   definition of idle.
2. Every running job has a commitment with `owner === job.kind`, `ref === job.ref` and `hasJob === true`.
3. Only settler-tasks (`JobService`) writes commitments. Owners mutate them only through `assign`, `cancel`, `hold` and
   `releaseHold`.
4. Each `JobKind` has exactly one registered handler. A missing handler is asserted at startup.
5. Owners learn about job outcomes only through handler calls. `settler:task*` events are notifications.
6. `build(params)` is a pure function of params and the current world. Params are JSON data with no closures.
7. Unit removal reaches the owner exactly once, at `COMMITMENTS` priority, before any other cleanup handler runs.
8. Owner-initiated `cancel` never calls that owner back. Preemption always does (`'preempted'`).
9. *(kept)* A standing order exists ⇒ the dispatcher may open jobs; the deficit is derived, never stored.
10. *(kept)* The transport phase is the reservation: Queued/Reserved claim source stock; PickedUp is incoming at the destination
    only.
11. *(kept)* At most one active transport plus one queued per carrier.
12. *(kept)* Deliver does not free the carrier; job completion (after stand-up) does.
13. *(kept)* Construction complete cancels destination jobs (owners call `cancel` for the affected carriers).
14. *(kept)* Null work handlers never self-assign.

## Subsystem Details

### Core: commitment & job runtime
**Files**: see the File Map. Key new files: `systems/unit-commitment.ts`, `systems/choreo/job-kind.ts`,
`settler-tasks/job-service.ts`, `settler-tasks/internal/job-outcomes.ts`, `settler-tasks/internal/job-resume.ts`,
`settler-tasks/internal/unit-removal.ts`, `settler-tasks/work-job-kind.ts`.
**Key decisions**:
- Split `job-runner.ts`: node ticking and assign stay in it; complete/fail/cancel/preempt routing moves to
  `internal/job-outcomes.ts`; removal to `internal/unit-removal.ts`.
- `ChoreoBuilder.build()` returns `JobBuild`, with `goal`/`args` on the nodes. `goToDoorAndEnter(id)` emits
  `args.enterBuilding`. `transformRecruit` and the other recruit-specific builder methods move to the recruit feature.
- `makeGoToTarget` (`internal/movement-executors.ts:250`) reads `node.goal` instead of counting waypoints. The ENTER_BUILDING
  executor reads `node.args`.
- Provide `ctx.unitCommitments` (query) in FeatureContext and the new `onRestoreResume` hook. During the transition, keep
  `ctx.unitReservation`, `assignJob(entity, ChoreoJobState, …)` and the legacy broadcast working. `isReserved` ORs the legacy
  registry.
- `startJob` (autonomy) also creates a `Work` commitment. Move tasks create a `'player-move'` commitment, which is cleared when
  the move ends only if the owner is still `'player-move'`.
- Debug: `settler-debug.ts` and the diagnostics panel show owner/ref/reserved instead of reservation purposes.

**Acceptance**: new integration tests: `tests/unit/integration/jobs/work-job-restore.spec.ts` (XML job saved mid-walk and
mid-work resumes as today), `tests/unit/integration/jobs/commitment-lifecycle.spec.ts` (preemption reported, owner-cancel not
reported, unit removal reaches the owner once before material-transfer, a reassign from `onCompleted`/`onFailed` sticks). Add a
`sim.killUnit(id)` helper (`tests/unit/helpers/`). All existing tests pass unchanged.

### Transport migration
**Files**: `features/logistics/**`, `features/carriers/**`.
**Key decisions**:
- `TransportJobBuilder` turns into the Transport `JobKindHandler`: `build` reads the record (phase → full or delivery leg).
  `restoreJobs` keeps only the cancel of Queued records and orphans; the rebuild branch and the `clearJobId` scan are deleted.
- `onFailed` cancels the record and flushes nothing. `onCompleted` flushes the queued follow-up (replaces the unfiltered
  `taskCompleted` subscription at `logistics-dispatcher.ts:182`). `onUnitRemoved` cancels the active and queued records. This
  fixes the dead-carrier leak and the `carrier-assigner.ts:217` throw.
- `TransportJobService.cancel` calls `jobs.cancel(carrierId, JobKind.Transport)` directly. Stop emitting
  `carrier:transportCancelled` as a control signal.
- Record ids: a persisted counter owned by the `TransportJobStore` (stop using `gameState.allocateJobId`).
- `IdleCarrierPool`, `logistics-snapshot.ts` and `fulfillment-diagnostics.ts` read `commitments`.

**Acceptance**: save/restore mid-job in each phase (Reserved walking to source, during pickup, PickedUp walking, during deliver),
with no duplicate pickup and material conserved. Carrier killed in each phase: stock claims released, no throw, demand reopened.
`economy/*` and `persistence/save-load.spec.ts` unchanged.

### Recruit migration
**Files**: `features/recruit/**`.
**Key decisions**:
- Implement `RecruitSegments` (contract above). TRANSFORM_* executors read `node.args.transform`. Register their hooks:
  `irreversible`; `onAbort` releases the unit-keyed pile or building-material reservation (this fixes the leak in
  `handleFailed`); `onRestore` re-reserves and returns false if the source is gone.
- Key `ToolSourceResolver` pile/building reservations by carrier id, not by transient handle id, so params stay persistable.
- `UnitTransformer.pending` becomes either derivable from the job or keyed by unit and released only via hooks. Delete its
  `settler:taskFailed` subscription and its reservation calls.
- The player queue and direct transforms use kind `Recruit`. `dispatchRecruitment`/`dispatchRecruitmentFromBuilding` accept
  `buildSpec(carrierId, segment) => JobSpec` (callers append their continuation nodes to `segments.nodes(segment)` inside their
  own `build`).

**Acceptance**: `specialist-recruitment`, `recruitment-*`, `building-worker-auto-recruit` unchanged. New tests: carrier killed or
job failed before the transform releases the pile and the building materials. Save before the transform resumes and still
reserves the pile; save after the transform does not transform again.

### Workplace-dispatch migration
**Files**: `features/building-demand/**`.
**Key decisions**: handler `ref = buildingId` gives O(1) lookup (delete the `findByUnit` scan). `onUnitRemoved`/`onFailed` reset
`committedUnitId` (fixes the dead-unit leak). On restore, rebuild `committedUnitId` from `unitsOwnedBy(WorkplaceDispatch)`
before replaying demands. Assigning the worker at `unit:recruited` may stay, but find the demand via the commitment's ref.
**Acceptance**: specialist dispatch and recruit dispatch each saved mid-walk resume and fill the building; unit killed mid-walk
causes a new dispatch; building removed mid-walk cancels the unit's job.

### Construction migration
**Files**: `construction-jobs.ts`, `construction-site-demand.ts`, `construction-worker-demands.ts`,
`internal/construction-executors.ts`, `building-construction-feature.ts`.
**Key decisions**:
- `onCompleted` keeps chaining the next DIG/BUILD job from inside the callback (allowed by contract).
- `onUnitRemoved` releases the demand and its tile (fixes the dead-unit leak).
- `rebuildFromSites` rebinds workers from commitments, so workers resume after load instead of being redispatched.
- `removeSite` cancels committed workers' jobs.
- Executors read `node.args` (`getSiteOrThrow` stays: a missing site ⇒ FAILED).
- Delete `demandByWorker` if `ref` + params cover every lookup.

**Acceptance**: `construction/*` and `persistence/construction-persistence.spec.ts` unchanged. New: save mid-dig and mid-build
(the same worker resumes and the tile reservation is kept); digger killed mid-walk (demand re-dispatched); recruit-digger saved
before and after the transform.

### Garrison migration
**Files**: `features/tower-garrison/**`.
**Key decisions**:
- En-route = Garrison job (`reserved`). `onCompleted` runs `finalizeGarrison`, then `jobs.hold(unit, Garrison, towerId, true)`
  (replaces the unfiltered `taskCompleted` listener and the jobId allocation).
- `onFailed`/`onUnitRemoved` run `cancelApproach` and release the assignment.
- Delete `garrisonJobs` and the `onRestoreComplete` WORKER_DISPATCH rebuild. Slots are rebuilt from holds. `getEnRouteEntries`
  derives from `unitsOwnedBy(Garrison)` with `hasJob`.
- Owner change and `removeTower` call `cancel` / `releaseHold`.

**Acceptance**: `tower-garrison*`, `castle-garrison-init`, `persistence/garrison-persistence.spec.ts` unchanged. New: unit killed
en route frees the slot count; unit killed inside frees the slot; saved en route resumes walking without hand rebuild.

### Barracks migration
**Files**: `features/barracks/**`.
**Key decisions**: Barracks handler with `params { barracksId, recipeIndex, unitType }`; the source is
`{ kind: 'building', side: 'input' }`. `onFailed`/`onUnitRemoved` clear `activeTrainings` and emit
`barracks:trainingInterrupted`, which fixes the stuck barracks. The recipe stays consumed (see Decisions).
`onRestoreComplete` rebuilds `activeTrainings` from commitments.
**Acceptance**: `world/barracks-training.spec.ts` unchanged. New: carrier killed mid-walk → barracks trains the next recipe;
save mid-walk and mid-FIGHT-wait → training completes once, without a double transform.

### Readers & siege migration
**Files**: `features/building-siege/**`, `features/combat/combat-feature.ts`, `features/ai-player/internal/military-planner.ts`,
debug composables/CLI.
**Key decisions**:
- Siege door attackers and defenders become `hold(unit, 'siege', buildingId, true)` (registered `persist: false`). The siege
  `HoldOwnerHandler.onUnitRemoved` releases the other participants, which fixes the attacker leak at
  `building-siege-system.ts:201-204`.
- `releaseSiegeUnit` releases only `'siege'` holds.
- The AI idle check uses `commitments.isIdle && !hidden`. Combat uses `commitments.isReserved`.

**Acceptance**: `building-siege`, `siege-stone-throwing` unchanged. New: defender removed outside combat frees the attackers.

### Cleanup
**Depends on**: every migration merged.
**Key decisions**:
- Delete the legacy path and these: `synthetic`, `onCancel`, `metadata`, `transportData`, `waypoints`, `TransportData`,
  `UnitDemandJobHandlers` (move `IntervalDrain` to `systems/interval-drain.ts`), `UnitReservationRegistry`,
  `ctx.unitReservation`, `CLEANUP_PRIORITY.RESERVATIONS`, `entity.jobId`/`clearJobId`/`nextJobId`, `numericJobId`, the
  `carrier:transportCancelled` handler in `settler-lifecycle.ts`, and `JobChoreographyStore.registerSyntheticJob`'s "synthetic"
  wording.
- Grep gate: no `settler:taskCompleted|settler:taskFailed` subscriptions outside `debug/`, timeline and tests.
- Update the docs: `logistics-task-simplification.md` (invariants → link here), `entity-job-id.md` (superseded note),
  `feature-modules.md` (registering a JobKind handler), `design-rules.md` (an "idle" rule next to Rule 6.0).

## File Map

### New Files
| File | Subsystem | Purpose |
|---|---|---|
| `src/game/systems/unit-commitment.ts` | Core | `UnitCommitments` store + `UnitCommitmentQuery` |
| `src/game/systems/choreo/job-kind.ts` | Core | `JobKind`, `JobSpec`, `JobParams`, `JobBuild`, `JobKindHandler`, failure types |
| `src/game/features/settler-tasks/job-service.ts` | Core | `JobService` facade: registry, assign/cancel/hold, startup assertion |
| `src/game/features/settler-tasks/work-job-kind.ts` | Core | `Work` handler (XML store build) |
| `src/game/features/settler-tasks/internal/job-outcomes.ts` | Core | complete / fail / preempt / cancel routing (out of `job-runner.ts`) |
| `src/game/features/settler-tasks/internal/unit-removal.ts` | Core | COMMITMENTS-priority cleanup handler |
| `src/game/features/settler-tasks/internal/job-resume.ts` | Core | build + generalised snap + hooks on restore |
| `src/game/features/logistics/transport-job-kind.ts` | Transport | Transport handler (replaces `transport-job-builder.ts`) |
| `src/game/features/recruit/recruit-segments.ts` | Recruit | `RecruitSegments` + node hooks |
| `src/game/features/recruit/recruit-job-kind.ts` | Recruit | `Recruit` handler |
| `src/game/features/building-demand/workplace-dispatch-kind.ts` | Workplace | handler |
| `src/game/features/building-construction/construction-job-kind.ts` | Construction | handler (absorbs `construction-jobs.ts`) |
| `src/game/features/tower-garrison/internal/garrison-job-kind.ts` | Garrison | handler + hold owner |
| `src/game/features/barracks/barracks-job-kind.ts` | Barracks | handler |
| `src/game/systems/interval-drain.ts` | Cleanup | moved from `unit-demand-loop.ts` |
| `tests/unit/integration/jobs/*.spec.ts` | each | per-kind save/restore and kill-mid-job specs (`work-`, `transport-`, `recruit-`, `workplace-`, `construction-`, `garrison-`, `barracks-`, `siege-`) |

### Modified Files
| File | Subsystem | Change |
|---|---|---|
| `src/game/systems/choreo/types.ts` | Core (+Cleanup) | node `goal`/`args`; job `kind/ref/params`; remove legacy fields in Cleanup |
| `src/game/systems/choreo/choreo-builder.ts` | Core | returns `JobBuild`; recruit-specific methods removed |
| `src/game/systems/choreo/choreo-system.ts` | Core | `ChoreoNodeHooks` registration/lookup |
| `src/game/systems/entity-cleanup-registry.ts` | Core | `COMMITMENTS` priority (RESERVATIONS removed in Cleanup) |
| `src/game/features/settler-tasks/job-runner.ts` | Core | assign via spec, commitments, split |
| `src/game/features/settler-tasks/settler-task-persistence.ts` | Core | new format; pending jobs; `onRestoreResume` |
| `src/game/features/settler-tasks/settler-lifecycle.ts` | Core (+Cleanup) | removal moved to `unit-removal.ts`; dead branch deleted |
| `src/game/features/settler-tasks/{types.ts,unit-runtime.ts,move-commands.ts,worker-assignments.ts,settler-tasks-feature.ts,internal/movement-executors.ts,internal/job-events.ts,internal/settler-debug.ts}` | Core | `TaskDispatcher`/exports, move commitments, `findIdleSpecialist`, `node.goal`, `settler:jobAborted` |
| `src/game/features/settler-location/enter-building-executor.ts` | Core | `node.args` |
| `src/game/features/feature.ts`, `feature-registry.ts`, `src/game/game-services.ts` | Core | `ctx.unitCommitments`, `onRestoreResume` |
| `src/game/state/persistence-types.ts`, `src/game/state/game-state-persistence.ts`, `src/game/entity.ts`, `src/game/game-state.ts` | Core (+Cleanup) | format v18; drop `jobId`/`nextJobId` in Cleanup |
| `src/game/event-types-features.ts` | Core | `settler:jobAborted`; payloads gain `ref` |
| `src/game/features/logistics/{logistics-dispatcher.ts,carrier-assigner.ts,transport-job-service.ts,transport-job-store.ts,internal/transport-executors.ts,logistics-snapshot.ts,fulfillment-diagnostics.ts,logistics-dispatcher-feature.ts,demand-ledger-feature.ts}` | Transport | handler use, direct cancel, record-id counter |
| `src/game/features/carriers/idle-carrier-pool.ts` | Transport | `commitments.isIdle` |
| `src/game/features/recruit/{unit-transformer.ts,recruit-system.ts,recruitment-job.ts,recruit-choreo-executors.ts,tool-source-resolver.ts,recruit-feature.ts,index.ts}` | Recruit | segments, unit-keyed reservations, hooks |
| `src/game/features/building-demand/{building-demand-system.ts,building-demand-feature.ts,types.ts}` | Workplace | handler, ref lookup, restore from commitments |
| `src/game/features/building-construction/{construction-site-demand.ts,construction-worker-demands.ts,internal/construction-executors.ts,building-construction-feature.ts}` | Construction | handler, rebind on restore |
| `src/game/features/tower-garrison/{tower-garrison-manager.ts,tower-garrison-feature.ts,tower-garrison-auto-system.ts,internal/garrison-dispatch.ts,internal/garrison-commands.ts,types.ts}` | Garrison | holds, handler, drop `garrisonJobs` |
| `src/game/features/barracks/{barracks-training-manager.ts,barracks-feature.ts}` | Barracks | handler, failure/death, restore |
| `src/game/features/building-siege/{building-siege-system.ts,tower-assault-system.ts,siege-helpers.ts,building-siege-feature.ts}` | Readers & siege | siege holds |
| `src/game/features/combat/combat-feature.ts`, `src/game/features/ai-player/internal/military-planner.ts`, `src/composables/useLogisticsDebug.ts`, `src/game/cli/commands/economy.ts` | Readers & siege | read commitments |
| **Deleted in Cleanup**: `src/game/systems/unit-reservation.ts`, `src/game/systems/unit-demand-loop.ts`, `src/game/features/logistics/transport-job-builder.ts`, `src/game/features/building-construction/construction-jobs.ts`, `src/game/features/restore-utils.ts` (if no users remain) | Cleanup | |

## Verification

- **Every kind, save mid-job.** `sim.saveAndRestore()` while a unit is walking and while it is in its irreversible node. The
  unit resumes with the same owner/ref, the side effect is not duplicated (transform, pickup, dig), and the end state matches a
  run without a save.
- **Every kind, unit killed mid-job.** `sim.killUnit()` at each phase. The owner's domain state is released (no stuck demand,
  barracks, slot, stock claim or tool reservation), and the next tick redispatches where the domain expects it.
- **Idle has one meaning.** For every unit, `commitments.isIdle` agrees with `IdleCarrierPool`, `findIdleSpecialist` and the AI
  idle check. A carrier on a player move is never picked by logistics.
- **No regressions.** The full `pnpm test:unit` run (once, teed) passes without changing existing expectations. The grep gate
  from the Cleanup subsystem holds.

## Risks

- **Restore ordering.** Owners rebuild from commitments before jobs are resumed. If an owner reads job state (nodes) in
  `onRestoreComplete`, it sees nothing. Mitigation: the contract says owners read only commitments and params there.
- **Re-entrancy.** Handlers that call `assign` from `onCompleted`/`onFailed` (construction chaining, logistics flush) must see a
  clean runtime. Covered by the commitment-lifecycle spec.
- **Determinism.** Restored workers now resume instead of being redispatched. Replays and keyframes that straddle a load will
  differ from older recordings. The determinism validator compares live runs only, so this is acceptable.
- **Recruit reserved for the whole job** (behaviour change). The player cannot move a freshly recruited digger until its first
  dig finishes.
- **Parallel transition.** Until Cleanup lands, the legacy and new paths coexist. Legacy jobs keep the broadcast, so a migrated
  owner must not also keep its old `settler:task*` subscription (double handling).
- **`job-runner.ts` size.** Core must split it as specified, or lint fails partway through the migrations.

## Decisions (confirmed by the user, 2026-10-21)

1. **Old saves: no migration.** Bump `SNAPSHOT_VERSION` 17 → 18; v17 saves are rejected by the existing stale-save notice.
2. **Delete `entity.jobId`.** Nothing outside the simulation relies on it (only persistence and debug event formatting touch
   job ids). This supersedes `entity-job-id.md`.
3. **Barracks failure: recipe stays consumed.**
4. **Recruit reservation: reserved until the whole job ends.** No per-node "reserved until" flag.
5. **Restored construction/workplace workers resume** their job instead of being redispatched.
6. **Combat is not a commitment owner.** Units in combat are soldiers, which are never candidates for carrier/worker picking,
   so "in combat" needs no idle-definition integration. Dropped from scope.

## Out of Scope

- Persisting the recruit queue, siege/assault state, the combat state and pioneer activation (`activated-position-handler.ts`).
- Changes to DemandLedger, carrier ranking cost, `DestCapacity` (P2 items in `logistics-task-simplification.md`).
- Re-modelling combat movement as jobs.

## Core implementation notes (as shipped on `refactor/job-ownership-core`)

Everything below is what migrations build on. "TRANSITIONAL" marks code that exists only so legacy
(not yet migrated) kinds keep working; the Cleanup subsystem deletes it (list at the end).

### Shipped API

| What | Where | Notes |
|---|---|---|
| `JobKind`, `JobParamValue`, `JobParams`, `JobSpec`, `JobBuild`, `JobFailureReason`, `JobFailureInfo`, `JobKindHandler` | `systems/choreo/job-kind.ts` (re-exported from `systems/choreo` and, for `JobKind`, from `systems/choreo/types`) | `JobBuild` has an extra **`jobId: string`** (display / XML id — events, debug). `JobKindHandler` has an extra optional **`restorable?(unitId, ref, params): boolean`**, called on restore *before* `build` (false ⇒ `onFailed('restoreFailed')`), so `build` may keep using `getEntityOrThrow` & co. |
| `ChoreoNode.goal?`, `ChoreoNode.args?`, `ChoreoNodeArgs` | `systems/choreo/types.ts` | As in Shared Contracts. A node `goal` makes GO_TO_TARGET set `job.targetPos = goal` **and** `job.targetId = goal.entityId ?? null` at that node — exactly the legacy waypoint semantics. So pass the entity id to `goTo(tile, entityId)` when the walk must end at a building door / next to a map object; a later `.target(id)` does not survive a goal-carrying GO_TO. |
| `ChoreoJobState.kind / ref / params` | `systems/choreo/types.ts` | `params` is mutable only for CHANGE_JOB (Work). Legacy jobs: `ref = -1`, `params = {}`. `createChoreoJobState(jobId, nodes, synthetic, owner: ChoreoJobOwner \| JobKind)`. |
| `ChoreoNodeHooks`, `ChoreoSystem.register(type, executor, hooks?)`, `ChoreoSystem.hooksFor(type)` | `systems/choreo/choreo-system.ts` | Hooks run for **every** job containing the node (owned and legacy). Core marks only ENTER_BUILDING `irreversible` (`ENTER_BUILDING_HOOKS`). Each migration marks its own task types when it registers their executors: TRANSFORM_* (Recruit), DIG_TILE / BUILD_STEP (Construction), TRANSPORT_PICKUP / TRANSPORT_DELIVER (Transport). |
| `ChoreoBuilder.toJobBuild(): JobBuild` | `systems/choreo/choreo-builder.ts` | The owned-job output: every `goTo` node carries its `goal`; `goToDoorAndEnter(id)` / `enterBuilding(id)` put `args: { task: 'enterBuilding', buildingId }` on ENTER_BUILDING. `build()` (legacy `ChoreoJobState`, waypoints + metadata, no goals) stays until Cleanup. `enterBuilding()` now takes the building id. |
| `CommitmentOwner`, `UnitCommitment`, `UnitCommitmentQuery`, `UnitReservationQuery`, `UnitCommitmentWriter`, `UnitCommitments` | `systems/unit-commitment.ts` | Kernel store built by `GameServices` (`services.unitCommitments`). `unitsOwnedBy` returns ascending ids. |
| `ctx.unitCommitments: UnitCommitmentQuery` | `features/feature.ts` | Available to every feature (also those loaded before settler-tasks: combat, carriers). |
| `ctx.claimUnitCommitmentWriter()` | `features/feature.ts` | Called once, by settler-tasks; a second call throws (Invariant 3). Nobody else calls it. |
| `FeatureInstance.onRestoreResume?()` | `features/feature.ts`, `FeatureRegistry.notifyRestoreResume`, `GameServices.notifyRestoreResume`, step 8 of `restoreFromSnapshot` | Runs after every `onRestoreComplete`. settler-tasks resumes pending jobs there. |
| `SettlerTaskExports.jobs: JobService` | `features/settler-tasks/job-service.ts` | `registerKind(handler)`, `registerHoldOwner(handler)`, `assign(unitId, spec, { moveTo }?) → boolean`, `cancel(unitId, owner)`, `hold(unitId, owner, ref, reserved)`, `releaseHold(unitId, owner)`, **`paramsOf(unitId)`** (added: params of the unit's running *or restored-but-not-resumed* owned job — what owners rebuild from in `onRestoreComplete`), `commitments`. Also exported from `features/settler-tasks`: `JobService`, `JobAssignOptions`, `HoldOwnerHandler`, `WorkJobParams`. |
| `HoldOwnerHandler` | `features/settler-tasks/internal/job-owners.ts` (re-exported) | `{ owner, persist, onUnitRemoved(unitId, ref), onPreempted(unitId, ref) }`. |
| `TaskDispatcher.assignMoveTask(unitId, target, owner = 'player-move')` | `features/settler-tasks/types.ts` | See "Move commitments". |
| Events | `event-types-features.ts` | `settler:taskCompleted` gains `ref`; `settler:taskFailed` gains `ref` and `reason: JobFailureReason`; new `settler:jobAborted { unitId, jobId, kind, ref, reason: 'unitRemoved' \| 'cancelled' \| 'restoreFailed' }` (`jobId` is `''` for a restored job that was never rebuilt). |
| `CLEANUP_PRIORITY.COMMITMENTS = -100` | `systems/entity-cleanup-registry.ts` | TRANSITIONAL: `RESERVATIONS` moved to **-110**, so the legacy forced-release callbacks still run first, exactly as before. |
| `SNAPSHOT_VERSION = 18`, `SerializedUnitRuntime { id, home?, commitment? }`, `SerializedCommitment`, `SerializedJob` | `state/game-state-persistence.ts`, `state/persistence-types.ts` | As specified. `SerializedJobIntent` and `SerializedUnitRuntime.state` are gone. `entity.jobId` / `nextJobId` are still saved (Cleanup). |
| `sim.killUnit(id)` | `tests/unit/helpers/simulation-units.ts` (method on `Simulation`) | `remove_entity` through the command pipeline, like combat death. |

### How a migration switches a kind from legacy to owned

1. In the owner feature's `create()`: `const { jobs } = ctx.getFeature<SettlerTaskExports>('settler-tasks');`
   `jobs.registerKind(handler)` (barracks does not depend on `'settler-tasks'` yet — add it). Holds need
   `jobs.registerHoldOwner(...)` too — a JobKind handler is **not** implicitly a hold owner (Garrison
   registers both: its kind handler for en-route jobs and a hold owner for garrisoned units).
2. Declare params as a **type alias** (`type GarrisonParams = { readonly towerId: number }`): interfaces have
   no implicit index signature and are not assignable to `JobParams`.
3. `build(unitId, params)` returns `choreo(jobId).goToDoorAndEnter(...)/goTo(...)/addNode(task, { args }).toJobBuild()`.
   Executors of migrated nodes read `node.args` / `node.goal`; an executor shared with still-legacy jobs must keep
   its legacy `metadata` / `transportData` branch until Cleanup (see `enter-building-executor.ts` for the pattern).
4. Dispatch with `jobs.assign(unitId, { kind, ref, params, reserved }, { moveTo })` instead of
   `taskDispatcher.assignJob(unitId, choreo(...).build(), moveTo)`; `assignJob` now throws for owned jobs.
5. In the same change, delete the kind's `settler:taskCompleted` / `settler:taskFailed` subscriptions (owned jobs
   still emit them as notifications → double handling otherwise) and its `unitReservation.reserve/release`
   calls (`reserved` replaces them; readers use `ctx.unitCommitments.isReserved`).
6. Building removed / owner stops: `for (const id of jobs.commitments.unitsOwnedBy(kind, ref)) jobs.cancel(id, kind)`.
7. Restore: in `onRestoreComplete` rebuild domain state from `jobs.commitments.unitsOwnedBy(kind)` + `jobs.paramsOf(id)`
   (the job itself is not built yet; holds have no params — use `ref`). Never assign in
   `onRestoreComplete` to a unit that has a restored commitment: takeover of a not-yet-resumed job throws.
   Jobs resume by themselves in `onRestoreResume`; use `restorable` / `resumeIndex` / node `onRestore`.
8. Mark irreversible task types and add `onAbort` / `onRestore` hooks where the executors are registered.

### Semantics as implemented (deviations / refinements)

- **Preemption.** `assign`, `assignMoveTask` and `hold` take a unit over through one path
  (`JobOutcomes.takeOver`): a running job ends with `onFailed('preempted')` (always, also when the new owner is
  the same kind); a hold / move of *another* owner gets `HoldOwnerHandler.onPreempted`; a hold of the same owner is
  replaced silently. A completion handler that re-assigns during a takeover (job had run all nodes) gets that
  follow-up preempted too; re-assigning again from `onFailed('preempted')` throws.
- **Owner cancel** (`jobs.cancel`) is a no-op when `owner` does not own the unit (idempotent, like
  `TransportJobService.cancel`). It runs the same teardown as a failure (drop carried goods, exit the home building,
  `onWorkInterrupt`, node `onAbort`), sets INTERRUPTED and emits only `settler:jobAborted 'cancelled'` — no
  `settler:taskFailed`. On a hold / move it just ends it (a running move stops).
- **Failure order** is the same for owned and legacy jobs: `runtime.job` is nulled first (legacy: then `onCancel`),
  teardown + `onAbort`, commitment cleared, INTERRUPTED, owner `onFailed` (owned only), `settler:taskFailed`.
  For legacy jobs this moves INTERRUPTED before the event (a listener that re-assigns now sticks) and stops the
  re-entrant `carrier:transportCancelled` → second `taskFailed` (the job is already gone when it arrives).
  `clearInterrupted` no longer clears the job (it is cleared when the job ends).
- **Move commitments.** `assignMoveTask(id, t)` commits to `'player-move'` (ref -1, unreserved) for the walk; the
  commitment ends when the walk ends (or the lifecycle drops the move). `assignMoveTask(id, t, 'siege')` requires an
  existing `'siege'` hold (throws otherwise), keeps its ref / reserved, and the commitment stays as a hold after the
  walk. `releaseHold` during such a walk lets it finish as an unreserved `'player-move'`. Core registers the
  `'player-move'` hold owner itself (`persist: true`).
- **`hold` on a unit running a job of the same owner throws** (cancel first); `releaseHold` on a unit whose
  `owner` commitment runs a job throws (use `cancel`).
- **Unit removal** (`internal/unit-removal.ts`, COMMITMENTS): owned job → stop trigger, `onWorkInterrupt`, node
  `onAbort`, clear commitment, `owner.onUnitRemoved`, `settler:jobAborted 'unitRemoved'`; hold / move → clear,
  `HoldOwnerHandler.onUnitRemoved`; then position-handler `onSettlerRemoved`, idle-search cooldowns, home release
  **without** location calls (`WorkerAssignments.releaseRemovedUnit`; settler-location drops its record at DEFAULT),
  runtime delete. The commitment is cleared before the owner is called, so `unitsOwnedBy` no longer lists the dead unit.
  The TickSystem `onEntityRemoved` path keeps only the building branch; the dead `cleanupSettlerHandlers` branch and
  `WorkHandlerRegistry.findEntityHandlerForJob` are deleted.
- **TRANSITIONAL legacy removal path:** a legacy job of a removed unit runs its `onCancel` and emits
  `settler:taskFailed` (reason `'failed'`, `wasCarrying` from the snapshot) before the runtime is deleted, then
  `settler:jobAborted 'unitRemoved'`. This already fixes the dead-unit leaks of the legacy owners (transport record
  cancelled, construction / workplace demand re-opened) — see `tests/unit/integration/jobs/unit-removal.spec.ts`.
  When a kind migrates, it gets `onUnitRemoved` instead and must not rely on that `taskFailed`.
- **Resume snapping refinement:** the floor is the index after the last irreversible node that **completed**
  (nodes before the saved index), not "at or before i" — the saved node itself has not run yet. A job saved after its
  last node (completion pending) whose last node is irreversible resumes at `nodes.length` and completes on the next
  tick. With no irreversible nodes (XML) this is exactly the old `snapToSafeNode`. If any node `onRestore` refuses,
  the nodes that already restored get `onAbort` before the job is abandoned.
- **Abandoned restore:** commitment cleared, unit INTERRUPTED, `onFailed(…, { reason: 'restoreFailed', nodeIndex:
  <saved raw index>, failedStep: 'restore' })`, `settler:jobAborted 'restoreFailed'`.
- **Work kind:** `ref` = home building id or -1, `params = { choreoJobId }`; CHANGE_JOB updates `params` to the new
  XML id (as the old intent saved the current `jobId`). Autonomy's `startJob` sets the Work commitment directly.
- **Startup assertion:** `JobService.assertAllRegistered()` (called by `GameServices`) skips the kinds in
  TRANSITIONAL `TRANSITIONAL_UNOWNED_KINDS` (`internal/job-owners.ts`). Migrations do **not** edit that set — a
  registered kind is fine either way; Cleanup deletes it so every kind is asserted.
- **Idle / reserved during the transition:** `isIdle(id)` = no commitment and not legacy-reserved; `isReserved(id)` =
  commitment reserved or legacy-reserved. Legacy jobs get a commitment too (`owner = job.kind`, ref -1, unreserved),
  so `isIdle` is already right for every running job. `findIdleSpecialist` = IDLE state ∧ no home ∧ `isIdle`.
  Move commands read `ctx.unitCommitments.isReserved`.
- **Persistence:** legacy jobs (and their commitments) are not saved — their features rebuild them as before;
  commitments of `persist: false` owners are dropped; a move whose path is blocked on load leaves a
  `'player-move'` unit idle, any other owner keeps its hold.
- **Debug:** `SettlerDebugEntry` gains `owner`, `ownerRef`, `reserved`.

### File layout of the split runtime (`features/settler-tasks/`)

`job-runner.ts` (start + node advance, legacy `assignJob`) · `job-service.ts` · `work-job-kind.ts` ·
`internal/job-outcomes.ts` (complete / fail / takeover / cancel) · `internal/move-tasks.ts` (MoveTaskRunner) ·
`internal/unit-removal.ts` · `internal/job-resume.ts` (snap, PendingJobResumes, resume) · `internal/job-owners.ts`
(registry) · `internal/job-teardown.ts` (shared teardown steps) · `internal/job-runtime.ts` (wiring).

### Files Core touched outside its File Map rows

- `features/settler-location/index.ts` — registers ENTER_BUILDING with `ENTER_BUILDING_HOOKS`.
- `debug/event-formatting.ts` — formatter for `settler:jobAborted` (compile-forced: the map is exhaustive).

### TRANSITIONAL shims Cleanup deletes

`ChoreoJobState.synthetic` (now means "legacy job") and every `synthetic` branch (`JobOutcomes.fail`,
`internal/unit-removal.ts`, `settler-task-persistence.ts`, `settler-lifecycle.ts#handleTransportCancelled`);
`JobRunner.assignJob` / `TaskDispatcher.assignJob`; `ChoreoBuilder.build()`, `meta()`, `transformRecruit*()`,
`transformDirect()`; the waypoint branch of `makeGoToTarget`; the metadata branch of the ENTER_BUILDING executor;
`TRANSITIONAL_UNOWNED_KINDS`; the legacy-registry OR in `UnitCommitments` (+ its constructor arg);
`CLEANUP_PRIORITY.RESERVATIONS`; `ctx.unitReservation` / `GameServices.unitReservation`; `entity.jobId`
(still set by `startAssignedJob`, cleared on job end) and `nextJobId`.

### Garrison migration notes (as shipped on `refactor/jobs-garrison`)

- **Kind + hold owner** in `features/tower-garrison/internal/garrison-job-kind.ts`, both registered in the feature's
  `create()`. Job: `{ kind: Garrison, ref: towerId, params: { towerId }, reserved: true }`, build =
  `choreo('WORKER_DISPATCH', Garrison).goToDoorAndEnter(towerId).toJobBuild()`; `restorable` ⇔ the tower is registered.
  `onCompleted` → `finalizeGarrison` → `jobs.hold(unit, Garrison, towerId, true)` + slot. `onFailed` → release the home
  assignment + `cancelApproach`. `onUnitRemoved` (job) is a no-op: Core drops the home, settler-location the location
  record, and en-route counts are derived from commitments. Hold owner (`persist: true`): `onUnitRemoved` frees the
  slot; `onPreempted` vacates the slot and exits the building (unit leaves the tower).
- **Derived from commitments**: `isEnRoute`, `getTowerIdForEnRouteUnit`, `getEnRouteSlotCounts`, `needsAutoGarrison`
  (no Garrison commitment for the tower), ownership-change cancel (`cancelEnRouteUnitsOf` → `jobs.cancel`). Removed:
  `garrisonJobs` (feature `persistence: 'none'`), `getEnRouteEntries`, `getCancelledEnRouteUnits`,
  `rebuildFromGarrisonJobs` (→ `rebuildFromHolds`), the `settler:taskCompleted` / `settler:taskFailed` /
  `settler-location:approachInterrupted` subscriptions, all `unitReservation` use, `entity.jobId` writes.
- **Restore**: `onRestoreComplete` = `initTower` for every completed garrison building, then slots from the holds
  (slot order after a load = ascending unit id; before it was garrison order). En-route jobs resume in Core's
  `onRestoreResume`; nothing is assigned in `onRestoreComplete`.
- **Dispatch**: `TowerGarrisonManager.dispatchUnitToGarrison(unitId, towerId)` (wraps `internal/garrison-dispatch.ts`)
  — `jobs.assign` with `moveTo` = approach tile (none when already standing on it), then `assignWorker`. A failed
  dispatch assigns nothing, so the commands no longer roll back an approach. Auto-garrison skips
  `ctx.unitCommitments.isReserved` units (covers en-route and garrisoned).
- **Outside scope**: `features/building-siege/building-siege-system.ts` — `dispatchCapturer` calls
  `this.garrisonManager.dispatchUnitToGarrison(...)` instead of importing the internal function (its `terrain` /
  `workerAssignments` fields are now unused there; the Readers & siege migration can drop them).
- **For Readers & siege / Cleanup**: combat (`combat-feature.ts`) and siege (`isIdleSwordsman`, `findSwordsmanAtDoor`,
  `hasDoorCloserThan`) still read the legacy `ctx.unitReservation`, which no longer contains garrison units — they must
  switch to `ctx.unitCommitments.isReserved` (garrisoned units are hidden, so only en-route units are affected).

## Recruit migration notes (as shipped on `refactor/jobs-recruit`)

### Shipped API (`features/recruit`, all exported from its `index.ts`)

```ts
// recruit-segments.ts — flat on purpose: JobParams allows one nesting level, so the design's
// nested `source: RecruitSource` union cannot be a param value. The segment IS a valid param value.
type RecruitSourceKind = 'pile' | 'building' | 'direct';
type RecruitSegment = {
    readonly targetUnitType: UnitType;
    readonly source: RecruitSourceKind;
    readonly sourceId: number | null;                        // pile entity id / building id; null for 'direct'
    readonly at: { readonly x: number; readonly y: number } | null; // walk goal; null for 'direct'
};
interface BuildingRecruitCharge { readonly costs: readonly MaterialCost[]; readonly side: InventorySide }
type BuildingRecruitChargeFn = (buildingId: number, targetUnitType: UnitType) => BuildingRecruitCharge;

interface RecruitSegments {                                    // RecruitExports.recruitSegments
    nodes(segment): ChoreoNode[];                              // [GO_TO_TARGET goal{at, entityId: sourceId}] + TRANSFORM_* { args: transform }
    prefix(segment, continuation: JobBuild): JobBuild;         // nodes(segment) ++ continuation.nodes; targets = source (or continuation's for 'direct')
    reserve(carrierId, segment): boolean;                      // false ⇒ source gone/taken, do not assign
    release(carrierId): void;                                  // ONLY to undo reserve() when assign failed
    registerBuildingCharge(buildingType, charge: BuildingRecruitChargeFn): void;
    chargeFor(buildingId, targetUnitType): BuildingRecruitCharge; // throws if the type registered none
}

// recruit-system.ts
type RecruitSpecBuilder = (carrierId: number, segment: RecruitSegment) => JobSpec;
interface DispatchRecruitmentOpts { target?: Tile; hint?: Tile; buildSpec?: RecruitSpecBuilder; buildJob?: /* legacy */ }
RecruitSystem.dispatchRecruitment(unitType, player, opts?): number | null
RecruitSystem.dispatchRecruitmentFromPile(unitType, player, pileEntityId, opts?): number | null
RecruitSystem.dispatchBuildingRecruitment(unitType, player, buildingId, buildSpec): number | null   // new, owned only

// recruit-job-kind.ts
type RecruitJobParams = { readonly segment: RecruitSegment };
recruitJobSpec(segment): JobSpec<RecruitJobParams>             // { kind: Recruit, ref: 0, params: { segment }, reserved: true }
```

With `opts.buildSpec` the dispatcher picks (carrier, source), builds the segment, calls
`segments.reserve(carrier, segment)`, then `buildSpec(carrier, segment)` and
`jobs.assign(carrier, spec, { moveTo: segment.at })` (no `moveTo` for 'direct'); a failed assign
releases the reservation. `buildSpec` and `buildJob` together throw.

**Reservation ownership.** `ToolSourceResolver` pile and building-material reservations are keyed by
the carrier id (`reservePile/releasePile`, `reserveBuildingMaterials(carrierId, …)`,
`withdrawBuildingReservation(carrierId)`, `releaseBuildingReservation(carrierId)`,
`getBuildingReservation(carrierId)`); handle ids are gone. `UnitTransformer.pending` is keyed by unit
(`reserveTransform(carrierId, unitType, source, legacyReserved?)` / `abortTransform(carrierId)`) and
ends only through: the TRANSFORM_* executor (`recruitment:completed`), the TRANSFORM_* `onAbort` hook,
or `recruitment:failed` (pile empty on arrival). Its `settler:taskFailed` subscription, the
`onForcedRelease` callbacks, `registerTransform`, `registerDirectTransform`,
`assignAndRegisterTransform` and `requestDirectTransform` are deleted. Release and consume are strict
(throw when the carrier holds nothing), so a double release fails loudly.

**Node hooks** (TRANSFORM_RECRUIT, TRANSFORM_RECRUIT_BUILDING, TRANSFORM_DIRECT, one shared
object): `irreversible: true`; `onAbort` → `abortTransform(unitId)` (runs for legacy jobs too — it is
the only release path for them now, which fixes the leaked barracks building reservation on job
failure and the leaked pile on owner cancel); `onRestore` → re-resolve the source from
`node.args.transform` + task type and `reserveTransform` (false when the pile is gone / reserved /
in an input slot, or the building is gone / short of unreserved stock). Reservations are never
persisted; they are derived from the restored job.

**Building sources need a registered charge.** The TRANSFORM_RECRUIT_BUILDING args carry only the
building id (`ChoreoNodeArgs.transform` is Core's), so the hooks re-resolve costs + side with
`segments.chargeFor(buildingId, unitType)`, from the charge the building type registered.

**Player queue** dispatches stand-alone `Recruit` jobs (`recruitJobSpec`, job ids `AUTO_RECRUIT` /
`BUILDING_RECRUIT` kept). The Recruit handler (`persist: true`) has no domain state to clean up, so
its callbacks only log. Behaviour change (Decision 4): queued recruits are reserved
(`commitments.isReserved`) until the job ends.

### How the next migrations consume it

- **Workplace-dispatch** (`params { buildingId, recruit: RecruitSegment | null }`): replace the default
  `dispatchRecruitment(type, player, { target })` with `{ target, buildSpec: (c, seg) => ({ kind:
  WorkplaceDispatch, ref: buildingId, params: { buildingId, recruit: seg }, reserved: true }) }`. In
  `build`: `recruit ? segments.prefix(recruit, door) : door`, where `door = choreo('WORKER_DISPATCH')
  .goToDoorAndEnter(buildingId, ctx).toJobBuild()`. `unit:recruited` still fires at the transform;
  find the demand via `commitments.get(unit).ref`. Do not release anything on failure / removal.
- **Construction** (`params { siteId, role, tileIndex, workPos, recruit }`):
  `dispatchRecruitment(Digger|Builder, player, { target: site, buildSpec })`; `build` =
  `segments.prefix(recruit, choreo('RECRUIT_DIGGER').goTo(tile).addNode(DIG_TILE, { args }).toJobBuild())`
  (or without prefix when `recruit === null`). Job ids RECRUIT_DIGGER/BUILDER can stay as the
  continuation's `jobId`. Saved after the transform, the job resumes past it (no second transform).
- **Barracks** (`params { barracksId, recipeIndex, unitType }`): in `create()`
  `recruitSegments.registerBuildingCharge(BuildingType.Barrack, (id, type) => ({ costs: recipe(id,
  type).inputs, side: 'input' }))` (the recipe must be derivable from building + target type — it is,
  per race), then `recruitSystem.dispatchBuildingRecruitment(target, player, barracksId, buildSpec)`.
  `build` re-creates the segment `{ targetUnitType, source: 'building', sourceId: barracksId, at: door }`
  (replace `at` with the door to keep today's walk) and appends WAIT(FIGHT):
  `segments.prefix(segment, choreo('BARRACKS_TRAINING').addNode(WAIT, …).target(barracksId).toJobBuild())`.
  The material reservation is released by the node hook — the manager only clears `activeTrainings`.

### TRANSITIONAL compat kept (Cleanup deletes)

- `DispatchRecruitmentOpts.buildJob` and the no-`buildSpec` default of `dispatchRecruitment` (legacy
  AUTO_RECRUIT job of kind WorkplaceDispatch — building-demand relies on it until it migrates).
- `dispatchRecruitmentFromBuilding(unitType, player, buildingId, costs, opts?, side)` (barracks);
  `candidate.reservationId` is now the carrier id.
- `createRecruitmentJob`, `createDirectTransformJob` (`recruitment-job.ts`), the metadata branch of
  the TRANSFORM_* executors, `ChoreoBuilder.transformRecruit*/transformDirect`.
- `UnitTransformerConfig.unitReservation` + `reserveTransform(…, legacyReserved = true)`: legacy
  recruit jobs still hold a legacy unit reservation (released with the pending record).
- `RecruitmentCandidate.reservationId`.

### Tests

`tests/unit/integration/jobs/recruit-reservations.spec.ts` (fail / kill / owner-cancel before the
transform release the pile and the building materials — the barracks-failure and owner-cancel cases
failed before the fix) and `recruit-restore.spec.ts` (saved on the way: same owner, pile still
reserved, transforms once; pile gone on load: abandoned, carrier idles; resume never crosses a
completed transform; building source saved on the way re-reserves and withdraws once; killed
releases).

### Readers & siege migration notes (as shipped on `refactor/jobs-siege`)

- **Siege holds**: the ejected defender and every door attacker are `jobs.hold(unit, 'siege', buildingId, true)`
  (`features/building-siege/siege-participants.ts`: `join` = hold + movement `busy`; `release` = clear busy, unlock,
  release from combat, `releaseHold(unit, 'siege')` — never touches another owner's commitment). Invariant: a unit is
  listed in a `SiegeState` ⇔ it holds a `'siege'` commitment for that building; every path that drops a unit from a
  siege releases it (including attackers that left the door tiles — before, they stayed reserved and busy).
- **Hold owner** `'siege'` (`persist: false`, registered by `building-siege-feature.ts`): `onUnitRemoved` → the unit leaves
  its siege like a defeat (defender: release the door attackers and eject the next defender — **fixes the attacker
  leak** when the defender is removed outside combat); `onPreempted` → release the unit and leave the siege. The
  DEFAULT-priority siege cleanup handler and the "defender entity missing" tick branch are deleted (the hold owner
  covers them). `combat:unitDefeated` looks the siege up by the commitment `ref` (`findSiegeRole` deleted).
- **Door attackers**: a unit reserved by another owner (another siege, a Garrison walk) is skipped instead of being
  shared. An attacker joined while its player move is still ending keeps walking under the siege hold; released
  mid-walk it finishes as an unreserved `'player-move'` (Core semantics).
- **Readers**: siege (`hasDoorCloserThan`, `isIdleSwordsman`, `findSwordsmanAtDoor`, `onMovementStopped`), tower assault
  and combat (`isUnitReserved`) read `ctx.unitCommitments.isReserved`. The AI idle check
  (`military-planner.ts#getIdleMilitaryUnits`) is `unitCommitments.isIdle(id) && !hidden` (was "empty path"); the
  dependency is threaded through `ai-player-feature.ts` → `AiPlayerSystemImpl` → `AiPlayerController`.
- **Not migrated (blocked on Transport)**: `src/composables/useLogisticsDebug.ts` and `src/game/cli/commands/economy.ts`
  only fill `SnapshotConfig.unitReservation` (`features/logistics/logistics-snapshot.ts`, Transport's file). When Transport
  switches `SnapshotConfig` to `unitCommitments`, both builders change by one line (or Cleanup does it).
- **Tests**: `tests/unit/integration/jobs/siege-holds.spec.ts` — holds shape, defender removed outside combat frees the
  attackers, attacker removed leaves the siege, building removed releases everyone, holds not saved, a swordsman
  walking to garrison its own tower is ignored by siege and combat.
