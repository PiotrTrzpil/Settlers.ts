# Material Throughput Counters — Design

## Overview

Add per-building, per-material cumulative throughput counters (`totalIn` / `totalOut`) to `BuildingInventoryManager`. This enables construction sites to derive consumed amounts from inventory throughput instead of maintaining a separate `MaterialsData.consumed` Map, and provides a general-purpose throughput abstraction for future features (trading posts, statistics panels).

## Current State

- **What exists**: `PileSlot.currentAmount` tracks live stock. Construction sites maintain a **separate** `MaterialsData.consumed: Map<EMaterialType, number>` to track how many materials builders have used. This duplication exists because `currentAmount` loses history — once a builder withdraws, the count decreases and there's no way to know totals.
- **Why not per-slot**: StorageArea slots get reassigned between material types (`setSlotMaterial()`), and slots can be created/destroyed as buildings change. Per-slot counters would mix materials or lose data. The natural key is `(buildingId, materialType)`.
- **What stays**: `PileSlot` structure unchanged, `BuildingInventoryManager` API, `deposit()`/`withdraw()` operations.
- **What changes**: `BuildingInventoryManager` gains a throughput ledger keyed by `(buildingId, materialType)`. Construction `MaterialsData.consumed` Map is deleted — derived from throughput instead.
- **What gets deleted**: `MaterialsData.consumed` (Map), `consumedAmount` (scalar), manual `consumed.get()`/`consumed.set()` tracking in `consumeNextMaterial()`, and the `consumedMaterials` serialization/deserialization in `construction-site-manager.ts`.

## Summary for Review

- **Interpretation**: Add a general-purpose per-building, per-material throughput ledger to the inventory system, then use it to eliminate construction's shadow `consumed` tracking. The ledger survives slot reassignment and slot creation/destruction.
- **Key decisions**: Counters live on `BuildingInventoryManager` (not on individual `PileSlot`s) because they track building-level throughput across slot lifecycle changes. `totalIn` incremented on every `deposit()`, `totalOut` on every `withdraw()`. Construction derives consumed = `totalOut` for its input slots.
- **Assumptions**: No other system currently relies on `MaterialsData.consumed` or `consumedAmount` beyond construction-site-manager and construction-executors.
- **Scope**: This design covers adding the throughput ledger and migrating construction. Trading post / marketplace throughput is a future consumer, not implemented here.

## Conventions

- Optimistic programming: throughput counters are always valid (monotonically increasing), no defensive checks needed.
- Events: `inventory:changed` already fires on deposit/withdraw — no new events needed.
- Determinism: counters are integer, incremented by integer amounts — no floating-point concerns.
- Throughput data is persisted alongside inventory (same `serialize()`/`deserialize()` cycle).

## Architecture

### Subsystems

| # | Subsystem | Responsibility | Depends On | Files |
|---|-----------|---------------|------------|-------|
| 1 | Throughput ledger | Track cumulative in/out per building per material | — | building-inventory.ts, building-inventory-helpers.ts |
| 2 | Construction migration | Replace `MaterialsData.consumed` with throughput queries | 1 | construction-site-manager.ts, construction-executors.ts, types.ts |

## Shared Contracts

```typescript
// building-inventory-helpers.ts

/** Cumulative throughput for one (building, material) pair. */
export interface MaterialThroughput {
    /** Total units deposited (across all slots, across slot lifecycle). */
    totalIn: number;
    /** Total units withdrawn (across all slots, across slot lifecycle). */
    totalOut: number;
}

// BuildingInventoryManager new public API:

/** Get throughput for a specific building + material. Returns { totalIn: 0, totalOut: 0 } if none recorded. */
getThroughput(buildingId: number, materialType: EMaterialType): MaterialThroughput;

/** Get all throughput entries for a building. */
getBuildingThroughput(buildingId: number): ReadonlyMap<EMaterialType, MaterialThroughput>;
```

```typescript
// Serialized form — added to SerializedBuildingInventory
export interface SerializedBuildingInventory {
    nextSlotId: number;
    slots: Map<number, SerializedPileSlot>;
    /** Cumulative throughput: buildingId → materialType → { totalIn, totalOut } */
    throughput?: Map<number, Map<EMaterialType, MaterialThroughput>>;
}
```

## Subsystem Details

### 1. Throughput ledger
**Files**: `src/game/systems/inventory/building-inventory.ts`, `src/game/systems/inventory/building-inventory-helpers.ts`

**Key decisions**:
- Internal storage: `Map<number, Map<EMaterialType, MaterialThroughput>>` keyed by `buildingId → materialType`.
- Incremented inside `deposit()` and `withdraw()` — the existing single choke points for all inventory mutations. Both methods already know `slot.buildingId` and `slot.materialType`.
- `destroySlots()` does NOT clear throughput for the building — throughput survives slot destruction (relevant for trading posts that may recreate slots).
- `clear()` clears throughput alongside slots.
- Serialization: throughput map added to `SerializedBuildingInventory`. On deserialize, missing `throughput` field defaults to empty map (backward compat).

### 2. Construction migration
**Files**: `src/game/features/building-construction/construction-site-manager.ts`, `src/game/features/building-construction/internal/construction-executors.ts`, `src/game/features/building-construction/types.ts`

**Key decisions**:
- Delete `MaterialsData.consumed` (Map) and `MaterialsData.consumedAmount` (scalar). `MaterialsData` keeps only `costs` and `totalCost`.
- `consumeNextMaterial()`: iterate costs in order, find first material where `throughput.totalOut < cost.amount` and any input slot has `currentAmount > 0`. Return that material type. No more shadow tracking — just query throughput + live inventory.
- `getRemainingCosts()`: `remaining = cost.amount - throughput.totalIn` per material (totalIn = total delivered, so remaining = what still needs *delivery*).
- Progress calculation in `construction-executors.ts`: `consumedAmount = sum of throughput.totalOut across all cost materials`. This replaces the manually incremented scalar.
- Remove `consumedMaterials` from construction serialization/deserialization — throughput is persisted by inventory system.

## File Map

### Modified Files

| File | Change |
|------|--------|
| `src/game/systems/inventory/building-inventory.ts` | Add throughput map, increment in `deposit()`/`withdraw()`, add `getThroughput()`/`getBuildingThroughput()`, serialize/deserialize |
| `src/game/systems/inventory/building-inventory-helpers.ts` | Add `MaterialThroughput` interface, add `throughput` to `SerializedBuildingInventory` |
| `src/game/features/building-construction/types.ts` | Remove `consumed` and `consumedAmount` from `MaterialsData` |
| `src/game/features/building-construction/construction-site-manager.ts` | Rewrite `consumeNextMaterial()` and `getRemainingCosts()` to use `getThroughput()`; remove consumed serialization |
| `src/game/features/building-construction/internal/construction-executors.ts` | Derive progress from throughput `totalOut` sum instead of `site.materials.consumedAmount` |

## Verification

- Place a building, deliver materials, verify throughput `totalIn` increments on each deposit and persists across save/load.
- Construction progress matches before/after: same build speed, same material consumption order.
- Cancel mid-construction: `getRemainingCosts()` still reports correct remaining amounts.
- StorageArea: reassign a slot's material type, verify throughput stays correct per material (not mixed).
- Load an old snapshot without `throughput` field: defaults to empty map without crash.
