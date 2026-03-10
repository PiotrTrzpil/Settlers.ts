# Work Handler Registry — Design

## Overview

Invert the dependency between `settler-tasks` and domain features (trees, stones, crops, ore-veins). Currently `settler-tasks-feature.ts` imports all domain systems and registers their work handlers itself. Instead, each domain feature should register its own work handler with settler-tasks, making settler-tasks a generic worker engine with no knowledge of specific job types.

## Current State

- **What exists**: `settler-tasks-feature.ts` lists `trees`, `stones`, `crops`, `ore-signs`, `combat` as dependencies. It imports handler factories from `work-handlers.ts` and calls `registerWorkHandler()` for every search type.
- **What stays**: `SettlerTaskSystem`, `registerWorkHandler()` API, all `WorkHandler`/`SearchType` types, the handler factories themselves, built-in handlers (WORKPLACE, GOOD/carrier).
- **What changes**: Handler registration moves from settler-tasks to each domain feature. `work-handlers.ts` handler factories move to their respective domain feature folders. settler-tasks drops domain dependencies.
- **What gets deleted**: Nothing deleted — code relocates.

## Summary for Review

- **Interpretation**: The work handler factories (woodcutting, stonecutting, crop harvest, planting, water, geologist) move from `settler-tasks/work-handlers.ts` to their respective domain features. Each domain feature declares `settler-tasks` as a dependency (instead of the reverse) and calls `settlerTaskSystem.registerWorkHandler()` in its `create()` or `onTerrainReady()`.
- **Key decisions**:
  - Built-in handlers (WORKPLACE, GOOD) stay in settler-tasks since they have no domain dependency
  - `work-handlers.ts` is split — factory functions move to domain features, built-in handlers stay
  - Domain features add `settler-tasks` as a dependency (reversing the current direction)
  - `settler-tasks` removes `trees`, `stones`, `crops`, `ore-signs` from its dependency list
  - Handler factories stay as-is (no API change), they just live in different files
- **Assumptions**: `combat` dependency on settler-tasks is for `isInCombat` check, not a work handler — left unchanged for now
- **Scope**: Only work handler registration moves. SettlerTaskSystem internals unchanged. No new types needed.

## Conventions

- Optimistic programming: no `?.` on required deps, no silent fallbacks, throw with context
- Feature modules: single `index.ts` entry point, no external imports from `internal/`
- Use enum members, never numeric literals
- `registerWorkHandler` already exists — reuse it, don't redesign

## Architecture

### Subsystems

| # | Subsystem | Responsibility | Depends On | Files |
|---|-----------|---------------|------------|-------|
| 1 | settler-tasks cleanup | Remove domain handler registration + domain dependencies from settler-tasks | — | 2 files |
| 2 | tree handlers | Move woodcutting + forester handler factories to trees feature, register them | 1 | 3 files |
| 3 | stone handler | Move stonecutting handler factory to stones feature, register it | 1 | 3 files |
| 4 | crop handlers | Move crop harvest + planting handler factories to crops feature, register them | 1 | 3 files |
| 5 | terrain handlers | Move water + geologist handler factories to their features, register in onTerrainReady | 1 | 4 files |

## Shared Contracts

No new types needed. The existing contract is:

```typescript
// Already in settler-tasks/types.ts — unchanged
export type WorkHandler = EntityWorkHandler | PositionWorkHandler;

// Already on SettlerTaskSystem — unchanged
registerWorkHandler(searchType: SearchType, handler: WorkHandler): void;

// settler-tasks exports (add settlerTaskSystem to SettlerTaskExports — already there)
export interface SettlerTaskExports {
    settlerTaskSystem: SettlerTaskSystem;
    choreoSystem: ChoreoSystem;
    // ...existing
}
```

Each domain feature uses `ctx.getFeature<SettlerTaskExports>('settler-tasks').settlerTaskSystem.registerWorkHandler(...)`.

## Subsystem Details

### 1. settler-tasks cleanup
**Files**: `src/game/features/settler-tasks/settler-tasks-feature.ts`, `src/game/features/settler-tasks/work-handlers.ts`
**Key decisions**:
- Remove `trees`, `stones`, `crops`, `ore-signs` from `dependencies` array
- Remove all `createWoodcuttingHandler`, `createStonecuttingHandler`, `createForesterHandler`, `createCropHarvestHandler`, `createPlantingHandler` imports and registration calls from `create()`
- Remove `createWaterHandler`, `createGeologistHandler` imports and registration from `onTerrainReady()`
- Keep `createWorkplaceHandler` and `createCarrierHandler` in `work-handlers.ts` (they depend only on inventory/game-state, no domain systems)
- Remove `SimpleHarvestConfig` and `createSimpleHarvestHandler` from `work-handlers.ts` — move to a shared utility or inline into stone handler
- Keep ore vein data setup (`setOreVeinData`) — this is for the WORKPLACE handler's mine check, not for the geologist handler. It stays in settler-tasks but the ore-signs feature should set it via exports.

### 2. tree handlers
**Files**: `src/game/features/trees/work-handlers.ts` (new), `src/game/features/trees/index.ts` (modify — re-export), `src/game/features/trees/tree-feature.ts` (modify — register handlers)
**Depends on**: Subsystem 1
**Key decisions**:
- Move `createWoodcuttingHandler` and `createForesterHandler` here
- In `TreeFeature.create()`: add `'settler-tasks'` to dependencies, get `settlerTaskSystem`, register both handlers
- Import `SearchType` from settler-tasks

### 3. stone handler
**Files**: `src/game/features/stones/work-handlers.ts` (new), `src/game/features/stones/index.ts` (modify), `src/game/features/stones/stone-feature.ts` (modify)
**Depends on**: Subsystem 1
**Key decisions**:
- Move `createStonecuttingHandler` (and `createSimpleHarvestHandler` if still needed) here
- Register in `StoneFeature.create()`

### 4. crop handlers
**Files**: `src/game/features/crops/work-handlers.ts` (new), `src/game/features/crops/index.ts` (modify), `src/game/features/crops/crop-feature.ts` (modify)
**Depends on**: Subsystem 1
**Key decisions**:
- Move `createCropHarvestHandler` and `createPlantingHandler` here
- Register all 5 crop pairs (grain, sunflower, agave, beehive, vine) in `CropFeature.create()`
- `createPlantingHandler` is generic (takes `PlantingCapable`) — it can live in crops since that's where all planting callers are

### 5. terrain handlers
**Files**: `src/game/features/ore-veins/work-handlers.ts` (new), `src/game/features/ore-veins/index.ts` (modify), `src/game/features/ore-veins/ore-signs-feature.ts` (modify), water handler location TBD
**Depends on**: Subsystem 1
**Key decisions**:
- Move `createGeologistHandler` to ore-veins feature
- Move `createWaterHandler` — this needs a home. It depends on terrain + inventory. Options: (a) keep in settler-tasks since it's more of an "inventory" handler, (b) create a small water feature. Recommend (a): keep `createWaterHandler` in `settler-tasks/work-handlers.ts` as a built-in handler since it has no domain system dependency (just terrain + inventory, both available in settler-tasks). Register it in settler-tasks' own `onTerrainReady`.
- Ore-signs feature: register geologist handler in `onTerrainReady`. Also call `settlerTaskSystem.setOreVeinData()` here (moving this from settler-tasks-feature.ts).
- Ore-signs feature adds `'settler-tasks'` to its dependencies

**Circular dependency check**: Currently settler-tasks depends on ore-signs. After: ore-signs depends on settler-tasks. This is the correct direction (domain → engine). settler-tasks also uses `OreVeinData` for the WORKPLACE mine handler — this should be injected by ore-signs via `setOreVeinData()` (already a lazy setter pattern). Remove `ore-signs` from settler-tasks dependencies entirely.

## File Map

### New Files
| File | Subsystem | Purpose |
|------|-----------|---------|
| `src/game/features/trees/work-handlers.ts` | 2 | Woodcutting + forester handler factories |
| `src/game/features/stones/work-handlers.ts` | 3 | Stonecutting handler factory |
| `src/game/features/crops/work-handlers.ts` | 4 | Crop harvest + planting handler factories |
| `src/game/features/ore-veins/work-handlers.ts` | 5 | Geologist handler factory |

### Modified Files
| File | Change |
|------|--------|
| `src/game/features/settler-tasks/settler-tasks-feature.ts` | Remove domain imports, handler registrations, and domain dependencies. Keep WORKPLACE/GOOD/WATER handler setup. |
| `src/game/features/settler-tasks/work-handlers.ts` | Remove domain handler factories. Keep `createWorkplaceHandler`, `createCarrierHandler`, `createWaterHandler`. |
| `src/game/features/trees/tree-feature.ts` | Add `settler-tasks` dependency, register tree+forester handlers |
| `src/game/features/trees/index.ts` | Re-export if needed |
| `src/game/features/stones/stone-feature.ts` | Add `settler-tasks` dependency, register stone handler |
| `src/game/features/stones/index.ts` | Re-export if needed |
| `src/game/features/crops/crop-feature.ts` | Add `settler-tasks` dependency, register crop handlers |
| `src/game/features/crops/index.ts` | Re-export if needed |
| `src/game/features/ore-veins/ore-signs-feature.ts` | Add `settler-tasks` dependency, register geologist handler + setOreVeinData in onTerrainReady |
| `src/game/features/ore-veins/index.ts` | Re-export if needed |

## Verification
- All existing unit tests pass (handler behavior unchanged, only registration location moved)
- `pnpm lint` passes with no circular dependency warnings
- settler-tasks no longer imports from trees, stones, crops, or ore-veins
- Each domain feature's handler registration works (settlers still cut trees, mine stones, harvest crops, prospect ore)
