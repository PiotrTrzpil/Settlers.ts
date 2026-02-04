# Settlers.ts Extended Architecture

## Game Engine Implementation Guide

**Version:** 1.0  
**Target:** Settlers 4 reimplementation with Settlers 3 compatibility layer  
**Stack:** TypeScript + Rust/WebAssembly + WebGL

---

## Table of Contents

1. [Overview](#1-overview)
2. [High-Level Architecture](#2-high-level-architecture)
3. [Core Data Structures](#3-core-data-structures)
4. [WASM Boundary Design](#4-wasm-boundary-design)
5. [Map and Terrain System](#5-map-and-terrain-system)
6. [Entity System](#6-entity-system)
7. [Pathfinding](#7-pathfinding)
8. [Economy and Production](#8-economy-and-production)
9. [Job and Task System](#9-job-and-task-system)
10. [Territory and Borders](#10-territory-and-borders)
11. [Combat System](#11-combat-system)
12. [AI System](#12-ai-system)
13. [Multiplayer Considerations](#13-multiplayer-considerations)
14. [File Structure](#14-file-structure)
15. [Implementation Phases](#15-implementation-phases)
16. [Appendix: Known S3/S4 Mechanics](#appendix-known-s3s4-mechanics)

---

## 1. Overview

### 1.1 Goals

- Faithful recreation of Settlers 4 gameplay mechanics
- Cross-platform via browser (WebGL + WASM)
- Performance capable of handling 2000+ entities at 30Hz simulation
- Moddable architecture for custom content
- Optional compatibility mode for Settlers 3 mechanics

### 1.2 Design Principles

| Principle | Implementation |
|-----------|----------------|
| Deterministic simulation | Fixed-point math in WASM, no floats in game logic |
| Data-oriented design | Entity Component System, cache-friendly layouts |
| Clear WASM boundary | TypeScript owns state, Rust performs computation |
| Incremental complexity | Each system works standalone before integration |

### 1.3 What Settlers.ts Already Provides

- File format parsers (gfx, lib, map, save games)
- WebGL terrain rendering
- Asset extraction pipeline
- Basic map visualization

### 1.4 What This Document Adds

- Complete game logic architecture
- WASM integration patterns
- All simulation systems
- Multiplayer-ready design

---

## 2. High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                        Browser Environment                          │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  ┌───────────────────────────────────────────────────────────────┐  │
│  │                    TypeScript Layer                           │  │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐   │  │
│  │  │   Renderer  │  │  UI/Input   │  │   State Manager     │   │  │
│  │  │   (WebGL)   │  │  (DOM/Vue)  │  │   (Game State)      │   │  │
│  │  └──────┬──────┘  └──────┬──────┘  └──────────┬──────────┘   │  │
│  │         │                │                    │               │  │
│  │         └────────────────┼────────────────────┘               │  │
│  │                          │                                    │  │
│  │  ┌───────────────────────▼────────────────────────────────┐   │  │
│  │  │                  Game Controller                       │   │  │
│  │  │  - Tick scheduling        - Event dispatch             │   │  │
│  │  │  - State serialization    - Save/Load                  │   │  │
│  │  └───────────────────────┬────────────────────────────────┘   │  │
│  └──────────────────────────┼────────────────────────────────────┘  │
│                             │                                       │
│                    ArrayBuffer / SharedArrayBuffer                  │
│                             │                                       │
│  ┌──────────────────────────▼────────────────────────────────────┐  │
│  │                     WASM Layer (Rust)                         │  │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐   │  │
│  │  │ Pathfinding │  │  Simulation │  │  Spatial Index      │   │  │
│  │  │   Engine    │  │    Step     │  │  (Quadtree/Grid)    │   │  │
│  │  └─────────────┘  └─────────────┘  └─────────────────────┘   │  │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐   │  │
│  │  │  Territory  │  │   Combat    │  │    AI Planning      │   │  │
│  │  │  Calculator │  │   Resolver  │  │    (Optional)       │   │  │
│  │  └─────────────┘  └─────────────┘  └─────────────────────┘   │  │
│  └───────────────────────────────────────────────────────────────┘  │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

### 2.1 Layer Responsibilities

**TypeScript Layer:**
- Game state ownership (single source of truth)
- Entity lifecycle management
- Event handling and dispatch
- Rendering coordination
- UI and input handling
- Network communication (multiplayer)
- Save/load serialization

**WASM Layer:**
- Pathfinding computation
- Per-tick simulation stepping
- Spatial queries (nearest neighbor, range queries)
- Territory/border calculation
- Combat resolution
- AI decision making (optional)
- Any algorithm requiring tight loops over large datasets

### 2.2 Tick Model

```
Game Tick (33ms target = 30 ticks/sec)
├── Input Phase
│   └── Collect player commands, network messages
├── Simulation Phase (WASM)
│   ├── Process movement
│   ├── Update production timers
│   ├── Execute jobs
│   ├── Resolve combat
│   └── Update territory
├── Event Phase
│   └── Dispatch events to listeners
└── Render Phase
    └── Interpolate positions, draw frame
```

**Improvement over original:** Settlers 4 tied simulation to frame rate. We decouple simulation ticks from render frames, allowing smooth 60fps rendering with 30Hz simulation.

---

## 3. Core Data Structures

### 3.1 Coordinate System

```typescript
// All coordinates use fixed-point integers for determinism
// 1 tile = 256 units (8 bits fractional precision)
type FixedPoint = number; // Actually i32, scaled by 256

interface TileCoord {
  x: number; // Integer tile position
  y: number;
}

interface WorldCoord {
  x: FixedPoint; // Sub-tile precision
  y: FixedPoint;
}

// Conversion
const TILE_SCALE = 256;
const toWorld = (tile: TileCoord): WorldCoord => ({
  x: tile.x * TILE_SCALE,
  y: tile.y * TILE_SCALE,
});
const toTile = (world: WorldCoord): TileCoord => ({
  x: Math.floor(world.x / TILE_SCALE),
  y: Math.floor(world.y / TILE_SCALE),
});
```

### 3.2 Entity ID System

```typescript
// Packed entity ID for cache-friendly iteration
// Format: [type:4][generation:12][index:16]
type EntityId = number; // u32

const ENTITY_TYPE_BITS = 4;
const GENERATION_BITS = 12;
const INDEX_BITS = 16;

enum EntityType {
  None = 0,
  Settler = 1,
  Building = 2,
  Resource = 3,
  Projectile = 4,
  Decoration = 5,
  Animal = 6,
}

function makeEntityId(type: EntityType, generation: number, index: number): EntityId {
  return (type << 28) | (generation << 16) | index;
}

function getEntityType(id: EntityId): EntityType {
  return (id >>> 28) & 0xF;
}
```

### 3.3 Entity Component Layout (Struct of Arrays)

```typescript
// Instead of: entities: Entity[] where Entity has all fields
// We use: separate typed arrays for each component

interface SettlerComponents {
  // Identity (always present)
  ids: Uint32Array;           // EntityId
  types: Uint8Array;          // SettlerType enum
  players: Uint8Array;        // Player index (0-7)
  
  // Position (always present)
  posX: Int32Array;           // FixedPoint world X
  posY: Int32Array;           // FixedPoint world Y
  rotation: Uint16Array;      // 0-65535 maps to 0-360°
  
  // Movement (sparse - only moving settlers)
  targetX: Int32Array;
  targetY: Int32Array;
  speed: Uint16Array;
  pathIndex: Uint16Array;     // Current index in path buffer
  
  // Job (sparse - only working settlers)
  jobType: Uint8Array;
  jobTarget: Uint32Array;     // EntityId of job target
  jobProgress: Uint16Array;   // 0-65535 progress
  
  // Inventory (sparse - carriers/specialists)
  carryType: Uint8Array;      // ResourceType enum
  carryAmount: Uint8Array;
  
  // Combat (sparse - military units)
  health: Uint16Array;
  attackCooldown: Uint8Array;
  combatTarget: Uint32Array;
}

// Component presence tracked via bitflags
interface SettlerFlags {
  flags: Uint8Array;  // Per-settler bitflags
}

const FLAG_HAS_MOVEMENT = 0x01;
const FLAG_HAS_JOB = 0x02;
const FLAG_HAS_INVENTORY = 0x04;
const FLAG_HAS_COMBAT = 0x08;
const FLAG_IS_ALIVE = 0x10;
```

**Why Struct of Arrays?**
- Cache-friendly iteration (process all positions, then all jobs, etc.)
- WASM can operate on contiguous memory
- Sparse components don't waste memory
- Easy to serialize for save games

### 3.4 Building Data

```typescript
interface BuildingComponents {
  ids: Uint32Array;
  types: Uint16Array;         // BuildingType enum
  players: Uint8Array;
  
  // Position (buildings are tile-aligned)
  tileX: Uint16Array;
  tileY: Uint16Array;
  
  // State
  constructionProgress: Uint16Array;  // 0 = complete, >0 = under construction
  productionProgress: Uint16Array;    // Current production cycle progress
  isActive: Uint8Array;               // 0 = disabled, 1 = active
  
  // Inventory slots (fixed size per building type)
  // Stored as offsets into a shared inventory buffer
  inventoryOffset: Uint32Array;
  
  // Workers
  workerSlots: Uint8Array;            // Max workers
  workerCount: Uint8Array;            // Current workers
  // Worker EntityIds stored in separate lookup
}

// Building inventory stored separately for variable-size access
interface BuildingInventory {
  // Packed: [buildingIndex][slotIndex] -> ResourceStack
  buffer: Uint32Array;  // [resourceType:8][amount:24]
}
```

### 3.5 Map Data

```typescript
interface MapData {
  width: number;
  height: number;
  
  // Per-tile data (row-major order)
  terrain: Uint8Array;        // TerrainType enum
  height: Uint8Array;         // Height level 0-255
  passability: Uint8Array;    // Bitflags: walk, build, resource
  owner: Uint8Array;          // Player index (255 = neutral)
  
  // Resource deposits
  resourceType: Uint8Array;   // ResourceType at this tile
  resourceAmount: Uint16Array; // Remaining amount
  
  // Road network
  roadLevel: Uint8Array;      // 0 = none, 1 = path, 2 = road
  roadConnections: Uint8Array; // Bitflags for 6 hex directions
  
  // Objects on tile
  objectId: Uint32Array;      // EntityId of object (building/resource/decoration)
}

// Terrain types (from S4)
enum TerrainType {
  Grass = 0,
  Desert = 1,
  Swamp = 2,
  Snow = 3,
  Rock = 4,
  Water = 5,
  Lava = 6,
  Beach = 7,
  // ... etc
}
```

---

## 4. WASM Boundary Design

### 4.1 Memory Layout

```rust
// Rust side: Define shared memory structure
#[repr(C)]
pub struct GameMemory {
    // Header
    pub tick: u32,
    pub settler_count: u32,
    pub building_count: u32,
    pub path_request_count: u32,
    
    // Settler arrays (offsets from base)
    pub settler_pos_x: u32,      // Offset to i32[]
    pub settler_pos_y: u32,
    pub settler_target_x: u32,
    pub settler_target_y: u32,
    pub settler_flags: u32,
    // ... etc
    
    // Map data
    pub map_width: u32,
    pub map_height: u32,
    pub map_passability: u32,   // Offset to u8[]
    pub map_roads: u32,
    
    // Path results buffer
    pub path_results: u32,
}
```

```typescript
// TypeScript side: Create and manage shared buffer
class WasmBridge {
  private memory: WebAssembly.Memory;
  private gameMemory: GameMemory;
  
  constructor(maxSettlers: number, mapWidth: number, mapHeight: number) {
    // Calculate required memory
    const settlerBytes = maxSettlers * SETTLER_STRIDE;
    const mapBytes = mapWidth * mapHeight * MAP_TILE_STRIDE;
    const pathBytes = MAX_PATH_REQUESTS * MAX_PATH_LENGTH * 4;
    
    const totalPages = Math.ceil((settlerBytes + mapBytes + pathBytes) / 65536);
    this.memory = new WebAssembly.Memory({ initial: totalPages, maximum: totalPages * 2 });
    
    // Initialize layout
    this.gameMemory = this.initializeLayout();
  }
  
  // Zero-copy access to settler positions
  getSettlerPositions(): { x: Int32Array, y: Int32Array } {
    const base = new Int32Array(this.memory.buffer);
    return {
      x: base.subarray(this.gameMemory.settler_pos_x / 4, 
                       this.gameMemory.settler_pos_x / 4 + this.gameMemory.settler_count),
      y: base.subarray(this.gameMemory.settler_pos_y / 4,
                       this.gameMemory.settler_pos_y / 4 + this.gameMemory.settler_count),
    };
  }
}
```

### 4.2 Function Interface

```rust
// lib.rs - WASM exports

use wasm_bindgen::prelude::*;

/// Process one simulation tick
/// Returns number of events generated
#[wasm_bindgen]
pub fn simulation_step(memory_ptr: *mut u8, delta_ticks: u32) -> u32 {
    let game = unsafe { &mut *(memory_ptr as *mut GameMemory) };
    
    // 1. Process movement
    let move_events = process_movement(game, delta_ticks);
    
    // 2. Update production
    let prod_events = process_production(game, delta_ticks);
    
    // 3. Resolve combat
    let combat_events = process_combat(game, delta_ticks);
    
    move_events + prod_events + combat_events
}

/// Request pathfinding for multiple units
/// Paths written to path_results buffer
#[wasm_bindgen]
pub fn compute_paths(
    memory_ptr: *mut u8,
    request_count: u32,
) -> u32 {
    let game = unsafe { &mut *(memory_ptr as *mut GameMemory) };
    
    let mut completed = 0;
    for i in 0..request_count {
        if let Some(path) = find_path(game, i) {
            write_path_result(game, i, &path);
            completed += 1;
        }
    }
    completed
}

/// Recalculate territory borders for a player
#[wasm_bindgen]
pub fn update_territory(memory_ptr: *mut u8, player: u8) {
    let game = unsafe { &mut *(memory_ptr as *mut GameMemory) };
    calculate_borders(game, player);
}

/// Query spatial index for entities in range
/// Returns count, entity IDs written to result buffer
#[wasm_bindgen]
pub fn query_entities_in_range(
    memory_ptr: *mut u8,
    center_x: i32,
    center_y: i32,
    radius: i32,
    entity_type_mask: u8,
) -> u32 {
    let game = unsafe { &mut *(memory_ptr as *mut GameMemory) };
    spatial_query(game, center_x, center_y, radius, entity_type_mask)
}
```

### 4.3 Event System

WASM writes events to a ring buffer; TypeScript reads and dispatches.

```rust
#[repr(C)]
pub struct GameEvent {
    pub event_type: u8,
    pub tick: u32,
    pub entity_id: u32,
    pub data: [u8; 12],  // Event-specific payload
}

// Event types
const EVENT_SETTLER_ARRIVED: u8 = 1;
const EVENT_PRODUCTION_COMPLETE: u8 = 2;
const EVENT_BUILDING_COMPLETE: u8 = 3;
const EVENT_COMBAT_HIT: u8 = 4;
const EVENT_SETTLER_DIED: u8 = 5;
const EVENT_RESOURCE_DEPLETED: u8 = 6;
// ... etc
```

```typescript
// TypeScript event handler
interface SettlerArrivedEvent {
  type: 'settler_arrived';
  tick: number;
  settlerId: EntityId;
  destinationX: number;
  destinationY: number;
}

class EventDispatcher {
  private handlers: Map<string, ((event: GameEvent) => void)[]> = new Map();
  
  processEvents(eventBuffer: Uint8Array, count: number): void {
    const view = new DataView(eventBuffer.buffer);
    for (let i = 0; i < count; i++) {
      const offset = i * EVENT_SIZE;
      const eventType = view.getUint8(offset);
      const event = this.parseEvent(eventType, view, offset);
      this.dispatch(event);
    }
  }
}
```

---

## 5. Map and Terrain System

### 5.1 Terrain Properties

```typescript
// Derived from S4 terrain types
interface TerrainProperties {
  walkable: boolean;
  buildable: boolean;
  farmable: boolean;
  woodsGrowth: boolean;     // Can trees grow here
  movementCost: number;     // 1.0 = normal, 2.0 = half speed
  resourceSpawnMask: number; // Which resources can exist here
}

const TERRAIN_PROPERTIES: Record<TerrainType, TerrainProperties> = {
  [TerrainType.Grass]: {
    walkable: true, buildable: true, farmable: true,
    woodsGrowth: true, movementCost: 1.0, resourceSpawnMask: 0xFF
  },
  [TerrainType.Desert]: {
    walkable: true, buildable: true, farmable: false,
    woodsGrowth: false, movementCost: 1.2, resourceSpawnMask: 0x03
  },
  [TerrainType.Swamp]: {
    walkable: true, buildable: false, farmable: false,
    woodsGrowth: false, movementCost: 2.0, resourceSpawnMask: 0x00
  },
  [TerrainType.Water]: {
    walkable: false, buildable: false, farmable: false,
    woodsGrowth: false, movementCost: Infinity, resourceSpawnMask: 0x00
  },
  // ... etc
};
```

### 5.2 Height and Slopes

```rust
// Rust: Height affects passability and building placement
pub fn calculate_slope(map: &MapData, x: u32, y: u32) -> u8 {
    let center = map.get_height(x, y);
    let mut max_diff = 0u8;
    
    for (dx, dy) in NEIGHBOR_OFFSETS.iter() {
        let nx = (x as i32 + dx) as u32;
        let ny = (y as i32 + dy) as u32;
        if map.in_bounds(nx, ny) {
            let diff = (center as i32 - map.get_height(nx, ny) as i32).abs() as u8;
            max_diff = max_diff.max(diff);
        }
    }
    max_diff
}

// Building placement rules
pub fn can_place_building(map: &MapData, building_type: u16, x: u32, y: u32) -> bool {
    let size = BUILDING_SIZES[building_type as usize];
    
    for dy in 0..size.height {
        for dx in 0..size.width {
            let tx = x + dx;
            let ty = y + dy;
            
            // Check terrain
            if !map.is_buildable(tx, ty) {
                return false;
            }
            
            // Check slope (max 2 height difference for most buildings)
            if calculate_slope(map, tx, ty) > BUILDING_MAX_SLOPE[building_type as usize] {
                return false;
            }
            
            // Check existing objects
            if map.get_object(tx, ty) != 0 {
                return false;
            }
        }
    }
    true
}
```

### 5.3 Road Network

Roads form a graph for efficient carrier routing.

```typescript
// Road graph node
interface RoadNode {
  tileX: number;
  tileY: number;
  connections: number[];  // Indices of connected nodes
  buildings: EntityId[];  // Buildings accessible from this node
}

class RoadNetwork {
  private nodes: RoadNode[] = [];
  private tileToNode: Map<number, number> = new Map(); // packed coord -> node index
  
  // Called when road is built/destroyed
  rebuildGraph(map: MapData): void {
    this.nodes = [];
    this.tileToNode.clear();
    
    // Find all road tiles
    for (let y = 0; y < map.height; y++) {
      for (let x = 0; x < map.width; x++) {
        if (map.roadLevel[y * map.width + x] > 0) {
          this.addNode(x, y, map);
        }
      }
    }
    
    // Build connections
    for (const node of this.nodes) {
      node.connections = this.findConnections(node, map);
    }
  }
  
  // Find path through road network (faster than raw A*)
  findRoadPath(from: TileCoord, to: TileCoord): TileCoord[] | null {
    const startNode = this.tileToNode.get(packCoord(from));
    const endNode = this.tileToNode.get(packCoord(to));
    
    if (startNode === undefined || endNode === undefined) {
      return null; // Need to pathfind to/from road
    }
    
    return this.dijkstra(startNode, endNode);
  }
}
```

**Improvement over original:** S4's road network sometimes caused carriers to take inefficient routes. We precompute a proper graph and use Dijkstra for guaranteed shortest paths.

---

## 6. Entity System

### 6.1 Settler Types

```typescript
// Based on S4 settler types
enum SettlerType {
  // Basic
  Carrier = 0,
  Builder = 1,
  Digger = 2,
  
  // Production
  Woodcutter = 10,
  Forester = 11,
  Stonecutter = 12,
  Fisher = 13,
  Farmer = 14,
  Miller = 15,
  Baker = 16,
  Butcher = 17,
  Waterworker = 18,
  Brewer = 19,
  Winemaker = 20,
  
  // Mining
  CoalMiner = 30,
  IronMiner = 31,
  GoldMiner = 32,
  StoneMiner = 33,
  SulfurMiner = 34,
  GemMiner = 35,
  
  // Crafting
  Smelter = 40,
  Smith = 41,
  Toolmaker = 42,
  Weaponsmith = 43,
  Armorsmith = 44,
  
  // Military (S4)
  Swordsman1 = 50,
  Swordsman2 = 51,
  Swordsman3 = 52,
  Bowman1 = 53,
  Bowman2 = 54,
  Bowman3 = 55,
  Axeman1 = 56,
  Axeman2 = 57,
  Axeman3 = 58,
  Blowgunner = 59,  // Mayan unique
  Backpacker = 60,  // Mayan/Trojan
  
  // Special
  Priest = 70,
  Thief = 71,
  Geologist = 72,
  Pioneer = 73,
}

// Settler properties (from game data files)
interface SettlerTypeProperties {
  speed: number;            // Tiles per second (fixed point)
  carryCapacity: number;
  combatStats?: {
    health: number;
    attack: number;
    defense: number;
    range: number;          // 0 for melee
    attackSpeed: number;    // Ticks between attacks
  };
  workSpeed: number;        // Production multiplier
}
```

### 6.2 Entity Lifecycle

```typescript
class EntityManager {
  private settlers: SettlerComponents;
  private buildings: BuildingComponents;
  
  private freeSettlerIndices: number[] = [];
  private freeBuildingIndices: number[] = [];
  
  private settlerGenerations: Uint16Array;
  private buildingGenerations: Uint16Array;
  
  createSettler(type: SettlerType, player: number, x: number, y: number): EntityId {
    let index: number;
    let generation: number;
    
    if (this.freeSettlerIndices.length > 0) {
      index = this.freeSettlerIndices.pop()!;
      generation = this.settlerGenerations[index] + 1;
    } else {
      index = this.settlers.count++;
      generation = 0;
    }
    
    this.settlerGenerations[index] = generation;
    
    // Initialize components
    const id = makeEntityId(EntityType.Settler, generation, index);
    this.settlers.ids[index] = id;
    this.settlers.types[index] = type;
    this.settlers.players[index] = player;
    this.settlers.posX[index] = x * TILE_SCALE;
    this.settlers.posY[index] = y * TILE_SCALE;
    this.settlers.flags[index] = FLAG_IS_ALIVE;
    
    return id;
  }
  
  destroySettler(id: EntityId): void {
    if (getEntityType(id) !== EntityType.Settler) return;
    
    const index = id & 0xFFFF;
    const generation = (id >>> 16) & 0xFFF;
    
    // Verify generation matches (handle stale IDs)
    if (this.settlerGenerations[index] !== generation) return;
    
    this.settlers.flags[index] &= ~FLAG_IS_ALIVE;
    this.freeSettlerIndices.push(index);
  }
  
  isValidSettler(id: EntityId): boolean {
    if (getEntityType(id) !== EntityType.Settler) return false;
    const index = id & 0xFFFF;
    const generation = (id >>> 16) & 0xFFF;
    return this.settlerGenerations[index] === generation &&
           (this.settlers.flags[index] & FLAG_IS_ALIVE) !== 0;
  }
}
```

### 6.3 Spatial Indexing

```rust
// Rust: Grid-based spatial index for fast queries

const CELL_SIZE: i32 = 16 * 256;  // 16 tiles in fixed-point

pub struct SpatialGrid {
    width: u32,
    height: u32,
    cells: Vec<Vec<u32>>,  // Cell -> list of entity IDs
}

impl SpatialGrid {
    pub fn new(map_width: u32, map_height: u32) -> Self {
        let width = (map_width * 256 / CELL_SIZE as u32) + 1;
        let height = (map_height * 256 / CELL_SIZE as u32) + 1;
        let cells = vec![Vec::with_capacity(32); (width * height) as usize];
        SpatialGrid { width, height, cells }
    }
    
    fn cell_index(&self, x: i32, y: i32) -> usize {
        let cx = (x / CELL_SIZE).clamp(0, self.width as i32 - 1) as u32;
        let cy = (y / CELL_SIZE).clamp(0, self.height as i32 - 1) as u32;
        (cy * self.width + cx) as usize
    }
    
    pub fn insert(&mut self, id: u32, x: i32, y: i32) {
        let idx = self.cell_index(x, y);
        self.cells[idx].push(id);
    }
    
    pub fn query_range(&self, cx: i32, cy: i32, radius: i32, results: &mut Vec<u32>) {
        let r_sq = (radius as i64) * (radius as i64);
        
        let min_cell_x = ((cx - radius) / CELL_SIZE).max(0) as u32;
        let max_cell_x = ((cx + radius) / CELL_SIZE).min(self.width as i32 - 1) as u32;
        let min_cell_y = ((cy - radius) / CELL_SIZE).max(0) as u32;
        let max_cell_y = ((cy + radius) / CELL_SIZE).min(self.height as i32 - 1) as u32;
        
        for cell_y in min_cell_y..=max_cell_y {
            for cell_x in min_cell_x..=max_cell_x {
                let idx = (cell_y * self.width + cell_x) as usize;
                for &id in &self.cells[idx] {
                    // Actual distance check done by caller with precise positions
                    results.push(id);
                }
            }
        }
    }
    
    pub fn rebuild(&mut self, positions_x: &[i32], positions_y: &[i32], flags: &[u8]) {
        for cell in &mut self.cells {
            cell.clear();
        }
        
        for (i, (&x, &y)) in positions_x.iter().zip(positions_y.iter()).enumerate() {
            if flags[i] & FLAG_IS_ALIVE != 0 {
                self.insert(i as u32, x, y);
            }
        }
    }
}
```

---

## 7. Pathfinding

### 7.1 Hierarchical Pathfinding

For large maps with many units, pure A* is too expensive. We use hierarchical pathfinding:

1. **Abstract graph:** Divide map into sectors (~16x16 tiles), precompute paths between sector edges
2. **High-level search:** A* on sector graph
3. **Low-level refinement:** A* within each sector

```rust
// Sector-based hierarchical pathfinding

const SECTOR_SIZE: u32 = 16;

pub struct PathfindingContext {
    map_width: u32,
    map_height: u32,
    passability: Vec<u8>,
    
    // Sector graph
    sectors_x: u32,
    sectors_y: u32,
    sector_edges: Vec<SectorEdge>,      // Connections between sectors
    intra_sector_paths: Vec<Vec<u8>>,   // Precomputed paths within sectors
}

#[derive(Clone)]
pub struct SectorEdge {
    from_sector: u16,
    to_sector: u16,
    from_tile: u16,  // Packed local coordinate
    to_tile: u16,
    cost: u16,
}

impl PathfindingContext {
    pub fn find_path(&self, start: (i32, i32), goal: (i32, i32)) -> Option<Vec<(i32, i32)>> {
        let start_sector = self.get_sector(start.0, start.1);
        let goal_sector = self.get_sector(goal.0, goal.1);
        
        if start_sector == goal_sector {
            // Same sector: direct A*
            return self.local_astar(start, goal);
        }
        
        // Different sectors: hierarchical search
        // 1. Find sector-level path
        let sector_path = self.sector_astar(start_sector, goal_sector)?;
        
        // 2. Refine to tile-level path
        let mut full_path = Vec::new();
        let mut current = start;
        
        for i in 0..sector_path.len() - 1 {
            let edge = &self.sector_edges[sector_path[i]];
            let waypoint = self.unpack_tile(edge.to_tile, edge.to_sector);
            
            // Local path to sector boundary
            let local = self.local_astar(current, waypoint)?;
            full_path.extend(local);
            current = waypoint;
        }
        
        // Final segment to goal
        let final_segment = self.local_astar(current, goal)?;
        full_path.extend(final_segment);
        
        Some(full_path)
    }
    
    fn local_astar(&self, start: (i32, i32), goal: (i32, i32)) -> Option<Vec<(i32, i32)>> {
        // Standard A* with early termination at sector boundaries
        // ... implementation ...
    }
}
```

### 7.2 Flow Fields (Alternative for Mass Movement)

When many units need to reach the same destination (e.g., attack move), flow fields are more efficient:

```rust
pub struct FlowField {
    width: u32,
    height: u32,
    directions: Vec<u8>,  // 0-7 for 8 directions, 255 = blocked
    distances: Vec<u16>,  // Distance to goal
}

impl FlowField {
    pub fn generate(map: &MapData, goal_x: u32, goal_y: u32) -> Self {
        let mut field = FlowField {
            width: map.width,
            height: map.height,
            directions: vec![255; (map.width * map.height) as usize],
            distances: vec![u16::MAX; (map.width * map.height) as usize],
        };
        
        // Dijkstra from goal outward
        let mut queue = BinaryHeap::new();
        let goal_idx = (goal_y * map.width + goal_x) as usize;
        field.distances[goal_idx] = 0;
        queue.push(Reverse((0u16, goal_x, goal_y)));
        
        while let Some(Reverse((dist, x, y))) = queue.pop() {
            let idx = (y * map.width + x) as usize;
            if dist > field.distances[idx] {
                continue;
            }
            
            for (dir, (dx, dy)) in DIRECTIONS.iter().enumerate() {
                let nx = (x as i32 + dx) as u32;
                let ny = (y as i32 + dy) as u32;
                
                if !map.in_bounds(nx, ny) || !map.is_walkable(nx, ny) {
                    continue;
                }
                
                let n_idx = (ny * map.width + nx) as usize;
                let move_cost = map.get_movement_cost(nx, ny);
                let new_dist = dist + move_cost;
                
                if new_dist < field.distances[n_idx] {
                    field.distances[n_idx] = new_dist;
                    field.directions[n_idx] = (dir + 4) % 8;  // Reverse direction
                    queue.push(Reverse((new_dist, nx, ny)));
                }
            }
        }
        
        field
    }
    
    pub fn get_direction(&self, x: u32, y: u32) -> Option<(i32, i32)> {
        let idx = (y * self.width + x) as usize;
        let dir = self.directions[idx];
        if dir == 255 {
            None
        } else {
            Some(DIRECTIONS[dir as usize])
        }
    }
}

const DIRECTIONS: [(i32, i32); 8] = [
    (1, 0), (1, 1), (0, 1), (-1, 1),
    (-1, 0), (-1, -1), (0, -1), (1, -1),
];
```

### 7.3 Path Request Batching

```typescript
// TypeScript side: Batch path requests for efficient WASM calls

class PathfindingService {
  private pendingRequests: PathRequest[] = [];
  private requestCallbacks: Map<number, (path: TileCoord[] | null) => void> = new Map();
  private nextRequestId = 0;
  
  requestPath(
    from: TileCoord,
    to: TileCoord,
    callback: (path: TileCoord[] | null) => void
  ): number {
    const id = this.nextRequestId++;
    this.pendingRequests.push({ id, from, to });
    this.requestCallbacks.set(id, callback);
    return id;
  }
  
  // Called each tick
  processBatch(wasm: WasmBridge, maxRequests: number = 32): void {
    const batch = this.pendingRequests.splice(0, maxRequests);
    if (batch.length === 0) return;
    
    // Write requests to shared buffer
    wasm.writePathRequests(batch);
    
    // Compute in WASM
    const completed = wasm.computePaths(batch.length);
    
    // Read results and dispatch callbacks
    for (let i = 0; i < completed; i++) {
      const result = wasm.readPathResult(i);
      const callback = this.requestCallbacks.get(result.requestId);
      if (callback) {
        callback(result.path);
        this.requestCallbacks.delete(result.requestId);
      }
    }
    
    // Re-queue failed requests (no path found yet)
    for (const req of batch) {
      if (this.requestCallbacks.has(req.id)) {
        this.pendingRequests.push(req);  // Will retry next tick
      }
    }
  }
}
```

---

## 8. Economy and Production

### 8.1 Resource Types

```typescript
// S4 resource types
enum ResourceType {
  // Raw materials
  Log = 0,
  Stone = 1,
  IronOre = 2,
  GoldOre = 3,
  Coal = 4,
  Sulfur = 5,
  Gem = 6,
  
  // Processed materials
  Plank = 10,
  IronBar = 11,
  GoldBar = 12,
  
  // Food chain
  Grain = 20,
  Flour = 21,
  Bread = 22,
  Fish = 23,
  Meat = 24,
  Wine = 25,
  Beer = 26,
  Water = 27,
  
  // Tools & weapons
  Hammer = 30,
  Saw = 31,
  Pick = 32,
  Axe = 33,
  Shovel = 34,
  Sword = 35,
  Bow = 36,
  Armor = 37,
  
  // Special
  Mana = 40,  // Priest resource
}
```

### 8.2 Production Building Data

```typescript
// Production recipes (derived from S4 buildingInfo.xml)
interface ProductionRecipe {
  inputs: { type: ResourceType; amount: number }[];
  outputs: { type: ResourceType; amount: number }[];
  duration: number;  // Ticks
  workerType: SettlerType;
}

const BUILDING_RECIPES: Record<number, ProductionRecipe> = {
  [BuildingType.Sawmill]: {
    inputs: [{ type: ResourceType.Log, amount: 1 }],
    outputs: [{ type: ResourceType.Plank, amount: 2 }],
    duration: 120,
    workerType: SettlerType.Carpenter,
  },
  [BuildingType.Smelter]: {
    inputs: [
      { type: ResourceType.IronOre, amount: 1 },
      { type: ResourceType.Coal, amount: 1 },
    ],
    outputs: [{ type: ResourceType.IronBar, amount: 1 }],
    duration: 180,
    workerType: SettlerType.Smelter,
  },
  [BuildingType.Bakery]: {
    inputs: [
      { type: ResourceType.Flour, amount: 1 },
      { type: ResourceType.Water, amount: 1 },
    ],
    outputs: [{ type: ResourceType.Bread, amount: 1 }],
    duration: 90,
    workerType: SettlerType.Baker,
  },
  // ... all buildings
};
```

### 8.3 Production System

```rust
// Rust: Production tick processing

pub fn process_production(game: &mut GameMemory, delta_ticks: u32) -> u32 {
    let mut events = 0;
    
    for i in 0..game.building_count {
        let building_type = game.buildings.types[i as usize];
        
        // Skip non-production buildings
        if !is_production_building(building_type) {
            continue;
        }
        
        // Skip if no worker or disabled
        if game.buildings.worker_count[i as usize] == 0 ||
           game.buildings.is_active[i as usize] == 0 {
            continue;
        }
        
        let recipe = get_recipe(building_type);
        
        // Check if we're currently producing
        let progress = &mut game.buildings.production_progress[i as usize];
        
        if *progress > 0 {
            // Continue production
            *progress = progress.saturating_sub(delta_ticks as u16);
            
            if *progress == 0 {
                // Production complete - output resources
                output_resources(game, i, &recipe.outputs);
                events += 1;
            }
        } else {
            // Try to start new production
            if has_inputs(game, i, &recipe.inputs) {
                consume_inputs(game, i, &recipe.inputs);
                *progress = recipe.duration;
            }
        }
    }
    
    events
}

fn has_inputs(game: &GameMemory, building_idx: u32, inputs: &[(u8, u8)]) -> bool {
    let inv_offset = game.buildings.inventory_offset[building_idx as usize];
    
    for &(resource_type, amount) in inputs {
        let slot_idx = find_inventory_slot(game, inv_offset, resource_type);
        if slot_idx.is_none() {
            return false;
        }
        let stored = game.building_inventory.buffer[slot_idx.unwrap()] & 0xFFFFFF;
        if stored < amount as u32 {
            return false;
        }
    }
    true
}
```

### 8.4 Resource Distribution

**Improvement over original:** S4's resource distribution sometimes starved buildings when multiple requested the same resource. We implement priority-based distribution:

```typescript
interface ResourceRequest {
  buildingId: EntityId;
  resourceType: ResourceType;
  amount: number;
  priority: number;  // Higher = more urgent
  maxDistance: number;
}

class ResourceDistributor {
  private pendingRequests: ResourceRequest[] = [];
  
  requestResource(req: ResourceRequest): void {
    this.pendingRequests.push(req);
  }
  
  // Called each tick after production
  distributionPass(entityManager: EntityManager, map: MapData): void {
    // Sort by priority
    this.pendingRequests.sort((a, b) => b.priority - a.priority);
    
    // Find available resources
    const availableStocks = this.findAvailableResources(entityManager);
    
    for (const request of this.pendingRequests) {
      const sources = availableStocks.get(request.resourceType) || [];
      
      // Find nearest source with available carriers
      for (const source of sources) {
        const distance = this.pathDistance(
          entityManager.getBuildingPosition(source.buildingId),
          entityManager.getBuildingPosition(request.buildingId)
        );
        
        if (distance > request.maxDistance) continue;
        if (source.amount < request.amount) continue;
        
        // Check carrier availability
        const carrier = this.findAvailableCarrier(entityManager, source.buildingId);
        if (!carrier) continue;
        
        // Assign delivery job
        this.assignDeliveryJob(carrier, source.buildingId, request.buildingId, 
                               request.resourceType, request.amount);
        source.amount -= request.amount;
        break;
      }
    }
    
    this.pendingRequests = [];
  }
}
```

### 8.5 Food Consumption

```rust
// Settlers consume food based on work intensity
pub fn process_food_consumption(game: &mut GameMemory, delta_ticks: u32) {
    // Food consumption happens at fixed intervals
    if game.tick % FOOD_CONSUMPTION_INTERVAL != 0 {
        return;
    }
    
    for player in 0..MAX_PLAYERS {
        let mut total_workers = 0u32;
        let mut fed_workers = 0u32;
        
        // Count workers
        for i in 0..game.settler_count {
            if game.settlers.players[i as usize] == player &&
               is_worker_type(game.settlers.types[i as usize]) {
                total_workers += 1;
            }
        }
        
        // Consume from warehouses
        let food_needed = total_workers * FOOD_PER_WORKER;
        let food_available = get_player_food_total(game, player);
        
        if food_available >= food_needed {
            consume_player_food(game, player, food_needed);
            fed_workers = total_workers;
        } else {
            consume_player_food(game, player, food_available);
            fed_workers = food_available / FOOD_PER_WORKER;
        }
        
        // Unfed workers work at reduced speed
        let hunger_penalty = if total_workers > 0 {
            (fed_workers * 100 / total_workers) as u8
        } else {
            100
        };
        game.player_stats[player as usize].work_efficiency = hunger_penalty;
    }
}
```

---

## 9. Job and Task System

### 9.1 Job Types

```typescript
enum JobType {
  // Movement
  Idle = 0,
  WalkTo = 1,
  FollowPath = 2,
  
  // Carrier jobs
  PickupResource = 10,
  DeliverResource = 11,
  
  // Production jobs
  HarvestTree = 20,
  PlantTree = 21,
  MinResource = 22,
  FishWater = 23,
  FarmField = 24,
  
  // Construction
  ConstructBuilding = 30,
  FlattenTerrain = 31,
  
  // Military
  AttackTarget = 40,
  Patrol = 41,
  Guard = 42,
  
  // Special
  ConvertEnemy = 50,  // Priest
  Steal = 51,         // Thief
  Survey = 52,        // Geologist
  ExpandTerritory = 53, // Pioneer
}

interface Job {
  type: JobType;
  targetEntity?: EntityId;
  targetPosition?: WorldCoord;
  data: Uint32Array;  // Job-specific data
  state: number;      // Current step in job sequence
}
```

### 9.2 Job State Machine

```rust
// Rust: Job processing

pub fn process_jobs(game: &mut GameMemory, delta_ticks: u32) -> u32 {
    let mut events = 0;
    
    for i in 0..game.settler_count {
        if game.settlers.flags[i as usize] & FLAG_HAS_JOB == 0 {
            continue;
        }
        
        let job_type = game.settlers.job_type[i as usize];
        
        match job_type {
            JOB_PICKUP_RESOURCE => {
                events += process_pickup_job(game, i, delta_ticks);
            }
            JOB_DELIVER_RESOURCE => {
                events += process_deliver_job(game, i, delta_ticks);
            }
            JOB_HARVEST_TREE => {
                events += process_harvest_job(game, i, delta_ticks);
            }
            JOB_CONSTRUCT_BUILDING => {
                events += process_construction_job(game, i, delta_ticks);
            }
            JOB_ATTACK_TARGET => {
                events += process_attack_job(game, i, delta_ticks);
            }
            _ => {}
        }
    }
    
    events
}

fn process_harvest_job(game: &mut GameMemory, settler_idx: u32, delta: u32) -> u32 {
    let state = game.settlers.job_state[settler_idx as usize];
    let target = game.settlers.job_target[settler_idx as usize];
    
    match state {
        0 => {
            // State 0: Walk to tree
            if at_target(game, settler_idx) {
                game.settlers.job_state[settler_idx as usize] = 1;
                game.settlers.job_progress[settler_idx as usize] = HARVEST_DURATION;
            }
            0
        }
        1 => {
            // State 1: Chopping
            let progress = &mut game.settlers.job_progress[settler_idx as usize];
            *progress = progress.saturating_sub(delta as u16);
            
            if *progress == 0 {
                // Tree felled
                destroy_tree(game, target);
                game.settlers.carry_type[settler_idx as usize] = RESOURCE_LOG;
                game.settlers.carry_amount[settler_idx as usize] = 1;
                game.settlers.job_state[settler_idx as usize] = 2;
                1  // Event: tree felled
            } else {
                0
            }
        }
        2 => {
            // State 2: Return to building
            if at_home_building(game, settler_idx) {
                deposit_resource(game, settler_idx);
                clear_job(game, settler_idx);
                1  // Event: resource deposited
            } else {
                0
            }
        }
        _ => 0
    }
}
```

### 9.3 Job Assignment

```typescript
// TypeScript: High-level job assignment logic

class JobAssigner {
  // Called when a building needs a worker action
  assignBuildingJob(building: EntityId, jobType: JobType): void {
    const buildingData = this.entities.getBuilding(building);
    
    // Find worker in building
    const worker = this.findWorkerInBuilding(building);
    if (!worker) return;
    
    // Determine target based on job type
    let target: EntityId | TileCoord | null = null;
    
    switch (jobType) {
      case JobType.HarvestTree:
        target = this.findNearestTree(buildingData.position, buildingData.workRadius);
        break;
      case JobType.MinResource:
        target = this.findMineableResource(buildingData.position);
        break;
      case JobType.PlantTree:
        target = this.findPlantableSpot(buildingData.position, buildingData.workRadius);
        break;
    }
    
    if (!target) return;  // No valid target
    
    // Create job
    this.entities.setJob(worker, {
      type: jobType,
      targetEntity: typeof target === 'number' ? target : undefined,
      targetPosition: typeof target === 'object' ? target : undefined,
      state: 0,
    });
    
    // Request path
    const workerPos = this.entities.getSettlerPosition(worker);
    const targetPos = typeof target === 'number' 
      ? this.entities.getEntityPosition(target)
      : target;
    
    this.pathfinding.requestPath(workerPos, targetPos, (path) => {
      if (path) {
        this.entities.setPath(worker, path);
      } else {
        this.entities.clearJob(worker);  // Can't reach target
      }
    });
  }
  
  // Called when carrier becomes available
  assignCarrierJob(carrier: EntityId): void {
    // Priority: construction sites > production inputs > storage balancing
    
    // 1. Check construction needs
    const constructionJob = this.findConstructionDelivery(carrier);
    if (constructionJob) {
      this.assignDeliveryJob(carrier, constructionJob);
      return;
    }
    
    // 2. Check production building needs
    const productionJob = this.findProductionDelivery(carrier);
    if (productionJob) {
      this.assignDeliveryJob(carrier, productionJob);
      return;
    }
    
    // 3. Balance warehouse storage
    const balanceJob = this.findStorageBalancing(carrier);
    if (balanceJob) {
      this.assignDeliveryJob(carrier, balanceJob);
      return;
    }
    
    // Nothing to do - idle at nearest flag/building
    this.returnToIdle(carrier);
  }
}
```

---

## 10. Territory and Borders

### 10.1 Territory Calculation

In S3/S4, territory is determined by military buildings. Each has an influence radius.

```rust
// Rust: Territory calculation

const INFLUENCE_LOOKUP: &[(u16, u16)] = &[
    // (building_type, radius)
    (BUILDING_TOWER, 8),
    (BUILDING_GUARDHOUSE, 5),
    (BUILDING_CASTLE, 12),
    (BUILDING_FORTRESS, 15),
];

pub fn calculate_territory(game: &mut GameMemory, player: u8) {
    // Clear player's territory
    for tile in game.map.owner.iter_mut() {
        if *tile == player {
            *tile = 255;  // Neutral
        }
    }
    
    // Process each military building
    for i in 0..game.building_count {
        if game.buildings.players[i as usize] != player {
            continue;
        }
        
        let building_type = game.buildings.types[i as usize];
        let radius = match get_influence_radius(building_type) {
            Some(r) => r,
            None => continue,
        };
        
        let bx = game.buildings.tile_x[i as usize] as i32;
        let by = game.buildings.tile_y[i as usize] as i32;
        
        // Expand territory in radius
        for dy in -(radius as i32)..=(radius as i32) {
            for dx in -(radius as i32)..=(radius as i32) {
                // Circular check
                if dx*dx + dy*dy > (radius as i32 * radius as i32) {
                    continue;
                }
                
                let tx = bx + dx;
                let ty = by + dy;
                
                if !game.map.in_bounds(tx as u32, ty as u32) {
                    continue;
                }
                
                let idx = (ty as u32 * game.map.width + tx as u32) as usize;
                
                // Can only claim walkable, non-water tiles
                if !game.map.is_claimable(tx as u32, ty as u32) {
                    continue;
                }
                
                // Claim if neutral or contested
                game.map.owner[idx] = player;
            }
        }
    }
}
```

### 10.2 Border Rendering

Borders are computed for rendering (not in WASM, as it's not performance-critical).

```typescript
class BorderRenderer {
  // Generate border segments for rendering
  computeBorderSegments(map: MapData, player: number): BorderSegment[] {
    const segments: BorderSegment[] = [];
    
    for (let y = 0; y < map.height; y++) {
      for (let x = 0; x < map.width; x++) {
        if (map.owner[y * map.width + x] !== player) continue;
        
        // Check each edge
        for (const [dx, dy, edge] of EDGE_CHECKS) {
          const nx = x + dx;
          const ny = y + dy;
          
          // Border exists if neighbor is different owner
          if (!map.inBounds(nx, ny) || 
              map.owner[ny * map.width + nx] !== player) {
            segments.push({
              x1: x + EDGE_OFFSETS[edge][0],
              y1: y + EDGE_OFFSETS[edge][1],
              x2: x + EDGE_OFFSETS[edge][2],
              y2: y + EDGE_OFFSETS[edge][3],
              player,
            });
          }
        }
      }
    }
    
    return this.mergeContiguousSegments(segments);
  }
}
```

### 10.3 Pioneer Territory Expansion

**Improvement over original:** S4 pioneers sometimes got stuck. We implement smarter expansion logic:

```typescript
class PioneerController {
  findNextExpansionTarget(pioneer: EntityId, targetTerritory: TileCoord): TileCoord | null {
    const currentPos = this.entities.getSettlerPosition(pioneer);
    const playerTiles = this.map.getPlayerTiles(this.getOwner(pioneer));
    
    // Find frontier tiles (owned tiles adjacent to neutral)
    const frontier: TileCoord[] = [];
    for (const tile of playerTiles) {
      for (const neighbor of this.map.getNeighbors(tile)) {
        if (this.map.isNeutral(neighbor) && this.map.isClaimable(neighbor)) {
          frontier.push(tile);
          break;
        }
      }
    }
    
    if (frontier.length === 0) return null;
    
    // Score frontier tiles by:
    // 1. Distance to target territory
    // 2. Reachability from current position
    // 3. Strategic value (resources nearby)
    
    let bestTile: TileCoord | null = null;
    let bestScore = -Infinity;
    
    for (const tile of frontier) {
      const distToTarget = this.distance(tile, targetTerritory);
      const distFromPioneer = this.pathDistance(currentPos, tile);
      
      if (distFromPioneer === Infinity) continue;  // Unreachable
      
      const resourceBonus = this.countNearbyResources(tile) * 10;
      const score = -distToTarget - distFromPioneer * 0.5 + resourceBonus;
      
      if (score > bestScore) {
        bestScore = score;
        bestTile = tile;
      }
    }
    
    return bestTile;
  }
}
```

---

## 11. Combat System

### 11.1 Unit Stats

```typescript
// Based on S4 combat values
interface CombatStats {
  maxHealth: number;
  attack: number;
  defense: number;
  range: number;        // 0 for melee
  attackSpeed: number;  // Ticks between attacks
  moveSpeed: number;    // During combat
}

const UNIT_COMBAT_STATS: Record<SettlerType, CombatStats> = {
  [SettlerType.Swordsman1]: {
    maxHealth: 100, attack: 10, defense: 5, range: 0, attackSpeed: 30, moveSpeed: 80
  },
  [SettlerType.Swordsman2]: {
    maxHealth: 150, attack: 15, defense: 8, range: 0, attackSpeed: 28, moveSpeed: 85
  },
  [SettlerType.Swordsman3]: {
    maxHealth: 200, attack: 20, defense: 12, range: 0, attackSpeed: 25, moveSpeed: 90
  },
  [SettlerType.Bowman1]: {
    maxHealth: 60, attack: 8, defense: 2, range: 5, attackSpeed: 40, moveSpeed: 90
  },
  [SettlerType.Bowman2]: {
    maxHealth: 80, attack: 12, defense: 3, range: 6, attackSpeed: 35, moveSpeed: 95
  },
  [SettlerType.Bowman3]: {
    maxHealth: 100, attack: 16, defense: 5, range: 7, attackSpeed: 30, moveSpeed: 100
  },
  // ... etc
};
```

### 11.2 Combat Resolution

```rust
// Rust: Combat processing

pub fn process_combat(game: &mut GameMemory, delta_ticks: u32) -> u32 {
    let mut events = 0;
    
    for i in 0..game.settler_count {
        if game.settlers.flags[i as usize] & FLAG_HAS_COMBAT == 0 {
            continue;
        }
        
        let target_id = game.settlers.combat_target[i as usize];
        if !is_valid_entity(game, target_id) {
            // Target died, find new target or exit combat
            if let Some(new_target) = find_combat_target(game, i) {
                game.settlers.combat_target[i as usize] = new_target;
            } else {
                game.settlers.flags[i as usize] &= !FLAG_HAS_COMBAT;
                continue;
            }
        }
        
        let target_idx = get_entity_index(target_id);
        
        // Check range
        let dist = distance(
            game.settlers.pos_x[i as usize],
            game.settlers.pos_y[i as usize],
            game.settlers.pos_x[target_idx],
            game.settlers.pos_y[target_idx],
        );
        
        let unit_type = game.settlers.types[i as usize];
        let stats = get_combat_stats(unit_type);
        let range_fp = stats.range as i32 * TILE_SCALE;
        
        if dist > range_fp {
            // Move toward target
            move_toward(game, i, target_idx, stats.move_speed, delta_ticks);
        } else {
            // In range - attack
            let cooldown = &mut game.settlers.attack_cooldown[i as usize];
            
            if *cooldown == 0 {
                // Execute attack
                let damage = calculate_damage(game, i, target_idx);
                apply_damage(game, target_idx, damage);
                events += 1;
                
                *cooldown = stats.attack_speed;
                
                // Check if target died
                if game.settlers.health[target_idx] == 0 {
                    kill_settler(game, target_idx);
                    events += 1;
                }
            } else {
                *cooldown = cooldown.saturating_sub(delta_ticks as u8);
            }
        }
    }
    
    events
}

fn calculate_damage(game: &GameMemory, attacker: u32, defender: u32) -> u16 {
    let attacker_type = game.settlers.types[attacker as usize];
    let defender_type = game.settlers.types[defender as usize];
    
    let attack = get_combat_stats(attacker_type).attack;
    let defense = get_combat_stats(defender_type).defense;
    
    // S4-style damage formula: base_damage * (1 - defense/(defense + 50))
    let defense_factor = (defense as u32 * 100) / (defense as u32 + 50);
    let damage = attack as u32 * (100 - defense_factor) / 100;
    
    damage.max(1) as u16
}
```

### 11.3 Combat Targeting

**Improvement over original:** S4 units sometimes targeted suboptimally. We implement threat-based targeting:

```rust
fn find_combat_target(game: &GameMemory, attacker: u32) -> Option<u32> {
    let attacker_x = game.settlers.pos_x[attacker as usize];
    let attacker_y = game.settlers.pos_y[attacker as usize];
    let attacker_player = game.settlers.players[attacker as usize];
    let attacker_type = game.settlers.types[attacker as usize];
    
    let search_radius = get_aggro_radius(attacker_type);
    
    // Query nearby enemies
    let mut candidates = Vec::new();
    game.spatial_grid.query_range(
        attacker_x, attacker_y, 
        search_radius * TILE_SCALE,
        &mut candidates
    );
    
    let mut best_target: Option<u32> = None;
    let mut best_score = i32::MIN;
    
    for candidate in candidates {
        let idx = candidate as usize;
        
        // Must be alive enemy
        if game.settlers.flags[idx] & FLAG_IS_ALIVE == 0 {
            continue;
        }
        if game.settlers.players[idx] == attacker_player {
            continue;
        }
        if !is_military_unit(game.settlers.types[idx]) {
            continue;
        }
        
        // Score based on:
        // - Threat (damage it can deal to us)
        // - Health (prefer finishing low-health targets)
        // - Distance (prefer closer)
        
        let dist = distance(attacker_x, attacker_y,
                           game.settlers.pos_x[idx], game.settlers.pos_y[idx]);
        
        let threat = get_combat_stats(game.settlers.types[idx]).attack as i32;
        let health_factor = game.settlers.health[idx] as i32;
        let distance_factor = dist / TILE_SCALE;
        
        // Prioritize: high threat, low health, close distance
        let score = threat * 10 - health_factor - distance_factor * 5;
        
        if score > best_score {
            best_score = score;
            best_target = Some(candidate);
        }
    }
    
    best_target
}
```

---

## 12. AI System

### 12.1 AI Architecture

```typescript
// AI runs in WASM for performance, but strategy is data-driven

interface AIConfig {
  aggressiveness: number;     // 0-100
  expansionPriority: number;  // 0-100
  economyFocus: number;       // 0-100
  preferredUnits: SettlerType[];
  buildOrder: BuildingType[];
}

// Predefined personalities
const AI_PERSONALITIES: Record<string, AIConfig> = {
  'aggressive': {
    aggressiveness: 80,
    expansionPriority: 60,
    economyFocus: 40,
    preferredUnits: [SettlerType.Swordsman3, SettlerType.Axeman2],
    buildOrder: [/* early military focus */],
  },
  'economic': {
    aggressiveness: 30,
    expansionPriority: 70,
    economyFocus: 90,
    preferredUnits: [SettlerType.Bowman2],
    buildOrder: [/* resource focus */],
  },
  'balanced': {
    aggressiveness: 50,
    expansionPriority: 50,
    economyFocus: 50,
    preferredUnits: [SettlerType.Swordsman2, SettlerType.Bowman2],
    buildOrder: [/* standard */],
  },
};
```

### 12.2 AI Decision Making

```rust
// Rust: AI tick processing

pub struct AIState {
    config: AIConfig,
    phase: AIPhase,
    current_goal: AIGoal,
    threat_level: u8,
    economic_score: u32,
    military_score: u32,
}

pub enum AIPhase {
    EarlyGame,    // Focus on basic economy
    MidGame,      // Expansion and military buildup
    LateGame,     // Full military production
    Defense,      // Under attack
}

pub enum AIGoal {
    None,
    BuildBuilding(u16),
    TrainUnits(u16, u16),  // (type, count)
    Attack(u32),           // Target player
    Expand(i32, i32),      // Target location
    Defend(i32, i32),
}

pub fn ai_tick(game: &mut GameMemory, player: u8) {
    let ai = &mut game.ai_states[player as usize];
    
    // Update situation assessment
    ai.threat_level = assess_threats(game, player);
    ai.economic_score = calculate_economy_score(game, player);
    ai.military_score = calculate_military_score(game, player);
    
    // Phase transitions
    ai.phase = determine_phase(ai);
    
    // Goal selection
    if ai.threat_level > 70 {
        ai.current_goal = plan_defense(game, player);
    } else {
        ai.current_goal = match ai.phase {
            AIPhase::EarlyGame => plan_early_game(game, player, ai),
            AIPhase::MidGame => plan_mid_game(game, player, ai),
            AIPhase::LateGame => plan_late_game(game, player, ai),
            AIPhase::Defense => plan_defense(game, player),
        };
    }
    
    // Execute current goal
    execute_goal(game, player, &ai.current_goal);
}

fn plan_early_game(game: &GameMemory, player: u8, ai: &AIState) -> AIGoal {
    // Check build order progress
    let buildings_built = count_buildings_by_type(game, player);
    
    for &building_type in &ai.config.build_order {
        let target_count = get_early_game_target(building_type);
        let current = buildings_built.get(&building_type).unwrap_or(&0);
        
        if *current < target_count {
            // Find placement location
            if let Some((x, y)) = find_building_placement(game, player, building_type) {
                return AIGoal::BuildBuilding(building_type);
            }
        }
    }
    
    // Build order complete, transition to expansion
    AIGoal::None
}
```

### 12.3 AI Improvements Over Original

**Known S4 AI weaknesses and fixes:**

| S4 AI Issue | Our Improvement |
|-------------|-----------------|
| Builds inefficient road layouts | Use road network optimization |
| Doesn't adapt to player strategy | Track player military composition |
| Poor late-game economy | Implement stockpile targets |
| Predictable attack patterns | Randomized timing, multi-prong attacks |
| Ignores geologists | Proper surveying integration |

---

## 13. Multiplayer Considerations

### 13.1 Deterministic Simulation

For lockstep multiplayer, simulation must be perfectly deterministic:

```typescript
// Rules for determinism:

// 1. NO FLOATS in game logic
// Bad:
const speed = 1.5;
const newPos = pos + speed * delta;

// Good:
const SPEED_FP = 384;  // 1.5 * 256 fixed-point
const newPos = pos + (SPEED_FP * delta) >> 8;

// 2. Process entities in deterministic order
// Bad:
for (const entity of this.entities.values()) { ... }

// Good:
for (let i = 0; i < this.entityCount; i++) { ... }

// 3. No random() - use seeded PRNG
class DeterministicRNG {
  private state: number;
  
  constructor(seed: number) {
    this.state = seed;
  }
  
  next(): number {
    // xorshift32
    this.state ^= this.state << 13;
    this.state ^= this.state >>> 17;
    this.state ^= this.state << 5;
    return this.state >>> 0;
  }
  
  range(min: number, max: number): number {
    return min + (this.next() % (max - min + 1));
  }
}
```

### 13.2 Network Protocol

```typescript
// Lockstep with command buffer

interface GameCommand {
  tick: number;        // Target execution tick
  playerId: number;
  type: CommandType;
  data: Uint8Array;
}

enum CommandType {
  PlaceBuilding,
  SetProductionPriority,
  MoveUnits,
  AttackMove,
  SetRallyPoint,
  // ... etc
}

class NetworkManager {
  private localCommands: GameCommand[] = [];
  private remoteCommands: Map<number, GameCommand[]> = new Map();  // tick -> commands
  private confirmedTick: number = 0;
  
  // Called when player issues command
  queueLocalCommand(cmd: GameCommand): void {
    // Schedule for N ticks in future (input delay)
    cmd.tick = this.currentTick + INPUT_DELAY_TICKS;
    this.localCommands.push(cmd);
    this.broadcast(cmd);
  }
  
  // Called each tick
  canAdvanceTick(tick: number): boolean {
    // All players must have sent commands for this tick
    for (const player of this.players) {
      if (!this.hasCommandsForTick(player, tick)) {
        return false;
      }
    }
    return true;
  }
  
  getCommandsForTick(tick: number): GameCommand[] {
    const commands: GameCommand[] = [];
    commands.push(...this.localCommands.filter(c => c.tick === tick));
    commands.push(...(this.remoteCommands.get(tick) || []));
    // Sort for determinism
    commands.sort((a, b) => a.playerId - b.playerId);
    return commands;
  }
}
```

### 13.3 Desync Detection

```typescript
class DesyncDetector {
  private stateHashes: Map<number, Map<number, number>> = new Map(); // tick -> player -> hash
  
  // Called after each tick
  recordState(tick: number, playerId: number, state: GameState): void {
    const hash = this.hashState(state);
    
    if (!this.stateHashes.has(tick)) {
      this.stateHashes.set(tick, new Map());
    }
    this.stateHashes.get(tick)!.set(playerId, hash);
    
    // Check for desync
    const tickHashes = this.stateHashes.get(tick)!;
    if (tickHashes.size === this.playerCount) {
      const hashes = [...tickHashes.values()];
      if (!hashes.every(h => h === hashes[0])) {
        this.handleDesync(tick, tickHashes);
      }
    }
  }
  
  private hashState(state: GameState): number {
    // Hash critical state components
    let hash = 0;
    
    // Settler positions
    for (let i = 0; i < state.settlerCount; i++) {
      hash = hash * 31 + state.settlers.posX[i];
      hash = hash * 31 + state.settlers.posY[i];
    }
    
    // Building states
    for (let i = 0; i < state.buildingCount; i++) {
      hash = hash * 31 + state.buildings.productionProgress[i];
    }
    
    // Resources
    hash = hash * 31 + state.totalResources;
    
    return hash >>> 0;
  }
}
```

---

## 14. File Structure

```
settlers-ts/
├── src/
│   ├── core/
│   │   ├── types.ts              # Core type definitions
│   │   ├── constants.ts          # Game constants
│   │   ├── fixed-point.ts        # Fixed-point math utilities
│   │   └── deterministic-rng.ts
│   │
│   ├── state/
│   │   ├── game-state.ts         # Main state container
│   │   ├── entity-manager.ts     # Entity lifecycle
│   │   ├── map-data.ts           # Map state
│   │   └── components/
│   │       ├── settler-components.ts
│   │       ├── building-components.ts
│   │       └── resource-components.ts
│   │
│   ├── systems/
│   │   ├── job-system.ts         # Job assignment (TS side)
│   │   ├── production-system.ts  # Production logic (TS side)
│   │   ├── territory-system.ts
│   │   └── event-dispatcher.ts
│   │
│   ├── wasm/
│   │   ├── bridge.ts             # WASM interface
│   │   ├── memory-layout.ts      # Shared memory management
│   │   └── path-service.ts       # Pathfinding interface
│   │
│   ├── render/
│   │   ├── renderer.ts           # Main WebGL renderer
│   │   ├── terrain-renderer.ts
│   │   ├── entity-renderer.ts
│   │   ├── ui-renderer.ts
│   │   └── shaders/
│   │
│   ├── input/
│   │   ├── input-handler.ts
│   │   ├── camera-controller.ts
│   │   └── selection-manager.ts
│   │
│   ├── network/
│   │   ├── network-manager.ts
│   │   ├── command-buffer.ts
│   │   └── desync-detector.ts
│   │
│   ├── ai/
│   │   ├── ai-controller.ts      # AI coordination (TS side)
│   │   └── ai-config.ts          # AI personalities
│   │
│   ├── data/
│   │   ├── building-data.ts      # Building definitions
│   │   ├── settler-data.ts       # Settler types
│   │   ├── recipe-data.ts        # Production recipes
│   │   └── terrain-data.ts
│   │
│   └── loaders/
│       ├── map-loader.ts         # (existing)
│       ├── gfx-loader.ts         # (existing)
│       ├── save-loader.ts
│       └── config-loader.ts
│
├── rust/
│   ├── Cargo.toml
│   └── src/
│       ├── lib.rs                # WASM entry points
│       ├── memory.rs             # Shared memory structures
│       ├── pathfinding/
│       │   ├── mod.rs
│       │   ├── astar.rs
│       │   ├── hierarchical.rs
│       │   └── flow_field.rs
│       ├── simulation/
│       │   ├── mod.rs
│       │   ├── movement.rs
│       │   ├── production.rs
│       │   ├── combat.rs
│       │   └── territory.rs
│       ├── spatial/
│       │   ├── mod.rs
│       │   └── grid.rs
│       └── ai/
│           ├── mod.rs
│           ├── planning.rs
│           └── evaluation.rs
│
├── public/
│   └── (game assets)
│
├── tests/
│   ├── unit/
│   │   └── (existing tests)
│   └── integration/
│       ├── pathfinding.test.ts
│       ├── production.test.ts
│       └── combat.test.ts
│
└── docs/
    ├── architecture.md           # This document
    ├── file-formats.md           # Asset format documentation
    └── mechanics.md              # Game mechanics reference
```

---

## 15. Implementation Phases

### Phase 1: Foundation (4-6 weeks)

**Goal:** Static world with basic entity rendering

- [ ] Refactor existing code into new structure
- [ ] Implement entity component system
- [ ] Set up Rust/WASM build pipeline
- [ ] Implement spatial grid in Rust
- [ ] Basic entity rendering (sprites at positions)
- [ ] Camera controls

**Milestone:** Load a save game, see settlers/buildings rendered at correct positions

### Phase 2: Movement (3-4 weeks)

**Goal:** Units can move around the map

- [ ] Implement A* pathfinding in Rust
- [ ] Path request batching system
- [ ] Movement processing in WASM
- [ ] Animation system for walking
- [ ] Road network graph

**Milestone:** Click to move a settler, watch it navigate around obstacles

### Phase 3: Basic Economy (6-8 weeks)

**Goal:** Production chains work

- [ ] Building inventory system
- [ ] Production building logic
- [ ] Carrier job assignment
- [ ] Resource transport
- [ ] Warehouse storage

**Milestone:** Woodcutter harvests trees, planks arrive at warehouse

### Phase 4: Full Economy (6-8 weeks)

**Goal:** Complete production chains, food consumption

- [ ] All production buildings
- [ ] Mining and resource deposits
- [ ] Food chain and consumption
- [ ] Tool production
- [ ] Construction system

**Milestone:** Build a self-sustaining settlement with all resource types

### Phase 5: Territory & Military (4-6 weeks)

**Goal:** Territory control and basic combat

- [ ] Territory calculation
- [ ] Border rendering
- [ ] Pioneer expansion
- [ ] Military building influence
- [ ] Basic combat resolution

**Milestone:** Expand territory, train soldiers, attack enemy

### Phase 6: Combat Polish (3-4 weeks)

**Goal:** Full combat system

- [ ] All unit types
- [ ] Formations
- [ ] Morale/retreat
- [ ] Priests and special units
- [ ] Siege mechanics

**Milestone:** Large-scale battles work correctly

### Phase 7: AI (6-8 weeks)

**Goal:** Playable single-player

- [ ] AI state machine
- [ ] Economic planning
- [ ] Military AI
- [ ] Difficulty levels
- [ ] AI personalities

**Milestone:** Play and win/lose against AI opponents

### Phase 8: Multiplayer (4-6 weeks)

**Goal:** Network play

- [ ] Determinism verification
- [ ] Lockstep protocol
- [ ] Desync detection
- [ ] Reconnection handling
- [ ] Lobby system

**Milestone:** 2+ players can play together

### Phase 9: Polish (ongoing)

- [ ] Performance optimization
- [ ] UI improvements
- [ ] Sound system
- [ ] Save/load
- [ ] Mod support

---

## Appendix: Known S3/S4 Mechanics

### A.1 Settler Movement Speeds

| Type | Tiles/second | Notes |
|------|--------------|-------|
| Carrier (empty) | 2.0 | |
| Carrier (loaded) | 1.5 | |
| Builder | 1.8 | |
| Military (light) | 1.6 | Bowmen |
| Military (heavy) | 1.2 | Swordsmen |

### A.2 Production Times

| Building | Input → Output | Ticks |
|----------|----------------|-------|
| Sawmill | 1 Log → 2 Planks | 120 |
| Smelter | 1 Ore + 1 Coal → 1 Bar | 180 |
| Bakery | 1 Flour + 1 Water → 2 Bread | 90 |
| Weaponsmith | 1 Iron + 1 Coal → 1 Weapon | 240 |

### A.3 Building Sizes

| Building | Tiles | Work Radius |
|----------|-------|-------------|
| Small (house, farm) | 2x2 | - |
| Medium (sawmill, smelter) | 3x3 | 8 tiles |
| Large (castle, temple) | 4x4 | 12 tiles |

### A.4 Combat Formulas

```
Damage = Attack * (100 - Defense * 100 / (Defense + 50)) / 100
Hit chance = 80% + (Attacker level - Defender level) * 5%
Morale loss = Damage received / Max health * 100
Retreat threshold = Morale < 20%
```

### A.5 Food Consumption

```
Workers need: 1 food unit per 600 ticks
Soldiers need: 2 food units per 600 ticks
Starvation penalty: -50% work speed after 1200 ticks without food
```

### A.6 Territory Influence

| Building | Radius |
|----------|--------|
| Guardhouse | 5 tiles |
| Tower | 8 tiles |
| Castle | 12 tiles |
| Fortress | 15 tiles |

---

## Document History

| Version | Date | Changes |
|---------|------|---------|
| 1.0 | 2025-02 | Initial architecture |

---

*This document is a living specification. Update as implementation reveals better approaches.*
