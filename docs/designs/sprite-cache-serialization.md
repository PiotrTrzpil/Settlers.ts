# Sprite Cache Serialization Redesign — Design

## Overview

Redesign the sprite metadata serialization so that each sprite category is responsible for its own `serialize()`/`deserialize()` methods. The central `SpriteMetadataSerializer` class is eliminated — the registry just iterates its categories and delegates. Each category's serialized format is an opaque blob: the registry never knows what's inside (e.g. it doesn't know `DecorationSpriteCategory` has two flag types internally, or that `AnimatedEntityCategory` splits shared vs per-race).

## Current State

- **What exists**: `SpriteMetadataSerializer` is a 300-line static class that knows about all 7 category types, their internal Map structures, and legacy formats. Every category exposes raw `getXxxMap()`/`setXxxMap()` methods solely for the serializer's benefit.
- **What stays**: `SpriteMetadataRegistry` remains the facade, category classes remain the storage, `SpriteEntry`/`AnimatedSpriteEntry` types are unchanged, cache format stored in IndexedDB + module-level Map via `sprite-atlas-cache.ts`.
- **What changes**: Serialization moves into categories. Legacy format support is dropped (bump `CACHE_SCHEMA_VERSION`). Raw map-exposure methods (`getRaceMap()`, `getFlagsMap()`, etc.) that exist only for serialization are replaced by `serialize()`/`deserialize()` on each category. `SpriteMetadataSerializer` is deleted.
- **What gets deleted**: `sprite-metadata-serializer.ts`, `sprite-metadata-helpers.ts` (if `mapToArray`/`arrayToMap` move into a shared util or inline into categories).

## Summary for Review

- **Interpretation**: The serializer shouldn't be a god-class that knows every category's internals. Each category should own its own cache format as an opaque blob. The registry delegates `serialize()`/`deserialize()` without knowing what's inside — it never needs to know that `DecorationSpriteCategory` has two flag types and territory dots, or that `AnimatedEntityCategory` has shared vs per-race storage. That's each category's private concern.
- **Key decisions**:
  1. Each category class gets `serialize(): unknown` and `static deserialize(data: unknown): CategoryType` methods. The registry just collects/dispatches.
  2. Category count stays at 7 — no merging. The categories are already well-scoped; the problem was the serializer reaching into their internals, not the number of categories.
  3. Legacy deserialization (old cache keys like `buildings`, `animatedBuildings`, `animatedMapObjects`, `animatedUnits`) is dropped. Bump `CACHE_SCHEMA_VERSION` to force re-parse.
  4. The `mapToArray`/`arrayToMap` helpers stay as a shared utility (used by multiple categories).
- **Assumptions**: Dropping legacy cache format is acceptable (users just re-load sprites once). The `ISpriteCategory<K>` interface in `types.ts` is unused and can be removed.
- **Scope**: Serialization refactor only. No changes to sprite loading, rendering, or the public API of `SpriteMetadataRegistry` (getters stay the same). The `getXxxMap()`/`setXxxMap()` methods are removed from categories since serialize/deserialize replace them.

## Conventions

- Optimistic programming: no defensive `?.` on required paths, throw with context
- Functions ≤80 lines (aim), files ≤400 lines (aim), ≤600 hard limit
- Config objects for 3+ constructor params
- `mapToArray`/`arrayToMap` for JSON-safe Map round-tripping
- No `Pick`/`Omit` for public APIs
- Layer architecture: categories are internal to `sprite-metadata/`, only registry is exported

## Architecture

### Subsystems

| # | Subsystem | Responsibility | Depends On | Files |
|---|-----------|---------------|------------|-------|
| 1 | Serialization interface | Define the `Serializable` contract categories must implement | — | `types.ts` |
| 2 | Category self-serialization | Add `serialize()`/`deserialize()` to each category, remove raw map getters used only for serialization | 1 | `categories/*.ts` |
| 3 | Registry delegation | Replace `SpriteMetadataSerializer` calls with direct category delegation | 2 | `sprite-metadata.ts` |
| 4 | Cleanup & version bump | Delete `SpriteMetadataSerializer`, bump cache version | 3 | `sprite-metadata-serializer.ts`, `sprite-atlas-cache.ts` |

## Shared Contracts

```typescript
// Added to types.ts — contract for serializable categories
interface SerializableSpriteCategory {
    /** Produce a JSON-safe representation of this category's data */
    serialize(): unknown;
    /** Clear and repopulate from serialized data */
    clear(): void;
}

// Each category class gets a static deserialize:
// static deserialize(data: unknown): CategoryType

// The registry's serialize() output changes shape:
interface SerializedRegistryData {
    version: number; // for future format changes within the cache schema
    buildings: unknown;
    units: unknown;
    mapObjects: unknown;
    goods: unknown;
    decoration: unknown; // flags, flagsDown, territoryDots
    overlays: unknown;
    animatedShared: unknown;
    animatedByRace: unknown;
    loadedRaces: number[];
}
```

```typescript
// mapToArray / arrayToMap stay in sprite-metadata-helpers.ts (no change)
// They are used by multiple categories so they remain shared.
```

## Subsystem Details

### 1. Serialization interface
**Files**: `src/game/renderer/sprite-metadata/types.ts`
**Key decisions**:
- Add `SerializableSpriteCategory` interface alongside existing types
- Remove the unused `ISpriteCategory<K>` interface
- `serialize()` returns `unknown` (not a specific type) — each category defines its own format internally
- `deserialize()` is a static factory on each class (not on the interface, since TS interfaces can't declare statics) — document by convention

### 2. Category self-serialization
**Files**: All files in `src/game/renderer/sprite-metadata/categories/`
**Depends on**: Subsystem 1
**Key decisions**:
- Each category adds `serialize(): unknown` and `static deserialize(data: unknown): Self`
- `serialize()` replaces the need for `getRaceMap()`, `getEntries()`, `getFlagsMap()`, `getFlagsDownMap()`, `getTerritoryDotsMap()`, `getFramesMap()` — these raw getters are removed IF they have no other consumers. Check `SpriteMetadataRegistry` methods like `getLayersForBuildings()` that use `getRaceMap()` directly — those stay.
- `AnimatedEntityCategory` splits its serialize into shared + byRace sections internally, producing `{ shared: ..., byRace: ... }`
- `mapToArray`/`arrayToMap` imported from helpers as before
- No legacy format handling in any deserialize method

**Per-category serialization format (internal, not a shared contract):**

| Category | Serialized shape |
|----------|-----------------|
| `BuildingSpriteCategory` | `Array<[race, Array<[BuildingType, BuildingSpriteEntries]>]>` |
| `UnitSpriteCategory` | `Array<[race, Array<[UnitType, Array<[direction, SpriteEntry]>]>]>` |
| `MapObjectSpriteCategory` | `Array<[MapObjectType, SpriteEntry[]]>` |
| `GoodSpriteCategory` | `Array<[EMaterialType, Array<[direction, SpriteEntry]>]>` |
| `DecorationSpriteCategory` | `{ flags: ..., flagsDown: ..., territoryDots: ... }` |
| `OverlaySpriteCategory` | `Array<[compositeKey, SpriteEntry[]]>` |
| `AnimatedEntityCategory` | `{ shared: Array<[entityType, Array<[subType, SerializedAnimEntry]>]>, byRace: Array<[race, Array<[entityType, Array<[subType, SerializedAnimEntry]>]>]> }` |

**Getter removal check**: `getRaceMap()` on `BuildingSpriteCategory` is used by `SpriteMetadataRegistry.getLayersForBuildings()` and `deserialize()` — after this refactor, `deserialize()` no longer needs it (the category handles itself), but `getLayersForBuildings()` still does. So `getRaceMap()` stays on `BuildingSpriteCategory` and `UnitSpriteCategory`. The serialization-only setters (`setRaceEntry`, `setEntries`, `setFlagsMap`, `setTerritoryDotsMap`) are internalized into each category's `static deserialize()`.

### 3. Registry delegation
**Files**: `src/game/renderer/sprite-metadata/sprite-metadata.ts`
**Depends on**: Subsystem 2
**Key decisions**:
- `SpriteMetadataRegistry.serialize()` becomes a thin wrapper:
  ```typescript
  serialize(): SerializedRegistryData {
      return {
          version: 1,
          buildings: this.buildings.serialize(),
          units: this.units.serialize(),
          mapObjects: this.mapObjectsCategory.serialize(),
          goods: this.goodsCategory.serialize(),
          decoration: this.decoration.serialize(),
          overlays: this.overlays.serialize(),
          animatedShared: this.animated.serializeShared(),
          animatedByRace: this.animated.serializeByRace(),
          loadedRaces: [...this._loadedRaces],
      };
  }
  ```
- `SpriteMetadataRegistry.deserialize()` (static) creates a new registry and calls each category's static `deserialize()`:
  ```typescript
  static deserialize(data: SerializedRegistryData): SpriteMetadataRegistry {
      const registry = new SpriteMetadataRegistry();
      // Each category's static deserialize returns a populated instance
      // Registry swaps in the deserialized category (or copies data into its own)
      ...
  }
  ```
- The registry's private category fields need to be reassignable OR the deserialized data is copied in. Simplest: make the fields non-readonly and reassign after `deserialize()`. Alternative: keep readonly and use a private `restore()` method that calls category-level `restoreFrom(data)`.
- **Decision**: Use reassignment (drop `readonly` on the 7 category fields). The fields are already private — no external mutation risk. This avoids needing a second set of "copy into existing instance" methods.
- Remove the import of `SpriteMetadataSerializer`

### 4. Cleanup & version bump
**Files**: `src/game/renderer/sprite-metadata/sprite-metadata-serializer.ts` (delete), `src/game/renderer/sprite-cache/sprite-atlas-cache.ts` (bump version)
**Key decisions**:
- Delete `sprite-metadata-serializer.ts` entirely
- Delete `sprite-metadata-helpers.ts` ONLY if no other file imports it. If categories import it, keep it.
- Bump `CACHE_SCHEMA_VERSION` (currently v20 → v21) to invalidate old caches
- The `SerializedAnimEntry` type and `serializeAnimEntry`/`deserializeAnimEntry` helpers move into `animated-entity-category.ts` (they're only used there now)
- `SpriteMetadataRegistry.serialize()` return type changes to `SerializedRegistryData` instead of `Record<string, unknown>` — update the `CachedAtlasData.registryData` type in `sprite-atlas-cache.ts` accordingly

## File Map

### New Files
None — all changes are in existing files.

### Modified Files
| File | Change |
|------|--------|
| `sprite-metadata/types.ts` | Add `SerializableSpriteCategory` interface, remove `ISpriteCategory<K>` |
| `categories/building-sprite-category.ts` | Add `serialize()`/`static deserialize()`, remove `setRaceEntry()` |
| `categories/unit-sprite-category.ts` | Add `serialize()`/`static deserialize()`, remove `setRaceEntry()` |
| `categories/map-object-sprite-category.ts` | Add `serialize()`/`static deserialize()`, remove `setEntries()` |
| `categories/good-sprite-category.ts` | Add `serialize()`/`static deserialize()`, remove `setEntries()` |
| `categories/decoration-sprite-category.ts` | Add `serialize()`/`static deserialize()`, remove `setFlagsMap()`/`setFlagsDownMap()`/`setTerritoryDotsMap()` |
| `categories/overlay-sprite-category.ts` | Add `serialize()`/`static deserialize()`, remove `getFramesMap()` |
| `categories/animated-entity-category.ts` | Add `serialize()`/`static deserialize()`, absorb `SerializedAnimEntry` + helpers from serializer |
| `sprite-metadata/sprite-metadata.ts` | Rewrite `serialize()`/`deserialize()` to delegate, remove serializer import, make category fields non-readonly |
| `sprite-cache/sprite-atlas-cache.ts` | Bump `CACHE_SCHEMA_VERSION`, update `registryData` type |
| `sprite-metadata/categories/index.ts` | No change expected (still exports all categories) |

### Deleted Files
| File | Reason |
|------|--------|
| `sprite-metadata/sprite-metadata-serializer.ts` | Replaced by per-category serialize/deserialize |

## Verification
1. `pnpm lint` passes with no new errors
2. Load the game with a cleared IndexedDB cache — sprites load and render correctly
3. Reload the page — sprites restore from cache (IndexedDB hit, no re-parse of GFX files)
4. Run unit tests — no regressions in sprite-related tests
