# Idle Carrier Pool — Design

## Overview

Extract the duplicated "find nearest idle carrier" logic from 4 call sites into a single `IdleCarrierPool` service. Every system that needs an idle carrier queries this pool instead of reimplementing the same ECS iteration + busy/reserved checks.

## Current State

- **What exists**: 4 near-identical `findIdleCarrier` / `findAvailableCarrier` implementations:
  1. `CarrierAssigner.findAvailableCarrier()` — logistics transport jobs. Checks `activeJobs.has(id)` + optional `carrierFilter`. Uses `hexDistance`.
  2. `ConstructionDemandFeature.create()` — inline closure. Checks `logisticsDispatcher.activeJobs.has(id)` + `unitReservation.isReserved(id)`. Uses distSq.
  3. `BuildingDemandFeature.create()` — identical inline closure to (2).
  4. `BarracksTrainingManager.findIdleCarrier()` — private method. Checks `isCarrierBusy(id)` (which is `activeJobs.has`), but does NOT check `unitReservation`. Uses distSq.

- **Problems**:
  - Each caller decides independently which "busy" checks to apply — some check `unitReservation`, some don't (barracks is a bug)
  - `CarrierAssigner` uses `hexDistance`, others use Euclidean distSq — inconsistent but both work
  - Adding a new busy-check (e.g. territory enforcement) requires updating 4 places

- **What stays**: `CarrierAssigner` still orchestrates transport job creation. `BarracksTrainingManager` still orchestrates training. The pool only replaces the carrier-finding part.

- **What gets deleted**: The 4 inline/private `findIdleCarrier` implementations.

## Summary for Review

- **Interpretation**: Create a shared service that centralizes "is this carrier idle and available?" logic. All systems query it via one method. The service owns the definition of "available" — not busy with transport, not reserved by another feature.
- **Key decisions**:
  - The pool is a lightweight query service, not a stateful reservation system. It answers "who is available right now?" but doesn't claim carriers. Callers still do their own claiming (assignJob, reserve, etc.).
  - `UnitReservationRegistry` stays as-is — it already tracks commitments. The pool just reads `isReserved()` as one of its filters. No need to expand UnitReservationRegistry's role.
  - The pool combines ALL busy checks: `activeJobs.has(id)` + `unitReservation.isReserved(id)` + optional caller filter. This fixes the barracks bug (missing reservation check).
  - Standardize on distSq (Euclidean squared) for the nearest-carrier search — avoids the sqrt in `hexDistance` and all non-logistics callers already use it. `CarrierAssigner` switches to distSq too (ordering is preserved since sqrt is monotonic).
- **Assumptions**: No caller needs a different distance metric. The optional `CarrierFilter` from logistics is the only caller-specific filter needed.
- **Scope**: Only carrier lookup. `findIdleSpecialist` in `SettlerTaskSystem` is a different pattern (iterates runtimes, checks state machine) and stays separate.

## Conventions

- Optimistic programming: no `?.` on required deps, no silent fallbacks
- Feature modules: `internal/` for private files, `index.ts` for public API
- Config object pattern for 3+ constructor deps
- This is infrastructure shared across features, so it lives near the carrier registry

## Architecture

### Subsystems

| # | Subsystem | Responsibility | Depends On | Files |
|---|-----------|---------------|------------|-------|
| 1 | IdleCarrierPool | Query service: "find nearest available carrier" | — | `src/game/features/carriers/idle-carrier-pool.ts` |
| 2 | Consumer migration | Replace 4 call sites with pool queries | 1 | 4 feature files |

## Shared Contracts

```typescript
// src/game/features/carriers/idle-carrier-pool.ts

import type { GameState } from '../../game-state';
import type { CarrierRegistry } from './carrier-registry';
import type { UnitReservationRegistry } from '../../systems/unit-reservation';

/** Optional caller-specific filter (e.g. territory check). */
export type CarrierEligibilityFilter = (entityId: number) => boolean;

export interface IdleCarrierPoolConfig {
    gameState: GameState;
    carrierRegistry: CarrierRegistry;
    /** Returns true if carrier is busy with a transport job. */
    isTransportBusy: (carrierId: number) => boolean;
    unitReservation: UnitReservationRegistry;
}

export class IdleCarrierPool {
    constructor(config: IdleCarrierPoolConfig);

    /**
     * Find the nearest available carrier for `player` near (nearX, nearY).
     * "Available" = not transport-busy, not reserved, passes optional filter.
     * Returns entity ID or null.
     */
    findNearest(
        nearX: number,
        nearY: number,
        player: number,
        filter?: CarrierEligibilityFilter,
    ): number | null;
}
```

## Subsystem Details

### 1. IdleCarrierPool
**Files**: `src/game/features/carriers/idle-carrier-pool.ts`
**Key decisions**:
- Lives in `features/carriers/` next to `CarrierRegistry` since it's carrier-specific infrastructure
- `isTransportBusy` is injected as a callback (not a direct dep on LogisticsDispatcher) to avoid circular feature dependencies — carriers tier is lower than logistics tier
- Export from `features/carriers/index.ts`
- Distance: Euclidean distSq (no sqrt needed for comparison)

### 2. Consumer Migration
**Files**: 4 files modified
**Key decisions**:
- `CarrierAssigner`: remove private `findAvailableCarrier`, call `pool.findNearest()`. Pass existing `carrierFilter` as the optional filter param (adapt signature: current `CarrierFilter` takes `(entity, playerId)` but pool filter takes `(entityId)` — the adapter closure captures playerId).
- `ConstructionDemandFeature.create()`: replace inline closure with `pool.findNearest()` call
- `BuildingDemandFeature.create()`: same as above
- `BarracksTrainingManager`: remove private `findIdleCarrier` + `isCarrierBusy` config field. Inject `IdleCarrierPool` instead. This also fixes the missing `unitReservation` check.

## File Map

### New Files
| File | Subsystem | Purpose |
|------|-----------|---------|
| `src/game/features/carriers/idle-carrier-pool.ts` | 1 | Query service implementation |

### Modified Files
| File | Change |
|------|--------|
| `src/game/features/carriers/index.ts` | Export `IdleCarrierPool` and `CarrierEligibilityFilter` |
| `src/game/features/carriers/carrier-feature.ts` | Create `IdleCarrierPool` instance, add to feature exports |
| `src/game/features/logistics/carrier-assigner.ts` | Replace `findAvailableCarrier` with `pool.findNearest()`, remove carrierRegistry/activeJobs fields |
| `src/game/features/logistics/logistics-dispatcher-feature.ts` | Pass pool from carrier feature exports to CarrierAssigner |
| `src/game/features/building-construction/construction-demand-feature.ts` | Replace inline `findIdleCarrier` closure with `pool.findNearest()` |
| `src/game/features/building-demand/building-demand-feature.ts` | Replace inline `findIdleCarrier` closure with `pool.findNearest()` |
| `src/game/features/barracks/barracks-training-manager.ts` | Replace `findIdleCarrier`/`isCarrierBusy` with `pool.findNearest()` |
| `src/game/features/barracks/barracks-feature.ts` | Pass pool instead of `isCarrierBusy` callback |
| `src/game/features/logistics/logistics-filter.ts` | Remove `CarrierFilter` type (replaced by `CarrierEligibilityFilter`) or keep as adapter |

## Verification
- Logistics transport still assigns nearest carrier to matched requests
- Construction demand still finds carrier for worker recruitment
- Building demand still finds carrier for specialist recruitment
- Barracks training now correctly skips reserved carriers (bug fix)
- Adding a new global busy-check only requires changing `IdleCarrierPool`
