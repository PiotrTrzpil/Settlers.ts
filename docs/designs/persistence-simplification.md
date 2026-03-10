# Persistence Simplification — Design

## Overview

Rethink game persistence around one principle: **persist everything, reconstruct nothing.** Every tick the game is in a consistent state. Persistence snapshots that state and restores it exactly — no recovery paths, no re-derivation, no "carrier goes idle and re-matches next tick."

## Current State

### What exists: two parallel persistence mechanisms

1. **`GameStateSnapshot` (hardcoded struct)** — `game-state-persistence.ts` defines a monolithic interface with ~30 typed fields. `createSnapshot()` manually assembles entities + terrain. `restoreFromSnapshot()` manually restores entities, terrain, then calls `deserializeAll()`.

2. **`PersistenceRegistry` (plugin-based)** — Features implement `Persistable<S>` (`persistKey`, `serialize()`, `deserialize()`). Registry collects them, serializes/deserializes in topological order. Currently 18 registered persistables.

**The problems:**

- These two systems overlap and neither is complete alone.
- Entity core state (position, type, carrying, hidden) lives in the hardcoded path.
- Feature state (trees, carriers, inventories, tasks) lives in the registry.
- Terrain lives in the hardcoded path with special diff encoding.
- `GameStateSnapshot` interface still has typed fields for feature data (leftover from before the registry existed), but the actual data comes from the registry's `serializeAll()` spread into the snapshot.
- Adding new persistent state requires: (a) implementing `Persistable`, (b) registering in `game-services.ts`, (c) optionally adding a typed field to `GameStateSnapshot`. Easy to forget step (b).
- Transport jobs are intentionally skipped — carriers go idle on load, dispatcher re-matches. This is a recovery path, not a snapshot.
- `InventoryReservationManager` is not persisted — if transport *were* persisted, reservations would need reconstruction. This is the kind of entanglement that "reconstruct on load" creates.
- Entity restoration uses `addEntity` which emits `entity:created` events, triggering feature-specific init (e.g., TreeSystem registers fresh tree state, MovementSystem creates controllers). Feature state is then *overwritten* by `deserializeAll()`. This is a reconstruct-then-overwrite pattern — features do unnecessary work during restore.

### What to keep
- The `Persistable` interface — clean contract, works well
- Topological sort for dependency ordering — necessary
- Terrain diff encoding — good optimization for auto-saves

### What to change
- Eliminate the hardcoded `GameStateSnapshot` typed fields for feature data
- Make registration automatic (impossible to forget)
- Unify entity core state into the same mechanism
- Persist ALL state including transport, reservations, request status — no recovery paths
- Entity restore should NOT trigger feature init via events — features restore their own state from the snapshot directly

## Summary for Review

- **Interpretation**: Conceptual analysis of the cleanest possible persistence architecture. Not just "what's minimal" but "what's conceptually right." The answer: every system persists its own state, no system reconstructs another system's state on load.
- **Key decisions**:
  1. **Persist everything, reconstruct nothing** — the snapshot is a consistent cut across all systems. No `deserialize()` calls another system's methods to rebuild side-effects. Each system restores independently and the result is consistent because it was consistent when saved.
  2. **Auto-persisted stores** — `ComponentStore<T>` wraps `Map<number, T>` and auto-implements `Persistable`. This is the only way to hold per-entity mutable state. You literally cannot have unpersisted state.
  3. **Feature contract enforces persistence declaration** — compiler error if you forget.
  4. **Transport, reservations, request status all persist** — no special "skip transport" logic, no "re-derive requests from inventory scans" recovery path.
  5. **No event-driven reconstruction on restore** — features don't react to `entity:created` during restore. They restore their own component maps directly from the snapshot.
- **Assumptions**: localStorage remains the storage backend. Snapshot versioning stays simple (bump + discard on mismatch).
- **Scope**: Architecture redesign doc. Does NOT cover migration path or backward compatibility with existing saves.

## Core Principle: Persist Everything, Reconstruct Nothing

### Why reconstruction is the wrong model

The current system has several "reconstruct on load" patterns:

| State | Current approach | Problem |
|-------|-----------------|---------|
| Transport jobs | Skipped — carriers go idle, dispatcher re-matches | Loses in-flight work, needs recovery path in dispatcher |
| Inventory reservations | Not persisted — would need reconstruction if transport were persisted | Entangles transport persistence with reservation system |
| Resource requests (InProgress) | Persisted, but reset to Pending on load | Recovery path: re-scan inventories, re-match |
| In-flight tracking | Not persisted — derived from active transport | Another system that needs reconstruction |
| Feature init on entity restore | `addEntity` emits `entity:created`, features create default state, then `deserializeAll()` overwrites it | Wasted work; features must handle both "fresh init" and "overwrite from snapshot" paths |

Each "reconstruct" decision creates coupling: system A's `deserialize()` must call system B's methods to rebuild derived state. This is fragile — add a new side-effect to `activate()` and you must also update the reconstruction path.

### The clean alternative

Every tick, the game world is in a consistent state. All these things are true simultaneously:
- Carrier X is assigned to transport job 42
- Transport job 42 has phase=Reserved
- Request 17 has status=InProgress, assignedCarrier=X
- Inventory reservation exists at building 5: LOGs, amount 1, requestId=17
- In-flight tracker shows 0 LOGs heading to building 8 (not picked up yet)

**If you snapshot all five facts and restore all five, consistency is free.** No reconstruction needed. Each system serializes its own state, each deserializes its own state, done.

The only time reconstruction is needed is when you *don't* persist something — then another system must re-derive it. Every "don't persist X" decision creates a reconstruction obligation somewhere else.

### The principle applied

| System | What it persists | Store type |
|--------|-----------------|------------|
| Entity table | All entities: id, type, subType, x, y, player, race | SingletonStore (array) |
| Terrain | Ground type/height diffs vs baseline | SingletonStore (sparse diff) |
| SettlerTaskSystem | UnitRuntime per unit — includes carrying, hidden, choreo job, home assignment | ComponentStore (keyed by unit entityId) |
| LogisticsDispatcher | Active transport jobs | ComponentStore (keyed by carrier entityId) |
| InventoryReservationManager | Reservation records | ComponentStore (keyed by source building entityId, nested by material/request) |
| RequestManager | All requests with current status (Pending, InProgress) | SingletonStore (array) |
| InFlightTracker | In-flight material counts | SingletonStore (array of {buildingId, material, amount}) |
| BuildingInventoryManager | Input/output slot states (current amounts, max) | ComponentStore (keyed by building entityId) |
| Every other feature | Its own state | ComponentStore or SingletonStore |

No system's `deserialize()` calls another system. Each restores its own state. The snapshot is a consistent cut.

**Note on reserved amounts in inventory slots:** Currently `BuildingInventoryManager` tracks a `reserved` count per slot, which is the sum of reservations from `InventoryReservationManager`. Under "persist everything," both systems persist their own state — the slot's `reserved` count and the individual reservation records. These must be consistent at save time (they always are, since they're updated atomically). On restore, both are restored independently — no need to re-derive one from the other.

## Analysis: Common Denominators

### The four persistence layers

| Layer | What | How it changes | Persistence strategy |
|-------|------|---------------|---------------------|
| 1. Map baseline | Terrain arrays, initial entity placement | Never (read from .map file) | Don't persist — reload from file |
| 2. Terrain diffs | Ground type/height changes vs baseline | Rarely (construction leveling) | Sparse diff vs cached baseline |
| 3. Entity table | All entities: position, type, player, subType, race | Frequently (spawn, move, die) | Full entity list snapshot |
| 4. Component state | Per-entity or per-system state owned by features | Frequently | Feature-specific stores |

Layers 1-3 are *structural* (what exists and where). Layer 4 is *behavioral* (what state each thing has).

**Where does `carrying`/`hidden` live?** Currently on the Entity row (layer 3). But these are transient job state — a carrier only carries something *because* a choreo job told it to. Under the new model, `carrying` and `hidden` move to layer 4 as part of `SettlerTaskSystem`'s per-unit state. Entity rows become purely structural: `{ id, type, subType, x, y, player, race }`.

### Two shapes of persistent state

Every piece of persistent state is either:
- **Entity-keyed** — a `Map<entityId, ComponentData>`. The key is always an entity ID, but the "owning" entity varies: unit runtimes are keyed by the unit, transport jobs are keyed by the carrier, inventories are keyed by the building.
- **Singleton** — one value for the whole system (RNG seed, terrain diffs, resource signs elapsed timer, request list, in-flight counts).

This suggests the simplest conceptual model:

```
Snapshot = {
  version, timestamp, mapId,
  [persistKey: string]: unknown    // each store owns its format
}
```

No typed fields. Each store serializes whatever shape it needs.

### Unit + transport persistence specifically

A carrier mid-transport has state spread across multiple systems:

```
SettlerTaskSystem:          UnitRuntime { state: WORKING, job: ChoreoJobState { nodeIndex: 2, transportData: {...} } }
LogisticsDispatcher:        activeJobs.get(carrierId) → TransportJobRecord { phase: PickedUp, requestId: 17 }
RequestManager:             request #17 { status: InProgress, assignedCarrier: carrierId }
InventoryReservationManager: (reservation consumed at pickup — no entry for this request, since phase is PickedUp)
InFlightTracker:            building 8 has 1 LOG in flight
Entity:                     { x: 50, y: 30 }  (position only — carrying state is in UnitRuntime)
```

**Each system persists its own slice. On restore, each deserializes independently. The result is consistent because it was consistent when saved.**

No system needs to know about the others during deserialization. The choreo job resumes at node 2. The dispatcher knows the carrier has an active job. The request stays InProgress. The in-flight tracker has the right count.

### The "forgot to persist" problem

Current failure modes:
1. Feature implements `Persistable` but forgets `register()` call → **silent data loss**
2. Feature adds new state to an existing `serialize()` but old snapshots don't have it → **needs default handling**
3. New feature doesn't implement `Persistable` at all → **silent data loss**

The "persist everything" principle makes (3) worse if we don't also solve the structural problem. Solution:

| Approach | Effort | Forgetting risk |
|----------|--------|----------------|
| **A. Self-registering** — `Persistable` constructor auto-registers with a global/injected registry | Low | Eliminates (1) |
| **B. Feature-declared** — Feature module exports `persistence: Persistable[]`, framework auto-registers | Medium | Eliminates (1) |
| **C. Compile-time check** — Features must declare `persistence: Persistable[] | 'none'`, type error if missing | Medium | Eliminates (1) and (3) |
| **D. Component stores** — All mutable state lives in `ComponentStore<T>` which is auto-persisted | High | Eliminates all |

**Recommended: C+D hybrid.** The feature contract requires a `persistence` field (compiler catches omissions). All per-entity state lives in `ComponentStore<T>` (auto-persists, impossible to hold unpersisted state).

## Recommended Architecture

### ComponentStore and SingletonStore: the only ways to hold mutable state

```typescript
/** Every feature MUST declare its persistence — compiler enforces this */
interface FeatureModule {
  name: string;
  persistence: PersistableStore[] | 'none';  // can't forget — it's required
  // ...other feature contract fields
}

/**
 * ComponentStore wraps Map<number, T> and auto-implements Persistable.
 * This is the ONLY way to hold per-entity mutable state.
 * The key is always an entity ID, but which entity depends on the domain
 * (e.g., unit entityId for runtimes, carrier entityId for transport jobs,
 * building entityId for inventories).
 */
class ComponentStore<T> implements Persistable<Record<number, T>> {
  readonly persistKey: string;
  private data = new Map<number, T>();

  constructor(key: string, private serializer?: {
    serialize: (v: T) => unknown;
    deserialize: (v: unknown) => T;
  }) {
    this.persistKey = key;
  }

  get(entityId: number): T | undefined { return this.data.get(entityId); }
  set(entityId: number, value: T): void { this.data.set(entityId, value); }
  delete(entityId: number): void { this.data.delete(entityId); }

  serialize(): Record<number, unknown> {
    const result: Record<number, unknown> = {};
    for (const [id, v] of this.data) {
      result[id] = this.serializer ? this.serializer.serialize(v) : v;
    }
    return result;
  }

  deserialize(data: Record<number, unknown>): void {
    this.data.clear();
    for (const [id, v] of Object.entries(data)) {
      this.data.set(Number(id), this.serializer ? this.serializer.deserialize(v) : v as T);
    }
  }
}

/**
 * SingletonStore wraps a single value. For system-wide state that isn't entity-keyed
 * (e.g., RNG seed, request list, in-flight counts).
 */
class SingletonStore<T> implements Persistable<T> {
  readonly persistKey: string;
  private value: T;

  constructor(key: string, defaultValue: T, private serializer?: {
    serialize: (v: T) => unknown;
    deserialize: (v: unknown) => T;
  }) {
    this.persistKey = key;
    this.value = defaultValue;
  }

  get(): T { return this.value; }
  set(value: T): void { this.value = value; }

  serialize(): unknown {
    return this.serializer ? this.serializer.serialize(this.value) : this.value;
  }

  deserialize(data: unknown): void {
    this.value = this.serializer ? this.serializer.deserialize(data) : data as T;
  }
}
```

### How each layer persists

```
Layer 1 (map baseline):     Not persisted. Reload from .map file.
Layer 2 (terrain diffs):    SingletonStore('terrainDiffs') — custom serializer with diff encoding
Layer 3 (entity table):     SingletonStore('entities') — array of { id, type, subType, x, y, player, race }
Layer 4 (components):       ComponentStore/SingletonStore per feature — auto-persisted
```

### Snapshot format

```typescript
interface Snapshot {
  version: number;
  timestamp: number;
  mapId: string;
  // All data keyed by persistKey — no typed fields
  [persistKey: string]: unknown;
}
```

No more `GameStateSnapshot` with 30 typed fields. Each store owns its own serialization format.

### Registration flow

```typescript
// In feature-registry or game-services:
for (const feature of features) {
  if (feature.persistence !== 'none') {
    for (const store of feature.persistence) {
      persistenceRegistry.register(store);
    }
  }
}
```

One loop. No manual calls to forget.

### Entity restore without event-driven reconstruction

Currently: `restoreFromSnapshot()` calls `addEntity()` per entity, which emits `entity:created`, which triggers feature init (e.g., TreeSystem creates default tree state). Then `deserializeAll()` overwrites that default state.

Proposed: Restore entities into the entity table directly (no events). Then each feature's `ComponentStore.deserialize()` populates its own state from the snapshot. Features that need to do post-restore setup (e.g., rebuilding spatial indices) do so in a dedicated `onRestoreComplete()` hook, not by reacting to entity creation events.

This eliminates the reconstruct-then-overwrite pattern and makes the restore path simpler: populate entity table, then populate all component stores, then signal "restore complete" once.

### Transport + logistics under this model

```typescript
// logistics feature
const activeTransportJobs = new ComponentStore<TransportJobRecord>('transportJobs');
// keyed by carrier entityId — same as the current activeJobs Map

const reservations = new ComponentStore<Map<EMaterialType, Map<number, InventoryReservation>>>(
  'inventoryReservations'
);
// keyed by source building entityId — preserves the current nested structure

const inFlightCounts = new SingletonStore<InFlightEntry[]>('inFlightTracking', []);

const requests = new SingletonStore<ResourceRequest[]>('requests', []);
// persisted with actual status (InProgress stays InProgress)

// settler-tasks feature
const unitRuntimes = new ComponentStore<UnitRuntime>('unitRuntimes', {
  serialize: serializeRuntime,       // NOW includes transportData + carrying + hidden
  deserialize: deserializeRuntime,
});
```

On save: each store serializes its state. On load: each store deserializes its state. No store calls another store. Transport jobs resume exactly where they were — carrier continues walking to destination, reservation is already in place, request is already InProgress, in-flight count is already correct.

## Comparison: Current vs Proposed

| Concern | Current | Proposed |
|---------|---------|----------|
| Entity core state | Hardcoded in `createSnapshot()` | `SingletonStore('entities')` — structural only (no carrying/hidden) |
| carrying / hidden | On Entity row (layer 3) | In SettlerTaskSystem's ComponentStore (layer 4) — behavioral state |
| Terrain diffs | Hardcoded with special encoding | `SingletonStore('terrain')` with custom serializer |
| Feature state (18 systems) | Each implements `Persistable` manually | `ComponentStore`/`SingletonStore` — auto-persists |
| Transport jobs | Skipped — carriers reset to idle | Persisted — carriers resume mid-delivery |
| Inventory reservations | Not persisted | `ComponentStore` keyed by building — restores directly |
| Request status (InProgress) | Reset to Pending on load | Stays InProgress — no re-matching needed |
| In-flight tracking | Not persisted — lost on load | `SingletonStore` — accurate counts on resume |
| Entity restore | `addEntity` + events → feature init → overwrite from snapshot | Populate entity table directly, then restore component stores |
| Registration | Manual `register()` in game-services | Feature contract requires `persistence` field |
| Snapshot type | Monolithic `GameStateSnapshot` with typed fields | `Record<string, unknown>` — each store owns its format |
| "Forgot to persist" risk | High (silent) | Low (compiler error for missing `persistence` field) |
| Boilerplate per feature | ~30 lines (persistKey + serialize + deserialize) | ~5 lines (create ComponentStore with optional serializer) |
| Recovery paths on load | Multiple (re-match carriers, re-derive requests, rebuild reservations) | None — snapshot is a consistent cut |

## What NOT to change

- **Topological sort** — still needed for dependency ordering (e.g., entity table before component stores)
- **Auto-save interval** — 5s is fine
- **localStorage backend** — works for now

## Verification

1. Save game with 50+ entities across all types (units, buildings, trees, piles) → reload → all state matches
2. Save while carriers are mid-transport → reload → carriers resume delivery, no material duplication or loss
3. Save with inventory reservations active → reload → reservation counts match, no double-dispatch
4. Add a new feature with `ComponentStore` → it auto-persists without touching game-services
5. Feature with `persistence: 'none'` compiles fine; feature missing `persistence` field → type error
6. Terrain diffs still sparse-encode correctly with the new singleton approach
7. No `entity:created` events fire during restore — features populate purely from snapshot data

## Integration Tests for Persistence

There are currently **zero save/load tests**. The existing persistence-registry unit test only covers the registry mechanics (topological sort, duplicate detection). No test ever creates a snapshot from a running simulation and restores it.

This section defines a comprehensive integration test suite. Tests use the existing `Simulation` harness (`test-simulation.ts`) which provides `state`, `services`, `eventBus`, `map`, inventory queries, entity counting, `runUntil()`, `runTicks()`, and `placeBuilding()`.

### Test infrastructure: `saveAndRestore(sim)` helper

The core primitive — snapshot a running simulation and restore into a fresh one:

```typescript
function saveAndRestore(sim: Simulation): Simulation {
  const snapshot = createSnapshot(sim);   // serialize everything
  const sim2 = createSimulation({ ... }); // fresh sim, same map dimensions
  restoreFromSnapshot(sim2, snapshot);    // restore into clean sim
  return sim2;
}
```

Every persistence test follows the same pattern:
1. Set up a scenario (buildings, units, resources, in-progress activity)
2. Run simulation to a specific mid-point
3. `saveAndRestore()`
4. Assert the restored sim matches the original
5. Optionally: continue running the restored sim and verify it completes correctly

### Test file: `tests/unit/integration/persistence/save-load.spec.ts`

#### Category 1: Basic round-trip (structural integrity)

| Test | Setup | Save point | Assertion |
|------|-------|-----------|-----------|
| **Entity round-trip** | Place residence, woodcutter hut, storage area, spawn some trees/stones | After placement | Entity count, positions, types, subtypes all match |
| **Empty world** | Fresh sim, no entities | Immediately | Restores cleanly, no errors |
| **Terrain diffs** | Place building (construction levels terrain) | After leveling | Ground type/height arrays match at every modified tile |
| **RNG state** | Run 100 ticks | Mid-simulation | `state.rng.getState()` matches; next 100 ticks produce identical results |

#### Category 2: Economy mid-flight

| Test | Setup | Save point | Assertion |
|------|-------|-----------|-----------|
| **Worker mid-choreo** | Woodcutter hut + trees | While woodcutter is walking to tree (nodeIndex > 0) | Worker resumes choreo, eventually produces LOG |
| **Carrier mid-transport** | Woodcutter + sawmill + trees, wait for LOG output | While carrier is walking to sawmill with LOG | Carrier still carrying LOG after restore; eventually delivers; BOARD appears in sawmill output |
| **Inventory reservation consistency** | Multiple buildings requesting same material | While carrier is en route (reservation exists) | Reservation count in source building matches; no double-pickup after restore |
| **Request status InProgress** | Active transport with InProgress request | Mid-transport | Request stays InProgress; no duplicate request created; carrier delivers normally |
| **Production mid-cycle** | Sawmill with LOG injected | While worker is mid-work animation | Worker finishes cycle, BOARD appears in output |

#### Category 3: Construction

| Test | Setup | Save point | Assertion |
|------|-------|-----------|-----------|
| **Construction site mid-build** | WoodcutterHut as construction site + materials + builders | During ConstructionRising (progress > 0, < 1) | Phase, progress, consumed materials match; builders resume; building completes |
| **Construction with pending material delivery** | Construction site + storage with materials | While carrier is delivering BOARD to site | Carrier delivers; construction proceeds; building completes |

#### Category 4: Military / barracks

| Test | Setup | Save point | Assertion |
|------|-------|-----------|-----------|
| **Barracks training mid-progress** | Barracks with queued training + carrier inside | During active training | Training completes after restore; correct soldier type spawns |
| **Combat unit health** | Two opposing military units | After combat starts (health < max) | Health values match; combat continues after restore |

#### Category 5: Nature / growth

| Test | Setup | Save point | Assertion |
|------|-------|-----------|-----------|
| **Tree growth stages** | Planted saplings at various stages | Mid-growth | Each tree's stage, progress, variant match; trees continue growing and eventually mature |
| **Crop lifecycle** | GrainFarm with crops at mixed stages | Some planted, some mature | Stages match; farmer harvests mature crops after restore |
| **Stone depletion** | Stonecutter mid-mining | Stone partially depleted | Depletion level matches; stonecutter finishes mining |

#### Category 6: Edge cases and invariants

| Test | Setup | Save point | Assertion |
|------|-------|-----------|-----------|
| **Material conservation** | Full production chain running | After several production cycles | Total material count (in inventories + carried + on ground) is identical before/after restore |
| **No duplicate entities** | Complex scenario with many entity types | Mid-simulation | `state.entities.length` matches; no entity ID collisions |
| **Idempotent save** | Any scenario | Save → restore → save again | Second snapshot is byte-identical to first (serialize is deterministic) |
| **Continue after restore** | Woodcutter + trees, save after 1 LOG produced | After restore | Run to completion — all remaining trees are cut, correct LOG count |
| **Double restore** | Any scenario | Save → restore → restore same snapshot again | Second restore produces identical state (restore is idempotent on fresh sim) |
| **In-flight tracking accuracy** | Multiple concurrent transports | Mid-delivery | `inFlightTracker` counts match; no material appears to teleport or vanish |

#### Category 7: Regression guards

These catch the specific bugs that "persist everything" prevents:

| Test | What it guards against |
|------|----------------------|
| **Carrier doesn't go idle on restore** | The old behavior — carrier with `transportData` was reset to IDLE |
| **Request stays InProgress** | The old behavior — InProgress requests were reset to Pending, causing double-dispatch |
| **Reservation survives restore** | The old behavior — reservations were lost, causing double-pickup |
| **Worker doesn't restart choreo from node 0** | Choreo job should resume at saved `nodeIndex`, not restart |
| **Transport job ID counter doesn't reset** | `nextJobId` must be restored; otherwise new jobs collide with restored ones |

### Test helper: deep state comparison

For thorough assertions, a `compareSimStates(sim1, sim2)` helper that checks:

```typescript
function compareSimStates(original: Simulation, restored: Simulation): void {
  // Entity table
  expect(restored.state.entities.length).toBe(original.state.entities.length);
  for (const entity of original.state.entities) {
    const r = restored.state.getEntity(entity.id);
    expect(r).toBeDefined();
    expect(r!.type).toBe(entity.type);
    expect(r!.subType).toBe(entity.subType);
    expect(r!.x).toBe(entity.x);
    expect(r!.y).toBe(entity.y);
    expect(r!.player).toBe(entity.player);
  }

  // Per-feature: inventories
  for (const building of original.state.entities.filter(e => e.type === EntityType.Building)) {
    const origInv = original.services.inventoryManager.getInventory(building.id);
    const restInv = restored.services.inventoryManager.getInventory(building.id);
    if (origInv) {
      for (const slot of origInv.inputSlots) {
        const rSlot = restInv!.inputSlots.find(s => s.materialType === slot.materialType)!;
        expect(rSlot.currentAmount).toBe(slot.currentAmount);
        expect(rSlot.reservedAmount).toBe(slot.reservedAmount);
      }
    }
  }

  // Per-feature: unit runtimes (state, nodeIndex, carrying)
  // Per-feature: transport jobs (activeJobs map)
  // Per-feature: requests (status, assignedCarrier)
  // Per-feature: tree/stone/crop stages
  // ... extend as features are migrated
}
```

### Running the tests

```sh
pnpm test:unit tests/unit/integration/persistence/save-load.spec.ts
```

These tests require real game data (XML files). Use `installRealGameData()` + `describe.skipIf(!hasRealData)` — same pattern as existing integration tests.
