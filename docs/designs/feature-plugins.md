# Feature Plugins — Design

## Overview

Evolve the existing `FeatureDefinition`/`FeatureInstance` system into a richer plugin architecture where features can self-declare their persistence, render passes, render data, command handlers, and diagnostics — all co-located inside the feature module. This eliminates the current pattern where `GameServices` manually wires persistence, commands are centrally registered, and render passes are hardcoded in `EntityRenderer`.

The design is fully incremental: existing features continue to work unchanged while individual features are migrated one at a time. The renderer becomes a dynamic pass coordinator instead of a hardcoded pass list.

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
2. **Render passes are hardcoded**: `EntityRenderer` instantiates 9 named pass fields in its constructor, calls `prepare()` and `draw()` on each in a hardcoded sequence, and assembles `PassContext` with manually-listed fields. Adding a new visual effect requires editing `EntityRenderer`, `PassContext`, `RenderContextBuilder`, and the glue layer — 4+ files.
3. **Command handlers are centrally registered**: New commands require editing `register-handlers.ts` and `CommandRegistrationDeps`
4. **Diagnostics have no standard interface**: Each feature invents its own debug data format
5. **GameServices has too many responsibilities**: 50+ lines of export extraction, 20+ lines of persistence registration, all feature types imported

### What stays vs what changes
- **Stays**: `FeatureDefinition.create(ctx)` pattern, topological dependency sorting, `ctx.on()` auto-subscription, `ctx.getFeature()` gated access, `TickSystem` registration via `systems` array
- **Changes**: `FeatureInstance` gains optional hooks for persistence, render passes, render data, commands, diagnostics. `GameServices` delegates registration to `FeatureRegistry`. `EntityRenderer` becomes a dynamic pass coordinator. Render data flows through a registry rather than hardcoded `PassContext` fields
- **Nothing gets deleted initially** — this is designed for incremental migration

## Summary for Review

- **Interpretation**: The current feature system is clean for game logic but features can't self-declare their cross-cutting concerns (persistence, rendering, commands, diagnostics). The goal is to let features opt into these capabilities through new optional hooks on `FeatureInstance`, so adding a new feature never requires editing central wiring files.

- **Assumptions**:
  - Render passes can live physically in a feature folder while being architecturally renderer-layer code (same precedent as command handlers living in `features/` but operating at the command layer).
  - Two rendering hooks serve different needs: `renderContributions` (data-only, most features) and `renderPasses` (custom GPU drawing, rare).
  - Persistence ordering can be derived from feature dependencies (no separate `after` keys needed).
  - Command handlers can be co-located in feature modules and registered via a new `commands` hook.
  - Diagnostics are opt-in structured data, not UI components — Vue composables remain in `src/composables/` but consume a standard interface.

- **Architecture**:
  - `FeatureInstance` grows 5 new optional fields: `persistence`, `renderContributions`, `renderPasses`, `commands`, `diagnostics`
  - `FeatureRegistry` auto-collects these during `load()` and exposes them via new getters
  - `GameServices` delegates persistence registration to the registry instead of doing it manually
  - `EntityRenderer` becomes a dynamic pass coordinator — iterates a `RenderPassRegistry` instead of named pass fields
  - A new `RenderDataRegistry` bridges feature-provided data to `PassContext` without features importing renderer types
  - Command handlers register via feature hooks, falling through to the existing `registerAllHandlers` for non-migrated commands

- **Contracts & boundaries**: Features provide render data as plain interfaces (arrays, getters) that the glue layer maps to `PassContext` fields. Features that need custom rendering provide `IRenderPass` implementations — these classes import renderer types (WebGL, sprite batch, etc.) but live physically in the feature folder. The `IRenderPass` interface and `PassContext` sub-interfaces are the stable contract.

- **Scope**: All 5 plugin hooks are fully designed. Most features will only use `renderContributions` (data-only). Custom `renderPasses` are for features that need novel GPU drawing (e.g., fog-of-war, debug overlays). The 9 existing passes migrate incrementally to the dynamic registry. Diagnostics are a lightweight structured interface.

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
    ├─► systems[]            → FeatureRegistry → GameLoop.registerSystem()
    ├─► persistence[]        → FeatureRegistry → PersistenceRegistry.register()    [NEW]
    ├─► commands{}            → FeatureRegistry → CommandHandlerRegistry.register()  [NEW]
    ├─► renderContributions   → FeatureRegistry → RenderDataRegistry               [NEW]
    ├─► renderPasses[]        → FeatureRegistry → RenderPassRegistry               [NEW]
    ├─► diagnostics           → FeatureRegistry → DiagnosticsRegistry              [NEW]
    └─► exports{}            → FeatureRegistry → ctx.getFeature()                  [existing]

RenderPassRegistry
    │
    ├─► Core passes (migrated from EntityRenderer hardcoded fields)
    ├─► Feature-provided passes (from renderPasses hook)
    │
    └─► EntityRenderer.draw() iterates ordered pass list:
            for each pass: prepare(passCtx) → draw(gl, projection, viewPoint)
```

### Subsystems

| # | Subsystem | Responsibility | Depends On | Files |
|---|-----------|---------------|------------|-------|
| 1 | Feature Instance Extension | New optional fields on `FeatureInstance` | — | `feature.ts` |
| 2 | Persistence Self-Registration | Registry auto-collects `persistence` from features | 1 | `feature-registry.ts`, `game-services.ts` |
| 3 | Command Self-Registration | Registry auto-collects `commands` from features | 1 | `feature.ts`, `feature-registry.ts`, `game-services.ts` |
| 4 | Render Data Registry | Bridge between feature data providers and renderer | 1 | `render-data-registry.ts`, glue layer |
| 5 | Render Pass Registry | Dynamic pass coordinator replacing hardcoded passes | 1 | `render-pass-registry.ts`, `entity-renderer.ts` |
| 6 | Diagnostics Interface | Standard diagnostic data format for features | 1 | `feature.ts`, `feature-registry.ts` |
| 7 | GameServices Simplification | Delegate wiring to registry, remove manual registration | 2, 3 | `game-services.ts` |
| 8 | Feature Migration (2-3 features) | Migrate carriers, territory, building-construction | 1-6 | feature modules |

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

// ============================================================================
// Render pass plugin types (from src/game/renderer/render-passes/types.ts)
// ============================================================================

/**
 * Render ordering layer — determines when a pass runs relative to the
 * core entity rendering pipeline.
 *
 * The draw loop executes passes in this order:
 * 1. BeforeDepthSort — path indicators, ground overlays (no frameContext needed)
 * 2. [depth sort happens here — populates frameContext + sortedEntities]
 * 3. BehindEntities — territory dots, ground-level sprites
 * 4. Entities — main entity sprites + color fallback (core, not overridable)
 * 5. AboveEntities — selection overlays, stack ghosts
 * 6. Overlay — placement preview, debug overlays
 */
export enum RenderLayer {
    BeforeDepthSort = 0,
    BehindEntities = 1,
    // Entities = 2 is reserved for core sprite/color passes
    AboveEntities = 3,
    Overlay = 4,
}

/**
 * Declares what shared resources a render pass needs.
 * EntityRenderer uses this to provide only the required sub-context.
 */
export interface RenderPassNeeds {
    /** Needs color shader attribute locations + dynamic buffer */
    colorShader?: boolean;
    /** Needs sprite subsystems (atlas, batch renderer, resolver) */
    sprites?: boolean;
    /** Needs depth-sorted entity list + frameContext (only valid after depth sort) */
    entities?: boolean;
}

/**
 * Definition of a pluggable render pass.
 * Returned by features in the `renderPasses` hook.
 *
 * Pass classes implement IRenderPass (existing interface).
 * The definition adds metadata for ordering and resource requirements.
 */
export interface RenderPassDefinition {
    /** Unique pass identifier (for debugging and profiling) */
    id: string;
    /** When this pass runs in the draw loop */
    layer: RenderLayer;
    /** Priority within the layer (lower = earlier). Default 100. */
    priority?: number;
    /** What shared resources this pass needs */
    needs: RenderPassNeeds;
    /**
     * Factory to create the pass instance.
     * Receives renderer subsystems based on `needs` declaration.
     * Called once during EntityRenderer.init().
     */
    create: (deps: RenderPassDeps) => PluggableRenderPass;
}

/**
 * Dependencies provided to render pass factories based on their `needs`.
 * Only populated fields matching the pass's `needs` declaration.
 */
export interface RenderPassDeps {
    selectionOverlayRenderer?: SelectionOverlayRenderer;
    spriteBatchRenderer?: SpriteBatchRenderer;
}

/**
 * Extended IRenderPass with typed prepare().
 * All pluggable passes use PassContext (the existing full context type).
 * Each pass reads only the fields it needs — structural subtyping handles the rest.
 */
export interface PluggableRenderPass extends IRenderPass {
    prepare(ctx: PassContext): void;
    /** Optional: draw call count for profiling */
    lastDrawCalls?: number;
    /** Optional: sprite count for profiling */
    lastSpriteCount?: number;
}

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
     *
     * Use this for data-only contributions (most features).
     */
    renderContributions?: RenderContributions;

    /**
     * Custom render passes this feature provides.
     * Pass classes live physically in the feature folder but are
     * architecturally renderer-layer code (they import WebGL types,
     * sprite batch renderer, etc.).
     *
     * Use this for features that need novel GPU drawing
     * (e.g., fog-of-war, debug visualizations).
     * Most features should use renderContributions instead.
     */
    renderPasses?: RenderPassDefinition[];

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
// In src/game/renderer/render-pass-registry.ts — NEW FILE
// ============================================================================

import type { RenderPassDefinition, PluggableRenderPass, RenderLayer, RenderPassDeps } from './render-passes/types';

/**
 * Ordered slot in the draw loop. Each slot holds one pass with its metadata.
 */
interface PassSlot {
    id: string;
    layer: RenderLayer;
    priority: number;
    needs: RenderPassNeeds;
    pass: PluggableRenderPass;
}

/**
 * Dynamic registry of render passes.
 * Replaces hardcoded pass fields in EntityRenderer.
 *
 * Passes are registered via definitions (from features or core),
 * instantiated during init(), and executed in layer+priority order.
 */
export class RenderPassRegistry {
    private readonly definitions: RenderPassDefinition[] = [];
    private slots: PassSlot[] = [];
    private initialized = false;

    /** Register a pass definition. Must be called before init(). */
    register(definition: RenderPassDefinition): void;

    /** Register multiple definitions at once. */
    registerAll(definitions: RenderPassDefinition[]): void;

    /**
     * Instantiate all registered passes.
     * Called once by EntityRenderer.init() after GL context is available.
     * Sorts passes by layer then priority.
     */
    init(deps: RenderPassDeps): void;

    /** Get all passes in a specific layer, in priority order. */
    getPassesForLayer(layer: RenderLayer): readonly PassSlot[];

    /** Get all passes across all layers, in execution order. */
    getAllPasses(): readonly PassSlot[];

    /** Get a specific pass by ID (for profiling, debugging). */
    getPass(id: string): PluggableRenderPass | undefined;
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
- Features provide data getters, not render passes — preserves the layer boundary for most features
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

**When to use renderContributions vs renderPasses**: Use `renderContributions` when your feature provides data that an existing pass already knows how to draw (territory dots, work area circles, stack ghosts). Use `renderPasses` (Subsystem 5) when your feature needs novel GPU drawing that no existing pass handles.

### Subsystem 5: Render Pass Registry

**Files**: `src/game/renderer/render-pass-registry.ts` (new), `src/game/renderer/entity-renderer.ts`, `src/game/renderer/render-passes/types.ts`
**Owns**: Dynamic pass coordination, replacing hardcoded pass fields in EntityRenderer
**Depends on**: Subsystem 1
**Key decisions**:
- Passes declare their `RenderLayer` (ordering) and `RenderPassNeeds` (resource requirements)
- `EntityRenderer` iterates `RenderPassRegistry` instead of named fields
- The 9 existing passes are migrated to `RenderPassDefinition` format — they become "core pass definitions" registered by `EntityRenderer` itself during init
- Feature-provided passes are registered alongside core passes and sorted by layer+priority
- The depth sort boundary is explicit: passes in `BeforeDepthSort` layer run before `sortEntitiesByDepth()`, all others run after
- `PassContext` stays as-is — it already satisfies all per-pass context interfaces via structural subtyping
- The `setupColorShader()` call is automated: `EntityRenderer` calls it before any pass whose `needs.colorShader` is true

**RenderLayer execution order**:
```
1. BeforeDepthSort passes  (path indicators)
2. [depth sort — populates frameContext + sortedEntities]
3. BehindEntities passes   (ground overlays, territory dots)
4. [core entity passes]    (EntitySpritePass + ColorEntityPass — always present, not pluggable)
5. AboveEntities passes    (selection, stack ghosts)
6. Overlay passes          (placement preview, debug overlays)
```

**Why core entity passes are not pluggable**: `EntitySpritePass` and `ColorEntityPass` have special coordination (the sprite pass decides which buildings are textured, the color pass handles the rest; `TransitionBlendPass` is referenced by the sprite pass). These form a tightly coupled core that doesn't benefit from pluggability. Everything else is a clean, independent pass.

**Behavior**:
- `EntityRenderer` constructor creates a `RenderPassRegistry` and registers core pass definitions
- During `EntityRenderer.init()`, feature-provided definitions are added, then `registry.init(deps)` instantiates all passes
- `EntityRenderer.draw()` iterates passes by layer, calling `setupColorShader()` as needed based on `needs.colorShader`
- Timing data is collected from `lastDrawCalls` / `lastSpriteCount` on each pass for profiling

**Migration of existing passes to definitions** (done in EntityRenderer, not in features):
```typescript
// Core pass definitions — registered by EntityRenderer itself
const CORE_PASS_DEFINITIONS: RenderPassDefinition[] = [
    {
        id: 'path-indicator',
        layer: RenderLayer.BeforeDepthSort,
        priority: 100,
        needs: { colorShader: true },
        create: (deps) => new PathIndicatorPass(deps.selectionOverlayRenderer!),
    },
    {
        id: 'ground-overlay',
        layer: RenderLayer.BehindEntities,
        priority: 100,
        needs: { colorShader: true, entities: true },
        create: (deps) => new GroundOverlayPass(deps.selectionOverlayRenderer!),
    },
    {
        id: 'territory-dot',
        layer: RenderLayer.BehindEntities,
        priority: 200,
        needs: { sprites: true },
        create: () => new TerritoryDotPass(),
    },
    {
        id: 'selection',
        layer: RenderLayer.AboveEntities,
        priority: 100,
        needs: { colorShader: true, entities: true },
        create: (deps) => new SelectionPass(deps.selectionOverlayRenderer!),
    },
    {
        id: 'stack-ghost',
        layer: RenderLayer.AboveEntities,
        priority: 200,
        needs: { sprites: true },
        create: () => new StackGhostPass(),
    },
    {
        id: 'placement-preview',
        layer: RenderLayer.Overlay,
        priority: 100,
        needs: { sprites: true, colorShader: true },
        create: () => new PlacementPreviewPass(),
    },
];
```

**Example feature-provided pass** (hypothetical debug overlay):
```typescript
// In src/game/features/logistics/logistics-debug-pass.ts
import type { PluggableRenderPass } from '@/game/renderer/render-passes/types';
import type { PassContext } from '@/game/renderer/render-passes';

export class LogisticsDebugPass implements PluggableRenderPass {
    lastDrawCalls = 0;

    prepare(ctx: PassContext): void {
        // Read logistics data from ctx (via renderContributions)
    }

    draw(gl: WebGL2RenderingContext, projection: Float32Array, viewPoint: IViewPoint): void {
        // Draw route lines, request indicators, etc.
    }
}
```

```typescript
// In logistics-dispatcher-feature.ts
return {
    exports: { logisticsDispatcher },
    renderPasses: [{
        id: 'logistics-debug',
        layer: RenderLayer.Overlay,
        priority: 500,
        needs: { colorShader: true },
        create: () => new LogisticsDebugPass(),
    }],
};
```

### Subsystem 6: Diagnostics Interface

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

### Subsystem 7: GameServices Simplification

**Files**: `src/game/game-services.ts`
**Owns**: Delegating wiring to FeatureRegistry, removing manual registration
**Depends on**: Subsystems 2, 3
**Key decisions**:
- This is incremental — as features migrate, their manual registration lines are removed from `GameServices`
- The export extraction (lines 182-209) stays for now — external code (commands, tests, glue layer) still accesses `services.constructionSiteManager` etc. Removing those is a separate future refactoring.
- `FeatureRegistry` gains a `getPersistenceRegistry(): PersistenceRegistry` method that returns a pre-populated registry
- Command handler collection is exposed via `getCommandHandlers()` and wired in `Game.ts` during initialization
- Render pass definitions are exposed via `getRenderPassDefinitions()` and provided to `EntityRenderer` before init

**Behavior**:
1. After `featureRegistry.loadAll()`, call `featureRegistry.buildPersistenceRegistry()` to get a `PersistenceRegistry` with all feature-declared persistables pre-registered
2. Manually register any remaining non-migrated persistables on top
3. Collect feature-provided command handlers and register them before the central `registerAllHandlers()` call
4. Collect feature-provided render pass definitions and provide to `EntityRenderer` (which adds them to its `RenderPassRegistry` alongside core definitions)
5. Over time, as features migrate, the manual registration blocks shrink until they're empty

### Subsystem 8: Feature Migration (2-3 examples)

**Files**: Various feature modules
**Owns**: Demonstrating the migration pattern on real features
**Depends on**: Subsystems 1-6
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
| `src/game/renderer/render-pass-registry.ts` | 5 | Dynamic pass coordinator, replaces hardcoded pass fields |
| `src/game/features/diagnostics-registry.ts` | 6 | Collects diagnostics providers from features |

### Modified Files
| File | Change | Subsystem |
|------|--------|-----------|
| `src/game/features/feature.ts` | Add `BoundCommandHandler`, `RenderContributions`, `RenderPassDefinition`, `FeatureDiagnostics` types; extend `FeatureInstance` with 5 new optional fields | 1 |
| `src/game/features/feature-registry.ts` | Auto-collect persistence, commands, render contributions, render passes, diagnostics during `load()`; expose getters | 2, 3, 4, 5, 6 |
| `src/game/renderer/render-passes/types.ts` | Add `RenderLayer` enum, `RenderPassNeeds`, `RenderPassDefinition`, `RenderPassDeps`, `PluggableRenderPass` types | 5 |
| `src/game/renderer/entity-renderer.ts` | Replace 9 named pass fields with `RenderPassRegistry`; refactor `draw()` to iterate dynamic pass list; extract core pass definitions to `CORE_PASS_DEFINITIONS` array | 5 |
| `src/game/game-services.ts` | Replace manual persistence registration with registry-driven approach; wire command handlers; provide feature render pass definitions to EntityRenderer | 7 |
| `src/game/features/carriers/carrier-feature.ts` | Add `persistence: [carrierRegistry]` | 8 |
| `src/game/features/territory/territory-feature.ts` | Add `renderContributions`, `diagnostics` | 8 |
| `src/game/features/production-control/production-control-feature.ts` | Add `persistence`, `commands` | 8 |

### Deleted Files
None — this is fully incremental.

## Verification

- All existing tests pass unchanged (no behavioral changes, only new optional fields)
- `pnpm lint` passes after each subsystem
- **Render pass registry**: After migrating EntityRenderer to use `RenderPassRegistry` with `CORE_PASS_DEFINITIONS`, all 9 passes still execute in the same order, rendering is pixel-identical. Verify with e2e screenshot tests.
- **CarrierFeature migration**: remove manual `this.persistenceRegistry.register(this.carrierRegistry)` from GameServices, add `persistence: [carrierRegistry]` to feature — save/load still works
- **ProductionControlFeature migration**: production mode commands still work after moving handlers to feature
- **TerritoryFeature migration**: territory dots still render after using `renderContributions`
- **Debug panel**: shows diagnostics from features that provide them
- **Feature-provided render pass**: a test pass registered at `RenderLayer.Overlay` executes after all core passes — verify with profiling output showing the pass ID
