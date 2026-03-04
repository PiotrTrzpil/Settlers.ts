# Pile System — Full Migration Design

## Overview

The current pile system was designed for production building piles, with construction piles absent from
map-space and free piles defined only by the absence of `buildingId`. This migration replaces the entire
system with a model in which pile *kind* is a first-class discriminated union stored on each pile entity,
position resolution dispatches on kind, and the pile↔slot association is explicit rather than a
reconstructable secondary index. All three pile categories — building (production/storage), construction,
and free — become first-class citizens with full map representation. The old files
(`inventory-layout.ts`, `material-stack-state.ts`, `inventory-visualizer.ts`) are deleted entirely.

## Architecture

### Subsystem Diagram

```
BuildingInventoryManager
        │ onChange
        ▼
 InventoryPileSync ──── PileRegistry ──── PilePositionResolver
  (sync + lifecycle)   (explicit index)   (kind-dispatch)
        │                    │                   │
        │                    │         BuildingPileRegistry  ConstructionPilePositions
        │                    │          (XML production/       (door-adjacent
        │                    │           storage positions)     staging)
        ▼                    ▼
  spawn_pile /           StackedResourceManager
  update_pile_quantity    (query API + cap enforcement)
  (command system)
        │
  EntityType.StackedResource
  (entity with PileKind state)
```

Data flows in one direction: inventory change → sync → pile entity. Pile entities are authoritative for
their own kind; the PileRegistry is an inverted index derived from entity state. On HMR recovery,
rebuilding the index from entities is trivial because kind is explicit on every entity.

### Subsystems

| # | Subsystem | Responsibility | Files |
|---|-----------|---------------|-------|
| 1 | Pile Entity Model | `PileKind` discriminated union; `StackedResourceState`; `spawn_pile` command | `pile-kind.ts` (new), `entity.ts`, `command-types.ts`, `command.ts` |
| 2 | PilePositionResolver | Kind-dispatching position resolution; construction site-staged positions | `pile-position-resolver.ts` (new), `construction-pile-positions.ts` (new) |
| 3 | PileRegistry | Explicit named pile↔slot index; used-positions tracking; HMR rebuild | `pile-registry.ts` (new) |
| 4 | InventoryPileSync | Event-driven sync between `BuildingInventoryManager` and pile entities; building lifecycle | `inventory-pile-sync.ts` (new) |
| 5 | Building Lifecycle | Correct sequencing of pile clear on `building:completed`; renamed methods | `game-services.ts`, `inventory-feature.ts` |
| 6 | StackedResourceManager | Pile state using `PileKind`; `findNearestFree`; single quantity cap | `stacked-resource-manager.ts` |
| 7 | StorageArea Filter | `allowedMaterials` per-building config; `set_storage_filter` command; selection panel UI | `storage-filter-manager.ts` (new), `command-types.ts`, `command.ts`, `useStorageFilter.ts` (new), `selection-panel.vue` |

---

## Data Models

### PileKind

The discriminated union stored on every `StackedResourceState`. Replaces `buildingId?: number` entirely.

```typescript
// pile-kind.ts

export type PileKind =
    | { kind: 'output';       buildingId: number }   // building produces → carrier takes
    | { kind: 'input';        buildingId: number }   // carrier delivers → building consumes
    | { kind: 'construction'; buildingId: number }   // carrier delivers → builder consumes
    | { kind: 'storage';      buildingId: number }   // carrier ↔ carrier, pool-allocated
    | { kind: 'free' }                               // no owner, carrier takes freely

export type LinkedPileKind = Exclude<PileKind, { kind: 'free' }>
export type LinkedSlotKind = LinkedPileKind['kind']

export function isLinkedPile(kind: PileKind): kind is LinkedPileKind {
    return kind.kind !== 'free'
}

export function getOwnerBuildingId(kind: PileKind): number | undefined {
    return isLinkedPile(kind) ? kind.buildingId : undefined
}
```

### StackedResourceState (updated)

Replaces `buildingId?: number` with `kind: PileKind`. The quantity cap is enforced only here.

| Field | Type | Notes |
|-------|------|-------|
| `entityId` | `number` | Entity this state belongs to |
| `quantity` | `number` | 1–`MAX_RESOURCE_STACK_SIZE` (cap enforced by `StackedResourceManager.setQuantity` only) |
| `kind` | `PileKind` | What kind of pile this is — set at spawn time, may be updated to `free` on building destruction |

### PileSlotKey

The key used in PileRegistry to identify the exact slot a pile represents.

| Field | Type | Notes |
|-------|------|-------|
| `buildingId` | `number` | Owning building |
| `material` | `EMaterialType` | Material type |
| `slotKind` | `LinkedSlotKind` | `'output' \| 'input' \| 'construction' \| 'storage'` |

Serialized as `${buildingId}:${slotKind}:${material}` for use as a Map key.

### Commands (pile-related)

Three commands replace `spawn_visual_resource`:

**`spawn_pile`** — creates a new pile entity with kind embedded at creation time.

| Field | Type | Notes |
|-------|------|-------|
| `type` | `'spawn_pile'` | |
| `materialType` | `EMaterialType` | Material |
| `x` | `number` | Tile X |
| `y` | `number` | Tile Y |
| `player` | `number` | Owner player |
| `quantity` | `number` | Initial size (raw; manager enforces cap) |
| `kind` | `PileKind` | Required; embedded at spawn, never set post-hoc |

**`update_pile_quantity`** — updates quantity of an existing pile entity. Used by `InventoryPileSync` on every
inventory change where the pile already exists. Separate from `spawn_pile` to avoid the overhead of entity
recreation on every increment.

| Field | Type | Notes |
|-------|------|-------|
| `type` | `'update_pile_quantity'` | |
| `entityId` | `number` | Pile entity to update |
| `quantity` | `number` | New quantity (raw; manager enforces cap) |

**`set_storage_filter`** — toggles a material in/out of a StorageArea's allowed set.

| Field | Type | Notes |
|-------|------|-------|
| `type` | `'set_storage_filter'` | |
| `buildingId` | `number` | Target StorageArea |
| `material` | `EMaterialType` | |
| `allowed` | `boolean` | true = add to allowed set, false = remove |

`spawn_visual_resource` is deleted. No other callers exist outside the files being deleted.

---

## API Contracts

### PilePositionResolver

```typescript
class PilePositionResolver {
    constructor(gameState: GameState, pileRegistry: BuildingPileRegistry)

    resolvePosition(params: {
        buildingId:   number
        building:     Entity
        material:     EMaterialType
        slotKind:     LinkedSlotKind
        usedPositions: ReadonlySet<string>  // TileKey set from PileRegistry
    }): TileCoord | null

    // Returns the ordered list of candidate staging tiles for construction piles.
    // Called internally; exposed for tests.
    getConstructionCandidates(building: Entity): TileCoord[]
}
```

**Dispatch rules:**

| `slotKind` | Position source | On no position |
|-----------|----------------|----------------|
| `'output'` | `BuildingPileRegistry.getPilePositionForSlot(bt, race, 'output', material, x, y)` | Throw — XML must define all output positions |
| `'input'` | `BuildingPileRegistry.getPilePositionForSlot(bt, race, 'input', material, x, y)` | Throw — XML must define all input positions |
| `'construction'` | `ConstructionPilePositions.getPosition(building, usedPositions, gameState)` | Null (warn) if all adjacent tiles occupied by StackedResources |
| `'storage'` | `BuildingPileRegistry.getStoragePileWorldPositions(bt, race, x, y)` → first not in `usedPositions` | Throw — inventory constraint guarantees a free position always exists |

`usedPositions` is the `Set<TileKey>` maintained by `PileRegistry` for the building — not recomputed by scanning game state at call time.

### ConstructionPilePositions

```typescript
// construction-pile-positions.ts

function getConstructionCandidates(building: Entity, gameData: GameData): TileCoord[]
// Returns ordered list of tiles adjacent to the building door (from getBuildingDoorPos),
// sorted by Manhattan distance from door. Length = number of distinct construction material types
// for that building type + race (from getConstructionCosts). Maximum 8 candidates.

function getConstructionPilePosition(
    building: Entity,
    material: EMaterialType,
    usedPositions: ReadonlySet<string>,
    gameState: GameState,
    gameData: GameData
): TileCoord | null
// Returns the first candidate tile not in usedPositions and not occupied by a StackedResource entity.
// Filters occupancy by EntityType.StackedResource only — not getEntityAt (any entity).
```

### PileRegistry

```typescript
class PileRegistry {
    constructor()

    // Registration — called when a linked pile entity is spawned
    register(entityId: number, key: PileSlotKey, position: TileCoord): void
    // Throws if key already registered (double-spawn bug)

    deregister(entityId: number): void
    // Removes entry; updates usedPositions

    // Lookup
    getEntityId(key: PileSlotKey): number | undefined
    getKey(entityId: number): PileSlotKey | undefined
    getLinkedEntities(buildingId: number): ReadonlyMap<string, number>  // serializedKey → entityId
    getUsedPositions(buildingId: number): ReadonlySet<string>           // TileKey set

    // Lifecycle — returns cleared entries (caller handles entity removal or conversion)
    clearBuilding(buildingId: number): ReadonlyMap<string, number>
    // Does NOT touch entities. Caller decides: remove them (completion) or convert to free (destruction).

    // HMR rebuild — reads kind from StackedResourceState, no inference from inventory
    rebuildFromEntities(entities: readonly Entity[], resources: StackedResourceManager): void

    clear(): void
}
```

**No `BuildingVisualState` wrapper.** The two maps (`key → entityId`, `entityId → key`) plus a
per-building `usedPositions` set are the complete state.

### InventoryPileSync

```typescript
class InventoryPileSync {
    constructor(
        gameState: GameState,
        inventoryManager: BuildingInventoryManager,
        constructionSiteManager: ConstructionSiteManager,
        pileRegistry: PileRegistry,
        pilePositionResolver: PilePositionResolver,
        executeCommand: (cmd: Command) => CommandResult
    )

    registerEvents(eventBus: EventBus, cleanupRegistry: EntityCleanupRegistry): void
    unregisterEvents(): void
    dispose(): void

    // Called only for HMR recovery
    rebuildFromExistingEntities(): void
}
```

Internal event handlers:

| Event | Handler |
|-------|---------|
| `BuildingInventoryManager.onChange` | `onInventoryChange` — update or spawn/remove pile entities |
| `building:completed` | `onBuildingCompleted` — clear construction piles before inventory swap |
| `entity:removed` (cleanup registry) | `onBuildingRemoved` — convert linked piles to free |

### StackedResourceManager (updated public API)

```typescript
class StackedResourceManager {
    // State lifecycle
    createState(entityId: number, kind: PileKind): void   // kind required at creation
    removeState(entityId: number): void

    // Kind access
    setKind(entityId: number, kind: PileKind): void
    getKind(entityId: number): PileKind                   // throws if entity unknown
    isLinked(entityId: number): boolean                   // kind !== 'free'
    getOwnerBuildingId(entityId: number): number | undefined

    // Quantity — cap enforced HERE only
    setQuantity(entityId: number, quantity: number): void
    getQuantity(entityId: number): number

    // Queries
    findNearestFree(x: number, y: number, material: EMaterialType, radius: number): Entity | undefined
    // Scans only entities where kind.kind === 'free'
}
```

`setBuildingId`, `getBuildingId`, `findNearestResource` are deleted. All callers updated.

### StorageArea Inventory Model

StorageArea uses **dynamic slots**: N slots where N = number of XML pile positions (8 for all races).
Each slot has no pre-assigned material type. Assignment happens at first deposit:

```typescript
interface StorageSlot {
    material: EMaterialType | null  // null = free slot
    currentAmount: number
    maxCapacity: number             // MAX_RESOURCE_STACK_SIZE = 8
}
```

- `BuildingInventoryManager.depositOutput(buildingId, material, amount)` for a StorageArea:
  1. Find a slot where `slot.material === material` → deposit there (add to `currentAmount`).
  2. If none, find the first slot where `slot.material === null` → assign `slot.material = material`, set `currentAmount = amount`.
  3. If all 8 slots are occupied by other materials → return 0 (rejected). The logistics layer already checked `isAllowed` and available capacity before routing, so this should not happen in normal play.
- `withdrawOutput` for a StorageArea: find slot by material, decrement. When `currentAmount` reaches 0, set `slot.material = null` (slot freed for next material).
- `canAcceptInput`/`getInputSpace` are not used for StorageArea (it is output-only from inventory perspective — carriers deposit output, carriers withdraw output). These methods throw if called on StorageArea.
- `reserveOutput`/`withdrawReservedOutput` work normally by scanning for slot with matching material.
- `inventory-configs.ts`: StorageArea config uses `buildNDynamicStorageSlots(n: number)` instead of
  listing all `DROPPABLE_MATERIALS`. `n` comes from `BuildingPileRegistry.getStoragePilePositions(bt, race).length`.
- This guarantees: active material types ≤ 8 ≤ pile positions. Storage overflow is impossible by construction.

**Player-configurable material filter (required for UI)**: each StorageArea has a per-building
`allowedMaterials: Set<EMaterialType>` (persisted). Default on construction: empty set — the warehouse
accepts nothing until the player configures it. Deposit logic checks `allowedMaterials` before the
slot scan. The logistics system also checks this set before routing a carrier to a StorageArea.
`allowedMaterials` is stored separately from the inventory slots (it is configuration, not inventory
state) and persisted alongside the building entity. The UI feature sets this configuration; this
migration only needs the data field and the deposit check — the UI panel itself is out of scope.

### BuildingInventoryManager (targeted changes)

```typescript
// New method — replaces the explicit remove+create pair in onBuildingCompleted
swapInventoryPhase(buildingId: number, buildingType: BuildingType): void
// Internally: destroyBuildingInventory(buildingId) + createInventory(buildingId, buildingType)
// Emits no change event — InventoryPileSync handles clearing piles before this is called

// Rename only (same logic)
destroyBuildingInventory(buildingId: number): boolean
// Was: removeInventory. Called ONLY by cleanup registry LATE handler on entity removal.
// Never called during building:completed — use swapInventoryPhase instead.
```

---

## Error Handling & Boundaries

| Layer | On error | Behavior |
|-------|----------|----------|
| `PilePositionResolver` — output/input | XML position missing | Throw with building type and material context |
| `PilePositionResolver` — construction | All adjacent tiles occupied by StackedResources | Return null; log warning with buildingId |
| `PilePositionResolver` — storage | All pool positions full | Throw — should be impossible; inventory cap prevents it |
| `PileRegistry.register` | Key already registered | Throw — indicates double-spawn bug |
| `PileRegistry.clearBuilding` | Unknown buildingId | No-op (building had no linked piles) |
| `InventoryPileSync.onInventoryChange` | Pile entity expected but not found in registry | Log warning; re-spawn pile if quantity > 0 |
| `StackedResourceManager.getKind` | Unknown entityId | Throw with entity ID context |
| `spawn_pile` command handler | Position out of bounds | Throw `CommandError` with position context |
| `buildingCompleted` sequencing | Called before pile clear | Structural impossibility — pile clear is the first step in the handler |

Construction position full (null from resolver) is the only expected null result — only possible if all
door-adjacent tiles are simultaneously occupied by StackedResources. All other nulls indicate missing data
and should throw.

---

## Type Contracts

- `PileKind` variants are exact discriminated unions. `buildingId` on linked variants is always `number`,
  never optional.
- `StackedResourceState.quantity` is always `1 ≤ quantity ≤ MAX_RESOURCE_STACK_SIZE`. Cap enforced only
  in `StackedResourceManager.setQuantity`. `InventoryPileSync` sends raw amounts and trusts the manager.
- `PileRegistry` uses `TileKey` (`${x},${y}`) strings. This matches the existing `tileKey()` helper.
- Map-loaded stacks (`map-stacks.ts`) are always `kind: { kind: 'free' }` — they have no building owner.
- Construction piles are `kind: { kind: 'construction', buildingId }`. They are NOT `input` piles.
  The distinction: consumers differ (builder worker vs. production system) and position authority
  differs (door-adjacent staging vs. XML fixed position).

---

## Subsystem Details

### Subsystem 1: Pile Entity Model

**Files**: `src/game/features/inventory/pile-kind.ts` (new), `src/game/entity.ts`, `src/game/commands/command-types.ts`, `src/game/commands/command.ts`

**Owns**: `PileKind` type, `StackedResourceState`, `spawn_pile` command handler.

**Key decisions**:
- `spawn_visual_resource` is deleted. The new command is `spawn_pile` with `kind: PileKind` required.
  No backward compat type alias.
- `update_pile_quantity` handler: calls `state.resources.setQuantity(cmd.entityId, cmd.quantity)`.
  Quantity 0 is not valid — `InventoryPileSync` issues `remove_entity` instead when quantity reaches 0.
- `set_storage_filter` handler: delegates to `StorageFilterManager.setAllowed(buildingId, material, allowed)`.
- `StackedResourceState.buildingId?: number` is removed. `kind: PileKind` is added (required field).
  All reads of `state.buildingId` become `getOwnerBuildingId(state.kind)`.
- `spawn_pile` handler: calls `state.resources.createState(entityId, cmd.kind)` — kind embedded at
  creation, no separate `setBuildingId` call anywhere.
- `map-stacks.ts`: all map-loaded stacks use `kind: { kind: 'free' }`.

---

### Subsystem 2: PilePositionResolver

**Files**: `src/game/features/inventory/pile-position-resolver.ts` (new),
`src/game/features/inventory/construction-pile-positions.ts` (new)

**Owns**: All position resolution logic for pile placement. Replaces `InventoryLayout` entirely.

**Key decisions**:
- `InventoryLayout` is deleted. `PilePositionResolver` is a class with a single `resolvePosition(params)`
  entry point that dispatches on `slotKind`.
- Construction candidates: ordered list of tiles adjacent to `getBuildingDoorPos(building)`, sorted by
  Manhattan distance ascending. Count = number of distinct material types in `getConstructionCosts(bt, race)`,
  capped at 8. These positions are computed from the game door API — not from XML.
- Storage occupancy check: filters to `EntityType.StackedResource` entities at candidate positions only.
  Uses `gameState.getEntityByType(pos, EntityType.StackedResource)` or equivalent — NOT `getEntityAt`
  (which returns any entity type and incorrectly blocks positions when carriers walk through).
- `usedPositions` is passed in from `PileRegistry.getUsedPositions(buildingId)` — the resolver does not
  query registry or game state for it. This is the single source of truth for which positions are taken.
- Output and input positions that are missing from XML throw — they indicate a content data gap, not a
  runtime condition.

**Behavior**:
- For `'construction'`: if multiple materials need positions, each gets a distinct candidate tile from
  the ordered list. Materials do NOT share tiles. If the list is exhausted (occupied by StackedResources),
  the resolver returns null and logs a warning.
- For `'storage'`: iterates the XML pool positions in order. Returns the first tile not in `usedPositions`
  and not occupied by a StackedResource. Returns null with warning when all are occupied.

---

### Subsystem 3: PileRegistry

**Files**: `src/game/features/inventory/pile-registry.ts` (new)

**Owns**: Explicit pile↔slot index. Replaces `MaterialStackState` entirely.

**Key decisions**:
- `MaterialStackState` is deleted. `PileRegistry` stores two flat maps:
  - `forward: Map<string, number>` — serialized `PileSlotKey` → `entityId`
  - `reverse: Map<number, string>` — `entityId` → serialized key
  - `positions: Map<number, Set<string>>` — `buildingId` → `Set<TileKey>` (for resolver)
- No `BuildingVisualState` wrapper. All access is flat and O(1).
- `register` throws on duplicate key. This catches bugs where a pile is spawned twice for the same slot.
- `clearBuilding` returns the map of `serializedKey → entityId` and removes all entries. Does NOT touch
  entities — the caller (InventoryPileSync) decides whether to remove entities or convert them to free.
- `rebuildFromEntities`: reads `kind` from `StackedResourceManager.getKind(entity.id)` for every
  StackedResource entity. No inference from inventory slots. This is correct and fast because kind is
  authoritative on the entity.

---

### Subsystem 4: InventoryPileSync

**Files**: `src/game/features/inventory/inventory-pile-sync.ts` (new)

**Owns**: Event-driven synchronization between `BuildingInventoryManager` and pile entities. Building
lifecycle handlers. Replaces `InventoryVisualizer` entirely.

**Key decisions**:
- Renamed from `InventoryVisualizer` to `InventoryPileSync` to reflect that it synchronizes data, not
  renders anything.
- **`onInventoryChange`**: determines `slotKind` by checking:
  - If `constructionSiteManager.isUnderConstruction(buildingId)` → `'construction'`
  - Else if `slotType === 'output'` → `'output'`
  - Else if building is `StorageArea` → `'storage'`
  - Else → `'input'`

  Then: look up entity in PileRegistry. If found and `quantity > 0`, issue `update_pile_quantity` command
  (updates quantity only — no position change, no entity recreation). If found and `quantity === 0`, issue
  `remove_entity` command + deregister. If not found and `quantity > 0`, resolve position, spawn pile,
  register. If not found and `quantity === 0`, no-op.

- **`onBuildingCompleted`** (subscribes to `building:completed` event directly, before `game-services.ts`
  calls `swapInventoryPhase`):
  1. `PileRegistry.clearBuilding(entityId)` → get all construction pile entries
  2. For each entry: issue `remove_entity` command for the pile entity
  3. Return — `game-services.ts` then calls `swapInventoryPhase` (sees no existing piles, starts clean)

- **`onBuildingRemoved`** (cleanup registry handler, STANDARD priority — before LATE inventory removal):
  1. `PileRegistry.clearBuilding(entityId)` → get all linked pile entries
  2. For each entry: call `StackedResourceManager.setKind(entityId, { kind: 'free' })` — pile persists
     on map as a free pile accessible to carriers
  3. No entity removal — piles survive building destruction

- No quantity cap in this class. Sends raw `newAmount` to command / state update. `StackedResourceManager`
  enforces cap.
- `rebuildFromExistingEntities`: delegates entirely to `PileRegistry.rebuildFromEntities`. No entity
  scanning logic here.

**Sequencing with game-services.ts** (building:completed):

```
[event: building:completed]
        │
        ├─▶ InventoryPileSync.onBuildingCompleted
        │       clearBuilding → remove construction pile entities
        │
        └─▶ GameServices.onBuildingCompleted
                swapInventoryPhase(buildingId, buildingType)
                    │
                    ├─ destroyBuildingInventory (internal)
                    └─ createInventory (production config)
```

The ordering is guaranteed by subscription registration order in `InventoryFeature.register()`.
`InventoryPileSync` must subscribe to `building:completed` before `GameServices`.

---

### Subsystem 5: Building Lifecycle Wiring

**Files**: `src/game/game-services.ts`, `src/game/features/inventory/inventory-feature.ts`

**Owns**: Correct sequencing of pile clearing and inventory swapping. Correct method naming.

**Key decisions**:
- `BuildingInventoryManager.removeInventory` is renamed `destroyBuildingInventory`. It is called **only**
  by the cleanup registry LATE handler. Never called directly in `onBuildingCompleted`.
- `BuildingInventoryManager.swapInventoryPhase(buildingId, buildingType)` is a new method that does
  `destroyBuildingInventory + createInventory` atomically. Called only from `onBuildingCompleted`.
- The double-call issue (Issue #6) is resolved structurally: `swapInventoryPhase` ≠ `destroyBuildingInventory`.
  They are different code paths, different method names. No second call ever reaches `destroyBuildingInventory`
  for a building that completed (because the cleanup registry only fires when the entity is removed, not
  when it transitions phase).
- `InventoryFeature.register()` subscribes `InventoryPileSync` to `building:completed` first, then
  `GameServices` second. This ensures pile cleanup precedes inventory swap.
- `InventoryPileSync.onBuildingRemoved` is registered in cleanup registry at STANDARD priority.
  `destroyBuildingInventory` continues to run at LATE priority. This ordering ensures piles are freed
  before inventory data disappears.

---

### Subsystem 7: StorageArea Filter

**Files**: `src/game/features/inventory/storage-filter-manager.ts` (new),
`src/game/commands/command-types.ts`, `src/game/commands/command.ts`,
`src/composables/useStorageFilter.ts` (new), `src/components/selection-panel.vue`

**Owns**: Per-building `allowedMaterials` configuration; command to set it; selection panel section.

**Key decisions**:
- `StorageFilterManager` stores `Map<buildingId, Set<EMaterialType>>`. Default on building placed:
  empty set — the warehouse accepts nothing until configured. This is intentional: the player must
  explicitly decide what each warehouse holds.
- `set_storage_filter` command: `{ type: 'set_storage_filter', buildingId: number, material: EMaterialType, allowed: boolean }`. Toggles a single material in/out of the allowed set. Entire set replace is not needed from UI; toggling one at a time is sufficient.
- The `isAllowed` check lives **only in logistics routing** — wherever the carrier dispatcher selects a destination StorageArea, it calls `storageFilterManager.isAllowed(buildingId, material)` before choosing that building. If no StorageArea accepts a material, it stays at source. `BuildingInventoryManager.depositOutput` does NOT check this — trust the contract that the logistics layer only routes to allowed buildings (optimistic programming pattern).
- Persistence: `allowedMaterials` per building is saved as `Array<EMaterialType>` alongside the building entity, identical pattern to other per-building config.

**Selection panel section** (shown only when selected building is StorageArea, not under construction):

```
┌─ Storage ──────────────────┐
│ LOG    [✓]  BOARD   [✓]   │
│ GRAIN  [ ]  COAL    [✓]   │
│ ...                        │
└────────────────────────────┘
```

- Section label "Storage" at the same level as "Production"
- Two-column grid of all `DROPPABLE_MATERIALS` with toggle checkboxes
- Checked = allowed, unchecked = not accepted
- Each toggle calls `game.execute({ type: 'set_storage_filter', buildingId, material, allowed: !current })`

**Composable `useStorageFilter`**:
```typescript
function useStorageFilter(game: Ref<Game | null>, entity: Ref<Entity | null>, tick: Ref<number>): {
    isStorageArea: ComputedRef<boolean>
    storageFilter: ComputedRef<{ material: EMaterialType; name: string; allowed: boolean }[]>
    toggleMaterial: (material: EMaterialType) => void
}
```
- `isStorageArea`: `entity.subType === BuildingType.StorageArea && !isUnderConstruction`
- `storageFilter`: all `DROPPABLE_MATERIALS` mapped to `{ material, name, allowed }`, re-evaluated on `tick`
- `toggleMaterial`: issues `set_storage_filter` command

---

### Subsystem 6: StackedResourceManager

**Files**: `src/game/stacked-resource-manager.ts`

**Owns**: Pile entity state storage, query APIs for logistics systems.

**Key decisions**:
- `createState(entityId, kind)` — `kind` is required. No default kind.
- `setKind` / `getKind` replace `setBuildingId` / `getBuildingId`. `getKind` throws if entity unknown
  (use `getEntityOrThrow` pattern internally).
- `findNearestFree` replaces `findNearestResource`. Filters: `kind.kind === 'free'`. The old boolean
  check `state.buildingId !== undefined` is removed.
- Quantity cap: `Math.min(quantity, MAX_RESOURCE_STACK_SIZE)` in `setQuantity` only. The duplicate
  cap in `InventoryVisualizer` (now deleted) is gone.
- `states` map type changes from `Map<number, StackedResourceState>` to match the new `StackedResourceState`
  shape (with `kind`).

---

## File Map

### New Files

| File | Subsystem | Purpose |
|------|-----------|---------|
| `src/game/features/inventory/pile-kind.ts` | 1 | `PileKind` union type, `isLinkedPile`, `getOwnerBuildingId` |
| `src/game/features/inventory/pile-position-resolver.ts` | 2 | Position resolution dispatching on `slotKind` |
| `src/game/features/inventory/construction-pile-positions.ts` | 2 | Door-adjacent staging position computation |
| `src/game/features/inventory/pile-registry.ts` | 3 | Explicit pile↔slot index |
| `src/game/features/inventory/inventory-pile-sync.ts` | 4 | Event-driven inventory↔pile synchronization |
| `src/game/features/inventory/storage-filter-manager.ts` | 7 | Per-building `allowedMaterials` set; `isAllowed` query |
| `src/composables/useStorageFilter.ts` | 7 | Vue composable for storage filter read/write in selection panel |
| `tests/unit/integration/pile-system.spec.ts` | — | Full pile system test suite (replaces `inventory-visualizer.spec.ts`) |

### Modified Files

| File | Change |
|------|--------|
| `src/game/entity.ts` | `StackedResourceState`: add `kind: PileKind`, remove `buildingId?` |
| `src/game/commands/command-types.ts` | Add `spawn_pile`, `update_pile_quantity`, `set_storage_filter`; delete `spawn_visual_resource` |
| `src/game/commands/command.ts` | Add handlers for `spawn_pile`, `update_pile_quantity`, `set_storage_filter`; delete `executeSpawnVisualResource` |
| `src/game/stacked-resource-manager.ts` | Use `PileKind`; add `findNearestFree`; remove `setBuildingId`/`getBuildingId`; single cap |
| `src/game/features/inventory/building-inventory.ts` | Add `swapInventoryPhase`; rename `removeInventory` → `destroyBuildingInventory`; dynamic storage slot logic in `depositOutput`/`withdrawOutput` |
| `src/game/features/inventory/inventory-configs.ts` | Replace StorageArea config (30+ material slots) with `buildNDynamicStorageSlots(n)` |
| `src/game/game-services.ts` | `onBuildingCompleted` uses `swapInventoryPhase`; no `removeInventory` call |
| `src/game/features/inventory/inventory-feature.ts` | Wire `PileRegistry`, `PilePositionResolver`, `InventoryPileSync`, `StorageFilterManager`; subscribe order |
| `src/game/systems/map-stacks.ts` | Use `spawn_pile` with `kind: { kind: 'free' }` |
| `src/components/selection-panel.vue` | Add storage filter section; wire `useStorageFilter` composable |
| Carrier logistics routing (file TBD by audit) | Add `storageFilterManager.isAllowed(buildingId, material)` before selecting a StorageArea destination |

### Deleted Files

| File | Reason |
|------|--------|
| `src/game/features/inventory/inventory-layout.ts` | Replaced by `PilePositionResolver` |
| `src/game/features/inventory/material-stack-state.ts` | Replaced by `PileRegistry` |
| `src/game/features/inventory/inventory-visualizer.ts` | Replaced by `InventoryPileSync` |
| `tests/unit/buildings/inventory-visualizer.spec.ts` | Tests for deleted visualizer — replace with tests for `InventoryPileSync` and `PileRegistry` |

---

## Persistence

Pile persistence is a natural consequence of the design — `kind` is explicit on every entity, so no
inference is needed on load.

**Save**: for every `EntityType.StackedResource` entity, serialize:
- Entity fields: `id`, `x`, `y`, `player`, `subType` (material)
- State fields: `quantity`, `kind` (full `PileKind` object including `buildingId` for linked variants)

**Load**:
1. Restore entities and their `StackedResourceState` directly from the saved data
2. Call `PileRegistry.rebuildFromEntities(entities, resources)` — this is the same path used for HMR
   recovery and requires no special-casing

Nothing else is needed. The registry is a derived index; it is never serialized. The entity state is the
source of truth.

**StorageArea `allowedMaterials` on save/load**: persisted per building as `Array<EMaterialType>`. On
load, `StorageFilterManager` restores the set before logistics runs. Default (new building, no save data):
empty set — nothing accepted.

**Linked pile integrity on load**: when a linked pile is restored (e.g. `kind: { kind: 'output', buildingId: 42 }`),
the building with id 42 must also be restored and its inventory must match the pile quantity. Save/load
must serialize buildings and their inventories in the same snapshot as piles. If a building was destroyed
between save and load (corrupt save), the pile is demoted to `kind: 'free'` during `rebuildFromEntities`
when the buildingId is not found in the entity store.

---

## Test Coverage

Two new test files:

- `tests/unit/inventory/pile-registry.spec.ts` — pure unit tests for `PileRegistry` (no `Simulation`, no XML)
- `tests/unit/integration/pile-system.spec.ts` — integration tests using `createSimulation()` with real data, all wrapped in `describe.skipIf(!hasRealData)`

The existing `tests/unit/buildings/inventory-visualizer.spec.ts` is deleted alongside `InventoryVisualizer`.

Add to file map — **New Files**:
- `tests/unit/inventory/pile-registry.spec.ts` — PileRegistry unit tests
- `tests/unit/integration/pile-system.spec.ts` — pile system integration tests

---

### `pile-registry.spec.ts` — PileRegistry (no game data)

Direct instantiation of `PileRegistry`, no `Simulation`. File: `tests/unit/inventory/pile-registry.spec.ts`.

| Test | Assertion |
|------|-----------|
| `register` + `getEntityId` returns entity | O(1) lookup |
| `getKey(entityId)` returns key after register | reverse lookup |
| `register` with duplicate key throws | bug detection |
| `deregister` removes from forward map, reverse map, and `usedPositions` | full cleanup |
| `clearBuilding` returns all entries for that building; entries for other buildings survive | scope isolation |
| `getUsedPositions` reflects registered pile positions | position tracking |
| `rebuildFromEntities`: after `clear()`, scan entities → index fully restored | HMR/load recovery |
| `rebuildFromEntities` skips `kind: 'free'` entities | free pile exclusion |

---

### `pile-system.spec.ts` — integration tests (all groups below use `createSimulation()`, `describe.skipIf(!hasRealData)`)

---

### Group 1 — InventoryPileSync lifecycle

Uses `createSimulation()`. Position resolution requires XML — all pile spawn paths use real building data.

| Test | Assertion |
|------|-----------|
| Inventory quantity increases on existing pile → entity count unchanged | no duplicate spawn |
| Inventory quantity drops to 0 → pile entity removed | entity count |
| `building:completed` → all construction pile entities removed before inventory swap fires | entity count at event boundary |
| `building:removed` → pile entities survive; all converted to `kind: 'free'` | kind on each entity |

---

### Group 2 — Construction piles

| Test | Assertion |
|------|-----------|
| Place WoodcutterHut in construction phase; deposit LOG → `StackedResource` entity appears adjacent to building door | entity exists, `kind === 'construction'`, position near door |
| Deposit two distinct construction materials → two entities at distinct positions | no position overlap |
| Complete construction → all construction entities removed; no StackedResource with `kind === 'construction'` remains | entity count |
| Complete construction → when first output produced, output pile appears at XML-defined position | kind + position |

---

### Group 4 — Building destruction → free piles (real data)

| Test | Assertion |
|------|-----------|
| Complete building, inject output, destroy building → pile entity survives at same position with `kind === 'free'` | entity exists, kind |
| Free pile is found by `findNearestFree` | logistics query |

---

### Group 5 — StorageArea dynamic slots (real data, `describe.skipIf(!hasRealData)`)

| Test | Assertion |
|------|-----------|
| Deposit material into empty StorageArea → slot claimed, pile entity spawned | entity count = 1 |
| Deposit same material again → quantity increases; no new entity spawned | entity count = 1 |
| Deposit 8 distinct materials → 8 pile entities, 8 slots occupied | entity count = 8 |
| Deposit 9th material type (not in allowedMaterials) → rejected, entity count unchanged | entity count = 8 |
| Withdraw all of one material → slot freed; pile entity removed | entity count = 7 |
| Withdraw all → deposit new material type → slot reclaimed | entity count = 8 |
| `set_storage_filter` disallows a material currently in a slot → existing pile and inventory unchanged; new deposits rejected | inventory unchanged, next deposit rejected |

---

### Group 6 — Pile position integrity stress test (real data)

Place 3 buildings in construction phase + 3 completed operational buildings. Run until all construction
completes and each operational building has produced at least one output. Then assert globally: collect
`(x, y)` from all `EntityType.StackedResource` entities into a `Set<TileKey>` — assert
`set.size === entities.length`. One test, one assertion, catches position conflicts across all pile kinds
simultaneously.

---

### Group 7 — Save/load round-trip (real data, `describe.skipIf(!hasRealData)`)

| Test | Assertion |
|------|-----------|
| Create linked piles and free piles; serialize `StackedResourceState[]`; clear and restore; call `rebuildFromEntities` → all piles have correct `kind` | round-trip fidelity |
| Corrupt save: linked pile references unknown buildingId → pile demoted to `free` during rebuild | graceful demotion |

---

## Open Questions

- **Construction pile position when building footprint leaves no adjacent free tile**: rare in practice
  (construction sites are placed with clear space), but should the system queue the pile spawn for the
  next inventory:changed event (retry) or fail silently and log? Decision: retry on next change event
  (the position check runs fresh each time `quantity > 0` and no entity is registered).

- **Carrier logistics routing file**: the file that selects destination StorageAreas for carrier routing
  needs `storageFilterManager.isAllowed(buildingId, material)` added. Identified during implementation
  by searching for where `BuildingType.StorageArea` destination buildings are selected. It is not named
  here because it was not found during design-time audit — add it to the file map once identified.

---

## Out of Scope

- Map-defined resource deposits as free piles (pre-placed piles with no building owner that exist from
  game start). The `free` PileKind supports this, but map loading for these objects is not part of this
  migration. `map-stacks.ts` already creates free piles from map data; no new path is needed.
- StorageArea material configuration UI is included as Subsystem 7.
- AI scoring of pile origin (orphaned vs. fresh output).
