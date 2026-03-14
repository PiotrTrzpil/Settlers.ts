# Project Review — 2026-03-14

## Summary

The codebase has clean architecture — feature modules follow proper boundaries, SRP is broadly respected, and the Manager/System pattern is consistently applied. The main areas of concern are: (1) the renderer subsystem has 9 files over the 600-line hard limit, (2) optimistic programming is followed at the surface level but has deeper structural issues — 31 bare `!` assertions without context, ~5 lifecycle-set fields typed as nullable forcing guards throughout, and several `if (x) doX()` patterns that mask contract violations, (3) a few inline type imports and cross-feature `internal/` imports (fixed).

## Fixes Applied

| File | Fix |
|------|-----|
| `src/game/features/building-construction/construction-system.ts:31,117` | Replaced inline `import('@/utilities/map-size').MapSize` with proper top-level `import type` |
| `src/game/event-types-features.ts:15,85` | Replaced inline `import('./entity').EntityType` with proper top-level `import type` |
| `src/game/cli/commands/economy.ts:26,314,344` | Replaced inline `import('@/game/game-state').GameState` with proper top-level `import type` |
| `src/game/features/tower-garrison/index.ts:4` | Exported `isGarrisonBuildingType` from barrel to eliminate cross-feature `internal/` imports |
| `src/game/features/building-siege/siege-helpers.ts:11` | Changed import from `../tower-garrison/internal/garrison-capacity` to `../tower-garrison` |
| `src/game/features/building-siege/building-siege-system.ts:21` | Changed import from `../tower-garrison/internal/garrison-capacity` to `../tower-garrison` |
| `src/game/features/settler-tasks/index.ts:17` | Exported `createEnterBuildingExecutor` from barrel |
| `src/game/features/building-demand/building-demand-feature.ts:14` | Changed import from `../settler-tasks/internal/dispatch-executors` to `../settler-tasks` |
| `src/game/systems/inventory/building-inventory-helpers.ts` | Replaced 7 bare `slotStore.get(id)!` with explicit throws including slot ID and function name |
| `src/game/systems/inventory/building-inventory.ts` | Replaced 2 bare `slotStore.get(id)!` with `getSlotOrThrow` / explicit throws |
| `src/game/systems/inventory/pile-states-view.ts` | Replaced 3 bare `!` assertions with throws including entity/slot context |
| `src/game/features/logistics/transport-job-store.ts` | Replaced 4 bare `jobs.get(carrierId)!` with explicit throws including carrier ID and method name |
| `src/game/features/logistics/logistics-dispatcher.ts` | Replaced 3 bare `jobs.get(carrierId)!` with explicit throws including carrier ID and method name |
| `src/game/features/logistics/carrier-assigner.ts` | Replaced 1 bare `activeJobs.get(carrierId)!` with explicit throw |
| `src/game/features/logistics/demand-queue.ts` | Replaced 1 bare `demands.get(id)!` with explicit throw |
| `src/game/commands/handlers/building-handlers.ts` | Replaced bare `playerRaces.get(player)!` with explicit throw |
| `src/game/cli/commands/queries.ts` | Replaced 3 bare `playerRaces.get(player)!` with explicit throws |
| `src/game/systems/recruit/recruit-system.ts` | Replaced bare `queue.get(unitType)!` with explicit throw |
| `src/game/features/ai-player/internal/ai-player-system.ts` | Replaced bare `controllers.get(player)!` with explicit throw |
| `src/game/features/building-construction/construction-system.ts` | Replaced bare `pendingEvacuations.get(buildingId)!` with explicit throw |
| `src/game/features/settler-tasks/settler-task-system.ts` | Changed `_transportJobOps` from `| null` to definite assignment (`!:`) — lifecycle-set field |
| `src/game/entity.ts:127` | Added function name context to throw message |
| `src/game/utils/indexed-map.ts:137` | Added key value to `reindex` throw message |
| `src/game/renderer/optimized-depth-sorter.ts:100` | Added lifecycle context to throw message |
| `src/game/renderer/selection-indicator.ts:68` | Added diagnostic guidance to throw message |
| `src/game/state/game-state-persistence.ts:326` | Replaced unsafe `as Map` cast with `instanceof Map` runtime check |
| `tests/unit/utils/indexed-map.spec.ts:128` | Updated test expectation to match new error message |

## Issues Found

### Critical

None. No bugs, security issues, or data loss risks found.

### Recommended Refactors

#### 1. Optimistic Programming — Deeper Structural Issues

The codebase passes the **surface-level** optimistic programming checks well — `?.` and `?? fallback` on required deps are rare. But a deeper analysis reveals three layers of issues that the simple grep patterns miss:

##### 1a. Bare `!` assertions without context (31 instances)

The project rule says: *"Bare `!` on entity/map lookups — use `getEntityOrThrow` for context."* There are 31 instances of `map.get(key)!` or `store.get(id)!` that give no context when they fail. A bare `!` crashes with `TypeError: Cannot read properties of undefined` — no entity ID, no system name, no available keys.

**Worst offenders by file:**

| File | Count | Example |
|------|-------|---------|
| `systems/inventory/building-inventory-helpers.ts` | 7 | `slotStore.get(id)!` in `findInputSlot`, `findOutputSlot`, etc. |
| `features/logistics/transport-job-store.ts` | 4 | `this.jobs.get(carrierId)!` in `getReservedAmount`, `getActiveJobCountForDest` |
| `features/logistics/logistics-dispatcher.ts` | 3 | `this.jobStore.jobs.get(carrierId)!` in `cancelReservedJobs`, `handleBuildingDestroyed` |
| `systems/inventory/building-inventory.ts` | 2 | `this.slotStore.get(slotId)!` |
| `systems/inventory/pile-states-view.ts` | 2 | `this.get(entityId)!` in `entries()` and `values()` |
| `cli/commands/queries.ts` | 3 | `ctx.game.playerRaces.get(player)!` |
| `commands/handlers/building-handlers.ts` | 1 | `state.playerRaces.get(cmd.player)!` |
| Other files | 9 | Various map lookups |

**Fix pattern:** Replace with explicit throw:
```typescript
// Before:
const slot = slotStore.get(id)!;

// After:
const slot = slotStore.get(id);
if (!slot) throw new Error(`Slot ${id} not found in ${this.constructor.name}`);
```

##### 1b. Lifecycle-set fields typed as nullable — forcing guards everywhere

These fields are always set during initialization but typed as `| null`, causing defensive `if (x)` guards at every use site. Per `docs/optimistic.md`: *"A field is optional only when its absence carries domain meaning."*

| File | Field | Set via | Guards |
|------|-------|---------|--------|
| `input/input-manager.ts:49-52` | `tileResolver`, `commandExecutor`, `entityPicker`, `entityRectPicker` — all `| null` | `setup()` method | Every input handler guards with `if (!this.tileResolver)` |
| `settler-tasks/settler-task-system.ts:61` | `_transportJobOps: TransportJobOps | null` | `setTransportJobOps()` | Proxied in constructor (line 108) without null guard — inconsistent |
| `game.ts:44,47,53` | `scriptService`, `_onTerritoryToggle`, `_timelineCapture` — all `| null` | Set during `init()` | Guarded with `?.` at every call |
| `building-construction/construction-system.ts:50` | `terrainContext: TerrainContext | undefined` | `setTerrainContext()` | Guarded with `if (!this.terrainContext)` in 3 places |

**Fix pattern:** Use definite assignment assertion (`!:`) with a comment:
```typescript
// Before — forces guards everywhere:
private terrainContext: TerrainContext | undefined;

// After — documents the lifecycle contract:
// Set via setTerrainContext() before first tick — safe after terrain load
private terrainContext!: TerrainContext;
```

Or better: restructure so the field is a constructor parameter (preferred when possible).

##### 1c. `if (something) doAction()` patterns masking missing contracts

These are the subtlest violations. They look like innocent null checks but actually hide a deeper issue: the type system allows a state that the runtime never actually reaches, and the `if` guard papers over it instead of making the contract explicit.

**Examples:**

- **`settler-task-system.ts:162-165`**: `if (!runtime?.job) { return; }` — runtime is fetched from `this.runtimes.get(carrierId)`, and the event only fires for managed carriers. The `if` silently swallows what would be a bug (event fired for unmanaged entity).

- **`settler-task-system.ts:172-175`**: `if (!unitConfig) { return; }` — `settlerConfigs.get(entity.subType)` should always have a config for managed units. Silent return hides the real bug: a unit type was registered without a config.

- **`movement-system.ts:160-165`**: `if (ctrl) { ... }` in `removeController()` — controller is guaranteed to exist at call sites (lifecycle contract). The guard is a safety net that could hide a double-removal bug.

- **`settler-task-system.ts:482-488`**: `const entity = this.gameState.getEntity(settlerId); if (entity) { ... }` inside `onBuildingRemoved()` — iterating over runtimes for a building, but the settler might already be removed. This is legitimately nullable (entity removal ordering), but deserves a comment.

**The structural fix** is not just adding `throw` — it's asking: *should this state be possible at all?* Often the answer is to:
- Make the field required in the type/interface
- Split the type into two states (e.g., `IdleSettler` vs `WorkingSettler`)
- Use `getEntityOrThrow()` and let the caller handle the impossibility

##### 1d. `as` casts hiding nullability

Most `as` casts in the codebase are acceptable (`entity.subType as BuildingType` after an `EntityType` check). But a few are problematic:

| File:Line | Pattern | Risk |
|-----------|---------|------|
| `state/game-state-persistence.ts:326` | `snapshot['constructionSites'] as Map<number, unknown>` | Asserts deserialized data is a `Map` without validation — calling `.keys()` will crash if it's not |
| `renderer/entity-renderer-constants.ts:169` | `entity.subType as number` | Converts without validation |
| `util/state-machine.ts:69` | `Object.keys(config) as TState[]` | Assumes all keys are valid enum values |

The `game-state-persistence.ts` case is the most concerning — external data (snapshot) is trusted without structural validation.

##### 1e. Contextless throws (~4 instances)

Most throws in the codebase have good context. A few don't:

| File:Line | Message | Missing |
|-----------|---------|---------|
| `entity.ts:127` | `Entity ${id} is not carrying anything` | Which operation expected carrying state |
| `utils/indexed-map.ts:137` | `IndexedMap.reindex: key not found` | Which key was searched for |
| `renderer/optimized-depth-sorter.ts:100` | `no cached world pos for visible entity ${id}` | When/where the position should have been cached |
| `renderer/selection-indicator.ts:68` | `sprite GIL ${gilIndex} not loaded` | Why it wasn't loaded, what to check |

#### 2. Renderer files over 600-line hard limit (9 files)

These files exceed the project's hard ESLint limit of 600 lines. The data-heavy files (jil-indices, gil-indices) are mostly constant tables and are acceptable, but the procedural files need splitting:

| File | Lines | Nature | Suggested action |
|------|-------|--------|-----------------|
| `renderer/sprite-loader.ts` | 858 | Procedural | Split batch loading, single-sprite loading, and GFX file management into separate modules |
| `renderer/sprite-batch-renderer.ts` | 780 | Procedural | Extract buffer management and draw-call batching into helpers |
| `renderer/entity-texture-atlas.ts` | 758 | Procedural | Extract packing algorithm and atlas management into separate files |
| `renderer/selection-overlay-renderer.ts` | 755 | Procedural | Extract `drawCircleOverlays()` (~106 lines) and `drawTargetCircle()` (~95 lines) into dedicated pass files |
| `renderer/sprite-metadata/sprite-metadata.ts` | 720 | Mixed data/logic | Extract lookup logic from sprite data constants |
| `renderer/sprite-render-manager.ts` | 649 | Procedural | Extract race-switching and loading orchestration |

**Why:** These files make the renderer hard to navigate. The `selection-overlay-renderer.ts` has the deepest nesting in the codebase (291 deeply nested lines).

#### 3. Files approaching the 600-line limit

These aren't violations yet but are worth monitoring:

| File | Lines |
|------|-------|
| `features/settler-tasks/settler-task-system.ts` | 598 |
| `systems/inventory/building-inventory.ts` | 592 |
| `features/building-construction/construction-site-demand.ts` | 592 |
| `input/input-manager.ts` | 584 |
| `state/game-state-persistence.ts` | 580 |
| `features/building-siege/building-siege-system.ts` | 579 |
| `game-state.ts` | 571 |

#### 4. `EntityRenderer` class — too many fields (SRP concern)

`src/game/renderer/entity-renderer.ts` (694 lines) has ~40 instance fields mixing spatial data, GPU resources, pass instances, state providers, timing counters, and debug data. While the pass extraction is a good pattern, the class still acts as a "pass coordinator + state bag". Consider:

- Moving timing/profiling into a dedicated `RenderProfiler` that passes share
- Moving state providers (`getVisualState`, `getBuildingRenderState`, etc.) into the `PassContext` construction site rather than storing them as class fields

#### 5. `components/use-renderer/index.ts` — over 600-line limit (pre-existing ESLint error)

This file is currently at 602 lines and failing the ESLint `max-lines` rule. Needs ~10 lines extracted.

### Minor

#### 1. `jil-indices.ts` (941 lines) and `gil-indices.ts` (686 lines)

These are constant data tables. While they exceed the line limit, splitting them by entity type (units vs buildings vs map objects) would improve navigability. Low priority since they're pure data.

#### 2. `DemandQueue.eventBus` typed as optional

`src/game/features/logistics/demand-queue.ts:64-68` — The `eventBus` field is `EventBus | null` with the constructor accepting `eventBus?: EventBus`. The events emitted (`logistics:demandCreated`, `logistics:demandConsumed`) are diagnostic/debug only, making this a borderline-acceptable optional pattern. However, if these events are depended on by any system, `eventBus` should be made required. Worth auditing.

#### 3. `overlay-data-loader.ts:44` — `|| undefined` pattern

```typescript
directionIndex: resolved.directionIndex || undefined
```
Uses `||` to convert `0` to `undefined`, which is intentional (0 means "no direction override") but reads like an accidental falsy coercion. A comment or explicit `resolved.directionIndex === 0 ? undefined : resolved.directionIndex` would be clearer.

## Observations

- **Optimistic programming — surface level**: Good. The `?.` / `?? fallback` patterns are almost always on legitimately nullable fields, with many having inline comments. No cases of `this.eventBus?.emit()` on required deps (the 2 instances in `DemandQueue` are intentionally optional).
- **Optimistic programming — structural level**: Mixed. The codebase trusts contracts at the type level in most places, but has pockets of defensive `if (x)` guards on lifecycle-set fields and map lookups that could be eliminated with stricter types, definite assignment, or state splitting. The 31 bare `!` assertions are the most actionable — they trust the contract but give zero debugging context when it breaks.
- **Feature module architecture**: Clean separation. No systems import from features (Rule 2.0 verified). Feature modules have proper barrel files with documented public APIs.
- **Manager/System pattern**: Consistently applied — managers own state, systems handle per-frame behavior.
- **Event-driven design**: Construction system's phase transitions via events is well-structured and maintainable.
- **Error handling in tick systems**: Properly wraps per-entity updates in try/catch (Rule 10.1).
- **Cross-feature boundary discipline**: Only 3 violations found (all fixed), across a codebase with 20+ feature modules — strong discipline.
