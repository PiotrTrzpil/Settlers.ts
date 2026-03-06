# Feature Plugins — Design

## Overview

Evolve the existing `FeatureDefinition`/`FeatureInstance` system into a richer plugin architecture where features can self-declare their persistence, render contributions, command handlers, and diagnostics — all co-located inside the feature module. This eliminates the current pattern where `GameServices` manually wires persistence, commands, and rendering are hardcoded in `EntityRenderer`.

The design is fully incremental: existing features continue to work unchanged while individual features are migrated one at a time.

## Current State

### What exists
- `FeatureDefinition` with `id`, `dependencies`, `create(ctx) => FeatureInstance`
- `FeatureInstance` returns `systems`, `systemGroup`, `exports`, `onTerrainReady`, `destroy`
- `FeatureRegistry` handles topological loading, auto-tracked event subscriptions, system collection
- `GameServices` is the composition root — loads all features, extracts exports as typed properties, manually registers persistence and cleanup
- `EntityRenderer` hardcodes 9 render passes in its constructor
- `RenderContextBuilder` manually assembles per-frame data from feature getters
- Command handlers are registered in a central `register-handlers.ts`
- Persistence is registered manually in `GameServices` (lines 211-231)
- Diagnostics are ad-hoc per feature (no standard interface)

### What's wrong with it
1. **Persistence is externally wired**: Adding a Persistable manager requires editing `GameServices` and knowing dependency ordering
2. **Render passes are hardcoded**: Adding rendering requires editing `EntityRenderer`, `PassContext`, `RenderContextBuilder`, and the glue layer
3. **Command handlers are centrally registered**: New commands require editing `register-handlers.ts` and `CommandRegistrationDeps`
4. **Diagnostics have no standard interface**: Each feature invents its own debug data format
5. **GameServices has too many responsibilities**: 50+ lines of export extraction, 20+ lines of persistence registration, all feature types imported

### What stays vs what changes
- **Stays**: `FeatureDefinition.create(ctx)` pattern, topological dependency sorting, `ctx.on()` auto-subscription, `ctx.getFeature()` gated access, `TickSystem` registration via `systems` array, layer architecture (features never import from renderer)
- **Changes**: `FeatureInstance` gains optional hooks for persistence, render data, commands, diagnostics. `GameServices` delegates registration to `FeatureRegistry`. Render data flows through a registry rather than hardcoded `PassContext` fields
- **Nothing gets deleted initially** — this is designed for incremental migration

## Summary for Review

- **Interpretation**: The current feature system is clean for game logic but features can't self-declare their cross-cutting concerns (persistence, rendering, commands, diagnostics). The goal is to let features opt into these capabilities through new optional hooks on `FeatureInstance`, so adding a new feature never requires editing central wiring files.

- **Assumptions**:
  - The renderer layer boundary is preserved — features don't import renderer types. Instead, features provide render data as plain data objects, and a registry bridges them to the renderer.
  - Persistence ordering can be derived from feature dependencies (no separate `after` keys needed).
  - Command handlers can be co-located in feature modules and registered via a new `commands` hook.
  - Diagnostics are opt-in structured data, not UI components — Vue composables remain in `src/composables/` but consume a standard interface.

- **Architecture**:
  - `FeatureInstance` grows 4 new optional fields: `persistence`, `renderContributions`, `commands`, `diagnostics`
  - `FeatureRegistry` auto-collects these during `load()` and exposes them via new getters
  - `GameServices` delegates persistence registration to the registry instead of doing it manually
  - A new `RenderDataRegistry` bridges feature-provided data to `RenderContextBuilder` without features importing renderer types
  - Command handlers register via feature hooks, falling through to the existing `registerAllHandlers` for non-migrated commands

- **Contracts & boundaries**: Features provide render data as plain interfaces (arrays, getters) that the glue layer maps to `PassContext` fields. Features never import from `src/game/renderer/`. The render data interfaces live in `src/game/features/feature.ts` alongside the existing feature types.

- **Scope**: Persistence and command self-registration are fully designed. Render contributions use a data-provider pattern (features provide data, not passes). Diagnostics are a lightweight structured interface. Custom render passes (features providing their own WebGL pass classes) are explicitly out of scope — that would require features to depend on the renderer layer.

## Project Conventions (extracted)

### Code Style
- Feature modules live in `src/game/features/<name>/` with `index.ts` barrel export
- `*-manager.ts` for state containers, `*-system.ts` for TickSystem implementations
- `internal/` subdirectory for private implementation — no external imports allowed
- Config interfaces with 3+ dependencies use a `*Config` interface with required fields
- Max 140 char lines, max cyclomatic complexity 15

### Error Handling
- Optimistic: trust internal data, crash loudly on contract violations
- `getEntityOrThrow(id, 'context')` — never bare `!` on lookups
- No silent fallbacks (`?? 0`, `|| 0`) on required values
- TickSystems catch and log errors — don't crash the game loop

### Type Philosophy
- Required fields are required. Optional means absence is domain-meaningful.
- No `Pick`, `Omit`, or mapped utility types in public APIs — explicit interfaces only
- Event payloads are read-only

### Representative Pattern

Current feature definition (from `src/game/features/carriers/carrier-feature.ts`):

```typescript
export const CarrierFeature: FeatureDefinition = {
    id: 'carriers',
    dependencies: [],
    create(ctx: FeatureContext) {
        const carrierRegistry = new CarrierRegistry({
            entityProvider: ctx.gameState,
            eventBus: ctx.eventBus,
        });

        ctx.on('unit:spawned', payload => {
            if (payload.unitType === UnitType.Carrier) {
                carrierRegistry.register(payload.entityId);
            }
        });

        ctx.cleanupRegistry.onEntityRemoved(entityId => {
            if (carrierRegistry.has(entityId)) {
                carrierRegistry.remove(entityId);
            }
        });

        return {
            exports: { carrierRegistry } satisfies CarrierFeatureExports,
        };
    },
};
```

After migration (same feature with persistence self-registered):

```typescript
export const CarrierFeature: FeatureDefinition = {
    id: 'carriers',
    dependencies: [],
    create(ctx: FeatureContext) {
        const carrierRegistry = new CarrierRegistry({ /* ... */ });
        // ... event subscriptions unchanged ...

        return {
            exports: { carrierRegistry } satisfies CarrierFeatureExports,
            persistence: [carrierRegistry],  // NEW: self-registers Persistable
        };
    },
};
```

## Architecture

### Data Flow

```
FeatureDefinition.create(ctx)
    │
    ├─► systems[]           → FeatureRegistry → GameLoop.registerSystem()
    ├─► persistence[]       → FeatureRegistry → PersistenceRegistry.register()   [NEW]
    ├─► commands{}           → FeatureRegistry → CommandHandlerRegistry.register() [NEW]
    ├─► renderContributions  → FeatureRegistry → RenderDataRegistry              [NEW]
    ├─► diagnostics          → FeatureRegistry → DiagnosticsRegistry             [NEW]
    └─► exports{}           → FeatureRegistry → ctx.getFeature()                 [existing]
```

### Subsystems

| # | Subsystem | Responsibility | Depends On | Files |
|---|-----------|---------------|------------|-------|
| 1 | Feature Instance Extension | New optional fields on `FeatureInstance` | — | `feature.ts` |
| 2 | Persistence Self-Registration | Registry auto-collects `persistence` from features | 1 | `feature-registry.ts`, `game-services.ts` |
| 3 | Command Self-Registration | Registry auto-collects `commands` from features | 1 | `feature.ts`, `feature-registry.ts`, `game-services.ts` |
| 4 | Render Data Registry | Bridge between feature data providers and renderer | 1 | `render-data-registry.ts`, glue layer |
| 5 | Diagnostics Interface | Standard diagnostic data format for features | 1 | `feature.ts`, `feature-registry.ts` |
| 6 | GameServices Simplification | Delegate wiring to registry, remove manual registration | 2, 3 | `game-services.ts` |
| 7 | Feature Migration (2-3 features) | Migrate carriers, territory, building-construction | 1-5 | feature modules |

## Shared Contracts (as code)

```typescript
// ============================================================================
// In src/game/features/feature.ts — extensions to FeatureInstance
// ============================================================================

import type { Persistable } from '../persistence';
import type { CommandType, Command, CommandResult } from '../commands';

/**
 * A command handler that a feature provides.
 * The feature binds its own dependencies at creation time.
 */
export type BoundCommandHandler = (cmd: Command) => CommandResult;

/**
 * Render data contribution from a feature.
 * Each key identifies a named data slot that the glue layer reads.
 * Values are getter functions called once per frame.
 *
 * Features define their own RenderContribution type via the generic.
 * The glue layer imports the feature's contribution type and maps it to PassContext.
 *
 * IMPORTANT: Return types must be plain data (arrays, maps, primitives).
 * No renderer types (WebGL, SpriteEntry, etc.) — those live in the renderer layer.
 */
export type RenderContributions = Record<string, () => unknown>;

/**
 * Diagnostic data a feature can provide for the debug panel.
 * Each entry is a labeled section with key-value pairs.
 */
export interface FeatureDiagnostics {
    /** Human-readable feature label */
    label: string;
    /** Diagnostic sections */
    sections: DiagnosticSection[];
}

export interface DiagnosticSection {
    label: string;
    entries: DiagnosticEntry[];
}

export interface DiagnosticEntry {
    key: string;
    value: string | number | boolean;
}

/**
 * Extended FeatureInstance with optional plugin hooks.
 * All new fields are optional — existing features work unchanged.
 */
export interface FeatureInstance {
    // === Existing (unchanged) ===
    systems?: TickSystem[];
    systemGroup?: string;
    exports?: Record<string, any>;
    onTerrainReady?(terrain: TerrainData, resourceData?: Uint8Array): void;
    destroy?: () => void;

    // === New: Self-registration hooks ===

    /**
     * Persistable managers owned by this feature.
     * Registered with PersistenceRegistry automatically.
     * Ordering derived from feature dependencies — no manual `after` keys needed.
     */
    persistence?: Persistable[];

    /**
     * Command handlers owned by this feature.
     * Keys are CommandType strings. Handlers have dependencies pre-bound.
     * Registered with CommandHandlerRegistry automatically.
     */
    commands?: Partial<Record<CommandType, BoundCommandHandler>>;

    /**
     * Render data this feature contributes per frame.
     * Keys are named slots. Values are getter functions returning plain data.
     * The glue layer reads these and maps them to PassContext fields.
     */
    renderContributions?: RenderContributions;

    /**
     * Diagnostic data provider for the debug panel.
     * Called on-demand (not every frame).
     */
    diagnostics?: () => FeatureDiagnostics;
}
```

```typescript
// ============================================================================
// In src/game/features/render-data-registry.ts — NEW FILE
// ============================================================================

/**
 * Collects render data contributions from features.
 * The glue layer (use-renderer) queries this instead of reaching into
 * individual feature managers.
 */
export class RenderDataRegistry {
    private readonly contributions = new Map<string, Map<string, () => unknown>>();

    /** Register contributions from a feature. */
    registerFeature(featureId: string, contributions: Record<string, () => unknown>): void {
        this.contributions.set(featureId, new Map(Object.entries(contributions)));
    }

    /** Get a named contribution from a feature. */
    get<T>(featureId: string, key: string): (() => T) | undefined;

    /** Get all contributions for a named slot across all features. */
    getAllForSlot<T>(slotName: string): Array<{ featureId: string; getter: () => T }>;
}
```

```typescript
// ============================================================================
// In src/game/features/diagnostics-registry.ts — NEW FILE
// ============================================================================

/**
 * Collects diagnostics providers from features.
 * The debug panel queries all providers on-demand.
 */
export class DiagnosticsRegistry {
    private readonly providers = new Map<string, () => FeatureDiagnostics>();

    register(featureId: string, provider: () => FeatureDiagnostics): void;

    /** Get diagnostics from all features (called on-demand, not per-frame). */
    getAll(): FeatureDiagnostics[];

    /** Get diagnostics for a specific feature. */
    get(featureId: string): FeatureDiagnostics | undefined;
}
```

## Subsystem Details

### Subsystem 1: Feature Instance Extension

**Files**: `src/game/features/feature.ts`
**Owns**: Type definitions for new FeatureInstance fields
**Key decisions**:
- All new fields are optional — zero breaking changes to existing features
- `persistence` is an array of `Persistable` (reuses existing interface)
- `commands` is a partial record keyed by `CommandType` — provides compile-time safety
- `renderContributions` uses `Record<string, () => unknown>` — generic enough for any feature, typed at consumption site
- `diagnostics` is a factory function called on-demand, not cached per frame

**Behavior**:
- No runtime behavior — this subsystem only adds type definitions
- Import `Persistable` from `../persistence` and `CommandType` from `../commands`
- Add `BoundCommandHandler`, `RenderContributions`, `FeatureDiagnostics`, `DiagnosticSection`, `DiagnosticEntry` types
- Extend `FeatureInstance` with the 4 new optional fields

### Subsystem 2: Persistence Self-Registration

**Files**: `src/game/features/feature-registry.ts`, `src/game/game-services.ts`
**Owns**: Auto-collection of `Persistable` managers from feature instances
**Depends on**: Subsystem 1
**Key decisions**:
- Persistence ordering is derived from feature dependency order — features loaded later naturally depend on those loaded earlier, matching the existing `after` semantics
- For cases where a Persistable needs finer-grained ordering within a feature, allow `persistence` entries to be `Persistable | { persistable: Persistable; after: string[] }`
- `FeatureRegistry` exposes a `getPersistables()` method that returns all collected persistables in feature-load order
- `GameServices` calls `persistenceRegistry.register()` for each, in order — but the data comes from features, not manual listing

**Behavior**:
- During `FeatureRegistry.load()`, after creating the instance, iterate `instance.persistence` and collect each entry
- Store them in a `persistables` array in load order
- Expose `getPersistables(): Array<{ persistable: Persistable; after: string[] }>`
- In `GameServices`, replace the manual registration block (lines 211-231) with a loop over `featureRegistry.getPersistables()`
- Features that haven't migrated yet still register manually in `GameServices` — both paths coexist

**Migration per feature**: Move the `this.persistenceRegistry.register(manager)` call from `GameServices` into the feature's `create()` return value as `persistence: [manager]`.

### Subsystem 3: Command Self-Registration

**Files**: `src/game/features/feature.ts`, `src/game/features/feature-registry.ts`, `src/game/game-services.ts`
**Owns**: Auto-collection and registration of command handlers from features
**Depends on**: Subsystem 1
**Key decisions**:
- Handlers bind their own dependencies inside `create()` — the registry just collects pre-bound functions
- The existing `registerAllHandlers()` continues to work for non-migrated commands
- Feature-provided handlers are registered first, then `registerAllHandlers()` adds the rest (no conflicts since commands have unique types)
- `FeatureRegistry` exposes `getCommandHandlers(): Map<CommandType, BoundCommandHandler>`

**Behavior**:
- During `FeatureRegistry.load()`, iterate `instance.commands` entries and collect them
- Store in a `commandHandlers` map
- `GameServices` or `Game` calls `commandRegistry.register(type, handler)` for each
- Duplicate command type registration throws (features can't override central handlers or each other)

**Example migration** (production commands in ProductionControlFeature):
```typescript
return {
    exports: { productionControlManager },
    commands: {
        set_production_mode: cmd => executeSetProductionMode({ productionControlManager }, cmd),
        set_recipe_proportion: cmd => executeSetRecipeProportion({ productionControlManager }, cmd),
    },
};
```

### Subsystem 4: Render Data Registry

**Files**: `src/game/features/render-data-registry.ts` (new), `src/game/features/feature-registry.ts`, `src/components/use-renderer/frame-callbacks.ts`
**Owns**: Bridging feature data to the renderer glue layer
**Depends on**: Subsystem 1
**Key decisions**:
- Features provide data getters, not render passes — preserves the layer boundary
- Each contribution is a named getter (e.g., `'territoryDots'`, `'workAreaCircles'`)
- The glue layer (`use-renderer/frame-callbacks.ts`) queries the registry by feature+slot name
- Return types are plain data (arrays of `{x, y, player}`, etc.) — NO renderer types
- The render data interfaces (like `TerritoryDotRenderData`) are defined in `render-context.ts` (renderer layer) — features return structurally compatible objects without importing those types

**Behavior**:
- `RenderDataRegistry` is created by `FeatureRegistry` and populated during `load()`
- The glue layer receives a reference to the registry and calls getters per frame
- Getters are called lazily — only if the pass that uses the data is active

**Example** (TerritoryFeature contributing territory dots):
```typescript
return {
    exports,
    renderContributions: {
        territoryDots: () => territoryManager.getBoundaryDots(),
    },
};
```

Glue layer reads it:
```typescript
// In frame-callbacks.ts
const dots = renderDataRegistry.get<TerritoryDotRenderData[]>('territory', 'territoryDots');
if (dots) {
    builder.territoryDots(dots());
}
```

**Important constraint**: This does NOT allow features to provide custom render passes. Features provide data; the existing render passes consume it. Adding a truly new visual effect still requires a new render pass in the renderer layer. This is by design — render passes are GPU-facing code that doesn't belong in feature modules.

### Subsystem 5: Diagnostics Interface

**Files**: `src/game/features/feature.ts`, `src/game/features/diagnostics-registry.ts` (new), `src/game/features/feature-registry.ts`
**Owns**: Standard diagnostic data collection from features
**Depends on**: Subsystem 1
**Key decisions**:
- Diagnostics are structured key-value data, not Vue components
- Called on-demand (debug panel open), not every frame
- Existing ad-hoc diagnostics (like `fulfillment-diagnostics.ts`) can stay — this is additive
- The debug panel composable can query `DiagnosticsRegistry.getAll()` to render a generic feature diagnostics section

**Behavior**:
- During `FeatureRegistry.load()`, if `instance.diagnostics` exists, register it with `DiagnosticsRegistry`
- `DiagnosticsRegistry.getAll()` calls each provider and returns collected results
- Vue debug panel renders each `FeatureDiagnostics` as a collapsible section

**Example** (CarrierFeature diagnostics):
```typescript
return {
    exports: { carrierRegistry },
    diagnostics: () => ({
        label: 'Carriers',
        sections: [{
            label: 'Status',
            entries: [
                { key: 'Total carriers', value: carrierRegistry.count },
                { key: 'Idle', value: carrierRegistry.idleCount },
                { key: 'Assigned', value: carrierRegistry.assignedCount },
            ],
        }],
    }),
};
```

### Subsystem 6: GameServices Simplification

**Files**: `src/game/game-services.ts`
**Owns**: Delegating wiring to FeatureRegistry, removing manual registration
**Depends on**: Subsystems 2, 3
**Key decisions**:
- This is incremental — as features migrate, their manual registration lines are removed from `GameServices`
- The export extraction (lines 182-209) stays for now — external code (commands, tests, glue layer) still accesses `services.constructionSiteManager` etc. Removing those is a separate future refactoring.
- `FeatureRegistry` gains a `getPersistenceRegistry(): PersistenceRegistry` method that returns a pre-populated registry
- Command handler collection is exposed via `getCommandHandlers()` and wired in `Game.ts` during initialization

**Behavior**:
1. After `featureRegistry.loadAll()`, call `featureRegistry.buildPersistenceRegistry()` to get a `PersistenceRegistry` with all feature-declared persistables pre-registered
2. Manually register any remaining non-migrated persistables on top
3. Collect feature-provided command handlers and register them before the central `registerAllHandlers()` call
4. Over time, as features migrate, the manual registration blocks shrink until they're empty

### Subsystem 7: Feature Migration (2-3 examples)

**Files**: Various feature modules
**Owns**: Demonstrating the migration pattern on real features
**Depends on**: Subsystems 1-5
**Key decisions**:
- Start with simple features (carriers, territory) before complex ones (building-construction)
- Each migration is a single commit that moves registration from GameServices into the feature

**Migration targets**:
1. **CarrierFeature** — add `persistence: [carrierRegistry]` (simplest case, no deps)
2. **TerritoryFeature** — add `renderContributions: { territoryDots: () => manager.getBoundaryDots() }` and `diagnostics`
3. **ProductionControlFeature** — add `persistence: [productionControlManager]` and `commands: { set_production_mode, set_recipe_proportion, ... }`

## File Map

### New Files
| File | Subsystem | Purpose |
|------|-----------|---------|
| `src/game/features/render-data-registry.ts` | 4 | Collects render data providers from features |
| `src/game/features/diagnostics-registry.ts` | 5 | Collects diagnostics providers from features |

### Modified Files
| File | Change | Subsystem |
|------|--------|-----------|
| `src/game/features/feature.ts` | Add `BoundCommandHandler`, `RenderContributions`, `FeatureDiagnostics` types; extend `FeatureInstance` | 1 |
| `src/game/features/feature-registry.ts` | Auto-collect persistence, commands, render contributions, diagnostics during `load()`; expose getters | 2, 3, 4, 5 |
| `src/game/game-services.ts` | Replace manual persistence registration with registry-driven approach; wire command handlers | 6 |
| `src/game/features/carriers/carrier-feature.ts` | Add `persistence: [carrierRegistry]` | 7 |
| `src/game/features/territory/territory-feature.ts` | Add `renderContributions`, `diagnostics` | 7 |
| `src/game/features/production-control/production-control-feature.ts` | Add `persistence`, `commands` | 7 |

### Deleted Files
None — this is fully incremental.

## Verification

- All existing tests pass unchanged (no behavioral changes, only new optional fields)
- `pnpm lint` passes after each subsystem
- CarrierFeature migration: remove manual `this.persistenceRegistry.register(this.carrierRegistry)` from GameServices, add `persistence: [carrierRegistry]` to feature — save/load still works
- ProductionControlFeature migration: production mode commands still work after moving handlers to feature
- TerritoryFeature migration: territory dots still render after using `renderContributions`
- Debug panel shows diagnostics from features that provide them
