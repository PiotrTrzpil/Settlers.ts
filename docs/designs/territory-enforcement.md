# Territory Enforcement for Placement & Logistics — Design

## Overview

Enforce that building placement and logistics transport only operate within a player's territory. The design uses a **pluggable filter architecture** — territory is implemented as one policy that slots into generic filter hooks on both placement and logistics. The filters can be swapped, composed, or disabled without touching validator or dispatcher internals.

## Architecture

### Pluggable Filter Pattern

```
                     ┌─────────────────────┐
                     │  PlacementFilter     │  ← generic callback interface
                     │  (x, y, player) → T │
                     └────────┬────────────┘
                              │ implementations:
              ┌───────────────┼───────────────┐
              │               │               │
     [TerritoryFilter]  [AllianceFilter]  [null = no filter]
              │
              v
┌─────────────────────────────────────────┐
│  PlacementContext.placementFilter?       │  ← injected, not hardcoded
│  Validators call it if present           │
└─────────────────────────────────────────┘

                     ┌─────────────────────┐
                     │  LogisticsFilter     │  ← generic callback interface
                     │  (src, dst, player)  │
                     │        → boolean     │
                     └────────┬────────────┘
                              │ implementations:
              ┌───────────────┼───────────────┐
              │               │               │
     [TerritoryFilter]  [ServiceAreaOnly]  [null = no filter]
              │
              v
┌─────────────────────────────────────────┐
│  RequestMatcher.matchFilter?            │  ← injected, not hardcoded
│  Called after supply match, before       │
│  carrier assignment                      │
└─────────────────────────────────────────┘
```

### Why Pluggable?

- **Replaceable**: Swap territory for alliance-based, diplomacy-based, or distance-based rules later.
- **Composable**: Chain multiple filters (e.g., territory AND distance limit).
- **Testable**: Tests pass `null` — no filter, no territory dependency.
- **Toggleable**: Debug panel can swap between filter implementations at runtime.

### Subsystems

| # | Subsystem | Responsibility | Files |
|---|-----------|---------------|-------|
| 1 | Filter interfaces | Define `PlacementFilter` and `LogisticsMatchFilter` callback types | `placement/types.ts`, `logistics/logistics-filter.ts` (new) |
| 2 | Territory filter implementations | Concrete territory-based implementations of both filter types | `features/territory/territory-filters.ts` (new) |
| 3 | Placement integration | Add optional `placementFilter` to `PlacementContext`; validators call it | `placement/types.ts`, `placement/internal/building-validator.ts`, `placement/internal/single-tile-validator.ts` |
| 4 | Placement wiring | Thread the filter into PlacementContext at all call sites | `commands/command.ts`, `game.ts` |
| 5 | Logistics integration | Replace `territoryEnabled` toggle with generic `matchFilter` on RequestMatcher; carrier filter on CarrierAssigner | `logistics/request-matcher.ts`, `logistics/carrier-assigner.ts`, `logistics/logistics-dispatcher.ts` |
| 6 | Logistics wiring | Create territory filters in GameServices, inject into dispatcher config | `game-services.ts`, `game.ts` |
| 7 | Tests | Unit tests for filters and integration | `tests/unit/buildings/placement.spec.ts`, `tests/unit/economy/logistics-territory.spec.ts` (new) |

## Data Models

### PlacementFilter (new type)

```typescript
/**
 * Optional filter that rejects placement based on game rules (territory, diplomacy, etc.).
 * Returns a PlacementStatus rejection reason, or null if placement is allowed.
 *
 * Validators call this after bounds check, before terrain/occupancy/slope checks.
 */
type PlacementFilter = (x: number, y: number, player: number) => PlacementStatus | null;
```

**Why return `PlacementStatus | null`?** The filter can provide a specific rejection reason (e.g., `OutOfTerritory`) for visual feedback. Returning `null` means "I don't object".

### LogisticsMatchFilter (new type)

```typescript
/**
 * Optional filter applied after supply matching, before carrier assignment.
 * Returns true if the match is allowed, false to reject it.
 */
type LogisticsMatchFilter = (
    sourceBuilding: Entity,
    destBuilding: Entity,
    playerId: number
) => boolean;
```

### CarrierFilter (new type)

```typescript
/**
 * Optional filter for carrier eligibility beyond basic idle/player checks.
 * Returns true if the carrier can be assigned.
 */
type CarrierFilter = (carrier: Entity, playerId: number) => boolean;
```

### PlacementContext (modified)

| Field | Type | Description |
|-------|------|-------------|
| groundType | `Uint8Array` | Terrain type per tile (existing) |
| groundHeight | `Uint8Array` | Terrain height per tile (existing) |
| mapSize | `MapSize` | Map dimensions (existing) |
| tileOccupancy | `Map<string, number>` | Occupied tiles (existing) |
| buildingFootprint | `ReadonlySet<string> \| undefined` | Existing building tiles for gap check (existing) |
| race | `Race \| undefined` | Player race for footprint lookup (existing) |
| **placementFilter** | `PlacementFilter \| null` | **NEW** — optional policy filter. Null = no extra restrictions. |
| **player** | `number \| undefined` | **NEW** — player performing placement. Required when `placementFilter` is set. |

### PlacementStatus (modified enum)

Add one new value:

| Value | Name | Description |
|-------|------|-------------|
| 6 | `OutOfTerritory` | Tile is outside the placing player's territory |

Renderer maps this to red (same as `InvalidTerrain`). Kept as a separate value so UI can show a distinct tooltip if desired.

## API Contracts

### Filter Interfaces

```typescript
// placement/types.ts
type PlacementFilter = (x: number, y: number, player: number) => PlacementStatus | null;

// logistics/logistics-filter.ts (new file)
type LogisticsMatchFilter = (src: Entity, dst: Entity, playerId: number) => boolean;
type CarrierFilter = (carrier: Entity, playerId: number) => boolean;
```

### Territory Filter Implementations

```typescript
// features/territory/territory-filters.ts (new file)

import type { TerritoryManager } from './territory-manager';
import type { PlacementFilter } from '../../features/placement/types';
import type { LogisticsMatchFilter, CarrierFilter } from '../../features/logistics/logistics-filter';
import { PlacementStatus } from '../../features/placement/types';

/** Reject placement outside player's territory. */
function createTerritoryPlacementFilter(tm: TerritoryManager): PlacementFilter {
    return (x, y, player) =>
        tm.isInTerritory(x, y, player) ? null : PlacementStatus.OutOfTerritory;
}

/** Reject logistics matches where source or dest is outside player territory. */
function createTerritoryMatchFilter(tm: TerritoryManager): LogisticsMatchFilter {
    return (src, dst, playerId) =>
        tm.isInTerritory(src.x, src.y, playerId) &&
        tm.isInTerritory(dst.x, dst.y, playerId);
}

/** Reject carriers outside player territory. */
function createTerritoryCarrierFilter(tm: TerritoryManager): CarrierFilter {
    return (carrier, playerId) =>
        tm.isInTerritory(carrier.x, carrier.y, playerId);
}
```

These are pure functions of `TerritoryManager` — no class, no state, just closures. Easy to replace with any other implementation.

### Validator Changes (internal)

```typescript
// building-validator.ts — validateBuildingPlacement
// After bounds check, before terrain check:
if (ctx.placementFilter && ctx.player !== undefined) {
    for (const tile of footprint) {
        const rejection = ctx.placementFilter(tile.x, tile.y, ctx.player);
        if (rejection !== null) {
            return { canPlace: false, status: rejection };
        }
    }
}

// single-tile-validator.ts — validateSingleTilePlacement
// After bounds check, before terrain check:
if (ctx.placementFilter && ctx.player !== undefined) {
    const rejection = ctx.placementFilter(x, y, ctx.player);
    if (rejection !== null) {
        return { canPlace: false, status: rejection };
    }
}
```

The validators don't know about territory — they just call the filter if one exists.

### RequestMatcher Changes

```typescript
class RequestMatcher {
    // REMOVE: territoryEnabled: boolean
    // REMOVE: territoryManager field
    // REMOVE: setTerritoryManager()

    // ADD: optional match filter (injected via config)
    private readonly matchFilter: LogisticsMatchFilter | null;

    constructor(config: RequestMatcherConfig) {
        // ...existing...
        this.matchFilter = config.matchFilter ?? null;
    }

    matchRequest(request: ResourceRequest): RequestMatchResult | null {
        // ...existing supply matching...

        // Generic filter hook — replaces hardcoded territory check
        if (this.matchFilter) {
            const sourceEntity = this.gameState.getEntity(match.sourceBuilding);
            if (!sourceEntity || !this.matchFilter(sourceEntity, destBuilding, playerId)) {
                return null;
            }
        }

        return { ...match, playerId };
    }
}
```

### RequestMatcherConfig Changes

```typescript
interface RequestMatcherConfig {
    gameState: GameState;
    inventoryManager: BuildingInventoryManager;
    serviceAreaManager: ServiceAreaManager;
    reservationManager: InventoryReservationManager;
    matchFilter?: LogisticsMatchFilter;  // NEW — optional policy filter
}
```

### CarrierAssigner Changes

```typescript
interface CarrierAssignerConfig {
    // ...existing fields...
    carrierFilter?: CarrierFilter;  // NEW — optional carrier eligibility filter
}

class CarrierAssigner {
    private readonly carrierFilter: CarrierFilter | null;

    // In findAvailableCarrier:
    // After entity.player !== playerId check:
    if (this.carrierFilter && !this.carrierFilter(entity, playerId)) continue;
}
```

### LogisticsDispatcher Changes

```typescript
interface LogisticsDispatcherConfig {
    // ...existing fields...
    matchFilter?: LogisticsMatchFilter;   // NEW — passed to RequestMatcher
    carrierFilter?: CarrierFilter;        // NEW — passed to CarrierAssigner
}

class LogisticsDispatcher {
    // REMOVE: get/set territoryEnabled
    // REMOVE: setTerritoryManager()
    // Constructor passes filters through to sub-components
}
```

## Error Handling & Boundaries

| Layer | On filter rejection... | Example |
|-------|----------------------|---------|
| Placement validators | Return `{ canPlace: false, status: <from filter> }` | `PlacementStatus.OutOfTerritory` |
| Command execution | Return `commandFailed(...)` with descriptive message | `"Cannot place building at (x, y): outside territory"` |
| RequestMatcher | Return `null` (no match) — same as today | Filter returns `false` |
| CarrierAssigner | Skip carrier, continue search | Filter returns `false` for carrier |
| Preview (PlaceBuildingMode) | Show red indicator | Mouse over non-territory tile |

### Edge cases

- **No territory buildings yet**: `TerritoryManager.isInTerritory()` returns `false` for all tiles → nothing can be placed. Correct — the initial castle is placed by map/script system which bypasses validation (no `placementFilter` in script context).
- **Filter is null**: All checks pass — same behavior as today. Tests and testMap mode don't set filters.
- **Filter swap at runtime**: Debug panel can swap `matchFilter` on `RequestMatcher` between territory, null, or a custom implementation. The filter is a simple property — no lifecycle concerns.
- **Script commands**: Bypass placement validators entirely. No filter involvement.
- **Free piles outside territory**: Remain unowned (player 0). Existing `game-services.ts` logic assigns ownership when territory covers them.

## Subsystem Details

### Subsystem 1: Filter Interfaces

**Files**: `src/game/features/placement/types.ts`, `src/game/features/logistics/logistics-filter.ts` (new)
**Owns**: The callback type definitions only — no implementations

**Key decisions**:
- `PlacementFilter` returns `PlacementStatus | null` so the filter controls the visual feedback reason.
- `LogisticsMatchFilter` receives full `Entity` objects (not just positions) so filters can check any entity property.
- `CarrierFilter` is separate from `LogisticsMatchFilter` — they're different concerns (carrier eligibility vs route eligibility).
- All filter types are nullable — absence means "no restriction".

### Subsystem 2: Territory Filter Implementations

**Files**: `src/game/features/territory/territory-filters.ts` (new)
**Owns**: Territory-specific filter factory functions
**Depends on**: `TerritoryManager`, filter type interfaces

**Key decisions**:
- Factory functions (`createTerritoryPlacementFilter`, etc.) return closures capturing `TerritoryManager`.
- No class — just functions. Simplest possible implementation.
- Lives in the `territory` feature module — if territory is removed, these go with it.
- Exported from `territory/index.ts` as part of the public API.

### Subsystem 3: Placement Integration

**Files**: `src/game/features/placement/types.ts`, `src/game/features/placement/internal/building-validator.ts`, `src/game/features/placement/internal/single-tile-validator.ts`
**Owns**: Calling the filter within validators

**Key decisions**:
- Filter is called after bounds check but before terrain/occupancy/slope — fail fast.
- For buildings: every footprint tile is checked. First failing tile short-circuits.
- Validators remain territory-agnostic — they call a generic `placementFilter` callback.
- `PlacementStatus.OutOfTerritory = 6` added to enum.

### Subsystem 4: Placement Wiring

**Files**: `src/game/commands/command.ts`, `src/game/game.ts`
**Owns**: Creating the filter and threading it into PlacementContext

**Key decisions**:
- `CommandContext` gains `placementFilter: PlacementFilter | null`. Set from `GameServices` during game initialization.
- `executePlaceBuilding` passes `placementFilter` and `cmd.player` into the `PlacementContext`.
- `canPlaceBuildingFootprint` convenience function gains optional `placementFilter` and `player` params.
- `PlaceBuildingMode` validator closure captures the filter from game context.

**Behavior**:
- In `game-services.ts`, after `TerritoryManager` is created: `this.placementFilter = createTerritoryPlacementFilter(this.territoryManager)`.
- This filter is passed through to `CommandContext` and placement mode validators.

### Subsystem 5: Logistics Integration

**Files**: `src/game/features/logistics/request-matcher.ts`, `src/game/features/logistics/carrier-assigner.ts`, `src/game/features/logistics/logistics-dispatcher.ts`, `src/game/features/logistics/logistics-filter.ts` (new)
**Owns**: Replacing hardcoded territory toggle with generic filter hooks

**Key decisions**:
- `RequestMatcher`: remove `territoryEnabled`, `territoryManager`, `setTerritoryManager()`. Replace with `matchFilter: LogisticsMatchFilter | null` from config.
- `CarrierAssigner`: add `carrierFilter: CarrierFilter | null` from config.
- `LogisticsDispatcher`: remove `territoryEnabled` getter/setter and `setTerritoryManager()`. Accept `matchFilter` and `carrierFilter` in `LogisticsDispatcherConfig`, pass through to sub-components.
- The filter replaces the hardcoded territory check at the exact same code location — after supply match, before return.

### Subsystem 6: Logistics Wiring

**Files**: `src/game/game-services.ts`, `src/game/game.ts`
**Owns**: Creating territory filters and injecting into dispatcher config

**Key decisions**:
- In `game-services.ts`, after `TerritoryManager` creation:
  ```typescript
  const matchFilter = createTerritoryMatchFilter(this.territoryManager);
  const carrierFilter = createTerritoryCarrierFilter(this.territoryManager);
  ```
- Pass into `LogisticsDispatcherConfig` as `matchFilter` and `carrierFilter`.
- Remove `this.logisticsDispatcher.setTerritoryManager(...)` call.
- Debug panel: the "Territory" toggle in `game.ts` becomes render-only (boundary dots visibility). To also disable territory enforcement at runtime, the toggle could swap `matchFilter` to `null` — but this is a debug concern, not a gameplay feature.

### Subsystem 7: Tests

**Files**: `tests/unit/buildings/placement.spec.ts`, `tests/unit/economy/logistics-territory.spec.ts` (new)

**Key decisions**:
- Existing placement tests: pass `placementFilter: null` (or omit it) — no behavioral change.
- New placement tests: pass a mock filter `(x, y, player) => x < 10 ? null : PlacementStatus.OutOfTerritory` to verify filter integration without needing real territory.
- Territory-specific tests: use `createTerritoryPlacementFilter(territoryManager)` with a real `TerritoryManager` on a small map with a castle.
- Logistics tests: mock `LogisticsMatchFilter` to verify `RequestMatcher` calls it and respects its result.
- Existing logistics tests: pass no `matchFilter` — behave as before.

## File Map

### New Files

| File | Subsystem | Purpose |
|------|-----------|---------|
| `src/game/features/logistics/logistics-filter.ts` | 1 | `LogisticsMatchFilter` and `CarrierFilter` type definitions |
| `src/game/features/territory/territory-filters.ts` | 2 | Factory functions for territory-based filter implementations |
| `tests/unit/economy/logistics-territory.spec.ts` | 7 | Territory enforcement tests for logistics filters |

### Modified Files

| File | Change |
|------|--------|
| `src/game/features/placement/types.ts` | Add `PlacementFilter` type, `OutOfTerritory` enum value, `placementFilter` and `player` fields on `PlacementContext` |
| `src/game/features/placement/internal/building-validator.ts` | Call `ctx.placementFilter` for each footprint tile (3-5 lines) |
| `src/game/features/placement/internal/single-tile-validator.ts` | Call `ctx.placementFilter` for the tile (3 lines) |
| `src/game/features/placement/index.ts` | Re-export `PlacementFilter` type |
| `src/game/features/territory/index.ts` | Re-export filter factory functions |
| `src/game/commands/command.ts` | Add `placementFilter` to `CommandContext`; pass into `PlacementContext` in `executePlaceBuilding` |
| `src/game/game.ts` | Pass placement filter when creating validators; simplify territory debug toggle to render-only |
| `src/game/features/logistics/request-matcher.ts` | Replace `territoryEnabled`/`territoryManager`/`setTerritoryManager()` with `matchFilter` from config |
| `src/game/features/logistics/carrier-assigner.ts` | Add `carrierFilter` from config; call in `findAvailableCarrier` |
| `src/game/features/logistics/logistics-dispatcher.ts` | Remove territory toggle/setter; accept `matchFilter`/`carrierFilter` in config, pass through |
| `src/game/features/logistics/index.ts` | Re-export `LogisticsMatchFilter`, `CarrierFilter` types |
| `src/game/game-services.ts` | Create territory filters after TerritoryManager init; pass in dispatcher config; remove `setTerritoryManager()` call |
| `tests/unit/buildings/placement.spec.ts` | Add territory filter tests; existing tests unaffected (no filter = no restriction) |

## Replacing Territory Later

To swap territory for a different policy (e.g., alliance-based logistics):

1. Write new filter factories in the new feature module:
   ```typescript
   function createAllianceMatchFilter(allianceManager: AllianceManager): LogisticsMatchFilter {
       return (src, dst, playerId) => allianceManager.areAllied(src.player, dst.player);
   }
   ```
2. In `game-services.ts`, replace `createTerritoryMatchFilter(...)` with `createAllianceMatchFilter(...)`.
3. No changes to validators, RequestMatcher, CarrierAssigner, or any other file.

To compose filters:
```typescript
function composeMatchFilters(...filters: LogisticsMatchFilter[]): LogisticsMatchFilter {
    return (src, dst, playerId) => filters.every(f => f(src, dst, playerId));
}

const filter = composeMatchFilters(
    createTerritoryMatchFilter(territoryManager),
    createAllianceMatchFilter(allianceManager),
);
```

## Open Questions

1. **Runtime filter swapping**: Should the debug panel be able to toggle territory enforcement on/off at runtime? If so, `matchFilter` on `RequestMatcher` should be a getter/setter rather than a constructor-only field. Current design: constructor-only is simpler; debug panel only toggles boundary dot rendering.

2. **PlacementStatus extensibility**: `OutOfTerritory` is added as enum value 6. If other filters need distinct rejection reasons in the future, the enum grows. Alternative: use a string-based status. Decision: keep enum — it's small, type-safe, and the renderer already uses numeric comparison.

3. **Filter granularity**: Current `LogisticsMatchFilter` receives full entities. Could receive just positions (x, y) for simpler interface. Decision: entities — filters may need player, type, or other properties beyond position.

## Out of Scope

- Territory expansion/shrinking animations
- Territory wars/conquest (overlapping zones)
- Territory-based unit movement restrictions
- Territory-based combat triggers
- Filter composition utilities (trivial to add when needed)
- Alliance/diplomacy filter implementations (designed for, not implemented)
