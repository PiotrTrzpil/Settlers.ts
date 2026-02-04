# JSettlers → Settlers.ts: Porting Guide

> Research conducted on JSettlers (~/Code/settlers-remake), a Java remake of Settlers 3 (MIT licensed, 1,521 Java files).
> Target: Settlers.ts — a Settlers 4 remake with Settlers 3 compatibility layer.

---

## Table of Contents

1. [Codebase Comparison](#1-codebase-comparison)
2. [Economy & Material System](#2-economy--material-system)
3. [Behavior Tree Framework](#3-behavior-tree-framework)
4. [Pathfinding Improvements](#4-pathfinding-improvements)
5. [AI System](#5-ai-system)
6. [Territory & Partition System](#6-territory--partition-system)
7. [Fog of War](#7-fog-of-war)
8. [Game Timer & Scheduler](#8-game-timer--scheduler)
9. [Bearer & Carrier System](#9-bearer--carrier-system)
10. [Building System](#10-building-system)
11. [Constants & Data Tables](#11-constants--data-tables)
12. [S3 vs S4 Adaptation Notes](#12-s3-vs-s4-adaptation-notes)
13. [Recommended Porting Order](#13-recommended-porting-order)

---

## 1. Codebase Comparison

### Settlers.ts (Current State)

| Aspect | Status |
|--------|--------|
| **Stack** | Vue 3 + TypeScript + WebGL + Vite |
| **Pathfinding** | A* (4-directional, max 2000 nodes) |
| **Movement** | Simple interpolated tile-to-tile |
| **Territory** | Building-radius based ownership |
| **Buildings** | Placement + terrain/slope validation |
| **Entities** | Basic Unit/Building with subtype enums |
| **Commands** | place_building, spawn_unit, move_unit, select, remove |
| **Rendering** | WebGL landscape + entity renderer with shaders |
| **Economy** | Not implemented |
| **AI** | Not implemented |
| **Combat** | Not implemented |
| **Fog of War** | Not implemented |
| **Carriers** | Not implemented |
| **Production** | Not implemented |

### JSettlers (Source Material)

| Aspect | Status |
|--------|--------|
| **Stack** | Java, Swing/Android, custom OpenGL |
| **Size** | 1,521 Java files across 18 modules |
| **License** | MIT (fully portable) |
| **Core module** | `jsettlers.logic` (433 files) |
| **Algorithms** | `jsettlers.algorithms` (pathfinding, partitions, fog of war, behavior trees) |
| **Common** | `jsettlers.common` (shared types, enums, interfaces) |

### Key JSettlers Modules

```
jsettlers.logic/     — Game engine and logic (433 files)
jsettlers.common/    — Shared interfaces and data structures
jsettlers.algorithms/ — Pathfinding, partitions, fog of war, behavior trees
jsettlers.graphics/  — Rendering and UI layer
jsettlers.network/   — Multiplayer synchronization
jsettlers.main.swing/ — Desktop UI
jsettlers.main.android/ — Android UI
jsettlers.tests/     — Testing infrastructure
jsettlers.tools/     — Development utilities
```

---

## 2. Economy & Material System

**Priority: HIGHEST — this is the biggest gap in Settlers.ts**

### 2.1 Material Types

JSettlers defines 34+ material types with metadata. Each material has: sprite info, droppability, default priority index, and whether it's distribution-configurable.

**Source:** `jsettlers.common/src/main/java/jsettlers/common/material/EMaterialType.java`

```typescript
// TypeScript port sketch
enum EMaterialType {
  // Tools
  AXE, HAMMER, PICK, SAW, SCYTHE, FISHINGROD,

  // Weapons
  SWORD, BOW, SPEAR, BLADE,

  // Raw resources
  TRUNK, STONE, IRONORE, GOLDORE, COAL, CROP, PIG, WATER, HONEY, RICE, GEMS, SULFUR,

  // Processed materials
  PLANK, IRON, GOLD, FLOUR, BREAD, FISH, MEAT, WINE, MEAD, KEG, LIQUOR, GUN_POWDER,

  // Non-droppable
  NO_MATERIAL, CANNON_AMMO, BALLISTA_AMMO, CATAPULT_AMMO,
  WHITE_BREAD, BASKET, TREE, PLANT, EMPTY_BUCKET, CHEMICALS, METALS,
}

interface MaterialTypeConfig {
  droppable: boolean
  defaultPriorityIndex: number      // Transport priority order
  distributionConfigurable: boolean // Can player adjust distribution?
}
```

**Key arrays derived from the enum:**
- `DROPPABLE_MATERIALS` — materials that can be placed on the ground (34 types)
- `STOCK_MATERIALS` — materials that can be stored in stock buildings
- `NUMBER_OF_DROPPABLE_MATERIALS` — used to size priority arrays

### 2.2 Offer/Request Matching (Core Economy Loop)

The heart of the Settlers economy. Buildings *request* materials and *offer* produced goods. Idle bearers are matched to fulfill requests.

**Source:** `jsettlers.logic/src/main/java/jsettlers/logic/map/grid/partition/manager/materials/MaterialsManager.java`

```typescript
// Core algorithm (TypeScript sketch)
class MaterialsManager {
  private offersList: OffersList                           // Available materials on ground/at buildings
  private requestQueues: MaterialRequestQueue[]            // Per-material-type request queues
  private joblessSupplier: IJoblessSupplier                // Pool of idle bearers
  private settings: PartitionManagerSettings               // Player-configured priorities

  // Called each game tick
  distributeJobs(): void {
    // Iterate materials in priority order
    for (let i = 0; i < NUMBER_OF_DROPPABLE_MATERIALS; i++) {
      if (this.joblessSupplier.isEmpty()) break

      const materialType = this.settings.getMaterialTypeForPriority(i)
      this.distributeJobForMaterial(materialType)
    }
  }

  private distributeJobForMaterial(materialType: EMaterialType): void {
    // No offers of this material? Skip.
    if (this.offersList.isEmpty(materialType, EOfferPriority.LOWEST)) return

    const requestQueue = this.requestQueues[materialType]

    // Find highest-priority request that has a matching offer
    const request = requestQueue.getHighestPriorityRequest()
    if (!request) return

    // Find nearest offer to the request position
    const offer = this.offersList.getClosestOffer(materialType, request.position)
    if (!offer) return

    // Assign a bearer to transport offer → request
    const bearer = this.joblessSupplier.removeJoblessBearer()
    if (!bearer) return

    bearer.assignTransportJob(offer.position, request.position, materialType)
    offer.distributionAccepted()
    request.deliveryAccepted()
  }
}
```

### 2.3 Offer Priority System

Materials on the ground have different priorities based on context:

**Source:** `jsettlers.logic/.../materials/offers/EOfferPriority.java`

```typescript
enum EOfferPriority {
  LOW,        // Material just sitting on ground
  NORMAL,     // Material at a production building output
  HIGH,       // Material at a stock/warehouse
  LOWEST,     // Minimum acceptable priority for matching
}
```

### 2.4 Request Priority Queues

Two types of request queues handle different distribution strategies:

**Source:** `jsettlers.logic/.../materials/requests/`

```typescript
// Simple queue — first-come-first-served
class SimpleMaterialRequestPriorityQueue {
  insertRequest(request: MaterialRequestObject): void
  getHighestPriorityRequest(): MaterialRequestObject | null
}

// Building-weighted queue — distributes based on player settings
class MaterialsForBuildingsRequestPriorityQueue {
  // Uses MaterialDistributionSettings to weight which building
  // type gets the material. Player can configure: "70% of coal
  // goes to weaponsmiths, 30% to goldmelts"
  constructor(settings: MaterialDistributionSettings) {}
}
```

### 2.5 Material Distribution Settings

Players can configure what percentage of each material goes to which building types.

**Source:** `jsettlers.logic/.../settings/MaterialDistributionSettings.java`

```typescript
class MaterialDistributionSettings {
  private materialType: EMaterialType
  private distributionValues: Map<EBuildingType, number>  // User-set weights
  private requestValueSum: number                          // Sum of all weights

  // Probability that a request from this building type gets served
  getDistributionProbability(buildingType: EBuildingType): number {
    return this.distributionValues.get(buildingType)! / this.requestValueSum
  }

  // Weighted random: pick which building type gets the next delivery
  drawRandomBuilding(): EBuildingType {
    // Random selection weighted by distribution values
  }

  setUserConfiguredDistributionValue(buildingType: EBuildingType, value: number): void {
    const oldValue = this.distributionValues.get(buildingType)!
    this.requestValueSum -= oldValue
    this.requestValueSum += value
    this.distributionValues.set(buildingType, value)
  }
}
```

### 2.6 Production Chain Data

Pure data mapping building types to their input/output materials.

**Source:** `jsettlers.common/.../buildings/MaterialsOfBuildings.java`

```typescript
// Production chains (S3 — adapt for S4)
const PRODUCTION_CHAINS = {
  // Wood industry
  LUMBERJACK:    { input: [],              output: [EMaterialType.TRUNK] },
  SAWMILL:       { input: [TRUNK],         output: [PLANK] },
  FORESTER:      { input: [],              output: [] },  // Plants trees

  // Food industry
  FARM:          { input: [],              output: [CROP] },
  WINDMILL:      { input: [CROP],          output: [FLOUR] },
  BAKER:         { input: [FLOUR, WATER],  output: [BREAD] },
  FISHER:        { input: [FISHINGROD],    output: [FISH] },
  PIG_FARM:      { input: [CROP],          output: [PIG] },
  SLAUGHTERHOUSE:{ input: [PIG],           output: [MEAT] },
  WATERWORKS:    { input: [],              output: [WATER] },

  // Mining
  COALMINE:      { input: [FOOD],          output: [COAL] },
  IRONMINE:      { input: [FOOD],          output: [IRONORE] },
  GOLDMINE:      { input: [FOOD],          output: [GOLDORE] },

  // Metal industry
  IRONMELT:      { input: [IRONORE, COAL], output: [IRON] },
  GOLDMELT:      { input: [GOLDORE, COAL], output: [GOLD] },
  WEAPONSMITH:   { input: [IRON, COAL],    output: [SWORD | SPEAR | BOW] },
  TOOLSMITH:     { input: [IRON, COAL],    output: [AXE | PICK | SAW | ...] },

  // Military
  BARRACK:       { input: [SWORD | SPEAR | BOW], output: [] },  // Trains soldiers

  // Stone
  STONECUTTER:   { input: [],              output: [STONE] },
}

// Which buildings request which materials
function getBuildingTypesRequestingMaterial(
  material: EMaterialType,
  civilisation: ECivilisation
): EBuildingType[] {
  // Returns all building types that need this material as input
}
```

### 2.7 Material Offer Interface

**Source:** `jsettlers.logic/.../materials/interfaces/IMaterialOffer.java`

```typescript
interface IMaterialOffer {
  position: { x: number, y: number }

  distributionAccepted(): void  // Bearer assigned to pick up
  distributionAborted(): void   // Bearer couldn't complete
  offerTaken(): void            // Material physically picked up
  isStillValid(minimumPriority: EOfferPriority): boolean
}
```

---

## 3. Behavior Tree Framework

**Priority: HIGH — enables complex unit AI with minimal code**

JSettlers uses a lightweight behavior tree for ALL unit behaviors. The framework is only ~10 files, ~300 lines total.

**Source:** `jsettlers.algorithms/src/main/java/jsettlers/algorithms/simplebehaviortree/`

### 3.1 Core Node Types

```typescript
enum NodeStatus { SUCCESS, FAILURE, RUNNING }

abstract class Node<T> {
  abstract tick(entity: T): NodeStatus
}

// Runs children in order. Fails on first failure.
class Sequence<T> extends Node<T> {
  children: Node<T>[]
  tick(entity: T): NodeStatus {
    for (const child of this.children) {
      const status = child.tick(entity)
      if (status !== NodeStatus.SUCCESS) return status
    }
    return NodeStatus.SUCCESS
  }
}

// Tries children in order. Succeeds on first success.
class Selector<T> extends Node<T> {
  children: Node<T>[]
  tick(entity: T): NodeStatus {
    for (const child of this.children) {
      const status = child.tick(entity)
      if (status !== NodeStatus.FAILURE) return status
    }
    return NodeStatus.FAILURE
  }
}

// Boolean test
class Condition<T> extends Node<T> {
  predicate: (entity: T) => boolean
  tick(entity: T): NodeStatus {
    return this.predicate(entity) ? NodeStatus.SUCCESS : NodeStatus.FAILURE
  }
}

// Execute action
class Action<T> extends Node<T> {
  action: (entity: T) => void
  tick(entity: T): NodeStatus {
    this.action(entity)
    return NodeStatus.SUCCESS
  }
}

// Action that can return any status
class Action2<T> extends Node<T> {
  action: (entity: T) => NodeStatus
}

// Repeat while condition holds
class Repeat<T> extends Node<T> {
  condition: (entity: T) => boolean
  child: Node<T>
}

// Conditional wrapper
class Guard<T> extends Node<T> {
  condition: (entity: T) => boolean
  child: Node<T>
}

// Wait for duration
class Sleep<T> extends Node<T> {
  duration: (entity: T) => number  // milliseconds
}

// Reset state after subtree completes
class ResetAfter<T> extends Node<T> {
  resetFn: (entity: T) => void
  child: Node<T>
}
```

### 3.2 Tick Context

Each unit has its own `Tick` that tracks execution state across frames:

```typescript
class Tick<T> {
  private entity: T
  private rootNode: Node<T>

  tick(): NodeStatus {
    return this.rootNode.tick(this.entity)
  }
}
```

### 3.3 Example: Bearer Behavior Tree

```typescript
function createBearerBehavior(): Node<BearerMovable> {
  return selector(
    // Priority 1: Do assigned transport job
    sequence(
      condition(mov => mov.hasTransportJob()),
      followPath(mov => true),
      action(mov => mov.deliverMaterial()),
      action(mov => mov.becomeJobless())
    ),

    // Priority 2: Convert to specialist if requested
    sequence(
      condition(mov => mov.hasConversionRequest()),
      action(mov => mov.convertToRequestedType())
    ),

    // Priority 3: Idle behavior (push, flock, wander)
    doingNothingAction()
  )
}
```

### 3.4 Example: Worker Building Behavior

```typescript
function createWorkerBehavior(): Node<WorkerMovable> {
  return selector(
    // Work cycle
    sequence(
      condition(mov => mov.building.hasInputMaterials()),
      action(mov => mov.takeInputFromBuilding()),
      followPath(mov => true),  // Walk to work area
      action(mov => mov.performWork()),
      followPath(mov => true),  // Walk back
      action(mov => mov.depositOutput())
    ),

    // Wait for materials
    sleep(mov => 1000)
  )
}
```

---

## 4. Pathfinding Improvements

**Priority: HIGH — direct improvement to existing system**

### 4.1 Bucket Queue A*

JSettlers uses a bucket queue instead of a binary heap for the A* open set. On uniform-cost grids, this gives O(1) insert vs O(log n).

**Source:** `jsettlers.algorithms/src/main/java/jsettlers/algorithms/path/astar/BucketQueueAStar.java`

```typescript
class ListMinBucketQueue {
  private buckets: number[][]  // Array of buckets, indexed by cost
  private minBucket: number

  insert(nodeId: number, cost: number): void {
    const bucketIndex = Math.floor(cost)
    this.buckets[bucketIndex].push(nodeId)
    this.minBucket = Math.min(this.minBucket, bucketIndex)
  }

  popMin(): number {
    while (this.buckets[this.minBucket].length === 0) this.minBucket++
    return this.buckets[this.minBucket].pop()!
  }
}
```

**Additional optimizations in JSettlers A*:**
- BitSets for open/closed tracking (fast membership testing)
- Float array for cost tracking (avoids Map overhead)
- Integer array for parent tracking

### 4.2 Path Repair When Blocked

When a unit hits an obstacle mid-path, JSettlers tries 4 escalating strategies:

**Source:** `jsettlers.logic/.../movable/Movable.java:742-787`

```typescript
function canGoNextStep(unit: Movable): NodeStatus {
  // Is next step valid?
  let valid = grid.isValidNextPathPosition(unit, path.getNextPos(), path.getTarget())
  if (!valid) {
    // Full recalculate
    unit.path = grid.calculatePathTo(unit, path.getTarget())
    valid = unit.path !== null
  }
  if (!valid) return NodeStatus.FAILURE

  for (let attempt = 0; attempt < 4; attempt++) {
    const blockingUnit = grid.getMovableAt(path.nextX(), path.nextY())
    if (!blockingUnit) break

    switch (attempt) {
      case 0:
        // Try to find a 1-tile detour around obstacle
        findWayAroundObstacle()
        break

      case 1:
        // Recalculate a prefix of the path
        if (path.remainingSteps > PATH_REPAIR_DISTANCE) {
          const prefixTarget = path.getNextPos(PATH_REPAIR_DISTANCE)
          const newPrefix = grid.calculatePathTo(unit, prefixTarget)
          if (newPrefix) {
            path = new Path(path.skipSteps(PATH_REPAIR_DISTANCE), newPrefix)
          }
        } else {
          path = grid.calculatePathTo(unit, path.getTarget())
          if (!path) return NodeStatus.FAILURE
        }
        break

      case 2:
        // Push the blocking unit (lower ID yields to higher ID)
        blockingUnit.push(unit)
        break

      case 3:
        // Give up this tick, try again next tick
        return NodeStatus.RUNNING
    }
  }

  return NodeStatus.SUCCESS
}
```

### 4.3 Unit Pushing

When a unit is pushed, it either moves to a random free neighbor tile or swaps positions with the pusher.

**Source:** `jsettlers.logic/.../movable/Movable.java:627-640`

```typescript
push(pushingUnit: Movable): void {
  // Only yield if our ID is lower (prevents infinite push loops)
  if (this.id <= pushingUnit.id) return

  this.pushedFrom = pushingUnit.position
  this.tick.tick()  // Run behavior tree which handles the push
  this.pushedFrom = null
}
```

### 4.4 Flocking/Decentralization

Idle units spread out to prevent clustering:

**Source:** `jsettlers.logic/.../movable/Movable.java:574-598`

```typescript
// Called during idle behavior
function decentralize(unit: Movable): boolean {
  const decentVector = grid.calcDecentralizeVector(unit.position.x, unit.position.y)
  const randomDirection = unit.direction.getNeighbor(random(-2, 2))

  const dx = randomDirection.gridDeltaX + decentVector.x
  const dy = randomDirection.gridDeltaY + decentVector.y

  if (gridDistance(dx, dy) >= 2) {
    unit.flockDelay = Math.max(unit.flockDelay - 100, 500)
    unit.flockDirection = getApproxDirection(0, 0, dx, dy)
    return true  // Should move
  } else {
    unit.flockDelay = Math.min(unit.flockDelay + 100, 1000)
    return false  // Stay put
  }
}
```

### 4.5 Six-Direction Hex Grid

JSettlers uses 6 directions on a proper hex grid with the Y_SCALE factor for correct distance.

**Source:** `jsettlers.common/.../movable/EDirection.java`

```typescript
enum EDirection {
  NORTH_EAST = 0,  // gridDelta: (1, -1)
  EAST       = 1,  // gridDelta: (1,  0)
  SOUTH_EAST = 2,  // gridDelta: (0,  1)
  SOUTH_WEST = 3,  // gridDelta: (-1, 1)
  WEST       = 4,  // gridDelta: (-1, 0)
  NORTH_WEST = 5,  // gridDelta: (0, -1)
}

const NUMBER_OF_DIRECTIONS = 6

// Get the next tile in a direction
function getNextHexPoint(pos: ShortPoint2D, dir: EDirection): ShortPoint2D {
  return { x: pos.x + GRID_DELTA_X[dir], y: pos.y + GRID_DELTA_Y[dir] }
}

// Approximate direction from one point to another
function getApproxDirection(
  fromX: number, fromY: number,
  toX: number, toY: number
): EDirection {
  // Uses atan2 with hex grid angle correction
}
```

### 4.6 Hex Grid Distance

**Source:** `jsettlers.common/.../map/shapes/MapCircle.java`

```typescript
const Y_SCALE = Math.sqrt(3) / 2 * 0.999999

function hexDistance(x1: number, y1: number, x2: number, y2: number): number {
  const dx = x2 - x1 - (y2 - y1) * 0.5
  const dy = (y2 - y1) * Y_SCALE
  return Math.sqrt(dx * dx + dy * dy)
}

function squaredHexDistance(x1: number, y1: number, x2: number, y2: number): number {
  const dx = x2 - x1 - (y2 - y1) * 0.5
  const dy = (y2 - y1) * Y_SCALE
  return dx * dx + dy * dy
}
```

### 4.7 InAreaFinder (Randomized Search)

Fast probabilistic search for nearby resources/positions within a radius.

**Source:** `jsettlers.algorithms/.../path/area/InAreaFinder.java`

```typescript
// Find a random position matching criteria within radius
// Uses power-weighted random (bias toward center: radius^3.9)
function findInArea(
  centerX: number, centerY: number,
  searchRadius: number,
  predicate: (x: number, y: number) => boolean
): { x: number, y: number } | null {
  for (let i = 0; i < 100; i++) {
    const angle = random() * 2 * Math.PI
    const radius = Math.pow(random(), 3.9) * searchRadius  // Bias toward center

    const tileX = Math.round(Math.cos(angle) * radius + centerX)
    const tileY = Math.round(Math.sin(angle) * radius + centerY)

    if (isInBounds(tileX, tileY) && predicate(tileX, tileY)) {
      return { x: tileX, y: tileY }
    }
  }
  return null
}
```

---

## 5. AI System

**Priority: MEDIUM-HIGH — 57 files, modular architecture**

### 5.1 Architecture Overview

```
AiExecutor (orchestrator)
├── Light rules — every 1 second (quick decisions)
├── Heavy rules — every 10 seconds (expensive analysis)
│
├── WhatToDoAi (high-level strategic decisions)
│   ├── BuildingListEconomyMinister (WHAT to build)
│   ├── ConstructionPositionFinder (WHERE to build)
│   ├── PioneerAi (territory expansion)
│   └── ArmyFramework (military)
│
└── AiStatistics (830 lines — information gathering)
    ├── Per-player building counts, positions
    ├── Material inventories
    ├── Terrain analysis (trees, stones, rivers)
    ├── Enemy positions
    └── 6 parallel stat updaters
```

### 5.2 AI Execution Model

**Source:** `jsettlers.ai/highlevel/AiExecutor.java`

```typescript
class AiExecutor {
  private players: Map<number, IWhatToDoAi>
  private statistics: AiStatistics
  private heavyTickCounter = 0

  // Called by game timer every second
  timerEvent(): void {
    this.heavyTickCounter++

    // Always run light rules
    for (const [id, ai] of this.players) {
      ai.applyLightRules()
    }

    // Every 10 seconds, run heavy rules
    if (this.heavyTickCounter >= 10) {
      this.heavyTickCounter = 0
      this.statistics.updateStatistics()  // Expensive scan

      for (const [id, ai] of this.players) {
        ai.applyHeavyRules()
      }
    }
  }
}
```

### 5.3 High-Level Decision Flow

**Source:** `jsettlers.ai/highlevel/WhatToDoAi.java` (565 lines)

```typescript
class WhatToDoAi {
  applyHeavyRules(): void {
    this.economyMinister.update()

    // 1. Destroy unnecessary buildings
    this.destroyBuildings()  // Surplus stonecutters, living houses, foresters

    // 2. Command pioneers
    this.commandPioneers()   // Distribute to resource/broadening groups

    // 3. Build buildings
    this.buildBuildings()
    //   if (lacking settlers)  → return (never build without workers)
    //   else buildLivingHouse()
    //   else buildTower()       → border expansion
    //   else buildStock()       → for gold/gems
    //   else buildEconomy()     → main production chain

    // 4. Military orders
    this.armyGeneral.applyHeavyRules()

    // 5. Send geologists
    this.sendGeologists()
  }
}
```

### 5.4 Economy Minister

**Source:** `jsettlers.ai/economy/BuildingListEconomyMinister.java` (228 lines)

```typescript
class BuildingListEconomyMinister {
  weaponSmithFactor: number      // 0-1: Military vs economic balance
  buildingIndustryFactor: number // 0-1: Build speed priority

  // Dynamically ordered queue of what to build next
  buildingsToBuild: EBuildingType[] = []

  update(): void {
    this.buildingsToBuild = []

    // Phase 1: Minimal production (toolsmith, little storehouse)
    this.addMinimalBuildingMaterialBuildings()

    // Phase 2: Hospitals
    this.addHospitals()
    // - 1 hospital at 2+ coal mines
    // - 1 hospital at 3+ coal mines
    // - 1 hospital per 100-150 soldiers

    // Phase 3: Map-size-dependent strategy
    if (this.isVerySmallMap()) {
      this.addSmallWeaponProduction()
      this.addFoodAndBuildingMaterialAndWeaponAndGoldIndustry()
      this.addManaBuildings()
    } else {
      this.addManaBuildings()
      this.addFoodAndBuildingMaterialAndWeaponAndGoldIndustry()
      this.addSecondToolSmith()
    }
  }

  // End-game detection
  isEndGame(): boolean {
    const remainingGrass = this.totalGrass - this.treesCount - this.stonesCount
    const availableGrass = this.getGrassTilesOf(this.playerId)
    return remainingGrass / availableGrass <= 0.6  // 60% built out
  }
}
```

### 5.5 Construction Position Finders

Each building type has a specialized position-scoring strategy.

**Source:** `jsettlers.ai/construction/` (15 specialized finders)

```typescript
abstract class ConstructionPositionFinder {
  abstract findBestConstructionPosition(): { x: number, y: number } | null
}

class ConstructionPositionFinderFactory {
  private cache = new Map<EBuildingType, ConstructionPositionFinder>()

  getFinderFor(type: EBuildingType): ConstructionPositionFinder {
    if (!this.cache.has(type)) {
      this.cache.set(type, this.createFinderFor(type))
    }
    return this.cache.get(type)!
  }

  private createFinderFor(type: EBuildingType): ConstructionPositionFinder {
    switch (type) {
      // Mines: score by resource amount - distance penalty
      case COALMINE: case IRONMINE: case GOLDMINE:
        return new MineConstructionPositionFinder(type)

      // Towers: place adjacent to existing towers for chain coverage
      case TOWER: case BIG_TOWER: case CASTLE:
        return new MilitaryConstructionPositionFinder()

      // Farms: score by plantable tiles in work area
      case FARM: case WINEGROWER:
        return new PlantingBuildingConstructionPositionFinder(type)

      // Lumberjack: score by harvestable trees nearby
      case LUMBERJACK:
        return new LumberJackConstructionPositionFinder()

      // Sawmill/Barrack: score by distance to prerequisite building
      case SAWMILL: case BARRACK:
        return new NearRequiredBuildingConstructionPositionFinder(type)

      case FISHER:
        return new FisherConstructionPositionFinder()

      case STONECUTTER:
        return new StoneCutterConstructionPositionFinder()

      case FORESTER:
        return new ForesterConstructionPositionFinder()

      // ... 26 total types
    }
  }
}
```

**Scoring pattern (common across all finders):**

```typescript
interface ScoredConstructionPosition {
  position: { x: number, y: number }
  score: number  // Lower is better
}

function findBestPosition(candidates: ScoredConstructionPosition[]): ShortPoint2D | null {
  if (candidates.length === 0) return null
  return candidates.reduce((best, curr) =>
    curr.score < best.score ? curr : best
  ).position
}
```

### 5.6 AI Statistics

**Source:** `jsettlers.ai/highlevel/AiStatistics.java` (830 lines)

Per-player statistics updated every 10 seconds:

```typescript
interface PlayerStatistic {
  // Building tracking
  totalBuildingsNumbers: number[]    // By EBuildingType index, including unfinished
  finishedBuildingsNumbers: number[] // Finished only
  buildingPositions: Map<EBuildingType, { x: number, y: number }[]>
  buildingWorkAreas: Map<EBuildingType, { x: number, y: number }[]>

  // Unit tracking
  movablePositions: Map<EMovableType, { x: number, y: number }[]>
  joblessBearerPositions: { x: number, y: number }[]

  // Terrain & resources
  landToBuildOn: AiPositions
  stones: AiPositions
  trees: AiPositions
  rivers: AiPositions
  borderIngestibleByPioneers: AiPositions
  enemyTroopsInTown: AiPositions

  // Material inventory
  materials: Map<EMaterialType, number>

  // Counts
  numberOfNotFinishedBuildings: number
  numberOfNotOccupiedMilitaryBuildings: number
}
```

**AiPositions** — optimized spatial data structure:

```typescript
class AiPositions {
  private points: number[]  // Packed x,y coordinates
  private sorted: boolean

  getNearestPoint(
    center: { x: number, y: number },
    maxDistance: number,
    filter?: (x: number, y: number) => boolean
  ): { x: number, y: number } | null

  contains(x: number, y: number): boolean
  add(x: number, y: number): void
  remove(x: number, y: number): void
}
```

### 5.7 Military AI

**Source:** `jsettlers.ai/army/` (13 files)

Modular army framework with pluggable modules:

```typescript
class ArmyFramework {
  modules: ArmyModule[] = [
    new SoldierProductionModule(this),
    new MountTowerModule(this),
    new RegroupArmyModule(this),
    new UpgradeSoldiersModule(this),
    new HealSoldiersModule(this),
    new SimpleDefenseStrategy(this),
    new SimpleAttackStrategy(this),
  ]

  applyHeavyRules(soldiersWithOrders: Set<number>): void {
    for (const mod of this.modules) {
      mod.applyHeavyRules(soldiersWithOrders)
    }
  }

  applyLightRules(soldiersWithOrders: Set<number>): void {
    for (const mod of this.modules) {
      mod.applyLightRules(soldiersWithOrders)
    }
  }
}
```

**Attack strategy:**

```typescript
class SimpleAttackStrategy extends ArmyModule {
  applyHeavyRules(soldiersWithOrders: Set<number>): void {
    if (!this.enemiesExist()) return

    const myArmy = this.getSoldierPositions(this.playerId)
    const enemyArmy = this.getSoldierPositions(this.weakestEnemyId)

    // Attack conditions:
    const shouldAttack =
      myArmy.woundedRatio <= 0.5 &&
      myArmy.count >= 20 &&
      myArmy.combatPower * 1.1 > enemyArmy.combatPower &&
      this.hasPrerequisiteBuildings() &&
      !this.infantryWouldBeSlaughtered(myArmy, enemyArmy)

    if (shouldAttack) {
      if (this.infantryWouldDie(myArmy, enemyArmy)) {
        this.sendBowmenOnly(this.weakestEnemyDoor)
      } else {
        this.sendAllTroops(this.weakestEnemyDoor)
      }
    }
  }
}
```

**Soldier production:**

```typescript
class SoldierProductionModule extends ArmyModule {
  applyHeavyRules(): void {
    const swordsmen = this.countSoldierType(SWORDSMAN)
    const pikemen = this.countSoldierType(PIKEMAN)
    const bowmen = this.countSoldierType(BOWMAN)

    if (swordsmen < 10) {
      // Phase 1: Build minimum swordsmen
      this.setProduction(SWORD, 10 - swordsmen)
    } else if (pikemen < 20) {
      // Phase 2: Build pikemen
      this.setProduction(SPEAR, 20 - pikemen)
    } else if (bowmen * this.combatStrength < BOWMEN_KILLING_THRESHOLD) {
      // Phase 3: Build bowmen
      this.setProductionRatio(BOW, 1.0)
    } else {
      // Phase 4: Balance all types
      this.setEqualRatios()
    }
  }
}
```

### 5.8 Pioneer AI

**Source:** `jsettlers.ai/highlevel/pioneers/PioneerAi.java` (109 lines)

```typescript
class PioneerAi {
  resourcePioneers = new PioneerGroup(20)   // Seek specific resources
  broadenerPioneers = new PioneerGroup(40)  // Expand borders

  // Priority-based target finding
  targetFinders: PioneerTargetFinder[] = [
    new TreesForLumberJackTargetFinder(distance: 10),
    new NearStonesTargetFinder(),
    new StoneCutterTargetFinder(distance: 6),
    new ConnectPartitionsTargetFinder(),  // Merge separate lands
    new MineTargetFinder(COAL),
    new MineTargetFinder(IRON),
    new RiverTargetFinder(),
    new MineTargetFinder(GOLD),
    new MineTargetFinder(GEMS),  // Egyptians only
    new FishTargetFinder(),
  ]
}
```

---

## 6. Territory & Partition System

**Priority: MEDIUM — extends existing territory system**

### 6.1 Partitions (Connected Regions)

A player's territory may be split into disconnected regions. Materials can ONLY be transported within the same partition.

**Source:** `jsettlers.algorithms/.../partitions/PartitionCalculatorAlgorithm.java`

```typescript
class PartitionCalculator {
  // Flood-fill to find connected components
  calculatePartitions(
    width: number,
    height: number,
    isBlocked: (x: number, y: number) => boolean,
    getPlayer: (x: number, y: number) => number
  ): Int16Array {
    // Returns partition ID per tile
    // Same player + connected = same partition
    // Same player + disconnected = different partitions
  }
}
```

### 6.2 Per-Partition Economy

Each partition gets its own economy manager:

**Source:** `jsettlers.logic/.../partition/manager/PartitionManager.java`

```typescript
class PartitionManager {
  materialsManager: MaterialsManager       // Offer/request matching
  joblessBearers: BearerPool               // Idle carriers in this partition
  settings: PartitionManagerSettings       // Distribution settings

  // Worker request pools
  diggerRequests: Queue<DiggerRequest>
  bricklayerRequests: Queue<BricklayerRequest>
  soldierRequests: Queue<SoldierRequest>

  // Tool priority: axes > picks > scythes
  toolPriority: EMaterialType[]
}
```

### 6.3 Border Computation

**Source:** `jsettlers.algorithms/.../borders/BordersThread.java`

```typescript
// Runs on background thread
class BordersComputer {
  computeBorders(
    partitionsGrid: Int16Array,
    width: number,
    height: number
  ): BorderTile[] {
    // A tile is a border if any neighbor belongs to a different player
    const borders: BorderTile[] = []
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const myPlayer = getPlayer(x, y)
        for (const dir of DIRECTIONS) {
          const nx = x + dir.dx, ny = y + dir.dy
          if (inBounds(nx, ny) && getPlayer(nx, ny) !== myPlayer) {
            borders.push({ x, y, player: myPlayer })
            break
          }
        }
      }
    }
    return borders
  }
}
```

### 6.4 Territory Change Listener

**Source:** `jsettlers.logic/.../partition/IPlayerChangedListener.java`

```typescript
interface IPlayerChangedListener {
  playerChangedAt(x: number, y: number, newPlayerId: number): void
}
```

---

## 7. Fog of War

**Priority: MEDIUM**

**Source:** `jsettlers.algorithms/.../fogofwar/FogOfWar.java`

```typescript
class FogOfWar {
  private sight: Uint8Array2D           // Vision strength per tile
  private hiddenLandscape: Uint8Array2D // Terrain type when last seen
  private hiddenHeight: Uint8Array2D    // Height when last seen

  static MAX_VIEW_DISTANCE = 65

  // Add/remove vision when buildings change state
  static queueResizeCircle(
    position: { x: number, y: number },
    oldRadius: number,
    newRadius: number
  ): void

  // Building sight radius by state
  getSightRadius(building: Building): number {
    if (!building.isConstructed()) return 0    // Under construction: no vision
    if (!building.isOccupied()) return 5       // Unoccupied: minimal vision
    return building.type.viewDistance           // Occupied: full vision
  }
}
```

**CachedViewCircle** — precomputed circle coordinates for fast vision updates:

```typescript
class CachedViewCircle {
  private static cache = new Map<number, { x: number, y: number }[]>()

  static getCircle(radius: number): { x: number, y: number }[] {
    if (!this.cache.has(radius)) {
      this.cache.set(radius, this.computeCircle(radius))
    }
    return this.cache.get(radius)!
  }
}
```

---

## 8. Game Timer & Scheduler

**Priority: MEDIUM — replaces simple game loop**

**Source:** `jsettlers.logic/.../timer/RescheduleTimer.java`

```typescript
class RescheduleTimer {
  static TIME_SLICE = 25       // ms per slot
  static TIME_SLOTS = 1280     // 32 seconds total buffer

  private slots: Set<IScheduledTimerable>[] = new Array(TIME_SLOTS).fill(null).map(() => new Set())
  private currentSlot = 0

  // O(1) scheduling
  schedule(entity: IScheduledTimerable, delayMs: number): void {
    const targetSlot = (this.currentSlot + Math.floor(delayMs / TIME_SLICE)) % TIME_SLOTS
    this.slots[targetSlot].add(entity)
  }

  // Called each time slice
  tick(): void {
    const entities = this.slots[this.currentSlot]
    this.slots[this.currentSlot] = new Set()
    this.currentSlot = (this.currentSlot + 1) % TIME_SLOTS

    for (const entity of entities) {
      const rescheduleDelay = entity.timerEvent()
      if (rescheduleDelay > 0) {
        this.schedule(entity, rescheduleDelay)
      }
    }
  }
}

interface IScheduledTimerable {
  timerEvent(): number  // Returns delay until next event (0 = don't reschedule)
}
```

**Advantage over current approach:** Only entities with pending actions get ticked, instead of iterating all entities every frame.

---

## 9. Bearer & Carrier System

**Priority: MEDIUM — makes the economy visible**

**Source:** `jsettlers.logic/.../movable/civilian/BearerMovable.java`

```typescript
class BearerMovable extends Movable {
  private carryingMaterial: EMaterialType | null = null
  private transportJob: TransportJob | null = null

  // Behavior tree
  createBehavior(): Node<BearerMovable> {
    return selector(
      // Active transport job
      sequence(
        condition(mov => mov.transportJob !== null),
        followPathTo(mov => mov.transportJob!.offerPosition),
        action(mov => mov.pickUpMaterial()),
        followPathTo(mov => mov.transportJob!.requestPosition),
        action(mov => mov.deliverMaterial()),
        action(mov => mov.becomeJobless())
      ),

      // Conversion to specialist (toolsmith produced an axe → bearer becomes lumberjack)
      sequence(
        condition(mov => mov.conversionRequest !== null),
        action(mov => mov.convert())
      ),

      // Idle
      doingNothingAction()
    )
  }

  assignTransportJob(from: Position, to: Position, material: EMaterialType): void {
    this.transportJob = { offerPosition: from, requestPosition: to, material }
  }

  private pickUpMaterial(): void {
    this.carryingMaterial = this.transportJob!.material
    this.grid.takeMaterialFrom(this.position)
  }

  private deliverMaterial(): void {
    this.grid.deliverMaterialTo(this.position, this.carryingMaterial!)
    this.carryingMaterial = null
    this.transportJob = null
  }
}
```

**DonkeyMovable** — cargo donkeys for long-distance transport (similar pattern but on roads).

---

## 10. Building System

**Priority: MEDIUM — enriches existing building system**

### 10.1 Building States

**Source:** `jsettlers.logic/.../buildings/Building.java`

```typescript
enum EBuildingState {
  CREATED,        // Just placed, waiting for flattening
  PLANNED,        // Site flattened, waiting for materials
  CONSTRUCTING,   // Materials arriving, construction in progress
  CONSTRUCTED,    // Built, waiting for worker
  OCCUPIED,       // Worker assigned, fully functional
  DESTROYED,      // Demolished
}
```

### 10.2 Construction Progress

```typescript
class Building {
  state: EBuildingState
  constructionProgress: number = 0.0  // 0.0 to 1.0
  priority: EPriority = EPriority.DEFAULT
  stacks: RequestStack[]  // Material stacks needed for construction

  // Construction materials per type (example)
  static CONSTRUCTION_STACKS: Record<EBuildingType, ConstructionStack[]> = {
    LUMBERJACK:  [{ material: PLANK, count: 2 }, { material: STONE, count: 1 }],
    SAWMILL:     [{ material: PLANK, count: 3 }, { material: STONE, count: 2 }],
    FARM:        [{ material: PLANK, count: 2 }, { material: STONE, count: 3 }],
    COALMINE:    [{ material: PLANK, count: 3 }],
    TOWER:       [{ material: PLANK, count: 4 }, { material: STONE, count: 6 }],
    // ...
  }
}
```

### 10.3 Building Priority

```typescript
enum EPriority {
  STOPPED,   // Building paused, no material delivery
  LOW,       // Low priority delivery
  DEFAULT,   // Normal
  HIGH,      // Rush delivery
}

// During construction, supported priorities are [LOW, HIGH, STOPPED]
// After construction, most buildings don't support priority changes
```

### 10.4 Request Stack

Each material slot in a building is a `RequestStack` that communicates with the economy:

```typescript
class RequestStack {
  materialType: EMaterialType
  requiredCount: number
  deliveredCount: number = 0
  pendingDeliveries: number = 0  // Bearers en route

  isFullySupplied(): boolean {
    return this.deliveredCount + this.pendingDeliveries >= this.requiredCount
  }

  deliveryAccepted(): void {
    this.pendingDeliveries++
  }

  materialDelivered(): void {
    this.pendingDeliveries--
    this.deliveredCount++
  }
}
```

### 10.5 Building Type Hierarchy

**Source:** `jsettlers.logic/.../buildings/`

```typescript
// Building class hierarchy
Building (abstract base)
├── WorkerBuilding          // Has one assigned worker
│   ├── ResourceBuilding    // Mines, farms, fisheries
│   ├── MillBuilding        // Windmill with rotation
│   ├── MineBuilding        // Mines with depletion
│   ├── SlaughterhouseBuilding
│   └── DockyardBuilding
├── OccupyingBuilding       // Military towers with soldiers
├── Barrack                 // Trains soldiers from weapons
├── SmallLivinghouse        // Spawns 10 bearers
├── MediumLivinghouse       // Spawns 30 bearers
├── BigLivinghouse          // Spawns 100 bearers
├── BigTemple               // Population control
├── StockBuilding           // Resource storage
├── MarketBuilding          // Local trade
├── HarborBuilding          // Water trade
├── TempleBuilding          // Mana production
└── DefaultBuilding         // Generic (decorative, etc.)
```

---

## 11. Constants & Data Tables

### 11.1 Building Ratios (AI)

**Source:** `jsettlers.ai/highlevel/AiBuildingConstants.java`

```typescript
const AI_BUILDING_RATIOS = {
  COAL_MINE_TO_IRON_MINE:     2,  // 2 coal mines per iron mine
  WEAPON_SMITH_TO_BARRACKS:   3,  // 3 smiths per barracks
  FARM_TO_MILL:               3,  // 3 farms per mill
  FARM_TO_BAKER:              1,  // 1 farm per baker (with mill)
  LUMBERJACK_TO_SAWMILL:      2,  // 2 lumberjacks per sawmill
  LUMBERJACK_TO_FORESTER:     2,  // 2 lumberjacks per forester
  IRONMELT_TO_WEAPON_SMITH:   1,  // 1:1
}
```

### 11.2 Living House Capacities

```typescript
const LIVING_HOUSE_BEDS = {
  SMALL:  10,
  MEDIUM: 30,
  BIG:    100,
}

const BEARERS_PER_BUILDING = 3  // Approximate need
```

### 11.3 Military Constants

```typescript
const MILITARY = {
  MIN_SWORDSMEN_COUNT:          10,
  MIN_PIKEMEN_COUNT:            20,
  BOWMEN_KILLING_THRESHOLD:     300,
  MIN_ATTACKER_COUNT:           20,
  MAX_WOUNDED_RATIO_FOR_ATTACK: 0.5,

  // Difficulty scaling (attackerCountFactor)
  DIFFICULTY: {
    EASY:     1.1,  // AI needs 110% power to attack
    NORMAL:   1.0,
    HARD:     0.9,
    VERY_HARD: 0.8,
    INSANE:   0.0,  // Always attacks
  },

  SOLDIER_UPGRADE_ORDER: ['BOWMAN', 'PIKEMAN', 'SWORDSMAN'],
}
```

### 11.4 Pioneer Constants

```typescript
const PIONEERS = {
  RESOURCE_GROUP_SIZE:  20,
  BROADENER_GROUP_SIZE: 40,
  RELEASE_THRESHOLD:    10,  // Convert to bearers when >10 spare
}
```

### 11.5 Scheduler Constants

```typescript
const TIMER = {
  TIME_SLICE_MS:     25,
  TIME_SLOTS:        1280,  // 32 seconds total buffer
  LIGHT_RULES_MS:    1000,
  HEAVY_RULES_MS:    10000,
}
```

### 11.6 Building Check Periods

```typescript
const BUILDING_CHECK_PERIODS = {
  IS_UNSTOPPED_RECHECK:      1000,  // ms
  IS_FLATTENED_RECHECK:      1000,
  WAITING_FOR_MATERIAL:      1000,
  DESTRUCTION_SMOKE_DURATION: 1.2,  // seconds
}
```

---

## 12. S3 vs S4 Adaptation Notes

Since Settlers.ts targets S4 with S3 compatibility, these differences matter when porting:

### Different in S4

| Feature | Settlers 3 (JSettlers) | Settlers 4 (Target) |
|---------|----------------------|---------------------|
| **Military** | Individual soldiers | Squad-based units |
| **Civilizations** | Romans, Egyptians, Asians | Vikings, Romans, Maya, Dark Tribe |
| **Mana/Magic** | Basic temple system | Full spell system with mana types |
| **Roads** | Required for carriers | Optional (settlers can walk freely) |
| **Terrain** | Standard hex | Standard hex (different terrain types) |
| **Resources** | Coal, Iron, Gold, Gems | Similar + Sulfur, Mushrooms |
| **Building sizes** | Small/Medium/Large footprints | Different footprint system |
| **Production** | Fixed chains | Civilization-specific chains |

### What Ports Directly

- Material offer/request system (core economy pattern)
- Behavior tree framework (language-agnostic)
- Pathfinding algorithms (bucket queue A*, obstacle repair)
- AI architecture (two-tier light/heavy rules)
- Construction position scoring (building placement strategy)
- Territory partitioning (connected components)
- Fog of war mechanics
- Game timer/scheduler
- Unit pushing/flocking

### What Needs Adaptation

- **Material types enum** — S4 has different materials, adjust the list
- **Production chains** — S4 chains differ by civilization
- **Military AI** — S4 squads vs S3 individual soldiers
- **Building types** — Different building catalog
- **Carrier system** — S4 is more flexible about road requirements
- **Civilization features** — S4 has deeper civ differentiation
- **Spell system** — Not present in JSettlers, needs new implementation

---

## 13. Recommended Porting Order

### Phase 1: Foundation (enables everything else)

1. **Material types enum + production chain data**
   - Pure data, no game logic dependencies
   - Adapt material list for S4
   - Map building types to input/output materials

2. **Behavior tree framework**
   - ~10 files, ~300 lines
   - Language-agnostic, ports cleanly to TypeScript generics
   - Enables complex unit AI for all subsequent systems

### Phase 2: Core Economy

3. **Offer/request material system**
   - MaterialsManager, OffersList, RequestQueues
   - The heart of the Settlers economy
   - Depends on: material types

4. **Bearer/carrier unit type**
   - Makes the economy visible to the player
   - Uses behavior tree for transport logic
   - Depends on: material system, behavior trees

5. **Building construction with material consumption**
   - RequestStack per building material slot
   - Progressive construction as materials arrive
   - Building priority system (STOPPED/LOW/DEFAULT/HIGH)

### Phase 3: Movement & Pathfinding

6. **Six-direction hex grid**
   - Upgrade from 4-directional to 6-directional
   - Port EDirection with grid deltas
   - Hex distance calculation with Y_SCALE

7. **Bucket queue A***
   - Drop-in replacement for current priority queue
   - O(1) insert on uniform-cost grids

8. **Path repair & unit pushing**
   - 4-stage obstacle resolution
   - Push system with ID-based priority
   - Flocking/decentralization for idle units

### Phase 4: Territory & Infrastructure

9. **Partition system**
   - Connected-component analysis of territory
   - Per-partition economy managers
   - Material transport restricted to same partition

10. **Fog of war**
    - Per-team visibility arrays
    - Building sight radius by state
    - Cached circle computations

### Phase 5: AI

11. **AI statistics gathering**
    - AiStatistics with per-player data
    - AiPositions spatial data structure
    - 6 parallel stat updaters

12. **Construction position scoring**
    - Per-building-type position finders
    - Scoring system for optimal placement

13. **Economy minister**
    - Building ratio management
    - Production chain balancing
    - End-game detection

14. **Military AI**
    - Modular army framework
    - Attack/defense strategies
    - Soldier production management

15. **Pioneer AI**
    - Territory expansion strategies
    - Resource-seeking target finders

### Phase 6: Polish

16. **Game timer/scheduler**
    - Replace fixed-timestep tick-all with event-based scheduling
    - O(1) scheduling with circular buffer

---

## Appendix: Key Source File Paths

### JSettlers Core Logic
```
~/Code/settlers-remake/jsettlers.logic/src/main/java/jsettlers/

GAME CORE:
  logic/map/grid/MainGrid.java                          (2,311 lines)
  main/JSettlersGame.java
  main/GameRunner.java

PATHFINDING:
  algorithms/path/astar/BucketQueueAStar.java
  algorithms/path/Path.java
  algorithms/path/astar/queues/bucket/ListMinBucketQueue.java
  algorithms/path/area/InAreaFinder.java

BEHAVIOR TREE:
  algorithms/simplebehaviortree/Node.java
  algorithms/simplebehaviortree/Tick.java
  algorithms/simplebehaviortree/nodes/Sequence.java
  algorithms/simplebehaviortree/nodes/Selector.java

PARTITIONS:
  algorithms/partitions/PartitionCalculatorAlgorithm.java
  logic/map/grid/partition/PartitionsGrid.java
  logic/map/grid/partition/manager/PartitionManager.java

MATERIALS:
  common/material/EMaterialType.java
  logic/map/grid/partition/manager/materials/MaterialsManager.java
  logic/map/grid/partition/manager/materials/offers/OffersList.java
  logic/map/grid/partition/manager/materials/requests/MaterialRequestObject.java
  logic/map/grid/partition/manager/settings/MaterialDistributionSettings.java

BUILDINGS:
  logic/buildings/Building.java                          (2,400+ lines)
  logic/buildings/workers/WorkerBuilding.java
  logic/buildings/military/occupying/OccupyingBuilding.java
  logic/buildings/stack/RequestStack.java
  common/buildings/EBuildingType.java
  common/buildings/MaterialsOfBuildings.java

UNITS:
  logic/movable/Movable.java                             (950+ lines)
  logic/movable/civilian/BearerMovable.java
  common/movable/EMovableType.java
  common/movable/EDirection.java

AI:
  ai/highlevel/AiExecutor.java                           (123 lines)
  ai/highlevel/WhatToDoAi.java                           (565 lines)
  ai/highlevel/AiStatistics.java                         (830 lines)
  ai/highlevel/AiPositions.java                          (316 lines)
  ai/economy/BuildingListEconomyMinister.java            (228 lines)
  ai/construction/ConstructionPositionFinder.java        (150 lines)
  ai/army/ArmyFramework.java                             (120 lines)
  ai/army/SimpleAttackStrategy.java
  ai/army/SimpleDefenseStrategy.java
  ai/highlevel/pioneers/PioneerAi.java                   (109 lines)

FOG OF WAR:
  algorithms/fogofwar/FogOfWar.java
  algorithms/borders/BordersThread.java

TIMER:
  logic/timer/RescheduleTimer.java

GRID SHAPES:
  common/map/shapes/MapCircle.java
  common/map/shapes/HexGridArea.java
  common/position/ShortPoint2D.java
```

### Settlers.ts Current Structure
```
~/Code/Settlers.ts/src/

GAME CORE:
  game/game.ts
  game/game-state.ts
  game/game-loop.ts
  game/entity.ts

SYSTEMS:
  game/systems/pathfinding.ts
  game/systems/movement.ts
  game/systems/placement.ts
  game/systems/territory.ts

COMMANDS:
  game/commands/command.ts

RENDERING:
  game/renderer/renderer.ts
  game/renderer/entity-renderer.ts
  game/renderer/landscape/landscape-renderer.ts

RESOURCES:
  resources/map/
  resources/gfx/
  resources/file/
  resources/lib/

VIEWS:
  views/map-view.vue
  views/use-map-view.ts
  components/use-renderer.ts
```
