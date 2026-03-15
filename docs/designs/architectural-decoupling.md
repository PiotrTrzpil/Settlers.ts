# Architectural Decoupling — Design

## Overview

Three targeted refactorings to reduce coupling and complexity in the codebase's most tangled areas: (1) complete the half-finished EntityRenderer pass registry migration so adding/removing render passes is declarative, (2) decompose the 593-line SettlerTaskSystem into focused coordinators, and (3) extract executor context construction from the 459-line WorkerTaskExecutor.

## Current State

### What exists

**EntityRenderer (694 lines, 32 imports)** — A half-finished migration to a data-driven pass registry:
- `RenderPassRegistry` exists and works, with `CORE_PASS_DEFINITIONS` registering 6 passes
- But `draw()` ignores the registry entirely — it manually calls all 9 passes via hardcoded fields (`this.passPathIndicator`, `this.passGroundOverlay`, etc.)
- `setContext()` unpacks `IRenderContext` into 20+ private fields, then `buildPassContext()` reassembles those same fields into a `PassContext` — a wasteful state round-trip
- Adding a new pass requires: adding a field, constructor init, `prepare()` call in `draw()`, `draw()` call in `draw()`, and tracking draw calls — 5 touch points in one file

**SettlerTaskSystem (593 lines, 18 fields)** — A monolithic facade at the file-size limit:
- Owns 10 internal subsystems (WorkerTaskExecutor, UnitStateMachine, IdleAnimationController, etc.)
- Mixes orchestration (tick, event handling) with lifecycle management (orphan checks, cooldowns) and debug/diagnostics (dump methods)
- Implements both `TaskDispatcher` (assignment) and `WorkerStateQuery` (diagnostics) — separate consumers, single class
- 7 event subscriptions in `registerEvents()` spanning entity lifecycle, building events, and tick scheduling

**WorkerTaskExecutor (459 lines, 16 imports)** — Builds 5 context objects from ~12 dependencies:
- Constructs `MovementContext`, `WorkContext`, `InventoryExecutorContext`, `ControlContext` inline
- Each context shares some deps (gameState, eventBus) but needs different combinations
- The context-building code is ~60 lines repeated in constructor + `createContexts()`
- Adding a new executor category means editing WorkerTaskExecutor to build yet another context

### What stays vs changes

- **Stays**: All runtime behavior, render output, task execution, choreography
- **Changes**: How passes are orchestrated in EntityRenderer, how SettlerTaskSystem delegates work, where context objects are built

### What gets deleted

- 9 hardcoded pass fields in EntityRenderer (replaced by registry iteration)
- 20+ state-mirroring fields in EntityRenderer (replaced by storing PassContext directly)
- Lifecycle/debug methods move out of SettlerTaskSystem (file shrinks ~200 lines)

## Summary for Review

- **Interpretation**: Reduce the complexity of the 3 most coupled, oversized subsystems by completing an in-progress migration (renderer), splitting a facade (settler-tasks), and extracting a concern (executor contexts).

- **Key decisions**:
  - EntityRenderer's `draw()` becomes a 3-phase loop over registry slots (before-entities → entities → after-entities), eliminating manual per-pass calls
  - The 3 entity-layer passes (EntitySpritePass, TransitionBlendPass, ColorEntityPass) move to the registry with a new `RenderLayer.Entities` value, with special coordination handled by an `EntityLayerOrchestrator`
  - SettlerTaskSystem keeps task dispatch + tick, delegates lifecycle events and debug to extracted modules
  - Executor context construction moves to a factory that WorkerTaskExecutor calls

- **Assumptions**:
  - The `passTransitionBlend` → `passEntitySprite` constructor dependency can be handled by the registry's `create()` receiving deps
  - SettlerTaskSystem's event handlers don't need private access to all 18 fields — they can use the public API

- **Scope**: Structural refactoring only — no behavioral changes. Renders identically, tasks execute identically.

## Conventions

- Feature modules: single `index.ts` entry, `internal/` is private
- Optimistic programming: no `?.` on required deps, `getEntityOrThrow()` over `getEntity()!`
- Max 600 lines (TS), aim for ≤400. Max 250 lines per function.
- Max cyclomatic complexity 15
- Dependency direction flows downward: systems < features < features (never reverse)
- Config object pattern for 3+ constructor deps

## Architecture

### Subsystems

| # | Subsystem | Responsibility | Depends On | Files |
|---|-----------|---------------|------------|-------|
| 1 | Entity layer orchestrator | Coordinate the 3 entity-layer passes (sprite, blend, color) as a single registry-compatible pass | — | New file in render-passes/ |
| 2 | Registry-driven draw loop | Replace manual pass calls with registry iteration in EntityRenderer.draw() | 1 | entity-renderer.ts |
| 3 | PassContext as canonical state | Remove setContext() field unpacking; store IRenderContext → build PassContext directly | 2 | entity-renderer.ts |
| 4 | Settler lifecycle coordinator | Extract event handlers, orphan checks, idle cooldowns from SettlerTaskSystem | — | New file in settler-tasks/ |
| 5 | Settler debug extractor | Extract debug/diagnostics methods from SettlerTaskSystem | — | New file in settler-tasks/ |
| 6 | Executor context factory | Extract context-building into a factory function | — | New file in settler-tasks/ |
| 7 | Wire extracted modules | Update SettlerTaskSystem to delegate to new modules, update WorkerTaskExecutor to use factory | 4, 5, 6 | settler-task-system.ts, worker-task-executor.ts |

## Shared Contracts

```typescript
// ── render-passes/types.ts — additions ──────────────────────────

/** Extended RenderLayer with the Entities slot */
export enum RenderLayer {
    BeforeDepthSort = 0,
    BehindEntities = 1,
    Entities = 2,        // NEW — was "reserved" comment
    AboveEntities = 3,
    Overlay = 4,
}

/** Extended needs for entity-layer passes */
export interface RenderPassNeeds {
    colorShader?: boolean;
    sprites?: boolean;
    entities?: boolean;
    /** Pass needs the depth-sorted frameContext (only valid after depth sort) */
    frameContext?: boolean;
}


// ── render-passes/entity-layer-orchestrator.ts — new ────────────

/**
 * Wraps EntitySpritePass + TransitionBlendPass + ColorEntityPass into a
 * single PluggableRenderPass that handles their special coordination:
 * - Sprite pass holds reference to blend pass
 * - Color pass texturedBuildingsHandled flag depends on sprite availability
 * - Shader switching between sprite and color passes
 *
 * From the registry's perspective, this is one pass at RenderLayer.Entities.
 */
export class EntityLayerOrchestrator implements PluggableRenderPass {
    prepare(ctx: PassContext): void;
    draw(gl: WebGL2RenderingContext, projection: Float32Array, viewPoint: IViewPoint): void;
    lastDrawCalls: number;
    lastSpriteCount: number;
    /** Detailed timing for profiler */
    readonly timings: { textured: number; color: number };
    /** Debug labels collected from color pass */
    readonly debugDecoLabels: DebugEntityLabel[];
}


// ── settler-tasks/settler-lifecycle.ts — new ────────────────────

export interface SettlerLifecycleConfig {
    gameState: GameState;
    eventBus: EventBus;
    tickScheduler: TickScheduler;
    workerTracker: BuildingWorkerTracker;
    stateMachine: UnitStateMachine;
    runtimes: IndexedMap<number, UnitRuntime>;
    locationManager: ISettlerBuildingLocationManager;
    inventoryManager: BuildingInventoryManager;
}

/**
 * Handles settler lifecycle events — entity creation/removal,
 * building completion/destruction, orphan detection, idle cooldowns.
 *
 * Extracted from SettlerTaskSystem to separate "what happens when
 * entities come and go" from "how settlers pick and execute tasks."
 */
export class SettlerLifecycleCoordinator {
    constructor(config: SettlerLifecycleConfig);
    /** Subscribe to all lifecycle events. Call once during feature init. */
    registerEvents(): void;
    /** Unsubscribe and cancel scheduled checks. */
    destroy(): void;
}


// ── settler-tasks/settler-debug.ts — new ────────────────────────

export interface SettlerDebugSource {
    readonly runtimes: ReadonlyMap<number, UnitRuntime>;
    readonly workerTracker: BuildingWorkerTracker;
    getActiveJobId(entityId: number): string | null;
    getSettlerState(entityId: number): SettlerState | null;
}

/** Debug dump + diagnostics for settler task system. */
export function dumpSettlerDebug(source: SettlerDebugSource): SettlerDebugEntry[];
export function dumpWorkerAssignments(source: SettlerDebugSource): string;


// ── settler-tasks/executor-context-factory.ts — new ─────────────

export interface ExecutorContextDeps {
    gameState: GameState;
    eventBus: EventBus;
    inventoryManager: BuildingInventoryManager;
    materialTransfer: MaterialTransfer;
    constructionSiteManager: ConstructionSiteManager;
    barracksTrainingManager: BarracksTrainingManager;
    buildingPositionResolver: BuildingPositionResolver;
    jobPartResolver: JobPartResolver;
    triggerSystem: TriggerSystem;
    locationManager: ISettlerBuildingLocationManager;
    handlerErrorLogger: ThrottledLogger;
    executeCommand: (cmd: Command) => CommandResult;
}

export interface ExecutorContexts {
    movement: MovementContext;
    work: WorkContext;
    inventory: InventoryExecutorContext;
    control: ControlContext;
}

/** Build all executor category contexts from shared deps. */
export function buildExecutorContexts(deps: ExecutorContextDeps): ExecutorContexts;
```

## Subsystem Details

### 1. Entity layer orchestrator
**Files**: `src/game/renderer/render-passes/entity-layer-orchestrator.ts`
**Key decisions**:
- Wraps the 3 entity-layer passes into one `PluggableRenderPass` — the registry sees a single slot at `RenderLayer.Entities`
- Internally owns `EntitySpritePass`, `TransitionBlendPass`, `ColorEntityPass` (created via `RenderPassDeps`)
- Handles the sprite→color shader switching and the `texturedBuildingsHandled` flag internally
- Exposes timing breakdown and debug labels as readonly properties for profiler/debug overlay
- The `EntitySpritePass(blendPass)` constructor dependency is wired internally — no registry concern

### 2. Registry-driven draw loop
**Files**: `src/game/renderer/entity-renderer.ts`
**Key decisions**:
- Remove 9 hardcoded pass fields (`passPathIndicator`, `passGroundOverlay`, etc.)
- Remove manual `CORE_PASS_DEFINITIONS` array — all pass definitions registered in constructor via registry
- Add entity-layer orchestrator as a 7th definition at `RenderLayer.Entities`
- `draw()` becomes:
  ```
  buildPassContext()
  for each layer in [BeforeDepthSort]:
      setupShader if needed → prepare → draw
  sortEntitiesByDepth()  // populates frameContext
  update passCtx.frameContext
  for each layer in [BehindEntities, Entities, AboveEntities, Overlay]:
      prepare all → setupShader if needed → draw
  ```
- The depth sort split point (between BeforeDepthSort and later layers) is the only special case — handled by checking `layer > RenderLayer.BeforeDepthSort`
- Timing collection: each slot's `lastDrawCalls` / `lastSpriteCount` are summed; entity orchestrator exposes detailed breakdown
- `setupColorShader()` is called before passes whose `needs.colorShader` is true

### 3. PassContext as canonical state
**Files**: `src/game/renderer/entity-renderer.ts`
**Key decisions**:
- Remove 20+ private fields that mirror IRenderContext (`this.entities`, `this.selectedEntityId`, `this.unitStates`, `this.territoryDots`, etc.)
- Store `IRenderContext` directly, build `PassContext` in `draw()` from it + GL state (aPosition, dynamicBuffer, etc.)
- `setContext()` becomes a 1-line assignment: `this.renderContext = ctx`
- `buildPassContext()` reads from `this.renderContext` + GL fields — no intermediate private fields
- `EntitySpriteResolver` is still rebuilt per frame (depends on per-frame state providers) — constructed in `buildPassContext()`
- Keep: `mapSize`, `groundHeight` (constructor params), GL state fields (aPosition, aEntityPos, aColor, dynamicBuffer), `spriteManager`, `spriteBatchRenderer`, `selectionOverlayRenderer`, `depthSorter` — these are renderer-owned resources, not context mirrors

### 4. Settler lifecycle coordinator
**Files**: `src/game/features/settler-tasks/settler-lifecycle.ts`
**Key decisions**:
- Extract from SettlerTaskSystem: `registerEvents()`, `onEntityCreated()`, `onEntityRemoved()`, `onBuildingDestroyed()`, `onBuildingCompleted()`, `handleOrphanCheck()`, `handleIdleCooldown()`
- Owns orphan check scheduling (`tickScheduler.schedule`) and idle cooldown map
- Needs read/write access to `runtimes` IndexedMap — passed by reference in config
- Communicates back to SettlerTaskSystem via the `UnitStateMachine` (which handles state transitions)
- Does NOT need WorkerTaskExecutor or WorkHandlerRegistry — lifecycle events don't trigger job execution directly

### 5. Settler debug extractor
**Files**: `src/game/features/settler-tasks/internal/settler-debug.ts`
**Key decisions**:
- Extract: `dumpAllSettlers()`, `getDebugEntries()`, `dumpWorkerAssignments()`
- Pure functions that take a `SettlerDebugSource` interface — no class needed
- Lives in `internal/` — only exported through the system's public API
- ~80-100 lines extracted from SettlerTaskSystem

### 6. Executor context factory
**Files**: `src/game/features/settler-tasks/internal/executor-context-factory.ts`
**Key decisions**:
- Pure function `buildExecutorContexts(deps)` returns all 4 context objects
- Called once in WorkerTaskExecutor constructor (contexts are stable for the system's lifetime)
- Deps interface is the union of what all contexts need — WorkerTaskExecutor passes its existing config
- ~40-60 lines extracted, but the real win is making WorkerTaskExecutor's constructor cleaner and the context dependencies explicit

### 7. Wire extracted modules
**Files**: `src/game/features/settler-tasks/settler-task-system.ts`, `src/game/features/settler-tasks/worker-task-executor.ts`
**Key decisions**:
- SettlerTaskSystem creates `SettlerLifecycleCoordinator` in constructor, delegates `registerEvents()` to it
- SettlerTaskSystem's debug methods become one-liners delegating to `dumpSettlerDebug(this)`
- SettlerTaskSystem implements `SettlerDebugSource` (already has all required methods/fields)
- WorkerTaskExecutor calls `buildExecutorContexts(deps)` instead of inline context construction
- Target: SettlerTaskSystem drops from 593 → ~380 lines, WorkerTaskExecutor from 459 → ~400 lines

## File Map

### New Files
| File | Subsystem | Purpose |
|------|-----------|---------|
| `src/game/renderer/render-passes/entity-layer-orchestrator.ts` | 1 | Wraps 3 entity passes into one registry-compatible pass |
| `src/game/features/settler-tasks/settler-lifecycle.ts` | 4 | Lifecycle event handlers, orphan checks, cooldowns |
| `src/game/features/settler-tasks/internal/settler-debug.ts` | 5 | Debug dump functions |
| `src/game/features/settler-tasks/internal/executor-context-factory.ts` | 6 | Context object construction |

### Modified Files
| File | Change |
|------|--------|
| `src/game/renderer/entity-renderer.ts` | Remove 9 pass fields + 20 context-mirror fields. Rewrite draw() as registry loop. Simplify setContext() to 1-line. |
| `src/game/renderer/render-passes/types.ts` | Add `RenderLayer.Entities = 2`, add `frameContext` to `RenderPassNeeds` |
| `src/game/renderer/render-pass-registry.ts` | No changes needed — already supports the new pattern |
| `src/game/features/settler-tasks/settler-task-system.ts` | Delegate lifecycle events to SettlerLifecycleCoordinator, debug to settler-debug functions |
| `src/game/features/settler-tasks/worker-task-executor.ts` | Use buildExecutorContexts() instead of inline context building |
| `src/game/features/settler-tasks/index.ts` | Export SettlerLifecycleCoordinator if needed by feature wiring |

## Verification

- `pnpm lint` passes — no type errors, no ESLint violations
- `pnpm test:unit` passes — no behavioral changes
- Visual: render output is pixel-identical (same pass order, same shader state)
- EntityRenderer line count drops from 694 → ~400 (below the 400-line aim)
- SettlerTaskSystem drops from 593 → ~380
- WorkerTaskExecutor drops from 459 → ~400
- Grep: no hardcoded `this.pass*` fields remain in entity-renderer.ts (all via registry)
- E2e: settlers still work, renders correctly, task assignment unchanged
