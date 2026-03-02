# Building Lifecycle Separation — Design

## Overview

Separate building implementation into two architecturally distinct modules: **Construction Site** (pre-completion) and **Operational Building** (post-completion). A building under construction is NOT a building with features temporarily disabled — it's a fundamentally different entity state. Before completion, a building has no service areas, no work areas, no production control — only a footprint, sprites, construction progress, and a **construction inventory** (input-only slots matching construction material costs, for carrier delivery and pile visualization). The transition at `building:completed` swaps the construction inventory for the production inventory and activates all operational features.

## Architecture

### Data Flow

```
[PlaceBuilding cmd]
       │
       ▼
┌────────────────────────────────────────────┐
│          CONSTRUCTION SITE MODULE          │
│                                            │
│  Entity + ConstructionSite record          │
│                                            │
│  Owns:                                     │
│   • footprint on map                       │
│   • construction sprites & visual state    │
│   • phase progression (6 phases)           │
│   • terrain capture/leveling/restore       │
│   • construction inventory (input-only)    │
│   • material delivery tracking             │
│   • digger/builder slot assignments        │
│                                            │
│  Interacts with:                           │
│   • DiggerWorkHandler (terrain leveling)   │
│   • BuilderWorkHandler (construction)      │
│   • ConstructionRequestSystem (requests)   │
│   • Carriers (deposit via inventory)       │
└────────────────┬───────────────────────────┘
                 │
                 │ building:completed
                 │ (ConstructionSite removed)
                 ▼
┌────────────────────────────────────────────┐
│         OPERATIONAL BUILDING MODULE        │
│                                            │
│  Entity + operational feature records      │
│                                            │
│  Created on completion:                    │
│   • BuildingInventory (production config)  │
│   • ServiceArea (residences only)          │
│   • ProductionState (multi-recipe)         │
│   • Barracks training (barracks only)      │
│   • Worker units spawned                   │
│                                            │
│  Interacts with:                           │
│   • MaterialRequestSystem (refill inputs)  │
│   • LogisticsDispatcher (carrier routing)  │
│   • SettlerTaskSystem (worker production)  │
│   • InventoryVisualizer (material piles)   │
└────────────────────────────────────────────┘
```

### Key Architectural Decision

**How to determine if a building is operational:** `!constructionSiteManager.hasSite(entityId)`. No separate registry or boolean flag needed. A building entity with no `ConstructionSite` record is operational. A building entity with a `ConstructionSite` record is under construction. This is the sole structural check — no more `buildingState.phase === Completed` guards scattered across systems.

### Subsystems

| # | Subsystem | Responsibility | Files |
|---|-----------|---------------|-------|
| 1 | Construction Site Core | Unified ConstructionSite type (absorbs BuildingState terrain data). ConstructionSiteManager expansion. Material delivery protocol. | `types.ts`, `construction-site-manager.ts` |
| 2 | Phase Progression & Terrain | BuildingConstructionSystem rewrite to use ConstructionSiteManager. Phase transitions. Terrain capture/leveling/restore. CompletedRising timer. | `construction-system.ts`, `internal/phase-transitions.ts`, `terrain.ts` |
| 3 | Inventory Lifecycle | Construction inventory created on placement, swapped for production inventory on completion. InventoryFeature stops eagerly creating production inventory on entity:created. No carrier changes needed. | `inventory-feature.ts`, `inventory-configs.ts`, `construction-request-system.ts` |
| 4 | Visual State & Rendering | Visual state derived from ConstructionSite instead of BuildingState. Pile rendering unchanged (uses construction inventory). | `visual-state.ts`, `entity-sprite-resolver.ts`, `selection-overlay-renderer.ts` |
| 5 | System Guard Migration | Update MaterialRequestSystem, SettlerTaskSystem, and all other consumers that currently check BuildingState phase. Remove BuildingStateManager dependency. | `material-request-system.ts`, `settler-task-system.ts`, `selection-panel.vue`, `useBuildingDebugInfo.ts` |
| 6 | Wiring, Persistence & Cleanup | GameServices composition root. Event bus updates. Persistence serialization. BuildingStateManager removal. | `game-services.ts`, `event-bus.ts`, `game-state-persistence.ts`, `index.ts` |
| 7 | Test Migration | Update all test helpers and test files to use ConstructionSiteManager instead of BuildingStateManager. | test helper files, all spec files |

## Data Models

### ConstructionSite (expanded — replaces both old ConstructionSite + BuildingState)

The sole state object for a building under construction. Created on `building:placed`, removed on `building:completed` or entity removal.

| Field | Type | Description |
|-------|------|-------------|
| buildingId | number | Entity ID |
| buildingType | BuildingType | Building type (for cost/size lookups) |
| race | Race | Owner race (for race-specific data) |
| player | number | Owning player index |
| tileX, tileY | number | Building anchor tile |
| phase | BuildingConstructionPhase | Current construction phase (0–5) |
| originalTerrain | ConstructionSiteOriginalTerrain \| null | Captured terrain state for restoration on cancellation. Set when digging starts. |
| terrainModified | boolean | Whether terrain leveling has been finalized (applied at 1.0) |
| requiredDiggers | number | Digger slot count (from building size) |
| assignedDiggers | Set\<number\> | Entity IDs of assigned diggers |
| levelingProgress | number | 0.0–1.0, incremented by digger work ticks |
| levelingComplete | boolean | All terrain leveled |
| constructionCosts | readonly ConstructionCost[] | From getConstructionCosts() |
| deliveredMaterials | Map\<EMaterialType, number\> | Materials delivered so far per type |
| totalCostAmount | number | Sum of all cost quantities |
| deliveredAmount | number | Sum of all delivered quantities |
| requiredBuilders | number | Builder slot count (from building size) |
| assignedBuilders | Set\<number\> | Entity IDs of assigned builders |
| constructionProgress | number | 0.0–1.0, incremented by builder work ticks |
| consumedAmount | number | Materials consumed by builder work |
| completedRisingProgress | number | 0.0–1.0, driven by CompletedRising timer. Used by visual state for the final rise animation. |

**Removed fields (from old BuildingState):** `phaseProgress`, `totalDuration`, `elapsedTime`. These were artifacts of the old timer-based progression. Visual progress is now derived directly from `levelingProgress`, `constructionProgress`, and `completedRisingProgress`. Duration is emergent from digger/builder work speed.

### BuildingState — DELETED

`BuildingState` and `BuildingStateManager` are removed entirely. Their responsibilities split:

| Old BuildingState field | New home |
|------------------------|----------|
| phase, phaseProgress | ConstructionSite.phase, derived from levelingProgress/constructionProgress |
| buildingType, race, tileX, tileY | ConstructionSite (during construction), entity.subType/entity.race (after) |
| originalTerrain, terrainModified | ConstructionSite |
| totalDuration, elapsedTime | Removed (not needed in event-driven model) |

### BuildingConstructionPhase (unchanged)

```ts
enum BuildingConstructionPhase {
    WaitingForDiggers = 0,
    TerrainLeveling = 1,
    WaitingForBuilders = 2,
    ConstructionRising = 3,
    CompletedRising = 4,
    Completed = 5,  // terminal — ConstructionSite removed immediately after
}
```

### BuildingVisualState (unchanged interface, different derivation)

```ts
interface BuildingVisualState {
    useConstructionSprite: boolean;
    verticalProgress: number;  // 0.0–1.0 for rising effect
    overallProgress: number;   // 0.0–1.0, approximate overall progress for UI display
    isCompleted: boolean;
    phase: BuildingConstructionPhase;
}
```

`overallProgress` kept for UI progress bar display. Simple derivation (does not need to be precise):
- Phases 0–2 (waiting/leveling): `levelingProgress * 0.3`
- Phase 3 (ConstructionRising): `0.3 + constructionProgress * 0.7`
- Phase 4 (CompletedRising): `1.0`
- No site (operational): `1.0`

Derived from `ConstructionSite` instead of `BuildingState`:
- `WaitingForDiggers/TerrainLeveling/WaitingForBuilders`: `verticalProgress = 0`, `useConstructionSprite = true`
- `ConstructionRising`: `verticalProgress = constructionProgress`, `useConstructionSprite = true`
- `CompletedRising`: `verticalProgress = site.completedRisingProgress`, `useConstructionSprite = false`
- No site (operational): `verticalProgress = 1.0`, `isCompleted = true`

## Events

### Modified Events

| Event | Old Payload | New Payload | Reason |
|-------|-------------|-------------|--------|
| `building:completed` | `{ entityId, buildingState }` | `{ entityId, buildingType, race }` | BuildingState no longer exists. Extract needed fields before ConstructionSite removal. |
| `building:removed` | `{ buildingState }` | `{ entityId, buildingType }` | BuildingState removed. Terrain restoration handled by construction system checking ConstructionSiteManager directly. **Ordering:** emitted BEFORE entity removal and BEFORE ConstructionSite removal, so handlers can still query `constructionSiteManager.getSite(entityId)` for terrain restoration. |

### Unchanged Events

| Event | Payload | Notes |
|-------|---------|-------|
| `building:placed` | `{ entityId, buildingType, x, y, player }` | Still triggers construction inventory creation + site registration |
| `construction:diggingStarted` | `{ buildingId }` | Phase transition on ConstructionSite |
| `construction:levelingComplete` | `{ buildingId }` | Phase transition + terrain finalization |
| `construction:buildingStarted` | `{ buildingId }` | Phase transition |
| `construction:materialDelivered` | `{ buildingId, material }` | Emitted by the inventory:changed bridge in game-services (unchanged) |
| `construction:progressComplete` | `{ buildingId }` | Phase transition → CompletedRising |
| `inventory:changed` | `{ buildingId, materialType, slotType, previousAmount, newAmount }` | Fires for both construction inventory (carrier deposits) and production inventory |

## Internal APIs

### ConstructionSiteManager (expanded)

```ts
class ConstructionSiteManager {
    // ── Lifecycle ──
    registerSite(buildingId: number, buildingType: BuildingType, race: Race, player: number, tileX: number, tileY: number): void;
    removeSite(buildingId: number): void;

    // ── Queries ──
    getSite(buildingId: number): ConstructionSite | undefined;
    getSiteOrThrow(buildingId: number, context: string): ConstructionSite;
    hasSite(buildingId: number): boolean;  // NEW — the structural "is under construction?" check
    getAllActiveSites(): IterableIterator<ConstructionSite>;
    getAllSiteIds(): number[];  // NEW — sorted for deterministic iteration

    // ── Digger management (unchanged) ──
    getDiggerSlotAvailable(buildingId: number): boolean;
    claimDiggerSlot(buildingId: number, diggerId: number): void;
    releaseDiggerSlot(buildingId: number, diggerId: number): void;
    advanceLeveling(buildingId: number, amount: number): void;

    // ── Builder management (unchanged) ──
    getBuilderSlotAvailable(buildingId: number): boolean;
    claimBuilderSlot(buildingId: number, builderId: number): void;
    releaseBuilderSlot(buildingId: number, builderId: number): void;
    advanceConstruction(buildingId: number, amount: number): void;

    // ── Material tracking (unchanged — delivery tracked via inventory:changed bridge) ──
    recordDelivery(buildingId: number, material: EMaterialType, amount: number): void;  // unchanged
    hasAvailableMaterials(buildingId: number): boolean;  // unchanged
    getRemainingCosts(buildingId: number): ConstructionCost[];  // unchanged

    // ── Worker queries (unchanged) ──
    findSiteNeedingDiggers(nearX: number, nearY: number, player: number): number | undefined;
    findSiteNeedingBuilders(nearX: number, nearY: number, player: number): number | undefined;

    // ── Persistence ──
    serializeSites(): SerializedConstructionSite[];
    restoreSite(data: SerializedConstructionSite): void;
}
```

### Operational Building Check (replaces BuildingStateManager lookups)

```ts
// In any system that needs to distinguish construction vs operational:
function isBuildingOperational(entityId: number, constructionSiteManager: ConstructionSiteManager): boolean {
    return !constructionSiteManager.hasSite(entityId);
}
```

This is NOT a separate function to export — each system uses `!constructionSiteManager.hasSite(id)` directly. The pattern is documented here for clarity.

### getBuildingVisualState (signature change)

```ts
// Old: getBuildingVisualState(buildingState: BuildingState | undefined): BuildingVisualState
// New:
function getBuildingVisualState(site: ConstructionSite | undefined): BuildingVisualState;
```

When `site` is undefined → building is operational, return completed visual state.
When `site` exists → derive visual state from `site.phase`, `site.constructionProgress`, `site.completedRisingProgress`, etc. All needed data is on `ConstructionSite` — no extra parameters needed.

## Error Handling & Boundaries

| Layer | On error... | Behavior |
|-------|------------|----------|
| ConstructionSiteManager | Site not found for mutation | `getSiteOrThrow` — throw with context string |
| ConstructionSiteManager | `hasSite` / `getSite` for queries | Return false / undefined (safe query) |
| Carrier delivery to construction | Building cancelled mid-delivery | Construction inventory removed → carrier deposit fails gracefully (existing carrier failure behavior) |
| Phase transitions | Out-of-order event | Ignore — phases only advance forward |
| Terrain restoration on cancellation | No originalTerrain captured | Skip restoration (building was cancelled before digging started) |
| Terrain restoration on demolition | No ConstructionSite (building is operational) | No restoration — terrain modification is permanent for completed buildings |
| Inventory creation on completion | Building entity removed between event and handler | Log warning, skip (entity removed events will clean up) |

### Design Decision: Terrain Permanence

Terrain modification is **permanent** for completed buildings. When a completed building is demolished, the terrain stays leveled. This matches Settlers 4 behavior and simplifies the design — `originalTerrain` data lives in `ConstructionSite` and is discarded on completion. Only construction cancellation restores terrain.

## Subsystem Details

### 1. Construction Site Core

**Files**: `src/game/features/building-construction/types.ts`, `src/game/features/building-construction/construction-site-manager.ts`
**Owns**: The unified `ConstructionSite` type, all construction state management

**Key changes to `types.ts`:**
- Remove `BuildingState` interface entirely
- Expand `ConstructionSite` with terrain fields (`originalTerrain`, `terrainModified`) moved from `BuildingState`
- Keep `BuildingVisualState.overallProgress` — derive from phase + progress fields (see BuildingVisualState section). Old derivation from `elapsedTime/totalDuration` is replaced.

**Key changes to `construction-site-manager.ts`:**
- Add `hasSite(buildingId)` method — the structural "is under construction?" check
- Add `getAllSiteIds()` returning sorted array for deterministic iteration
- Add serialization/restoration methods for persistence
- `recordDelivery` — unchanged (still called from the `inventory:changed` bridge in game-services)
- No terrain accessor methods — terrain fields (`originalTerrain`, `terrainModified`) are mutated directly on the `ConstructionSite` record via `getSiteOrThrow()`. This avoids over-engineering with get/set wrappers for simple field access.

**Behavior:**
- `recordDelivery`: updates `deliveredMaterials` map + `deliveredAmount`. Called when carriers deposit into the construction inventory (via the `inventory:changed` → `recordDelivery` bridge in game-services).
- Terrain data is set directly on `site.originalTerrain` by `BuildingConstructionSystem` on `construction:diggingStarted` (captures original terrain), read by terrain leveling operations via `getSiteOrThrow()`.

### 2. Phase Progression & Terrain

**Files**: `src/game/features/building-construction/construction-system.ts`, `src/game/features/building-construction/internal/phase-transitions.ts`, `src/game/features/building-construction/terrain.ts`
**Owns**: Phase state machine, terrain modification, CompletedRising timer, `building:completed` emission
**Depends on**: ConstructionSiteManager (replaces BuildingStateManager)

**Key changes to `construction-system.ts`:**
- Constructor takes `ConstructionSiteManager` instead of `BuildingStateManager`
- `tick()` iterates `constructionSiteManager.getAllSiteIds()` instead of `buildingStateManager.getAllBuildingIds()`
- Phase transitions mutate `ConstructionSite.phase` directly (no BuildingState intermediary)
- `tickTerrainLeveling` uses `site.levelingProgress` directly
- `tickCompletedRising` updates `site.completedRisingProgress = 1 - (remaining / COMPLETED_RISING_DURATION)` each frame. The local timer map can be replaced by computing remaining time from the progress value, or kept for precision — implementer's choice.
- `building:completed` emission extracts `buildingType` and `race` from the ConstructionSite before the site is removed
- `building:removed` handler looks up ConstructionSite directly for terrain restoration — if site exists, restore; if not (building was operational), skip

**Key changes to `terrain.ts`:**
- Terrain functions accept a narrow param interface instead of `BuildingState`:
  ```ts
  interface TerrainBuildingParams { buildingType: BuildingType; race: Race; tileX: number; tileY: number; }
  ```
- `captureOriginalTerrain(params: TerrainBuildingParams, groundType, groundHeight, mapSize)` — returns `ConstructionSiteOriginalTerrain`
- `setConstructionSiteGroundType(params: TerrainBuildingParams, groundType, mapSize)` — applies raw ground
- `applyTerrainLeveling(params: TerrainBuildingParams, groundType, groundHeight, mapSize, progress)` — applies leveling
- `restoreOriginalTerrain(originalTerrain: ConstructionSiteOriginalTerrain, groundType, groundHeight, mapSize)` — restores terrain
- This narrow interface is satisfied by both `ConstructionSite` and the temporary param object in `populateMapBuildings`

**Key changes to `internal/phase-transitions.ts`:**
- Export `COMPLETED_RISING_DURATION` (unchanged)
- Remove any references to `BuildingState`

### 3. Inventory Lifecycle

**Files**: `src/game/features/inventory/inventory-feature.ts`, `src/game/features/inventory/inventory-configs.ts`, `src/game/features/building-construction/construction-request-system.ts`
**Owns**: Inventory lifecycle management across the two building phases

**Design decision: construction sites keep inventory.** Construction sites use a **construction inventory** (input-only slots, capacity = exact cost per material) for carrier delivery and pile visualization. This reuses the existing `BuildingInventoryManager` infrastructure, `InventoryVisualizer` pile rendering, and carrier deposit path — no carrier code changes needed. The construction inventory is distinct from the production inventory: it's swapped on `building:completed`.

**Key changes to `inventory-feature.ts`:**
- Stop creating production inventory eagerly on `entity:created` for buildings. Currently the feature creates inventory for every building on `entity:created`, then `game-services.ts` overwrites it with construction inventory on `building:placed`. This double-creation is eliminated.
- New flow: `InventoryFeature` does NOT create inventory on `entity:created` for buildings at all. Construction inventory is created by `game-services.ts` on `building:placed`. Production inventory is created by `game-services.ts` on `building:completed`.
- The `InventoryFeature` becomes simpler: it only creates `BuildingInventoryManager`, sets up the `onChange` → `inventory:changed` bridge, and exports the manager.

**Key changes to `inventory-configs.ts`:**
- `getConstructionInventoryConfig()` — kept (still needed for construction inventory creation)
- `getInventoryConfig`, `hasInventory`, `isProductionBuilding`, `consumesMaterials` — unchanged (they describe operational inventory)

**No changes to carrier delivery:** Carriers deposit into construction inventory via `inventoryManager.depositInput()` exactly as before. The `inventory:changed` → `constructionSiteManager.recordDelivery()` bridge in `game-services.ts` continues to track material progress.

**No changes to `construction-request-system.ts`:** Already uses `ConstructionSiteManager.getRemainingCosts()` and `RequestManager`, independent of inventory. Unchanged.

### 4. Visual State & Rendering

**Files**: `src/game/features/building-construction/visual-state.ts`, `src/game/features/inventory/inventory-visualizer.ts`, `src/game/renderer/entity-sprite-resolver.ts`, `src/game/renderer/selection-overlay-renderer.ts`
**Owns**: Construction visual state derivation, material pile rendering for construction sites

**Key changes to `visual-state.ts`:**
- `getBuildingVisualState(site)` — takes `ConstructionSite | undefined` instead of `BuildingState | undefined`
- No site → completed visual state (operational building)
- Site exists → derive from `site.phase`:
  - `WaitingForDiggers`, `TerrainLeveling`, `WaitingForBuilders`: `verticalProgress = 0`, `useConstructionSprite = true`
  - `ConstructionRising`: `verticalProgress = site.constructionProgress`, `useConstructionSprite = true`
  - `CompletedRising`: `verticalProgress = site.completedRisingProgress`, `useConstructionSprite = false`
- `overallProgress` derived from phase + progress: phases 0–2 = `levelingProgress * 0.3`, phase 3 = `0.3 + constructionProgress * 0.7`, phases 4+ = `1.0`

**No changes to `inventory-visualizer.ts`:** Construction inventory uses the same `BuildingInventoryManager` and `BuildingPileRegistry` infrastructure. Pile rendering works identically for construction and production inventories — the visualizer reads inventory slots regardless of which phase the building is in.

**Key changes to renderers:**
- `entity-sprite-resolver.ts`: replace `buildingStateManager.getBuildingState(id)` with `constructionSiteManager.getSite(id)` when resolving construction vs completed sprite
- `selection-overlay-renderer.ts`: same replacement for selection overlay state

### 5. System Guard Migration

**Files**: `src/game/features/material-requests/material-request-system.ts`, `src/game/features/settler-tasks/settler-task-system.ts`, `src/game/features/settler-tasks/job-selector.ts`, `src/components/selection-panel.vue`, `src/composables/useBuildingDebugInfo.ts`
**Owns**: Updating all systems that currently check `buildingState.phase === Completed` or depend on `BuildingStateManager`

**Key changes to `material-request-system.ts`:**
- Remove `BuildingStateManager` dependency entirely
- Replace phase check:
  ```ts
  // OLD: if (!buildingState || buildingState.phase !== BuildingConstructionPhase.Completed) continue;
  // NEW: if (constructionSiteManager.hasSite(entity.id)) continue;
  ```
- Constructor takes `ConstructionSiteManager` instead of `BuildingStateManager`

**Key changes to `settler-task-system.ts`:**
- Remove `BuildingStateManager` from constructor config
- Add `ConstructionSiteManager` to constructor config
- Any workplace search that checks `phase === Completed` → use `!constructionSiteManager.hasSite(buildingId)`
- The `isBuildingAvailable` check (if it exists) should use the structural check

**Key changes to UI components:**

**`useSelectionPanel.ts`:**
- `buildingStatus` currently reads `buildingStateManager.getBuildingState(id)` → replace with `constructionSiteManager.hasSite(id)` to return `'building'` or `'completed'`

**`selection-panel.vue` — Construction Site info section (NEW):**
When a building is under construction (`constructionSiteManager.hasSite(id)`), show a non-debug construction section between Status and the Destroy button:
- **Progress bar** — visual bar showing `overallProgress` (0–100%)
- **Phase label** — human-readable phase name (e.g. "Waiting for diggers", "Leveling terrain", "Under construction")
- **Materials delivered** — per material type: `"3/5 Log, 2/4 Stone"` (delivered / required). Read from `ConstructionSite.deliveredMaterials` and `constructionCosts`.

When a building is operational (no construction site), this section is hidden. Work area, production control, and other operational UI is hidden during construction.

**Destroy button** — shown for BOTH construction sites and operational buildings. For construction sites, destroying cancels the build (terrain restored, construction inventory removed). The destroy flow is unchanged.

A new composable `useConstructionInfo.ts` provides:
```ts
interface ConstructionInfo {
    phase: string;               // human-readable phase name
    overallProgress: number;     // 0.0–1.0
    materials: Array<{ name: string; delivered: number; required: number }>;
}
function useConstructionInfo(game, selectedEntity, tick): { constructionInfo: Ref<ConstructionInfo | null> }
```

**`useBuildingDebugInfo.ts`:**
- Replace `buildingStateManager.getBuildingState(id)` with `constructionSiteManager.getSite(id)` for debug panel display

### 6. Wiring, Persistence & Cleanup

**Files**: `src/game/game-services.ts`, `src/game/event-bus.ts`, `src/game/game-state-persistence.ts`, `src/game/features/building-construction/index.ts`, test helper files
**Owns**: Composition root changes, event type updates, persistence format, BuildingStateManager removal

**Key changes to `game-services.ts`:**
- Remove `BuildingStateManager` instantiation and all references
- Remove `buildingStateManager` public property
- Remove `buildingStateManager.registerEvents(eventBus, cleanupRegistry)` call
- Remove the `featureRegistry.registerExports('building-construction', { buildingStateManager })` bridge
- Update `BuildingConstructionSystem` constructor: pass `constructionSiteManager` instead of `buildingStateManager`
- Keep the `inventory:changed` → `constructionSiteManager.recordDelivery` bridge (unchanged)
- Keep construction inventory creation on `building:placed` (unchanged):
  ```ts
  constructionSiteManager.registerSite(...);
  inventoryManager.createInventoryFromConfig(entityId, buildingType, getConstructionInventoryConfig(buildingType, race));
  ```
- Update `building:completed` handler:
  ```ts
  inventoryManager.removeInventory(entityId);  // remove construction inventory
  inventoryManager.createInventory(entityId, buildingType);  // create production inventory
  constructionSiteManager.removeSite(entityId);
  // ... rest unchanged, but using buildingType/race from event payload instead of buildingState
  ```
- Update all system constructors that took `buildingStateManager` → pass `constructionSiteManager`
- Pass `constructionSiteManager` to `SettlerTaskSystem` config (replacing `buildingStateManager`)
- No changes needed for `InventoryVisualizer` (construction inventory uses same rendering path)

**Key changes to `event-bus.ts`:**
- Update `GameEvents` interface:
  - `building:completed`: payload becomes `{ entityId: number; buildingType: BuildingType; race: Race }`
  - `building:removed`: payload becomes `{ entityId: number; buildingType: BuildingType }` (or keep entityId-only)

**Key changes to `game-state-persistence.ts`:**
- Remove `SerializedBuildingState` — no more building states to serialize
- Add `SerializedConstructionSite` for persisting active construction sites:
  ```ts
  interface SerializedConstructionSite {
      buildingId: number;
      buildingType: BuildingType;
      race: Race;
      player: number;
      tileX: number; tileY: number;
      phase: BuildingConstructionPhase;
      levelingProgress: number;
      levelingComplete: boolean;
      constructionProgress: number;
      deliveredMaterials: Array<[EMaterialType, number]>;
      consumedAmount: number;
      terrainModified: boolean;
  }
  ```
- On save: serialize all active construction sites from `constructionSiteManager`
- On load: restore construction sites via `constructionSiteManager.restoreSite()`, skip `buildingStateManager.restoreBuildingState()`
- For completed buildings loaded from save: no ConstructionSite created → they're immediately operational
- **Worker assignments (`assignedDiggers`, `assignedBuilders`) are NOT serialized.** Workers are re-assigned by the settler task system on load — serializing stale entity IDs would be fragile. The `SerializedConstructionSite` only contains progress state.

**Key changes to `index.ts` (building-construction barrel):**
- Remove `BuildingStateManager` export
- Ensure `ConstructionSiteManager` is exported
- Remove `BuildingState` type export (it no longer exists)
- Keep `BuildingConstructionPhase`, `ConstructionSite`, `BuildingVisualState` exports

### 7. Test Migration

**Files**: `tests/unit/helpers/test-game.ts`, `tests/unit/helpers/test-game-data.ts`, `tests/unit/helpers/test-simulation.ts`, all spec files in file map
**Owns**: Updating all test infrastructure and test files to use the new construction model
**Depends on**: Subsystems 1–6 (tests validate the new code)

**Key changes to test helpers:**
- `tests/unit/helpers/test-game.ts`, `test-game-data.ts`, `test-simulation.ts`: remove `buildingStateManager` references, use `constructionSiteManager` for construction state queries
- Tests that set `buildingState.phase = Completed` to simulate completed buildings: instead, ensure no ConstructionSite exists (which is the default for buildings created as completed)
- Tests that create buildings under construction: use `constructionSiteManager.registerSite(...)` instead of `buildingStateManager.createBuildingState(...)`

**Key changes to spec files:**
- Replace all `buildingState.phase` checks with `constructionSiteManager.hasSite()` / `!hasSite()`
- Replace `buildingStateManager.getBuildingState()` with `constructionSiteManager.getSite()`
- Update `building:completed` event assertions to use new payload `{ entityId, buildingType, race }`

## File Map

### New Files

| File | Subsystem | Purpose |
|------|-----------|---------|
| `src/composables/useConstructionInfo.ts` | 5 | Composable providing construction progress, phase label, and material delivery status for the selection panel |

### Deleted Files

| File | Reason |
|------|--------|
| `src/game/features/building-construction/building-state-manager.ts` | Fully absorbed into ConstructionSiteManager |

### Modified Files

| File | Subsystem | Change |
|------|-----------|--------|
| `src/game/features/building-construction/types.ts` | 1 | Remove `BuildingState`. Expand `ConstructionSite` with terrain fields. |
| `src/game/features/building-construction/construction-site-manager.ts` | 1 | Add `hasSite`, `getAllSiteIds`, terrain accessors, persistence methods |
| `src/game/features/building-construction/construction-system.ts` | 2 | Depend on ConstructionSiteManager not BuildingStateManager. Phase transitions on ConstructionSite. Terrain ops on ConstructionSite. |
| `src/game/features/building-construction/internal/phase-transitions.ts` | 2 | Remove BuildingState references |
| `src/game/features/building-construction/terrain.ts` | 2 | Accept ConstructionSite fields instead of BuildingState |
| `src/game/features/building-construction/visual-state.ts` | 4 | Derive from ConstructionSite instead of BuildingState |
| `src/game/features/building-construction/index.ts` | 6 | Remove BuildingStateManager export, remove BuildingState type export |
| `src/game/features/building-construction/map-buildings.ts` | 2 | Remove BuildingStateManager. Use `TerrainBuildingParams` + direct terrain calls. Emit `building:completed` with new payload. |
| `src/game/features/building-construction/spawn-units.ts` | 6 | Minimal — may reference BuildingState in event payload |
| `src/game/features/inventory/inventory-feature.ts` | 3 | Remove entity:created inventory creation for buildings |
| `src/game/features/settler-tasks/settler-task-system.ts` | 5 | Replace BuildingStateManager with ConstructionSiteManager |
| `src/game/features/material-requests/material-request-system.ts` | 5 | Replace phase check with `hasSite` structural check |
| `src/game/features/service-areas/service-area-feature.ts` | 5 | If it references BuildingStateManager, update |
| `src/game/event-bus.ts` | 6 | Update event payload types for building:completed, building:removed |
| `src/game/game-services.ts` | 6 | Remove BuildingStateManager. Update all wiring. Keep inventory:changed bridge. |
| `src/game/game-state-persistence.ts` | 6 | Serialize ConstructionSites instead of BuildingStates |
| `src/game/game-data-access.ts` | 5 | Remove BuildingStateManager imports if any |
| `src/game/renderer/entity-sprite-resolver.ts` | 4 | Use ConstructionSiteManager for visual state |
| `src/game/renderer/selection-overlay-renderer.ts` | 4 | Use ConstructionSiteManager for selection display |
| `src/components/selection-panel.vue` | 5 | Add construction info section (progress bar, materials). Hide operational UI during construction. Keep destroy button for both. |
| `src/composables/useSelectionPanel.ts` | 5 | Replace `buildingStateManager` with `constructionSiteManager.hasSite()` for buildingStatus |
| `src/composables/useBuildingDebugInfo.ts` | 5 | Debug info from ConstructionSite |
| `tests/unit/helpers/test-game.ts` | 7 | Remove BuildingStateManager, use ConstructionSiteManager |
| `tests/unit/helpers/test-game-data.ts` | 7 | Update building test data |
| `tests/unit/helpers/test-simulation.ts` | 7 | Update simulation helpers |
| `tests/unit/buildings/building-construction.spec.ts` | 7 | Rewrite to use ConstructionSite |
| `tests/unit/buildings/inventory-visualizer.spec.ts` | 7 | Update for construction pile path |
| `tests/unit/buildings/map-buildings.spec.ts` | 7 | Update for no BuildingState |
| `tests/unit/economy/economy.spec.ts` | 7 | Update phase checks |
| `tests/unit/economy/production-system.spec.ts` | 7 | Update phase checks |
| `tests/unit/economy/settler-task-job-selection.spec.ts` | 7 | Update phase checks |
| `tests/unit/integration/carrier-inventory-integration.spec.ts` | 7 | Update carrier delivery tests |
| `tests/unit/integration/economy-simulation.spec.ts` | 7 | Update simulation |

## Resolved Design Decisions

### Map-loaded buildings (`populateMapBuildings`)

`populateMapBuildings` currently depends heavily on `BuildingStateManager` (lines 170–193):
1. Gets auto-created `BuildingState` via `buildingStateManager.getBuildingState(entity.id)`
2. Writes terrain data: `captureOriginalTerrain(buildingState, ...)`, `setConstructionSiteGroundType(buildingState, ...)`, `applyTerrainLeveling(buildingState, ...)`
3. Sets `buildingState.phase = Completed`, `buildingState.phaseProgress = 1`, `buildingState.elapsedTime = totalDuration`
4. Emits `building:completed` with `{ entityId, buildingState }`

**Migration:** `populateMapBuildings` constructs a **temporary parameter object** for terrain functions (they only need `buildingType`, `race`, `tileX`, `tileY`), applies terrain directly, and emits `building:completed` with the new payload `{ entityId, buildingType, race }`. No `ConstructionSite` is created — the building is immediately operational. The `building:completed` handler in `game-services.ts` creates the production inventory and activates operational features.

```ts
// New flow in populateMapBuildings:
const terrainParams = { buildingType, race, tileX: entity.x, tileY: entity.y };
const originalTerrain = captureOriginalTerrain(terrainParams, groundType, groundHeight, mapSize);
setConstructionSiteGroundType(terrainParams, groundType, mapSize);
applyTerrainLeveling(terrainParams, groundType, groundHeight, mapSize, 1.0);
// originalTerrain is discarded — terrain permanence for completed buildings

eventBus.emit('building:completed', { entityId: entity.id, buildingType, race });
```

**Consequence:** `populateMapBuildings` no longer depends on `BuildingStateManager` OR `ConstructionSiteManager`. It only needs terrain functions and the event bus. The terrain functions' signatures must accept a simple param object (see Subsystem 2).

## Open Questions

1. **`placeBuildingsCompleted` setting**: The instant-complete debug setting bypasses construction. Currently it likely sets `phase=Completed` immediately. With the new model, it should skip `ConstructionSite` creation entirely (or create + immediately remove). Verify the implementation path.

## Implementation Notes

- **Exhaustive consumer audit required.** Before implementation, grep for all imports and references to `BuildingStateManager`, `BuildingState`, `buildingStateManager`, and `buildingState` across the entire codebase. The subsystem 5 file list covers known consumers, but there may be additional references in files not yet audited (e.g., debug tools, AI systems, carrier assignment).
- **Build after deletion.** After deleting `building-state-manager.ts` and removing `BuildingState` from `types.ts`, run `pnpm lint` to get a complete list of compilation errors. This is the most reliable way to find all remaining references.

## Out of Scope

- Refactoring the carrier transport job protocol — construction inventory reuses the existing pipeline unchanged
- Adding new construction features (cancellation refund, priority queue, tool requirements)
- Changing the phase enum values or adding new phases
- Modifying the terrain leveling algorithm or digger/builder work formulas
- UI redesign for construction progress display (just data source change)
