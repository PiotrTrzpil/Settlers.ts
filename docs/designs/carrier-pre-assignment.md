# Carrier Pre-Assignment Queue — Design

## Overview

When the logistics system needs a carrier, it currently only considers idle carriers. This means a carrier 50 tiles away gets picked even if a busy carrier 5 tiles away is about to finish its delivery. The pre-assignment queue lets CarrierAssigner "claim" a busy carrier in PickedUp phase whose estimated total cost (finish current delivery + walk to new source) beats the best idle option. When that carrier finishes, the queued job kicks in immediately instead of the carrier going idle.

## Current State

- **What exists**: `CarrierAssigner.findCarrier()` calls `IdleCarrierPool.findNearest()` which only returns carriers that are currently idle (not transport-busy, not reserved). `LogisticsDispatcher.activeJobs` tracks all in-flight transport jobs by carrier ID. On `carrier:deliveryComplete`, the dispatcher simply deletes from `activeJobs` and the carrier becomes idle.
- **What stays**: IdleCarrierPool remains the primary lookup. The pool doesn't change — it stays a simple query service. The pre-assignment queue is logistics-internal, layered on top.
- **What changes**: CarrierAssigner gains a secondary search path: scan busy carriers in PickedUp phase, estimate their "time to available + walk to source" cost, and compare against the best idle carrier. If a busy carrier wins, queue the assignment. LogisticsDispatcher gains a `pendingAssignments` map and hooks `carrier:deliveryComplete` to flush queued jobs.

## Summary for Review

- **Interpretation**: Optimize carrier selection by considering soon-to-be-idle carriers alongside currently idle ones. This is logistics-internal — IdleCarrierPool stays unchanged. The queue lives in LogisticsDispatcher/CarrierAssigner.
- **Key decisions**:
  - Only carriers in **PickedUp phase** are candidates — they have a known destination (destBuilding) and are guaranteed to finish soon. Reserved-phase carriers are still en route to pickup, too unpredictable.
  - Cost model: `distSq(carrier.pos, destBuilding.pos) + distSq(destBuilding.pos, newSource.pos)` vs `distSq(idleCarrier.pos, newSource.pos)`. Both use distSq, no sqrt needed. The busy carrier cost is an overestimate (carrier may be closer to dest than current position suggests), which is fine — it makes the comparison conservative.
  - A carrier can have **at most one** queued assignment. If a better assignment comes along for the same carrier, it replaces the previous one (the previous request goes back to Pending).
  - Queued assignments reserve inventory immediately (via TransportJobService.activate) — otherwise the supply could be claimed by someone else before the carrier arrives. This means a queued job is a real TransportJobRecord in Reserved phase, stored in `activeJobs` under a separate "queued" map.
  - If the queued carrier is killed or its current job is cancelled, the queued assignment is also cancelled (inventory reservation released, request reset to Pending).
- **Assumptions**: PickedUp carriers are close enough to their destination that the cost estimate is useful. We don't need path-length prediction — distSq from current position to dest is good enough.
- **Scope**: Only transport jobs (logistics). Barracks, construction-demand, and building-demand features are not affected — they use IdleCarrierPool directly and don't need pre-assignment.

## Conventions

- Optimistic programming: no `?.` on required deps, no silent fallbacks, throw with context
- Config object pattern for 3+ constructor deps
- Events: `"domain:past-tense"` format
- Deterministic iteration: sorted entity IDs when order matters
- Max complexity 15 per function — extract helpers

## Architecture

### Subsystems

| # | Subsystem | Responsibility | Depends On | Files |
|---|-----------|---------------|------------|-------|
| 1 | Pre-assignment queue | Store/cancel/flush queued assignments for busy carriers | — | `src/game/features/logistics/pre-assignment-queue.ts` |
| 2 | CarrierAssigner integration | Compare idle vs busy candidates, queue winning busy carrier | 1 | `src/game/features/logistics/carrier-assigner.ts` |
| 3 | LogisticsDispatcher wiring | Flush queue on delivery, cancel on carrier death, expose to assigner | 1 | `src/game/features/logistics/logistics-dispatcher.ts` |

## Shared Contracts

```typescript
// src/game/features/logistics/pre-assignment-queue.ts

import type { TransportJobRecord } from './transport-job-record';

/** A queued assignment waiting for a busy carrier to finish its current job. */
export interface QueuedAssignment {
    /** The carrier that will execute this job when it finishes its current delivery. */
    carrierId: number;
    /** The transport job record (already activated — inventory reserved, request InProgress). */
    record: TransportJobRecord;
    /** The choreo job state to assign when the carrier becomes available. */
    job: JobState;
    /** First movement target for assignJob. */
    moveTo: { x: number; y: number };
}

/**
 * Manages queued transport assignments for busy carriers.
 *
 * Invariants:
 * - At most one queued assignment per carrier.
 * - Queued jobs have real inventory reservations (TransportJobRecord in Reserved phase).
 * - When a queued assignment is cancelled, the reservation is released and request reset.
 */
export class PreAssignmentQueue {
    /**
     * Queue an assignment for a carrier that's currently busy.
     * If the carrier already has a queued assignment, the old one is cancelled first.
     */
    queue(assignment: QueuedAssignment): void;

    /**
     * Flush the queued assignment for a carrier that just finished.
     * Returns the assignment to execute, or null if nothing queued.
     * Removes the entry from the queue.
     */
    flush(carrierId: number): QueuedAssignment | null;

    /**
     * Cancel the queued assignment for a carrier (carrier killed, current job cancelled).
     * Releases inventory reservation and resets request to Pending.
     */
    cancel(carrierId: number): void;

    /** Check if a carrier has a queued assignment. */
    has(carrierId: number): boolean;

    /** Number of queued assignments. For diagnostics. */
    get size(): number;
}
```

```typescript
// Addition to CarrierAssigner — new method signature

export interface BusyCarrierCandidate {
    carrierId: number;
    /** Where the carrier will end up (destBuilding position). */
    futureX: number;
    futureY: number;
    /** Estimated cost: distSq(carrier.pos → dest) + distSq(dest → newSource). */
    estimatedCostSq: number;
}
```

```typescript
// Addition to IdleCarrierPool (already implemented)

/** Already exists — findNearestWithCost returns { carrierId, distSq } | null */
```

## Subsystem Details

### 1. PreAssignmentQueue
**Files**: `src/game/features/logistics/pre-assignment-queue.ts`
**Key decisions**:
- Pure data structure, no event subscriptions. LogisticsDispatcher calls `cancel`/`flush` from its own event handlers.
- `cancel()` needs `TransportJobDeps` to release reservations — inject via constructor.
- `queue()` with an existing carrier first cancels the old assignment (releases reservation), then stores the new one.
- Iteration for diagnostics uses sorted carrier IDs.

### 2. CarrierAssigner integration
**Files**: `src/game/features/logistics/carrier-assigner.ts`
**Key decisions**:
- New method `findBestCarrier()` replaces `findCarrier()`. It does two lookups in parallel:
  1. `idleCarrierPool.findNearestWithCost()` → best idle candidate
  2. Scan `activeJobs` for PickedUp-phase carriers, compute estimated cost for each → best busy candidate
- Compare the two costs. If busy carrier wins, return a result that signals "queue this" instead of "assign now".
- `tryAssignMatch` needs to handle the "queue" case: call `TransportJobService.activate` (reserve inventory), build the choreo job, then `queue.queue()` instead of `jobAssigner.assignJob()`.
- The busy carrier scan needs access to `activeJobs` (already available on LogisticsDispatcher). Pass it to CarrierAssigner as a readonly ref, or add a `getBusyCandidates(sourceX, sourceY, player)` method.
- Filter busy carriers by player. Skip carriers that already have a queued assignment (`queue.has(id)`).
- `rankByTotalTrip` also benefits: for each source candidate, compare both idle and busy carriers.

### 3. LogisticsDispatcher wiring
**Files**: `src/game/features/logistics/logistics-dispatcher.ts`
**Key decisions**:
- Create `PreAssignmentQueue` in constructor, pass `TransportJobDeps`.
- On `carrier:deliveryComplete`: after `activeJobs.delete(carrierId)`, call `queue.flush(carrierId)`. If a queued assignment exists, call `jobAssigner.assignJob()` and add the new record to `activeJobs`. If `assignJob` fails, cancel the queued assignment.
- On `carrier:pickupFailed` and `carrier:transportCancelled`: also call `queue.cancel(carrierId)` — if the current job fails, the queued one should be cancelled too.
- On building destruction (`handleBuildingDestroyed`): scan queued assignments for jobs referencing the destroyed building (source or dest) and cancel them.
- Pass `queue` and `activeJobs` to `CarrierAssigner` config so it can scan busy carriers and queue assignments.
- `activeJobs` for queued records: the queued TransportJobRecord is NOT in `activeJobs` until the carrier actually starts it. This keeps the "is carrier transport-busy?" check clean — `activeJobs.has(id)` returns true only for the current job, not the queued one.

## File Map

### New Files
| File | Subsystem | Purpose |
|------|-----------|---------|
| `src/game/features/logistics/pre-assignment-queue.ts` | 1 | Queue data structure + cancel/flush logic |

### Modified Files
| File | Change |
|------|--------|
| `src/game/features/logistics/carrier-assigner.ts` | Add busy carrier scanning, queue-or-assign logic |
| `src/game/features/logistics/logistics-dispatcher.ts` | Create queue, flush on delivery, cancel on failure/destruction |

## Verification
- Idle carrier 50 tiles away vs busy carrier (PickedUp) 5 tiles from its dest, dest is near new source → busy carrier is selected and queued
- Queued carrier is killed → queued assignment cancelled, inventory reservation released, request goes back to Pending
- Queued carrier's current job is cancelled (building destroyed) → queued assignment also cancelled
- Building referenced by queued assignment is destroyed → queued assignment cancelled
- Carrier finishes delivery with queued assignment → immediately starts new job (no idle tick gap)
- No queued assignment → carrier goes idle as before (no behavioral regression)
