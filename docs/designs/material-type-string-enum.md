# EMaterialType Numeric → String Enum — Design

## Overview

Convert `EMaterialType` from a numeric enum (`LOG = 0, STONE = 1, ...`) to a string enum (`LOG = 'LOG', STONE = 'STONE', ...`). This eliminates reverse-lookup boilerplate (`EMaterialType[value]`), improves debuggability, and makes serialized data human-readable.

## Current State

- **What exists**: `EMaterialType` is a numeric enum with 42 members (0–40 + `NO_MATERIAL = 99`) in `src/game/economy/material-type.ts`
- **Scope**: ~1267 references across ~143 files
- **What stays**: All enum member names, `MATERIAL_CONFIGS`, helper functions, `S4_TO_MATERIAL_TYPE` mapping
- **What changes**:
  - Enum values become strings
  - Reverse-lookup patterns (`EMaterialType[numericValue]`) replaced with direct value usage
  - `Entity.subType: number` widened to accommodate string material types for piles
  - `Number(typeStr) as EMaterialType` cast patterns replaced (these iterate `Record<EMaterialType, ...>` via `Object.entries`)
  - Binary boundary (`S4GoodType` → `EMaterialType`) stays as explicit mapping

## Summary for Review

- **Interpretation**: Change enum backing values from integers to their own names as strings. All member names stay identical. The numeric→string boundary moves to `S4_TO_MATERIAL_TYPE` and the binary map parsers, which already have explicit mappings.
- **Key decisions**:
  - `Entity.subType` becomes `number | string` — this is the minimal change since BuildingType/UnitType/MapObjectType remain numeric. A typed union discriminated on `EntityType` would be cleaner but is a much larger refactor (out of scope).
  - No migration/compatibility layer for persistence — superjson serializes Map keys natively, and the replay system records commands (which use enum members, not raw values). Any existing saves break cleanly (load fails rather than silent corruption).
  - `RESOURCE_JOB_INDICES` and `CARRIER_MATERIAL_JOB_INDICES` keep their `Record<EMaterialType, number>` shape — TypeScript handles string enum keys in Records fine.
- **Assumptions**: No save-file backward compatibility needed (dev-phase project). No numeric EMaterialType values appear as raw literals in the codebase (per project rule).
- **Scope**: EMaterialType only. Other numeric enums (BuildingType, UnitType, EntityType) are not touched.

## Conventions

- Optimistic programming: no fallbacks, trust contracts, throw with context
- Use `!` assertion or `getEntityOrThrow` — never `?.` on required values
- Max 600 lines/file, 250 lines/function, 15 cyclomatic complexity
- Use `sd` for mass replacements; dry-run first
- Use `rename_symbol_strict` (cclsp MCP) for symbol renames; prefer mass tooling over manual edits
- Always use enum members, never numeric literals (already enforced)

## Architecture

### Subsystems

| # | Subsystem | Responsibility | Depends On | Files |
|---|-----------|---------------|------------|-------|
| 1 | Enum Definition | Change enum values to strings | — | `src/game/economy/material-type.ts` |
| 2 | Entity Type Widening | Widen `Entity.subType` for string material types | 1 | `src/game/entity.ts` |
| 3 | Reverse-Lookup Elimination | Replace `EMaterialType[value]` → direct value usage | 1 | ~34 files (see file map) |
| 4 | Cast Pattern Updates | Fix `Number(typeStr) as EMaterialType` and `parseInt(...) as EMaterialType` | 1 | ~7 files (sprite metadata, pile registry, views) |
| 5 | Sprite & Renderer | Update sprite record iteration and `subType as EMaterialType` casts | 1, 2 | renderer files |
| 6 | Test Updates | Fix test assertions and helpers that use reverse lookup or numeric casts | 1, 3 | test files |

## Shared Contracts

```typescript
// src/game/economy/material-type.ts — NEW shape
export enum EMaterialType {
    LOG = 'LOG',
    STONE = 'STONE',
    COAL = 'COAL',
    IRONORE = 'IRONORE',
    GOLDORE = 'GOLDORE',
    GRAIN = 'GRAIN',
    PIG = 'PIG',
    WATER = 'WATER',
    FISH = 'FISH',
    BOARD = 'BOARD',
    IRONBAR = 'IRONBAR',
    GOLDBAR = 'GOLDBAR',
    FLOUR = 'FLOUR',
    BREAD = 'BREAD',
    MEAT = 'MEAT',
    WINE = 'WINE',
    AXE = 'AXE',
    PICKAXE = 'PICKAXE',
    SAW = 'SAW',
    HAMMER = 'HAMMER',
    SCYTHE = 'SCYTHE',
    ROD = 'ROD',
    SWORD = 'SWORD',
    BOW = 'BOW',
    SULFUR = 'SULFUR',
    ARMOR = 'ARMOR',
    BATTLEAXE = 'BATTLEAXE',
    AGAVE = 'AGAVE',
    BLOWGUN = 'BLOWGUN',
    GOAT = 'GOAT',
    MEAD = 'MEAD',
    HONEY = 'HONEY',
    SHEEP = 'SHEEP',
    SHOVEL = 'SHOVEL',
    CATAPULT = 'CATAPULT',
    GOOSE = 'GOOSE',
    TEQUILA = 'TEQUILA',
    SUNFLOWER = 'SUNFLOWER',
    SUNFLOWEROIL = 'SUNFLOWEROIL',
    AMMO = 'AMMO',
    GUNPOWDER = 'GUNPOWDER',
    NO_MATERIAL = 'NO_MATERIAL',
}

// src/game/entity.ts — Entity.subType widened
export interface Entity {
    // ...existing fields...
    subType: number | string;  // number for Building/Unit/MapObject, string (EMaterialType) for StackedPile
    // ...
}
```

## Subsystem Details

### 1. Enum Definition
**Files**: `src/game/economy/material-type.ts`
**Key decisions**:
- String values are UPPERCASE matching member names (e.g., `LOG = 'LOG'`) — matches existing display conventions and XML naming
- `NO_MATERIAL` becomes `'NO_MATERIAL'` (no longer `99`) — any code comparing against `99` would already be a bug per project rules
- `MATERIAL_CONFIGS`, `DROPPABLE_MATERIALS`, helper functions: no changes needed (they use enum members as keys, not numeric values)

### 2. Entity Type Widening
**Files**: `src/game/entity.ts`
**Key decisions**:
- `subType: number | string` is the minimal change. Only StackedPile entities use string subTypes.
- `addEntity()` in `GameState` must accept `number | string` for the subType parameter
- Pile-related code already casts `entity.subType as EMaterialType` — these casts remain valid since EMaterialType is now a string and subType accepts strings

### 3. Reverse-Lookup Elimination
**Files**: ~34 files with `EMaterialType[value]` patterns (82 occurrences)
**Key decisions**:
- `EMaterialType[numericValue]` → just use the value directly (it's already a string)
- Pattern: `EMaterialType[entity.carrying.material]` → `entity.carrying.material` (since `.material` is typed `EMaterialType` which is now a string)
- Display formatting like `.charAt(0) + .slice(1).toLowerCase()` keeps working — input is the same string, just sourced differently
- This is the bulk of the work — use `sd` for mass replacement with careful patterns

### 4. Cast Pattern Updates
**Files**: `src/game/renderer/sprite-metadata/sprite-metadata.ts`, `src/game/renderer/sprite-metadata/jil-indices.ts`, `src/game/renderer/sprite-loaders/good-sprite-loader.ts`, `src/game/renderer/sprite-unit-loader.ts`, `src/game/systems/inventory/pile-registry.ts`, `src/views/jil-view-lookups.ts`
**Key decisions**:
- `Number(typeStr) as EMaterialType` patterns exist because `Object.entries()` on `Record<EMaterialType, number>` yields string keys — with string enum, the keys ARE the enum values, so just cast `typeStr as EMaterialType`
- `parseInt(materialStr, 10) as EMaterialType` in pile-registry.ts — this parses material type from some string key; needs to become direct cast since values are now strings
- `CARRIER_MATERIAL_JOB_INDICES` construction: `Object.entries(RESOURCE_JOB_INDICES).map(([type, idx]) => [Number(type), idx + 1])` → remove the `Number()` call, keep type as-is

### 5. Sprite & Renderer
**Files**: `src/game/renderer/entity-sprite-resolver.ts`, `src/game/renderer/entity-depth-sorter.ts`, `src/game/renderer/optimized-depth-sorter.ts`, `src/game/renderer/render-passes/color-entity-pass.ts`
**Key decisions**:
- `entity.subType as EMaterialType` casts remain — subType is now `number | string`, and for piles it's a string EMaterialType value
- `getGoodSprite(entity.subType as EMaterialType, ...)` — no change needed, just a cast narrowing
- Sprite category `Map<EMaterialType, Map<number, SpriteEntry>>` — works with string keys

### 6. Test Updates
**Files**: test files using `EMaterialType[value]` for assertion messages and display
**Key decisions**:
- Same pattern as subsystem 3 — replace reverse lookups with direct value usage
- Test assertions comparing EMaterialType values work unchanged (comparing string to string)

## File Map

### Modified Files

| File | Change |
|------|--------|
| `src/game/economy/material-type.ts` | Enum values: numeric → string |
| `src/game/entity.ts` | `subType: number` → `number \| string` |
| `src/game/game-state.ts` | `addEntity` subType param: accept `number \| string` |
| ~34 files with `EMaterialType[val]` | Remove reverse-lookup, use value directly |
| ~7 files with `Number(typeStr) as EMaterialType` | Remove `Number()`, cast string directly |
| `src/game/renderer/sprite-metadata/jil-indices.ts` | `CARRIER_MATERIAL_JOB_INDICES`: remove `Number()` in construction |
| `src/game/systems/inventory/pile-registry.ts` | `parseInt` cast → direct string cast |
| `src/views/jil-view-lookups.ts` | Remove `Number()` casts |
| `src/game/features/settler-tasks/worker-task-executor.ts` | `EMaterialType[key as keyof typeof EMaterialType]` → direct access |

### No New Files

## Verification

- `pnpm lint` passes (type-check + ESLint)
- `pnpm test:unit` passes — all economy, inventory, logistics, construction tests green
- Load a test map (`?testMap=true`) — piles render correctly, carriers pick up and deliver materials
- Debug panel / CLI shows human-readable material names without reverse-lookup formatting
