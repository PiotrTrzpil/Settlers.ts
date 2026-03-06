# Inter-System API Redesign — Design

## Overview

Three targeted API redesigns to decouple the most tightly-coupled systems in the codebase:
(1) Replace the embedded `TransportJob` reference inside choreography state with a callback-based transport lifecycle protocol, eliminating the bidirectional dependency between logistics and settler-tasks.
(2) Replace the `ChoreoContext` god object with category-scoped executor contexts, so each executor only sees the services it needs.
(3) Extract domain event handlers from `GameServices` into proper feature modules, reducing the composition root to pure wiring.

## Current State

### What exists today

**Bidirectional coupling between logistics and settler-tasks:**
- `settler-tasks/choreo-types.ts` imports `TransportJob` from `logistics/transport-job.ts`
- `settler-tasks/choreo-types.ts` imports `MaterialTransfer` from `logistics/material-transfer.ts`
- `logistics/transport-job-builder.ts` imports `createChoreoJobState`, `ChoreoJob` from `settler-tasks/choreo-types.ts`
- `logistics/carrier-assigner.ts` imports `JobState` from `settler-tasks/types.ts`
- Transport executors (`settler-tasks/internal/transport-executors.ts`) call `transportJob.consumeReservation()`, `transportJob.fulfillRequest()` directly
- `WorkerTaskExecutor.interruptJob()` calls `job.transportData.transportJob.cancel()`

**ChoreoContext god object:**
- Defined at `settler-tasks/choreo-types.ts:308` — extends `MovementContext`, `WorkContext`, `InventoryContext`, `TransportContext` plus 4 additional fields
- Contains 12+ service references: `gameState`, `inventoryManager`, `carrierManager`, `eventBus`, `handlerErrorLogger`, `jobPartResolver`, `buildingPositionResolver`, `triggerSystem`, `getWorkerHomeBuilding`, `executeCommand`, `materialTransfer`, `barracksTrainingManager`
- Every executor function receives the full bag despite using 2-4 fields
- Sub-interfaces (`MovementContext`, `WorkContext`, etc.) exist but are unused in dispatch

**GameServices domain logic:**
- `onBuildingPlaced` (lines 579-588): construction site registration + inventory creation
- `onBuildingCompleted` (lines 620-635): inventory swap + construction removal + production init + barracks init
- `onInventoryChanged` (lines 591-617): construction delivery tracking + free pile sync
- `onFreePilePlaced` (lines 560-577): territory ownership + inventory registration
- These are domain behaviors scattered in the composition root instead of owned by their feature modules

### What's wrong with it

1. **Bidirectional dependency**: settler-tasks and logistics import each other's internal types. This makes it impossible to test either in isolation and forces understanding of both systems to change either one.

2. **God object context**: The `ChoreoContext` hides which services each executor actually needs. A movement executor appears to have access to `inventoryManager` and `materialTransfer` — adding accidental coupling is just one autocomplete away. New fields added to `ChoreoContext` propagate to all 32 executors even when irrelevant.

3. **Composition root as domain owner**: `GameServices` is supposed to be pure wiring, but it owns the construction lifecycle, free pile registration, and inventory-change reactions. This means changes to construction completion logic require editing the composition root.

### What stays vs what changes

**Preserved behaviors:**
- All executor logic (movement, work, inventory, transport) — same behavior, just narrower context types
- TransportJob lifecycle (reservation, pickup, delivery, cancel) — same steps, accessed through callbacks
- All event subscriptions and cleanup priorities — same ordering, handlers just move to feature modules
- `CHOREO_EXECUTOR_MAP` exhaustive dispatch — same pattern, just with category-specific signatures
- `JobAssigner`, `TransportPositionResolver`, `ChoreographyLookup` interfaces — already clean

**What changes:**
- `ChoreoJobState.transportData.transportJob: TransportJob` → `ChoreoJobState.transportCallbacks?: TransportCallbacks`
- `ChoreoExecutorFn` signature becomes category-specific (4 variants instead of 1)
- `ChoreoContext` interface deleted, replaced by per-category context construction in `WorkerTaskExecutor`
- `MaterialTransfer` moves from `features/logistics/` to `features/material-transfer/` (it's a cross-cutting conservation service, not logistics)
- Domain handlers move from `GameServices` into `BuildingLifecycleFeature` and `FreePileFeature`

### What gets deleted

| File/Symbol | Reason |
|---|---|
| `ChoreoContext` interface | Replaced by category-specific contexts |
| `ChoreoExecutorFn` single type | Replaced by 4 category-specific executor types |
| `TransportData.transportJob` field | Replaced by `TransportCallbacks` |
| `GameServices.onBuildingPlaced()` | Moved to `BuildingLifecycleFeature` |
| `GameServices.onBuildingCompleted()` | Moved to `BuildingLifecycleFeature` |
| `GameServices.onInventoryChanged()` | Moved to `BuildingLifecycleFeature` + `FreePileFeature` |
| `GameServices.onFreePilePlaced()` | Moved to `FreePileFeature` |

## Summary for Review

- **Interpretation**: The codebase has three structural problems: a bidirectional dependency between logistics and settler-tasks (via embedded TransportJob), a god-object context passed to all choreography executors, and domain logic in the composition root. This design fixes all three.

- **Assumptions**: MaterialTransfer is a cross-cutting service, not a logistics concept — it serves both workers and carriers equally. The existing sub-interfaces (MovementContext, WorkContext, InventoryContext, TransportContext) correctly capture the dependency boundaries for executor categories. Construction lifecycle (place → build → complete) is a cohesive feature that belongs in building-construction, not spread across GameServices.

- **Architecture**: Transport lifecycle becomes a callback interface — logistics creates the callbacks, choreography calls them, neither imports the other's internals. Executor dispatch uses a two-level map: category → context constructor → executor function. GameServices becomes pure wiring with no event handler bodies.

- **Contracts & boundaries**: `TransportCallbacks` is the only type that crosses from logistics into settler-tasks. Each executor category declares its exact context type. Feature modules self-register all event handlers.

- **Scope**: Covers the three changes above. Does NOT touch: event bus design, command system, carrier state management, request matching, or inventory internals.

## Project Conventions (extracted)

### Code Style
- Config objects for 3+ dependencies: `interface FooConfig { ... }` with required fields
- Feature modules have `index.ts` with JSDoc public API header
- Internal implementation in `internal/` subdirectories
- Path alias: `@/` → `src/`

### Error Handling
- Optimistic: trust internal data, crash with context on violated invariants
- `getEntityOrThrow(id, 'context')` — never bare `!`
- No optional chaining on required deps — use `!.` not `?.`
- No silent fallbacks (`?? 0`) when value must exist

### Type Philosophy
- Required dependencies are required fields, not optional
- `definite assignment assertion` (`!:`) for fields set in init, not `?:`
- Return `Readonly<T>` / `ReadonlyArray<T>` from query methods

### Representative Pattern

```typescript
// Feature module pattern (from src/game/features/carriers/)

// index.ts — public API only
export { CarrierManager } from './carrier-manager';
export { CarrierFeature, type CarrierFeatureExports } from './carrier-feature';
export type { CarrierState } from './carrier-state';

// carrier-feature.ts — self-registering via FeatureRegistry
export interface CarrierFeatureExports {
    carrierManager: CarrierManager;
}

export const CarrierFeature: FeatureDefinition<CarrierFeatureExports> = {
    name: 'carriers',
    create(ctx) {
        const carrierManager = new CarrierManager(ctx.eventBus);
        ctx.cleanupRegistry.onEntityRemoved(id => carrierManager.removeCarrier(id));
        return {
            exports: { carrierManager },
            systems: [],
        };
    },
};
```

## Architecture

### Data Flow

```
LogisticsDispatcher.tick()
  → RequestMatcher.matchRequest()
  → CarrierAssigner.tryAssign()
    → TransportJob.create() [reservation + request status]
    → TransportJobBuilder.build() [ChoreoJobState + TransportCallbacks]
    → JobAssigner.assignJob() [opaque job to SettlerTaskSystem]

SettlerTaskSystem.tick()
  → WorkerTaskExecutor.handleWorking()
    → categoryDispatch(node.task) [selects executor + builds narrow context]
    → executor(settler, job, node, dt, narrowCtx)
      → on GET_GOOD with transport: calls callbacks.onPickedUp()
      → on PUT_GOOD with transport: calls callbacks.onDelivered()
    → on interrupt: calls callbacks.onCancelled()
```

### Subsystems

| # | Subsystem | Responsibility | Depends On | Files |
|---|-----------|----------------|------------|-------|
| 1 | Transport Callbacks | Callback interface replacing TransportJob embedding | — | choreo-types.ts, transport-job-builder.ts |
| 2 | Scoped Executor Contexts | Per-category context types + dispatch | 1 | choreo-types.ts, choreo-executors.ts, worker-task-executor.ts |
| 3 | Movement Executors | Update executor signatures to MovementContext | 2 | internal/movement-executors.ts |
| 4 | Work Executors | Update executor signatures to WorkContext | 2 | internal/work-executors.ts |
| 5 | Inventory + Transport Executors | Update executor signatures to InventoryContext/TransportContext | 1, 2 | internal/inventory-executors.ts, internal/transport-executors.ts |
| 6 | MaterialTransfer Relocation | Move to shared feature module | — | features/material-transfer/ |
| 7 | Building Lifecycle Feature | Extract domain handlers from GameServices | 6 | features/building-construction/building-lifecycle-feature.ts |
| 8 | Free Pile Feature | Extract free pile handlers from GameServices | 6 | features/free-piles/free-pile-feature.ts |

## Shared Contracts (as code)

### Transport Callbacks (replaces TransportJob embedding)

```typescript
// In: src/game/features/settler-tasks/choreo-types.ts
// Replaces: TransportData.transportJob: TransportJob

/**
 * Callbacks provided by the logistics system for transport job lifecycle.
 * The choreography system calls these at the right moments without
 * knowing anything about reservations, request status, or transport jobs.
 */
export interface TransportCallbacks {
    /**
     * Called after MaterialTransfer.pickUp() succeeds at the source building.
     * Logistics side: consumes the inventory reservation.
     */
    onPickedUp(): void;

    /**
     * Called after MaterialTransfer.deliver() succeeds at the destination building.
     * Logistics side: marks the request as fulfilled.
     */
    onDelivered(): void;

    /**
     * Called when the transport is interrupted (carrier died, path blocked, etc.).
     * Logistics side: releases reservation and resets request to pending.
     * Safe to call multiple times — subsequent calls are no-ops.
     */
    onCancelled(): void;
}

/** Transport metadata stored on ChoreoJobState for carrier transport jobs. */
export interface TransportData {
    /** Callbacks for transport lifecycle (replaces embedded TransportJob reference). */
    callbacks: TransportCallbacks;
    /** Source building entity ID (pickup location). */
    sourceBuildingId: number;
    /** Destination building entity ID (delivery location). */
    destBuildingId: number;
    /** Material being transported. */
    material: EMaterialType;
    /** Amount to transport (may be reduced after pickup if source had less). */
    amount: number;
    /** Pre-resolved source position (output pile / door for pickup). */
    sourcePos: { x: number; y: number };
    /** Pre-resolved destination position (input pile / door for delivery). */
    destPos: { x: number; y: number };
}
```

### Category-Scoped Executor Types (replaces ChoreoExecutorFn)

```typescript
// In: src/game/features/settler-tasks/choreo-types.ts

/** Movement executor — GO_TO_*, SEARCH, GO_HOME, GO_VIRTUAL */
export type MovementExecutorFn = (
    settler: Entity,
    job: ChoreoJobState,
    node: ChoreoNode,
    dt: number,
    ctx: MovementContext
) => TaskResult;

/** Work executor — WORK, WORK_ON_ENTITY, PLANT, *_VIRTUAL, PRODUCE_VIRTUAL */
export type WorkExecutorFn = (
    settler: Entity,
    job: ChoreoJobState,
    node: ChoreoNode,
    dt: number,
    ctx: WorkContext
) => TaskResult;

/** Inventory executor — GET_GOOD, PUT_GOOD, RESOURCE_GATHERING, LOAD_GOOD, *_VIRTUAL */
export type InventoryExecutorFn = (
    settler: Entity,
    job: ChoreoJobState,
    node: ChoreoNode,
    dt: number,
    ctx: InventoryExecutorContext
) => TaskResult;

/** Control executor — WAIT, CHECKIN, CHANGE_JOB, military, auto-recruit */
export type ControlExecutorFn = (
    settler: Entity,
    job: ChoreoJobState,
    node: ChoreoNode,
    dt: number,
    ctx: ControlContext
) => TaskResult;

/**
 * Extended inventory context for executors that handle both worker and carrier paths.
 * Includes materialTransfer (needed by both) and eventBus (carrier events).
 */
export interface InventoryExecutorContext extends InventoryContext {
    materialTransfer: MaterialTransfer;
    eventBus: EventBus;
}

/**
 * Context for control executors (WAIT, CHECKIN, CHANGE_JOB, military stubs).
 * Minimal — most control nodes are timers or state transitions.
 */
export interface ControlContext {
    gameState: GameState;
    eventBus: EventBus;
    handlerErrorLogger: ThrottledLogger;
    /** Barracks training manager — only needed by CHANGE_TYPE_AT_BARRACKS. */
    barracksTrainingManager?: BarracksTrainingManager;
    /** Command executor — needed by TRANSFORM_RECRUIT. */
    executeCommand?: (cmd: Command) => CommandResult;
}
```

### Category Dispatch Map (replaces single CHOREO_EXECUTOR_MAP)

```typescript
// In: src/game/features/settler-tasks/choreo-executors.ts

/** Executor category — determines which context type is constructed. */
export enum ExecutorCategory {
    MOVEMENT,
    WORK,
    INVENTORY,
    CONTROL,
}

/** Maps ChoreoTaskType to its category for context construction. */
export const TASK_CATEGORY: Record<ChoreoTaskType, ExecutorCategory> = {
    [ChoreoTaskType.GO_TO_TARGET]: ExecutorCategory.MOVEMENT,
    [ChoreoTaskType.GO_TO_TARGET_ROUGHLY]: ExecutorCategory.MOVEMENT,
    [ChoreoTaskType.GO_TO_POS]: ExecutorCategory.MOVEMENT,
    [ChoreoTaskType.GO_TO_POS_ROUGHLY]: ExecutorCategory.MOVEMENT,
    [ChoreoTaskType.GO_TO_SOURCE_PILE]: ExecutorCategory.MOVEMENT,
    [ChoreoTaskType.GO_TO_DESTINATION_PILE]: ExecutorCategory.MOVEMENT,
    [ChoreoTaskType.GO_HOME]: ExecutorCategory.MOVEMENT,
    [ChoreoTaskType.GO_VIRTUAL]: ExecutorCategory.MOVEMENT,
    [ChoreoTaskType.SEARCH]: ExecutorCategory.MOVEMENT,

    [ChoreoTaskType.WORK]: ExecutorCategory.WORK,
    [ChoreoTaskType.WORK_ON_ENTITY]: ExecutorCategory.WORK,
    [ChoreoTaskType.WORK_VIRTUAL]: ExecutorCategory.WORK,
    [ChoreoTaskType.WORK_ON_ENTITY_VIRTUAL]: ExecutorCategory.WORK,
    [ChoreoTaskType.PRODUCE_VIRTUAL]: ExecutorCategory.WORK,
    [ChoreoTaskType.PLANT]: ExecutorCategory.WORK,

    [ChoreoTaskType.GET_GOOD]: ExecutorCategory.INVENTORY,
    [ChoreoTaskType.GET_GOOD_VIRTUAL]: ExecutorCategory.INVENTORY,
    [ChoreoTaskType.PUT_GOOD]: ExecutorCategory.INVENTORY,
    [ChoreoTaskType.PUT_GOOD_VIRTUAL]: ExecutorCategory.INVENTORY,
    [ChoreoTaskType.RESOURCE_GATHERING]: ExecutorCategory.INVENTORY,
    [ChoreoTaskType.RESOURCE_GATHERING_VIRTUAL]: ExecutorCategory.INVENTORY,
    [ChoreoTaskType.LOAD_GOOD]: ExecutorCategory.INVENTORY,

    [ChoreoTaskType.WAIT]: ExecutorCategory.CONTROL,
    [ChoreoTaskType.WAIT_VIRTUAL]: ExecutorCategory.CONTROL,
    [ChoreoTaskType.CHECKIN]: ExecutorCategory.CONTROL,
    [ChoreoTaskType.CHANGE_JOB]: ExecutorCategory.CONTROL,
    [ChoreoTaskType.CHANGE_JOB_COME_TO_WORK]: ExecutorCategory.CONTROL,
    [ChoreoTaskType.CHANGE_TYPE_AT_BARRACKS]: ExecutorCategory.CONTROL,
    [ChoreoTaskType.HEAL_ENTITY]: ExecutorCategory.CONTROL,
    [ChoreoTaskType.ATTACK_REACTION]: ExecutorCategory.CONTROL,
    [ChoreoTaskType.TRANSFORM_RECRUIT]: ExecutorCategory.CONTROL,
};

/** Per-category executor maps. */
export const MOVEMENT_EXECUTORS: Record</* movement ChoreoTaskTypes */, MovementExecutorFn> = { ... };
export const WORK_EXECUTORS: Record</* work ChoreoTaskTypes */, WorkExecutorFn> = { ... };
export const INVENTORY_EXECUTORS: Record</* inventory ChoreoTaskTypes */, InventoryExecutorFn> = { ... };
export const CONTROL_EXECUTORS: Record</* control ChoreoTaskTypes */, ControlExecutorFn> = { ... };
```

### TransportJob Callback Factory (in logistics)

```typescript
// In: src/game/features/logistics/transport-job.ts (addition)

import type { TransportCallbacks } from '../settler-tasks/choreo-types';

// On TransportJob class:
/**
 * Create TransportCallbacks for embedding in choreography state.
 * The callbacks close over this TransportJob instance.
 */
toCallbacks(): TransportCallbacks {
    return {
        onPickedUp: () => this.consumeReservation(),
        onDelivered: () => this.fulfillRequest(),
        onCancelled: () => this.cancel(),
    };
}
```

### MaterialTransfer Module (relocated)

```typescript
// New location: src/game/features/material-transfer/index.ts
export { MaterialTransfer } from './material-transfer';

// New location: src/game/features/material-transfer/material-transfer-feature.ts
export interface MaterialTransferExports {
    materialTransfer: MaterialTransfer;
}

export const MaterialTransferFeature: FeatureDefinition<MaterialTransferExports> = {
    name: 'material-transfer',
    create(ctx) {
        const materialTransfer = new MaterialTransfer(
            ctx.gameState,
            ctx.getFeatureExports<InventoryExports>('inventory').inventoryManager,
            ctx.executeCommand,
            ctx.eventBus,
        );
        ctx.cleanupRegistry.onEntityRemoved(
            materialTransfer.onEntityRemoved.bind(materialTransfer),
            CLEANUP_PRIORITY.EARLY,
        );
        return { exports: { materialTransfer }, systems: [] };
    },
};
```

## API Contracts

### Events (unchanged)

No event changes. All existing events (`carrier:pickupComplete`, `carrier:deliveryComplete`, `carrier:transportCancelled`, `carrier:pickupFailed`, `carrier:assigned`, etc.) continue to be emitted with the same payloads from the same sources.

### New Feature Exports

| Feature | Export Interface | Key Exports |
|---|---|---|
| `material-transfer` | `MaterialTransferExports` | `materialTransfer: MaterialTransfer` |
| `building-lifecycle` | (none — pure event handler) | — |
| `free-piles` | (none — pure event handler) | — |

## Subsystem Details

### Subsystem 1: Transport Callbacks

**Files**: `src/game/features/settler-tasks/choreo-types.ts`, `src/game/features/logistics/transport-job.ts`, `src/game/features/logistics/transport-job-builder.ts`

**Owns**: The interface contract between logistics and choreography for transport lifecycle.

**Key decisions**:
- `TransportCallbacks` is defined in `settler-tasks/choreo-types.ts` (the consumer side defines the interface it needs — Dependency Inversion)
- `TransportJob.toCallbacks()` is the only place that bridges the TransportJob implementation to the callback interface
- `TransportData` no longer has a `transportJob` field — it has `callbacks: TransportCallbacks`

**Behavior**:
- `TransportJobBuilder.build()` calls `transportJob.toCallbacks()` and embeds the result in `TransportData.callbacks`
- Transport executors call `td.callbacks.onPickedUp()` after successful material pickup (replaces `td.transportJob.consumeReservation()`)
- Transport executors call `td.callbacks.onDelivered()` after successful material delivery (replaces `td.transportJob.fulfillRequest()`)
- `WorkerTaskExecutor.interruptJob()` calls `job.transportData.callbacks.onCancelled()` (replaces `job.transportData.transportJob.cancel()`)
- `onCancelled()` is idempotent (TransportJob.cancel already handles double-call)

**Migration**:
1. Add `TransportCallbacks` interface to `choreo-types.ts`
2. Replace `transportJob: TransportJob` with `callbacks: TransportCallbacks` in `TransportData`
3. Add `toCallbacks()` method to `TransportJob`
4. Update `TransportJobBuilder.build()` to use `transportJob.toCallbacks()`
5. Update transport executors to call `td.callbacks.*` instead of `td.transportJob.*`
6. Update `WorkerTaskExecutor.interruptJob()` similarly
7. Remove the `import type { TransportJob }` from `choreo-types.ts`

### Subsystem 2: Scoped Executor Contexts

**Files**: `src/game/features/settler-tasks/choreo-types.ts`, `src/game/features/settler-tasks/choreo-executors.ts`, `src/game/features/settler-tasks/worker-task-executor.ts`

**Owns**: The dispatch mechanism that selects the right executor and constructs its minimal context.

**Key decisions**:
- Four executor categories: Movement, Work, Inventory, Control — matching the existing sub-interfaces
- `TASK_CATEGORY` map classifies each `ChoreoTaskType` into a category
- Four separate executor maps (`MOVEMENT_EXECUTORS`, etc.) replace the single `CHOREO_EXECUTOR_MAP`
- `WorkerTaskExecutor` constructs the category-specific context at dispatch time
- The `ChoreoContext` interface is deleted — it no longer exists as a type

**Behavior**:
- `WorkerTaskExecutor.handleWorking()` looks up `TASK_CATEGORY[node.task]` to determine the category
- Based on category, it constructs the minimal context and calls the right executor from the right map
- Context construction happens per-tick but is cheap (object literals from stored references)
- Work handlers (`entityHandler`, `positionHandler`) are only included in Movement and Work contexts (where SEARCH and WORK_ON_ENTITY need them)

**Dispatch in WorkerTaskExecutor**:
```typescript
private executeNode(
    settler: Entity, job: ChoreoJobState, node: ChoreoNode,
    dt: number, config: SettlerConfig
): TaskResult {
    const category = TASK_CATEGORY[node.task];
    const entityHandler = this.handlerRegistry.getEntityHandler(config.search);
    const positionHandler = this.handlerRegistry.getPositionHandler(config.plantSearch ?? config.search);

    switch (category) {
        case ExecutorCategory.MOVEMENT:
            return MOVEMENT_EXECUTORS[node.task as keyof typeof MOVEMENT_EXECUTORS](
                settler, job, node, dt,
                { ...this.movementCtxBase, entityHandler, positionHandler }
            );
        case ExecutorCategory.WORK:
            return WORK_EXECUTORS[node.task as keyof typeof WORK_EXECUTORS](
                settler, job, node, dt,
                { ...this.workCtxBase, entityHandler, positionHandler }
            );
        case ExecutorCategory.INVENTORY:
            return INVENTORY_EXECUTORS[node.task as keyof typeof INVENTORY_EXECUTORS](
                settler, job, node, dt, this.inventoryCtx
            );
        case ExecutorCategory.CONTROL:
            return CONTROL_EXECUTORS[node.task as keyof typeof CONTROL_EXECUTORS](
                settler, job, node, dt, this.controlCtx
            );
    }
}
```

**Migration**:
1. Define `ExecutorCategory` enum and `TASK_CATEGORY` map
2. Define four executor function types (`MovementExecutorFn`, etc.)
3. Define `InventoryExecutorContext` and `ControlContext` interfaces
4. Split `CHOREO_EXECUTOR_MAP` into four category maps
5. Store base context objects as readonly fields on `WorkerTaskExecutor`
6. Replace the single executor call in `handleWorking()` with `executeNode()` switch
7. Delete `ChoreoContext` and `ChoreoExecutorFn`
8. Update `settler-tasks/index.ts` exports (remove `ChoreoContext`)

### Subsystem 3: Movement Executors

**Files**: `src/game/features/settler-tasks/internal/movement-executors.ts`

**Owns**: All GO_TO_* and SEARCH executor functions.

**Key decisions**:
- Executor signatures change from `ChoreoExecutorFn` (with `ChoreoContext`) to `MovementExecutorFn` (with `MovementContext`)
- No behavioral changes — same logic, narrower type

**Behavior**:
- Each function's parameter `ctx: ChoreoContext` becomes `ctx: MovementContext`
- All accessed fields (`ctx.gameState`, `ctx.buildingPositionResolver`, `ctx.getWorkerHomeBuilding`, `ctx.handlerErrorLogger`, `ctx.entityHandler`, `ctx.positionHandler`) are already in `MovementContext`
- No other `ctx` fields are used by movement executors — verified by reading current code

### Subsystem 4: Work Executors

**Files**: `src/game/features/settler-tasks/internal/work-executors.ts`

**Owns**: All WORK, WORK_ON_ENTITY, PLANT, and *_VIRTUAL executor functions.

**Key decisions**:
- Signatures change to `WorkExecutorFn` with `WorkContext`
- No behavioral changes

**Behavior**:
- Each function's parameter `ctx: ChoreoContext` becomes `ctx: WorkContext`
- All accessed fields (`ctx.gameState`, `ctx.triggerSystem`, `ctx.getWorkerHomeBuilding`, `ctx.handlerErrorLogger`, `ctx.entityHandler`, `ctx.positionHandler`) are already in `WorkContext`

### Subsystem 5: Inventory + Transport Executors

**Files**: `src/game/features/settler-tasks/internal/inventory-executors.ts`, `src/game/features/settler-tasks/internal/transport-executors.ts`

**Owns**: All GET_GOOD, PUT_GOOD, RESOURCE_GATHERING, LOAD_GOOD executors and the transport-specific delegation.

**Key decisions**:
- Signatures change to `InventoryExecutorFn` with `InventoryExecutorContext`
- `InventoryExecutorContext` extends `InventoryContext` with `materialTransfer` and `eventBus` (needed by transport executors for carrier events)
- Transport executors also take `InventoryExecutorContext` — they need `materialTransfer` and `eventBus`
- Transport executors call `td.callbacks.onPickedUp()` / `td.callbacks.onDelivered()` instead of `td.transportJob.consumeReservation()` / `td.transportJob.fulfillRequest()`

**Behavior**:
- `executeGetGood`: when `job.transportData` is present, calls `executeTransportPickup` which now calls `td.callbacks.onPickedUp()` instead of `transportJob.consumeReservation()`
- `executePutGood`: when `job.transportData` is present, calls `executeTransportDelivery` which now calls `td.callbacks.onDelivered()` instead of `transportJob.fulfillRequest()`
- Worker paths (no `transportData`) use `ctx.materialTransfer.pickUp()` / `ctx.inventoryManager.depositOutput()` — unchanged
- `executeResourceGathering`: uses `ctx.materialTransfer.produce()` — same as before but via `InventoryExecutorContext` instead of `ChoreoContext`

### Subsystem 6: MaterialTransfer Relocation

**Files**: `src/game/features/material-transfer/material-transfer.ts`, `src/game/features/material-transfer/material-transfer-feature.ts`, `src/game/features/material-transfer/index.ts`

**Owns**: The MaterialTransfer class and its feature registration.

**Key decisions**:
- MaterialTransfer moves from `features/logistics/material-transfer.ts` to `features/material-transfer/material-transfer.ts`
- It becomes a FeatureRegistry-registered feature with its own exports
- This reflects its true nature: a cross-cutting material conservation service used by both workers and carriers
- The cleanup handler (CLEANUP_PRIORITY.EARLY) moves into the feature's `create()` function

**Behavior**:
- No behavioral changes to MaterialTransfer itself
- Imports update across the codebase: `from '../logistics/material-transfer'` → `from '../material-transfer'`
- GameServices no longer creates MaterialTransfer directly — it comes from FeatureRegistry

**Migration**:
1. Create `features/material-transfer/` directory with `material-transfer.ts` (moved), `material-transfer-feature.ts` (new), `index.ts` (new)
2. Register `MaterialTransferFeature` in GameServices' `featureRegistry.loadAll()` (requires `InventoryFeature` loaded first)
3. Remove MaterialTransfer construction and EARLY cleanup registration from GameServices constructor
4. Update all imports across the codebase (use `sd` for bulk replacement)
5. Remove re-export from `features/logistics/index.ts`

### Subsystem 7: Building Lifecycle Feature

**Files**: `src/game/features/building-construction/building-lifecycle-feature.ts`

**Owns**: Domain event handlers for building placement, completion, and construction delivery tracking.

**Key decisions**:
- Not a TickSystem — purely event-driven
- Registered via FeatureRegistry, subscribes to `building:placed`, `building:completed`, `inventory:changed`
- Depends on: `ConstructionSiteManager`, `BuildingInventoryManager`, `ProductionControlManager`, `BarracksTrainingManager`
- The `BarracksTrainingManager` and `ProductionControlManager` dependencies are resolved lazily (they're created after the feature registry loads)

**Behavior** — extracted verbatim from GameServices:
- `building:placed`: Register construction site, create construction inventory
- `building:completed`: Swap inventory phase, remove construction site, init production control, init barracks
- `inventory:changed` (input increase): Record construction delivery if site exists
- Cleanup: Remove production control + barracks state on entity removal

**Migration**:
1. Create `building-lifecycle-feature.ts` with the four handler methods
2. Register as a feature in `featureRegistry.loadAll()` (after construction, inventory, and logistics features)
3. Remove the corresponding methods and subscriptions from GameServices
4. Update GameServices to retrieve `ProductionControlManager` and `BarracksTrainingManager` from the feature's exports (or continue creating them directly)

### Subsystem 8: Free Pile Feature

**Files**: `src/game/features/free-piles/free-pile-feature.ts`, `src/game/features/free-piles/index.ts`

**Owns**: Free pile creation, territory ownership assignment, inventory registration, and depletion sync.

**Key decisions**:
- Event-driven feature: subscribes to `pile:freePilePlaced` and `inventory:changed` (output decrease for piles)
- Depends on: `TerritoryManager`, `BuildingInventoryManager`, `GameState`
- TerritoryManager is resolved lazily (created in `setTerrainData`)

**Behavior** — extracted from GameServices:
- `pile:freePilePlaced`: Assign territory-based ownership, register output-only inventory, deposit initial quantity
- `inventory:changed` (output decrease on StackedPile): Update pile quantity, remove entity when depleted

**Migration**:
1. Create `features/free-piles/` directory
2. Move handler logic from GameServices
3. Register in `featureRegistry.loadAll()`
4. Remove handlers from GameServices

## File Map

### New Files

| File | Subsystem | Purpose |
|------|-----------|---------|
| `src/game/features/material-transfer/material-transfer.ts` | 6 | Moved from logistics |
| `src/game/features/material-transfer/material-transfer-feature.ts` | 6 | FeatureRegistry registration |
| `src/game/features/material-transfer/index.ts` | 6 | Public API barrel |
| `src/game/features/building-construction/building-lifecycle-feature.ts` | 7 | Domain event handlers |
| `src/game/features/free-piles/free-pile-feature.ts` | 8 | Free pile handlers |
| `src/game/features/free-piles/index.ts` | 8 | Public API barrel |

### Modified Files

| File | Subsystem | Change |
|------|-----------|--------|
| `src/game/features/settler-tasks/choreo-types.ts` | 1, 2 | Add `TransportCallbacks`; replace `transportJob` in `TransportData`; add category executor types; add `InventoryExecutorContext`, `ControlContext`; remove `ChoreoContext`, `ChoreoExecutorFn` |
| `src/game/features/settler-tasks/choreo-executors.ts` | 2 | Split into 4 category maps + `TASK_CATEGORY`; delete `CHOREO_EXECUTOR_MAP` |
| `src/game/features/settler-tasks/worker-task-executor.ts` | 2 | Store base contexts; add `executeNode()` switch dispatch; remove `ChoreoContext` construction |
| `src/game/features/settler-tasks/settler-task-system.ts` | 2 | Remove `ChoreoContext` construction; pass base context parts to `WorkerTaskExecutor` |
| `src/game/features/settler-tasks/internal/movement-executors.ts` | 3 | Change signatures to `MovementExecutorFn` |
| `src/game/features/settler-tasks/internal/work-executors.ts` | 4 | Change signatures to `WorkExecutorFn` |
| `src/game/features/settler-tasks/internal/inventory-executors.ts` | 5 | Change signatures to `InventoryExecutorFn`; update transport delegation |
| `src/game/features/settler-tasks/internal/transport-executors.ts` | 1, 5 | Use `td.callbacks.*` instead of `td.transportJob.*`; change signature |
| `src/game/features/settler-tasks/internal/control-executors.ts` | 2 | Change signatures to `ControlExecutorFn` |
| `src/game/features/settler-tasks/index.ts` | 2 | Remove `ChoreoContext` export |
| `src/game/features/logistics/transport-job.ts` | 1 | Add `toCallbacks()` method |
| `src/game/features/logistics/transport-job-builder.ts` | 1 | Use `transportJob.toCallbacks()` in `build()` |
| `src/game/features/logistics/index.ts` | 6 | Remove `MaterialTransfer` re-export |
| `src/game/features/auto-recruit/recruitment-job.ts` | 2 | Change signature to `ControlExecutorFn` |
| `src/game/game-services.ts` | 6, 7, 8 | Remove domain handlers; add new features to registry; get MaterialTransfer from feature exports |
| `src/composables/useLogisticsDebug.ts` | 6 | Update MaterialTransfer import path |
| `src/composables/useCarrierDebugInfo.ts` | 6 | Update MaterialTransfer import path (if applicable) |

### Deleted Files

| File | Reason |
|------|--------|
| `src/game/features/logistics/material-transfer.ts` | Moved to `features/material-transfer/` |

## Verification

- **Transport lifecycle**: Create a transport job via LogisticsDispatcher. Verify carrier picks up (callbacks.onPickedUp fires, reservation consumed), delivers (callbacks.onDelivered fires, request fulfilled), and on interrupt (callbacks.onCancelled fires, reservation released, request reset to pending). Run `pnpm test:unit -- tests/unit/economy/transport-job.spec.ts`.

- **Executor context narrowing**: Verify each executor compiles with its narrow context type. Run `pnpm lint` — type errors will surface if any executor accesses a field not in its context.

- **MaterialTransfer relocation**: Run `pnpm lint` — import resolution errors will catch any missed updates. Verify material conservation still works: carrier dies while carrying → material dropped as free pile.

- **GameServices simplification**: Verify building placement → construction → completion lifecycle works end-to-end. Place a building, deliver materials, verify construction completes and production inventory is created. Run `pnpm test:unit -- tests/unit/integration/`.

- **Full regression**: `pnpm test:unit 2>&1 | tee /tmp/test.txt` — all existing tests pass with no behavioral changes.
