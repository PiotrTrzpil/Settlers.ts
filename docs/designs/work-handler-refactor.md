# Work Handler Type Refactor — Design

## Overview

Refactor `SearchArea` from `{ center, radius: number | undefined }` into a discriminated union with a `bounded` variant (required `radius: number`) and a `self` variant (settler origin, no radius). Add `NullWorkHandler` for externally-dispatched settlers. Extract shared work lifecycle interfaces. Keep the existing entity-vs-position handler split and two-field context structure.

## Current State

- **What exists**: `EntityWorkHandler` and `PositionWorkHandler` discriminated by `WorkHandlerType` enum. Both receive `SearchArea { center: Tile; radius: number | undefined }` via `findTarget`/`findPosition`. A `resolveSearchArea()` function bridges between home-building state and this flat type. Dummy handlers (carrier, construction noop) implement the full interface just to suppress warnings.
- **What stays**: Entity-vs-position as the primary handler split. Two handler fields on `MovementContext`/`WorkContext` (needed for dual-mode settlers). `WorkHandlerRegistry` with separate entity/position maps. `JobSelector`, choreography executor pipeline. All handler factory functions.
- **What changes**: `SearchArea` becomes a discriminated union. `resolveSearchArea` returns typed variants. `WorkHandlerType` gains a `NULL` variant. Shared lifecycle interfaces extracted. Dummy handlers replaced by `NullWorkHandler`.
- **What gets deleted**: The `if (radius === undefined) throw` guards in bounded handlers (radius guaranteed by type). Dummy `findTarget: () => null` / `canWork: () => false` / `onWorkTick: () => true` on carrier and construction noop handlers.

## Summary for Review

- **Interpretation**: Targeted cleanup of `SearchArea` and handler types, not a full architectural overhaul. The entity-vs-position split is the right primary axis — it determines choreography flow (GO_TO_TARGET → WORK_ON_ENTITY vs GO_TO_POS → WORK) and maps 1:1 to context fields and executor paths. Search strategy is encoded in the `SearchArea` discriminant, not the handler type.
- **Key decisions**:
  - `SearchArea` becomes `BoundedArea | SelfArea` — bounded has required `radius: number`, self has just `origin: Tile`
  - `NullWorkHandler` replaces dummy handlers — no search methods, no lifecycle methods
  - `EntityWorkLifecycle` and `PositionWorkLifecycle` extracted as shared interfaces for type narrowing in executors
  - Context keeps two handler fields (`entityHandler`, `positionHandler`) — dual-mode settlers (farmer: harvest entity + plant position) need both on the context for SEARCH choreography fallback
  - `resolveSearchArea` stays but returns the discriminated union — callers unchanged
- **Assumptions**: Bounded handlers assert `area.type === 'bounded'` (optimistic). Workplace handler ignores area. Free-roaming handler uses only `area.origin` from the `self` variant.
- **Scope**: `SearchArea` type, handler interfaces, handler factories, registry (minor). Does NOT change choreography nodes, job selector, context field structure, executor pipeline shape.

## Conventions

- **Optimistic programming**:
  - `radius` on `BoundedArea` is `number`, not `number | undefined` — no runtime guards needed in bounded handlers.
  - Bounded handlers assert `area.type === 'bounded'` and access `area.radius` directly — throws at the type level if wrong variant is passed.
  - No `default: return null` in exhaustive switches — let TypeScript enforce completeness.
  - Executors that require a handler throw with context on null — no silent skip.
  - No `!` non-null assertions — use explicit checks that throw with context.
- Explicit interfaces, no `Pick`/`Omit` for public APIs.
- Factory functions for handlers (`createXxxHandler()`), stateless closures over dependencies.
- Max 600 lines per TS file, 250 lines per function. Extract helpers early.

## Architecture

### Subsystems

| # | Subsystem | Responsibility | Depends On | Files |
|---|-----------|---------------|------------|-------|
| 1 | Contracts | SearchArea union, NullWorkHandler, lifecycle interfaces | — | `types.ts`, `choreo-types.ts` |
| 2 | Registry | Add NULL handler support, single map | 1 | `work-handler-registry.ts` |
| 3 | Executor search | Update resolveSearchArea, handler dispatch uses SearchArea discriminant | 1 | `worker-task-executor.ts`, `movement-executors.ts`, `choreo-types.ts` |
| 4 | Bounded handlers | Remove radius-undefined throw guards, use BoundedArea | 1 | `trees/work-handlers.ts`, `stones/work-handlers.ts`, `crops/work-handlers.ts`, `settler-tasks/work-handlers.ts` (water) |
| 5 | Other handlers | NullWorkHandler for carrier/construction, free-roaming uses SelfArea | 1 | `settler-tasks/work-handlers.ts`, `construction-demand-feature.ts`, `pioneer/work-handlers.ts`, `ore-veins/work-handlers.ts`, `activated-position-handler.ts` |
| 6 | Registration sites | Update register() calls for NullWorkHandler | 1, 2 | `settler-task-system.ts`, `construction-demand-feature.ts` |

## Shared Contracts

```typescript
// ── src/game/features/settler-tasks/choreo-types.ts ──

/** Bounded work area: building-centered with required radius. */
export interface BoundedArea {
    type: 'bounded';
    center: Tile;
    radius: number;
}

/** Self-centered area: settler's current position, no radius constraint. */
export interface SelfArea {
    type: 'self';
    origin: Tile;
}

/** Discriminated search area — handlers switch on type to get the right fields. */
export type SearchArea = BoundedArea | SelfArea;

/**
 * Resolve the search area for a work handler.
 *
 * Home building with work area → BoundedArea (center + radius from building).
 * Otherwise → SelfArea (settler position).
 */
export function resolveSearchArea(
    settler: Tile,
    homeBuildingId: number | null,
    resolver: BuildingPositionResolver
): SearchArea {
    if (homeBuildingId !== null && resolver.hasWorkArea(homeBuildingId)) {
        return {
            type: 'bounded',
            center: resolver.getWorkAreaCenter(homeBuildingId),
            radius: resolver.getWorkAreaRadius(homeBuildingId),
        };
    }
    return { type: 'self', origin: settler };
}
```

```typescript
// ── src/game/features/settler-tasks/types.ts ──

export enum WorkHandlerType {
    /** Externally dispatched — no autonomous search (carriers, builders, diggers). */
    NULL = 'null',
    ENTITY = 'entity',
    POSITION = 'position',
}

// ── Shared work lifecycle interfaces ──

/** Entity work lifecycle — shared by all handlers that produce entity targets. */
export interface EntityWorkLifecycle {
    canWork(targetId: number): boolean;
    shouldWaitForWork?: boolean;
    onWorkStart?(targetId: number, settlerId: number): void;
    onWorkTick(targetId: number, progress: number): boolean;
    onWorkComplete?(targetId: number, settlerX: number, settlerY: number, settlerId: number): void;
    onWorkInterrupt?(targetId: number, settlerId: number): void;
}

/** Position work lifecycle — shared by all handlers that produce position targets. */
export interface PositionWorkLifecycle {
    shouldWaitForWork?: boolean;
    onWorkAtPositionComplete(tile: Tile, settlerId: number): void;
    onSettlerRemoved?(settlerId: number, targetX?: number, targetY?: number): void;
}

// ── Handler interfaces ──

/** Handler for externally-dispatched settlers that never search autonomously. */
export interface NullWorkHandler {
    type: WorkHandlerType.NULL;
    shouldWaitForWork?: boolean;
}

/** Handler for entity-targeted work: SEARCH → GO_TO_TARGET → WORK_ON_ENTITY */
export interface EntityWorkHandler extends EntityWorkLifecycle {
    type: WorkHandlerType.ENTITY;
    findTarget(area: SearchArea, settlerId: number, player: number): TileWithEntity | null;
}

/** Handler for position-based work: SEARCH → GO_TO_POS → WORK */
export interface PositionWorkHandler extends PositionWorkLifecycle {
    type: WorkHandlerType.POSITION;
    findPosition(area: SearchArea, settlerId: number): Tile | null;
}

/** Discriminated union of all work handler types. */
export type WorkHandler = NullWorkHandler | EntityWorkHandler | PositionWorkHandler;
```

```typescript
// ── Updated WorkHandlerRegistry (work-handler-registry.ts) ──

// Single map replaces the previous two separate maps. Getters narrow by type.

export class WorkHandlerRegistry {
    private readonly handlers = new Map<SearchType, WorkHandler>();

    register(searchType: SearchType, handler: WorkHandler): void {
        if (this.handlers.has(searchType)) {
            throw new Error(`Work handler already registered for ${searchType}`);
        }
        this.handlers.set(searchType, handler);
    }

    getEntityHandler(searchType: SearchType): EntityWorkHandler | undefined {
        const h = this.handlers.get(searchType);
        return h?.type === WorkHandlerType.ENTITY ? h : undefined;
    }

    getPositionHandler(searchType: SearchType): PositionWorkHandler | undefined {
        const h = this.handlers.get(searchType);
        return h?.type === WorkHandlerType.POSITION ? h : undefined;
    }

    hasAnyHandler(searchType: SearchType): boolean {
        return this.handlers.has(searchType);
    }

    findEntityHandlerForJob(jobId: string, settlerConfigs: SettlerConfigMap): EntityWorkHandler | undefined {
        for (const [, config] of settlerConfigs) {
            if (config.jobs.includes(jobId)) {
                return this.getEntityHandler(config.search);
            }
        }
        return undefined;
    }
}
```

```typescript
// ── MovementContext / WorkContext (choreo-types.ts) — UNCHANGED ──

// Two handler fields stay. Dual-mode settlers (farmer: harvest + plant) need both
// on the context for the SEARCH choreography node's entity-first-then-position fallback.

export interface MovementContext {
    gameState: GameState;
    buildingPositionResolver: BuildingPositionResolver;
    getWorkerHomeBuilding: (settlerId: number) => number | null;
    handlerErrorLogger: ThrottledLogger;
    entityHandler?: EntityWorkHandler;
    positionHandler?: PositionWorkHandler;
}

export interface WorkContext {
    gameState: GameState;
    triggerSystem: TriggerSystem;
    getWorkerHomeBuilding: (settlerId: number) => number | null;
    handlerErrorLogger: ThrottledLogger;
    entityHandler?: EntityWorkHandler;
    positionHandler?: PositionWorkHandler;
}
```

## Subsystem Details

### 1. Contracts
**Files**: `src/game/features/settler-tasks/types.ts`, `src/game/features/settler-tasks/choreo-types.ts`
**Key decisions**:
- `SearchArea` becomes `BoundedArea | SelfArea` in `choreo-types.ts`. `resolveSearchArea` stays but returns the union. All existing call sites unchanged — they still call `resolveSearchArea(settler, homeId, resolver)`.
- `EntityWorkLifecycle` and `PositionWorkLifecycle` extracted in `types.ts`. `EntityWorkHandler extends EntityWorkLifecycle`, `PositionWorkHandler extends PositionWorkLifecycle`. No change to handler factories — they already produce objects with these methods.
- `NullWorkHandler` added to `WorkHandlerType` enum and `WorkHandler` union.

### 2. Registry
**Files**: `src/game/features/settler-tasks/work-handler-registry.ts`
**Key decisions**:
- Single `handlers` map replaces the previous two separate maps. `getEntityHandler`/`getPositionHandler` narrow by checking `handler.type`. `hasAnyHandler` is just `handlers.has(searchType)`.
- A SearchType with a NullWorkHandler returns `undefined` from both `getEntityHandler` and `getPositionHandler` — correct: null handlers have no search or lifecycle.
- `findEntityHandlerForJob` uses `getEntityHandler` internally — works unchanged.

### 3. Executor Search
**Files**: `src/game/features/settler-tasks/worker-task-executor.ts`, `src/game/features/settler-tasks/internal/movement-executors.ts`, `src/game/features/settler-tasks/choreo-types.ts`
**Key decisions**:
- `resolveSearchArea` return type changes to `SearchArea` (the union). Callers pass it through to handlers as before.
- Assertion helpers in `choreo-types.ts` — handlers MUST use these, never `as` casts:
```typescript
export function asBounded(area: SearchArea): BoundedArea {
    if (area.type !== 'bounded') {
        throw new Error(`Expected bounded search area, got '${area.type}'`);
    }
    return area;
}

export function asSelf(area: SearchArea): SelfArea {
    if (area.type !== 'self') {
        throw new Error(`Expected self search area, got '${area.type}'`);
    }
    return area;
}
```
`as BoundedArea` / `as SelfArea` casts are forbidden — they bypass the discriminant check and produce silent wrong behavior instead of a loud failure. The helpers are an API boundary assertion (handler receives area from executor) and document the contract.
- `searchViaEntityHandler` and `searchViaPositionHandler` in movement-executors stay as two functions — they still try entity first, then position. No structural change.
- `worker-task-executor.ts`: `handleIdle` — the early exit splits into two concerns:
```typescript
if (!entityHandler && !positionHandler) {
    if (!this.handlerRegistry.hasAnyHandler(config.search)) {
        // Genuinely missing handler — feature not yet implemented
        this.missingHandlerLogger.warn(`No work handler registered for ${config.search}...`);
    }
    // NullWorkHandler (carrier, builder) or missing handler — settler stays idle, no warning
    this.idleEarlyExitCount++;
    return false;
}
```
A SearchType with `NullWorkHandler` passes `hasAnyHandler` (no warning) but yields no entity/position handler from `getEntityHandler`/`getPositionHandler`, so the settler stays idle. This is correct — carriers and builders get jobs from external dispatchers, not from idle-scan.

### 4. Bounded Handlers
**Files**: `src/game/features/trees/work-handlers.ts`, `src/game/features/stones/work-handlers.ts`, `src/game/features/crops/work-handlers.ts`, `src/game/features/settler-tasks/work-handlers.ts` (water)
**Key decisions**:
- Remove `if (radius === undefined) throw` guards — use `asBounded(area)` or `area as BoundedArea` instead. The runtime assertion moves from each handler to a shared helper.
- `type: WorkHandlerType.ENTITY` / `WorkHandlerType.POSITION` — unchanged.
- Handler signatures unchanged: `findTarget(area: SearchArea, ...)` / `findPosition(area: SearchArea, ...)`.

### 5. Other Handlers
**Files**: `src/game/features/settler-tasks/work-handlers.ts` (workplace, carrier), `src/game/features/building-construction/construction-demand-feature.ts`, `src/game/features/pioneer/work-handlers.ts`, `src/game/features/ore-veins/work-handlers.ts`, `src/game/features/settler-tasks/activated-position-handler.ts`
**Key decisions**:
- **Workplace**: unchanged — still `EntityWorkHandler`, still receives `SearchArea` and ignores it (`_area`). Now receives `SelfArea` variant instead of `{ center, radius: undefined }`, still ignored.
- **Carrier**: `createCarrierHandler` → returns `NullWorkHandler` with `shouldWaitForWork: true`. Deletes dummy `findTarget`, `canWork`, `onWorkTick`.
- **Construction noop**: Returns `NullWorkHandler` with `shouldWaitForWork: true`. Deletes dead `canWork`/`onWorkTick`.
- **Pioneer/Geologist**: `activated-position-handler.ts` — `findPosition(area, settlerId)` now uses `asSelf(area).origin` instead of `area.center`. Semantically identical (was always settler position), now type-asserted.

### 6. Registration Sites
**Files**: `src/game/features/settler-tasks/settler-task-system.ts`, `src/game/features/building-construction/construction-demand-feature.ts`
**Key decisions**:
- `settler-task-system.ts`: carrier handler registration changes from `createCarrierHandler()` (EntityWorkHandler) to `createCarrierHandler()` (NullWorkHandler).
- `construction-demand-feature.ts`: noop handler changes from inline EntityWorkHandler to inline NullWorkHandler.
- All other registration sites unchanged — handler factories return the same `EntityWorkHandler`/`PositionWorkHandler` types.

## File Map

### Modified Files
| File | Change |
|------|--------|
| `src/game/features/settler-tasks/types.ts` | Add `NullWorkHandler`, `EntityWorkLifecycle`, `PositionWorkLifecycle`. `EntityWorkHandler extends EntityWorkLifecycle`, `PositionWorkHandler extends PositionWorkLifecycle`. Add `NULL` to enum. |
| `src/game/features/settler-tasks/choreo-types.ts` | `SearchArea` becomes `BoundedArea \| SelfArea`. `resolveSearchArea` returns union. Add `asBounded()` helper. |
| `src/game/features/settler-tasks/work-handler-registry.ts` | Single `handlers` map. Getters narrow by type. `findEntityHandlerForJob` uses `getEntityHandler`. |
| `src/game/features/settler-tasks/worker-task-executor.ts` | Split `handleIdle` early exit: warn only when `!hasAnyHandler`, silent idle for NullWorkHandler. |
| `src/game/features/settler-tasks/work-handlers.ts` | `createCarrierHandler` → `NullWorkHandler`. `createWaterHandler` uses `asBounded()`. |
| `src/game/features/settler-tasks/activated-position-handler.ts` | Use `asSelf(area).origin` instead of `area.center`. |
| `src/game/features/trees/work-handlers.ts` | Use `asBounded()` instead of `if (radius === undefined) throw`. |
| `src/game/features/stones/work-handlers.ts` | Use `asBounded()` instead of `if (radius === undefined) throw`. |
| `src/game/features/crops/work-handlers.ts` | Use `asBounded()` instead of `if (radius === undefined) throw`. |
| `src/game/features/pioneer/work-handlers.ts` | Use `asSelf(area).origin`. |
| `src/game/features/ore-veins/work-handlers.ts` | Use `asSelf(area).origin`. |
| `src/game/features/building-construction/construction-demand-feature.ts` | `NullWorkHandler` instead of dummy `EntityWorkHandler`. |

## Verification
- Woodcutter receives `BoundedArea` with required `radius: number` — `asBounded()` passes, no throw guard needed in handler logic.
- Farmer harvests crop (entity handler gets `BoundedArea`) then plants seed (position handler gets `BoundedArea`) — dual-mode works, both handlers on context.
- Carrier registers as `NullWorkHandler` — `hasAnyHandler` returns true (no warning), but `getEntityHandler`/`getPositionHandler` return undefined (settler stays idle, gets jobs from logistics dispatcher).
- Pioneer receives `SelfArea` with `origin` — uses it as search center with own hardcoded radius.
- Workplace handler receives `SelfArea`, ignores it — unchanged behavior.
- `pnpm lint` passes with no type errors.
