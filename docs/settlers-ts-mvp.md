# Settlers.ts MVP — Interactive Game Logic

## Goal

Add the minimum game logic needed to interact with the rendered map: **select tiles, place buildings, spawn units, and move them**. No economy, no production chains, no combat — just the foundational loop that makes the world feel alive.

---

## What Already Exists

| Layer | Status |
|-------|--------|
| File format loaders (gfx, lib, map, save) | Done |
| WebGL terrain rendering with height | Done |
| Camera pan/zoom (mouse + touch) | Done |
| Vue UI shell with routing | Done |
| Entity/unit system | Not started |
| Game simulation loop | Not started |
| Tile picking / click interaction | Not started |
| Sprite rendering (units/buildings) | Not started |

---

## MVP Scope

### What's In

1. **Tile picking** — click the map, get back a tile coordinate
2. **Game state** — minimal in-memory state for entities (units + buildings)
3. **Building placement** — click to place a building on a valid tile
4. **Unit spawning** — spawn a unit at a building or arbitrary tile
5. **Unit selection** — click a unit to select it
6. **Unit movement** — right-click to move selected unit to a tile (A\* pathfinding)
7. **Game loop** — fixed-tick simulation that advances movement each frame
8. **Entity rendering** — draw colored markers/sprites for units and buildings on the terrain

### What's Out

- WASM / Rust (all logic in TypeScript for now; port later)
- Economy, resources, production chains
- Combat, health, damage
- Territory, borders
- AI
- Multiplayer / networking
- Road network
- Carrier jobs
- Save/load of game state
- Sound

---

## Architecture

All new code lives under `src/game/` alongside the existing `Game` class and renderer.

```
src/game/
├── game.ts                    # (existing) — extend with entity state + tick loop
├── game-state.ts              # NEW: entity storage, tile index
├── entity.ts                  # NEW: entity types, IDs, components
├── systems/
│   ├── pathfinding.ts         # NEW: A* on tile grid
│   ├── movement.ts            # NEW: per-tick unit movement along path
│   └── placement.ts           # NEW: building placement validation
├── input/
│   └── tile-picker.ts         # NEW: screen coords → tile coords
├── renderer/
│   ├── landscape-renderer.ts  # (existing)
│   └── entity-renderer.ts     # NEW: draw units + buildings on map
└── commands/
    └── command.ts             # NEW: player commands (place, move, select)
```

---

## 1. Tile Picking

Convert a mouse click on the WebGL canvas into a tile coordinate.

### Approach

The existing `ViewPoint` tracks camera position and zoom. The `LandscapeRenderer` knows the tile layout geometry (parallelogram grid with height offsets). We reverse that transform:

```
screen (px) → world (float) → tile (int x, y)
```

**Steps:**
1. Get click position relative to canvas
2. Apply inverse camera transform (subtract pan, divide by zoom)
3. Account for the parallelogram grid geometry used by `LandscapeRenderer` (tiles are not square — they're drawn as parallelograms with a skew factor)
4. Snap to nearest tile center
5. Clamp to map bounds

### Integration

- Add a `click` event listener alongside the existing pointer handlers in `ViewPoint` (or in a new `TilePicker` class that wraps the canvas)
- Emit a `tileSelected(x, y)` event that the game state can consume
- Distinguish left-click (select / place) from right-click (move command)

### Files

| File | Change |
|------|--------|
| `src/game/input/tile-picker.ts` | New — reverse-project screen → tile |
| `src/game/renderer/landscape-renderer.ts` | Read-only — reference grid geometry constants |

---

## 2. Game State

A flat, typed-array-friendly entity store. Keep it simple — no full ECS yet, just arrays.

```typescript
// src/game/entity.ts

export const enum EntityType {
  None = 0,
  Unit = 1,
  Building = 2,
}

export interface Entity {
  id: number;
  type: EntityType;
  x: number;        // tile coordinate
  y: number;
  player: number;   // 0-based player index
  subType: number;   // e.g. BuildingType or UnitType enum value
}

export interface UnitState {
  entityId: number;
  path: { x: number; y: number }[];   // remaining waypoints
  pathIndex: number;
  moveProgress: number;                // 0–1 interpolation within current step
  speed: number;                       // tiles per second
}
```

```typescript
// src/game/game-state.ts

export class GameState {
  entities: Entity[] = [];
  unitStates: Map<number, UnitState> = new Map();
  selectedEntityId: number | null = null;
  nextId = 1;

  // Spatial lookup: tile → entity id (only one building per tile)
  tileOccupancy: Map<string, number> = new Map();  // "x,y" → entityId

  addEntity(type: EntityType, subType: number, x: number, y: number, player: number): Entity;
  removeEntity(id: number): void;
  getEntityAt(x: number, y: number): Entity | undefined;
  getEntitiesInRadius(x: number, y: number, radius: number): Entity[];
}
```

### Why not typed arrays yet?

Typed arrays (SoA layout from the architecture doc) are optimal for WASM and batch processing of thousands of entities. For the MVP with <100 entities and no WASM, plain objects and a `Map` are simpler to iterate on. Migrate to SoA when performance matters.

---

## 3. Building Placement

### Validation Rules (simplified for MVP)

A building can be placed on tile `(x, y)` if:
1. Terrain is buildable (not water, not rock, not swamp)
2. Tile is not already occupied by another entity
3. Slope is within threshold (max height diff with neighbors ≤ 2)

```typescript
// src/game/systems/placement.ts

export function canPlaceBuilding(
  groundType: Uint8Array,
  groundHeight: Uint8Array,
  mapWidth: number,
  tileOccupancy: Map<string, number>,
  x: number,
  y: number,
): boolean;
```

### Building Types (MVP subset)

```typescript
export const enum BuildingType {
  Guardhouse = 0,   // small military — defines territory
  Woodcutter = 1,   // placeholder production building
  Warehouse = 2,    // storage
}
```

Only 2-3 types to keep scope small. No production logic — buildings are static markers.

### Flow

1. Player selects a building type from a minimal UI panel
2. As mouse moves, `canPlaceBuilding` is called to show valid/invalid highlight
3. Left-click places the building → `GameState.addEntity(EntityType.Building, ...)`
4. Tile occupancy updated

---

## 4. Unit Spawning

Units are created at a building location or at an arbitrary tile (for testing).

```typescript
export const enum UnitType {
  Settler = 0,    // generic worker
  Soldier = 1,    // military unit
}
```

### Flow

1. For MVP: a "Spawn Unit" button in the UI, or automatic spawn when a building is placed
2. Creates an entity of type `Unit` at the building's tile
3. Registers a `UnitState` with empty path and default speed

---

## 5. Unit Selection

### Flow

1. Left-click on map → `TilePicker` resolves tile `(x, y)`
2. `GameState.getEntityAt(x, y)` checks for a unit
3. If found, set `selectedEntityId`
4. Renderer highlights the selected unit (e.g., colored ring or pulsing marker)

### Multi-select

Out of scope for MVP. Single unit selection only.

---

## 6. Unit Movement (A\* Pathfinding)

### A\* Implementation

Pure TypeScript. Operates on the tile grid using `groundType` for passability and `groundHeight` for movement cost.

```typescript
// src/game/systems/pathfinding.ts

export function findPath(
  startX: number, startY: number,
  goalX: number, goalY: number,
  groundType: Uint8Array,
  groundHeight: Uint8Array,
  mapWidth: number,
  mapHeight: number,
  tileOccupancy: Map<string, number>,
): { x: number; y: number }[] | null;
```

**Neighbor model:** 4-directional (up/down/left/right) for simplicity. The architecture doc references hex neighbors, but the actual `LandscapeRenderer` uses a parallelogram grid — check the vertex shader to determine the correct neighbor offsets before implementing.

**Cost function:**
- Base cost = 1
- Height difference penalty: `+ abs(heightDiff)`
- Impassable tiles (water, rock): infinite cost

**Max search nodes:** Cap at ~2000 to avoid blocking the main thread on large maps.

### Per-Tick Movement

```typescript
// src/game/systems/movement.ts

export function updateMovement(state: GameState, deltaSec: number): void {
  for (const unit of state.unitStates.values()) {
    if (unit.pathIndex >= unit.path.length) continue;

    unit.moveProgress += unit.speed * deltaSec;

    while (unit.moveProgress >= 1 && unit.pathIndex < unit.path.length) {
      unit.moveProgress -= 1;
      const wp = unit.path[unit.pathIndex];
      // update entity position
      const entity = state.getEntity(unit.entityId);
      entity.x = wp.x;
      entity.y = wp.y;
      unit.pathIndex++;
    }
  }
}
```

### Flow

1. Unit is selected
2. Right-click on map → resolve target tile
3. Run `findPath(unit.x, unit.y, targetX, targetY, ...)`
4. If path found, assign to `UnitState.path`
5. Each tick, `updateMovement` advances units along their paths

---

## 7. Game Loop

A `requestAnimationFrame`-based loop with a fixed simulation tick.

```typescript
// Added to Game class or a new GameLoop class

const TICK_RATE = 30;              // simulation Hz
const TICK_DURATION = 1 / TICK_RATE;

class GameLoop {
  private accumulator = 0;
  private lastTime = 0;
  private running = false;

  start(): void {
    this.running = true;
    this.lastTime = performance.now();
    this.frame(this.lastTime);
  }

  private frame(now: number): void {
    if (!this.running) return;

    const deltaSec = (now - this.lastTime) / 1000;
    this.lastTime = now;
    this.accumulator += deltaSec;

    // Fixed timestep simulation
    while (this.accumulator >= TICK_DURATION) {
      this.tick(TICK_DURATION);
      this.accumulator -= TICK_DURATION;
    }

    // Render (already triggered by ViewPoint.onMove via requestAnimationFrame)
    this.render();

    requestAnimationFrame((t) => this.frame(t));
  }

  private tick(dt: number): void {
    updateMovement(this.gameState, dt);
  }

  private render(): void {
    // Existing landscape renderer + new entity renderer
  }
}
```

Currently, rendering only happens on camera interaction (`ViewPoint.onMove` triggers `requestAnimationFrame`). The game loop replaces this with continuous rendering so moving units are visible.

---

## 8. Entity Rendering

A new `IRenderer` implementation that draws simple markers on the terrain for each entity.

### Approach Options

| Option | Pros | Cons |
|--------|------|------|
| **A. WebGL quads** | Consistent with existing renderer, GPU-accelerated | More shader code |
| **B. 2D canvas overlay** | Trivial to implement, text labels easy | Separate coordinate transform, z-fighting |
| **C. Colored triangles in existing shader** | No new renderer needed | Couples entity rendering to terrain |

**Recommendation: Option A** — add a second WebGL draw pass that renders textured quads (or colored rectangles) at entity world positions. This reuses the same WebGL context and camera transform.

### Minimal Implementation

```typescript
// src/game/renderer/entity-renderer.ts

export class EntityRenderer implements IRenderer {
  // Vertex buffer: one quad per entity
  // Uniforms: camera matrix (same as landscape), entity color

  draw(entities: Entity[], selectedId: number | null): void {
    for (const entity of entities) {
      const worldPos = tileToWorld(entity.x, entity.y, groundHeight);
      const color = entity.type === EntityType.Building ? BLUE : GREEN;
      const highlight = entity.id === selectedId;
      this.drawQuad(worldPos, color, highlight);
    }
  }
}
```

For MVP, entities are colored rectangles. Sprite-based rendering using the existing `GfxImage` assets can come later.

---

## 9. Minimal UI

Add a small overlay panel to the existing `map-view` or `renderer-viewer` Vue component.

### Elements

- **Building palette:** 2-3 buttons (Guardhouse, Woodcutter, Warehouse)
- **Spawn button:** "Spawn Unit" places a settler at the selected building
- **Info panel:** Shows selected entity type, position
- **Mode indicator:** "Place Building" / "Select" / "Move"

### Implementation

A `<div>` overlay positioned absolute over the canvas. No new Vue routes — just conditional rendering in the existing map view component.

---

## 10. Command System

Decouple player intent from execution so it's easy to add undo, networking, or replay later.

```typescript
// src/game/commands/command.ts

export type Command =
  | { type: 'place_building'; buildingType: BuildingType; x: number; y: number; player: number }
  | { type: 'spawn_unit'; unitType: UnitType; x: number; y: number; player: number }
  | { type: 'move_unit'; entityId: number; targetX: number; targetY: number }
  | { type: 'select'; entityId: number | null };

export function executeCommand(state: GameState, cmd: Command): boolean {
  switch (cmd.type) {
    case 'place_building':
      if (!canPlaceBuilding(...)) return false;
      state.addEntity(EntityType.Building, cmd.buildingType, cmd.x, cmd.y, cmd.player);
      return true;

    case 'move_unit':
      const path = findPath(entity.x, entity.y, cmd.targetX, cmd.targetY, ...);
      if (!path) return false;
      state.unitStates.get(cmd.entityId)!.path = path;
      return true;

    // ...
  }
}
```

---

## Implementation Order

Each step produces a visible, testable result.

### Step 1 — Tile Picker

- Implement `TilePicker` that converts canvas click → tile `(x, y)`
- Add a debug overlay showing hovered tile coordinates
- **Test:** hover over map, see correct tile coords update in real time

### Step 2 — Game State + Entity Model

- Create `GameState`, `Entity`, `UnitState` types
- Wire into `Game` class
- **Test:** programmatically add entities, verify they appear in state

### Step 3 — Entity Renderer

- Implement `EntityRenderer` as a new `IRenderer`
- Register it in the `Renderer` draw loop
- Hard-code a few test entities
- **Test:** see colored quads on the terrain at known tile positions

### Step 4 — Building Placement

- Add `canPlaceBuilding` validation
- Add minimal UI with building type buttons
- On left-click: execute `place_building` command
- **Test:** click valid tile → building appears; click water → nothing happens

### Step 5 — Unit Spawn + Selection

- "Spawn Unit" button creates a unit at the selected building
- Left-click on unit → select it (highlight changes)
- **Test:** spawn unit, click it, see highlight

### Step 6 — Pathfinding

- Implement A\* over tile grid
- Visualize found path (debug overlay or colored tiles)
- **Test:** pathfind between two tiles, see path drawn on map

### Step 7 — Movement + Game Loop

- Start `GameLoop` with `requestAnimationFrame`
- `updateMovement` advances units along path each tick
- Right-click with selected unit → move command
- **Test:** select unit, right-click distant tile, watch unit walk there

### Step 8 — Polish

- Smooth interpolation between tiles (lerp position within tick)
- Placement preview (ghost building at cursor)
- Invalid placement indicator (red tint)
- Unit arrival callback (clear path, set idle)

---

## Technical Notes

### Coordinate Transform Reference

The `LandscapeRenderer` vertex shader positions tiles using these uniforms/attributes:
- `u_viewPoint` — camera offset (from `ViewPoint.x`, `ViewPoint.y`)
- `u_zoom` — camera zoom (from `ViewPoint.zoomValue`)
- `a_offset` — per-instance tile position (integer x, y packed)
- Height is read from `u_landHeightBuffer` texture

The `TilePicker` must replicate this transform in reverse. Key geometry: tiles are parallelograms, not rectangles. The skew depends on the vertex positions defined in the landscape renderer's quad geometry.

### Terrain Type Passability

The existing `LandscapeTextureMap` maps terrain type indices to texture names (grass, water, rock, etc.). Reuse the same type index to define passability:

| Index Range | Terrain | Passable | Buildable |
|-------------|---------|----------|-----------|
| 0-7 | Grass variants | Yes | Yes |
| 16-19 | Water | No | No |
| 20-23 | Beach | Yes | No |
| 24-27 | Desert | Yes | Yes |
| 32-35 | Swamp/mud | Yes | No |
| 48-51 | Rock | No | No |
| 64-67 | Snow | Yes | No |

These ranges need verification against the actual `LandscapeTextureMap.MAP` data.

### Performance Budget

With <100 entities and no WASM, performance is not a concern for the MVP. The A\* pathfinder should cap search at ~2000 nodes to keep frame time under 5ms. If maps are 256x256 (65K tiles), this covers paths up to ~45 tiles long before hitting the cap.

---

## Success Criteria

The MVP is done when a user can:

1. Load a map file
2. See the terrain rendered (already works)
3. Click a tile and see its coordinates
4. Place a building on a valid tile
5. Spawn a unit at that building
6. Select the unit
7. Right-click a destination tile
8. Watch the unit walk there, navigating around water and mountains
