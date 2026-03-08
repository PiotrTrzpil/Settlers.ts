# Building Construction Process — Design

## Overview

Replace the current timer-based automatic building construction with the original Settlers 4 process: when a building is placed, diggers level the ground, carriers deliver construction materials, and builders construct the building — all driven by real settler actions rather than a clock.

## Architecture

### Data Flow

```
[PlaceBuilding cmd]
       │
       ▼
[BuildingStateManager] ──creates──▶ BuildingState (phase=WaitingForDiggers)
       │
       ▼
[ConstructionSiteManager] ──registers site──▶ construction site registry
       │                                          │
       ├── calculates digger count from footprint │
       ▼                                          ▼
[DiggerWorkHandler]              [ConstructionRequestSystem]
  finds site, claims slot          requests BOARD/STONE/GOLD
  digger walks + levels ground     via RequestManager
       │                                │
       ▼                                ▼
  terrain leveled ──▶ phase=WaitingForBuilders
                                        │
                     [LogisticsDispatcher] assigns carriers
                            │
                            ▼
                     materials arrive in inventory
                            │
                            ▼
                     [BuilderWorkHandler]
                       finds site with materials
                       builder walks + builds
                       pauses when materials run out
                       resumes when more arrive
                            │
                            ▼
                     all costs satisfied ──▶ phase=Completed
```

### Subsystems

| # | Subsystem | Responsibility | Files |
|---|-----------|---------------|-------|
| 1 | Construction Site Manager | Track active sites, digger/builder slots, material progress | `src/game/features/building-construction/construction-site-manager.ts` |
| 2 | Phase Progression | Rewrite phase logic: digger-driven leveling, material-gated building | `src/game/features/building-construction/construction-system.ts`, `internal/phase-transitions.ts` |
| 3 | Digger Work Handler | `SearchType.CONSTRUCTION_DIG` — diggers find sites, level terrain | `src/game/features/settler-tasks/work-handlers.ts` (extend) |
| 4 | Builder Work Handler | `SearchType.CONSTRUCTION` — builders find sites with materials, build | `src/game/features/settler-tasks/work-handlers.ts` (extend) |
| 5 | Construction Material Requests | Request BOARD/STONE/GOLDBAR for under-construction buildings | `src/game/features/building-construction/construction-request-system.ts` |
| 6 | Construction Inventory | Input-only inventory for buildings under construction | `src/game/features/inventory/inventory-configs.ts` (extend) |
| 7 | Events & Wiring | New events, handler registration, game-services integration | `src/game/event-bus.ts`, `src/game/game-services.ts` |

## Data Models

### ConstructionSite

Managed by `ConstructionSiteManager`. One per building under construction.

| Field | Type | Description |
|-------|------|-------------|
| buildingId | number | Entity ID of the building |
| buildingType | BuildingType | Building type |
| race | Race | Owner race |
| player | number | Owner player |
| tileX, tileY | number | Building anchor |
| requiredDiggers | number | Digger slots (from footprint size) |
| assignedDiggers | Set\<number\> | Entity IDs of diggers currently working |
| levelingProgress | number | 0.0–1.0, incremented by each digger work tick |
| levelingComplete | boolean | All terrain leveled |
| constructionCosts | ConstructionCost[] | From `getConstructionCosts(buildingType, race)` |
| deliveredMaterials | Map\<EMaterialType, number\> | Materials delivered so far |
| totalCostAmount | number | Sum of all cost quantities |
| deliveredAmount | number | Sum of all delivered quantities |
| requiredBuilders | number | Builder slots (from building size) |
| assignedBuilders | Set\<number\> | Entity IDs of builders currently working |
| constructionProgress | number | 0.0–1.0, incremented by builder work ticks |

### Digger/Builder Slot Counts

Derived from `getBuildingFootprint(tileX, tileY, buildingType, race).length` — the actual footprint tile count from the XML bitmask:

```ts
function getDiggerCount(footprintTileCount: number): number {
    if (footprintTileCount <= 30) return 2;
    if (footprintTileCount <= 60) return 3;
    if (footprintTileCount <= 100) return 4;
    if (footprintTileCount <= 150) return 5;
    return 6;
}
```

Builder count uses the same function. Thresholds need playtesting. The footprint includes exclusion zones around the visible structure (typically 30–200+ tiles), so these ranges cover the real spread.

### Updated BuildingConstructionPhase

```ts
enum BuildingConstructionPhase {
    WaitingForDiggers = 0,  // placed, ground changed to DustyWay, awaiting diggers
    TerrainLeveling = 1,    // diggers actively leveling (driven by digger work)
    WaitingForBuilders = 2, // leveling done, awaiting materials + builders
    ConstructionRising = 3, // builders actively building (driven by builder work + materials)
    CompletedRising = 4,    // final rise animation (timed, short)
    Completed = 5,          // terminal
}
```

**Phase transitions:**
- `WaitingForDiggers` → `TerrainLeveling`: first digger arrives and starts work
- `TerrainLeveling` → `WaitingForBuilders`: `levelingProgress >= 1.0`
- `WaitingForBuilders` → `ConstructionRising`: first builder arrives with materials available
- `ConstructionRising` → paused (stays in phase, builders idle): materials run out, `deliveredAmount <= consumedAmount`
- `ConstructionRising` → `CompletedRising`: `constructionProgress >= 1.0`
- `CompletedRising` → `Completed`: timed (0.5s animation), then emits `building:completed`

### ConstructionCost (existing)

Already defined in `building-production.ts`:

| Field | Type | Description |
|-------|------|-------------|
| material | EMaterialType | BOARD, STONE, or GOLDBAR |
| amount | number | Quantity needed |

## Internal APIs

### ConstructionSiteManager

```ts
class ConstructionSiteManager {
    // Lifecycle
    registerSite(buildingId: number, buildingType: BuildingType, race: Race, player: number, tileX: number, tileY: number): void;
    removeSite(buildingId: number): void;
    getSite(buildingId: number): ConstructionSite | undefined;

    // Digger management
    getDiggerSlotAvailable(buildingId: number): boolean;  // assignedDiggers.size < requiredDiggers
    claimDiggerSlot(buildingId: number, diggerId: number): void;
    releaseDiggerSlot(buildingId: number, diggerId: number): void;

    // Builder management
    getBuilderSlotAvailable(buildingId: number): boolean;
    claimBuilderSlot(buildingId: number, builderId: number): void;
    releaseBuilderSlot(buildingId: number, builderId: number): void;
    advanceConstruction(buildingId: number, amount: number): void;

    // Material tracking
    recordDelivery(buildingId: number, material: EMaterialType, amount: number): void;
    hasAvailableMaterials(buildingId: number): boolean;  // deliveredAmount > consumed portion
    getRemainingCosts(buildingId: number): ConstructionCost[];  // what still needs delivery

    // Queries
    findSiteNeedingDiggers(nearX: number, nearY: number, player: number): number | undefined;  // nearest site with open digger slots
    findSiteNeedingBuilders(nearX: number, nearY: number, player: number): number | undefined;  // nearest site with materials + open builder slots
    getAllActiveSites(): IterableIterator<ConstructionSite>;
}
```

### Digger Work Handler

```ts
// SearchType: CONSTRUCTION_DIG (new)
// Registered for UnitType.Digger
function createDiggerHandler(
    gameState: GameState,
    constructionSiteManager: ConstructionSiteManager,
): EntityWorkHandler;

// findTarget: constructionSiteManager.findSiteNeedingDiggers(settler.x, settler.y, settler.player)
// canWork: getDiggerSlotAvailable(buildingId)
// claim: claimDiggerSlot(buildingId, settlerId)
// release: releaseDiggerSlot(buildingId, settlerId)
```

Digger job choreography (built programmatically, like barracks training):
1. `GO_TO_TARGET` — walk to building site
2. `WORK` — leveling animation, duration = `LEVELING_WORK_FRAMES` (e.g. 50 frames = 5s per work cycle)
3. On WORK completion: `constructionSiteManager.completeNextTile(buildingId)`
4. Loop steps 2–3 until `completeNextTile` returns null (all tiles leveled)
5. When done: release slot, return to idle

`progressPerCycle = 1.0 / (LEVELING_CYCLES_TOTAL / requiredDiggers)` — more diggers = faster leveling. `LEVELING_CYCLES_TOTAL = 6` means a single digger does 6 cycles; 2 diggers each do 3; 3 diggers each do 2.

### Builder Work Handler

```ts
// SearchType: CONSTRUCTION (existing, currently unused)
// Registered for UnitType.Builder
function createBuilderHandler(
    gameState: GameState,
    constructionSiteManager: ConstructionSiteManager,
    inventoryManager: BuildingInventoryManager,
): EntityWorkHandler;

// findTarget: constructionSiteManager.findSiteNeedingBuilders(settler.x, settler.y, settler.player)
//   only returns sites where: levelingComplete && hasAvailableMaterials && builderSlotAvailable
// canWork: hasAvailableMaterials(buildingId) && getBuilderSlotAvailable(buildingId)
// claim: claimBuilderSlot(buildingId, builderId)
// release: releaseBuilderSlot(buildingId, builderId)
```

Builder job choreography (built programmatically):
1. `GO_TO_TARGET` — walk to building site
2. `WORK` — building animation, duration = `BUILDING_WORK_FRAMES` (e.g. 40 frames = 4s per work cycle)
3. On WORK completion: check `hasAvailableMaterials(buildingId)`
   - If yes: `constructionSiteManager.advanceConstruction(buildingId, progressPerCycle)`, consume 1 material unit from inventory, loop to step 2
   - If no: release slot, return to idle (will re-find this or another site next tick)
4. When `constructionProgress >= 1.0`: release slot, done

`progressPerCycle = 1.0 / (BUILDING_CYCLES_TOTAL / requiredBuilders)`. `BUILDING_CYCLES_TOTAL` scales with `totalCostAmount` — more materials = more cycles. Formula: `BUILDING_CYCLES_TOTAL = max(4, totalCostAmount * 2)`.

Material consumption: 1 material unit consumed from inventory per work cycle. The type consumed follows cost order (all BOARD first, then STONE, then GOLDBAR). `inventoryManager.withdrawInput(buildingId, materialType)`.

### ConstructionRequestSystem

```ts
class ConstructionRequestSystem implements TickSystem {
    // Ticks periodically (not every frame — every 0.5s is enough)
    tick(dt: number): void;
}
```

Behavior on tick:
- Iterates `constructionSiteManager.getAllActiveSites()`
- For each site where `levelingComplete` (or immediately — carriers can deliver during leveling too, matching original game):
  - For each material in `getRemainingCosts(buildingId)`:
    - If `requestManager` has no pending/in-progress request for this building+material:
      - `requestManager.addRequest(buildingId, material, 1, RequestPriority.Normal)`
  - Requests are capped: max 2 pending requests per material per site (avoid flooding)

### Construction Inventory Config

Under-construction buildings get a temporary input-only inventory:

```ts
// In inventory-configs.ts, extend getInventoryConfig:
// If building is under construction (phase < Completed), return construction inventory
function getConstructionInventoryConfig(buildingType: BuildingType, race: Race): InventoryConfig {
    const costs = getConstructionCosts(buildingType, race);
    return {
        inputSlots: costs.map(c => ({ material: c.material, maxCapacity: c.amount })),
        outputSlots: [],
    };
}
```

When construction completes, the construction inventory is replaced by the normal production inventory (if any). The construction inventory should be empty by then (all materials consumed by builders).

## Events

### New Events

| Event | Payload | Emitter | Listeners |
|-------|---------|---------|-----------|
| `construction:diggingStarted` | `{ buildingId }` | ConstructionSiteManager | BuildingConstructionSystem (phase transition) |
| `construction:levelingComplete` | `{ buildingId }` | ConstructionSiteManager | BuildingConstructionSystem (phase transition), ConstructionRequestSystem (start requesting if not already) |
| `construction:buildingStarted` | `{ buildingId }` | ConstructionSiteManager | BuildingConstructionSystem (phase transition) |
| `construction:materialDelivered` | `{ buildingId, material }` | inventory deposit handler | ConstructionSiteManager (recordDelivery) |
| `construction:progressComplete` | `{ buildingId }` | ConstructionSiteManager | BuildingConstructionSystem (transition to CompletedRising) |

### Modified Events

- `building:placed` — unchanged, still emitted on placement
- `building:completed` — unchanged, still emitted when reaching Completed phase
- `terrain:modified` — now emitted by digger work (each leveling step) instead of automatic per-frame

## Error Handling & Boundaries

| Layer | On error... | Behavior |
|-------|------------|----------|
| ConstructionSiteManager | Site not found | `getEntityOrThrow` pattern — throw with context |
| Digger/Builder handlers | No site found | Return undefined from findTarget, settler stays idle |
| Digger/Builder handlers | Site removed mid-work | Release slot gracefully, return to idle |
| ConstructionRequestSystem | No costs for building | Skip silently (some buildings may have zero cost) |
| Construction inventory | Deposit exceeds capacity | Reject deposit (carrier reroutes — existing logistics behavior) |
| Phase transitions | Out-of-order | Ignore — phases only advance forward |

## Subsystem Details

### 1. Construction Site Manager

**Files**: `src/game/features/building-construction/construction-site-manager.ts`
**Owns**: construction site registry, digger/builder slot tracking, progress state, material tracking
**Depends on**: `getConstructionCosts`, `getBuildingSize`

**Key decisions**:
- Separate from `BuildingStateManager` — construction sites are transient (only exist during construction), building states persist. The manager bridges them by updating `BuildingState.phase` and `BuildingState.phaseProgress` as diggers/builders work.
- Digger count from `getBuildingSize` not footprint tile count — the XML footprint bitmask includes exclusion zones (30–200+ tiles) which would yield absurd digger counts. The 2×2/3×3 size is the meaningful metric.
- Progress is deterministic: leveling advances per-tile via `completeNextTile`, construction via `advanceConstruction`. Each work cycle completes exactly one tile. This keeps replay determinism.

**Behavior**:
- `registerSite` called from `executePlaceBuilding` (via event or direct call)
- `removeSite` called on `building:removed` event (building cancelled)
- When last tile leveled (via `completeNextTile`) or terrain already flat (via `populateUnleveledTiles`): sets `levelingComplete = true`, emits `construction:levelingComplete`
- When `constructionProgress >= 1.0`: emits `construction:progressComplete`
- `findSiteNeedingDiggers/Builders`: iterates all sites for the player, returns nearest by Euclidean distance with available slots. Sorted by entity ID for determinism when equidistant.

### 2. Phase Progression (Rewrite)

**Files**: `src/game/features/building-construction/construction-system.ts`, `internal/phase-transitions.ts`
**Owns**: phase state machine, terrain leveling application, completion emission
**Depends on**: ConstructionSiteManager, BuildingStateManager, terrain functions

**Key decisions**:
- Remove the elapsed-time-based phase progression entirely. Phases now advance based on events from ConstructionSiteManager.
- `CompletedRising` remains timed (0.5s) — it's a visual animation after all construction work is done.
- Terrain leveling still uses `applyTerrainLeveling(progress)` but `progress` comes from `constructionSite.levelingProgress` instead of a time fraction.

**Behavior**:
- `tick(dt)`: only handles `CompletedRising` countdown and `terrain:modified` emission during active leveling
- Phase transitions driven by events:
  - `construction:diggingStarted` → set phase to `TerrainLeveling`
  - `construction:levelingComplete` → set phase to `WaitingForBuilders`, finalize terrain
  - `construction:buildingStarted` → set phase to `ConstructionRising`
  - `construction:progressComplete` → set phase to `CompletedRising`, start 0.5s timer
  - Timer expires → set phase to `Completed`, emit `building:completed`
- `phaseProgress` for `TerrainLeveling` = `site.levelingProgress`
- `phaseProgress` for `ConstructionRising` = `site.constructionProgress`
- On `building:removed`: restore terrain (unchanged from current)

**Compatibility**: `settings.placeBuildingsCompleted` (instant-complete mode) still works — bypasses all phases, no diggers/builders needed.

### 3. Digger Work Handler

**Files**: `src/game/features/settler-tasks/work-handlers.ts` (add `createDiggerHandler`)
**Owns**: digger job assignment, terrain leveling work choreography
**Depends on**: ConstructionSiteManager, SettlerTaskSystem

**Key decisions**:
- New `SearchType.CONSTRUCTION_DIG` instead of reusing `CONSTRUCTION` — diggers and builders have different search logic.
- Job is built programmatically (like barracks training), not from XML choreo — the original game's digger XML choreo is a simple shovel animation loop.
- Diggers are released when leveling completes (even mid-animation) — they return to idle and can be reassigned.

**Behavior**:
- `findTarget()`: calls `constructionSiteManager.findSiteNeedingDiggers(x, y, player)`
- Returns building entity ID as target
- Job nodes: `GO_TO_TARGET` → (`WORK` × N cycles)
- Each WORK completion calls `constructionSiteManager.completeNextTile(buildingId)` which emits `construction:tileCompleted` to apply the individual tile's terrain change
- When `levelingComplete`: current work node finishes, then digger is released
- If building removed mid-work: digger released on `building:removed` cleanup

### 4. Builder Work Handler

**Files**: `src/game/features/settler-tasks/work-handlers.ts` (add `createBuilderHandler`)
**Owns**: builder job assignment, construction work choreography
**Depends on**: ConstructionSiteManager, BuildingInventoryManager

**Key decisions**:
- Builders check `hasAvailableMaterials` before each work cycle, not just on initial assignment. If materials run out mid-job, the builder finishes the current animation then goes idle.
- Material consumption happens at work cycle completion, not start — the builder "uses up" material as they integrate it into the building.
- Builders re-search for sites each time they go idle — they may pick a different site if the original has no more materials but another site does.

**Behavior**:
- `findTarget()`: calls `constructionSiteManager.findSiteNeedingBuilders(x, y, player)` — only returns sites where `levelingComplete && hasAvailableMaterials && builderSlotAvailable`
- Job nodes: `GO_TO_TARGET` → (`WORK` × N cycles, with material check between each)
- Each WORK completion: withdraw 1 material from inventory, call `advanceConstruction`
- If no materials available after a cycle: release slot, go idle
- When `constructionProgress >= 1.0`: release slot, done
- If building removed: released on cleanup

### 5. Construction Material Requests

**Files**: `src/game/features/building-construction/construction-request-system.ts`
**Owns**: creating logistics requests for construction materials
**Depends on**: ConstructionSiteManager, RequestManager

**Key decisions**:
- Requests start immediately on building placement (not after leveling) — carriers can deliver materials while diggers level. This matches the original game where you see carriers arriving at construction sites before leveling finishes.
- Max 2 pending requests per material per site prevents flooding the logistics system.
- Uses existing `RequestManager` and `LogisticsDispatcher` — no new delivery infrastructure needed.

**Behavior**:
- Ticks every 0.5s (accumulator pattern)
- For each active site: check each cost material
  - Count pending+in-progress requests for this building+material
  - If count < 2 and `deliveredAmount < requiredAmount` for that material: `requestManager.addRequest(...)`
- On `building:removed`: `requestManager.cancelRequestsForBuilding(buildingId)` (already handled by existing cleanup)

### 6. Construction Inventory

**Files**: `src/game/features/inventory/inventory-configs.ts`
**Owns**: inventory config for under-construction buildings
**Depends on**: `getConstructionCosts`

**Key decisions**:
- Construction inventory is created when the building is placed (not when construction starts) so carriers can deliver early.
- `maxCapacity` per slot = the exact cost amount for that material. No excess storage.
- When building reaches `Completed`: destroy construction inventory, create normal production inventory. If the building has no production (e.g., residence), just destroy.
- Track material delivery by hooking into inventory deposit — when a carrier deposits into a construction building's inventory, `constructionSiteManager.recordDelivery(...)` is called.

**Behavior**:
- `getInventoryConfig` checks if building is under construction (via `buildingStateManager.getBuildingState`)
  - Under construction: return `getConstructionInventoryConfig(buildingType, race)`
  - Completed: return normal production config (existing behavior)
- Alternative simpler approach: always create construction inventory at placement. On completion, `inventoryManager.destroyInventory(buildingId)` then `inventoryManager.createInventory(buildingId, buildingType)` with normal config.

### 7. Events & Wiring

**Files**: `src/game/event-bus.ts`, `src/game/game-services.ts`, `src/game/features/building-construction/index.ts`
**Owns**: event definitions, system registration, handler wiring

**Wiring in game-services.ts**:
1. Create `ConstructionSiteManager` after `BuildingStateManager`
2. Create `ConstructionRequestSystem` after `RequestManager` is available
3. Register `SearchType.CONSTRUCTION_DIG` handler with `createDiggerHandler`
4. Register `SearchType.CONSTRUCTION` handler with `createBuilderHandler`
5. Add `ConstructionRequestSystem` to tick systems
6. Wire events: `building:placed` → `constructionSiteManager.registerSite(...)`, construction events → `BuildingConstructionSystem` phase transitions
7. On `building:completed`: destroy construction inventory, create production inventory

**New SearchType**: Add `CONSTRUCTION_DIG = 'CONSTRUCTION_DIG'` to `SearchType` enum.

**settler-data-access.ts**: Map `UnitType.Digger` → `SearchType.CONSTRUCTION_DIG` (add alongside existing `BUILDER_ROLE` → `CONSTRUCTION` mapping).

## File Map

### New Files

| File | Subsystem | Purpose |
|------|-----------|---------|
| `src/game/features/building-construction/construction-site-manager.ts` | 1 | Construction site registry and progress tracking |
| `src/game/features/building-construction/construction-request-system.ts` | 5 | Material request creation for construction sites |

### Modified Files

| File | Change |
|------|--------|
| `src/game/features/building-construction/types.ts` | Update `BuildingConstructionPhase` enum (add `WaitingForDiggers`, `WaitingForBuilders`), add `ConstructionSite` interface |
| `src/game/features/building-construction/construction-system.ts` | Replace time-based progression with event-driven phases, keep `CompletedRising` timer and terrain application |
| `src/game/features/building-construction/internal/phase-transitions.ts` | Remove `PHASE_DURATIONS` fraction table, replace with event-driven transition logic |
| `src/game/features/building-construction/index.ts` | Export new types and `ConstructionSiteManager`, `ConstructionRequestSystem` |
| `src/game/features/building-construction/terrain.ts` | No changes — `applyTerrainLeveling(progress)` already accepts arbitrary progress values |
| `src/game/features/settler-tasks/work-handlers.ts` | Add `createDiggerHandler`, `createBuilderHandler` |
| `src/game/features/settler-tasks/types.ts` | Add `SearchType.CONSTRUCTION_DIG` |
| `src/game/features/inventory/inventory-configs.ts` | Add `getConstructionInventoryConfig()`, gate on construction state |
| `src/game/event-bus.ts` | Add construction events to `GameEvents` interface |
| `src/game/game-services.ts` | Wire `ConstructionSiteManager`, `ConstructionRequestSystem`, register digger+builder handlers, inventory swap on completion |
| `src/game/commands/command.ts` | In `executePlaceBuilding`: register construction site, create construction inventory |
| `src/game/game-data-access.ts` | Possibly add digger search type mapping (if not already via settler-data-access) |

## Open Questions

1. **Where do diggers and builders come from?** In the original game they spawn from residences like carriers. Current `ResidenceSpawnerSystem` only spawns carriers. **Decision**: Residences spawn a mix — e.g., `ResidenceSmall` spawns 1 Carrier + 1 Builder, `ResidenceMedium` spawns 2 Carriers + 1 Builder + 1 Digger, `ResidenceBig` spawns 3 Carriers + 2 Builders + 1 Digger. This can be tuned. Diggers and builders are idle when no construction is happening — they just wander.

2. **Should buildings with zero construction cost skip diggers/builders?** **Decision**: Yes. If `getConstructionCosts` returns empty, skip straight to `Completed` (used for special buildings if any).

3. **What about map-loaded buildings?** `populateMapBuildings` already sets phase to `Completed` directly — no change needed.

4. **Leveling work frames tuning?** The exact `LEVELING_WORK_FRAMES` and `BUILDING_WORK_FRAMES` values will need playtesting. Start with 50 frames (5s) per digger cycle and 40 frames (4s) per builder cycle.

## Out of Scope

- Tool requirements for builders/diggers (e.g., requiring a SHOVEL before a digger can work) — could be added later
- Priority system for construction sites (build nearest first vs player-chosen priority)
- Builder/digger idle wandering animations
- Visual construction progress sprites (building frame rising proportional to progress) — currently handled by `getBuildingVisualState` which reads `phaseProgress`, so it should work automatically
- Cancellation refund (returning delivered materials to storage when a building is cancelled)
