Full Design: SpatialGrid — spatial hash with territory-aware cell states            
                                                                                    
  Problem                                                                             
                                                                                    
  Workers and logistics search for map objects (trees, stones, crops) and free piles  
  by scanning thousands of entities. Two filters compound:                          
  1. Spatial — within search radius (~20-30 tiles)
  2. Territory — within querying player's territory

  Today both are brute-forced: every idle settler scans all entities of a type
  regardless of distance or ownership.

  Data structure

  SpatialGrid
    cellShift: 4                              // log2(cellSize), cellSize = 16
    maxCols: number                           // mapWidth >> cellShift
    resolve: (id) => Entity | undefined

    // Spatial index
    cells: Map<cellKey, Set<entityId>>        // cellKey → entity IDs in that cell
    entityCell: Map<entityId, cellKey>        // reverse: entityId → its cellKey (for
  remove)

    // Territory state per cell
    cellState: Map<cellKey, CellState>        // UNCLAIMED | FULL(player) |
  BORDER(player)
    playerCells: Map<player, Set<cellKey>>    // player → all cellKeys relevant to
  them (FULL + BORDER)

    // Reference to territory grid for per-entity fallback
    getOwner: (x, y) => number               // bound to TerritoryManager.getOwner

  Cell key

  function cellKey(x: number, y: number): number {
      return (y >> this.cellShift) * this.maxCols + (x >> this.cellShift);
  }

  Integer key — no string allocation, fast Map lookup. For a 256×256 map with
  cellSize=16: 16×16 = 256 possible cells.

  Cell states

  const enum CellOwnership {
      UNCLAIMED,    // all tiles in cell are unclaimed
      FULL,         // all tiles owned by one player — skip per-entity getOwner
      BORDER,       // mixed ownership — per-entity getOwner fallback required
  }

  interface CellState {
      ownership: CellOwnership;
      player: number;   // the dominant/sole owner (-1 for UNCLAIMED)
  }

  ┌───────────┬─────────────────────────────────┬─────────────────────────────────┐
  │   State   │             Meaning             │         Query behavior          │
  ├───────────┼─────────────────────────────────┼─────────────────────────────────┤
  │ UNCLAIMED │ No player owns any tile in this │ Skipped entirely for player     │
  │           │  cell                           │ queries                         │
  ├───────────┼─────────────────────────────────┼─────────────────────────────────┤
  │ FULL(p)   │ Every tile owned by player p    │ Yield all entities — no         │
  │           │                                 │ per-entity check                │
  ├───────────┼─────────────────────────────────┼─────────────────────────────────┤
  │           │ Majority/any tiles owned by p,  │ Yield entities where            │
  │ BORDER(p) │ some by others or unclaimed     │ getOwner(e.x, e.y) ===          │
  │           │                                 │ queriedPlayer                   │
  └───────────┴─────────────────────────────────┴─────────────────────────────────┘

  A BORDER cell appears in playerCells for every player that has at least one tile in
  it. This ensures no misses at borders.

  Query: nearbyForPlayer(cx, cy, radius, player)

  1. Compute cell range from (cx ± radius, cy ± radius)
  2. Get playerCells[player] → owned set
  3. For each cell in range:
       if cell not in owned set → skip
       if cell is FULL(player) → yield all entities unconditionally
       if cell is BORDER → yield entities where getOwner(e.x, e.y) === player

  For radius=30, cellSize=16: 4×4 = 16 cells checked. Of those, maybe 10 are FULL
  (yield directly), 2 are BORDER (per-entity check on ~12 entities each), 4 are
  skipped. Total: ~144 candidates with ~24 getOwner calls.

  Query: nearby(cx, cy, radius)

  Same but no ownership filter — yields all entities in all cells within range. Used
  for proximity checks during planting (isTooClose).

  Entity lifecycle

  ┌─────────────────────────────────────┬───────────────────────────────────┬──────┐
  │                Event                │              Action               │ Cost │
  ├─────────────────────────────────────┼───────────────────────────────────┼──────┤
  │ addEntity(MapObject|StackedPile)    │ grid.add(id, x, y) — insert into  │ O(1) │
  │                                     │ cell's entity set                 │      │
  ├─────────────────────────────────────┼───────────────────────────────────┼──────┤
  │ removeEntity(MapObject|StackedPile) │ grid.remove(id) — lookup cell via │ O(1) │
  │                                     │  entityCell, delete               │      │
  ├─────────────────────────────────────┼───────────────────────────────────┼──────┤
  │                                     │ Not needed —                      │      │
  │ Entity moves                        │ trees/stones/crops/piles don't    │ —    │
  │                                     │ move                              │      │
  └─────────────────────────────────────┴───────────────────────────────────┴──────┘

  Territory updates

  Three triggers, each with different granularity:

  A. Pioneer claims a single tile (tx, ty) for player

  onTileOwnerChanged(tx, ty, oldOwner, newOwner):
    ck = cellKey(tx, ty)
    state = cellState[ck]

    if state is UNCLAIMED:
      // First tile claimed in this cell → becomes BORDER
      set state to BORDER(newOwner)
      add ck to playerCells[newOwner]

    else if state is FULL(p):
      if p === newOwner → no-op (already fully owned by same player)
      else → set state to BORDER(p), add ck to playerCells[newOwner]

    else if state is BORDER:
      // Another tile changed — might complete the cell or still be mixed
      add ck to playerCells[newOwner]
      // Optionally promote: scan cell tiles to check if now fully one owner
      maybePromoteCell(ck)

  Cost: O(1) per tile. The maybePromoteCell scan is O(cellSize² = 256) but can be
  deferred/batched — only needed when a border cell might have become fully owned.

  B. Tower/castle built or destroyed (bulk change)

  onTerritoryRecomputed(affectedBounds: {x1, y1, x2, y2}):
    for each cellKey overlapping affectedBounds:
      classifyCell(ck)

  classifyCell scans the cell's tiles in the territory grid:

  classifyCell(ck):
    scan all tiles (cx*16..cx*16+15, cy*16..cy*16+15)
    collect owners seen

    if only unclaimed → UNCLAIMED, remove from all playerCells
    if only one owner → FULL(owner), set in playerCells[owner] only
    if mixed → BORDER, add to playerCells for each owner present

  Cost per cell: O(256) tile reads. A tower with radius 48 affects ~π×3² ≈ 28 cells.
  Total: 28 × 256 = ~7000 tile reads. Negligible for a rare event.

  C. Full rebuild (game load, map init)

  rebuildAllCells():
    clear all cellState, playerCells
    for each cellKey that has entities:
      classifyCell(ck)

  Cost: O(numCells × 256). With ~200 populated cells: ~51,000 tile reads. One-time on
  load.

  File: src/game/spatial-grid.ts

  Dependencies: Entity type only. getOwner passed as callback — no direct dependency
  on TerritoryManager.

  export class SpatialGrid {
      constructor(
          mapWidth: number,
          mapHeight: number,
          cellShift: number,                        // 4 for cellSize=16
          resolve: (id: number) => Entity | undefined,
          getOwner: (x: number, y: number) => number
      )

      add(entityId: number, x: number, y: number): void
      remove(entityId: number): void

      *nearby(cx: number, cy: number, radius: number): IterableIterator<Entity>
      *nearbyForPlayer(cx: number, cy: number, radius: number, player: number):
  IterableIterator<Entity>

      onTileOwnerChanged(x: number, y: number, oldOwner: number, newOwner: number):
  void
      classifyCells(x1: number, y1: number, x2: number, y2: number): void
      rebuildAllCells(): void
  }

  Where it lives

  GameState
    entityIndex: EntityIndex       // type + player lookups (units, buildings, counts)
    spatialIndex: SpatialGrid      // spatial + territory lookups (map objects, piles)

  addEntity/removeEntity maintain both indexes. Only MapObject and StackedPile are
  inserted into spatialIndex.

  ---
  Migration: caller by caller

  1. findTarget in work handlers (woodcutter, stonecutter, crop, simple harvest)

  Before:
  findNearestEntity(
      gameState.entityIndex.ofType(EntityType.MapObject),
      x, y, RADIUS, filter
  )

  After:
  findNearestEntity(
      gameState.spatialIndex.nearbyForPlayer(x, y, RADIUS, player),
      x, y, RADIUS, filter
  )

  Requires player to be available inside findTarget. Change the
  EntityWorkHandler.findTarget signature:

  // Before
  findTarget(x: number, y: number, settlerId?: number): ...
  // After
  findTarget(x: number, y: number, settlerId?: number, player?: number): ...

  Add player as optional trailing param — existing handlers that don't need it ignore
  it. The caller in WorkerTaskExecutor.findEntityTarget passes settler.player.

  Files: types.ts (interface), worker-task-executor.ts (caller), work-handlers.ts (4
  handlers)

  2. findNearestWorkplace

  Already uses entityIndex.ofTypeAndPlayer(Building, player). Buildings are few (~30
  per player) and don't need spatial bucketing.

  No change.

  3. isTooClose in findEmptySpot (planting proximity)

  Before:
  function isTooClose(gameState, x, y, minDistSq, filter): boolean {
      for (const entity of gameState.entities) { ... }
  }

  After:
  function isTooClose(entities: Iterable<Entity>, x, y, minDistSq, filter): boolean {
      for (const entity of entities) { ... }
  }

  FindEmptySpotConfig gains proximityEntities?: Iterable<Entity> — callers pass
  spatialIndex.nearby(cx, cy, searchRadius). Falls back to gameState.entities if not
  provided (backward compat during migration).

  No territory filter here — planting checks proximity to ALL nearby entities
  regardless of owner.

  Files: spatial-search.ts (function + config), tree-system.ts, crop-system.ts,
  stone-system.ts (callers that build config)

  4. findNearestFree in StackedPileManager

  Before:
  for (const entity of this.entityProvider.entities) {
      if (entity.type !== EntityType.StackedPile) continue;
      ...
  }

  After:
  for (const entity of this.gameState.spatialIndex.nearbyForPlayer(x, y, radius,
  player)) {
      if (entity.type !== EntityType.StackedPile) continue;
      ...
  }

  Both MapObject and StackedPile share the same SpatialGrid. The type filter in the
  loop body is still needed (grid contains both types) but the candidate set is tiny.

  File: stacked-pile-manager.ts

  5. Territory → SpatialGrid wiring

  Pioneer tile-by-tile expansion:

  TerritoryManager needs a hook for single-tile changes. Currently it does bulk
  recompute only. Add:

  // In TerritoryManager — called by pioneer work handler
  claimTile(x: number, y: number, player: number): void {
      const idx = y * this.mapWidth + x;
      const oldValue = this.territoryGrid[idx];
      const oldOwner = oldValue === 0 ? -1 : oldValue - 1;
      this.territoryGrid[idx] = player + 1;
      // Notify spatial index
      this.onTileChanged?.(x, y, oldOwner, player);
      // Mark boundary dots dirty (but NOT full recompute)
      this.boundaryDirty = true;
  }

  Wire onTileChanged to spatialIndex.onTileOwnerChanged.

  Tower build/destroy:

  After recompute(), call spatialIndex.classifyCells(affectedBounds). Or simpler:
  spatialIndex.rebuildAllCells() since recompute clears the whole grid anyway and
  towers are rare.

  Files: territory-manager.ts, game-state.ts (wiring)

  6. findNearestEntity signature

  Already takes Iterable<Entity> as first arg (from current refactor). Works as-is
  with nearbyForPlayer and nearby return types.

  No change.

  7. Settler task tick loop

  Already uses entityIndex.ofType(Unit). Units are not in the spatial grid.

  No change.

  ---
  File summary

  File: src/game/spatial-grid.ts
  Change: New. SpatialGrid class with cell states and territory integration
  ────────────────────────────────────────
  File: src/game/game-state.ts
  Change: Add spatialIndex field, wire into addEntity/removeEntity
  ────────────────────────────────────────
  File: src/game/features/territory/territory-manager.ts
  Change: Add claimTile() for pioneer path, wire onTileChanged callback, call
    classifyCells/rebuildAllCells after bulk recompute
  ────────────────────────────────────────
  File: src/game/features/settler-tasks/types.ts
  Change: Add player?: number to findTarget signature
  ────────────────────────────────────────
  File: src/game/features/settler-tasks/worker-task-executor.ts
  Change: Pass settler.player to findEntityTarget
  ────────────────────────────────────────
  File: src/game/features/settler-tasks/work-handlers.ts
  Change: Use spatialIndex.nearbyForPlayer(...) in 4 handlers
  ────────────────────────────────────────
  File: src/game/systems/spatial-search.ts
  Change: Update isTooClose/FindEmptySpotConfig to accept entity iterable
  ────────────────────────────────────────
  File: src/game/stacked-pile-manager.ts
  Change: Use spatialIndex.nearbyForPlayer in findNearestFree
  ────────────────────────────────────────
  File: src/game/features/trees/tree-system.ts
  Change: Pass proximityEntities in planting config
  ────────────────────────────────────────
  File: src/game/features/crops/crop-system.ts
  Change: Same
  ────────────────────────────────────────
  File: src/game/features/stones/stone-system.ts
  Change: Same

  What stays unchanged

  - EntityIndex — still used for tick loop (ofType(Unit)), workplace lookup
  (ofTypeAndPlayer(Building, player)), scripting API counts
  - findNearestEntity function — already takes Iterable<Entity>
  - Logistics pipeline — queries by inventory state, not spatial proximity
  - Construction materials — flow through carrier logistics
  - Combat system — uses getEntitiesInRadius which could later use the grid too, but
  is a separate concern

  Performance summary

  ┌─────────────────────┬─────────────────────┬──────────────────────────────────┐
  │        Query        │       Before        │              After               │
  ├─────────────────────┼─────────────────────┼──────────────────────────────────┤
  │ Woodcutter finds    │ ~3000 map objects   │ ~144 entities in ~12 nearby      │
  │ tree                │ scanned             │ cells                            │
  ├─────────────────────┼─────────────────────┼──────────────────────────────────┤
  │ Stonecutter finds   │ ~3000 map objects   │ same                             │
  │ stone               │                     │                                  │
  ├─────────────────────┼─────────────────────┼──────────────────────────────────┤
  │ Planting proximity  │ ~3000+ all entities │ ~200 nearby entities             │
  │ check               │                     │                                  │
  ├─────────────────────┼─────────────────────┼──────────────────────────────────┤
  │ Free pile search    │ ~5000 all entities  │ ~50 nearby piles+objects         │
  ├─────────────────────┼─────────────────────┼──────────────────────────────────┤
  │ Territory change    │ N/A                 │ ~28 cells × 256 tiles = ~7000    │
  │ (tower)             │                     │ reads (rare)                     │
  ├─────────────────────┼─────────────────────┼──────────────────────────────────┤
  │ Pioneer claims tile │ N/A                 │ O(1) cell state update           │
  ├─────────────────────┼─────────────────────┼──────────────────────────────────┤
  │ Entity add/remove   │ O(1) index          │ O(1) index + O(1) grid           │
  └─────────────────────┴─────────────────────┴──────────────────────────────────┘
