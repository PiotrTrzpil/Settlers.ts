# Settlers.ts — Product Requirements Document

**Version:** 1.0
**Date:** February 2026
**Status:** Active Development

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Vision & Goals](#2-vision--goals)
3. [Target Audience](#3-target-audience)
4. [Current State](#4-current-state)
5. [Core Game Design](#5-core-game-design)
6. [Technical Architecture](#6-technical-architecture)
7. [Feature Specifications](#7-feature-specifications)
8. [MVP Scope](#8-mvp-scope)
9. [Implementation Roadmap](#9-implementation-roadmap)
10. [Success Metrics](#10-success-metrics)
11. [Risks & Mitigations](#11-risks--mitigations)
12. [Appendix: Game Data Reference](#appendix-game-data-reference)

---

## 1. Executive Summary

Settlers.ts is a browser-based reimplementation of The Settlers 4 (Siedler 4), built with TypeScript, Vue 3, and WebGL. The project aims to faithfully recreate the core gameplay while introducing design improvements that address known shortcomings of the original.

The game uses original Settlers 4 assets (graphics, maps, sounds) loaded via custom binary file readers, combined with modern web technologies for cross-platform accessibility.

### Key Differentiators from Original

| Original S4 Issue | Our Improvement |
|-------------------|-----------------|
| Territory via cheap towers | Implicit territory based on infrastructure |
| Simplistic magic system | Strategic, meaningful, rare abilities |
| Houses spawn settlers magically | Settlers arrive from Mother City or reproduce |
| Roads mandatory | Wilderness movement allowed; roads are infrastructure investment |
| Global priority sliders | Physical, local priority via warehouses |
| Carrier routing inefficiencies | Pre-computed road graph with optimal paths |

---

## 2. Vision & Goals

### 2.1 Design Vision

> *"You are on a frontier. It's not pure survival, but nature is a large factor. You are fighting for land to live on."*

The game should emphasize:
- **Multiple settlements** connected by logistics networks
- **Complex, interesting logistics** with physical goods transport
- **Environment as obstacle and resource** — wilderness, forests, rivers matter
- **Emergence and strategy** — multiple viable approaches to expansion/combat
- **Visual honesty** — everything happening in the game is visible on screen

### 2.2 Design Goals

1. Keep the soul of Settlers 3/4 (economic simulation with military)
2. More settler-like frontier feel with exploration and danger
3. More complex logistics inspired by Factorio/Satisfactory
4. Greater historical realism (ancient era aesthetic)
5. More meaningful race differences
6. More opportunities for emergent strategies

### 2.3 Non-Goals

- No castle sieges or medieval Stronghold feel
- No mobile-game-like abstract resource nodes
- No happiness/taxes micromanagement
- No excessive survival mechanics
- No large tech trees
- No combat-focused RTS gameplay

---

## 3. Target Audience

### Primary Audience
- Fans of original Settlers 3/4 seeking a modern, accessible version
- City-builder and logistics game enthusiasts
- Players who enjoy complex economic systems over pure combat

### Secondary Audience
- Modders and developers interested in the codebase
- Speedrunners and competitive players (multiplayer)
- Casual players seeking relaxing colony management

### Platform Requirements
- Modern web browser with WebGL 2.0 support
- Desktop-first design (1080p minimum resolution)
- Touch/mobile support as stretch goal

---

## 4. Current State

### 4.1 Implemented Features

| Layer | Status | Notes |
|-------|--------|-------|
| **File Format Loaders** | ✅ Complete | GFX, JIL, DIL, LIB, MAP, save games |
| **WebGL Terrain Rendering** | ✅ Complete | Landscape textures, height, sprite batching |
| **Camera System** | ✅ Complete | Pan, zoom, keyboard/mouse/touch |
| **Tile Picking** | ✅ Complete | Screen → tile coordinate conversion |
| **Entity System** | ✅ Complete | Units, buildings, resources with spatial indexing |
| **Pathfinding** | ✅ Complete | A* with hex grid, path smoothing |
| **Movement System** | ✅ Complete | Per-tick updates, interpolation |
| **Animation System** | ✅ Complete | Sprite-based, direction-aware |
| **Building Placement** | ✅ Complete | Validation, terrain flattening |
| **Building Construction** | ✅ Complete | Phase transitions, terrain capture |
| **Input System** | ✅ Complete | Mode-based (camera, place building, place unit) |
| **Game Loop** | ✅ Complete | Fixed-timestep simulation, background throttling |
| **Lua Scripting** | ✅ Complete | Map scripts, game logic hooks |
| **Audio System** | ✅ Complete | Music, SFX via Howler.js |
| **Economy Types** | ✅ Complete | Material types, production chains defined |

### 4.2 Partially Implemented

| Feature | Status | Notes |
|---------|--------|-------|
| Lumberjack AI | 🟡 Basic | Finds trees, chops, returns; no carry animation |
| Debug Tools | 🟡 Basic | Stats overlay, layer visibility |
| Unit Selection | 🟡 Basic | Single selection, no multi-select |

### 4.3 Not Yet Implemented

| Feature | Priority |
|---------|----------|
| Carrier/logistics system | **Critical** |
| Resource transport | **Critical** |
| Building production | **Critical** |
| Food consumption | High |
| Territory system | High |
| Combat system | High |
| AI opponent | Medium |
| Multiplayer | Medium |
| Save/load game state | Medium |
| Sound effects integration | Low |

---

## 5. Core Game Design

### 5.1 The Core Loop

```
1. Settlers arrive at tavern (from Mother City or reproduction)
2. Build production buildings (woodcutter, farm, bakery)
3. Assign settlers: to buildings (workers) or taverns (carriers)
4. Carriers automatically move goods within tavern's service area
5. All settlers eat at taverns — no food = starvation
6. Expand by building more taverns (extends logistics reach)
```

### 5.2 Territory System

**Implicit Territory** — No painted borders. Territory is determined by:
- Where your buildings stand
- Where your infrastructure makes movement practical
- Physical presence (a building is yours because your people are in it)

**Territory Strength** varies:
- Well-connected settlement with paved roads = "strongly held"
- Lone outpost in wilderness = "weakly held"

**Takeover Mechanics:**
- Buildings disconnected from food supply → settlers leave → building enters "Ruined" state
- Instead of destroying enemy buildings, send Pioneers to occupy
- Logistics warfare: intercept supply lines, starve garrisons

### 5.3 Movement & Roads

**Wilderness Movement** — Settlers CAN move through wilderness, but:
- Very slow movement speed
- High fatigue for carriers
- Risk of wildlife attacks
- Heavy goods (stone, logs) cannot pass

**Road Types:**

| Terrain | Speed | Fatigue | Safety | Heavy Goods |
|---------|-------|---------|--------|-------------|
| Wilderness | Very slow | High | Dangerous | Cannot pass |
| Dirt Path | Moderate | Moderate | Some risk | Slow |
| Log Road | Good | Low | Low risk | Normal |
| Paved Road | Fast | Minimal | Safe | Fast |

**Road Costs:**
- Dirt Path: Free (cleared ground)
- Log Road: Costs wood
- Paved Road: Costs stone

### 5.4 Logistics System

**Heavy vs. Light Goods:**
- **Light goods** (bread, tools): Carried by hand, can traverse wilderness
- **Heavy goods** (stone, logs, ore): Require handcart/donkey, need roads

**Carrier Fatigue:**
| State | Speed | Behavior |
|-------|-------|----------|
| Fresh | Full | Working normally |
| Tired | Slightly slower | Completing task |
| Exhausted | Very slow | Abandons task, returns to tavern |
| Collapsed | Stopped | Drops goods, sits, vulnerable |

**Taverns as Carrier Bases:**
- Carriers eat, rest, and work from taverns
- Each tavern has a configurable service area (radius)
- Carriers serve buildings within their tavern's area
- Multiple taverns can overlap — system assigns nearest available carrier

**Supply Lines:**
- Default: Automatic within tavern service areas
- Manual: Explicit lines with priority (High/Normal/Low) and limits

**Long-Distance Transport:**
```
[Source] → [Warehouse A] → [Warehouse B] → [Destination]
              ↑               ↑               ↑
          [Tavern 1]      [Tavern 2]      [Tavern 3]
          carriers        carriers        carriers
```

### 5.5 Food System

- All settlers need food periodically
- Food consumed at taverns
- No food = starvation → death
- Soldiers require supply lines to front-line buildings

**Food Spoilage:**
- Grain/Flour: Stable, can ship long distances
- Bread/Meat: Spoils, must be produced locally
- Salted goods: Don't spoil (salt is strategic resource)

### 5.6 Population

**Settler Arrival:**
- Early game: From Mother City via ship/caravan
- Mid/Late game: Reproduction with food + housing

**Role Assignment:**
| Assignment | Role |
|------------|------|
| Tavern | Carrier |
| Production building | Worker (baker, miner, etc.) |
| Military building | Soldier |

**Population Trade-offs:**
- More carriers = better throughput, fewer producers
- More producers = more goods, potential delivery bottlenecks
- More soldiers = better defense, weaker economy

### 5.7 Military

**The "Garrison Tax":**
- Towers require periodic ration deliveries
- If supplies cut, soldiers get hungry, lose combat bonus, eventually abandon post

**Combat Types:**
- Melee (swordsmen, axemen)
- Ranged (bowmen, blowgunners)
- Special (priests, thieves, pioneers)

**Unit Progression:**
- Level 1/2/3 for each military type
- Higher levels = better stats, more expensive to train

---

## 6. Technical Architecture

### 6.1 Stack

| Layer | Technology |
|-------|------------|
| Framework | Vue 3 (Composition API) |
| Build | Vite 5, TypeScript 5.4 |
| Rendering | WebGL 2.0 with GLSL shaders |
| State | Custom ECS-lite (arrays + maps) |
| Testing | Vitest (unit), Playwright (e2e) |
| Audio | Howler.js |
| Scripting | Lua (via wasmoon/fengari) |

### 6.2 Directory Structure

```
src/
├── components/           # Vue UI components
├── views/               # Vue route views
├── game/
│   ├── ai/              # AI behavior trees
│   ├── audio/           # Music and SFX
│   ├── commands/        # Player command system
│   ├── economy/         # Material types, production chains
│   ├── features/        # Feature modules (construction, placement)
│   ├── input/           # Input handling, modes
│   ├── renderer/        # WebGL rendering
│   │   ├── landscape/   # Terrain rendering
│   │   └── spatial/     # Entity grid, culling
│   ├── systems/         # Core systems (pathfinding, movement)
│   ├── game-loop.ts     # Main game loop
│   ├── game-state.ts    # Entity storage
│   └── event-bus.ts     # Inter-system communication
├── resources/           # Binary file readers
└── utilities/           # Shared helpers
```

### 6.3 Data Flow

```
┌─────────────┐     ┌──────────────┐     ┌─────────────┐
│  Input      │ --> │  Commands    │ --> │  GameState  │
│  Manager    │     │  (validated) │     │  (entities) │
└─────────────┘     └──────────────┘     └─────────────┘
                                               │
                                               ▼
┌─────────────┐     ┌──────────────┐     ┌─────────────┐
│  Renderer   │ <-- │  Game Loop   │ <-- │  Systems    │
│  (WebGL)    │     │  (30Hz tick) │     │  (tick())   │
└─────────────┘     └──────────────┘     └─────────────┘
```

### 6.4 Tick System Interface

```typescript
interface TickSystem {
    tick(dt: number): void;
}
```

Registered systems run in order each tick:
1. Movement
2. Idle Behavior
3. Building Construction
4. Lumberjack AI
5. (Future: Carrier, Production, Combat, etc.)

### 6.5 Event Bus

Inter-system communication via typed events:

```typescript
eventBus.emit('unit:arrived', { entityId, x, y });
eventBus.on('unit:arrived', (data) => { ... });
```

---

## 7. Feature Specifications

### 7.1 Carrier System (Priority: Critical)

**Carrier Entity:**
```typescript
interface CarrierState {
    entityId: number;
    homeBuilding: number;     // Tavern EntityId
    currentJob: CarrierJob | null;
    fatigue: number;          // 0-100
    carryingMaterial: EMaterialType | null;
    carryingAmount: number;
}
```

**Carrier Jobs:**
```typescript
type CarrierJob =
    | { type: 'pickup'; from: number; material: EMaterialType }
    | { type: 'deliver'; to: number; material: EMaterialType }
    | { type: 'return_home' };
```

**Service Area:**
- Each tavern defines a radius
- Carriers assigned to buildings within radius
- Configurable per-tavern or global default

### 7.2 Production System (Priority: Critical)

**Building Production State:**
```typescript
interface ProductionState {
    buildingId: number;
    recipe: ProductionRecipe;
    progress: number;         // Ticks remaining
    inputSlots: InventorySlot[];
    outputSlots: InventorySlot[];
    workerAssigned: boolean;
}
```

**Production Cycle:**
1. Check input materials available
2. Consume inputs, start production timer
3. On completion, add outputs to building inventory
4. Signal carrier system for pickup

### 7.3 Combat System (Priority: High)

**Unit Combat Stats:**
```typescript
interface CombatStats {
    maxHealth: number;
    attack: number;
    defense: number;
    range: number;        // 0 for melee
    attackSpeed: number;  // Ticks between attacks
}
```

**Combat Resolution:**
- Units auto-engage enemies in range
- Threat-based targeting (prioritize high-threat, low-health, close)
- Morale system: low health → retreat

### 7.4 Territory System (Priority: High)

**Territory Calculation:**
- Military buildings have influence radius
- Overlapping influence = contested
- No building = neutral
- Update on building construction/destruction

**Border Rendering:**
- Compute border segments at territory edges
- Render as colored lines per player

### 7.5 AI System (Priority: Medium)

**AI Personalities:**
```typescript
interface AIConfig {
    aggressiveness: number;     // 0-100
    expansionPriority: number;
    economyFocus: number;
    preferredUnits: UnitType[];
}
```

**AI Phases:**
1. Early Game — Basic economy
2. Mid Game — Expansion, military buildup
3. Late Game — Full military
4. Defense — Under attack response

### 7.6 Multiplayer (Priority: Medium)

**Requirements:**
- Deterministic simulation (fixed-point math, no floats in logic)
- Lockstep protocol with command buffer
- Desync detection via state hashing

**Network Protocol:**
- Commands scheduled N ticks ahead
- All players must send commands before tick advances
- Hash critical state for desync detection

---

## 8. MVP Scope

### 8.1 MVP Goal

> *Sustain your settlement. Don't starve.*

A player should be able to:
1. Start with settlers at a tavern
2. Build production buildings
3. Watch carriers automatically transport goods
4. Manage food production to prevent starvation
5. Expand via additional taverns

### 8.2 MVP Buildings

| Building | Input | Output |
|----------|-------|--------|
| Tavern | — | Carrier base, food distribution |
| Warehouse | — | Storage, handoff point |
| Woodcutter | — | Logs |
| Sawmill | Logs | Boards |
| Farm | — | Grain |
| Mill | Grain | Flour |
| Bakery | Flour, Water | Bread |
| Well | — | Water |
| House | — | Population capacity |

### 8.3 MVP What's Out

- Combat / military
- Territory borders
- Multiple races
- Multiplayer
- AI opponents
- Save/load
- Road quality tiers
- Heavy goods distinction
- Food spoilage
- Mother City

### 8.4 MVP Success Criteria

1. ✅ Load a map with terrain rendering
2. ⬜ Place tavern, assign carriers
3. ⬜ Place production buildings (woodcutter, farm, bakery)
4. ⬜ Watch carriers transport goods automatically
5. ⬜ Settlers consume food at taverns
6. ⬜ Settlement dies if food runs out
7. ⬜ Expand logistics reach with additional tavern

---

## 9. Implementation Roadmap

### Phase 1: Logistics Foundation (6-8 weeks)

**Goal:** Carriers transport goods between buildings

- [ ] Carrier entity type and state management
- [ ] Tavern service area configuration
- [ ] Building inventory system (input/output slots)
- [ ] Resource request/fulfillment matching
- [ ] Carrier job assignment algorithm
- [ ] Pickup animation (approach, grab, turn)
- [ ] Delivery animation (approach, drop, turn)
- [ ] Carrier pathfinding integration
- [ ] Warehouse handoff logic

**Milestone:** Place a woodcutter and warehouse, watch carrier bring logs to warehouse

### Phase 2: Production Chains (4-6 weeks)

**Goal:** Buildings produce goods from inputs

- [ ] Production state per building
- [ ] Recipe system (inputs → outputs)
- [ ] Production timer and progress
- [ ] Input consumption on start
- [ ] Output creation on completion
- [ ] Worker assignment (optional for MVP)
- [ ] Production rate balancing

**Milestone:** Full chain: woodcutter → logs → sawmill → boards → warehouse

### Phase 3: Food & Population (4-6 weeks)

**Goal:** Settlers need food to survive

- [ ] Food consumption system (periodic)
- [ ] Tavern food distribution
- [ ] Starvation effects (work slowdown, death)
- [ ] Population tracking per player
- [ ] House capacity limits
- [ ] Bread production chain

**Milestone:** Settlement survives with working food production, dies without

### Phase 4: Territory & Military Foundation (6-8 weeks)

**Goal:** Basic combat and territory control

- [ ] Territory calculation from military buildings
- [ ] Border visualization
- [ ] Military unit types (swordsman, bowman)
- [ ] Combat stats and resolution
- [ ] Attack/defense commands
- [ ] Unit death and removal
- [ ] Garrison buildings (towers)

**Milestone:** Build tower to claim territory, train soldiers, attack enemy

### Phase 5: AI Opponent (6-8 weeks)

**Goal:** Single-player vs AI

- [ ] AI state machine
- [ ] Economic planning (build order)
- [ ] Resource management
- [ ] Military decision making
- [ ] Difficulty levels
- [ ] Multiple AI personalities

**Milestone:** Complete single-player game vs AI opponent

### Phase 6: Multiplayer (6-8 weeks)

**Goal:** Network play

- [ ] Determinism audit (remove all floats from game logic)
- [ ] Command serialization
- [ ] Lockstep protocol
- [ ] Desync detection
- [ ] Lobby system
- [ ] Reconnection handling

**Milestone:** 2-4 players in multiplayer match

### Phase 7: Polish & Extended Features (Ongoing)

- [ ] Road quality tiers
- [ ] Heavy goods / handcarts
- [ ] Carrier fatigue
- [ ] Food spoilage
- [ ] Mother City connection
- [ ] All building types
- [ ] All unit types
- [ ] Sound effects
- [ ] Save/load
- [ ] Map editor

---

## 10. Success Metrics

### 10.1 Technical Metrics

| Metric | Target |
|--------|--------|
| Frame rate | 60 FPS steady |
| Simulation rate | 30 ticks/sec |
| Entity capacity | 2000+ units |
| Map size support | Up to 512x512 |
| Load time | < 5 seconds |
| Memory usage | < 500MB |

### 10.2 Gameplay Metrics

| Metric | Target |
|--------|--------|
| Carrier utilization | 70-90% during active play |
| Average game length | 30-60 minutes |
| Build options at 5 min | 5+ building types |
| Path efficiency | < 1.2x optimal distance |

### 10.3 Quality Metrics

| Metric | Target |
|--------|--------|
| Unit test coverage | > 80% for systems |
| E2E test coverage | Core user journeys |
| Known bugs | 0 critical, < 5 major |
| Browser support | Chrome, Firefox, Safari, Edge |

---

## 11. Risks & Mitigations

### 11.1 Technical Risks

| Risk | Impact | Mitigation |
|------|--------|------------|
| WebGL performance limits | Unplayable on large maps | LOD system, sprite batching, culling |
| Pathfinding cost | Laggy movement | Hierarchical pathfinding, path caching |
| Multiplayer desync | Broken online play | Strict determinism rules, automated testing |
| Memory leaks | Crashes in long sessions | Profiling, object pooling |

### 11.2 Design Risks

| Risk | Impact | Mitigation |
|------|--------|------------|
| Logistics too complex | Frustrating for new players | Tutorial, good defaults, visual feedback |
| Food system too punishing | Unfun early game | Generous initial supplies, gradual pressure |
| AI too predictable | Boring single-player | Multiple personalities, randomized timing |

### 11.3 Project Risks

| Risk | Impact | Mitigation |
|------|--------|------------|
| Scope creep | Never ships | Strict MVP scope, feature flags |
| Asset licensing | Legal issues | Only use with original game files |
| Contributor burnout | Stalled development | Clear roadmap, achievable milestones |

---

## Appendix: Game Data Reference

### A.1 Material Types

```typescript
enum EMaterialType {
    // Raw
    LOG, STONE, COAL, IRONORE, GOLDORE, GRAIN, PIG, WATER, FISH,
    // Processed
    BOARD, IRONBAR, GOLDBAR, FLOUR, BREAD, MEAT, WINE,
    // Tools
    AXE, PICKAXE, SAW, HAMMER, SCYTHE, ROD,
    // Weapons
    SWORD, BOW, SPEAR, BLADE, BATTLEAXE, ARMOR,
    // Race-specific
    GRAPES, SULFUR, DONKEY, GEMS, AGAVE, BLOWGUN, GOAT, MEAD
}
```

### A.2 Unit Types

| Type | Speed | Combat |
|------|-------|--------|
| Carrier | Fast | No |
| Builder | Medium | No |
| Woodcutter | Medium | No |
| Swordsman L1-L3 | Slow-Medium | Melee |
| Bowman L1-L3 | Medium | Ranged |
| Priest | Slow | Special |
| Thief | Fast | Special |
| Pioneer | Medium | No |

### A.3 Building Categories

**Economy:**
- Tavern, Warehouse, Market

**Production:**
- Woodcutter, Sawmill, Forester
- Stonecutter, Stonemason
- Farm, Mill, Bakery
- Vineyard, Winery
- Hunter, Butcher
- Fisher
- Well

**Mining:**
- Coal Mine, Iron Mine, Gold Mine
- Sulfur Mine, Gem Mine

**Military:**
- Barracks, Archery Range
- Guard Tower, Castle
- Armory, Weaponsmith

**Special:**
- Temple, Shipyard

### A.4 Production Chains

```
Trees → [Woodcutter] → Logs → [Sawmill] → Boards

Grain ← [Farm]
Grain → [Mill] → Flour
Flour + Water → [Bakery] → Bread

Iron Ore ← [Iron Mine]
Coal ← [Coal Mine]
Iron Ore + Coal → [Smelter] → Iron Bars
Iron Bars + Coal → [Weaponsmith] → Swords/Bows
```

### A.5 Settlers 4 File Formats

| Extension | Content |
|-----------|---------|
| .gfx | Graphics archive (sprites) |
| .jil | Job index list (animation indices) |
| .dil | Direction index list |
| .lib | Library archive (various data) |
| .map | Map data (terrain, objects) |
| .sav | Save game state |

---

*This PRD is a living document. Update as implementation reveals better approaches or requirements change.*

---

## 12. Implementation Worker Prompts

### Wave 1: Foundation (3 Parallel Workers)

These three workers can run simultaneously as they create independent subsystems.

---

#### Worker 1A: Carrier Entity & State Management

```
TASK: Implement carrier entity type and state management system

CONTEXT:
- Settlers.ts is a Settlers 4 remake using TypeScript, Vue 3, WebGL
- Read docs/PRD.md for full context (especially sections 5.4 Logistics and 7.1 Carrier System)
- Existing code: src/game/game-state.ts, src/game/entity-types.ts, src/game/systems/movement/

REQUIREMENTS:

1. Create src/game/features/carriers/carrier-state.ts:
   - CarrierState interface: entityId, homeBuilding (tavern), currentJob, fatigue (0-100), carryingMaterial, carryingAmount
   - CarrierJob union type: 'pickup' | 'deliver' | 'return_home' with appropriate data
   - CarrierStatus enum: Idle, Walking, PickingUp, Delivering, Resting

2. Create src/game/features/carriers/carrier-manager.ts:
   - CarrierManager class that tracks all carrier states
   - Methods: createCarrier(entityId, homeBuilding), removeCarrier(entityId), getCarrier(entityId)
   - Method: getCarriersForTavern(tavernId) - returns all carriers assigned to a tavern
   - Method: getAvailableCarriers(tavernId) - returns idle carriers for a tavern
   - Method: assignJob(carrierId, job) - assigns a job to a carrier
   - Method: completeJob(carrierId) - marks job complete, returns to idle

3. Create src/game/features/carriers/index.ts:
   - Barrel export for public API

4. Add unit tests in tests/unit/carriers/carrier-manager.test.ts:
   - Test carrier creation/removal
   - Test job assignment and completion
   - Test querying carriers by tavern

PATTERNS TO FOLLOW:
- Look at src/game/features/building-construction/ for feature module structure
- Use EventBus for inter-system communication (see src/game/event-bus.ts)
- Follow existing naming conventions (camelCase files, PascalCase classes)

DO NOT:
- Implement carrier movement (Worker 1C handles that)
- Implement job assignment algorithm (Wave 2 handles that)
- Touch rendering code
```

---

#### Worker 1B: Building Inventory System

```
TASK: Implement building inventory system for material storage

CONTEXT:
- Settlers.ts is a Settlers 4 remake using TypeScript, Vue 3, WebGL
- Read docs/PRD.md for full context (especially sections 7.1 and 7.2)
- Existing code: src/game/economy/material-type.ts (EMaterialType enum exists)
- Existing code: src/game/economy/building-production.ts (production chains defined)

REQUIREMENTS:

1. Create src/game/features/inventory/inventory-slot.ts:
   - InventorySlot interface: materialType, currentAmount, maxCapacity
   - Helper: createSlot(materialType, maxCapacity)
   - Helper: canAccept(slot, materialType, amount) - checks if slot can receive
   - Helper: canProvide(slot, materialType, amount) - checks if slot has enough
   - Helper: deposit(slot, amount) - adds to slot, returns overflow
   - Helper: withdraw(slot, amount) - removes from slot, returns actual withdrawn

2. Create src/game/features/inventory/building-inventory.ts:
   - BuildingInventory interface: buildingId, inputSlots[], outputSlots[]
   - BuildingInventoryManager class:
     - createInventory(buildingId, buildingType) - creates inventory based on building type
     - getInventory(buildingId)
     - removeInventory(buildingId)
     - getInputSlot(buildingId, materialType)
     - getOutputSlot(buildingId, materialType)
     - depositInput(buildingId, materialType, amount)
     - withdrawOutput(buildingId, materialType, amount)

3. Create src/game/features/inventory/inventory-configs.ts:
   - Define input/output slot configurations per building type
   - Use BUILDING_PRODUCTIONS from economy/building-production.ts as reference
   - Example: Sawmill has input slot for LOG (max 8), output slot for BOARD (max 16)

4. Create src/game/features/inventory/index.ts:
   - Barrel export for public API

5. Add unit tests in tests/unit/inventory/building-inventory.test.ts:
   - Test slot deposit/withdraw logic
   - Test inventory creation for different building types
   - Test material transfer operations

PATTERNS TO FOLLOW:
- Follow src/game/features/ module structure
- Use EMaterialType from economy/material-type.ts
- Reference BuildingType from existing building code

DO NOT:
- Implement carrier pickup/delivery (that's carrier system's job)
- Implement production logic (Wave 2)
- Touch UI/rendering
```

---

#### Worker 1C: Tavern Service Area System

```
TASK: Implement tavern service area configuration and spatial queries

CONTEXT:
- Settlers.ts is a Settlers 4 remake using TypeScript, Vue 3, WebGL
- Read docs/PRD.md for full context (especially section 5.4 on taverns)
- Existing code: src/game/renderer/spatial/entity-grid.ts (spatial indexing exists)
- Existing code: src/game/game-state.ts (entity management)

REQUIREMENTS:

1. Create src/game/features/service-areas/service-area.ts:
   - ServiceArea interface: tavernId, centerX, centerY, radius
   - Default radius constant: DEFAULT_SERVICE_RADIUS = 15 (tiles)

2. Create src/game/features/service-areas/service-area-manager.ts:
   - ServiceAreaManager class:
     - createServiceArea(tavernId, x, y, radius?) - creates area for a tavern
     - removeServiceArea(tavernId)
     - getServiceArea(tavernId)
     - setRadius(tavernId, radius) - adjust service area size
     - setCenter(tavernId, x, y) - adjust service area center (optional offset from tavern)

3. Create src/game/features/service-areas/service-area-queries.ts:
   - getBuildingsInServiceArea(serviceArea, gameState) - returns building IDs within radius
   - getTavernsServingBuilding(buildingX, buildingY, serviceAreaManager, gameState) - returns tavern IDs whose service areas cover this position
   - getNearestTavernForBuilding(buildingX, buildingY, serviceAreaManager, gameState) - returns closest tavern serving this location
   - isPositionInAnyServiceArea(x, y, serviceAreaManager) - checks if position is covered

4. Create src/game/features/service-areas/index.ts:
   - Barrel export for public API

5. Add unit tests in tests/unit/service-areas/service-area-queries.test.ts:
   - Test building inclusion with various radii
   - Test overlapping service areas
   - Test edge cases (building on boundary)
   - Test nearest tavern selection

PATTERNS TO FOLLOW:
- Use hex distance calculation from src/game/systems/hex-directions.ts or coordinates.ts
- Follow feature module patterns from src/game/features/

DO NOT:
- Implement carrier assignment (Wave 2)
- Implement rendering of service areas (separate task)
- Modify existing spatial indexing code
```

---

### Wave 1 Integration Step

```
TASK: Integrate carrier, inventory, and service area systems into game loop

CONTEXT:
- Workers 1A, 1B, 1C have completed their features
- Read their code in src/game/features/carriers/, inventory/, service-areas/
- Read src/game/game-loop.ts for how systems are registered
- Read src/game/game-state.ts for how state is managed

REQUIREMENTS:

1. Update src/game/game-state.ts:
   - Add carrierManager: CarrierManager instance
   - Add inventoryManager: BuildingInventoryManager instance
   - Add serviceAreaManager: ServiceAreaManager instance
   - Initialize in constructor

2. Update src/game/game-loop.ts:
   - Create CarrierSystem (new file src/game/features/carriers/carrier-system.ts)
   - CarrierSystem implements TickSystem interface
   - Register CarrierSystem in GameLoop constructor (after movement, before lumberjack)
   - CarrierSystem.tick() should update carrier fatigue recovery when idle at tavern

3. Wire up building creation:
   - When a tavern is created, auto-create its ServiceArea
   - When a production building is created, auto-create its BuildingInventory
   - Hook into existing onBuildingCreated callback in game-state.ts

4. Wire up entity removal:
   - When a building is removed, clean up its inventory and service area
   - When a carrier unit is removed, clean up its carrier state

5. Add integration test in tests/unit/integration/carrier-inventory-integration.test.ts:
   - Create tavern → service area created
   - Create sawmill → inventory created with correct slots
   - Create carrier at tavern → carrier state created, linked to tavern
   - Remove building → cleanup happens

6. Update src/game/features/index.ts (create if needed):
   - Re-export all feature modules for clean imports

VERIFY:
- Run pnpm test:unit to ensure all tests pass
- Run pnpm build to ensure no type errors
- No circular dependencies (run pnpm analyze:circular)
```

---

### Wave 2: Behavior Logic (3 Parallel Workers)

These workers implement the logic that uses Wave 1's data structures.

---

#### Worker 2A: Resource Request & Fulfillment System

```
TASK: Implement system for buildings to request materials and match with available supply

CONTEXT:
- Wave 1 integration is complete
- Read src/game/features/inventory/ for building inventories
- Read src/game/features/service-areas/ for tavern coverage
- Read docs/PRD.md section 7.2 Production System

REQUIREMENTS:

1. Create src/game/features/logistics/resource-request.ts:
   - ResourceRequest interface: id, buildingId, materialType, amount, priority (High/Normal/Low), timestamp
   - RequestPriority enum: High = 0, Normal = 1, Low = 2

2. Create src/game/features/logistics/resource-supply.ts:
   - ResourceSupply interface: buildingId, materialType, availableAmount
   - Helper: getAvailableSupplies(gameState, materialType, withinServiceArea?) - finds buildings with material in output slots

3. Create src/game/features/logistics/request-manager.ts:
   - RequestManager class:
     - addRequest(request) - queues a resource request
     - removeRequest(requestId) - cancels a request
     - getRequestsForBuilding(buildingId) - returns pending requests
     - getPendingRequests() - returns all requests sorted by priority then timestamp
     - fulfillRequest(requestId, sourceBuilding, carrier) - marks request as being fulfilled

4. Create src/game/features/logistics/fulfillment-matcher.ts:
   - matchRequestToSupply(request, gameState, serviceAreaManager):
     - Find buildings with the requested material in their output slots
     - Filter to buildings within same service area network (reachable via taverns)
     - Return best match: { sourceBuilding, amount, distance }
   - Prioritize: nearest source with sufficient quantity

5. Create src/game/features/logistics/index.ts:
   - Barrel export

6. Add unit tests in tests/unit/logistics/fulfillment-matcher.test.ts:
   - Test matching within service area
   - Test priority ordering
   - Test no match when material unavailable
   - Test choosing nearest source

PATTERNS TO FOLLOW:
- Use EMaterialType from economy/
- Use distance calculations from coordinates.ts

DO NOT:
- Implement carrier movement (Worker 2C)
- Implement production triggering (separate concern)
- Touch UI code
```

---

#### Worker 2B: Carrier Job Assignment Algorithm

```
TASK: Implement algorithm that assigns delivery jobs to available carriers

CONTEXT:
- Wave 1 integration is complete
- Read src/game/features/carriers/ for carrier state
- Read src/game/features/logistics/ (Worker 2A) for request system
- Read docs/PRD.md section 5.4 on carrier assignment

REQUIREMENTS:

1. Create src/game/features/carriers/job-assignment.ts:
   - CarrierJobAssigner class:
     - Constructor takes: carrierManager, requestManager, serviceAreaManager, gameState
     - assignJobs() - main method called each tick to assign pending requests to idle carriers

   - Assignment algorithm:
     1. Get all pending requests sorted by priority
     2. For each request:
        a. Find taverns whose service area covers BOTH source and destination buildings
        b. Get available (idle) carriers from those taverns
        c. Pick carrier closest to source building
        d. Create pickup job for carrier
        e. Mark request as being fulfilled
     3. Return number of jobs assigned

2. Create src/game/features/carriers/job-completion.ts:
   - handleJobCompletion(carrier, carrierManager, inventoryManager):
     - For 'pickup' job: transfer material from building to carrier, create 'deliver' job
     - For 'deliver' job: transfer material from carrier to building, create 'return_home' or go idle
     - For 'return_home': set carrier to idle when arrived at tavern

3. Update src/game/features/carriers/carrier-system.ts:
   - Inject CarrierJobAssigner
   - In tick(): call assigner.assignJobs()
   - Listen for 'carrier:arrived' events to trigger job completion

4. Add events to carrier system:
   - Emit 'carrier:job_started' when job assigned
   - Emit 'carrier:job_completed' when job finishes
   - Emit 'carrier:pickup_complete' when material picked up
   - Emit 'carrier:delivery_complete' when material delivered

5. Add unit tests in tests/unit/carriers/job-assignment.test.ts:
   - Test assigning job to nearest carrier
   - Test respecting service area boundaries
   - Test priority ordering
   - Test no assignment when no carriers available
   - Test job completion state transitions

PATTERNS TO FOLLOW:
- Use EventBus for events
- Look at movement system for 'unit:arrived' event pattern

DO NOT:
- Implement carrier pathfinding/movement (Worker 2C)
- Implement UI for job status
```

---

#### Worker 2C: Carrier Movement & Animation Integration

```
TASK: Implement carrier movement behavior and carrying animation states

CONTEXT:
- Wave 1 integration is complete
- Read src/game/systems/movement/ for existing movement system
- Read src/game/systems/animation.ts for animation system
- Read src/game/features/carriers/ for carrier state

REQUIREMENTS:

1. Create src/game/features/carriers/carrier-movement.ts:
   - CarrierMovementController class:
     - startPickupMovement(carrierId, targetBuildingId, gameState):
       - Get target building position
       - Find approach position (adjacent walkable tile)
       - Issue movement command to carrier entity
       - Set carrier status to Walking

     - startDeliveryMovement(carrierId, targetBuildingId, gameState):
       - Same pattern for delivery destination

     - startReturnMovement(carrierId, gameState):
       - Move carrier back to home tavern

2. Create src/game/features/carriers/carrier-animation.ts:
   - CarrierAnimationController class:
     - setCarryingAnimation(entityId, materialType, gameState):
       - Switch entity to "carrying" animation variant
       - Store carried material for visual (sprite holding item)

     - clearCarryingAnimation(entityId, gameState):
       - Switch back to normal walk animation

     - playPickupAnimation(entityId, gameState):
       - Trigger pickup motion (bend down, grab)

     - playDropAnimation(entityId, gameState):
       - Trigger drop motion

3. Update carrier-system.ts:
   - Inject CarrierMovementController
   - When job assigned: start appropriate movement
   - Listen for 'unit:arrived' events:
     - If carrier arrived at pickup location: trigger pickup animation, then complete pickup
     - If carrier arrived at delivery location: trigger drop animation, then complete delivery
     - If carrier arrived at tavern: set to idle/resting

4. Add animation delay handling:
   - Pickup/drop animations take time (e.g., 500ms)
   - Use timer or animation completion event before state transition

5. Add unit tests in tests/unit/carriers/carrier-movement.test.ts:
   - Test movement command issued to correct position
   - Test arrival handling for different job types
   - Test animation state transitions

INTEGRATION NOTES:
- Movement system already handles pathfinding and walking
- You're issuing commands TO movement system, not implementing movement
- Animation system already handles sprite animation
- You're setting animation STATE, system handles frames

DO NOT:
- Modify core movement system code
- Implement new pathfinding logic
- Create new sprite rendering code
```

---

### Wave 2 Integration Step

```
TASK: Final integration and end-to-end testing of carrier logistics system

CONTEXT:
- All Wave 1 and Wave 2 workers complete
- Full carrier system should now be functional

REQUIREMENTS:

1. Create integration test: tests/e2e/carrier-logistics.spec.ts
   - Test scenario:
     1. Load test map with tavern, woodcutter, warehouse placed
     2. Spawn carrier at tavern
     3. Wait for woodcutter to produce logs (or manually add to output)
     4. Verify carrier picks up logs from woodcutter
     5. Verify carrier delivers logs to warehouse
     6. Verify carrier returns to tavern

2. Create debug visualization (optional but helpful):
   - In debug panel, show:
     - Active carrier jobs
     - Pending resource requests
     - Service area indicators (when debug layer enabled)

3. Verify all event chains work:
   - Building produces → output slot filled
   - Warehouse requests material → request created
   - Request matched to source → job assigned
   - Carrier walks to source → pickup
   - Carrier walks to destination → delivery
   - Carrier returns or gets new job

4. Performance check:
   - Test with 20+ carriers, 50+ buildings
   - Ensure no frame drops during job assignment

5. Update docs/PRD.md:
   - Mark carrier system features as complete
   - Note any deviations from original spec
   - Document any new events/APIs

6. Create CHANGELOG entry for the carrier logistics milestone

RUN FULL TEST SUITE:
- pnpm test:unit
- pnpm build && npx playwright test
- Manual playtest in browser

KNOWN ISSUES TO DOCUMENT:
- Any edge cases discovered
- Performance observations
- Suggested follow-up improvements
```
