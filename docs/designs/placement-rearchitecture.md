# Building Placement Rearchitecture — Design

## Overview

Replace the current per-tile on-demand placement validation with a **precomputed valid-positions grid** that is built once when entering placement mode and incrementally updated. Every dot shown on the map is a guaranteed valid position — hovering is a cheap array lookup, and clicking always succeeds. The current system validates every tile on hover and re-validates on click (double work), shows dots that may fail on click, and recomputes the entire visible area every few pixels of camera movement.

## Architecture

### System Diagram

```
[Enter Placement Mode]
        |
        v
[ValidPositionGrid] ←── terrain, occupancy, footprint, territory, slope
   (precomputed)         builds outward from camera center
        |
        ├──→ [BuildingIndicatorRenderer]  (reads grid, renders dots)
        |         Only renders positions from grid — zero validation
        |
        ├──→ [PlaceBuildingMode]  (hover = grid lookup, click = always succeeds)
        |         No per-hover validation. Click dispatches command directly.
        |
        └──→ [PlaceBuildingCommand]  (trusts grid, no re-validation)
                  Grid was authoritative — skip canPlaceBuildingFootprint
```

### Current Problems

1. **Double validation**: `BuildingIndicatorRenderer.rebuildCache()` calls `validateBuildingPlacement()` for every visible tile, then `PlaceBuildingMode.onPointerMove()` calls it again on hover, then `executePlaceBuilding()` calls `canPlaceBuildingFootprint()` a third time on click.

2. **Dots can lie**: The indicator cache is invalidated by coarse heuristics (camera moved >5 tiles, occupancy map size changed). Between cache rebuilds, dots may show positions that are actually invalid (or miss newly valid ones).

3. **Slow cache rebuild**: Iterates every tile in the visible rectangle (potentially thousands), calling the full validation pipeline per tile. Each call computes footprint, checks bounds, territory filter, terrain, occupancy, footprint gap, and slope.

4. **No spatial ordering**: Dots appear all at once when the cache finishes. No prioritization from camera center outward.

### Design Goals

- **Every dot is valid**: If a dot is visible, clicking it places the building. No exceptions.
- **Hover is O(1)**: Just a grid/set lookup. No validation on hover.
- **Click always works**: The command trusts the grid. No re-validation in `executePlaceBuilding()`.
- **Incremental updates**: When a building is placed (occupancy changes), the grid patches locally instead of full recompute.
- **Outward computation**: Grid is built starting from camera center, expanding outward in rings. First dots appear near the cursor.

## Subsystems

| # | Subsystem | Responsibility | Files |
|---|-----------|---------------|-------|
| 1 | ValidPositionGrid | Precomputed grid of valid building positions per building type. Spiral-outward computation, incremental patching. | `src/game/features/placement/valid-position-grid.ts` |
| 2 | Placement Mode Simplification | Remove per-hover validation from PlaceBuildingMode. Hover = grid lookup. Click = direct command. | `src/game/input/modes/place-building-mode.ts`, `src/game/input/modes/place-mode-base.ts` |
| 3 | Indicator Renderer Simplification | Remove all validation from renderer. Read positions from ValidPositionGrid. | `src/game/renderer/building-indicator-renderer.ts` |
| 4 | Command Trust | Remove redundant re-validation from executePlaceBuilding. Trust the grid. | `src/game/commands/command.ts` |
| 5 | Grid Lifecycle & Wiring | Create/destroy grid on mode enter/exit. Wire to renderer and input mode. Handle occupancy change events for incremental updates. | `src/game/input/use-input-manager.ts`, `src/game/game.ts`, `src/components/use-renderer/placement-state.ts` |
| 6 | Placement Feature Cleanup | Remove unused validators, simplify public API. Delete code that only existed for the old per-tile flow. | `src/game/features/placement/index.ts`, `src/game/features/placement/placement-validator.ts`, `src/game/features/placement/types.ts` |

## Data Models

### ValidPositionGrid

The grid stores precomputed valid positions for a specific building type + race + player combination.

```typescript
interface ValidPositionEntry {
    x: number;
    y: number;
    heightRange: number;  // for slope gradient coloring
}

interface ValidPositionGrid {
    // Core data
    readonly buildingType: BuildingType;
    readonly race: Race;
    readonly player: number;

    // Valid positions stored as a flat set for O(1) lookup
    // Key: tileIndex (y * mapWidth + x)
    readonly validSet: Set<number>;

    // Ordered array for rendering (built outward from computation center)
    readonly positions: ValidPositionEntry[];

    // State
    readonly isComplete: boolean;  // false while still computing outward rings
}
```

### GridComputeRequest

```typescript
interface GridComputeRequest {
    buildingType: BuildingType;
    race: Race;
    player: number;
    centerX: number;  // camera center when mode entered
    centerY: number;
    terrain: TerrainData;
    tileOccupancy: ReadonlyMap<string, number>;
    buildingFootprint: ReadonlySet<string>;
    placementFilter: PlacementFilter | null;
}
```

## Subsystem Details

### Subsystem 1: ValidPositionGrid

**Files**: `src/game/features/placement/valid-position-grid.ts`

**Owns**: Grid computation, storage, incremental patching, O(1) lookups.

**Key decisions**:

- **Spiral-outward computation**: Start at the camera center tile and expand in concentric rectangular rings. This ensures dots near the cursor appear first. Each ring is one tile further out. The grid marks itself complete when all rings reach map bounds.

- **Chunked computation**: To avoid blocking the main thread, compute in chunks of N tiles per frame (e.g., 500-1000 tiles/frame). Each frame picks up where the last left off. The renderer shows whatever positions are ready so far — dots appear progressively outward.

- **validSet for O(1) lookup**: A `Set<number>` using tile indices (`y * mapWidth + x`). Hover checks `validSet.has(mapSize.toIndex(x, y))` — zero allocation, O(1).

- **Incremental patching after placement**: When a building is placed at (px, py), the grid invalidates positions in a local region around the placement:
  1. Remove the placed footprint tiles from `validSet` and `positions`
  2. Remove positions whose footprints overlap the placed building's footprint (check neighbors within max building radius)
  3. Remove positions that now violate the 1-tile gap rule with the new building footprint
  4. No need to add new valid positions — placing a building never creates new valid spots nearby

- **Full recompute only when building type or player changes**: If the user switches building type, the grid is discarded and rebuilt from scratch. Same if territory changes (building placed/destroyed affects territory).

**API**:

```typescript
class ValidPositionGrid {
    constructor(request: GridComputeRequest, mapSize: MapSize, groundHeight: Uint8Array);

    /** Run one chunk of computation. Returns true when complete. */
    computeChunk(maxTiles: number): boolean;

    /** O(1) check if position is valid */
    isValid(x: number, y: number): boolean;

    /** Get entry with height range for rendering. null if not valid. */
    getEntry(x: number, y: number): ValidPositionEntry | null;

    /** All computed positions so far (for renderer) */
    getPositions(): readonly ValidPositionEntry[];

    /** Invalidate positions around a newly placed building */
    patchAfterPlacement(placedX: number, placedY: number, placedType: BuildingType, race: Race): void;

    /** Whether all tiles have been evaluated */
    get isComplete(): boolean;

    /** Number of valid positions found so far */
    get count(): number;
}
```

**Behavior**:

- `computeChunk()` advances the spiral. For each tile, calls `validateBuildingPlacement()` (the same function used today). If valid, adds to both `validSet` and `positions` array with computed `heightRange`.

- `patchAfterPlacement()` uses the placed building's footprint + 1-tile gap zone to determine which existing valid positions are now invalid. For each tile in the invalidation zone, check if it's a valid position and if so, re-validate it. Remove if no longer valid. This is O(footprint_size * max_building_radius) — very fast for a single placement.

- The spiral ordering means `positions` array is naturally sorted by distance from center. The renderer can iterate this array directly for progressive rendering.

### Subsystem 2: Placement Mode Simplification

**Files**: `src/game/input/modes/place-building-mode.ts`, `src/game/input/modes/place-mode-base.ts`

**Owns**: User interaction flow for building placement.

**Key decisions**:

- **Remove validatePlacement from constructor**: `BasePlacementMode` currently takes a `validatePlacement` callback. For buildings, this becomes a grid lookup instead. The base class still supports the callback for non-building placement modes (resources, units) that don't use the grid.

- **PlaceBuildingMode gets a grid reference**: Instead of a validation function, it receives the `ValidPositionGrid` (or a lookup function `(x, y) => boolean` backed by the grid). Set when entering placement mode, cleared on exit.

- **onPointerMove becomes trivial**: Just update `previewX/previewY` and set `previewValid = grid.isValid(x, y)`. No heavy computation.

- **tryPlace skips validation**: When `previewValid` is true (from grid lookup), the command is dispatched without re-checking. After successful placement, call `grid.patchAfterPlacement()` and re-check `previewValid` for the current hover position.

**Changes to PlaceBuildingMode**:

```typescript
class PlaceBuildingMode extends BasePlacementMode<BuildingType> {
    private grid: ValidPositionGrid | null = null;

    setGrid(grid: ValidPositionGrid | null): void;

    // Override to use grid lookup instead of validatePlacement callback
    protected override isPositionValid(x: number, y: number, _subType: BuildingType): boolean {
        return this.grid?.isValid(x, y) ?? false;
    }
}
```

**Changes to BasePlacementMode**:

- Extract `isPositionValid()` as a protected method that subclasses can override. Default implementation calls the existing `validatePlacement` callback. `PlaceBuildingMode` overrides to use grid.
- `onPointerMove`: call `this.isPositionValid()` instead of `this.validatePlacement()` directly.
- `tryPlace`: remove the `if (!modeData.previewValid) return` guard — still keep it as a safety check, but it should never be false when clicking a dot because only valid positions show dots.

### Subsystem 3: Indicator Renderer Simplification

**Files**: `src/game/renderer/building-indicator-renderer.ts`

**Owns**: WebGL rendering of placement indicator dots.

**Key decisions**:

- **Remove all validation logic**: Delete `computePlacementStatus()`, the `PlacementChecker` interface, and the old `rebuildCache()` that iterated visible tiles. The renderer becomes a pure "draw these dots" component.

- **Read positions from grid**: Instead of computing its own cache, the renderer receives positions from the `ValidPositionGrid`. Each frame, it filters the grid's positions to those in the visible viewport and renders them.

- **No more cache invalidation heuristics**: The old cache compared viewport position, zoom, occupancy size, and building type. All of this complexity goes away — the grid is the single source of truth.

- **Keep gradient coloring**: The `heightRange` field in `ValidPositionEntry` provides the data for the slope gradient. The renderer just maps `heightRange → color` using the existing `SLOPE_GRADIENT` array.

- **Keep hover highlighting**: When the hover tile matches a valid position, render the bright white dot + yellow ring. The renderer checks `grid.isValid(hoverX, hoverY)` for this.

**Simplified API**:

```typescript
class BuildingIndicatorRenderer implements IRenderer {
    // Remove: PlacementChecker, computePlacementStatus, rebuildCache, cache fields
    // Remove: tileOccupancy, buildingFootprint fields

    setState(
        enabled: boolean,
        grid: ValidPositionGrid | null,  // replaces occupancy maps + preview
        hoveredTile: TileCoord | null,
        maxSlopeDiff: number  // for gradient normalization
    ): void;

    draw(gl, projection, viewPoint): void;
    // Iterates grid.getPositions(), filters to viewport, renders colored dots
}
```

**Performance**: The grid's `positions` array is already ordered by distance from center. For large maps, the renderer can binary-search or linearly scan for positions within the viewport bounds. Since positions don't change between frames (only after placement), the renderer can cache the filtered viewport subset and only recompute when the viewport moves significantly.

### Subsystem 4: Command Trust

**Files**: `src/game/commands/command.ts`

**Owns**: Command execution.

**Key decisions**:

- **Add `trusted` flag to PlaceBuildingCommand**: When placement comes from the grid-backed input mode, the command carries `trusted: true`. The handler skips `canPlaceBuildingFootprint()`.

- **Keep validation for untrusted commands**: Script commands, AI commands, and map loading still validate. Only the UI placement path is trusted.

- **Why this is safe**: The grid is built from the exact same `validateBuildingPlacement()` function. After placement, the grid patches itself. There's no window where the grid disagrees with reality — it IS the validation, precomputed.

**Changes**:

```typescript
interface PlaceBuildingCommand {
    // ... existing fields
    trusted?: boolean;  // skip validation when true (from grid-backed UI)
}

function executePlaceBuilding(ctx: CommandContext, cmd: PlaceBuildingCommand): CommandResult {
    if (!cmd.trusted) {
        // Existing validation for scripts/AI/tests
        if (!canPlaceBuildingFootprint(...)) {
            return commandFailed(...);
        }
    }
    // ... rest unchanged
}
```

### Subsystem 5: Grid Lifecycle & Wiring

**Files**: `src/game/input/use-input-manager.ts`, `src/game/game.ts`, `src/components/use-renderer/placement-state.ts`

**Owns**: Creating and connecting the grid to the rest of the system.

**Key decisions**:

- **Grid created on mode enter**: When `PlaceBuildingMode.onEnter()` is called with a building type, the wiring layer creates a `ValidPositionGrid` with the current game state and starts computation.

- **Grid destroyed on mode exit**: When leaving placement mode (right-click, ESC, successful place with `resetAfterPlace`), the grid is discarded.

- **Per-frame chunk computation**: The glue layer (frame callbacks or a dedicated system) calls `grid.computeChunk()` each frame until `isComplete`. This prevents blocking.

- **Event-driven patching**: After `executePlaceBuilding` succeeds, emit a `'placement:invalidate'` event with the placement coords. The grid lifecycle handler calls `grid.patchAfterPlacement()`.

- **Territory change triggers full rebuild**: When territory changes (tower placed/destroyed), the grid must be rebuilt because territory boundaries shifted. Listen to `'building:placed'` / `'building:removed'` for territory buildings and trigger rebuild.

**Wiring flow**:

```
1. User clicks building in UI panel
2. inputManager.switchMode('place_building', { buildingType, race, player })
3. PlaceBuildingMode.onEnter() fires
4. Wiring layer creates ValidPositionGrid(request)
5. Each frame: grid.computeChunk(1000)
6. Each frame: renderer.setState(true, grid, hoveredTile, MAX_SLOPE_DIFF)
7. User hovers: mode checks grid.isValid(x, y) — O(1)
8. User clicks valid dot: command dispatched with trusted: true
9. After placement: grid.patchAfterPlacement(x, y, type, race)
10. Renderer picks up changed grid next frame
11. User right-clicks: mode exits, grid discarded
```

### Subsystem 6: Placement Feature Cleanup

**Files**: `src/game/features/placement/index.ts`, `src/game/features/placement/placement-validator.ts`, `src/game/features/placement/types.ts`

**Owns**: Removing unused code, simplifying exports.

**Key decisions**:

- **Keep `validateBuildingPlacement()`**: This is the core function used by `ValidPositionGrid.computeChunk()`. It stays.

- **Keep `canPlaceBuildingFootprint()`**: Still needed by untrusted commands (scripts, AI).

- **Remove `createPlacementValidator()` and `createDetailedPlacementValidator()`**: These factory functions created closures for per-hover validation. No longer needed — the grid replaces them.

- **Remove `PlacementValidator` and `DetailedPlacementValidator` types**: The callback signatures are no longer used.

- **Keep `PlacementFilter`, `PlacementContext`, `PlacementResult`**: Still used by the grid and by command validation.

- **Keep terrain and slope exports**: Used by grid and by other systems (movement, pathfinding).

**Removed exports**:
- `createPlacementValidator`
- `createDetailedPlacementValidator`
- `PlacementValidator` type
- `DetailedPlacementValidator` type
- `canPlaceEntity` (if only used by removed validators)
- `validatePlacement` unified function (if only used by removed validators)

**Audit before removing**: Search all usages of each export. Only remove if truly unused after subsystems 2-4 are updated.

## Error Handling

| Layer | On error... |
|-------|------------|
| Grid computation | If `validateBuildingPlacement` throws (missing race/footprint data), log error and skip tile. Grid still builds with available positions. |
| Grid lookup (hover) | If grid is null (still initializing), return false — preview shows invalid. Safe fallback. |
| Command execution (trusted) | If building placement somehow fails despite trust (race condition, bug), the command still modifies terrain. This matches existing behavior. The `commandFailed` path is only for untrusted commands. |
| Grid patching | If patch logic has a bug and misses an invalidation, worst case is a stale valid position that fails on click. This is the same behavior as the current system. Mitigated by the patch being conservative (invalidates a larger region than strictly necessary). |
| Mode exit without grid | If grid is null on exit, nothing to clean up. Safe. |

## File Map

### New Files

| File | Subsystem | Purpose |
|------|-----------|---------|
| `src/game/features/placement/valid-position-grid.ts` | 1 | Grid computation, storage, patching, lookup |

### Modified Files

| File | Change | Subsystem |
|------|--------|-----------|
| `src/game/input/modes/place-building-mode.ts` | Add grid reference, override `isPositionValid` to use grid | 2 |
| `src/game/input/modes/place-mode-base.ts` | Extract `isPositionValid()` as overridable method | 2 |
| `src/game/renderer/building-indicator-renderer.ts` | Remove all validation, read from grid | 3 |
| `src/game/commands/command.ts` | Add `trusted` flag, skip validation when trusted | 4 |
| `src/game/input/use-input-manager.ts` | Create/destroy grid on mode transitions | 5 |
| `src/components/use-renderer/placement-state.ts` | Pass grid to renderer instead of occupancy maps | 5 |
| `src/game/features/placement/index.ts` | Remove unused exports | 6 |
| `src/game/features/placement/placement-validator.ts` | Remove unused factory functions | 6 |
| `src/game/features/placement/types.ts` | Remove unused types | 6 |

### Possibly Deleted Files

| File | Condition |
|------|-----------|
| `src/game/features/placement/placement-validator.ts` | If all its exports become unused after cleanup. The functions it contains (`validatePlacement`, `canPlaceEntity`, factories) may all be superseded. |

## Open Questions

1. **Chunk size tuning**: 500 vs 1000 tiles per frame. Needs profiling. Too few = slow progressive fill. Too many = frame drops. Could be adaptive based on frame time budget.

2. **Territory rebuild scope**: When a tower is placed, should the grid do a full rebuild or a local re-evaluation? Territory radius is 48-100 tiles, so re-evaluating that region is feasible. But the territory grid itself does a full recompute on any change, so it might be simpler to just rebuild the placement grid too.

3. **Multiple placement mode (resetAfterPlace = false for debug)**: When debug mode allows placing multiple buildings without exiting placement mode, the grid patches after each placement. Should work fine, but needs testing with rapid successive placements.

4. **Resource/unit placement**: This design focuses on buildings. Resource piles and units still use the old per-tile validation (they're single-tile, cheap). Could be unified later but not in scope.

## Out of Scope

- Resource pile placement (single tile, already fast)
- Unit placement (single tile, already fast)
- Work area visualization (separate system, not placement-related)
- Territory boundary rendering (separate system)
- Building footprint data format changes
- Slope calculation algorithm changes (the existing algorithm is reused as-is)
