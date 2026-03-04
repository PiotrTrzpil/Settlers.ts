# Project Review — 2026-03-03

## Summary

The codebase is well-structured overall, with strong patterns in most feature modules. The primary issues are: (1) **active TypeScript errors** from a `place_resource` → `place_pile` refactor that was left incomplete, (2) **layer boundary violations** where core files (`event-bus.ts`, `entity.ts`, `stacked-pile-manager.ts`) import from `features/`, and (3) **55 `.bak` files** that should be deleted per Rule 9.2. Most violations are minor/fixable without major restructuring.

---

## Fixes Applied

None — all items documented below for review.

---

## Issues Found

### Critical

#### TS Errors — `place_resource` rename left incomplete (Rule 10.x, type safety)

`pnpm lint` reports 5 TypeScript errors from a `place_resource` → `place_pile` rename that wasn't fully propagated:

| File | Line | Error |
|------|------|-------|
| `src/components/use-renderer/placement-state.ts` | 16, 37, 45 | `"resource"` not in `PlacementEntityType` |
| `src/game/commands/command.ts` | 693 | `place_resource` key missing from command handler map |
| `src/game/renderer/render-passes/stack-ghost-pass.ts` | 52 | `"resource"` not assignable to `PlacementEntityType` |
| `tests/e2e/game-actions.ts` | 168 | `"resource"` type mismatch |

These prevent a clean build. The `PlacementEntityType` union is now `'building' | 'pile' | 'unit'` (the old `'resource'` was renamed to `'pile'`), but several call sites weren't updated.

**Fix:** Replace `'resource'` with `'pile'` in the 4 affected files, and remove the stale `place_resource` handler entry in `command.ts:693`.

---

### Recommended Refactors

#### Rule 1.1 / 2.5 — Core files importing from `features/` (layer boundary violation)

Three files at Layer 3 (State) import from Layer 4 (features), reversing the required dependency direction:

- **`src/game/event-bus.ts:15-16`** — imports `TrainingRecipe` from `features/barracks/types` and `ProductionMode` from `features/production-control`. The event bus must not depend on features.
- **`src/game/entity.ts:9,167`** — imports and re-exports `PileKind` from `features/inventory/pile-kind`. Core entity types must not reference feature-specific types.
- **`src/game/stacked-pile-manager.ts:11`** — imports `PileKind`, `getOwnerBuildingId`, `SlotKind` from `features/inventory/pile-kind`.

**Target state:** Move `PileKind`/`SlotKind` to a new `src/game/types/pile-kind.ts` (Layer 0 pure data — it has no game dependencies). Move the `TrainingRecipe` and `ProductionMode` event payload types inline into `event-bus.ts` or into a shared `types/` file that doesn't import features.

**Scope:** Medium — touches 5-8 files, but no logic changes.

#### Rule 4.4 — Config Object Pattern not followed for constructors with 3+ deps

Several systems take positional parameters instead of a `*Config` interface:

| Class | File | # Params |
|-------|------|----------|
| `CombatSystem` | `features/combat/combat-system.ts:57` | 3 |
| `TreeSystem` | `features/trees/tree-system.ts:85` | 3 |
| `CropSystem` | `features/crops/crop-system.ts:101` | 3 |
| `GrowableSystem` | `features/growth/growable-system.ts:69` | 4 |
| `WorkerTaskExecutor` | `features/settler-tasks/worker-task-executor.ts:51` | 7 |
| `UnitStateMachine` | `features/settler-tasks/unit-state-machine.ts:52` | 8 |

`WorkerTaskExecutor` (7 params) and `UnitStateMachine` (8 params) are the most important to fix — both are hard to read at construction sites and error-prone to refactor.

**Scope:** Medium per class; can be done one at a time.

#### Rule 8.2 — Non-deterministic Map iteration in tick() loops

Several TickSystems iterate over `Map` entries without sorting by entity ID, violating deterministic ordering:

- `CombatSystem.tick()` — `for (const state of this.states.values())` — `combat-system.ts:109`
- `GrowableSystem.tick()` — `for (const [entityId, state] of this.states)` — `growable-system.ts:161`
- `BarracksTrainingManager` — `for (const [buildingId, state] of this.activeTrainings)` — `barracks-training-manager.ts:240`
- `LogisticsDispatcher` — `for (const [carrierId, job] of this.activeJobs)` — `logistics-dispatcher.ts:248`
- `ResourceSignSystem.tick()` — `for (const [id, sign] of this.signs)` — `resource-sign-system.ts:90`
- `SettlerTaskSystem` — `for (const [entityId, runtime] of this.runtimes)` — `settler-task-system.ts:505`

Note: `MovementSystem` already sorts correctly (`sortedIds = [...this.controllers.keys()].sort(...)`).

**Scope:** Low per site. Pattern: `[...map.keys()].sort((a,b)=>a-b).forEach(id => ...)`.

#### Rule 10.1 — TickSystems that can throw without catch

Systems that iterate entities per-tick and can throw must wrap per-entity logic in try/catch:

| System | File | Has catch? |
|--------|------|-----------|
| `CombatSystem.tick()` | `features/combat/combat-system.ts:99` | No |
| `GrowableSystem.tick()` | `features/growth/growable-system.ts:158` | No |
| `ResourceSignSystem.tick()` | `features/ore-veins/resource-sign-system.ts:87` | No |
| `MovementSystem.tick()` | `systems/movement/movement-system.ts:196` | No |
| `BuildingOverlayManager.tick()` | `features/building-overlays/building-overlay-manager.ts:169` | No |
| `SettlerTaskSystem.tick()` | `features/settler-tasks/settler-task-system.ts:531` | **Yes** ✓ |

Note: `SettlerTaskSystem` is the reference implementation — others should follow the same pattern.

**Scope:** Low per site. Add `try { ... } catch (e) { log.error(...) }` around the per-entity body.

#### Rule 12.4 / 12.5 — `Race.Roman` used as default/fallback

The rule explicitly forbids `Race.Roman` as a default or fallback:

| File | Line | Violation |
|------|------|-----------|
| `src/game/game-state.ts` | 211 | `race !== undefined ? race : Race.Roman` — fallback for non-building entities |
| `src/game/renderer/sprite-render-manager.ts` | 78 | `private _currentRace: Race = Race.Roman` — default field value |
| `src/game/economy/building-production.ts` | 156 | `getBuildingInfo(Race.Roman, bt)` — hardcoded for cost lookup loop |
| `src/game/renderer/sprite-metadata/sprite-metadata.ts` | 241 | `getBuildingSpriteMap(Race.Roman)` — module-level export |
| `src/game/renderer/sprite-atlas-cache-manager.ts` | 36, 47 | `getIndexedDBCache(Race.Roman)` — only preloads Roman assets |
| `src/game/input/modes/select-mode.ts` | 47, 62 | `race: Race.Roman` — debug spawn hardcoded |

The `sprite-atlas-cache-manager.ts` and `sprite-metadata.ts` cases are architectural — the cache and default sprite map must be race-aware.

The `game-state.ts:211` case is labeled with a guard for buildings but still falls through to `Race.Roman` for non-building entity types (units) which have a race.

**Scope:** Medium. The cache manager and sprite map cases require design decisions about multi-race asset loading.

#### Rule 3.2 — Event names not past-tense verb

Five event names use adjective form instead of past-tense verb:

| Current name | Correct name |
|---|---|
| `'carrier:pickupComplete'` | `'carrier:pickupCompleted'` |
| `'carrier:deliveryComplete'` | `'carrier:deliveryCompleted'` |
| `'construction:levelingComplete'` | `'construction:levelingCompleted'` |
| `'construction:progressComplete'` | `'construction:progressCompleted'` |
| `'logistics:noMatch'` | `'logistics:noMatchFound'` |

Each is used in 2-5 files. Rename is mechanical but touches `event-bus.ts` + all emit/subscribe sites.

**Scope:** Low — mechanical rename across ~15 call sites.

---

### Minor

#### Rule 2.4 — Feature modules missing JSDoc documentation headers

Three feature `index.ts` files have no JSDoc comment listing their public API:

- `src/game/features/settler-tasks/index.ts`
- `src/game/features/work-areas/index.ts`
- `src/game/features/material-requests/index.ts`

#### Rule 9.2 — 55 `.bak` files in `src/`

There are 55 `.bak` files scattered throughout `src/`. Git preserves history — these should be deleted.

```
src/game/renderer/*.ts.bak  (20+ files)
src/game/systems/building-overlays/*.ts.bak  (5 files)
src/game/features/inventory/*.ts.bak  (4 files)
src/game/features/settler-tasks/settler-task-system.ts.bak
src/game/commands/command.ts.bak
src/game/game-state.ts.bak
... and 20+ more
```

Delete with: `find src -name '*.bak' -delete`

#### Rule 6.2 — TickSystems call `addEntity`/`removeEntity` directly (minor concern)

Several TickSystems call `gameState.addEntity()`/`removeEntity()` directly during simulation (stone spawning, unit death, crop removal, etc.) rather than routing through `executeCommand()`. This is pragmatically acceptable for internal simulation events, but worth tracking if multiplayer/replay is ever a goal.

---

## Observations

- **`SettlerTaskSystem.tick()`** is a clean reference implementation for Rule 10.1 — its per-entity try/catch with structured logging is exactly what other systems should copy.
- **`MovementSystem.tick()`** correctly sorts by entity ID for determinism — the right pattern.
- The `FeatureRegistry` and `FeatureDefinition` system is clean and follows Rule 2.3 well.
- Most feature `index.ts` files have good JSDoc headers. The three missing ones are the exception, not the rule.
- The `EventBus` implementation wraps every handler in try/catch with toast notifications, which is excellent defensive design for Rule 10.x.
