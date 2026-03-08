# Logistics Robustness — Design

## Overview

Fix material delivery overflow and stall bugs in the logistics system. Multiple carriers deliver STONE to a building that can't accept it all, causing overflow → free pile drops → feedback loop creating infinite requests. Root cause: no destination-side capacity tracking, missing job-validity checks on delivery, and transport cancellation not interrupting carrier movement.

## Current State

- **What exists**: Logistics dispatcher matches requests to supplies, reserves source inventory, assigns carriers. Source-side reservation prevents double-withdrawal. Stall detector logs warnings but takes no action.
- **What stays**: Request matching, source-side reservations, carrier assignment, transport job lifecycle, stall detection logging.
- **What changes**: Add destination-side in-flight tracking, guard delivery against cancelled/overflow scenarios, break the overflow feedback loop, add stall recovery.

## Summary for Review

- **Interpretation**: The observed bug has two interlinked causes: (1) `executeTransportDelivery` deposits material unconditionally — even when the job was cancelled or the destination is full — producing overflow dropped as free piles; (2) when overflow occurs, `recordDelivery` is never called (because `inventory:changed` doesn't fire for 0-deposit), but the request IS fulfilled and removed, so `ConstructionRequestSystem` sees a gap between `remaining` and `activeRequests` and creates replacement requests — forming an infinite overflow loop.
- **Key decisions**: Fix the overflow feedback loop at three levels: (a) prevent over-dispatch via in-flight tracking, (b) guard delivery execution, (c) break the feedback loop by tracking deliveries correctly even on overflow.
- **Assumptions**: The stall (38-58s walk) is caused by distant source buildings or pathfinding detours, not a movement system bug. Stall recovery should cancel and re-queue, not fix pathing.
- **Scope**: Fixes overflow loop, adds delivery guards, adds in-flight tracking, adds stall recovery. Does NOT change pathfinding, carrier selection heuristics, or request prioritization.

## Conventions

- Optimistic programming: assert contracts, no fallbacks on required values, `getEntityOrThrow`
- Feature modules: state in feature, events over direct calls, single entry via `index.ts`
- Max 140 chars/line, max cyclomatic complexity 15
- Match Settlers 4 naming (`Carrier`, `STONE`, `StorageArea`)
- Validate with `pnpm lint`, never `pnpm build`

## Architecture

### Subsystems

| # | Subsystem | Responsibility | Depends On | Files |
|---|-----------|---------------|------------|-------|
| 1 | Overflow feedback loop fix | Track construction deliveries correctly on overflow | — | `building-lifecycle-feature.ts`, `transport-executors.ts` |
| 2 | Delivery guard | Check job validity and destination acceptance before depositing | — | `transport-executors.ts` |
| 3 | In-flight tracking | Track materials in-flight to destinations, prevent over-dispatch | — | `logistics-dispatcher.ts`, `transport-job-service.ts` |
| 4 | Stall recovery | Cancel stalled jobs and reset requests to pending for retry | 3 | `stall-detector.ts`, `logistics-dispatcher.ts` |
| 5 | Construction request cap | Use in-flight count to cap construction request creation | 3 | `construction-request-system.ts` |

## Shared Contracts

```typescript
// --- In-flight tracking (new) ---
// Tracks how many units of each material are currently being carried TO each building.
// Incremented when carrier picks up, decremented on delivery/cancel/drop.

interface InFlightTracker {
    /** Record that a carrier picked up material heading to destBuilding. */
    recordPickup(destBuilding: number, material: EMaterialType, amount: number): void;
    /** Record that material was delivered (or dropped/cancelled) for destBuilding. */
    recordResolved(destBuilding: number, material: EMaterialType, amount: number): void;
    /** Get total in-flight amount for a building+material. */
    getInFlightAmount(destBuilding: number, material: EMaterialType): number;
}

// --- Stall recovery (extension to StallDetector) ---
interface StallRecoveryAction {
    carrierId: number;
    requestId: number;
    jobId: number;
}
```

## Subsystem Details

### Subsystem 1 — Overflow feedback loop fix
**Files**: `src/game/features/building-construction/building-lifecycle-feature.ts`, `src/game/features/settler-tasks/internal/transport-executors.ts`
**Key decisions**:
- In `executeTransportDelivery`: after `materialTransfer.deliver()`, if `deposited === 0` (full overflow), still emit a synthetic event or directly call `recordDelivery` on the construction site so `delivered` count stays in sync with fulfilled requests. This breaks the feedback loop.
- Approach: emit `construction:materialOverflowed` event from `executeTransportDelivery` when overflow > 0, listened to by `BuildingLifecycleHandler` which calls `recordDelivery` with the overflow amount. This keeps delivery tracking accurate — the material WAS intended for this site, and the request was fulfilled, so the "delivered" counter must increment even though the material ended up as a free pile.
- Alternative considered: track in `ConstructionRequestSystem` instead. Rejected because the root cause is the `delivered` counter being wrong — fixing it at the source is cleaner.

### Subsystem 2 — Delivery guard
**Files**: `src/game/features/settler-tasks/internal/transport-executors.ts`
**Key decisions**:
- Add job-validity check at the start of `executeTransportDelivery`, mirroring the existing check in `executeTransportPickup`. If `ctx.transportJobOps.getJob(jobId)` returns undefined, drop the material as a free pile via `ctx.materialTransfer.drop(settler.id)` and return `TaskResult.FAILED`.
- This prevents depositing material when the job was cancelled externally (building destroyed, construction completed) but the carrier's choreography kept running.
- The `materialTransfer.drop()` path already exists and is safe — it places a free pile at the carrier's position.

### Subsystem 3 — In-flight tracking
**Files**: `src/game/features/logistics/in-flight-tracker.ts` (new), `src/game/features/logistics/logistics-dispatcher.ts`, `src/game/features/logistics/transport-job-service.ts`, `src/game/features/logistics/index.ts`
**Key decisions**:
- Simple `Map<number, Map<EMaterialType, number>>` keyed by destBuilding. Incremented in `TransportJobService.pickUp()`, decremented in `TransportJobService.deliver()` and `TransportJobService.cancel()` (only if phase was PickedUp).
- Owned by `LogisticsDispatcher`, passed to `TransportJobService` via `TransportJobDeps`.
- Exposed read-only for `ConstructionRequestSystem` to query.
- Does NOT replace source-side reservations — complementary system for destination-side awareness.

### Subsystem 4 — Stall recovery
**Files**: `src/game/features/logistics/stall-detector.ts`, `src/game/features/logistics/logistics-dispatcher.ts`
**Key decisions**:
- Add a second, higher threshold (`STALL_CANCEL_THRESHOLD_SEC = 60`) beyond which stalled jobs are cancelled. The existing 30s threshold remains diagnostic-only (warning).
- `StallDetector.tick()` returns a list of `StallRecoveryAction` for jobs exceeding the cancel threshold. `LogisticsDispatcher` processes these by calling `TransportJobService.cancel()` and removing from `activeJobs`.
- The cancelled carrier will still carry material — it will be dropped by `interruptJob` in the settler task system when the `carrier:transportCancelled` event propagates.
- Important: the carrier's settler task must also be interrupted. Add a listener for `carrier:transportCancelled` in `SettlerTaskSystem` that calls `interruptJobForCleanup` on the affected carrier.

### Subsystem 5 — Construction request cap
**Files**: `src/game/features/building-construction/construction-request-system.ts`
**Key decisions**:
- Query in-flight count from `InFlightTracker` when computing the cap: `cap = Math.min(remaining - inFlight, MAX_ACTIVE_PER_MATERIAL)`. This prevents creating requests for material already picked up and en route.
- `inFlight = inFlightTracker.getInFlightAmount(buildingId, material)`.
- Also cap by remaining inventory space: `const inventorySpace = slotCapacity - currentAmount - inFlight`. But this is secondary to the `remaining - inFlight` cap since construction slots have `maxCapacity === cost.count`.

## File Map

### New Files
| File | Subsystem | Purpose |
|------|-----------|---------|
| `src/game/features/logistics/in-flight-tracker.ts` | 3 | Destination-side in-flight material tracking |

### Modified Files
| File | Change |
|------|--------|
| `src/game/features/settler-tasks/internal/transport-executors.ts` | Add job-validity guard in `executeTransportDelivery`; emit overflow event |
| `src/game/features/building-construction/building-lifecycle-feature.ts` | Listen to overflow event, call `recordDelivery` on overflow |
| `src/game/features/logistics/logistics-dispatcher.ts` | Create and own `InFlightTracker`; process stall recovery actions |
| `src/game/features/logistics/transport-job-service.ts` | Update `InFlightTracker` on pickUp/deliver/cancel; add tracker to `TransportJobDeps` |
| `src/game/features/logistics/stall-detector.ts` | Return recovery actions for jobs exceeding cancel threshold |
| `src/game/features/building-construction/construction-request-system.ts` | Query in-flight tracker to cap request creation |
| `src/game/features/logistics/index.ts` | Export `InFlightTracker` |
| `src/game/features/settler-tasks/settler-task-system.ts` | Listen to `carrier:transportCancelled`, interrupt affected carrier task |

## Verification
- Place a building far from any StorageArea with STONE. Verify no overflow warnings — all STONE delivered exactly once per request.
- Destroy a source building while a carrier is walking with material. Verify carrier drops material, request resets, new carrier assigned without double delivery.
- Complete a construction site while carriers are en route. Verify in-flight carriers drop material instead of depositing into production inventory.
- Let carriers stall for 60+ seconds (e.g., blocked path). Verify stall recovery cancels jobs and carriers drop material.
