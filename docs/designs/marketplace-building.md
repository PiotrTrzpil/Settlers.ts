# Marketplace Building — Design

## Overview

Implement the Marketplace building to function identically to the StorageArea: same inventory behavior (dynamic storage slots), same storage direction filtering (import/export/both), same logistics integration, and same UI (StorageFilterPanel). The key design goal is **zero duplication** — introduce a shared `isStorageBuilding()` predicate and replace all hardcoded `=== BuildingType.StorageArea` checks.

## Summary for Review

- **Interpretation**: Marketplace should behave exactly like StorageArea for now — stores goods, supports import/export direction filtering, participates in the same logistics flows. The only difference is the building type enum value (and therefore its sprite, XML config, placement rules).
- **Key decisions**: Instead of duplicating StorageArea logic or adding `|| Marketplace` checks in 12+ places, introduce a single `isStorageBuilding(type)` predicate in `building-type.ts` and use it everywhere. This is clean, extensible, and a single point of change.
- **Assumptions**: Marketplace uses the same `set_storage_filter` command, same `StorageFilterManager`, same `SlotKind.Storage` inventory behavior. No marketplace-specific trading mechanics yet.
- **Scope**: All engine systems, logistics, commands, UI, CLI, and renderer that currently special-case StorageArea. Tests updated to cover Marketplace. Deferred: any future trading/bartering mechanics unique to Marketplace.

## Conventions

- Optimistic programming — no defensive fallbacks, use `!` and `getEntityOrThrow`
- Race is always required, never optional
- Features in `features/<name>/`, systems in `systems/`
- Max 250 lines per function, 600 lines per TS file, cyclomatic complexity ≤ 15
- Fix root causes, not symptoms — the predicate IS the root cause fix vs. scattering `||` checks

## Architecture

### Subsystems

| # | Subsystem | Responsibility | Depends On | Files |
|---|-----------|---------------|------------|-------|
| 1 | Predicate | `isStorageBuilding()` helper + replace all `=== StorageArea` checks | — | `building-type.ts` + 10 consumer files |
| 2 | UI | StorageFilterPanel and composable support Marketplace | 1 | `useStorageFilter.ts`, `StorageFilterPanel.vue`, `selection-panel.vue` |
| 3 | Tests | Verify Marketplace works identically to StorageArea | 1, 2 | existing test files + new test cases |

## Shared Contracts

```typescript
// src/game/buildings/building-type.ts — new export

/** Returns true for building types that act as general-purpose storage (StorageArea, Marketplace). */
export function isStorageBuilding(type: BuildingType): boolean {
    return type === BuildingType.StorageArea || type === BuildingType.Marketplace;
}
```

This single predicate replaces every `=== BuildingType.StorageArea` check across the codebase (except where StorageArea is used as a literal value for mapping/registration, not as a behavior check).

## Subsystem Details

### Subsystem 1 — Predicate + Engine Integration

**Files**:
- `src/game/buildings/building-type.ts` — add `isStorageBuilding()` export
- `src/game/commands/handlers/system-handlers.ts:118` — `executeSetStorageFilter` validation: replace `!== BuildingType.StorageArea` with `!isStorageBuilding(...)`
- `src/game/features/logistics/fulfillment-matcher.ts:115,135` — `destIsStorageBuilding` and `sourceIsStorage`: replace both `=== BuildingType.StorageArea` with `isStorageBuilding()`
- `src/game/features/logistics/transport-job-service.ts:85` — `resolveDestinationSlot`: replace `=== BuildingType.StorageArea` with `isStorageBuilding()`
- `src/game/features/material-requests/material-request-system.ts:138,165` — `dirtyStorageAreas` filter and `markAllOperationalDirty`: replace both `=== BuildingType.StorageArea` with `isStorageBuilding()`
- `src/game/systems/inventory/building-inventory.ts:205` — slot kind assignment: replace `=== BuildingType.StorageArea` with `isStorageBuilding()`
- `src/game/renderer/optimized-depth-sorter.ts:152` — flat building depth bias: replace `=== BuildingType.StorageArea` with `isStorageBuilding()`
- `src/game/renderer/entity-renderer-constants.ts:70` — comment only, update to mention Marketplace
- `src/game/cli/commands/economy.ts:343` — storage area economy filter: replace with `isStorageBuilding()`
- `src/game/cli/map-symbols.ts` — add Marketplace symbol entry (use same or similar symbol as StorageArea)

**Key decisions**:
- Do NOT touch files where `StorageArea` appears as a mapping key or registration value (e.g., `BUILDING_TYPE_TO_XML_ID`, `map-buildings.ts` S4 type mapping, `buildings-api.ts` scripting mapping). These are identity mappings, not behavior checks.
- The renderer flat-sprite depth bias applies to Marketplace too — it's also a flat ground building.
- `resolveStorageAreaSlot` function name: rename to `resolveStorageBuildingSlot` for clarity (it's a local function in `transport-job-service.ts`).

### Subsystem 2 — UI

**Files**:
- `src/composables/useStorageFilter.ts:54` — replace `e.subType !== BuildingType.StorageArea` with `!isStorageBuilding(e.subType as BuildingType)`
- `src/components/StorageFilterPanel.vue` — likely no changes needed (it delegates to the composable), but verify

**Key decisions**:
- The composable's `isStorageArea` computed property name should be renamed to `isStorageBuilding` to reflect the broader semantics. This is a local change within the composable and its consumers.

### Subsystem 3 — Tests

**Files**:
- `tests/unit/integration/economy/storage-area-logistics.spec.ts` — add parallel test cases for Marketplace (can use the same test helper patterns, just with `BuildingType.Marketplace`)
- `tests/unit/helpers/test-scenarios.ts` / `tests/unit/helpers/test-simulation.ts` — add Marketplace scenario helper if needed

**Key decisions**:
- Don't duplicate all StorageArea tests. Add a focused subset proving Marketplace works: slot claiming, direction filtering, transport job resolution, and material requests.
- If existing tests use a parameterized pattern, extend it. Otherwise add a small dedicated describe block.

## File Map

### New Files

None — this is purely integration of an existing enum value into existing systems.

### Modified Files

| File | Change |
|------|--------|
| `src/game/buildings/building-type.ts` | Add `isStorageBuilding()` export |
| `src/game/commands/handlers/system-handlers.ts` | Use `isStorageBuilding()` in `executeSetStorageFilter` |
| `src/game/features/logistics/fulfillment-matcher.ts` | Use `isStorageBuilding()` for dest/source checks |
| `src/game/features/logistics/transport-job-service.ts` | Use `isStorageBuilding()`, rename local fn |
| `src/game/features/material-requests/material-request-system.ts` | Use `isStorageBuilding()` in tick + scan |
| `src/game/systems/inventory/building-inventory.ts` | Use `isStorageBuilding()` for SlotKind |
| `src/game/renderer/optimized-depth-sorter.ts` | Use `isStorageBuilding()` for depth bias |
| `src/game/cli/commands/economy.ts` | Use `isStorageBuilding()` in filter |
| `src/game/cli/map-symbols.ts` | Add Marketplace symbol |
| `src/composables/useStorageFilter.ts` | Use `isStorageBuilding()`, rename computed |
| `tests/unit/integration/economy/storage-area-logistics.spec.ts` | Add Marketplace test cases |

## Verification

1. Place a Marketplace building — it should accept goods via carriers like StorageArea
2. Set import/export direction filters on a Marketplace — carriers respect the filtering
3. Marketplace slots dynamically claim materials (same as StorageArea behavior)
4. StorageFilterPanel appears when selecting an operational Marketplace
5. CLI economy command filters out Marketplace alongside StorageArea
6. Existing StorageArea tests still pass unchanged
