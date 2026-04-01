# Progressive Sprite Loading — Design

## Overview

Restructure sprite loading to use priority tiers so the most visually important sprites appear first. Currently all sprites for a category+race load atomically. After this change, loading proceeds in priority order: current player race first, completed buildings before construction, standing unit poses before walking animations.

## Current State

- **Loading sequence**: map objects → buildings (all races) → goods → units (per-race with `yieldToEventLoop` between races)
- **Within a race**: all sprite types load atomically via `loadMultiJobBatch` (all directions × all frames in one worker round-trip)
- **GPU pipeline**: `SafeLoadBatch` enforces load → `atlas.update(gl)` → register. Budgeted upload (`uploadBudgeted(gl, maxLayers)`) exists for frame-loop streaming but isn't used during initial load
- **Category gates**: `isRaceLoaded` / `isLoaded` on each category; registry facade returns `undefined` when gate is closed
- **Unit fallback**: `dirMap.get(direction) ?? dirMap.get(0)!` — direction 0 serves as universal fallback

**What stays**: SafeLoadBatch pattern, worker-based batch decoding, atlas packing, category gate pattern, `uploadBudgeted` for frame-loop streaming

**What changes**: loading orchestration order, `loadMultiJobBatch` gains subset support, unit loader splits into phases

## Summary for Review

- **Interpretation**: Load sprites in priority order so the game becomes playable faster. Current player's race loads entirely before other races. Within each race: completed buildings → standing units → construction sprites → walking units → full animations.
- **Key decisions**: 
  - No new categories needed for unit sub-tiers — direction 0 fallback handles partial load naturally
  - `buildJobManifest` gains filtering params (specific directions, frame-0-only) rather than adding new top-level methods
  - Each priority tier is a separate `SafeLoadBatch` with its own GPU upload + registration
  - Race priority is caller-controlled (SpriteRenderManager), not baked into loaders
- **Assumptions**: 
  - Direction 0, frame 0 is always the standing pose (confirmed by existing `registerUnit` using `frames[0]!`)
  - Cross-race fallback was wrong and is removed (each race independent)
  - `isRaceLoaded` marks true after standing tier completes (earliest useful state)
- **Scope**: Restructure loading order and batch APIs. Does NOT change atlas streaming, decoder pool, or category data structures. Defers map-object/goods staging (low impact — they load once and fast).

## Conventions

- Optimistic programming — no fallbacks, throw on contract violations, trust guarantees
- Max 250 lines per function, max 600 lines per TS file — extract early
- `SafeLoadBatch` pattern is mandatory for all sprite registration (GPU upload before register)
- `yieldToEventLoop()` between major loading phases for UI responsiveness
- No cross-race sprite fallback — each race is independent

## Architecture

### Subsystems

| # | Subsystem | Responsibility | Depends On | Files |
|---|-----------|---------------|------------|-------|
| 1 | Manifest builder | Build filtered decode manifests (subset of dirs/frames) | — | `sprite-loader.ts` |
| 2 | Unit loader phases | Split unit loading into standing → walking → animations | 1 | `sprite-unit-loader.ts` |
| 3 | Building loader phases | Split into completed → construction tiers | 1 | `building-sprite-loader.ts` |
| 4 | Load orchestrator | Schedule tiers in priority order, current race first | 2, 3 | `sprite-render-manager.ts` |

## Shared Contracts

```typescript
// === New filter options for buildJobManifest (Subsystem 1) ===

/** Controls which subset of a job's directions × frames to include in a manifest. */
interface JobManifestFilter {
    /** If set, only include these direction indices. Default: all. */
    directions?: number[];
    /** If true, only include frame 0 of each direction. Default: false (all frames). */
    firstFrameOnly?: boolean;
}

// === Extended loadMultiJobBatch signature (Subsystem 1) ===

// Before:
//   loadMultiJobBatch(fileSet, jobIndices, atlas, paletteBase): Promise<Map<job, Map<dir, LoadedSprite[]>>>
// After:
//   loadMultiJobBatch(fileSet, jobIndices, atlas, paletteBase, filter?): Promise<Map<job, Map<dir, LoadedSprite[]>>>

// === Unit loader phase functions (Subsystem 2) ===

/** Load direction 0, frame 0 for all unit types. Registers static sprites. */
// loadUnitStanding(ctx: UnitFileCtx): Promise<number>

/** Load frame 0 of all remaining directions. Registers static sprites per direction. */
// loadUnitWalking(ctx: UnitFileCtx): Promise<number>

/** Load all remaining frames. Registers full AnimatedSpriteEntry per unit. */
// loadUnitAnimations(ctx: UnitFileCtx): Promise<number>

// === Building loader split (Subsystem 3) ===

/** Load completed building sprites only (D1 direction). */
// loadCompletedBuildingSprites(ctx: SpriteLoadContext): Promise<{ loaded: boolean }>

/** Load construction building sprites only (D0 direction). */
// loadConstructionBuildingSprites(ctx: SpriteLoadContext): Promise<{ loaded: boolean }>

// === Orchestrator loading tiers (Subsystem 4) ===

// Tier 0 (critical): map objects, goods (not race-keyed, load once)
// Tier 1 (current race): completed buildings → standing units
// Tier 2 (current race): construction buildings → walking units
// Tier 3 (current race): full unit animations + carrier variants + worker animations
// Tier 4-6: repeat tiers 1-3 for each other race
```

## Subsystem Details

### 1. Manifest Builder
**Files**: `src/game/renderer/sprite-loader.ts`
**Key decisions**:
- Add `filter?: JobManifestFilter` param to `buildJobManifest` and `buildMultiJobManifest`
- When `firstFrameOnly: true`, the manifest includes only the first GIL frame per direction
- When `directions` is set, skip directions not in the list
- `loadMultiJobBatch` passes filter through to manifest builder — no other API changes needed
- `loadJobAllDirections` also gains the filter param for per-direction loading

### 2. Unit Loader Phases
**Files**: `src/game/renderer/sprite-unit-loader.ts`
**Key decisions**:
- Split `loadBaseUnits` into three functions: `loadUnitStanding`, `loadUnitWalking`, `loadUnitAnimations`
- `loadUnitStanding` uses `filter: { directions: [0], firstFrameOnly: true }` — one sprite per unit type
- `loadUnitWalking` uses `filter: { firstFrameOnly: true }` — frame 0 of all directions (direction 0 already loaded, re-registering is harmless)
- `loadUnitAnimations` loads everything (no filter) — full `loadMultiJobBatch` as today, then registers `AnimatedSpriteEntry`
- Each phase has its own `SafeLoadBatch` → GPU upload → register cycle
- `isRaceLoaded` is set after standing phase (direction 0 exists, fallback works for all directions)
- `loadCarrierVariants` and `loadAllWorkerAnimations` move to tier 3 (animations)
- Public API becomes `loadUnitStanding`, `loadUnitWalking`, `loadUnitAnimations` (replacing `loadUnitSpritesForRace`)

### 3. Building Loader Phases
**Files**: `src/game/renderer/sprite-loaders/building-sprite-loader.ts`
**Key decisions**:
- Split `loadBuildingSpritesFromFile` into two: one for completed (D1), one for construction (D0)
- Export `loadCompletedBuildingSprites` and `loadConstructionBuildingSprites`
- Each uses its own `SafeLoadBatch` and registers to its respective category
- Animation frames (multi-frame completed buildings) load with completed sprites (they share the D1 direction)

### 4. Load Orchestrator
**Files**: `src/game/renderer/sprite-render-manager.ts`
**Key decisions**:
- Replace flat loading sequence with tiered approach
- Current player race comes from `SpriteRenderManager._currentRace` (already tracked)
- Other races load in `AVAILABLE_RACES` order, skipping current
- `yieldToEventLoop()` between every tier to keep UI responsive
- Each tier: load → SafeLoadBatch.finalize (GPU upload + register) → yield

**Loading order**:
```
// Tier 0: Global (no race)
loadMapObjectSprites
loadGoodSprites

// Tier 1: Current race — critical
loadCompletedBuildingSprites(currentRace)
loadUnitStanding(currentRace)
loadSelectionIndicators

// Tier 2: Current race — construction + walking
loadConstructionBuildingSprites(currentRace)
loadUnitWalking(currentRace)

// Tier 3: Current race — animations
loadUnitAnimations(currentRace)  // includes carriers + worker anims

// Tiers 4-6: Repeat 1-3 for each other race
for (race of otherRaces) {
    loadCompletedBuildingSprites(race)
    loadUnitStanding(race)
    loadConstructionBuildingSprites(race)
    loadUnitWalking(race)
    loadUnitAnimations(race)
}

// Final: overlay sprites (needed for smoke/flags on buildings)
loadOverlaySprites
```

## File Map

### New Files
None — all changes are to existing files.

### Modified Files
| File | Change |
|------|--------|
| `src/game/renderer/sprite-loader.ts` | Add `JobManifestFilter` type, add `filter?` param to `buildJobManifest`, `buildMultiJobManifest`, `loadMultiJobBatch` |
| `src/game/renderer/sprite-unit-loader.ts` | Split `loadBaseUnits` → `loadUnitStanding` + `loadUnitWalking` + `loadUnitAnimations`; export all three; remove `loadUnitSpritesForRace` |
| `src/game/renderer/sprite-loaders/building-sprite-loader.ts` | Split into `loadCompletedBuildingSprites` + `loadConstructionBuildingSprites` |
| `src/game/renderer/sprite-render-manager.ts` | Rewrite `loadSprites` to use tiered loading order with current race priority |

## Verification
- With slow network simulation: current player's buildings and standing units appear before other races load
- Construction sprites for a building appear when placement starts (may briefly show completed sprite as placeholder if construction tier hasn't loaded)
- Unit walking animation degrades gracefully to standing pose during tier 1, then shows directional walking in tier 2, then full animation in tier 3
- Cache serialization/deserialization still works (data format unchanged, only loading order changed)
