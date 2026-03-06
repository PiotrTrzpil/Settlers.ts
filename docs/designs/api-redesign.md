# Cross-System API Redesign — Design

## Overview

Redesign the two most problematic cross-system APIs in the codebase: the **CommandContext god object** (12 dependencies forced on every command handler) and the **ChoreoJobState progress sentinel** (negative number encoding "first tick" state). Both are clear improvement opportunities where a much better design exists.

## Summary for Review

- **Interpretation**: Surveyed all major inter-system APIs (commands, logistics, settler-tasks, carriers, building-construction, GameServices). Most APIs are well-designed — logistics/settler-tasks boundary uses clean interfaces (JobAssigner, TransportPositionResolver), event bus is strongly typed, feature modules follow registration patterns. Two APIs stand out as clearly improvable: CommandContext and the choreography node progress model.

- **Assumptions**: CommandContext handlers can be migrated incrementally (one handler at a time). The choreography progress sentinel can be replaced without changing executor behavior. Neither change requires modifying the event bus, logistics, or persistence systems.

- **Architecture**:
  1. **CommandContext** → Replace monolithic 12-dep god object with per-handler typed dependency configs. Each handler declares what it needs. A registry resolves dependencies and dispatches. Testing becomes trivial — mock only what the handler uses.
  2. **ChoreoJobState.progress** → Replace `-1` sentinel with explicit `nodePhase: 'entering' | 'executing'` field. Executors no longer need to check `progress < 0`.

- **Contracts & boundaries**: Command handlers become self-contained modules with typed deps. Choreography executors receive an explicit phase signal instead of a magic number.

- **Scope**: Full migration of CommandContext (all 25 handlers) and progress sentinel (all 27 executors). Does NOT touch logistics dispatcher, transport job lifecycle, GameServices wiring, or event bus. Those APIs are already well-designed.

### What was NOT selected (and why)

| System API | Assessment | Why not redesigned |
|---|---|---|
| **Logistics ↔ Settler Tasks** | Well-designed. TransportJob ownership model, JobAssigner interface, TransportPositionResolver/ChoreographyLookup break circular deps cleanly. | Already good. TransportData dual-ownership is a known tradeoff, not a design flaw. |
| **Carrier state fragmentation** | State split across 4 systems (CarrierManager, entity.carrying, SettlerTaskSystem, LogisticsDispatcher.activeJobs). | By design — each system owns its concern. Unifying would create a god object. Query helpers could improve DX but that's additive, not a redesign. |
| **GameServices composition root** | 400+ lines, 49+ deps, implicit ordering. | Works correctly. Ordering constraints are documented in comments. A DI container would add complexity without preventing bugs (ordering is inherent to the domain). |
| **ChoreoContext** | 15+ fields merged from 4 sub-interfaces. | Already mitigated — sub-interfaces (MovementContext, WorkContext, etc.) document which fields each executor phase needs. Splitting further would add boilerplate without clarity. |
| **EventBus error swallowing** | Catches + throttles handler errors in production. | Intentional design — one bad handler shouldn't crash the game loop. Strict mode exists for tests. |

## Project Conventions (extracted)

### Code Style
- Feature modules in `src/game/features/`, systems in `src/game/systems/`
- Single entry point: `index.ts` exports public API only
- Config object pattern for 3+ constructor dependencies
- `*Manager` owns state, `*System` has `tick()`

### Error Handling
- Optimistic: trust internal data, crash loudly on contract violations
- `getEntityOrThrow(id, 'context')` for stored IDs
- Bare `!` forbidden on entity/map lookups — use throwing helpers
- TickSystems catch errors per-entity (one bad entity doesn't crash game)

### Type Philosophy
- Required fields are required. Optional only when absence is domain-meaningful.
- `private foo!: Bar` for definite assignment after init
- No `?.` on required dependencies

### Representative Pattern
```typescript
// Current command handler pattern (command.ts)
interface CommandContext {
    state: GameState;
    terrain: TerrainData;
    eventBus: EventBus;
    settings: GameSettings;
    settlerTaskSystem: SettlerTaskSystem;
    constructionSiteManager: ConstructionSiteManager;
    treeSystem: TreeSystem;
    cropSystem: CropSystem;
    combatSystem: CombatSystem;
    productionControlManager: ProductionControlManager;
    storageFilterManager: StorageFilterManager;
    placementFilter: PlacementFilter | null;
}

// Every handler receives ALL 12 deps, uses only 2-4:
function executeScriptAddSettlers(ctx: CommandContext, cmd: ScriptAddSettlersCommand): CommandResult {
    const { state, eventBus } = ctx;  // Only uses 2 of 12
    // ...
}
```

## Architecture

### Data Flow

```
User/System → Command → Handler Registry → Typed Handler(deps, cmd) → CommandResult
                                                    ↓
                                            EventBus.emit(...)
                                                    ↓
                                            Feature systems react
```

### Subsystems

| # | Subsystem | Responsibility | Depends On | Files |
|---|-----------|---------------|------------|-------|
| 1 | Command Handler Contracts | Per-handler dependency types + handler registration | — | `src/game/commands/handler-registry.ts` |
| 2 | Core Handlers | Building, unit, selection, removal handlers | 1 | `src/game/commands/handlers/building-handlers.ts`, `unit-handlers.ts`, `selection-handlers.ts` |
| 3 | System Handlers | Pile, tree, crop, map-object, storage handlers | 1 | `src/game/commands/handlers/system-handlers.ts` |
| 4 | Script & Production Handlers | Lua scripting, production control handlers | 1 | `src/game/commands/handlers/script-handlers.ts`, `production-handlers.ts` |
| 5 | Command Entry Point | `executeCommand()` dispatcher + CommandContext removal | 1 | `src/game/commands/command.ts`, `src/game/commands/index.ts` |
| 6 | Wiring | GameServices creates handler registry, registers all handlers | 1, 5 | `src/game/game-services.ts` |
| 7 | Choreography Node Phase | Replace progress sentinel with explicit phase enum | — | `src/game/features/settler-tasks/choreo-types.ts`, executor files |
| 8 | Test Migration | Update test helpers to use new handler registration | 1, 5 | `tests/unit/helpers/test-game.ts`, affected test files |

## Shared Contracts (as code)

### Part 1: Command Handler Registry

```typescript
// src/game/commands/handler-registry.ts

import type { Command, CommandResult } from './command-types';

/**
 * A command handler is a function that takes its own typed dependencies
 * and a command, and returns a result. Dependencies are resolved at
 * registration time, not at call time.
 */
type BoundHandler = (cmd: any) => CommandResult;

/**
 * Registry that maps command types to pre-bound handlers.
 * Dependencies are injected at registration, not at dispatch.
 */
export class CommandHandlerRegistry {
    private handlers = new Map<string, BoundHandler>();

    /**
     * Register a handler with its dependencies already bound.
     *
     * Usage:
     *   registry.register('place_building', (cmd: PlaceBuildingCommand) => {
     *       // deps captured in closure from registration site
     *       return executePlaceBuilding(deps, cmd);
     *   });
     */
    register<T extends Command['type']>(type: T, handler: BoundHandler): void {
        if (this.handlers.has(type)) {
            throw new Error(`Handler already registered for command type '${type}'`);
        }
        this.handlers.set(type, handler);
    }

    execute(cmd: Command): CommandResult {
        const handler = this.handlers.get(cmd.type);
        if (!handler) {
            throw new Error(`No handler registered for command type '${cmd.type}'`);
        }
        return handler(cmd);
    }
}
```

### Part 2: Per-Handler Dependency Types

```typescript
// src/game/commands/handlers/building-handlers.ts

export interface PlaceBuildingDeps {
    state: GameState;
    terrain: TerrainData;
    eventBus: EventBus;
    settings: GameSettings;
    constructionSiteManager: ConstructionSiteManager;
    placementFilter: PlacementFilter | null;
}

export function executePlaceBuilding(deps: PlaceBuildingDeps, cmd: PlaceBuildingCommand): CommandResult;

export interface RemoveEntityDeps {
    state: GameState;
    eventBus: EventBus;
}

export function executeRemoveEntity(deps: RemoveEntityDeps, cmd: RemoveEntityCommand): CommandResult;
```

```typescript
// src/game/commands/handlers/unit-handlers.ts

export interface SpawnUnitDeps {
    state: GameState;
    terrain: TerrainData;
    eventBus: EventBus;
}

export function executeSpawnUnit(deps: SpawnUnitDeps, cmd: SpawnUnitCommand): CommandResult;

export interface MoveUnitDeps {
    state: GameState;
    settlerTaskSystem: SettlerTaskSystem;
    combatSystem: CombatSystem;
}

export function executeMoveUnit(deps: MoveUnitDeps, cmd: MoveUnitCommand): CommandResult;

export interface MoveSelectedUnitsDeps {
    state: GameState;
    settlerTaskSystem: SettlerTaskSystem;
    combatSystem: CombatSystem;
}

export function executeMoveSelectedUnits(deps: MoveSelectedUnitsDeps, cmd: MoveSelectedUnitsCommand): CommandResult;
```

```typescript
// src/game/commands/handlers/selection-handlers.ts

export interface SelectionDeps {
    state: GameState;
}

// All 5 selection handlers use only GameState
export function executeSelect(deps: SelectionDeps, cmd: SelectCommand): CommandResult;
export function executeSelectAtTile(deps: SelectionDeps, cmd: SelectAtTileCommand): CommandResult;
export function executeToggleSelection(deps: SelectionDeps, cmd: ToggleSelectionCommand): CommandResult;
export function executeSelectArea(deps: SelectionDeps, cmd: SelectAreaCommand): CommandResult;
export function executeSelectMultiple(deps: SelectionDeps, cmd: SelectMultipleCommand): CommandResult;
```

```typescript
// src/game/commands/handlers/system-handlers.ts

export interface SpawnPileDeps {
    state: GameState;
    terrain: TerrainData;
    eventBus: EventBus;
}

export interface PlacePileDeps {
    state: GameState;
    terrain: TerrainData;
    eventBus: EventBus;
}

export interface SpawnBuildingUnitsDeps {
    state: GameState;
    terrain: TerrainData;
    eventBus: EventBus;
}

export interface PlantTreeDeps {
    state: GameState;
    eventBus: EventBus;
    treeSystem: TreeSystem;
}

export interface PlantCropDeps {
    state: GameState;
    eventBus: EventBus;
    cropSystem: CropSystem;
}

export interface SetStorageFilterDeps {
    state: GameState;
    storageFilterManager: StorageFilterManager;
}
```

```typescript
// src/game/commands/handlers/script-handlers.ts

export interface ScriptDeps {
    state: GameState;
    eventBus: EventBus;
}

export function executeScriptAddGoods(deps: ScriptDeps, cmd: ScriptAddGoodsCommand): CommandResult;
export function executeScriptAddBuilding(deps: ScriptDeps, cmd: ScriptAddBuildingCommand): CommandResult;
export function executeScriptAddSettlers(deps: ScriptDeps, cmd: ScriptAddSettlersCommand): CommandResult;
```

```typescript
// src/game/commands/handlers/production-handlers.ts

export interface ProductionDeps {
    productionControlManager: ProductionControlManager;
}

export function executeSetProductionMode(deps: ProductionDeps, cmd: SetProductionModeCommand): CommandResult;
export function executeSetRecipeProportion(deps: ProductionDeps, cmd: SetRecipeProportionCommand): CommandResult;
export function executeAddToProductionQueue(deps: ProductionDeps, cmd: AddToProductionQueueCommand): CommandResult;
export function executeRemoveFromProductionQueue(deps: ProductionDeps, cmd: RemoveFromProductionQueueCommand): CommandResult;
```

### Part 3: Choreography Node Phase

```typescript
// In src/game/features/settler-tasks/choreo-types.ts

/** Explicit phase within a choreography node, replacing the progress=-1 sentinel. */
export enum NodePhase {
    /** Node just entered — apply animation, initialize state. Executors see this once. */
    ENTERING = 'entering',
    /** Node is actively executing. Progress accumulates from 0 to completion. */
    EXECUTING = 'executing',
}

/** Updated ChoreoJobState */
export interface ChoreoJobState {
    type: JobType.CHOREO;
    jobId: string;
    nodes: ChoreoNode[];
    nodeIndex: number;
    /** Phase within current node. Replaces the progress=-1 sentinel. */
    nodePhase: NodePhase;
    /** Progress within current node (0 to completion). Only meaningful when nodePhase=EXECUTING. */
    progress: number;
    visible: boolean;
    activeTrigger: string;
    targetId: number | null;
    targetPos: { x: number; y: number } | null;
    carryingGood: EMaterialType | null;
    workStarted: boolean;
    transportData?: TransportData;
}

export function createChoreoJobState(jobId: string, nodes: ChoreoNode[] = []): ChoreoJobState {
    return {
        type: JobType.CHOREO,
        jobId,
        nodes,
        nodeIndex: 0,
        nodePhase: NodePhase.ENTERING,
        progress: 0,
        visible: true,
        activeTrigger: '',
        targetId: null,
        targetPos: null,
        carryingGood: null,
        workStarted: false,
    };
}
```

## API Contracts

### Command Execution (new)

```typescript
// Public API — replaces executeCommand(ctx, cmd)
registry.execute(cmd: Command): CommandResult
```

### Command Registration (new, in GameServices)

```typescript
// Registration pattern — deps bound at creation time
const registry = new CommandHandlerRegistry();

// Each handler gets only what it needs
registry.register('place_building', (cmd) =>
    executePlaceBuilding({ state, terrain, eventBus, settings, constructionSiteManager, placementFilter }, cmd));

registry.register('select', (cmd) =>
    executeSelect({ state }, cmd));

registry.register('set_production_mode', (cmd) =>
    executeSetProductionMode({ productionControlManager }, cmd));
```

### Events (unchanged)

No new events. All existing events continue to work identically.

## Subsystem Details

### Subsystem 1: Command Handler Contracts

**Files**: `src/game/commands/handler-registry.ts`
**Owns**: Handler registration, command dispatch, registry type
**Key decisions**:
- Handlers are pre-bound closures, not functions receiving a context. This means dependencies are captured at registration time, eliminating the god object entirely.
- The registry is a simple Map, not a framework. No DI container, no decorators, no metadata reflection.
- The old `CommandContext` interface is deleted entirely. No backward compatibility.

**Behavior**:
- `register()` throws on duplicate registration (prevents silent overwrites)
- `execute()` throws on unknown command type (fail fast, not silent)
- Handlers are `(cmd: any) => CommandResult` internally — type safety comes from the registration site where the specific command type is known

### Subsystem 2: Core Handlers (building, unit, selection, removal)

**Files**: `src/game/commands/handlers/building-handlers.ts`, `src/game/commands/handlers/unit-handlers.ts`, `src/game/commands/handlers/selection-handlers.ts`
**Owns**: All player-initiated command handlers
**Depends on**: Subsystem 1 (handler types)

**Key decisions**:
- Each handler file exports a `*Deps` interface and the handler function
- Handler functions are pure: `(deps, cmd) => CommandResult` — no class, no `this`
- Helper functions (`findValidSpawnTile`, `spawnWorkerAtDoor`, `spawnUnitsNear`, `isSpawnableTile`) move with their handlers. They take explicit deps, not CommandContext.

**Behavior**:
- `executePlaceBuilding` needs 6 deps (state, terrain, eventBus, settings, constructionSiteManager, placementFilter)
- `executeSpawnUnit` needs 3 deps (state, terrain, eventBus)
- `executeMoveUnit` needs 3 deps (state, settlerTaskSystem, combatSystem)
- All 5 selection handlers need 1 dep (state)
- `executeRemoveEntity` needs 2 deps (state, eventBus)

**Migration**: Move handler functions from `command.ts` to their new files. Change first parameter from `ctx: CommandContext` to typed deps. Replace `ctx.state` with `deps.state`, etc. Mechanical find-and-replace.

### Subsystem 3: System Handlers (pile, tree, crop, map-object, storage)

**Files**: `src/game/commands/handlers/system-handlers.ts`
**Owns**: Internal system command handlers (not player-initiated)
**Depends on**: Subsystem 1

**Key decisions**:
- Group all system commands in one file (they're small and related)
- `executeSpawnBuildingUnits` is the most complex — needs state, terrain, eventBus for spawn validation

**Behavior**:
- `executeSpawnMapObject` needs 1 dep (state)
- `executePlacePile`, `executeSpawnPile` need 3 deps (state, terrain, eventBus)
- `executeUpdatePileQuantity` needs 1 dep (state)
- `executeSetStorageFilter` needs 2 deps (state, storageFilterManager)
- `executeSpawnBuildingUnits` needs 3 deps (state, terrain, eventBus) — helper functions (`spawnWorkerAtDoor`, `spawnUnitsNear`) are co-located
- `executePlantTree` needs 3 deps (state, eventBus, treeSystem)
- `executePlantCrop` needs 3 deps (state, eventBus, cropSystem)
- `executePlantTreesArea` needs 1 dep (treeSystem)

### Subsystem 4: Script & Production Handlers

**Files**: `src/game/commands/handlers/script-handlers.ts`, `src/game/commands/handlers/production-handlers.ts`
**Owns**: Lua scripting commands, production control commands
**Depends on**: Subsystem 1

**Key decisions**:
- Script handlers are the simplest — most need only state + eventBus
- Production handlers need only productionControlManager

**Behavior**:
- All 3 script handlers need 2 deps (state, eventBus)
- All 4 production handlers need 1 dep (productionControlManager)

### Subsystem 5: Command Entry Point

**Files**: `src/game/commands/command.ts`, `src/game/commands/index.ts`
**Owns**: Public `executeCommand()` API, barrel exports
**Depends on**: Subsystem 1

**Key decisions**:
- `command.ts` becomes minimal: just re-exports `CommandHandlerRegistry` and `executeCommand` (which delegates to registry)
- The old monolithic `command.ts` (764 lines) is deleted
- `CommandContext` interface is deleted — it no longer exists anywhere
- `index.ts` exports the registry type and command types

**Behavior**:
- `executeCommand` is now `registry.execute(cmd)` — the registry is the new entry point
- External code that called `executeCommand(ctx, cmd)` now calls `registry.execute(cmd)` or the bound `executeCommand(cmd)` function from GameServices

### Subsystem 6: Wiring (GameServices)

**Files**: `src/game/game-services.ts`
**Owns**: Registry creation, handler registration with bound dependencies
**Depends on**: Subsystems 1-5

**Key decisions**:
- GameServices creates the `CommandHandlerRegistry` and registers all handlers
- Each registration binds the handler's specific dependencies at init time
- The bound `executeCommand` function (passed to systems that need it) becomes `registry.execute.bind(registry)`
- No changes to tick system ordering or event subscriptions

**Behavior**:
- Registration happens after all managers/systems are created (same point where CommandContext was previously constructed)
- Handlers that need terrain get it via `setTerrainData()` (same deferred pattern as before)
- The `placementFilter` is mutable — captured by reference in the closure (same as current behavior where it's a field on CommandContext)

### Subsystem 7: Choreography Node Phase

**Files**:
- `src/game/features/settler-tasks/choreo-types.ts` (NodePhase enum, ChoreoJobState update)
- `src/game/features/settler-tasks/worker-task-executor.ts` (advanceToNextNode sets ENTERING)
- `src/game/features/settler-tasks/internal/inventory-executors.ts` (replace `progress < 0` checks)
- `src/game/features/settler-tasks/internal/movement-executors.ts` (replace `progress < 0` checks)
- `src/game/features/settler-tasks/internal/transport-executors.ts` (replace checks)
- `src/game/features/settler-tasks/internal/work-executors.ts` (replace checks)
- `src/game/features/settler-tasks/internal/control-executors.ts` (replace checks)

**Owns**: Node lifecycle phase tracking
**Key decisions**:
- Add `nodePhase: NodePhase` field to ChoreoJobState
- Remove the `progress = -1` sentinel pattern entirely
- `advanceToNextNode()` sets `nodePhase = NodePhase.ENTERING` and `progress = 0`
- The main tick loop in WorkerTaskExecutor handles the ENTERING → EXECUTING transition after applying animation
- Executors that previously checked `if (job.progress < 0)` now check `if (job.nodePhase === NodePhase.ENTERING)`

**Behavior**:
- **ENTERING phase**: WorkerTaskExecutor calls `applyChoreoAnimation(node)`, sets `nodePhase = EXECUTING`, `progress = 0`
- **EXECUTING phase**: Executor runs normally, accumulates progress
- When executor returns DONE: `advanceToNextNode()` → `nodePhase = ENTERING`, `progress = 0`, `nodeIndex++`

**Migration pattern** (mechanical):
```typescript
// BEFORE (scattered in each executor)
if (job.progress < 0) {
    // first-tick setup
    job.progress = 0;
}

// AFTER (centralized in WorkerTaskExecutor tick loop)
// The ENTERING → EXECUTING transition happens BEFORE the executor runs.
// Executors that need first-tick setup use a local flag or workStarted field.
```

For executors that do first-tick-only work (e.g., inventory withdrawal in GET_GOOD):
```typescript
// BEFORE
if (job.progress < 0) {
    materialTransfer.pickUp(...);
    job.progress = 0;
}
// tick duration...

// AFTER — use workStarted flag (already exists on ChoreoJobState)
if (!job.workStarted) {
    materialTransfer.pickUp(...);
    job.workStarted = true;
}
// tick duration...
```

Note: `workStarted` is already reset to `false` in `advanceToNextNode()`. This makes the pattern explicit and reusable across nodes that need "do once then wait" behavior.

### Subsystem 8: Test Migration

**Files**: `tests/unit/helpers/test-game.ts`, `tests/unit/helpers/test-simulation.ts`, affected spec files
**Owns**: Test helper updates for new command execution API
**Depends on**: Subsystems 1, 5

**Key decisions**:
- Test helpers that create a `CommandContext` now create a `CommandHandlerRegistry` instead
- Tests that called `executeCommand(ctx, cmd)` now call `registry.execute(cmd)`
- Tests for individual handlers can test the handler function directly with only the deps it needs — no more mocking 12 things

**Behavior**:
- `TestGame` or `TestSimulation` creates a registry with test handlers registered
- Handler-specific unit tests import the handler function directly and pass minimal deps
- Integration tests use the full registry as before

## File Map

### New Files
| File | Subsystem | Purpose |
|------|-----------|---------|
| `src/game/commands/handler-registry.ts` | 1 | Registry class |
| `src/game/commands/handlers/building-handlers.ts` | 2 | place_building, remove_entity, spawn_building_units |
| `src/game/commands/handlers/unit-handlers.ts` | 2 | spawn_unit, move_unit, move_selected_units |
| `src/game/commands/handlers/selection-handlers.ts` | 2 | select, select_at_tile, toggle_selection, select_area, select_multiple |
| `src/game/commands/handlers/system-handlers.ts` | 3 | spawn_pile, place_pile, spawn_map_object, update_pile_quantity, set_storage_filter, plant_tree, plant_crop, plant_trees_area |
| `src/game/commands/handlers/script-handlers.ts` | 4 | script_add_goods, script_add_building, script_add_settlers |
| `src/game/commands/handlers/production-handlers.ts` | 4 | set_production_mode, set_recipe_proportion, add_to_production_queue, remove_from_production_queue |

### Modified Files
| File | Change |
|------|--------|
| `src/game/commands/command.ts` | Delete all handler functions, delete CommandContext. Becomes thin wrapper around registry. |
| `src/game/commands/index.ts` | Export CommandHandlerRegistry, remove CommandContext export |
| `src/game/game-services.ts` | Create registry, register all handlers with bound deps, pass `registry.execute.bind(registry)` to systems |
| `src/game/features/settler-tasks/choreo-types.ts` | Add NodePhase enum, update ChoreoJobState, update createChoreoJobState |
| `src/game/features/settler-tasks/worker-task-executor.ts` | Handle ENTERING→EXECUTING transition centrally, update advanceToNextNode |
| `src/game/features/settler-tasks/internal/inventory-executors.ts` | Replace `progress < 0` with `nodePhase === ENTERING` or `!workStarted` |
| `src/game/features/settler-tasks/internal/movement-executors.ts` | Replace `progress < 0` with `nodePhase === ENTERING` |
| `src/game/features/settler-tasks/internal/transport-executors.ts` | Replace `progress < 0` checks |
| `src/game/features/settler-tasks/internal/work-executors.ts` | Replace `progress < 0` checks |
| `src/game/features/settler-tasks/internal/control-executors.ts` | Replace `progress < 0` checks |
| `src/game/input/input-manager.ts` | Update to use `registry.execute()` instead of `executeCommand(ctx, cmd)` |
| `src/game/input/modes/select-mode.ts` | Update command execution call site |
| `tests/unit/helpers/test-game.ts` | Replace CommandContext with CommandHandlerRegistry |
| `tests/unit/helpers/test-simulation.ts` | Replace CommandContext with CommandHandlerRegistry |
| `tests/unit/commands/unit-placement-selection-movement.spec.ts` | Update command execution |
| `tests/unit/economy/fulfillment-matcher.spec.ts` | Update if uses CommandContext |
| `tests/unit/economy/settler-task-job-selection.spec.ts` | Update if uses CommandContext |
| `tests/unit/economy/transport-job.spec.ts` | Update if uses CommandContext |

### Deleted Files
| File | Reason |
|------|--------|
| None | `command.ts` is rewritten in-place, not deleted |

## Dependency Audit: Which deps does each handler actually use?

This table drives the per-handler Deps interfaces. Each `x` means the handler reads the dependency.

| Handler | state | terrain | eventBus | settings | settler TaskSys | construction SiteMgr | treeSys | cropSys | combatSys | production CtlMgr | storage FilterMgr | placement Filter |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| place_building | x | x | x | x | | x | | | | | | x |
| spawn_unit | x | x | x | | | | | | | | | |
| move_unit | x | | | | x | | | | x | | | |
| move_selected_units | x | | | | x | | | | x | | | |
| select | x | | | | | | | | | | | |
| select_at_tile | x | | | | | | | | | | | |
| toggle_selection | x | | | | | | | | | | | |
| select_area | x | | | | | | | | | | | |
| select_multiple | x | | | | | | | | | | | |
| remove_entity | x | | x | | | | | | | | | |
| place_pile | x | x | x | | | | | | | | | |
| spawn_pile | x | x | x | | | | | | | | | |
| spawn_map_object | x | | | | | | | | | | | |
| update_pile_quantity | x | | | | | | | | | | | |
| set_storage_filter | x | | | | | | | | | | x | |
| spawn_building_units | x | x | x | | | | | | | | | |
| plant_tree | x | | x | | | | x | | | | | |
| plant_crop | x | | x | | | | | x | | | | |
| plant_trees_area | | | | | | | x | | | | | |
| script_add_goods | x | | | | | | | | | | | |
| script_add_building | x | | | | | | | | | | | |
| script_add_settlers | x | | x | | | | | | | | | |
| set_production_mode | | | | | | | | | | x | | |
| set_recipe_proportion | | | | | | | | | | x | | |
| add_to_production_queue | | | | | | | | | | x | | |
| remove_from_production_queue | | | | | | | | | | x | | |

**Key insight**: Most handlers use 1-3 deps. Only `place_building` uses 6. The current CommandContext forces all 12 on every handler.

## Verification

- All 25 command types still execute correctly (existing unit + e2e tests pass)
- `pnpm lint` passes (no type errors from removed CommandContext)
- Handler unit tests can be written with minimal mocks (e.g., selection tests need only GameState)
- Choreography executors no longer check `progress < 0` — search for the pattern should return zero results
- `NodePhase.ENTERING` is set in exactly one place: `advanceToNextNode()` and `createChoreoJobState()`
- No `CommandContext` references remain anywhere in the codebase
