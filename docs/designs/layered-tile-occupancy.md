# Layered Tile Occupancy — Design

## Overview

Replace the single `tileOccupancy: Map<string, number>` with two independent occupancy layers: `groundOccupancy` (buildings, map objects, piles) and `unitOccupancy` (walking units). This fixes the fundamental problem that a single-entity-per-tile map cannot represent legitimate coexistence of ground entities and units on the same tile.

## Current State

- **What exists**: `tileOccupancy` in `GameState` maps `"x,y"` → single entityId. Buildings, map objects, piles, and units all compete for the same slot. Workarounds include:
  - `updateEntityPosition` skips overwriting "static" entries (buildings/map objects)
  - `restoreTileOccupancy` checks if existing occupant is a unit before overwriting
  - `plant_crop` does `if (existing.type !== EntityType.Unit)` to allow planting on unit tiles
  - `map-settlers.ts` skips occupancy when spawning units on building footprints
  - MovementSystem maintains a **private `unitPositions`** map as a shadow layer to work around `tileOccupancy` limitations
- **What stays**:
  - `buildingOccupancy: Set<string>` — pathfinding blocking (unchanged)
  - `buildingFootprint: Set<string>` — placement gap checks (unchanged)
  - `getEntityAt()` — returns an entity at a tile (signature changes; see Shared Contracts)
  - All placement validators continue to use occupancy for placement checks
- **What changes**:
  - `tileOccupancy` splits into `groundOccupancy` + `unitOccupancy`
  - `getEntityAt()` gains an optional layer parameter, defaults to ground
  - `getUnitAt()` promoted from MovementSystem private → GameState public
  - MovementSystem's private `unitPositions` is replaced by `GameState.unitOccupancy`
  - All callers updated to query the correct layer
- **What gets deleted**:
  - `MovementSystem.unitPositions` (replaced by `GameState.unitOccupancy`)
  - `MovementSystem.getUnitAt()` private method (replaced by `GameState.getUnitAt()`)
  - The `if (type !== Unit)` / `if (occupant?.type === Unit)` guards in `updateEntityPosition`, `restoreTileOccupancy`, `clearTileOccupancy`, `plant_crop`

## Summary for Review

- **Interpretation**: Split tileOccupancy into two maps so ground entities (buildings, trees, crops, stones, piles) and units (settlers, military) live in independent layers. A tile can have one ground entity AND one unit simultaneously.
- **Key decisions**:
  - Two maps in GameState, not a generic N-layer system — only two layers are needed
  - `getEntityAt()` defaults to ground layer (most callers want ground checks)
  - New `getUnitAt(x, y)` on GameState replaces MovementSystem's private `unitPositions` + `getUnitAt()`
  - Placement validators check `groundOccupancy` (units don't block placement)
  - `findEmptySpot` checks `groundOccupancy` only (carriers don't block planting)
- **Assumptions**: Buildings keep their own footprint in `groundOccupancy` (unchanged from current behavior). The `occupancy?: boolean` option on `addUnit` maps to skipping `unitOccupancy` registration.
- **Scope**: Core occupancy refactor + all caller updates. Does NOT change pathfinding (still uses `buildingOccupancy` bitmap). Does NOT change spatial grid or entity index.

## Conventions

- Optimistic programming: no `?.` on required deps, no silent fallbacks, `getEntityOrThrow` for stored IDs
- Event names: `"domain:pastTenseVerb"` format
- Layer architecture: occupancy is Layer 2 (infra) — no feature imports
- Max 140 char lines, max complexity 15
- Always use enum members, never numeric literals
- Commands return boolean (success/failure), not exceptions

## Architecture

### Subsystems

| # | Subsystem | Responsibility | Depends On | Files |
|---|-----------|---------------|------------|-------|
| 1 | Core Occupancy | Split tileOccupancy, update GameState API | — | `src/game/game-state.ts` |
| 2 | Movement Integration | Remove unitPositions shadow, use GameState.unitOccupancy | 1 | `src/game/systems/movement/movement-system.ts`, `src/game/game-services.ts` |
| 3 | Placement Validators | Switch to groundOccupancy | 1 | `src/game/systems/placement/internal/*.ts`, `src/game/systems/placement/types.ts`, `src/game/systems/placement/valid-position-grid.ts` |
| 4 | Caller Migration | Update all getEntityAt/tileOccupancy consumers | 1 | Commands, systems, features, UI, tests |

## Shared Contracts

```typescript
// --- GameState public API changes ---

// REPLACES: tileOccupancy: Map<string, number>
/** Ground-layer occupancy: buildings (footprints), map objects, stacked piles */
public groundOccupancy: Map<string, number> = new Map();

/** Unit-layer occupancy: all walking/visible units (settlers, military) */
public unitOccupancy: Map<string, number> = new Map();

// buildingOccupancy and buildingFootprint remain unchanged

/** Get the ground entity (building/map-object/pile) at a tile, or undefined. */
public getGroundEntityAt(x: number, y: number): Entity | undefined;

/** Get the unit at a tile, or undefined. */
public getUnitAt(x: number, y: number): Entity | undefined;

/**
 * Get any entity at a tile. Checks ground first, then unit layer.
 * Most callers should use getGroundEntityAt() or getUnitAt() instead.
 */
public getEntityAt(x: number, y: number): Entity | undefined;

// --- MovementSystemConfig changes ---
export interface MovementSystemConfig {
    eventBus: EventBus;
    updatePosition: UpdatePositionFn;
    getEntity: GetEntityFn;
    unitOccupancy: Map<string, number>;      // was: tileOccupancy
    buildingOccupancy: Set<string>;
    buildingFootprint: Set<string>;
}

// --- Placement context changes ---
// In placement/types.ts PlacementContext:
//   tileOccupancy → groundOccupancy (same type, Map<string, number>)
```

## Subsystem Details

### 1. Core Occupancy
**Files**: `src/game/game-state.ts`
**Key decisions**:
- `addSpatialAndOccupancy`: buildings + map objects + piles → `groundOccupancy`; units → `unitOccupancy`
- `removeEntity`: buildings/map-objects/piles clear `groundOccupancy`; units clear `unitOccupancy`
- `updateEntityPosition`: simplified — always writes to `unitOccupancy`, no type-checking needed since only units move
- `clearTileOccupancy` / `restoreTileOccupancy`: operate on `unitOccupancy` only (they're unit-specific). No more guard against overwriting static entities.
- `getEntityAt()` checks `groundOccupancy` first, falls back to `unitOccupancy` — preserves backward compat for callers that don't care about layer
- The `occupancy?: boolean` option on AddUnitOptions now skips `unitOccupancy` (was `tileOccupancy`)
- Delete the `tileOccupancy` field entirely

### 2. Movement Integration
**Files**: `src/game/systems/movement/movement-system.ts`, `src/game/game-services.ts`
**Depends on**: Subsystem 1
**Key decisions**:
- Delete `MovementSystem.unitPositions` private map — replaced by `GameState.unitOccupancy` (passed via config)
- Rename config field: `tileOccupancy` → `unitOccupancy`
- `MovementSystem.getUnitAt()` private method simplifies: just read `this.unitOccupancy.get(key)` (no dual-map lookup needed)
- `game-services.ts`: pass `gameState.unitOccupancy` instead of `gameState.tileOccupancy`
- All MovementSystem internal writes to `unitPositions` (on step, on stop, on remove) become writes to the shared `unitOccupancy` reference — **search for all `this.unitPositions` usages and replace**

### 3. Placement Validators
**Files**: `src/game/systems/placement/internal/single-tile-validator.ts`, `building-validator.ts`, `resource-validator.ts`, `unit-validator.ts`, `src/game/systems/placement/types.ts`, `valid-position-grid.ts`
**Depends on**: Subsystem 1
**Key decisions**:
- Rename `tileOccupancy` to `groundOccupancy` in `PlacementContext` and all validator signatures
- Building placement: check `groundOccupancy.has(key)` — units on a tile don't block building placement (same as S4 original)
- Resource placement (piles): check `groundOccupancy` — units don't block pile placement
- Unit placement (`canPlaceUnit`): check **both** `groundOccupancy` and `unitOccupancy` — units can't overlap each other or ground entities
- Update `use-renderer/index.ts` to pass correct occupancy maps

### 4. Caller Migration
**Files**: All consumers of `getEntityAt`, `tileOccupancy`, and related APIs
**Key decisions** — categorize each caller by which layer it needs:

**Ground-only (`getGroundEntityAt` / `groundOccupancy`):**
- `plant_crop` (system-handlers.ts:172) — remove the `type !== Unit` hack, just check ground
- `plant_trees_area` / `map-objects.ts:219,283` — spawning objects, check ground only
- `map-stacks.ts:43` — pile placement, check ground only
- `construction-system.ts:392` — check ground (was already ignoring buildings with extra guard)
- `findEmptySpot` / `isValidSpot` (spatial-search.ts:102) — check ground only (carriers don't block planting)
- `hasFreNeighbors` (spatial-search.ts:179) — check ground only
- `building-handlers.ts:52` — building placement check, ground only

**Unit-only (`getUnitAt` / `unitOccupancy`):**
- `unit-handlers.ts:57` — checking for unit collision at spawn point

**Both layers (`getEntityAt` or explicit dual check):**
- `map-settlers.ts:37` — map loading: check if tile has a building (ground) or another unit. Use `getEntityAt()` (checks both) but the building-footprint special case changes: if `getGroundEntityAt` returns a building, skip `unitOccupancy` registration (existing `occupancy: !onBuilding` logic)
- `selection-handlers.ts:41` — click-to-select: needs to find any entity. Use `getEntityAt()`
- `map-buildings.ts:138` — check if building tile blocked by anything. Use `getEntityAt()`
- `pile-position-resolver.ts:112` — check occupant at pile pos. Use `getGroundEntityAt()` (piles are ground)
- `control-executors.ts:129` — find empty tile for worker. Use `getGroundEntityAt()` (workers path around units)
- `unit-transformer.ts:236` — find empty spawn tile. Use `getEntityAt()` (needs truly empty)
- `garrison-commands.ts:206` — find building at tile. Use `getGroundEntityAt()`
- `settler-tasks/initial-worker-assignment.ts:39` — find building at tile. Use `getGroundEntityAt()`
- `residence-spawner.ts:98` — spawning on building door. Already handled via `occupancy` flag

**UI layer:**
- `use-renderer/index.ts:118,144,221,227` — pass `groundOccupancy` for placement preview, `unitOccupancy` for unit placement
- `place-building-mode.ts:12` — rename field to `groundOccupancy`

**Tests** — update all test references from `tileOccupancy` to appropriate layer:
- Most pathfinding tests check unit positions → `unitOccupancy`
- Placement tests check ground → `groundOccupancy`
- Game-state tests need updating for both

## File Map

### New Files
None — this is a refactor of existing code.

### Modified Files
| File | Change |
|------|--------|
| `src/game/game-state.ts` | Split `tileOccupancy` → `groundOccupancy` + `unitOccupancy`; add `getGroundEntityAt()`, `getUnitAt()`; simplify `updateEntityPosition`, `clearTileOccupancy`, `restoreTileOccupancy` |
| `src/game/game-services.ts` | Pass `unitOccupancy` to MovementSystem instead of `tileOccupancy` |
| `src/game/systems/movement/movement-system.ts` | Delete `unitPositions`; rename config `tileOccupancy` → `unitOccupancy`; simplify `getUnitAt()` |
| `src/game/systems/placement/types.ts` | Rename `tileOccupancy` → `groundOccupancy` in `PlacementContext` |
| `src/game/systems/placement/internal/single-tile-validator.ts` | Use `groundOccupancy` |
| `src/game/systems/placement/internal/building-validator.ts` | Use `groundOccupancy` |
| `src/game/systems/placement/internal/resource-validator.ts` | Use `groundOccupancy` |
| `src/game/systems/placement/internal/unit-validator.ts` | Check both `groundOccupancy` and `unitOccupancy` |
| `src/game/systems/placement/valid-position-grid.ts` | Pass `groundOccupancy` |
| `src/game/systems/spatial-search.ts` | Use `getGroundEntityAt()` in `isValidSpot` and `hasFreNeighbors` |
| `src/game/commands/handlers/system-handlers.ts` | `plant_crop`: use `getGroundEntityAt()`, remove Unit type-check hack |
| `src/game/commands/handlers/building-handlers.ts` | Use `getGroundEntityAt()` for placement check |
| `src/game/commands/handlers/unit-handlers.ts` | Use `getUnitAt()` for collision check |
| `src/game/commands/handlers/selection-handlers.ts` | Keep `getEntityAt()` (wants any entity) |
| `src/game/systems/map-objects.ts` | Use `getGroundEntityAt()` |
| `src/game/systems/map-stacks.ts` | Use `getGroundEntityAt()` |
| `src/game/systems/map-settlers.ts` | Use `getGroundEntityAt()` for building check, `getUnitAt()` for unit check |
| `src/game/features/building-construction/map-buildings.ts` | Use `getEntityAt()` (any blocker) |
| `src/game/features/building-construction/construction-system.ts` | Use `getGroundEntityAt()`, remove building-type guard |
| `src/game/features/settler-tasks/initial-worker-assignment.ts` | Use `getGroundEntityAt()` |
| `src/game/features/settler-tasks/internal/control-executors.ts` | Use `getGroundEntityAt()` |
| `src/game/features/inventory/pile-position-resolver.ts` | Use `getGroundEntityAt()` |
| `src/game/features/tower-garrison/internal/garrison-commands.ts` | Use `getGroundEntityAt()` |
| `src/game/features/settler-location/settler-building-location-manager.ts` | Comments reference tileOccupancy — update |
| `src/game/systems/recruit/unit-transformer.ts` | Use `getEntityAt()` (needs truly empty) |
| `src/components/use-renderer/index.ts` | Pass correct occupancy maps per use case |
| `src/game/input/modes/place-building-mode.ts` | Rename `tileOccupancy` → `groundOccupancy` |
| `tests/unit/core/game-state.spec.ts` | Update to test both layers |
| `tests/unit/commands/unit-placement-selection-movement.spec.ts` | Update occupancy references |
| `tests/unit/integration/movement/pathfinding.spec.ts` | Use `unitOccupancy` |
| `tests/unit/integration/movement/pile-arrival-push.spec.ts` | Use appropriate layer |
| `tests/unit/movement/pile-arrival-bump.spec.ts` | Use appropriate layer |
| `tests/unit/movement/movement-collision.spec.ts` | Use `unitOccupancy` |
| `tests/unit/buildings/map-buildings.spec.ts` | Use `getGroundEntityAt()` |
| `tests/unit/buildings/placement.spec.ts` | Use `groundOccupancy` |
| `tests/unit/helpers/test-game.ts` | Pass correct occupancy maps |
| `tests/unit/helpers/test-simulation.ts` | Pass correct occupancy maps |
| `tests/unit/integration/world/tower-garrison.spec.ts` | Use `unitOccupancy` for door checks |
| `tests/e2e/game-actions.ts` | Update `tileOccupancy` reference |

## Verification
- Plant a crop on a tile where a carrier is walking → succeeds (was blocked before)
- `findEmptySpot` for foresters/farmers ignores carriers → finds tiles with units on them
- Unit pathfinding still resolves bump-or-wait correctly with `unitOccupancy`
- Building placement rejects tiles with map objects but allows tiles with units
- Existing unit tests and e2e tests pass after migration
