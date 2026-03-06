# Per-Tile Territory with Equidistant Resolution & Pioneers — Design

## Overview

Rework territory computation so overlapping building influence zones between players are resolved by equidistance (closest building wins, regardless of building type), and add a Pioneer unit that extends territory tile-by-tile at boundaries. Territory remains a per-tile player index (`Uint8Array`), but gains a distance grid for conflict resolution and a separate pioneer claims layer for persistent tile-by-tile expansion.

## Architecture

### Data Flow

```
  [Building added/removed]     [Pioneer claims tile]
           │                          │
           v                          v
  ┌─────────────────┐      ┌──────────────────┐
  │ TerritoryManager │◄─────│  PioneerClaimGrid │
  │  .dirty = true   │      │  (Uint8Array)     │
  └────────┬─────────┘      └──────────────────┘
           │ recomputeIfDirty()
           v
  ┌──────────────────────────────────────────┐
  │  Pass 1: Building influence              │
  │  For each building → fill ellipse        │
  │  Keep closest building per tile           │
  │  (distanceGrid + territoryGrid)          │
  ├──────────────────────────────────────────┤
  │  Pass 2: Pioneer claims                  │
  │  Fill unclaimed tiles from pioneerGrid   │
  └────────┬─────────────────────────────────┘
           │
           v
  ┌──────────────────┐     ┌───────────────────────┐
  │  territoryGrid   │────>│ Boundary dots (render) │
  │  (final ownership)│    │ Placement filters      │
  │                   │    │ Logistics filters       │
  └──────────────────┘    └───────────────────────┘

  ┌──────────────────────────────────────────┐
  │  PioneerSystem (TickSystem)              │
  │  Manages pioneer unit lifecycle          │
  │                                          │
  │  PioneerWorkHandler (PositionWorkHandler)│
  │  Finds boundary tiles, claims on complete│
  └──────────────────────────────────────────┘
```

### Subsystems

| # | Subsystem | Responsibility | Files |
|---|-----------|---------------|-------|
| 1 | Equidistant territory recomputation | Distance-based conflict resolution in TerritoryManager | `territory/territory-manager.ts` |
| 2 | Pioneer claims grid | Per-tile pioneer ownership storage, merge into recomputation | `territory/pioneer-claim-grid.ts` (new) |
| 3 | TerritoryManager integration | Wire pioneer grid into manager, expose claim API | `territory/territory-manager.ts`, `territory/territory-types.ts` |
| 4 | Pioneer work handler | PositionWorkHandler: find boundary tile, claim on complete | `settler-tasks/work-handlers.ts` |
| 5 | Pioneer feature wiring | SearchType, handler registration, event subscriptions | `settler-tasks/types.ts`, `game-services.ts` |
| 6 | Territory event: tile changed | Emit events when territory ownership changes (for UI, logistics invalidation) | `event-bus.ts`, `territory/territory-manager.ts` |
| 7 | Tests | Unit tests for equidistant resolution, pioneer claims, pioneer handler | `tests/unit/` |

## Data Models

### Distance Grid (internal to TerritoryManager)

A `Float32Array` parallel to `territoryGrid` storing the screen-space distance from each tile to the building that currently claims it.

| Field | Type | Description |
|-------|------|-------------|
| distanceGrid | `Float32Array` | Per-tile distance to nearest claiming building. `Infinity` = no building influence. |

Used only during recomputation — not exposed publicly.

### PioneerClaimGrid

| Field | Type | Description |
|-------|------|-------------|
| claims | `Uint8Array` | Per-tile pioneer ownership: 0 = unclaimed, N = player N+1 |

Pioneer claims persist across recomputations. They fill unclaimed tiles (no building influence from any player). Enemy buildings push back pioneer claims within their influence zones.

### SearchType (extended enum)

| Value | Name | Description |
|-------|------|-------------|
| `TERRITORY_EXPAND` | new | Pioneer searches for expandable boundary tiles |

### Territory Events (new)

| Event | Payload | Description |
|-------|---------|-------------|
| `territory:changed` | `{ }` | Territory grid was recomputed (ownership may have changed) |

Lightweight signal — listeners query `TerritoryManager` for specifics. No per-tile diff payload (too expensive for large changes like building placement).

## API Contracts

### TerritoryManager (modified)

```typescript
class TerritoryManager {
    // Existing public API — unchanged signatures
    isInTerritory(x: number, y: number, player: number): boolean;
    isInAnyTerritory(x: number, y: number): boolean;
    getOwner(x: number, y: number): number;  // -1 if unclaimed
    getBoundaryDots(): readonly TerritoryDot[];
    addBuilding(entityId: number, x: number, y: number, player: number, buildingType: BuildingType): void;
    removeBuilding(entityId: number): boolean;

    // NEW: Pioneer claim integration
    setPioneerClaimGrid(grid: PioneerClaimGrid): void;

    // NEW: Force recomputation and emit territory:changed
    // Called after pioneer claims a tile (marks dirty)
    markDirty(): void;
}
```

### PioneerClaimGrid (new)

```typescript
class PioneerClaimGrid {
    constructor(mapWidth: number, mapHeight: number);

    /** Claim a tile for a player. Returns true if the tile was previously unclaimed or owned by another player. */
    claim(x: number, y: number, player: number): boolean;

    /** Get the claiming player for a tile (-1 if unclaimed). */
    getClaimOwner(x: number, y: number): number;

    /** Check if a tile has a pioneer claim. */
    hasClaim(x: number, y: number): boolean;

    /** Clear a claim (used when enemy building overrides). */
    clearClaim(x: number, y: number): void;

    /** Raw grid for recomputation. */
    readonly grid: Uint8Array;
    readonly width: number;
    readonly height: number;
}
```

### Pioneer Work Handler

```typescript
// Registered via SearchType.TERRITORY_EXPAND in work handler map
function createPioneerHandler(
    territoryManager: TerritoryManager,
    pioneerClaimGrid: PioneerClaimGrid,
    terrain: TerrainData
): PositionWorkHandler;
```

### Internal: Recomputation Algorithm

```typescript
// Inside TerritoryManager.recompute():
private recompute(): void {
    // Phase 1: Building influence with distance tracking
    this.territoryGrid.fill(0);
    this.distanceGrid.fill(Infinity);

    for (const building of this.buildings.values()) {
        this.fillCircleWithDistance(building.x, building.y, building.radius, building.player + 1);
    }

    // Phase 2: Pioneer claims fill unclaimed tiles
    if (this.pioneerClaimGrid) {
        const grid = this.pioneerClaimGrid.grid;
        for (let i = 0; i < grid.length; i++) {
            if (this.territoryGrid[i] === 0 && grid[i] !== 0) {
                this.territoryGrid[i] = grid[i];
            }
        }
    }

    // Phase 3: Boundary dots
    this.cachedBoundaryDots = this.computeBoundaryDots();
}

private fillCircleWithDistance(cx: number, cy: number, radius: number, ownerValue: number): void {
    const screenR = radius * 0.5;
    const rSq = screenR * screenR;

    // same bounding box as current fillCircle
    for (let y = minY; y <= maxY; y++) {
        for (let x = minX; x <= maxX; x++) {
            const dx = x - cx;
            const dy = y - cy;
            const sx = dx - dy * 0.5;
            const sy = dy * 0.5 * Y_SCALE;
            const distSq = sx * sx + sy * sy;

            if (distSq <= rSq) {
                const idx = y * this.mapWidth + x;
                if (distSq < this.distanceGrid[idx]) {
                    this.distanceGrid[idx] = distSq;
                    this.territoryGrid[idx] = ownerValue;
                }
                // Equal distance from different players → unclaimed (contested)
                else if (distSq === this.distanceGrid[idx] && this.territoryGrid[idx] !== ownerValue) {
                    this.territoryGrid[idx] = 0;
                }
            }
        }
    }
}
```

Key property: `distSq` comparison uses squared distance (avoids sqrt). Two buildings at equal squared distance from a tile produce an unclaimed boundary — the "half-place" the user described. Building type/size has no influence on conflict resolution; only position and the universal distance metric matter.

## Error Handling & Boundaries

| Layer | On error... | Behavior |
|-------|------------|----------|
| PioneerClaimGrid.claim() | Out of bounds | Return false, no-op |
| TerritoryManager.recompute() | No buildings + no claims | All tiles unclaimed — correct |
| Pioneer findPosition() | No expandable tiles found | Return null → pioneer idles (shouldWaitForWork: true) |
| Pioneer claim at contested tile | Building influence overrides | Pioneer claim stored but building distance wins at recomputation |
| Territory event emission | No listeners | No-op (standard event bus behavior) |

### Edge Cases

- **Pioneer claims pushed back**: Player A pioneers a tile. Player B builds a tower whose influence covers that tile. On recomputation, building influence wins (distance < Infinity for the tile). Pioneer claim persists in `pioneerGrid` but is overridden in `territoryGrid`. If player B's tower is destroyed, pioneer claim resurfaces.
- **Pioneer claims in enemy territory**: Pioneer can only claim tiles adjacent to own territory boundary. The `findPosition` filter ensures this.
- **Multiple pioneers same player**: Each claims independently. No coordination needed — they naturally spread out since already-owned tiles aren't valid targets.
- **Pioneer meets enemy pioneer**: Both claim adjacent tiles. The tiles are resolved by building distance if any building covers them, otherwise by who claimed first (pioneer grid stores the latest claim per tile — last write wins for neutral territory).
- **No territory buildings at all**: No building influence pass produces results. Pioneer claims still fill tiles. First castle placement triggers full recomputation.

## Subsystem Details

### Subsystem 1: Equidistant Territory Recomputation

**Files**: `src/game/features/territory/territory-manager.ts`
**Owns**: Distance-based conflict resolution algorithm

**Key decisions**:
- Add `distanceGrid: Float32Array` alongside `territoryGrid`. Initialized to `Infinity`, updated during `fillCircleWithDistance()`.
- Use squared screen-space distance (`distSq`) for comparison — avoids sqrt, still correct for ordering.
- Replace `fillCircle()` with `fillCircleWithDistance()`: only overwrites a tile if the new building is strictly closer. Equal distance from different players → tile set to 0 (unclaimed).
- `distanceGrid` is internal — not exposed. Only used during `recompute()`.
- Memory: 4 bytes/tile for Float32Array. 256x256 map = 256KB. Acceptable.

**Behavior**:
- Single-player territories (no overlap): identical to current behavior.
- Two-player overlap: the equidistant line between buildings becomes the boundary. Tiles exactly on the line are unclaimed (rare with discrete hex grid).
- A small guard tower (radius 48) and a castle (radius 100) from different players 80 tiles apart: both reach the midpoint (40 tiles). Midpoint tiles go to whichever building is closer. The castle's larger radius means it covers more tiles on its far side, but in the contested zone, only distance matters.

### Subsystem 2: Pioneer Claims Grid

**Files**: `src/game/features/territory/pioneer-claim-grid.ts` (new)
**Owns**: Persistent per-tile pioneer claim storage

**Key decisions**:
- Simple `Uint8Array` wrapper with claim/query/clear methods.
- Same encoding as `territoryGrid`: 0 = unclaimed, N = player N+1.
- Claims persist until explicitly cleared or overwritten by another player's pioneer.
- No tick system — purely reactive (written by pioneer handler, read during recomputation).
- Created alongside `TerritoryManager` in `game-services.ts` (needs same map dimensions).

**Behavior**:
- `claim(x, y, player)` overwrites any existing claim (including other players'). This models territory tug-of-war between pioneers.
- Claims are NOT cleared when territory recomputes — they persist in the pioneer grid even if a building temporarily overrides them in the territory grid.

### Subsystem 3: TerritoryManager Integration

**Files**: `src/game/features/territory/territory-manager.ts`, `src/game/features/territory/territory-types.ts`, `src/game/features/territory/index.ts`
**Owns**: Wiring pioneer grid into recomputation, new exports

**Key decisions**:
- `setPioneerClaimGrid(grid)` called once during initialization (not a constructor param — same pattern as current external creation).
- `markDirty()` exposed so the pioneer handler can trigger recomputation after claiming a tile.
- `recompute()` gains Phase 2 (pioneer claims) after Phase 1 (building influence).
- Existing public query API (`isInTerritory`, `getOwner`, etc.) unchanged — they already trigger lazy recomputation.

### Subsystem 4: Pioneer Work Handler

**Files**: `src/game/features/settler-tasks/work-handlers.ts`
**Owns**: Pioneer's find-position and claim-on-complete logic

**Key decisions**:
- Pattern: `PositionWorkHandler` (same as geologist).
- `findPosition(x, y)`: Spiral search from pioneer's position for a tile that is:
  1. Not owned by the pioneer's player (`getOwner(tx, ty) !== player`)
  2. Adjacent to at least one tile owned by the pioneer's player (boundary-adjacent)
  3. Passable terrain (`terrain.isPassable(tx, ty)`)
  4. Within `PIONEER_SEARCH_RADIUS` (configurable, suggest 15 tiles)
- `onWorkAtPositionComplete(x, y, settlerId)`: Call `pioneerClaimGrid.claim(x, y, player)` then `territoryManager.markDirty()`.
- `shouldWaitForWork: true` — pioneer idles when no expandable tiles exist (don't despawn).
- The pioneer needs the player ID from the settler entity. The `settlerId` param gives access to entity data.

**Behavior**:
- Pioneer walks to target tile, performs work animation, claims it.
- After claiming, territory recomputes lazily on next query.
- Pioneer then searches for next target from its new position.
- Pioneers naturally follow the boundary outward, expanding territory one tile at a time.

**Search priority**: Tiles closer to the pioneer are found first (spiral search). No bias toward any direction — the pioneer expands wherever is nearest.

### Subsystem 5: Pioneer Feature Wiring

**Files**: `src/game/features/settler-tasks/types.ts`, `src/game/game-services.ts`
**Owns**: SearchType addition, handler registration

**Key decisions**:
- Add `TERRITORY_EXPAND = 'TERRITORY_EXPAND'` to `SearchType` enum.
- Register pioneer handler in `game-services.ts` alongside geologist handler:
  ```typescript
  workHandlerMap.set(SearchType.TERRITORY_EXPAND, createPioneerHandler(
      this.territoryManager, this.pioneerClaimGrid, terrainData
  ));
  ```
- Pioneer `SettlerConfig` needs to map to `SearchType.TERRITORY_EXPAND`. This comes from XML data or hardcoded config.
- Pioneer is already defined as `UnitType.Pioneer = 6` with `UnitCategory.Specialist` and speed 2.

### Subsystem 6: Territory Changed Event

**Files**: `src/game/event-bus.ts`, `src/game/features/territory/territory-manager.ts`
**Owns**: Event emission after territory recomputation

**Key decisions**:
- Add `'territory:changed': {}` to `GameEvents` interface.
- Emit after `recompute()` completes (in `recomputeIfDirty()`).
- TerritoryManager needs an `EventBus` reference (passed via constructor or setter).
- Lightweight event — no payload. Listeners that care about specific tiles query `getOwner()`.
- Used by: ValidPositionGrid (invalidate after territory change), future UI territory overlay, free pile ownership reassignment.

**Behavior**:
- Event fires on every recomputation, even if no tiles actually changed ownership. Listeners should be cheap (e.g., set a dirty flag).
- Not fired during initial construction (before game starts). Only during gameplay.

### Subsystem 7: Tests

**Files**: `tests/unit/territory/territory-resolution.spec.ts` (new), `tests/unit/territory/pioneer-claims.spec.ts` (new)

**Territory resolution tests**:
- Single building: same behavior as current (no regression).
- Two buildings, same player: union of influence zones (no conflict).
- Two buildings, different players, overlapping: boundary at equidistant line.
- Two buildings, different players, non-overlapping: independent zones.
- Small tower vs castle, same distance from tile: tile goes to neither (unclaimed).
- Building removed: territory shrinks, opponent expands to fill.

**Pioneer claim tests**:
- Pioneer claim on unclaimed tile: tile becomes owned.
- Pioneer claim pushed back by enemy building: building wins.
- Pioneer claim persists after enemy building destroyed.
- Two pioneers, different players, claiming same tile: last write wins in pioneer grid, building distance resolves in territory grid.
- Pioneer findPosition: only returns boundary-adjacent, passable, non-owned tiles.

## File Map

### New Files

| File | Subsystem | Purpose |
|------|-----------|---------|
| `src/game/features/territory/pioneer-claim-grid.ts` | 2 | Pioneer claims per-tile storage |
| `tests/unit/territory/territory-resolution.spec.ts` | 7 | Equidistant resolution tests |
| `tests/unit/territory/pioneer-claims.spec.ts` | 7 | Pioneer claim + handler tests |

### Modified Files

| File | Change |
|------|--------|
| `src/game/features/territory/territory-manager.ts` | Add `distanceGrid`, `pioneerClaimGrid`, replace `fillCircle` with `fillCircleWithDistance`, add Phase 2 pioneer merge, add `markDirty()`, add `eventBus` for territory:changed emission |
| `src/game/features/territory/territory-types.ts` | No changes needed (existing types sufficient) |
| `src/game/features/territory/territory-feature.ts` | Wire `pioneerClaimGrid` into manager during registration |
| `src/game/features/territory/index.ts` | Re-export `PioneerClaimGrid` |
| `src/game/features/settler-tasks/types.ts` | Add `TERRITORY_EXPAND` to `SearchType` enum |
| `src/game/features/settler-tasks/work-handlers.ts` | Add `createPioneerHandler()` factory function |
| `src/game/event-bus.ts` | Add `'territory:changed': {}` to `GameEvents` |
| `src/game/game-services.ts` | Create `PioneerClaimGrid`, pass to `TerritoryManager`, register pioneer work handler |

## Open Questions

1. **Pioneer search radius**: Suggested 15 tiles (Chebyshev). Geologist uses 20. Should pioneers search farther or closer? Closer means more focused expansion; farther means pioneers travel more.

2. **Pioneer claim durability**: Current design has enemy buildings override pioneer claims (buildings always win). Alternative: pioneer claims could resist enemy building influence within N tiles of own buildings. This would make pioneered territory "stickier" near your base. Decision: keep simple — buildings always win. Pioneers are for neutral land expansion.

3. **Pioneer spawning**: Not covered in this design. In S4, pioneers are trained at medium/large residences. Implementation deferred — can be added to barracks/residence training system later.

4. **Enemy pioneer counter-claiming**: Current design allows a pioneer to claim tiles already claimed by another player's pioneer. The later claim wins in the pioneer grid. Is this correct S4 behavior? If pioneers should only claim unclaimed tiles (not enemy-pioneered tiles), add a check in `findPosition`.

5. **Territory change granularity**: `territory:changed` fires with no payload. If ValidPositionGrid or other listeners need to know WHICH tiles changed, we'd need a diff. Current design: listeners do full re-evaluation. Fine for now — territory changes are infrequent (building placement, pioneer claims).

## Out of Scope

- Pioneer spawning/training from buildings (use existing barracks/residence system later)
- Territory-based fog of war or exploration
- Alliance/diplomacy territory sharing
- Territory visual effects (color overlays, animations)
- Pioneer pathfinding priority (they use standard A* like all units)
- Territory-based combat triggers (entering enemy territory)
- Multi-building Voronoi optimization (BFS approach) — current per-building ellipse fill is fast enough for expected building counts
