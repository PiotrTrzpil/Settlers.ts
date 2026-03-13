# UnitType Numeric → String Enum — Design

## Overview

Convert `UnitType` from a numeric enum (`Carrier = 0, Builder = 1, ...`) to a string enum (`Carrier = 'Carrier', Builder = 'Builder', ...`). Follows the same pattern as the recent `EMaterialType` migration. Eliminates reverse-lookup boilerplate (`UnitType[value]`), improves debuggability, and makes serialized data human-readable.

## Current State

- **What exists**: `UnitType` is a numeric enum with 61 members (0–60) in `src/game/core/unit-types.ts`
- **Scope**: ~110 files import UnitType; 39 reverse-lookup occurrences (`UnitType[value]`) across 25 files; 5 `Number(x) as UnitType` casts; 77 `subType as UnitType` casts across 40 files
- **What stays**: All enum member names, `UNIT_TYPE_CONFIG`, all helper functions, `LEVEL_GROUPS`, `LEVEL_INFO`
- **What changes**:
  - Enum values become strings (PascalCase matching member names)
  - Reverse-lookup patterns (`UnitType[numericValue]`) replaced with direct value usage
  - `Number(typeStr) as UnitType` cast patterns replaced with `typeStr as UnitType`
  - `subType as UnitType` casts remain valid (subType is already `number | string`)
  - `subType as number` casts in UnitType contexts become `subType as UnitType` or direct usage

## Summary for Review

- **Interpretation**: Change UnitType enum backing values from integers to PascalCase strings matching member names (`Carrier = 'Carrier'`). Identical pattern to the EMaterialType migration already completed.
- **Key decisions**:
  - String values are PascalCase (matching enum member names) — unlike EMaterialType which used UPPERCASE. This matches `UNIT_TYPE_CONFIG[x].name` patterns and is more readable for mixed-case names like `SawmillWorker`, `BackpackCatapultist1`.
  - `Entity.subType` is already `number | string` — no change needed (done in EMaterialType migration).
  - `getUnitTypesInCategory()` currently uses `Number(type) as UnitType` to iterate `Object.entries(UNIT_TYPE_CONFIG)` — needs to drop the `Number()` call.
  - `settler-data-access.ts` has two `Number(x) as UnitType` patterns iterating `Record<UnitType, ...>` — same fix.
  - Sprite loaders (`sprite-unit-loader.ts`, `sprite-metadata.ts`) have `Number(typeStr) as UnitType` — same fix.
  - CLI `enum-resolver.ts` already has `indexStringEnum` (used for EMaterialType) — switch UnitType to use it.
  - No save-file backward compatibility needed (dev-phase project).
- **Assumptions**: No raw numeric UnitType literals exist in the codebase (per project rule). `BuildingType` and `MapObjectType` remain numeric for now.
- **Scope**: UnitType only. `UnitCategory` is already a string enum.

## Conventions

- Optimistic programming: no fallbacks, trust contracts, throw with context
- Use `!` assertion or `getEntityOrThrow` — never `?.` on required values
- Max 600 lines/file, 250 lines/function, 15 cyclomatic complexity
- Use `sd` for mass replacements; dry-run first
- Use `rename_symbol_strict` (cclsp MCP) for symbol renames; prefer mass tooling over manual edits
- Always use enum members, never numeric literals

## Architecture

### Subsystems

| # | Subsystem | Responsibility | Depends On | Files |
|---|-----------|---------------|------------|-------|
| 1 | Enum Definition | Change UnitType values to strings | — | `src/game/core/unit-types.ts` |
| 2 | Reverse-Lookup Elimination | Replace `UnitType[value]` → direct value usage | 1 | ~25 files (39 occurrences) |
| 3 | Cast Pattern Updates | Fix `Number(typeStr) as UnitType` patterns | 1 | 5 files |
| 4 | CLI Resolver | Switch UnitType from `indexNumericEnum` to `indexStringEnum` | 1 | `src/game/cli/enum-resolver.ts` |
| 5 | SubType Cast Cleanup | Fix `subType as number` casts in UnitType contexts | 1 | scattered files |
| 6 | Test Updates | Fix test assertions using reverse lookup or numeric casts | 1, 2 | test files |

## Shared Contracts

```typescript
// src/game/core/unit-types.ts — NEW shape
export enum UnitType {
    // ── Common workers (all non-Dark-Tribe races) ──
    Carrier = 'Carrier',
    Builder = 'Builder',
    Digger = 'Digger',
    Woodcutter = 'Woodcutter',
    Stonecutter = 'Stonecutter',
    Forester = 'Forester',
    Farmer = 'Farmer',
    Fisher = 'Fisher',
    Hunter = 'Hunter',
    Miner = 'Miner',
    Smelter = 'Smelter',
    Smith = 'Smith',
    SawmillWorker = 'SawmillWorker',
    Miller = 'Miller',
    Baker = 'Baker',
    Butcher = 'Butcher',
    AnimalFarmer = 'AnimalFarmer',
    Waterworker = 'Waterworker',
    Healer = 'Healer',
    Donkey = 'Donkey',
    // ── Race-specific economy workers ──
    Winemaker = 'Winemaker',
    Beekeeper = 'Beekeeper',
    Meadmaker = 'Meadmaker',
    AgaveFarmer = 'AgaveFarmer',
    Tequilamaker = 'Tequilamaker',
    SunflowerFarmer = 'SunflowerFarmer',
    SunflowerOilMaker = 'SunflowerOilMaker',
    // ── Military (L1 base + L2/L3 variants) ──
    Swordsman1 = 'Swordsman1',
    Swordsman2 = 'Swordsman2',
    Swordsman3 = 'Swordsman3',
    Bowman1 = 'Bowman1',
    Bowman2 = 'Bowman2',
    Bowman3 = 'Bowman3',
    SquadLeader = 'SquadLeader',
    // ── Race-specific specialists (L1 + L2/L3) ──
    Medic1 = 'Medic1',
    Medic2 = 'Medic2',
    Medic3 = 'Medic3',
    AxeWarrior1 = 'AxeWarrior1',
    AxeWarrior2 = 'AxeWarrior2',
    AxeWarrior3 = 'AxeWarrior3',
    BlowgunWarrior1 = 'BlowgunWarrior1',
    BlowgunWarrior2 = 'BlowgunWarrior2',
    BlowgunWarrior3 = 'BlowgunWarrior3',
    BackpackCatapultist1 = 'BackpackCatapultist1',
    BackpackCatapultist2 = 'BackpackCatapultist2',
    BackpackCatapultist3 = 'BackpackCatapultist3',
    // ── Non-military specialists ──
    Priest = 'Priest',
    Pioneer = 'Pioneer',
    Thief = 'Thief',
    Geologist = 'Geologist',
    Saboteur = 'Saboteur',
    Gardener = 'Gardener',
    // ── Dark Tribe exclusive ──
    DarkGardener = 'DarkGardener',
    Shaman = 'Shaman',
    MushroomFarmer = 'MushroomFarmer',
    SlavedSettler = 'SlavedSettler',
    TempleServant = 'TempleServant',
    ManacopterMaster = 'ManacopterMaster',
    Angel = 'Angel',
    Angel2 = 'Angel2',
    Angel3 = 'Angel3',
}

// Entity.subType — already `number | string`, no change needed
```

## Subsystem Details

### 1. Enum Definition
**Files**: `src/game/core/unit-types.ts`
**Key decisions**:
- PascalCase string values matching member names (`Carrier = 'Carrier'`)
- `UNIT_TYPE_CONFIG`, `LEVEL_GROUPS`, `LEVEL_INFO`, all helper functions: no changes needed (they use enum members as keys)
- `getUnitTypesInCategory()` (line 276-280): replace `Number(type) as UnitType` with `type as UnitType` — `Object.entries` on a string enum yields the string values directly

### 2. Reverse-Lookup Elimination
**Files**: ~25 files with `UnitType[value]` patterns (39 occurrences)
**Key decisions**:
- `UnitType[someVar]` → just use `someVar` directly (it's already a readable string like `'Carrier'`)
- For `UnitType[e.subType as number]` patterns → `e.subType as UnitType` (or just `e.subType` where type allows string)
- Display formatting stays the same — the string values are already PascalCase display names
- Mass-replaceable with `sd`; patterns:
  - `UnitType[someExpr]` where someExpr is typed UnitType → just `someExpr`
  - `UnitType[e.subType as number]` → `e.subType as UnitType` (or `String(e.subType)` in debug-only contexts)

### 3. Cast Pattern Updates
**Files**:
- `src/game/core/unit-types.ts` (line 279) — `Number(type) as UnitType` → `type as UnitType`
- `src/game/data/settler-data-access.ts` (lines 244, 259) — same pattern
- `src/game/renderer/sprite-unit-loader.ts` (line 127) — same pattern
- `src/game/renderer/sprite-metadata/sprite-metadata.ts` (line 199) — same pattern

**Key decisions**:
- `Object.entries()` on `Record<UnitType, X>` with a string enum yields `[string, X][]` where the string IS the enum value — just cast `typeStr as UnitType`
- `Object.keys()` same — the keys are the string values

### 4. CLI Resolver
**Files**: `src/game/cli/enum-resolver.ts`
**Key decisions**:
- Change `UNIT_INDEX` from `indexNumericEnum(UnitType ...)` to `indexStringEnum(UnitType ...)`
- Change `resolveUnit()` return type from `number` to `UnitType` (or `string`, then cast)
- Callers of `resolveUnit()` will get a `UnitType` string directly instead of a number

### 5. SubType Cast Cleanup
**Files**: ~40 files with `subType as UnitType` (77 occurrences)
**Key decisions**:
- Most `subType as UnitType` casts remain valid — subType is `number | string`, and for units it will be a UnitType string
- `subType as number` in UnitType contexts (e.g., `UnitType[e.subType as number]`) — these are handled by subsystem 2
- `entity.subType as number` where used for UnitType lookups like `UNIT_TYPE_CONFIG[subType as UnitType]` — already correct, no change
- Patterns like `bottleneck-detection.ts` using `subType as number` for non-carrier checks — change to `subType as UnitType`

### 6. Test Updates
**Files**: test files with `UnitType[value]` or numeric casts
**Key decisions**:
- Same patterns as subsystems 2 and 3 — replace reverse lookups, fix numeric casts
- Test assertions comparing UnitType values work unchanged (comparing string to string)

## File Map

### Modified Files

| File | Change |
|------|--------|
| `src/game/core/unit-types.ts` | Enum values: numeric → PascalCase string; fix `getUnitTypesInCategory` |
| `src/game/cli/enum-resolver.ts` | Switch UnitType to `indexStringEnum`; update `resolveUnit` return type |
| `src/game/data/settler-data-access.ts` | Remove `Number()` casts (2 occurrences) |
| `src/game/renderer/sprite-unit-loader.ts` | Remove `Number()` cast |
| `src/game/renderer/sprite-metadata/sprite-metadata.ts` | Remove `Number()` cast |
| ~25 files with `UnitType[val]` | Remove reverse-lookup, use value directly |
| ~10 files with `subType as number` in UnitType contexts | Change to `subType as UnitType` |
| `src/game/state/game-state-persistence.ts` | Bump `SNAPSHOT_VERSION` |

### No New Files

## Verification

- `pnpm lint` passes (type-check + ESLint)
- `pnpm test:unit` passes — all unit/integration tests green
- Load a test map (`?testMap=true`) — units spawn, move, work, and render correctly
- Debug panel / CLI shows human-readable unit names without reverse-lookup formatting
- Recruitment and military training produce correct unit types
