# Modularity & Architecture Review

An audit of the project's module boundaries, event bus usage, inter-module communication, and proposed invariants for keeping the architecture clean as the codebase grows.

---

## 1. Current Architecture Assessment

### Dependency Graph (simplified)

```
              ┌─────────┐
              │  Game    │  (orchestrator)
              └────┬────┘
         ┌─────────┼──────────┐
         ▼         ▼          ▼
     GameLoop   Commands   EventBus
         │         │          │
         ▼         ▼          ▼
   ┌──────────────────────────────────┐
   │       Feature Modules            │
   │  building-construction           │
   │  placement                       │
   └──────────────────────────────────┘
         │              │
         ▼              ▼
   ┌──────────┐  ┌──────────────┐
   │ Systems  │  │  Renderer    │
   │ movement │  │ entity-rdr   │
   │ pathfind │  │ landscape    │
   │ animation│  │ indicators   │
   │ idle     │  │ spatial      │
   └──────────┘  └──────────────┘
         │
         ▼
   ┌──────────────┐
   │ Pure Data    │
   │ entity.ts    │
   │ buildings/   │
   │ economy/     │
   │ coordinates  │
   └──────────────┘
```

### What's Working Well

**1. Feature modules are genuinely self-contained.** `building-construction/` and `placement/` follow the documented pattern: single `index.ts` entry point, `internal/` for private logic, event-based registration. This is the gold standard for the project.

**2. No circular dependencies.** The dependency graph is acyclic. Lower layers (pathfinding, coordinates, buildings) import nothing from upper layers. Events break what would otherwise be cycles between commands and features.

**3. Event bus is typed.** `GameEvents` interface gives compile-time safety — you can't emit a `building:placed` event with the wrong payload shape. The `"domain:action"` naming convention is consistent and readable.

**4. Pure algorithm modules are fully isolated.** `pathfinding/`, `ai/behavior-tree`, and `coordinates` have zero game-specific imports. They could be extracted into standalone libraries.

**5. Command pattern centralizes mutations.** All state changes go through `executeCommand()`, which makes it straightforward to add replay, undo, or networked multiplayer later.

---

## 2. Identified Issues

### Issue A: GameState is a God Object

`GameState` (game-state.ts:89) owns entities, building states, resource states, selection state, tile occupancy, movement system, and lumberjack system. It directly imports `BuildingState`, `BuildingConstructionPhase`, and `StackedResourceState` from feature modules.

This violates the feature-module-architecture.md recommendation:

> Core systems should NOT know about feature types. Features should manage their own state.

**Consequence:** Every new feature that needs per-entity state must modify `GameState`, creating a merge bottleneck and coupling core to features.

### Issue B: GameLoop Has Mixed Abstraction Levels

`GameLoop.tick()` (game-loop.ts:189-213) mixes three different patterns:

```typescript
// Pattern 1: Direct method call (movement is special-cased)
this.gameState.movement.update(dt);

// Pattern 2: Free function call
updateIdleBehavior(this.gameState, dt);

// Pattern 3: Generic TickSystem dispatch
for (const system of this.systems) {
    system.tick(dt);
}

// Pattern 4: Another special-cased direct call
this.gameState.lumberjackSystem.update(this.gameState, dt);
```

Only `BuildingConstructionSystem` uses the `TickSystem` interface. Movement, idle behavior, and lumberjack are still hard-coded. This means the registration pattern exists but isn't consistently applied.

### Issue C: eventBus Is Optional in Commands

In `command.ts:49`, the event bus is `eventBus?: EventBus` (optional). This means commands sometimes emit events and sometimes silently don't, depending on how the caller wires things. The guard `ctx.eventBus?.emit(...)` appears at every emit site.

If a feature module depends on receiving `building:removed` to clean up terrain, but a caller forgot to pass the event bus, the terrain won't restore — a silent correctness bug.

### Issue D: Placement Module Leaks Internals

`features/placement/index.ts` re-exports from `internal/`:

```typescript
export { canPlaceBuildingFootprint } from './internal/building-validator';
export { canPlaceResource } from './internal/resource-validator';
export { canPlaceUnit } from './internal/unit-validator';
export { MAX_SLOPE_DIFF, computeSlopeDifficulty } from './internal/slope';
```

These are labeled "backward compatibility" and "for indicator renderer," but they break the encapsulation boundary. External code now depends on internal implementation details.

### Issue E: Renderer Reaches Into Multiple Modules

The renderer imports directly from:
- `features/building-construction` (visual state queries)
- `features/placement` (terrain checks, slope, building validator)
- `systems/animation` (sprite data)
- `systems/coordinate-system` (hex math)
- `input/` (tile picker, render state)
- `game-state` (building states, unit states)

While some of these are necessary, the renderer has no single "render context" abstraction — it pulls individual pieces from everywhere. Adding a new visual feature means touching the renderer's imports and understanding which modules provide which data.

### Issue F: Inconsistent Barrel Files

| Module | Has `index.ts`? | Direct Internal Imports by External Code? |
|--------|:-:|:-:|
| `features/building-construction` | Yes | No |
| `features/placement` | Yes | Yes (internal/ re-exports) |
| `input` | Yes | No |
| `systems/movement` | Yes | No |
| `systems/pathfinding` | Yes | No |
| `renderer` | No | Yes (direct file imports everywhere) |
| `audio` | No | Yes (`sound-manager.ts` directly) |
| `commands` | No | Yes (`command.ts` directly) |
| `economy` | No | Yes (`material-type.ts` directly) |
| `buildings` | Yes | Sometimes bypassed |

Modules without barrel files can't evolve their internal structure without breaking dependents.

### Issue G: Callback Soup in GameLoop

`GameLoop` exposes state change notifications via setter callbacks:

```typescript
setRenderCallback(callback)
setTerrainModifiedCallback(callback)
setAnimationProvider(provider)
```

These are unrelated to the `EventBus`. A terrain modification during building construction triggers `onTerrainModified` (a callback) rather than an event. This creates two parallel notification systems with no consistent pattern for choosing between them.

### Issue H: Entity Hub Re-Exports Create Implicit Coupling

`entity.ts` re-exports types from `buildings/`, `features/building-construction/`, `unit-types`, and `map-object-types` to create a single import point. While convenient, this means that importing from `entity` transitively imports feature-module types, blurring the boundary between core types and feature-specific types.

---

## 3. Proposed Architectural Invariants

These are rules the project should enforce (via code review or linting) to maintain modularity as the codebase grows.

### Invariant 1: Dependency Direction Must Flow Downward

```
Layer 0 (Pure Data):  coordinates, buildings/types, unit-types, economy/types
Layer 1 (Algorithms): pathfinding, ai, hex-directions, movement
Layer 2 (Features):   building-construction, placement, (future: economy, combat)
Layer 3 (State):      game-state, event-bus
Layer 4 (Systems):    game-loop, commands, tick systems
Layer 5 (I/O):        renderer, input, audio
Layer 6 (Glue):       game.ts, Vue views/composables
```

**Rule:** A module may only import from its own layer or lower layers. Never upward.

**Why:** Upward imports create cycles and make lower-level modules impossible to test or reuse in isolation.

**Enforcement:** The project already has `.dependency-cruiser.cjs` — add layer rules there.

### Invariant 2: Feature Modules Own Their State

**Rule:** Feature-specific state (e.g., `buildingStates`, `resourceStates`) should live inside the feature module, not in `GameState`. `GameState` holds only truly shared data: entities, tile occupancy, and selection.

**Why:** Prevents `GameState` from growing into a god object. Features can be added or removed without modifying core state.

**Migration path:**
- `buildingStates` → `BuildingConstructionSystem` owns it
- `resourceStates` → future `ResourceStackSystem` owns it
- `lumberjackSystem` → registered as a `TickSystem`, owns its own state

### Invariant 3: EventBus Is Required, Not Optional

**Rule:** `EventBus` must be a required parameter in `CommandContext`, not optional.

```typescript
// Current (bad — silent failures possible)
interface CommandContext {
    eventBus?: EventBus;
}

// Proposed
interface CommandContext {
    eventBus: EventBus;
}
```

**Why:** If a system depends on an event to maintain correctness (e.g., terrain restore on `building:removed`), the event must always fire. Optional event buses create subtle bugs.

### Invariant 4: One Notification Mechanism Per Concern

**Rule:** Use the `EventBus` for game-state domain events (building placed, unit died, resource depleted). Use callbacks/hooks only for framework-level concerns (render frame, animation provider setup).

| Use EventBus for | Use Callbacks for |
|---|---|
| `building:placed`, `building:removed` | `onRender(alpha, dt)` |
| `unit:spawned`, `unit:died` | `setAnimationProvider()` |
| `resource:depleted` | `setTerrainData()` |

**Why:** Having two parallel notification systems with overlapping use cases (e.g., `onTerrainModified` callback vs. a hypothetical `terrain:modified` event) makes it unclear which to use and where to listen.

### Invariant 5: All Systems Use TickSystem Registration

**Rule:** Every per-frame update must go through `GameLoop.registerSystem()`. No direct calls to `system.update()` in the tick method.

```typescript
// Current (mixed patterns)
private tick(dt: number): void {
    this.gameState.movement.update(dt);          // direct
    updateIdleBehavior(this.gameState, dt);      // free function
    for (const system of this.systems) {         // registered
        system.tick(dt);
    }
    this.gameState.lumberjackSystem.update(...); // direct
}

// Proposed
private tick(dt: number): void {
    for (const system of this.systems) {
        system.tick(dt);
    }
}
```

**Why:** Consistent dispatch means systems can be reordered, disabled, or profiled uniformly. Special-casing individual systems defeats the purpose of the registration pattern.

### Invariant 6: No Imports From `internal/` Outside the Module

**Rule:** The `internal/` directory of a feature module must never be imported by external code. If something from `internal/` is needed externally, promote it to the public API in `index.ts` with a proper abstraction.

**Enforcement:** Add a lint rule or dependency-cruiser rule:
```
features/*/internal/** → only importable by features/*/
```

**Current violations:** `placement/index.ts` re-exports from `internal/building-validator`, `internal/resource-validator`, `internal/unit-validator`, `internal/slope`, and `internal/terrain`. These should be consolidated into public-facing functions in `placement-validator.ts` or `index.ts` that don't expose internal module paths.

### Invariant 7: Renderer Receives a Render Context, Not Scattered Imports

**Rule:** The renderer should receive its per-frame data through a single `RenderContext` interface, assembled by the glue layer (`game.ts` or a composable), rather than reaching into individual modules.

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

**Why:** Reduces the renderer's import fan-out from 10+ modules to 1 interface. Makes the renderer testable with mocks. Allows features to change their internal API without breaking rendering.

### Invariant 8: Every Module Has a Barrel File

**Rule:** Every directory under `src/game/` that is imported by other modules must have an `index.ts` that defines its public API. External code imports only from the barrel.

**Missing barrels:** `renderer/`, `audio/`, `commands/`, `economy/`, `ai/`, `systems/` (root level).

**Why:** Without a barrel, consumers import specific files and become coupled to the module's internal file structure. Renaming or splitting a file breaks all dependents.

### Invariant 9: Entity Hub Should Only Re-Export Core Types

**Rule:** `entity.ts` should re-export only fundamental entity types (`Entity`, `EntityType`, `TileCoord`, `tileKey`). Feature-specific types (`BuildingState`, `BuildingConstructionPhase`) should be imported from their owning feature module.

**Why:** When `entity.ts` re-exports `BuildingState`, any module that imports from `entity` gains a transitive dependency on `features/building-construction`. This makes the "pure data" layer depend on the "features" layer, violating the layer rule.

### Invariant 10: Events Are Fire-and-Forget, Queries Are Synchronous

**Rule:** Events carry notifications about things that already happened. They must not return values or modify the payload. If a module needs to ask another module for data, use a query function (direct import from its public API).

```typescript
// Event (notification, no return value)
eventBus.emit('building:placed', { entityId, buildingType, x, y, player });

// Query (synchronous data lookup)
const visual = getBuildingVisualState(entityId, buildingStates);
```

**Why:** Mixing queries into the event bus (e.g., event handlers that mutate the payload to "return" data) creates hidden control flow and order-dependent behavior.

---

## 4. Priority Action Items

Ranked by impact-to-effort ratio:

| # | Action | Effort | Impact | Notes |
|---|--------|--------|--------|-------|
| 1 | Make `eventBus` required in `CommandContext` | Small | High | Prevents silent correctness bugs |
| 2 | Convert movement + idle + lumberjack to `TickSystem` | Medium | High | Eliminates mixed patterns in GameLoop.tick() |
| 3 | Add barrel files to `renderer/`, `audio/`, `commands/`, `economy/` | Small | Medium | Enables future refactors without breaking consumers |
| 4 | Remove `internal/` re-exports from `placement/index.ts` | Small | Medium | Wrap them in public-facing functions instead |
| 5 | Move `buildingStates` ownership into `BuildingConstructionSystem` | Medium | High | First step toward Invariant 2 |
| 6 | Stop re-exporting feature types from `entity.ts` | Medium | Medium | Clean layer boundaries |
| 7 | Add dependency-cruiser layer rules | Small | Medium | Automated enforcement of Invariant 1 |
| 8 | Define `RenderContext` interface for renderer | Large | High | Major decoupling, do after other items |
| 9 | Replace `onTerrainModified` callback with event | Small | Low | Consistency; low urgency |

---

## 5. Event Bus Guidelines

### When to Use the Event Bus

- A state change in module A needs to trigger behavior in module B, and A should not know about B
- The event represents something that already happened (past tense: placed, removed, completed, spawned)
- Multiple modules may need to react to the same event

### When NOT to Use the Event Bus

- Querying data from another module (use direct import of query functions)
- Framework plumbing (render callbacks, provider setup)
- Communication within a single module (use direct function calls)
- Synchronous validation before an action (use imported validators)

### Event Naming Convention

```
"<domain>:<past-tense-verb>"
```

Examples: `building:placed`, `unit:spawned`, `resource:depleted`, `selection:changed`

### Event Payload Rules

1. Always include `entityId` when the event concerns an entity
2. Include enough context for handlers to act without querying back (e.g., include `buildingType` and coordinates, not just the ID)
3. Payloads are **read-only** — handlers must not mutate them
4. No callbacks or promises in payloads

### Adding a New Event

1. Add the event signature to `GameEvents` interface in `event-bus.ts`
2. Emit from the appropriate command or system
3. Subscribe from the feature module's `registerEvents()` method
4. Add a unit test that verifies the event fires with the correct payload

---

## 6. Summary

The project has a strong foundation: typed event bus, feature module pattern, command pattern, and acyclic dependency graph. The main risks are **inconsistent application** of these patterns (some systems use `TickSystem`, others don't; some modules have barrels, others don't) and **GameState accumulating feature-specific concerns**.

The ten invariants above, if enforced, will keep the architecture clean as more features are added (economy, combat, fog of war, multiplayer). The highest-leverage change is making `EventBus` required in `CommandContext` — it's a one-line type change that prevents an entire category of bugs.
