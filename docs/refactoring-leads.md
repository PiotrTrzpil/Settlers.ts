# Refactoring Leads

Parallelizable refactoring tasks ordered by impact. Each task is independent and can be executed by a separate agent.

> **Note (2026-03-03):** See `reviews/arch-review-2026-03-03-1122.md` for an up-to-date list of current architectural issues. Many tasks below are already completed — file sizes and structures referenced may no longer match the current code.

---

## Task 0: Migrate remaining manually-wired features to FeatureDefinition

**Done (2026-03-03):** `CarrierFeature` has been migrated. `CommandContext` optional fields have been made required.

**Remaining manually-wired systems** in `game-services.ts` (candidates for future migration):

| System | Location | Notes |
|--------|----------|-------|
| `BuildingConstructionSystem` | `features/building-construction` | Complex: depends on constructionSiteManager, executeCommand, residenceSpawner |
| `ResidenceSpawnerSystem` | `features/building-construction` | Depends on construction system |
| `ConstructionRequestSystem` | `features/building-construction` | Depends on requestManager (from InventoryFeature) |
| `LogisticsDispatcher` | `features/logistics` | Depends on carrierManager, settlerTaskSystem, requestManager, serviceAreaManager, inventoryManager |
| `SettlerTaskSystem` | `features/settler-tasks` | Depends on many managers; work handlers registered separately |
| `BarracksTrainingManager` | `features/barracks` | Depends on settlerTaskSystem, inventoryManager, carrierManager |
| `BuildingOverlayManager` | `systems/building-overlays` | Should move to `features/building-overlays/` first (see arch review issue 3) |

**Approach for each:** Create a `FeatureDefinition` in the feature's directory following the pattern in `features/carriers/carrier-feature.ts` and `features/trees/tree-feature.ts`. Declare dependencies, move event subscriptions into the feature `create()`, extract exports. Remove `registerEvents()`/`unregisterEvents()` from the manager class. Add to `featureRegistry.loadAll()` in game-services.ts.

**Validation:** `pnpm lint && pnpm test:unit`

---

## Task 1: Split SpriteRenderManager (1,370 lines, 20+ async methods)

**File:** `src/game/renderer/sprite-render-manager.ts`

**Problem:** God class mixing sprite loading, atlas packing, caching (3 tiers: module Map, IndexedDB, Cache API with lz4), palette management, race switching, and animation data provision. 20+ async methods for different sprite categories (buildings, units, trees, stones, decorations, flags, resources, overlays). `loadSpritesForRace()` orchestrates ~10 sequential category loads.

**Approach:**
1. Extract category-specific loaders into separate classes implementing a common `ISpriteCategoryLoader` interface (one per: buildings, units, trees, stones, decorations, map-objects, resources, flags, overlays)
2. Extract caching to a dedicated `SpriteAtlasCacheManager` (module cache + IndexedDB + Cache API)
3. SpriteRenderManager becomes a thin orchestrator delegating to loaders and cache

**Target:** Reduce SpriteRenderManager to ~400 lines. Each category loader ~100-200 lines.

**Validation:** `pnpm lint && pnpm test:unit`

---

## Task 2: Split EntityRenderer (1,149 lines, 29 imports, 8+ render passes)

**File:** `src/game/renderer/entity-renderer.ts`

**Problem:** Highest import count in the codebase (29). Handles 8+ rendering passes in one class: textured entities, color quads, selection overlays, path indicators, territory dots, stack ghosts, placement preview, transitioning units. Mixes WebGL buffer management, entity sorting, sprite resolution, interpolation, and frame timing.

**Approach:**
1. Create `IRenderPass` interface with `prepare()` and `draw()` methods
2. Extract each pass into its own class: `PathIndicatorPass`, `EntitySpritePass`, `SelectionPass`, `ColorEntityPass`, `TransitionBlendPass`, `TerritoryDotPass`, `StackGhostPass`, `PlacementPreviewPass`
3. EntityRenderer becomes a pass coordinator calling passes in order
4. Extract unit movement interpolation into a separate concern

**Target:** Reduce EntityRenderer to ~400 lines. Each pass ~100-200 lines.

**Validation:** `pnpm lint && pnpm test:unit` + visual check via `pnpm dev` (entities render correctly)

---

## Task 3: Split SpriteMetadataRegistry (1,050 lines, 9 parallel Maps, 20+ methods)

**File:** `src/game/renderer/sprite-metadata/sprite-metadata.ts`

**Problem:** Single class managing 9 separate sprite storage maps (buildingsByRace, mapObjects, resources, unitsByRace, flags, territoryDots, overlayFrames, animatedEntities, animatedByRace). Mixes registry/lookup with serialization/deserialization (lines 857-1044). Adding a new sprite category requires understanding all 9 data structures.

**Approach:**
1. Create `ISpriteCategory<K>` interface with `get(key: K): SpriteEntry | null` and `set(key: K, entry: SpriteEntry)`
2. Implement per-domain categories: `BuildingSpriteCategory`, `UnitSpriteCategory`, `MapObjectSpriteCategory`, `ResourceSpriteCategory`, `DecorationSpriteCategory`
3. Extract serialization into a separate `SpriteMetadataSerializer` that operates on the categories
4. SpriteMetadataRegistry becomes a facade delegating to category instances

**Target:** Reduce main file to ~300 lines. Each category ~100-150 lines. Serializer ~200 lines.

**Validation:** `pnpm lint && pnpm test:unit`

---

## Task 4: Split SettlerTaskSystem (870 lines, implicit state machine)

**File:** `src/game/features/settler-tasks/settler-task-system.ts`

**Problem:** Manages task execution, animation, idle state, and work handler dispatch in one class. Implicit state machine via `SettlerState` enum with switch statements scattered across methods. Dual execution paths for `JobState` (worker) vs `MoveTaskState` (carrier). 26 methods total.

**Approach:**
1. Extract the state machine into an explicit `UnitStateMachine` with well-defined states and transitions
2. Separate worker task execution from carrier task execution into dedicated sub-systems
3. Extract idle animation management into `IdleAnimationController`
4. Extract work handler registration/dispatch into `WorkHandlerRegistry`

**Target:** Reduce main file to ~300 lines. State machine ~200 lines. Worker/carrier paths ~150 lines each.

**Validation:** `pnpm lint && pnpm test:unit`

---

## Task 5: Replace switch dispatchers with strategy maps

**Files:**
- `src/game/renderer/entity-sprite-resolver.ts` (240 lines, 19 switch/case)
- `src/game/features/settler-tasks/task-executors.ts` (17 switch/case, has `eslint-disable complexity`)
- `src/game/animation/animation-resolver.ts` (14 switch/case)

**Problem:** Each new entity type, task type, or animation type requires modifying large switch statements. Complexity suppressions already in place. Hard to test individual branches.

**Approach:**
1. `entity-sprite-resolver.ts`: Create `Record<EntityType, SpriteResolverFn>` map. Each entity type gets a resolver function.
2. `task-executors.ts`: Create `Record<TaskType, TaskExecutorFn>` map. Remove eslint-disable.
3. `animation-resolver.ts`: Create `Record<AnimationType, AnimationResolverFn>` map.
4. Each resolver/executor can be a standalone function in its own file or grouped by domain.

**Target:** Eliminate all switch dispatchers. Each resolver map entry is independently testable.

**Validation:** `pnpm lint && pnpm test:unit`

---

## Task 6: Split logistics-dispatcher.ts (~600 lines, mixed concerns)

**File:** `src/game/features/logistics/logistics-dispatcher.ts`

**Problem:** Mixes request-supply matching, carrier job assignment, stall detection state machine, match failure diagnostics, and event lifecycle. Logistics feature overall is 2,300 lines across 10 files but the dispatcher is the monolith.

**Approach:**
1. Extract request-supply matching algorithm into `RequestMatcher`
2. Extract carrier assignment logic into `CarrierAssigner`
3. Extract stall detection into `StallDetector`
4. Extract match failure diagnostics into `MatchDiagnostics`
5. LogisticsDispatcher becomes an orchestrator composing these

**Target:** Reduce dispatcher to ~200 lines. Each extracted module ~100-150 lines.

**Validation:** `pnpm lint && pnpm test:unit`

---

## Task 7: Extract composables from large Vue components

**Files:**
- `src/components/selection-panel.vue` (949 lines) — work area mode, building adjustments, carrier debug, request status
- `src/components/layer-panel.vue` (514 lines)
- `src/components/logistics-debug-panel.vue` (470 lines)

**Problem:** Components contain business logic (calls to `input.switchMode()`, complex computed properties reaching into 5+ game services, data aggregation). Selection panel is nearly 1000 lines mixing multiple feature UIs.

**Approach:**
1. Extract `useCarrierDebugInfo.ts` composable from selection-panel
2. Extract `useWorkAreaAdjustment.ts` composable from selection-panel
3. Extract `useBuildingAdjustments.ts` composable from selection-panel
4. Split selection-panel into sub-components: `BuildingSelectionPanel`, `UnitSelectionPanel`, `GroupSelectionPanel`
5. Extract composables from layer-panel and logistics-debug-panel as needed

**Target:** Each Vue component under 300 lines. Business logic in composables.

**Validation:** `pnpm lint && pnpm test:unit` + visual check via `pnpm dev`

---

## Task 8: Centralize entity cleanup pattern (9+ duplicated subscriptions)

**Problem:** 9+ features independently subscribe to `entity:removed` with nearly identical code:
```typescript
subscriptions.subscribe(eventBus, 'entity:removed', ({ entityId }) => {
    this.someMap.delete(entityId);
});
```
Changing event structure requires updating 9+ locations. Cleanup order is implicit.

**Files to audit:** Search for `entity:removed` across `src/game/features/` and `src/game/systems/`.

**Approach:**
1. Create an `EntityCleanupRegistry` that features register their cleanup handlers with
2. Registry controls execution order and provides a single subscription point
3. Each feature registers: `cleanupRegistry.onEntityRemoved(entityId => this.map.delete(entityId))`
4. Optionally support priority/ordering for cleanup sequence

**Target:** Single `entity:removed` subscription. Features register cleanup functions declaratively.

**Validation:** `pnpm lint && pnpm test:unit`

---

## Task 9: Convert raw-object-registry to data-driven format (1,237 lines of hardcoded data)

**File:** `src/resources/map/raw-object-registry.ts`

**Problem:** 1,237 lines of hardcoded `RawObjectEntry` objects. No O(1) indexing (linear lookup via `getEntryByRaw(byte)`). Manual maintenance with comments like "Guessed Bush1-4", "Needs visual verification". Adding new map objects requires editing both this file and the `MapObjectType` enum.

**Approach:**
1. Extract data to `raw-object-registry.json` (or generate from the current TS file)
2. Create typed `RawObjectLookup` with O(1) array indexing by raw byte (0-255)
3. Generate or validate the TS types from the JSON at build time
4. Move verification notes to the JSON as metadata fields

**Target:** Eliminate 1,000+ lines of boilerplate. O(1) lookup instead of linear scan.

**Validation:** `pnpm lint && pnpm test:unit`

---

## Task 10: Extract movement collision resolution

**Files:**
- `src/game/systems/movement/movement-system.ts` (623 lines, 26 methods)
- `src/game/systems/movement/movement-controller.ts` (456 lines, complex state machine)
- `src/game/systems/movement/push-utils.ts` (210 lines)

**Problem:** MovementController inlines collision detection, push resolution, blocked state timeouts, and repath logic alongside path following and smooth interpolation. Push utils are in a separate file but tightly coupled to controller internals. State machine (blocked timeouts, repath triggers) is implicit.

**Approach:**
1. Create `ICollisionResolver` interface; extract push behavior from MovementController
2. Extract blocked-state machine (timeouts, repath triggers) into `BlockedStateHandler`
3. Create `IPathfinder` interface; extract AStar + smoothing into `PathfindingService`
4. MovementController delegates to collision resolver, blocked handler, and pathfinder

**Target:** MovementController under 250 lines. Each extracted module ~100-150 lines.

**Validation:** `pnpm lint && pnpm test:unit`

---

## Task 11: Refactor GameServices initialization (25 imports, implicit ordering)

**File:** `src/game/game-services.ts`

**Problem:** De facto service locator that manually creates and wires every manager/system. Implicit initialization ordering (e.g., entity:removed handler order matters but isn't enforced). Every change to system dependencies ripples through this file. No lazy loading or conditional initialization.

**Approach:**
1. Create a `FeatureRegistry` where each feature module declares its dependencies
2. Features register via `registry.register({ id: 'logistics', deps: ['inventory', 'movement'], init: (deps) => ... })`
3. Registry resolves initialization order via topological sort
4. GameServices delegates to the registry instead of manual wiring

**Target:** GameServices reduced to registry setup. Each feature owns its initialization.

**Validation:** `pnpm lint && pnpm test:unit`

---

## Task 12: Split inventory-visualizer.ts (801 lines, mixed state + rendering)

**File:** `src/game/features/inventory/inventory-visualizer.ts`

**Problem:** Mixes material stack state management with visual rendering of building inventories. Handles multiple material types, rendering variations, and inventory state transitions in one class. The inventory feature overall is 2,363 lines across 7 files.

**Approach:**
1. Extract material stack state tracking into `MaterialStackState`
2. Extract visual positioning/layout logic into `InventoryLayout`
3. InventoryVisualizer becomes a thin coordinator connecting state to layout

**Target:** Each module under 300 lines.

**Validation:** `pnpm lint && pnpm test:unit`
