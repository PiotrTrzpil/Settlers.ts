# Unified Inventory Slots — Design

## Overview

Unify three divergent inventory patterns (normal buildings, construction sites, storage areas) by enforcing one rule: **every slot = one pile, max `SLOT_CAPACITY` (8) items**. Construction sites get multiple slots of the same material type (e.g., 12 logs → 2 LOG slots of capacity 8+4) instead of one oversized slot with visual splitting. The inventory manager becomes a dumb store — no building-type awareness, no dynamic assignment logic. StorageArea slot claiming/releasing is owned by the logistics layer. This eliminates `syncConstructionPiles()`, `isStorageArea()` special-casing, and duplicate delivery tracking in `ConstructionSiteManager`.

## Current State

- **Construction sites**: One input slot per material with `maxCapacity = totalCost` (can be >8). `InventoryPileSync.syncConstructionPiles()` splits this into multiple visual pile entities of 8 each. `ConstructionSiteManager` shadows inventory with its own `delivered`/`consumed` Maps. `BuildingLifecycleHandler` bridges `inventory:changed` → `recordDelivery()` to keep them in sync.
- **StorageArea**: Multiple output slots initialized as `NO_MATERIAL`, dynamically assigned on first deposit, freed when drained. `BuildingInventoryManager` has `isStorageArea()` checks in `depositOutput`, `withdrawOutput`, `canAcceptInput`, `getInputSpace`, `getStorageOutputSpace`, and `freeEmptyStorageSlots`.
- **Normal buildings**: Fixed input/output slots, one per material type, capacity 8. 1:1 slot→pile mapping. No special cases.
- **Demand system**: Targets `(buildingId, material)` — no slot/pile targeting. Carrier picks slot dynamically at delivery time.

**What stays**: `InventorySlot` interface (simplified), `BuildingInventoryManager` class (simplified), `InventoryPileSync` class (simplified), `ConstructionSiteManager` class, `PileRegistry`, slot helpers (`deposit`, `withdraw`, `canAccept`, etc.).

**What changes**: All slots capped at `SLOT_CAPACITY` (8); construction creates multiple same-material slots; inventory manager has zero building-type awareness; StorageArea slot claim/release moves to logistics; deposit/withdraw support slot targeting; demands target a specific slot index; CSM queries inventory directly.

**What gets deleted**:
- `BuildingInventoryManager.isStorageArea()` method and all 5 call-site branches
- `BuildingInventoryManager.getStorageOutputSpace()`, `freeEmptyStorageSlots()` — replaced by logistics-side queries
- `InventoryPileSync.syncConstructionPiles()` — the normal 1:1 path handles everything
- `CONSTRUCTION_PILE_CAPACITY` constant (just use `SLOT_CAPACITY`)
- `ConstructionSiteManager.materials.delivered` Map, `deliveredAmount` counter, `recordDelivery()` method
- `BuildingLifecycleHandler.onInventoryChanged` bridge and `onMaterialOverflowed` handler
- All dynamic slot assignment logic from `depositOutput`/`withdrawOutput`

## Summary for Review

- **Interpretation**: The three inventory modes are not fundamentally different. They all store materials in piles of ≤8 items. The inventory manager should be a dumb store — slots hold materials, period. All smart behavior (which slot to target, when to claim/release StorageArea slots) belongs in the logistics layer, which already knows the building types and transport job lifecycle.
- **Key decisions**: (1) Every slot has `maxCapacity ≤ SLOT_CAPACITY` (8). Construction configs create `ceil(cost/8)` slots per material. (2) No `dynamic` flag on slots — `InventorySlot` has no concept of "claimable." StorageArea slots start as `NO_MATERIAL`; logistics claims them (sets materialType) when creating a demand, releases them (resets to `NO_MATERIAL`) when the slot is empty and no jobs target it. (3) Deposit/withdraw take a `slotIndex` so carriers target a specific pile. (4) CSM drops `delivered` (derivable as `currentAmount + consumed`) but keeps `consumed` Map. (5) Demands include a `slotIndex`.
- **Assumptions**: Normal production buildings still have exactly one slot per material (no API change for them). `SLOT_CAPACITY` stays at 8.
- **Scope**: Inventory manager, inventory configs, construction site manager, pile sync, logistics (demand system, slot claiming, transport executors). Does NOT change pile registry structure, pile positioning algorithm, or pathfinding.

## Conventions

- Optimistic programming: no `?.` on required deps, throw with context, no silent fallbacks
- Event format: `"domain:past-tense-verb"` (existing events unchanged)
- Feature modules: `features/<name>/index.ts` is the only importable entry
- Max 600 lines per TS file, max 250 lines per function, max 15 cyclomatic complexity
- Use `getEntityOrThrow(id, 'context')` for internal lookups
- Rename `CONSTRUCTION_PILE_CAPACITY` → use `SLOT_CAPACITY` from `inventory-configs.ts`

## Architecture

### Subsystems

| # | Subsystem | Responsibility | Depends On | Files |
|---|-----------|---------------|------------|-------|
| 1 | Inventory manager | Dumb store: slot-targeted deposit/withdraw, multi-slot queries. No building-type awareness. | — | `building-inventory.ts`, `inventory-slot.ts` |
| 2 | Inventory configs | Construction creates multiple slots per material (cap 8 each); storage slots start as `NO_MATERIAL` | — | `inventory-configs.ts` |
| 3 | Construction tracking | CSM drops `delivered` map; queries inventory directly; receives `inventoryManager` dep | 1 | `construction-site-manager.ts`, `building-lifecycle-feature.ts` |
| 4 | Pile sync | Delete `syncConstructionPiles()`; all slots use normal 1:1 path | 1 | `inventory-pile-sync.ts` |
| 5 | Logistics slot management | Owns StorageArea slot claim/release lifecycle; demands target slot index | 1 | `demand-queue.ts`, `construction-request-system.ts`, fulfillment/dispatcher files |
| 6 | Transport executors | Deposit into targeted slot; carrier walks to pile position | 1, 5 | `transport-executors.ts` |
| 7 | Tests | Update for multi-slot construction; StorageArea claim/release | 1-6 | `tests/unit/` |

All paths under `src/game/systems/inventory/` or `src/game/features/` unless noted.

## Shared Contracts

```typescript
// ── inventory-slot.ts ────────────────────────────────────────────────

/** A single inventory slot. 1:1 with a pile entity. Max SLOT_CAPACITY (8) items. */
export interface InventorySlot {
    /** Material type. NO_MATERIAL = unassigned/free. */
    materialType: EMaterialType;
    currentAmount: number;
    /** Always ≤ SLOT_CAPACITY (8). */
    maxCapacity: number;
    // No dynamic flag. No pileCapacity. Pure data.
}

// ── inventory-configs.ts ─────────────────────────────────────────────

export interface SlotConfig {
    materialType: EMaterialType;
    maxCapacity: number;
}

/** Universal pile/slot capacity. */
export const SLOT_CAPACITY = 8; // already exists, unchanged

// ── construction-site-manager.ts ─────────────────────────────────────

interface ConstructionMaterials {
    costs: ReadonlyArray<{ material: EMaterialType; count: number }>;
    totalCost: number;
    consumed: Map<EMaterialType, number>;
    consumedAmount: number;
    // REMOVED: delivered, deliveredAmount
}

// ── demand-queue.ts ──────────────────────────────────────────────────

interface DemandEntry {
    readonly id: number;
    readonly buildingId: number;
    readonly materialType: EMaterialType;
    readonly amount: number;
    readonly priority: DemandPriority;
    readonly timestamp: number;
    /** Target slot index within the building's inventory. */
    readonly slotIndex: number;
}

// ── building-inventory.ts (new/changed methods) ─────────────────────

/** Deposit into a specific slot by index. */
depositAt(buildingId: number, slotIndex: number, amount: number): number;
/** Get all input slots for a material (multiple for construction). */
getInputSlots(buildingId: number, materialType: EMaterialType): ReadonlyArray<{ slot: InventorySlot; index: number }>;
/** Get all output slots for a material. */
getOutputSlots(buildingId: number, materialType: EMaterialType): ReadonlyArray<{ slot: InventorySlot; index: number }>;
/** Find first slot (input or output) with space for this material. */
findSlotWithSpace(buildingId: number, materialType: EMaterialType, kind: 'input' | 'output'): { slot: InventorySlot; index: number } | undefined;
/** Set a slot's material type (used by logistics to claim/release StorageArea slots). */
setSlotMaterial(buildingId: number, slotIndex: number, materialType: EMaterialType): void;
```

## Subsystem Details

### 1. Inventory manager
**Files**: `src/game/systems/inventory/building-inventory.ts`, `inventory-slot.ts`
**Key decisions**:
- **InventorySlot simplified**: just `materialType`, `currentAmount`, `maxCapacity`. No flags.
- **Slot-targeted deposit/withdraw**: Add `depositAt(buildingId, slotIndex, amount)` — deposits into the slot at that index regardless of input/output. The slot's `materialType` must already match what's being deposited (set at config time or by logistics claiming). Add `withdrawAt(buildingId, slotIndex, amount)` similarly.
- **`setSlotMaterial(buildingId, slotIndex, materialType)`**: Sets the material type of a slot. Used by logistics to claim (`NO_MATERIAL → LOG`) and release (`LOG → NO_MATERIAL`) StorageArea slots. Throws if slot has `currentAmount > 0` and new material differs (can't reassign a slot with material in it).
- **Multi-slot queries**: `getInputSlots(buildingId, material)` returns all input slots matching that material with their indices. `findSlotWithSpace(buildingId, material, 'input')` returns first with available capacity.
- **Remove entirely**: `isStorageArea()`, `getStorageOutputSpace()`, `freeEmptyStorageSlots()`, `setAllowedMaterial()`, `getAllowedMaterials()`, `allowedMaterials` Map. All dynamic-slot and storage-filter logic moves to logistics.
- **Remove branching**: `depositOutput`/`withdrawOutput` lose their `isStorageArea` branches — they become thin wrappers around `depositAt`/`withdrawAt`. Or deprecate them in favor of the slot-targeted API.
- **`canAcceptInput`/`getInputSpace`**: Remove `isStorageArea` throws. StorageArea has no input slots, so these naturally return false/0.
- **Change callback**: Add `slotIndex` to `InventoryChangeCallback` so pile sync knows which slot changed.

### 2. Inventory configs
**Files**: `src/game/systems/inventory/inventory-configs.ts`
**Key decisions**:
- `getInventoryConfig`: storage piles (type=4) create slots with `NO_MATERIAL` and `SLOT_CAPACITY` — same as today, just no `dynamic` flag.
- `getConstructionInventoryConfig`: for each cost, create `ceil(count / SLOT_CAPACITY)` input slots. Last slot gets `count % SLOT_CAPACITY` capacity (or `SLOT_CAPACITY` if evenly divisible). Example: 12 logs → `[{LOG, 8}, {LOG, 4}]`.
- `SlotConfig` simplified: just `materialType` and `maxCapacity`.
- Delete `CONSTRUCTION_PILE_CAPACITY` from `construction-pile-positions.ts` — use `SLOT_CAPACITY` everywhere.

### 3. Construction tracking
**Files**: `src/game/features/building-construction/construction-site-manager.ts`, `building-lifecycle-feature.ts`

**ConstructionSiteManager**:
- Receives `BuildingInventoryManager` (new constructor dependency).
- Remove `delivered` Map, `deliveredAmount`, `recordDelivery()`.
- `getRemainingMaterials()`: for each cost, sum `currentAmount` across all slots for that material via `inventoryManager.getInputSlots()`, then `remaining = cost.count - totalInSlots - consumed.get(material)`.
- `hasUnconsumedMaterial()`: check if any input slot has `currentAmount > 0` — query inventory directly.
- `consumeNextMaterial()`: find first cost where inventory has material, return it. Builder executor still calls `inventoryManager.withdrawInput()` (or `withdrawAt` with slot index).
- Serialization: drop `deliveredMaterials`. Keep `consumedMaterials`/`consumedAmount`.

**BuildingLifecycleHandler**:
- Remove `onInventoryChanged` handler and `inventory:changed` subscription.
- Remove `onMaterialOverflowed` handler.
- `construction:materialDelivered` event: emit from transport executor on deposit instead.

### 4. Pile sync
**Files**: `src/game/features/inventory/inventory-pile-sync.ts`
**Key decisions**:
- Delete `syncConstructionPiles()` entirely. The existing `onInventoryChange` path handles all slots uniformly — each slot maps 1:1 to a pile entity.
- The change callback now includes `slotIndex`, so pile registry keys use `(buildingId, material, slotKind, slotIndex)` instead of `(buildingId, material, slotKind, pileIndex)`. Conceptually the same, but driven by inventory slots rather than computed pile distribution.
- `resolveSlotKind`: remove `BuildingType.StorageArea` check. Use the slot's `materialType` origin to determine kind: if CSM has a site → `SlotKind.Construction`; if the slot was initially `NO_MATERIAL` (StorageArea) → `SlotKind.Storage`; otherwise → `SlotKind.Input` or `SlotKind.Output`. Alternatively, the slot kind can be passed through the change callback.
- Remove import of `CONSTRUCTION_PILE_CAPACITY`.

### 5. Logistics slot management
**Files**: `src/game/features/logistics/demand-queue.ts`, `construction-request-system.ts`, fulfillment/dispatcher files

**Demand queue**:
- Add `slotIndex` to `DemandEntry`.
- `addDemand()` takes a `slotIndex` parameter.

**Construction request system**:
- When creating demands, iterate per-slot (not per-material). For each slot with space, create a demand with that slot's index.
- Use `inventoryManager.getInputSlots(buildingId, material)` to enumerate slots.

**StorageArea slot claiming** (wherever StorageArea demands are created):
- Before creating a demand, find a free `NO_MATERIAL` output slot on the target building.
- Call `inventoryManager.setSlotMaterial(buildingId, slotIndex, material)` to claim it.
- If no free slot → don't create the demand (storage full).
- Pass the `slotIndex` into the demand.

**StorageArea slot releasing** (on job cancellation or completion):
- When a transport job is cancelled before delivery and the target slot is empty (`currentAmount === 0`), call `inventoryManager.setSlotMaterial(buildingId, slotIndex, NO_MATERIAL)` to release it.
- When material is withdrawn and the slot drains to zero, logistics checks if any active jobs still target this slot. If not, release it.

**Normal production buildings**:
- Demands still specify a `slotIndex`. For single-slot-per-material buildings, use `findSlotWithSpace()` to get the (only) index. Trivial.

### 6. Transport executors
**Files**: `src/game/features/settler-tasks/internal/transport-executors.ts`
**Key decisions**:
- `executeTransportDeliver`: read `slotIndex` from transport data. Use `depositAt(buildingId, slotIndex, amount)`.
- Carrier destination position: derived from the pile position for the target slot (via pile registry or construction pile positions).
- Remove `isStorageArea()` check — uniform `depositAt` handles all building types.
- Emit `construction:materialDelivered` here on successful deposit to a construction site.

### 7. Tests
**Files**: `tests/unit/economy/fulfillment-matcher.spec.ts`, `transport-job.spec.ts`, `tests/unit/integration/economy/carrier-inventory.spec.ts`, `tests/unit/buildings/placement.spec.ts`, `tests/unit/helpers/test-simulation.ts`
**Key decisions**:
- `createSlot()` signature simplified (no `dynamic` param).
- Add test: construction site with 12 logs creates 2 input slots (8+4), each gets its own pile.
- Add test: StorageArea slot claimed by logistics on demand creation, released on job cancel if empty.
- Add test: StorageArea slot NOT released after withdraw if another job still targets it.
- Add test: carrier targets specific slot index, deposits there.
- Existing integration tests should pass (behavior preserved, API backward compat).

## File Map

### Modified Files
| File | Change |
|------|--------|
| `src/game/systems/inventory/inventory-slot.ts` | Remove `dynamic`; keep pure data (no flags) |
| `src/game/systems/inventory/building-inventory.ts` | Remove `isStorageArea()`, `getStorageOutputSpace()`, `freeEmptyStorageSlots()`, `allowedMaterials`; add `depositAt`/`withdrawAt`/`setSlotMaterial`/`getInputSlots`/`findSlotWithSpace`; add `slotIndex` to change callback |
| `src/game/systems/inventory/inventory-configs.ts` | Construction creates multi-slot configs (cap 8 each); `SlotConfig` simplified |
| `src/game/systems/inventory/construction-pile-positions.ts` | Remove `CONSTRUCTION_PILE_CAPACITY`; use `SLOT_CAPACITY` |
| `src/game/features/building-construction/construction-site-manager.ts` | Accept `inventoryManager`; remove `delivered`/`recordDelivery`; query inventory |
| `src/game/features/building-construction/building-lifecycle-feature.ts` | Remove `onInventoryChanged`/`onMaterialOverflowed` handlers |
| `src/game/features/building-construction/building-construction-feature.ts` | Pass `inventoryManager` to `ConstructionSiteManager` |
| `src/game/features/building-construction/construction-request-system.ts` | Create demands per-slot with `slotIndex` |
| `src/game/features/inventory/inventory-pile-sync.ts` | Delete `syncConstructionPiles()`; use `slotIndex` in pile registry keys; remove `CONSTRUCTION_PILE_CAPACITY` import |
| `src/game/features/logistics/demand-queue.ts` | Add `slotIndex` to `DemandEntry` and `addDemand()` |
| `src/game/features/logistics/fulfillment-matcher.ts` | Replace `isStorageArea()` with building-type check where needed; add slot claiming logic |
| `src/game/features/settler-tasks/internal/transport-executors.ts` | Use `depositAt` with `slotIndex`; remove `isStorageArea()` |
| `tests/unit/helpers/test-simulation.ts` | Update for removed `isStorageArea` |
| `tests/unit/economy/fulfillment-matcher.spec.ts` | Update for slot-targeted demands |
| `tests/unit/integration/economy/carrier-inventory.spec.ts` | Update for multi-slot construction and slot claiming |

## Verification
- Place a building needing 12 logs → 2 LOG input slots (8+4) created → 2 pile entities spawned → carriers deliver to specific piles → builders consume → piles shrink → building completes → inventory swaps to production config
- StorageArea: logistics claims free slot when creating demand → carrier delivers to that slot → material withdrawn → slot drains to zero → logistics releases slot back to `NO_MATERIAL`
- StorageArea: job cancelled before delivery → slot released immediately (empty)
- StorageArea: slot drained but another job targets it → slot NOT released until last job completes/cancels
- Normal production building → single slot per material, `findSlotWithSpace` returns the only index, carrier deposits normally
- `getRemainingMaterials()` returns correct counts with partial delivery and partial consumption
- Existing lint and unit tests pass
