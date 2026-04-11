# System Design Rules

Architectural rules and conventions for Settlers.ts. These rules ensure consistency, maintainability, and extensibility as the codebase grows.

**Related docs:**
- `coding-style.md` — TypeScript patterns (error handling, async/await)
- `optimistic.md` — **CRITICAL** optimistic programming rules
- `architecture/feature-modules.md` — Feature module structure and patterns
- `testing/guide.md` — Testing guidelines

---

## Table of Contents

1. [Layer Architecture](#1-layer-architecture)
2. [Feature Module Rules](#2-feature-module-rules)
3. [Event Bus Rules](#3-event-bus-rules)
4. [System & Manager Rules](#4-system--manager-rules)
5. [State Management Rules](#5-state-management-rules)
6. [Query & Mutation Rules](#6-query--mutation-rules)
7. [Code Organization Rules](#7-code-organization-rules)
8. [Determinism Rules](#8-determinism-rules)
9. [Avoiding Over-Engineering](#9-avoiding-over-engineering)
10. [Error Handling Rules](#10-error-handling-rules)
11. [Testing Rules](#11-testing-rules)
12. [Naming Conventions](#12-naming-conventions)

---

## 1. Layer Architecture

### Rule 1.1: Dependency Direction Must Flow Downward

```
Layer 0 (Pure Data):     coordinates, buildings/types, unit-types, economy/types
Layer 1 (Algorithms):    pathfinding, ai, hex-directions, movement math
Layer 2 (Infra):         movement, entity-cleanup-registry, spatial-search     ← systems/ directory
Layer 3 (State):         game-state, event-bus
Layer 4 (Domain):        building-construction, placement, carriers, logistics  ← features/ directory
Layer 5 (Orchestration): game-loop, commands, game-services
Layer 6 (I/O):           renderer, input, audio
Layer 7 (Glue):          game.ts, Vue views/composables
```

**Rule:** A module may only import from its own layer or lower layers. Never upward.

**Why:** Upward imports create cycles and make lower-level modules impossible to test or reuse in isolation.

**Enforcement:** Configure dependency-cruiser with layer rules.

### Rule 1.2: Pure Algorithm Modules Have Zero Game Imports

Modules in Layer 1 (`pathfinding/`, `ai/behavior-tree/`, `coordinates/`) must not import from game-specific modules.

**Why:** These can be extracted as standalone libraries and are easier to test.

---

## 2. Feature Module Rules

### Rule 2.0: Features vs Systems — Classification by Dependency Direction

`systems/` and `features/` represent distinct architectural layers. The dividing line is **dependency direction**, not file count or complexity.

| Location | Role | Dependency rule | Examples |
|----------|------|-----------------|---------|
| `systems/` | Kernel infrastructure | May be imported by features; must **never** import from `features/` | `movement`, `pathfinding`, `entity-cleanup-registry`, `spatial-search` |
| `features/` | Domain modules | May import from `systems/`; participate in `FeatureRegistry` | `carriers`, `logistics`, `building-construction`, `trees`, `crops` |

**The test:** If a module in `systems/` imports anything from `features/`, it is misclassified — move it to `features/`.

**The enforcing question:** Can any feature import it without creating a cycle?
- Yes, and it imports nothing from `features/` → belongs in `systems/`
- Depends on a feature → belongs in `features/`

**Why this matters:** Systems are foundational infrastructure. Features are built on top of systems. If a "system" imports a feature, then every consumer of that system gains an implicit dependency on that feature — a coupling that destroys composability and testability.

**Note:** Complexity and file count are signals, not the rule. A multi-file module with its own registry belongs in `systems/` if it has zero feature dependencies. A 2-file module belongs in `features/` if it depends on inventory or carriers.

### Rule 2.1: Single Entry Point

All external code imports only from `index.ts`:

```typescript
// GOOD
import { BuildingConstructionSystem } from '@/game/features/building-construction';

// BAD
import { applyTerrainLeveling } from '@/game/features/building-construction/internal/terrain';
```

### Rule 2.2: No Imports From `internal/`

The `internal/` directory of a feature module must never be imported by external code. If something from `internal/` is needed externally, promote it to the public API in `index.ts` with a proper abstraction.

**Enforcement:** Add dependency-cruiser rule: `features/*/internal/** → only importable by features/*/`

### Rule 2.3: Registration Over Import

Core systems provide registration points; features register themselves:

```typescript
// GOOD — feature registers with core
gameLoop.registerSystem(constructionSystem);
eventBus.on('building:removed', handleBuildingRemoved);

// BAD — core imports and calls feature directly
import { updateBuildingConstruction } from './buildings/construction';
updateBuildingConstruction(state, dt, ctx);
```

### Rule 2.4: Module Documentation Header

Every feature module's `index.ts` MUST have a JSDoc comment listing the public API:

```typescript
/**
 * Carrier Feature Module
 *
 * Self-contained module for carrier state management, job execution, and behavior.
 *
 * Public API:
 * - Types: CarrierState, CarrierJob, CarrierStatus, FatigueLevel
 * - Manager: CarrierManager (tracks all carrier states)
 * - System: CarrierSystem (tick system for carrier behavior)
 */
```

### Rule 2.5: Feature-Specific Types Stay in Features

Types that only one feature uses MUST NOT be exported from `entity.ts` or core modules:

```typescript
// GOOD — feature owns its types
import { BuildingState } from '@/game/features/building-construction';

// BAD — core re-exports feature types
import { BuildingState } from '@/game/entity';
```

**Why:** Prevents core from depending on features, maintains clean layer boundaries.

---

## 3. Event Bus Rules

### Rule 3.1: EventBus Is Required, Not Optional

`EventBus` must be a required parameter in `CommandContext`, not optional:

```typescript
// GOOD
interface CommandContext {
    eventBus: EventBus;
}

// BAD — silent failures possible
interface CommandContext {
    eventBus?: EventBus;
}
```

**Why:** If a feature depends on an event to maintain correctness, the event must always fire.

### Rule 3.2: Event Naming Convention

Events use `"<domain>:<past-tense-verb>"` format:

```typescript
'building:placed'      // not 'buildingPlaced' or 'place_building'
'unit:spawned'
'carrier:jobAssigned'
'terrain:modified'
```

### Rule 3.3: Events Must Include Sufficient Context

Event payloads should include enough data for handlers to act **without querying back**:

```typescript
// GOOD — handler has everything needed
'building:completed': {
    entityId: number;
    buildingState: BuildingState;  // includes type, position, etc.
}

// BAD — handler must query GameState for building data
'building:completed': {
    entityId: number;
}
```

**Why:** Reduces coupling; handlers don't need to import from the emitter's module.

### Rule 3.4: Events Are Fire-and-Forget

Events carry notifications about things that already happened. They must not return values or modify the payload:

```typescript
// Event (notification, no return value)
eventBus.emit('building:placed', { entityId, buildingType, x, y, player });

// Query (synchronous data lookup) — use direct import instead
const visual = getBuildingVisualState(entityId, buildingStates);
```

### Rule 3.5: Event Payload Immutability

Event payloads are **read-only**. Handlers must not mutate them:

```typescript
eventBus.on('building:placed', (payload) => {
    // BAD
    payload.x = 10;

    // GOOD — copy if you need to modify
    const modified = { ...payload, x: 10 };
});
```

### Rule 3.6: Adding New Events

1. Add the event signature to `GameEvents` interface in `event-bus.ts`
2. Emit from the appropriate command or system
3. Subscribe from the feature module's `registerEvents()` method
4. Add a unit test verifying the event fires with correct payload

---

## 4. System & Manager Rules

### Rule 4.1: Manager vs System Distinction

| Class type | Responsibility | Has tick()? | Owns state? |
|------------|----------------|-------------|-------------|
| `*Manager` | State container + CRUD | No | Yes |
| `*System` | Per-frame behavior | Yes | No (queries Manager) |

**Examples:**
- `CarrierManager` owns carrier states, `CarrierSystem` ticks behavior
- `BuildingInventoryManager` owns inventories, systems query it

### Rule 4.2: All Per-Frame Updates Use TickSystem

Every per-frame update must go through `GameLoop.registerSystem()`:

```typescript
// GOOD — all systems registered
private tick(dt: number): void {
    for (const system of this.systems) {
        system.tick(dt);
    }
}

// BAD — mixed patterns
private tick(dt: number): void {
    this.gameState.movement.update(dt);      // direct call
    updateIdleBehavior(this.gameState, dt);  // free function
    for (const system of this.systems) {     // registered
        system.tick(dt);
    }
}
```

### Rule 4.3: System Lifecycle Protocol

Systems that use events MUST implement cleanup:

```typescript
class FooSystem implements TickSystem {
    private eventBus: EventBus | null = null;
    private handlers: Array<() => void> = [];

    registerEvents(eventBus: EventBus): void {
        this.eventBus = eventBus;
        // Store handler references for cleanup
        const handler = (payload) => this.handleEvent(payload);
        eventBus.on('some:event', handler);
        this.handlers.push(() => eventBus.off('some:event', handler));
    }

    unregisterEvents(): void {
        this.handlers.forEach(cleanup => cleanup());
        this.handlers = [];
        this.eventBus = null;
    }

    tick(dt: number): void { /* ... */ }
}
```

### Rule 4.4: Config Object Pattern

Systems with 3+ constructor dependencies MUST accept a single `*Config` interface:

```typescript
// GOOD
export interface CarrierSystemConfig {
    carrierManager: CarrierManager;
    inventoryManager: BuildingInventoryManager;
    gameState: GameState;
}

constructor(config: CarrierSystemConfig) {
    this.carrierManager = config.carrierManager;
    // ...
}

// BAD — positional parameters
constructor(
    carrierManager: CarrierManager,
    inventoryManager: BuildingInventoryManager,
    gameState: GameState,
) { }
```

**Why:** Named parameters are self-documenting and order-independent.

---

## 5. State Management Rules

### Rule 5.1: Feature Modules Own Their State

Feature-specific state should live inside the feature module, not in `GameState`:

```typescript
// GOOD — feature owns its state
class BuildingConstructionSystem {
    public readonly buildingStates = new Map<number, BuildingState>();
}

// BAD — GameState accumulates feature state
interface GameState {
    buildingStates: Map<number, BuildingState>;  // Feature-specific!
    resourceStates: Map<number, ResourceState>;  // Feature-specific!
}
```

`GameState` should hold only truly shared data: entities, tile occupancy, selection.

### Rule 5.2: State Flow Direction

```
Command execution → state update + event emission
        ↓
Event emission → feature handlers react (may modify feature state)
        ↓
TickSystem.tick() → per-frame simulation updates
        ↓
Renderer queries → read-only access for rendering
```

### Rule 5.3: Query Functions Return Immutable Data

Query functions should return readonly types to prevent accidental mutations:

```typescript
// GOOD
getBuildingVisualState(entityId: number): Readonly<BuildingVisualState>
getEntities(): ReadonlyArray<Entity>

// BAD — caller could mutate internal state
getBuildingState(entityId: number): BuildingState
```

---

## 6. Query & Mutation Rules

### Rule 6.0: Use EntityIndex.query() for Entity Searches — CRITICAL

**Never iterate `gameState.entities` (the full entity list) to find entities by type, player, or subType.** Use `gameState.entityIndex.query()` which selects the narrowest index automatically.

```typescript
// BAD — full scan of all entities
for (const entity of gameState.entities) {
    if (entity.type === EntityType.Building && entity.player === player && entity.subType === BuildingType.Woodcutter) {
        count++;
    }
}

// GOOD — indexed lookup, chainable
const count = gameState.entityIndex.query(EntityType.Building, player, BuildingType.Woodcutter).count();
```

**EntityIndex maintains three index levels:**

| Method | Index used | When to use |
|--------|-----------|-------------|
| `query(type)` | `byType` | All buildings, all units |
| `query(type, player)` | `byTypePlayer` | Player 1's buildings |
| `query(type, player, subType)` | `byTypePlayerSubType` | Player 1's Woodcutter buildings |

**EntityQuery chainable operations:**

| Chain | Terminal | Example |
|-------|----------|---------|
| `.filter(predicate)` | | Additional predicate filter |
| `.inRadius(center, radius)` | | Spatial proximity filter |
| | `.count()` | Count matching entities |
| | `.toArray()` | Collect into array |
| | `.first()` | First match or undefined |
| | `.some()` | Existence check |
| | `.nearest(center)` | Closest entity |
| | `.forEach(cb)` | Iterate with callback |
| | `for (const e of query)` | Iterable protocol |

**Common patterns:**

```typescript
// Count operational buildings of a type
entityIndex.query(EntityType.Building, player, BuildingType.Sawmill)
    .filter(e => e.operational)
    .count()

// Find nearest enemy tower
entityIndex.query(EntityType.Building)
    .filter(e => e.player !== myPlayer && TERRITORY_BUILDINGS.has(e.subType as BuildingType))
    .nearest(myPosition)

// Check if any unit exists in area
entityIndex.query(EntityType.Unit, player, UnitType.Swordsman)
    .inRadius(center, 20)
    .some()
```

**When `gameState.entities` is still OK:**
- Queries that genuinely need ALL entity types simultaneously (e.g., `getEntitiesInRadius` which returns buildings, units, map objects together)
- Snapshot/serialization code that processes every entity

### Rule 6.0b: Use Typed Entity Accessors for Single-Entity Lookups

When getting a single entity by ID and checking its type, use the typed accessors from `entity.ts` instead of manual `getEntity` + type guard:

```typescript
import { getEntityOfType, getEntityIfType } from '@/game/entity';

// BAD — manual get + type guard
const entity = gameState.getEntityOrThrow(id, 'siege target');
if (entity.type !== EntityType.Building) {
    throw new Error(`Entity ${id} is not a building`);
}

// GOOD — throws with context if wrong type
const building = getEntityOfType(gameState, id, EntityType.Building, 'siege target');

// BAD — manual get + soft check
const entity = gameState.getEntity(id);
if (!entity || entity.type !== EntityType.Unit) {
    return;
}

// GOOD — returns undefined if missing or wrong type
const unit = getEntityIfType(gameState, id, EntityType.Unit);
if (!unit) return;
```

| Function | Returns | Use when |
|----------|---------|----------|
| `getEntityOfType(provider, id, type, ctx?)` | `Entity` (throws) | Entity MUST exist and MUST be the right type |
| `getEntityIfType(provider, id, type)` | `Entity \| undefined` | Entity might not exist or might be wrong type |

Both accept any `EntityProvider` (GameState, or any interface with `getEntity`/`getEntityOrThrow`).

### Rule 6.1: No Side Effects in Queries

Functions starting with `get*`, `find*`, `has*`, `is*`, `can*` MUST be pure:

```typescript
// GOOD — pure query
function canAcceptNewJob(state: CarrierState): boolean {
    return state.status === CarrierStatus.Idle && state.fatigue < 100;
}

// BAD — query with side effect
function getVisualState(id: number): VisualState {
    debugStats.queryCount++;  // NO!
    return computeVisualState(id);
}
```

### Rule 6.2: All Mutations Through Commands

All game state mutations go through `executeCommand()`:

```typescript
// GOOD — command pipeline
game.execute({ type: 'place_building', buildingType, x, y, player });

// BAD — direct state mutation
gameState.addEntity(EntityType.Building, buildingType, x, y, player);
```

**Why:** Enables replay, undo, and networked multiplayer.

### Rule 6.3: Renderer Query Interface

The renderer should receive data through a `RenderContext` interface:

```typescript
interface RenderContext {
    entities: ReadonlyArray<Entity>;
    unitStates: UnitStateLookup;
    buildingVisualState(entityId: number): BuildingVisualState;
    placementStatus(x: number, y: number, type: PlacementEntityType): PlacementStatus;
    animationData: AnimationDataProvider;
    camera: IViewPoint;
}
```

**Why:** Reduces renderer imports from 10+ modules to 1 interface. Enables testing with mocks.

---

## 7. Code Organization Rules

### Rule 7.1: Every Public Module Has a Barrel File

Every directory under `src/game/` that is imported by other modules must have an `index.ts` that defines its public API.

**Missing barrels to add:** `renderer/`, `audio/`, `commands/`, `economy/`, `ai/`, `systems/` (root level).

### Rule 7.2: File Naming Conventions

| File type | Pattern | Example |
|-----------|---------|---------|
| TickSystem | `*-system.ts` | `carrier-system.ts` |
| State manager | `*-manager.ts` | `carrier-manager.ts` |
| Types only | `types.ts` | `features/carriers/types.ts` |
| Public API | `index.ts` | `features/carriers/index.ts` |
| Internal impl | `internal/*.ts` | `internal/phase-transitions.ts` |

### Rule 7.3: Test Helper Organization

Test helpers MUST live in `helpers/` directories:

```
tests/
  unit/
    helpers/
      test-game.ts      # GameState factories
      test-map.ts       # Map fixtures
    *.spec.ts           # Test files
  e2e/
    game-page.ts        # Page object
    matchers.ts         # Custom matchers
    fixtures.ts         # Shared fixtures
    *.spec.ts           # Test files
```

### Rule 7.4: Constants Over Magic Numbers

Game-balance values MUST be named constants:

```typescript
// GOOD
const CARRIER_FATIGUE_RECOVERY_RATE = 5;  // per second
carrier.fatigue = Math.max(0, carrier.fatigue - CARRIER_FATIGUE_RECOVERY_RATE * dt);

// BAD
carrier.fatigue = Math.max(0, carrier.fatigue - 5 * dt);
```

**Where to put constants:**
- Feature-specific: In the feature module (exported if needed by other features)
- Game-wide: In a dedicated `constants.ts` or `game-settings.ts`

---

## 8. Determinism Rules

### Rule 8.1: No Floats in Game Logic

Use fixed-point math for positions and calculations that affect game state:

```typescript
// GOOD — fixed-point with TILE_SCALE = 256
const TILE_SCALE = 256;
position.x = Math.floor(worldX * TILE_SCALE);

// BAD — floating point accumulates errors
position.x = worldX;  // 10.333333...
```

### Rule 8.2: Deterministic Iteration Order

Collections that affect game state MUST be iterated in consistent order:

```typescript
// GOOD — process in entity ID order for determinism
const sortedIds = [...buildingStates.keys()].sort((a, b) => a - b);
for (const id of sortedIds) {
    updateBuilding(id);
}

// BAD — Map iteration order depends on insertion order
for (const [id, state] of buildingStates) {
    updateBuilding(id);
}
```

**Why:** Multiplayer/replay determinism requires identical execution order across clients.

### Rule 8.3: No Random Without Seeded RNG

Game logic must use seeded random number generators:

```typescript
// GOOD — deterministic
const rng = createSeededRNG(gameSeed);
const value = rng.next();

// BAD — non-deterministic
const value = Math.random();
```

---

## 9. Avoiding Over-Engineering

**CRITICAL — see `docs/optimistic.md` for the full optimistic programming rules. Violations are treated as bugs.**

### Rule 9.1: Delete Rather Than Deprecate

When removing functionality, delete the code. Don't leave "just in case" fallbacks.

**Git preserves history.** If you need old code back, use `git log` or `git blame`.

---

## 10. Error Handling Rules

See `docs/optimistic.md` for error handling and throwing rules. This section covers game-specific rules.

### Rule 10.1: TickSystems Must Not Throw

TickSystems MUST catch and log errors, not crash the game loop:

```typescript
tick(dt: number): void {
    for (const [id, state] of this.states) {
        try {
            this.updateEntity(id, state, dt);
        } catch (e) {
            log.error(`Failed to update entity ${id}`, e);
        }
    }
}
```

**Why:** One bad entity shouldn't crash the entire game.

### Rule 10.2: Commands Return Success/Failure

Commands return `boolean` for success/failure, not exceptions:

```typescript
function executeCommand(ctx: CommandContext, cmd: Command): boolean {
    if (!canExecute(cmd)) {
        return false;  // Not an error, just invalid command
    }
    // ...
    return true;
}
```

---

## 11. Testing Rules

### Rule 11.1: Test Through Public APIs

Tests should use the same code paths a player would:

1. **UI interaction** — click buttons, hover canvas
2. **Game commands** — `game.execute({ type: 'place_building', ... })`
3. **Public API methods** — `viewPoint.setPosition()`
4. **Debug bridge reads** — `__settlers_debug__.entityCount`

**Never:**
- Set private properties directly
- Access private members via `(obj as any).privateField`
- Skip the command pipeline for entity creation

### Rule 11.2: Unit vs E2E Boundary

| Test type | Purpose | Examples |
|-----------|---------|----------|
| Unit | Pure functions, algorithms, state machines | pathfinding, placement validation, coordinate transforms |
| E2E | UI flows, rendering, canvas interactions | click button → mode changes → building appears |

If a test only calls `game.execute()` and checks state without UI interaction, it should be a unit test.

### Rule 11.3: Deterministic Waiting

Never use `waitForTimeout()`. Use deterministic waiting:

```typescript
// GOOD
await gp.waitForFrames(5);
await gp.waitForUnitCount(1);
await gp.waitForUnitsMoving(1);

// BAD
await page.waitForTimeout(500);
```

### Rule 11.4: Test Both Odd and Even Y Rows

Hex coordinate math differs for odd/even Y rows. Always test both:

```typescript
it('should work for both odd and even Y rows', () => {
    expect(hexFunction(10, 10)).toBe(expected);  // even Y
    expect(hexFunction(10, 11)).toBe(expected);  // odd Y
});
```

---

## 12. Naming Conventions

### Rule 12.1: Match Settlers 4 XML Names

Use names from the original game's XML data files:

**Units:**
- `Carrier` (not Bearer) — `SETTLER_CARRIER`
- `Woodcutter` (not Lumberjack) — `SETTLER_WOODCUTTER`
- `Swordsman`, `Bowman` with level property (not `SwordsmanL1`)

**Buildings:**
- `WoodcutterHut` (not LumberjackHut) — `BUILDING_WOODCUTTER`
- `StorageArea` (not Warehouse) — `BUILDING_STORAGE_AREA`
- `GrainFarm` (not Farm) — `BUILDING_GRAIN_FARM`
- `ResidenceSmall/Medium/Big` (not SmallHouse)

**Materials:**
- `LOG` (not TRUNK), `BOARD` (not PLANK)
- `GRAIN` (not CROP), `IRONBAR` (not IRON)

### Rule 12.2: Event Domain Prefixes

Use consistent domain prefixes for events:

| Domain | Examples |
|--------|----------|
| `building:` | `placed`, `completed`, `removed` |
| `unit:` | `spawned`, `died`, `movementStarted` |
| `carrier:` | `jobAssigned`, `arrivedForPickup` |
| `terrain:` | `modified` |
| `selection:` | `changed` |

### Rule 12.3: Boolean Function Prefixes

| Prefix | Returns | Example |
|--------|---------|---------|
| `is*` | `boolean` | `isPassable(tile)` |
| `has*` | `boolean` | `hasInventory(buildingType)` |
| `can*` | `boolean` | `canAcceptNewJob(carrier)` |
| `get*` | value or `undefined` | `getEntity(id)` |
| `find*` | value or `null` | `findNearestBuilding()` |

### Rule 12.4: Race Is Never a Fallback — CRITICAL

**NEVER use a hardcoded race (e.g. `Race.Roman`) as a default or fallback value.**

Every code path that depends on race must receive it explicitly. If race is unknown at a call site, that is a bug in the caller — fix the caller, not the callee.

```typescript
// BAD — silently hides the bug, Roman assets appear for wrong race
function getSettlerSprite(race?: Race): SpriteIndex {
    const r = race ?? Race.Roman;  // NEVER
    return sprites[r];
}

// BAD — optional race that defaults to a specific race
function loadUnitSprites(unitType: UnitType, race = Race.Roman) { ... }  // NEVER

// GOOD — race is required; caller must supply it
function getSettlerSprite(race: Race): SpriteIndex {
    return sprites[race];
}
```

**Why:** Fallback races silently show wrong assets for other races (Vikings, Mayans, etc.). The error is invisible in testing if you only play as Romans.

### Rule 12.5: Race Parameters Are Never Optional

If a function, class, or data structure needs race, race is a **required** parameter. Do not make it optional with `?` or give it a default.

```typescript
// BAD
interface SpriteLoaderConfig {
    race?: Race;  // NEVER — callers will forget to set it
}

// BAD
class SpriteLoader {
    constructor(private race: Race = Race.Roman) { ... }  // NEVER
}

// GOOD
interface SpriteLoaderConfig {
    race: Race;  // required — every caller must be explicit
}

// GOOD
class SpriteLoader {
    constructor(private race: Race) { ... }
}
```

**Enforcement:** If TypeScript requires a default because the value is not available at construction time, that is a design smell — restructure to pass race at the point where it is known, or carry it through the call chain explicitly.

---

## Enforcement Summary

| Rule Category | Enforcement Method |
|---------------|-------------------|
| Layer dependencies | dependency-cruiser rules |
| Internal imports | dependency-cruiser forbidden paths |
| Config object pattern | ESLint max-params rule |
| Barrel files | Code review checklist |
| JSDoc headers | Code review checklist |
| Deterministic iteration | grep for unordered Map iteration |
| Query immutability | TypeScript `Readonly<T>` return types |
| Test patterns | Code review + `testing/guide.md` |
| Race fallbacks | grep for `Race.Roman` as default/fallback; ESLint no-param-defaults for race |

---

## Quick Reference Checklist

When adding a new feature:

- [ ] Create `features/<name>/` directory with `index.ts`
- [ ] Add JSDoc header listing public API
- [ ] Put private implementation in `internal/`
- [ ] Create `*System` if per-frame updates needed
- [ ] Create `*Manager` if state container needed
- [ ] Use `*Config` interface for 3+ dependencies
- [ ] Register with GameLoop via `registerSystem()`
- [ ] Subscribe to events via `registerEvents()`
- [ ] Implement `unregisterEvents()` for cleanup
- [ ] Add events to `GameEvents` interface
- [ ] Export only public API from `index.ts`
- [ ] Write unit tests for algorithms
- [ ] Write e2e tests for UI integration
- [ ] Race is **required** (not optional, no default) wherever it's needed — no `Race.Roman` fallbacks
