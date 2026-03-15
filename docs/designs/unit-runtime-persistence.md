# Unit Runtime Persistence — Design

## Overview

Persist unit runtime state (move tasks, worker jobs, building assignments, prospected tiles) across save/load so that units resume their activity instead of resetting to IDLE. The approach: serialize the minimal recoverable state per unit, and on restore either resume in-progress work or replay the intent (e.g., re-issue a move command to the saved target).

## Current State

- **What exists**: `UnitRuntime` is created per unit in `SettlerTaskSystem.runtimes` (IndexedMap). Runtimes are ephemeral — `persistence: []` in the feature definition.
- **What's lost on save/load**: move tasks, active jobs (progress resets), building assignments (workers go IDLE, slowly re-acquire), prospected tiles (geologist discoveries vanish).
- **What auto-recovers**: building demand re-emits → workers get reassigned after ~10 ticks. Carrier registry rebuilt from entities. But mid-action progress and player move commands are permanently lost.

## Summary for Review

- **Interpretation**: Persist enough unit state that save/load is near-transparent. Jobs don't need frame-perfect resume — resetting to the start of the current choreography node is acceptable. Prospected tiles are a separate, straightforward data persistence.
- **Key decisions**:
  1. **Don't serialize ChoreoJobState directly** — it contains closures (`transportData.ops`, `onCancel`) and references to runtime objects (work handlers). Instead, serialize only the *intent* (jobId + homeAssignment + nodeIndex) and let the job re-acquire from the current node on restore.
  2. **Move tasks serialize as target coords** — on restore, re-issue `moveUnit()` to resume pathfinding to the saved target.
  3. **Building assignments serialize as `{buildingId, hasVisited}`** — on restore, rebuild the `workerTracker` index.
  4. **Prospected tiles** — serialize `OreVeinData.prospected` as a sparse diff (same pattern as terrain).
  5. **Transport jobs (carriers)** are NOT persisted here — they're already handled by `LogisticsDispatcherFeature` persistence + `onRestoreComplete` re-dispatch.
- **Assumptions**: Losing intra-node progress (e.g., 50% through a WORK node) is acceptable — the node restarts. This matches S4 behavior where save/load causes brief worker stutter.
- **Scope**: Unit runtimes + prospected tiles. Does NOT cover: garrison state (already has its own persistence path), combat state, carrier transport jobs.

## Conventions

- Optimistic programming — no `?.` on required deps, use `!` or `getEntityOrThrow`
- `Persistable<S>` interface from `src/game/persistence/types.ts`
- Feature persistence via `persistence: [...]` array in feature definition
- Serialized types in `src/game/state/persistence-types.ts`, exported from `game-state-persistence.ts`
- `superjson` handles Map/Set natively — use sparse arrays for typed arrays
- Bump `SNAPSHOT_VERSION` once (14 → 15)
- Max 600 lines per TS file, max 250 lines per function

## Architecture

### Subsystems

| # | Subsystem | Responsibility | Depends On | Files |
|---|-----------|---------------|------------|-------|
| 1 | Prospected Tiles Persistence | Serialize/restore `OreVeinData.prospected[]` | — | `ore-sign-feature.ts`, `ore-vein-data.ts` |
| 2 | Unit Runtime Persistence | Serialize/restore move tasks, job intent, building assignments | 1 (prospected data must exist before workers resume prospecting) | `settler-task-system.ts`, `settler-tasks-feature.ts` |

## Shared Contracts

```typescript
// === src/game/state/persistence-types.ts (add to existing file) ===

/** Serialized unit runtime — minimal state for resume-on-load. */
export interface SerializedUnitRuntime {
    /** Entity ID of the unit */
    id: number;
    /** Settler state at save time */
    state: SettlerState;
    /** Move task target (if unit was moving via player command) */
    moveTarget?: { x: number; y: number };
    /** Active job intent (if unit was working) */
    job?: SerializedJobIntent;
    /** Building assignment */
    home?: { buildingId: number; hasVisited: boolean };
}

/** Minimal job state for resuming a choreography job.
 *  We store the job ID and current node index so the job can
 *  restart from the beginning of the current (or previous movement) node.
 */
export interface SerializedJobIntent {
    jobId: string;
    /** Node index to resume from (snapped back to last movement/search node). */
    nodeIndex: number;
    /** Target entity ID if the job had acquired one (e.g., tree to chop). */
    targetId?: number;
    /** Target position if the job had one. */
    targetPos?: { x: number; y: number };
}
```

## Subsystem Details

### Subsystem 1 — Prospected Tiles Persistence

**Files**: `src/game/features/ore-veins/ore-sign-feature.ts`, `src/game/features/ore-veins/ore-vein-data.ts`

**Key decisions**:
- Serialize `OreVeinData.prospected` as a sparse diff (list of tile indices where `prospected[i] === 1`), same pattern as terrain diffs. Prospected tiles are typically <1% of the map — sparse is much smaller than full array.
- The `OreVeinData` instance is created in `onTerrainReady`, so the persistable must defer deserialization. Use a "pending data" pattern: store the raw snapshot data, apply it when `setOreVeinData()` is called.
- Alternatively (simpler): create a small `OreVeinPersistence` object that holds a reference to `OreVeinData` (set later) and buffers the deserialized data until the reference is available.

**Serialized shape**:
```typescript
/** Sparse list of prospected tile indices. */
type SerializedProspectedTiles = number[];
```

**Persistence registration**: Add to `OreSignFeature.persistence` array. `persistKey: 'prospectedTiles'`.

### Subsystem 2 — Unit Runtime Persistence

**Files**: `src/game/features/settler-tasks/settler-task-system.ts`, `src/game/features/settler-tasks/settler-tasks-feature.ts`

**Depends on**: Subsystem 1 (prospected tiles should be restored before workers try to prospect)

**Key decisions**:
- **What to serialize per unit**: `state`, `moveTask` (target only), `homeAssignment`, and a *job intent* (jobId + resume node index + target).
- **What NOT to serialize**: `idleState` (animation — trivial to reinit), `lastDirection` (cosmetic), `idleSearchReady` (scheduler state), `job.progress` / `job.carryingGood` / `job.transportData` (too coupled to runtime — restart from a safe node instead).
- **Job resume strategy**: On restore, for units with a saved job intent:
  1. Look up the choreography nodes for `jobId` from `JobChoreographyStore`.
  2. Snap `nodeIndex` back to the nearest prior movement/search node (the last node where the unit was walking to its target). This ensures the unit re-walks to its work site and re-acquires any runtime state (handler callbacks, animation) naturally.
  3. Create a fresh `ChoreoJobState` with the snapped node index, restored `targetId`/`targetPos`.
  4. Set `runtime.state = WORKING`.
- **Move task resume**: On restore, call `gameState.movement.moveUnit(entityId, targetX, targetY)` to re-issue pathfinding. Set the walk animation. If pathfinding fails (blocked), fall back to IDLE.
- **Building assignment resume**: Set `runtime.homeAssignment` directly. Rebuild `workerTracker` index via `assignWorker()` (which updates the IndexedMap secondary index).
- **Ordering**: Deserialize AFTER entities are restored (entities must exist). Use `after: ['constructionSites']` so buildings exist before we assign workers to them.

**Restore flow** (in `deserialize`):
```
for each SerializedUnitRuntime:
  1. get/create runtime for entity ID
  2. if home: call workerTracker.assignWorker(id, buildingId) + set hasVisited
  3. if moveTarget: call assignMoveTask(id, x, y) — this handles animation + state
  4. else if job: rebuild ChoreoJobState from intent, set runtime.job + state=WORKING
  5. else: leave as IDLE (will auto-search on next tick)
```

**Serialize flow** (in `serialize`):
```
for each (entityId, runtime) in runtimes:
  1. build SerializedUnitRuntime with state
  2. if moveTask: save target coords
  3. if job: save jobId, find safe resume nodeIndex, save targetId/targetPos
  4. if homeAssignment: save buildingId + hasVisited
  5. skip units that are IDLE with no assignment (nothing to persist)
```

**Persistence registration**: Create a `Persistable` object (not making SettlerTaskSystem implement it — too many interfaces already). Register in `settler-tasks-feature.ts` `persistence` array. `persistKey: 'settlerTasks'`.

## File Map

### New Files
| File | Subsystem | Purpose |
|------|-----------|---------|
| `src/game/features/settler-tasks/settler-task-persistence.ts` | 2 | `Persistable` implementation for unit runtimes — serialize/deserialize logic |
| `src/game/features/ore-veins/ore-vein-persistence.ts` | 1 | `Persistable` implementation for prospected tiles |

### Modified Files
| File | Change |
|------|--------|
| `src/game/features/settler-tasks/settler-tasks-feature.ts` | Add persistence entry to `persistence: []` array |
| `src/game/features/ore-veins/ore-sign-feature.ts` | Add persistence entry to `persistence: []` array |
| `src/game/state/persistence-types.ts` | Add `SerializedUnitRuntime`, `SerializedJobIntent` types |
| `src/game/state/game-state-persistence.ts` | Bump `SNAPSHOT_VERSION` 14 → 15 |

## Verification

1. **Prospected tiles survive save/load**: Place a geologist, let it prospect tiles, save, reload — prospected tiles and signs still visible.
2. **Move commands survive save/load**: Select a unit, right-click to move, save mid-walk, reload — unit continues walking to the same target.
3. **Worker jobs resume after save/load**: Woodcutter chopping a tree, save, reload — woodcutter walks back to a tree and resumes work (may restart the current node, but doesn't go IDLE).
4. **Building assignments survive save/load**: Workers assigned to a smithy stay assigned after reload, don't go through the slow re-assignment dance.
