# CFG Cleanup — Design

## Overview

Targeted cleanup based on CFG (Control Flow Graph) analysis findings: delete dead code, deduplicate a spiral search, and split the BuildingInventoryManager god class into focused modules. No behavioral changes — pure structural improvement.

## Current State

- **EntityDepthSorter** (`entity-depth-sorter.ts`): entirely dead, replaced by `OptimizedDepthSorter`. Zero callers.
- **`findLandTile`** (`game-core.ts:266-289`): hand-rolled spiral search duplicating `spiralSearch` utility in `src/game/utils/spiral-search.ts`.
- **BuildingInventoryManager** (`building-inventory.ts`): 597 lines, 56 members. Already has extracted helpers (`building-inventory-helpers.ts`, `building-inventory-production.ts`), but the class itself mixes 4 responsibilities: slot lifecycle, material deposit/withdraw flow, pile entity management via entity index, and throughput tracking.

## Summary for Review

- **Interpretation**: Apply the low-risk CFG findings — delete dead code, deduplicate `findLandTile`, and split `BuildingInventoryManager` into smaller modules with clearer responsibilities.
- **Key decisions**:
  - Split the manager into 3 files: core slot store, material flow (deposit/withdraw), and throughput tracker. The existing helpers/production files stay untouched.
  - The class remains a single `BuildingInventoryManager` facade for callers — the split is internal extraction of private logic into focused modules, not a public API change.
  - Entity index (`_entityIndex`) stays in the core slot store since it's tightly coupled to slot lifecycle.
- **Assumptions**: No callers need to change. The manager's public API is preserved — only internal methods are extracted.
- **Scope**: Dead code deletion, `findLandTile` dedup, internal manager split. Does NOT touch the high-risk functions table or branch-heavy economy code (those are informational findings, not actionable cleanup).

## Conventions

- Optimistic programming: no `?.` on required deps, `getEntityOrThrow` over `getEntity()!`, throw with context
- Max 600 lines / file (aim ≤400), max 250 lines / function (aim ≤80), max 15 cyclomatic complexity
- Internal implementations in module-local files, public API through `index.ts` barrel
- Events: `"domain:past-tense-verb"` format
- `trash` instead of `rm` for file deletion (but `entity-depth-sorter.ts` can be `git rm`'d)

## Architecture

### Subsystems

| # | Subsystem | Responsibility | Depends On | Files |
|---|-----------|---------------|------------|-------|
| 1 | Dead code cleanup | Delete `EntityDepthSorter`, remove any references | — | `entity-depth-sorter.ts` |
| 2 | findLandTile dedup | Replace inline spiral with `spiralSearch` utility | — | `game-core.ts` |
| 3 | Throughput extraction | Extract throughput tracking from BuildingInventoryManager | — | `building-inventory-throughput.ts`, `building-inventory.ts` |
| 4 | Material flow extraction | Extract deposit/withdraw + convenience methods | 3 | `building-inventory-flow.ts`, `building-inventory.ts` |

## Shared Contracts

```typescript
// building-inventory-throughput.ts — new file
// Extracted from BuildingInventoryManager. Owns the ThroughputMap persistent store.

import type { EMaterialType } from '../../economy/material-type';
import type { MaterialThroughput } from './building-inventory-helpers';
import type { ThroughputMap } from './building-inventory-helpers';
import { PersistentValue } from '@/game/persistence/persistent-store';
import { throughputSerializer, getOrCreateThroughput } from './building-inventory-helpers';

export class InventoryThroughputTracker {
    readonly throughputStore = new PersistentValue<ThroughputMap>(
        'buildingInventoryThroughput',
        new Map(),
        throughputSerializer
    );

    recordIn(buildingId: number, materialType: EMaterialType, amount: number): void;
    recordOut(buildingId: number, materialType: EMaterialType, amount: number): void;
    getThroughput(buildingId: number, materialType: EMaterialType): MaterialThroughput;
    getBuildingThroughput(buildingId: number): ReadonlyMap<EMaterialType, MaterialThroughput>;
    clear(): void;
}
```

```typescript
// building-inventory-flow.ts — new file
// Stateless functions for deposit/withdraw convenience methods.
// These are thin wrappers that combine slot lookup + deposit/withdraw.

import type { BuildingInventoryManager } from './building-inventory';
import type { EMaterialType } from '../../economy/material-type';
import type { Recipe } from '../../economy/building-production';

/** Convenience deposit/withdraw by (buildingId, material) instead of slotId. */
export function depositInput(mgr: BuildingInventoryManager, buildingId: number, material: EMaterialType, amount: number): number;
export function depositOutput(mgr: BuildingInventoryManager, buildingId: number, material: EMaterialType, amount: number): number;
export function withdrawInput(mgr: BuildingInventoryManager, buildingId: number, material: EMaterialType, amount: number): number;
export function withdrawOutput(mgr: BuildingInventoryManager, buildingId: number, material: EMaterialType, amount: number): number;
export function getInputAmount(mgr: BuildingInventoryManager, buildingId: number, material: EMaterialType): number;
export function getOutputAmount(mgr: BuildingInventoryManager, buildingId: number, material: EMaterialType): number;
export function getInputSpace(mgr: BuildingInventoryManager, buildingId: number, material: EMaterialType): number;
```

## Subsystem Details

### 1. Dead code cleanup
**Files**: `src/game/renderer/entity-depth-sorter.ts`
**Key decisions**:
- Delete the entire file. `OptimizedDepthSorter` references it in a comment ("Key optimizations over EntityDepthSorter") — update that comment to remove the stale reference.
- Check `docs/designs/material-type-string-enum.md` for any mention and remove if present.

### 2. findLandTile dedup
**Files**: `src/game/game-core.ts`
**Key decisions**:
- Replace the 23-line inline spiral search (lines 266-289) with a call to `spiralSearch(cx, cy, w, h, (x, y) => this.terrain.isBuildable(x, y))`.
- Remove the `eslint-disable-next-line sonarjs/cognitive-complexity` comment (no longer needed).
- Keep the JSDoc comment.

### 3. Throughput extraction
**Files**: new `src/game/systems/inventory/building-inventory-throughput.ts`, modify `building-inventory.ts`
**Key decisions**:
- Move `throughputStore`, `recordThroughputIn`, `recordThroughputOut`, `getThroughput`, `getBuildingThroughput` into `InventoryThroughputTracker`.
- `BuildingInventoryManager` holds a `readonly throughput: InventoryThroughputTracker` field.
- Public API methods `getThroughput()` and `getBuildingThroughput()` on the manager become thin delegates: `return this.throughput.getThroughput(...)`.
- `clear()` calls `this.throughput.clear()`.

### 4. Material flow extraction
**Files**: new `src/game/systems/inventory/building-inventory-flow.ts`, modify `building-inventory.ts`
**Key decisions**:
- Extract `depositInput`, `depositOutput`, `withdrawInput`, `withdrawOutput`, `getInputAmount`, `getOutputAmount`, `getInputSpace` as standalone functions taking the manager as first arg (same pattern as `building-inventory-production.ts`).
- Manager methods become one-liner delegates: `depositInput(...args) { return depositInputFn(this, ...args); }`.
- This follows the established pattern — `canStartProduction`, `consumeProductionInputs`, `produceOutput`, `canStoreOutput` already work this way via `building-inventory-production.ts`.

## File Map

### New Files
| File | Subsystem | Purpose |
|------|-----------|---------|
| `src/game/systems/inventory/building-inventory-throughput.ts` | 3 | Throughput tracking class |
| `src/game/systems/inventory/building-inventory-flow.ts` | 4 | Material flow convenience functions |

### Modified Files
| File | Change |
|------|--------|
| `src/game/renderer/entity-depth-sorter.ts` | Delete |
| `src/game/renderer/optimized-depth-sorter.ts` | Remove stale comment reference to EntityDepthSorter |
| `src/game/game-core.ts` | Replace `findLandTile` body with `spiralSearch` call |
| `src/game/systems/inventory/building-inventory.ts` | Extract throughput + flow methods, delegate to new modules |
| `src/game/systems/inventory/index.ts` | Add export for `InventoryThroughputTracker` if needed by external consumers |

### Deleted Files
| File | Reason |
|------|--------|
| `src/game/renderer/entity-depth-sorter.ts` | Dead code — zero callers, replaced by OptimizedDepthSorter |

## Verification
- `pnpm lint` passes with no new errors
- `pnpm test:unit` passes — no behavioral changes
- `BuildingInventoryManager` public API unchanged — all callers compile without modification
- `entity-depth-sorter.ts` has zero remaining imports after deletion
- `findLandTile` returns the same result as before (same spiral algorithm, just using shared utility)
