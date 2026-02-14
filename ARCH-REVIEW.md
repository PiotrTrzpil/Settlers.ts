# Architecture Review — 2026-02-14

## System Overview

Settlers.ts is a browser-based TypeScript remake of Settlers 4, built on Vue 3, WebGL2, and a fixed-timestep game loop. The architecture follows a layered design with **pure data types** at the bottom, **feature modules** implementing game domains, **game state and commands** managing mutations, and **rendering/input** as I/O layers. The design emphasizes: typed event bus for decoupling, feature modules with single-entry-point barrels, command pattern for all state mutations, and a registration-based tick system.

The codebase has grown to ~15k lines of core game logic with 6 feature modules, 8 tick systems, and a sophisticated WebGL renderer. Recent work (RFC: Entity-Owned State) has consolidated per-entity state onto Entity objects, simplifying save/load and debugging.

## Strengths

### 1. Well-Defined Feature Module Pattern
Features like `carriers/`, `logistics/`, `building-construction/`, and `placement/` follow a consistent pattern: single `index.ts` entry, `internal/` for private implementation, JSDoc headers documenting public API. This pattern is well-documented in `feature-module-architecture.md` and consistently applied.

### 2. Typed Event Bus
`GameEvents` interface provides compile-time safety for all 20+ event types. The `"domain:past-tense"` naming convention (`building:placed`, `carrier:jobCompleted`) is consistent. `EventSubscriptionManager` helper reduces boilerplate for cleanup.

### 3. Clean Dependency Direction
The dependency graph is acyclic. Pure algorithm modules (`pathfinding/`, `coordinates`) have zero game imports. Features depend on state and events but not on each other (except through events). The renderer depends on features for queries but features don't depend on rendering.

### 4. Command Pattern for Mutations
All game state changes flow through `executeCommand()`, making replay, undo, and future networked multiplayer straightforward. The command types are exhaustive and well-typed.

### 5. Entity-Owned State (RFC Implemented)
Per-entity state (`carrier`, `production`, `tree`, `construction`) now lives on Entity objects, eliminating parallel `Map<number, State>` structures across systems. This dramatically simplifies save/load and debugging.

### 6. TickSystem Registration
All per-frame updates use `GameLoop.registerSystem()` with a clean `TickSystem` interface. System order is explicit and documented in constructor.

## Critical Issues

### Issue 1: GameState Still Accumulates Global State
**Impact:** GameState has grown to 524 lines and owns `carrierManager`, `inventoryManager`, `serviceAreaManager`, `requestManager`, `buildingStateManager`, `resourceStates`, movement system, and selection state. Each new system adds another field, creating a merge bottleneck and violating separation of concerns.

**Current state:** `game-state.ts:92-118` instantiates 5 managers directly. These are not game-wide concerns but feature-specific.

**Recommended direction:** GameState should own only: `entities`, `tileOccupancy`, `selection`, `rng`, `movement`. Feature-specific managers should be instantiated by GameLoop and passed to systems that need them. This aligns with the existing pattern where GameLoop already owns `constructionSystem`, `carrierSystem`, etc.

### Issue 2: Renderer Has No Unified Query Interface
**Impact:** `entity-renderer.ts` imports from 8+ modules to gather data for rendering. Adding a visual feature requires understanding which modules provide which data. Testing renderer logic requires complex mocking.

**Current state:** EntityRenderer imports directly from `features/building-construction`, `features/placement`, `features/inventory`, `game-state`, `systems/animation`, `systems/coordinate-system`. No abstraction exists between rendering and game state.

**Recommended direction:** Define a `RenderContext` interface that assembles all per-frame data needed by renderers. The glue layer (`use-renderer.ts`) builds this context each frame. Renderers receive context, not scattered imports. This is documented in `modularity-review.md` but not yet implemented.

### Issue 3: Missing Barrel Files for Key Modules ✅ RESOLVED
**Impact:** External code imports specific files from `renderer/`, `ai/`, `systems/` (root level), making internal restructuring break consumers.

**Resolution:** Added barrel files (`index.ts`) to all three modules:
- `renderer/index.ts` — exports public API: Renderer, EntityRenderer, LandscapeRenderer, ViewPoint, RenderContext, LayerVisibility, sprite metadata, cache utilities
- `systems/index.ts` — exports coordinate system, hex directions, pathfinding, animation, map objects/buildings, tree/production/woodcutting systems, settler tasks
- `ai/index.ts` — exports behavior tree primitives (NodeStatus, Node classes, builder functions) and Tick wrapper

Existing direct imports continue to work. New code should prefer importing from barrel files.

### Issue 4: Callback Overlap with Event Bus
**Impact:** Two parallel notification mechanisms exist. `GameState.onEntityRemoved`, `GameState.onBuildingCreated`, `GameState.onMapObjectCreated` are callbacks set by GameLoop. Meanwhile, events like `building:placed`, `building:removed` serve similar purposes. This creates confusion about when to use which.

**Current state:** GameState exposes callbacks in `game-state.ts:132-139`. GameLoop sets them in constructor to wire up systems. Events handle cross-system communication but some concerns (entity removal cleanup) use both mechanisms.

**Recommended direction:** Events should be the single notification mechanism for game domain changes. Callbacks should only be for framework plumbing (render frame, terrain data setup). `onEntityRemoved` should emit an `entity:removed` event that systems subscribe to, rather than having GameLoop manually call cleanup.

## Recommended Restructuring

### Refactor 1: Extract Managers from GameState
**Scope:** `game-state.ts`, `game-loop.ts`, feature managers
**Rationale:** GameState is becoming a god object. Managers for specific features should be owned by GameLoop or a dedicated `GameContext` that systems receive.

**Target state:**
```typescript
// game-state.ts — core only
class GameState {
    entities: Entity[] = [];
    entityMap: Map<number, Entity> = new Map();
    tileOccupancy: Map<string, number> = new Map();
    selectedEntityId: number | null = null;
    selectedEntityIds: Set<number> = new Set();
    movement: MovementSystem = new MovementSystem();
    rng: SeededRng;
}

// game-loop.ts or game-context.ts — owns managers
class GameLoop {
    private carrierManager: CarrierManager;
    private inventoryManager: BuildingInventoryManager;
    // ... other managers
    // Systems receive managers they need via constructor config
}
```

**Dependencies:** Requires updating all systems that access `gameState.carrierManager` etc. Can be done incrementally, one manager at a time.

### Refactor 2: Define RenderContext Interface
**Scope:** `renderer/`, `entity-renderer.ts`, glue layer
**Rationale:** Renderer imports from 10+ modules. A unified interface would decouple rendering from game internals.

**Target state:**
```typescript
interface RenderContext {
    entities: ReadonlyArray<Entity>;
    unitStates: UnitStateLookup;
    buildingVisualState(entityId: number): BuildingVisualState;
    getAnimation(entityId: number): AnimationData | undefined;
    placementStatus(x: number, y: number, type: PlacementEntityType): PlacementStatus;
    camera: IViewPoint;
    selection: SelectionState;
    layerVisibility: LayerVisibility;
}
```

**Dependencies:** Large refactor. Should be done after other structural fixes.

### Refactor 3: Unify Entity Removal via Events
**Scope:** `game-state.ts`, `game-loop.ts`, `event-bus.ts`, all systems with `onEntityRemoved`
**Rationale:** Entity removal currently uses callback (`onEntityRemoved`) which GameLoop sets. This should use the event bus like all other domain changes.

**Target state:**
- Add `entity:removed` event to `GameEvents`
- Emit from `GameState.removeEntity()`
- Systems subscribe via `eventBus.on('entity:removed', ...)`
- Remove `GameState.onEntityRemoved` callback

**Dependencies:** Requires EventBus to be available in GameState (it currently isn't). Could pass eventBus to GameState constructor, or emit from command level.

### Refactor 4: Add Missing Barrel Files ✅ COMPLETED
**Scope:** `renderer/`, `systems/`, `ai/`
**Rationale:** Enable internal restructuring without breaking consumers.

**Completed state:**
```
renderer/
  index.ts  # exports: Renderer, EntityRenderer, LandscapeRenderer, ViewPoint, RenderContext, LayerVisibility, sprite metadata, etc.
systems/
  index.ts  # exports: coordinate system, pathfinding, TreeSystem, ProductionSystem, settler-tasks, etc.
ai/
  index.ts  # exports: NodeStatus, Node classes, builder functions, Tick
```

**Next step:** Gradually migrate existing imports to use barrel files.

### Refactor 5: Consolidate Placement Internal Exports
**Scope:** `features/placement/`
**Rationale:** `placement/index.ts` re-exports from `internal/`, breaking encapsulation. These should be wrapped in public-facing functions.

**Target state:**
- Move `canPlaceBuildingFootprint`, `canPlaceResource`, `canPlaceUnit` implementations to `placement-validator.ts`
- Export from `index.ts` without exposing internal file paths
- Keep slope calculation internal unless genuinely needed externally (indicator renderer)

**Dependencies:** Small. Update indicator renderer imports if needed.

## Questions for the Team

1. **Manager ownership:** Should managers move to GameLoop, or create a separate `GameContext` class that holds all managers? GameContext would be a dependency injection container passed to systems.

2. **Event bus in GameState:** Should GameState receive EventBus in constructor to emit `entity:removed` events directly? This would unify the notification mechanism but increases coupling.

3. **Renderer decoupling priority:** Is RenderContext a priority for the next phase, or should it wait until more features are implemented? It's high effort but high value.

4. **AI system location:** The `ai/` folder contains only `behavior-tree.ts` and `tick.ts`. Should AI be a feature module under `features/ai/`, or remain in systems? It may grow significantly as AI is implemented.

5. **WASM boundary:** The architecture doc mentions a future Rust/WASM layer for pathfinding and simulation. Does this affect current refactoring priorities, or is it far enough out to ignore?
