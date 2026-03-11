# Deterministic Replay Persistence — Design

## Overview

Replace the fragile snapshot-based persistence with a **deterministic replay** system. Instead of serializing every piece of feature state (which breaks whenever a feature changes its internal shape), persist a **command journal** alongside periodic **keyframe snapshots**. To restore, load the nearest keyframe and replay commands + ticks forward. This eliminates the serialization surface area that causes constant breakage.

## Current State

- **What exists**: `GameStateSnapshot` captures entity table + terrain + 23 feature stores via `PersistenceRegistry`. Each feature implements `Persistable` with custom `serialize()`/`deserialize()` methods. Stored as JSON in localStorage.
- **What keeps breaking**: Every feature that adds/changes internal state must update its serializer. Missing a field → silent data loss on restore. Changing a field type → old snapshots break (no migration, just a global `SNAPSHOT_VERSION` bump that invalidates ALL saves). Two-phase restore (create entities → overwrite defaults) is fragile — event handlers see partially-initialized state.
- **What makes replay viable**: Commands are already deterministic (seeded RNG, fixed-point math, deterministic iteration order). Tick systems mutate state directly but deterministically — same inputs always produce same outputs.
- **What stays**: Entity table in keyframe snapshots, terrain snapshots, `PersistentMap`/`PersistentValue` for the 17 stores that hold primary state.
- **What changes**: Primary persistence path becomes command journal + tick replay. Snapshots become optimization (keyframes), not the source of truth. 6 derived/transient stores are deleted entirely — their state is rebuilt on load.
- **What gets deleted**: 6 custom `Persistable` implementations (carriers, residenceSpawns, resourceSigns, combat, transportNextJobId, inFlightTracking). The remaining 17 move to generic `PersistentMap`/`PersistentValue` auto-serialization — no custom serialize/deserialize methods.

### State Mutation Audit — Why Replay Works

Not all state changes go through commands. Tick systems and event handlers mutate state directly. This is fine for replay because **all mutations are deterministic consequences of commands + ticks**:

| Mutation Site | What It Mutates | Triggered By | Deterministic? |
|---|---|---|---|
| **Tick systems** (movement, growth, combat, logistics) | Entity position, health, growth progress, occupancy maps | `GameCore.tick()` | Yes — seeded RNG, fixed-point math, sorted iteration |
| **Event handlers** (settler-location, garrison, construction, inventory) | `entity.hidden`, garrison slots, construction phase, terrain height, inventory phase swap | Events emitted synchronously within `tick()` or `execute()` | Yes — events fire in same order given same state |
| **UnitTransformer** event handler | `entity.subType` (carrier → specialist) | `recruitment:completed` event from tick system | Yes — tick-driven |
| **FreePileHandler** event handler | `entity.player` (pile ownership) | `pile:freePilePlaced` from command | Yes — territory state is deterministic |
| **ConstructionSystem** event handler | `site.phase`, terrain arrays | `construction:*` events from tick system | Yes — tick-driven |

**Key invariant**: No game-state mutations use `setTimeout`, `Math.random()`, `Date.now()`, or any async/non-deterministic source. The only `Math.random()` in the codebase is in the music controller (non-simulation). All timers (`setInterval`) are in non-simulation code (auto-save, debug stats, audio).

**Conclusion**: Replaying the same commands at the same tick numbers on the same initial state produces identical event sequences and therefore identical state. No refactoring of event handlers is needed.

### Persistence Surface Reduction — From 23 Custom Serializers to 0

The current codebase has **23 `Persistable` implementations**, each with hand-written `serialize()`/`deserialize()` methods. This is the root cause of constant breakage. With replay, most of this state **doesn't need to be in keyframes at all** — it rebuilds during the 300-tick replay window.

#### Key insight: replay as state recovery

A keyframe only needs state that takes **longer than 300 ticks to rebuild**. Anything that rebuilds within the replay window can be dropped from keyframes entirely — settlers re-acquire tasks, logistics re-dispatches, combat re-scans. The 300-tick replay does the work that custom deserializers used to do, but correctly and without maintenance.

#### Categorization: what keyframes actually need

**KEEP in keyframes (9 stores)** — slow-accumulating state, all with auto-serialization:

| persistKey | Why needed | Serialization |
|---|---|---|
| `buildingInventories` | Accumulated over thousands of ticks | `PersistentMap<InventoryState>` (auto) |
| `constructionSites` | Construction progress (hundreds of ticks) | `PersistentMap<ConstructionSiteState>` (auto) |
| `trees` | Growth timers (thousands of ticks) | `PersistentMap<TreeState>` (auto) |
| `stones` | Depletion level (thousands of ticks) | `PersistentMap<StoneState>` (auto) |
| `crops` | Growth + decay timers (thousands of ticks) | `PersistentMap<CropState>` (auto) |
| `storageFilters` | User configuration (command-driven) | `PersistentMap<FilterConfig>` (auto) |
| `productionControl` | User configuration (command-driven) | `PersistentMap<ProductionConfig>` (auto) |
| `workAreaOffsets` | User configuration (command-driven) | `PersistentMap<WorkAreaOffset>` (auto) |
| `transportJobs` | Transport SSoT — active delivery jobs (see `building-owned-deliveries.md`) | `PersistentIndexedMap<TransportJobRecord>` (auto) |

All 9 use generic `PersistentMap`/`PersistentIndexedMap` auto-serialization. Zero custom serializers.

**DROP from keyframes (14 stores)** — state that rebuilds within 300 ticks of replay:

| persistKey | Recovery time | What happens on load |
|---|---|---|
| `settlerTasks` | ~30 ticks | Settlers go idle, re-acquire tasks during replay. Carried goods returned to source via cleanup. **Eliminates the hardest serializer (122 lines, function references).** |
| `transportJobs` | ~5-50 ticks | Logistics dispatcher re-matches requests to carriers during replay |
| `requests` | ~5-50 ticks | Material request system re-evaluates building needs during replay |
| `inventoryReservations` | Instant | Rebuilt when requests are re-created |
| `inFlightTracking` | Instant | Rebuilt when transport jobs are re-created |
| `transportNextJobId` | Instant | Derived from job counter |
| `carriers` | Instant | Scan entities for `UnitType.Carrier` |
| `combat` | 1 tick | Proximity scan finds targets immediately |
| `settler-building-locations` | ~10-30 ticks | Settlers re-enter buildings during replay; `entity.hidden` set by event handlers |
| `towerGarrison` | ~30-60 ticks | Units re-garrison via auto-garrison system during replay |
| `barracksTraining` | ~30 ticks | Training restarts; short-lived state |
| `unitTransformer` | ~10-30 ticks | Pending transforms re-initiate during replay |
| `residenceSpawns` | N/A | Transient; users re-queue |
| `resourceSigns` | N/A | Ephemeral; clear on load |
| `resourceQuantities` | ~10 ticks | Pile quantities rebuilt from inventory + entity state during replay |

#### Preserving transport state without task serialization

**Prerequisite**: `docs/designs/building-owned-deliveries.md` — consolidates 5 scattered logistics stores into `TransportJobStore` (single source of truth, wraps `PersistentIndexedMap<TransportJobRecord>`). `DemandQueue` replaces `RequestManager` as a transient, non-persisted demand queue. `entity.carrying` stays as physical material location + animation.

`TransportJobStore` is the transport continuity mechanism for keyframes:

- **`TransportJobStore` in keyframes** — already `PersistentIndexedMap` (auto-serializable, zero custom code). Each record has `carrierId`, `destBuilding`, `sourceBuilding`, `material`, `amount`, `phase`.
- **`entity.carrying` stays in entity table** — physical material on the carrier, already persisted.
- **`DemandQueue` not persisted** — demand scanners recompute from inventory + job store on first tick of replay.
- **On restore + replay**: job store restored → task system sees carriers with active jobs → creates delivery tasks → carriers resume transport. Demands recomputed within ~5 ticks, logistics dispatcher re-matches within ~50 ticks. Economy fully recovers.
- **Building destruction during replay**: job store's `byBuilding` index finds all affected jobs → cancel → carriers drop goods via `MaterialTransfer.drop()`. Existing behavior, no special handling.

#### Result

| Metric | Before | After |
|---|---|---|
| Custom `serialize()`/`deserialize()` methods | 23 | **0** |
| Stores in keyframes | 23 | **9** (all auto-serialized) |
| Lines of serialization code | ~800+ | **~0** (PersistentMap handles it) |
| Keyframe size | Large (all feature state) | **~40% smaller** |
| Risk of breakage on feature change | High | **Near zero** — journal replays through game logic |

**Fallback safety**: If a keyframe's auto-serialized data is incompatible (schema change), the replay engine falls back to the previous keyframe + longer replay. If ALL keyframes are stale, replay from tick 0. Schema changes **never invalidate saves**.

## Summary for Review

- **Interpretation**: The current approach of serializing every feature's internal state is fundamentally fragile — it creates an ever-growing serialization surface that breaks on any internal change. The solution is to shift to a replay-based model where the command stream IS the save file, with periodic snapshots as an acceleration structure.
- **Key decisions**:
  - Commands + tick count are the canonical save format, not state snapshots
  - Keyframe snapshots taken every N ticks (~300, ~10 seconds) as replay acceleration
  - Command journal stored in IndexedDB (not localStorage — no 5MB limit)
  - 14 of 23 Persistable stores dropped from keyframes (rebuilt during 300-tick replay)
  - Remaining 9 use generic PersistentMap auto-serialization — zero custom serialize/deserialize methods
  - Transport continuity via `TransportJobStore` (`PersistentIndexedMap`, per `building-owned-deliveries.md`)
  - Selection commands excluded from journal (UI-only, not game state)
  - Stale keyframes degrade gracefully (longer replay) rather than breaking saves
- **Assumptions**:
  - Tick systems are fully deterministic given same initial state + same commands at same ticks (seeded RNG, no `Math.random()`, no float arithmetic, deterministic iteration order)
  - External inputs during a tick are limited to commands (no time-of-day, no network, no async)
  - The existing command system already captures all player/script actions
- **Scope**: Core replay infrastructure + IndexedDB storage + save/load integration. Deferred: undo/redo, multiplayer sync, replay viewer UI.

### Replay Performance Estimate

Tick rate is **30 tps** (`game-loop.ts`). Headless tick speed from test evidence: **~0.4–2.5ms per tick** (integration tests run 90K–150K ticks in 10–60s wall clock). ~23 tick systems run per tick, with `SettlerTaskSystem` iterating all units and `LogisticsDispatcher` throttling to 5 assignments/tick.

| Scenario | Ticks to Replay | Estimated Time |
|---|---|---|
| Normal load (from keyframe, 300-tick gap) | 300 | **~150–750ms** |
| Missed keyframe (600-tick gap) | 600 | **~300ms–1.5s** |
| Full 1-hour game (no keyframes) | 108,000 | **~45–270s** ← unacceptable |

**Conclusion**: With keyframes every 300 ticks, replay takes **under 1 second** — no tick optimization needed. The keyframe interval is the only tuning knob; 300 ticks gives a good balance between save size and replay speed. No changes to tick systems required.

## Conventions

- Optimistic programming — no `?.` on required deps, throw with context, no silent fallbacks
- Feature modules: `index.ts` (public API) + `*-system.ts` + `*-manager.ts` + `internal/`
- Events: `"domain:past-tense"` naming
- Max 250 lines/function, 600 lines/file, complexity ≤15
- All mutations through commands for player actions; tick systems mutate directly but deterministically
- No `Math.random()` — seeded RNG only
- Collections iterated in deterministic order (sort by ID)

## Architecture

### Subsystems

| # | Subsystem | Responsibility | Depends On | Files |
|---|-----------|---------------|------------|-------|
| 1 | Command Journal | Record commands with tick numbers, serialize/deserialize journal entries | — | `src/game/persistence/command-journal.ts` |
| 2 | Keyframe Manager | Take periodic state snapshots, prune old keyframes | 1 | `src/game/persistence/keyframe-manager.ts` |
| 3 | Replay Engine | Replay commands + ticks from a keyframe to reconstruct state | 1, 2 | `src/game/persistence/replay-engine.ts` |
| 4 | IndexedDB Store | Persist journal + keyframes to IndexedDB with session management | — | `src/game/persistence/indexed-db-store.ts` |
| 5 | Save/Load Integration | Wire replay persistence into GameCore lifecycle, replace auto-save | 1, 2, 3, 4 | `src/game/state/game-state-persistence.ts` (modify) |
| 6 | Determinism Validator | Debug tool: replay from keyframe and compare state hash | 3 | `src/game/debug/determinism-validator.ts` |
| 7 | Persistable Migration | Delete 6 derived stores, convert 17 custom Persistables to PersistentMap/Value | — | Multiple feature files (see details) |

## Shared Contracts

```typescript
// ─── Command Journal ────────────────────────────────────────

/** A command annotated with the tick it was executed on */
interface JournalEntry {
  /** Simulation tick when this command was executed */
  tick: number;
  /** The command payload (already JSON-serializable) */
  command: Command;
}

/** Serialized journal — the canonical save format */
interface CommandJournal {
  /** Map identifier */
  mapId: string;
  /** Game settings that affect simulation (e.g. pathStraightness) */
  settings: SimulationSettings;
  /** Initial RNG seed */
  initialSeed: number;
  /** Ordered command entries */
  entries: JournalEntry[];
}

// ─── Keyframes ──────────────────────────────────────────────

/** A snapshot annotated with its tick number */
interface Keyframe {
  /** Tick number this keyframe represents */
  tick: number;
  /** Full state snapshot (existing GameStateSnapshot format) */
  snapshot: GameStateSnapshot;
  /** Number of journal entries consumed up to this keyframe */
  journalIndex: number;
}

// ─── IndexedDB Schema ──────────────────────────────────────

/** One save session in IndexedDB */
interface SaveSession {
  id: string; // crypto.randomUUID()
  mapId: string;
  createdAt: number;
  updatedAt: number;
  /** Current tick count */
  currentTick: number;
}

// ─── Simulation Settings (determinism-affecting) ───────────

/** Settings that affect simulation outcome — must match for replay */
interface SimulationSettings {
  pathStraightness: number;
  treeExpansion: boolean;
}

// ─── Replay Engine ─────────────────────────────────────────

interface ReplayResult {
  /** Final tick reached */
  tick: number;
  /** Number of commands replayed */
  commandsReplayed: number;
}

// ─── Determinism Validator ─────────────────────────────────

/** Hash of game state for determinism comparison */
interface StateHash {
  tick: number;
  entityCount: number;
  /** CRC32 of sorted entity (id, x, y, subType, player) tuples */
  entityHash: number;
  /** RNG state */
  rngState: number;
}
```

## Subsystem Details

### 1. Command Journal
**Files**: `src/game/persistence/command-journal.ts`
**Key decisions**:
- Journal entries are appended in `GameCore.execute()` — wrap the existing `commandRegistry.execute()` call
- Selection commands (`select`, `select_at_tile`, `toggle_selection`, `select_area`, `select_multiple`, `select_same_unit_type`) are excluded — they don't affect simulation state
- Journal tracks the current tick number via a counter incremented in `GameCore.tick()`
- Journal is append-only during gameplay; truncated when loading from a keyframe

### 2. Keyframe Manager
**Files**: `src/game/persistence/keyframe-manager.ts`
**Key decisions**:
- Keyframes taken every 300 ticks (~10 seconds game time at 30 tps) using existing `createSnapshot()`
- Keep last 3 keyframes in memory, persist latest to IndexedDB
- On save: store current keyframe + journal entries since that keyframe
- Keyframe creation reuses existing `GameStateSnapshot` — no new serialization code

### 3. Replay Engine
**Files**: `src/game/persistence/replay-engine.ts`
**Key decisions**:
- Replay is synchronous — run tick loop + inject commands at their recorded ticks. No rendering during replay.
- Input: a `GameCore` restored from a keyframe snapshot + journal entries from `journalIndex` onward
- The engine calls `game.tick(1)` for each tick and `game.execute(cmd)` for each command at the matching tick
- ALL event handlers must remain active during replay — they are part of the simulation (settler location, garrison, construction, inventory). Event handlers mutate state deterministically as a consequence of ticks and commands.
- Only disable: rendering, sound, timeline recording, UI updates. These are browser-only concerns not present in headless `GameCore`.
- Since `GameCore` is already headless (no browser deps), replay on a fresh `GameCore` instance naturally excludes rendering/sound — no special pausing needed.
- Maximum replay window: ~9,000 ticks (5 minutes at 30 tps). If journal is longer, force a new keyframe.

### 4. IndexedDB Store
**Files**: `src/game/persistence/indexed-db-store.ts`
**Key decisions**:
- Database name: `settlers_saves`, version 1
- Object stores: `sessions` (keyed by id), `keyframes` (keyed by sessionId + tick), `journals` (keyed by sessionId, value is the journal entries array)
- Async API — all reads/writes return Promises
- Fallback: if IndexedDB unavailable (e.g. private browsing in some browsers), fall back to localStorage with size warnings
- Keep max 3 save sessions; oldest auto-deleted

### 5. Save/Load Integration
**Files**: `src/game/state/game-state-persistence.ts` (modify), `src/game/game-core.ts` (modify)
**Key decisions**:
- `GameCore` gains a `currentTick: number` field, incremented in `tick()`
- `GameCore.execute()` delegates to command journal for recording
- Auto-save interval changes from "serialize everything" to "flush journal + maybe take keyframe"
- Load path: find latest session for map → load latest keyframe → replay journal → resume
- Existing `createSnapshot`/`restoreFromSnapshot` stay for keyframe creation/restoration
- `saveInitialState()` creates tick-0 keyframe + empty journal
- Migration: if old-format snapshot found in localStorage, load it as a tick-0 keyframe and start journaling from there

### 6. Determinism Validator
**Files**: `src/game/debug/determinism-validator.ts`
**Key decisions**:
- Runs in dev/test only — not shipped to production builds
- Takes a keyframe + journal, replays to current tick, compares `StateHash` against live game
- Hash covers: entity count + positions + types + RNG state
- Triggered manually via debug panel or automatically in integration tests
- Logs divergence details (first entity mismatch) for debugging

### 7. Persistable Migration
**Files**: Multiple feature files (see file map)
**Key decisions**:

**Delete persistence entirely (15 stores)** — remove `Persistable` implementation, `persistKey`, `serialize()`, `deserialize()`, and feature `persistence` registration. All state rebuilds during 300-tick replay:
- `settlerTasks` — the biggest win: eliminates 122-line serializer with function references. Settlers idle at keyframe, re-acquire tasks during replay. Add `onRestoreComplete()` to return carried goods.
- `transportJobs`, `requests`, `inventoryReservations`, `inFlightTracking`, `transportNextJobId` — logistics chain re-evaluates within ~50 ticks of replay
- `carriers` — scan entities for `UnitType.Carrier` in `onRestoreComplete()`
- `combat` — proximity scan on next tick
- `settler-building-locations` — settlers re-enter buildings during replay via event handlers
- `towerGarrison` — auto-garrison system re-fills towers during replay
- `barracksTraining`, `unitTransformer` — short-lived transient state
- `residenceSpawns`, `resourceSigns`, `resourceQuantities` — transient/derived

**Convert to auto-serialization (8 stores)** — replace custom `implements Persistable<T>` with `PersistentMap<T>`:
- `buildingInventories`, `constructionSites`, `trees`, `stones`, `crops` — slow-accumulating state
- `storageFilters`, `productionControl`, `workAreaOffsets` — user configuration
- State types must be JSON-safe — convert any internal `Map<K,V>` to `Record<string,V>`

**Carried-goods cleanup hook** — single `onRestoreComplete()` callback:
- Scan entities with `entity.carrying` set
- Return material to nearest storage or drop as pile at entity position
- Clear `entity.carrying`
- This replaces 122 lines of task serialization with ~15 lines of cleanup

## File Map

### New Files
| File | Subsystem | Purpose |
|------|-----------|---------|
| `src/game/persistence/command-journal.ts` | 1 | Append-only command log with tick annotations |
| `src/game/persistence/keyframe-manager.ts` | 2 | Periodic snapshot management |
| `src/game/persistence/replay-engine.ts` | 3 | Synchronous command + tick replay |
| `src/game/persistence/indexed-db-store.ts` | 4 | IndexedDB persistence layer |
| `src/game/debug/determinism-validator.ts` | 6 | Replay-based state comparison |

### Modified Files
| File | Change |
|------|--------|
| `src/game/game-core.ts` | Add `currentTick` counter, wrap `execute()` for journaling |
| `src/game/state/game-state-persistence.ts` | Replace auto-save with journal flush + keyframe, add migration path, add carried-goods cleanup |
| **Remove persistence (15 files):** | |
| `src/game/features/settler-tasks/settler-task-system.ts` | Remove Persistable + 122-line serializer |
| `src/game/features/logistics/logistics-dispatcher.ts` | Remove PersistentIndexedMap + PersistentValue |
| `src/game/features/logistics/request-manager.ts` | Remove Persistable |
| `src/game/features/logistics/inventory-reservation.ts` | Remove PersistentValue |
| `src/game/features/logistics/in-flight-tracker.ts` | Remove PersistentValue |
| `src/game/systems/carrier-registry.ts` | Remove Persistable, add `rebuildFromEntities()` |
| `src/game/features/combat/combat-system.ts` | Remove Persistable |
| `src/game/features/settler-location/settler-building-location-manager.ts` | Remove Persistable |
| `src/game/features/tower-garrison/tower-garrison-manager.ts` | Remove Persistable |
| `src/game/features/barracks/barracks-training-manager.ts` | Remove Persistable |
| `src/game/systems/recruit/unit-transformer.ts` | Remove Persistable |
| `src/game/features/building-construction/residence-spawner.ts` | Remove Persistable |
| `src/game/features/ore-veins/resource-sign-system.ts` | Remove Persistable |
| `src/game/state/stacked-pile-manager.ts` | Remove Persistable |
| **Convert to auto-serialization (8 files):** | |
| `src/game/systems/inventory/building-inventory.ts` | Replace custom Persistable → `PersistentMap<InventoryState>` |
| `src/game/features/building-construction/construction-site-manager.ts` | Replace custom Persistable → `PersistentMap<ConstructionSiteState>` |
| `src/game/features/trees/tree-system.ts` | Replace custom Persistable → `PersistentMap<TreeState>` |
| `src/game/features/stones/stone-system.ts` | Replace custom Persistable → `PersistentMap<StoneState>` |
| `src/game/features/crops/crop-system.ts` | Replace custom Persistable → `PersistentMap<CropState>` |
| `src/game/systems/inventory/storage-filter-manager.ts` | Replace custom Persistable → `PersistentMap<FilterConfig>` |
| `src/game/features/production-control/production-control-manager.ts` | Replace custom Persistable → `PersistentMap<ProductionConfig>` |
| `src/game/features/work-areas/work-area-store.ts` | Replace custom Persistable → `PersistentMap<WorkAreaOffset>` |

## Verification

1. **Round-trip replay**: Save game at tick 1000 → load → replay from keyframe at tick 900 → compare all entity positions, types, carrying state, building phases with the original game at tick 1000
2. **Keyframe skip**: Save at tick 2000, delete intermediate keyframes, load from tick-0 keyframe → replay 2000 ticks → state matches
3. **Feature change resilience**: Add a new field to a feature's internal state → old saves still load (journal replays produce the new field naturally via game logic)
4. **IndexedDB persistence**: Save → close tab → reopen → load → game continues from where it left off
5. **Determinism validation**: Run validator after every test save/load — replay from keyframe must produce identical `StateHash`
6. **Event-driven state determinism**: Scenario with garrison + construction + unit transformation → save at tick 500 → replay from tick 0 → verify `entity.hidden`, garrison slot contents, `entity.subType`, construction phases all match exactly
7. **Replay guard — no non-determinism in simulation**: Integration test that asserts no `Math.random()`, `Date.now()`, or `setTimeout` calls occur during `tick()` / `execute()` call stacks (instrument via EventBus emit counter or similar)
