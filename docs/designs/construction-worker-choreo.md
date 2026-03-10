# Construction Worker Choreo Migration — Design

## Overview

Replace the builder/digger "roaming spatial search" pattern with **site-orchestrated dispatch**. Construction sites know exactly what work they need (which tiles to level, how much building progress remains). Instead of recruiting generic workers who find sites themselves, the construction site creates demands, gets workers dispatched to it, and pushes specific work assignments as choreo jobs. Same pattern as BuildingDemand for workplace workers.

## Current State

- **Recruitment**: `construction:workerNeeded` → RecruitSystem demand queue (capped at 4 builders / 4 diggers globally) → carrier transforms → worker enters idle scan
- **Work finding**: Builder/digger `EntityWorkHandler.findTarget()` spatial-searches all construction sites every idle tick. Claims a slot, picks a random tile/position, starts a 2-node choreo job (`GO_TO_POS → WORK`). After completing, releases slot, returns to idle, spatial-searches again.
- **Slot tracking**: `pendingClaims` / `activeWorkers` maps in work handler closures. FIFO queue per site. Reserved tiles per digger.
- **Problems**:
  - Pull model: idle workers scan all sites every tick — wasteful, non-deterministic priority
  - Recruitment is disconnected from dispatch — carrier transforms into builder, then builder has to re-discover the site that needed it
  - Slot tracking is split between ConstructionSiteManager (slots) and work handler closures (pending/active maps) — two sources of truth
  - No orchestration: if a site needs 3 diggers, it emits one event and hopes 3 workers find it eventually

## Summary for Review

- **Interpretation**: Construction sites should orchestrate their workers the same way BuildingDemand orchestrates workplace workers. The site owns the demands, gets workers dispatched to specific positions, and pushes new work assignments when tiles/cycles complete.
- **Key decisions**:
  - **Site-driven demands**: ConstructionSiteManager creates one demand per worker slot needed (e.g., 3 digger demands for a site needing 3 digger slots). Each demand tracks a specific worker through the full lifecycle.
  - **Full choreo jobs**: Recruitment + dispatch + work in a single job: `goTo(pile) → transformRecruit(Digger) → goTo(tile) → dig`. Or if an idle digger exists: `goTo(tile) → dig`.
  - **Site pushes next assignment**: When a digger finishes a tile, the site builds a new choreo job for the next tile and assigns it. No idle scan.
  - **Global cap stays**: Max 4 builders / 4 diggers per player. But the cap is enforced by the site manager when creating demands, not by RecruitSystem.
  - **Delete EntityWorkHandler for CONSTRUCTION / CONSTRUCTION_DIG**: No more spatial search, no more `findTarget`, no more closure-based slot tracking. Site manager owns all slot state directly.
  - **Workers are site-assigned during construction**: A digger dispatched to site X stays assigned to site X until leveling completes (or site is cancelled). Not roaming.
- **Assumptions**:
  - A worker assigned to a site stays there until that phase completes. No mid-phase reassignment to a closer site.
  - If a site is cancelled (building removed), its workers become idle and can be picked up by other site demands.
  - Workers are reserved during approach (same as BuildingDemand), released when they start working at the site.
- **Scope**: Recruitment, dispatch, and work assignment for builders/diggers. Does not change ConstructionSiteManager's core progress/material tracking.

## Conventions

- Optimistic programming: no `?.` on required deps, crash loudly
- Max 140 char lines, max complexity 15 per function
- Site-driven, not worker-driven. Workers don't search — sites push.

## Architecture

### New lifecycle

```
Building placed
  → ConstructionSiteManager.registerSite()
  → Site creates N digger demands (one per slot)

Each demand:
  → Find idle digger OR find idle carrier
  → Build choreo job:
      [goTo(pile) → transformRecruit(Digger) →] goTo(tile) → dig
  → Assign job, mark worker as committed to site

Digger finishes tile:
  → Site picks next unleveled tile
  → Builds new choreo job: goTo(nextTile) → dig
  → Assigns to same worker
  → (If no tiles left: leveling complete, release digger)

All terrain leveled:
  → Site creates M builder demands (one per slot)
  → Same pattern: recruit/dispatch → goTo(pos) → build → repeat

Builder finishes cycle:
  → If materials still available: site pushes next build cycle job
  → If materials exhausted: release builder (becomes idle, available for other sites)
  → When new materials delivered to site: site re-creates demands for released slots

Building complete:
  → Release all builders, remove site
```

### Subsystems

| # | Subsystem | Responsibility | Depends On | Files |
|---|-----------|---------------|------------|-------|
| 1 | ConstructionSiteDemand | Demand creation + worker lifecycle per site. Creates demands, handles fulfillment callbacks, pushes next work assignment on completion. | — | `src/game/features/building-construction/construction-site-demand.ts` |
| 2 | Construction choreo jobs | Builder/digger-specific choreo job factories using the builder | — | `src/game/features/building-construction/construction-jobs.ts` |
| 3 | Work executors | New choreo executors: `DIG_TILE`, `BUILD_STEP` (replace the EntityWorkHandler tick-based pattern) | 2 | `src/game/features/building-construction/internal/construction-executors.ts` |
| 4 | Cleanup | Delete CONSTRUCTION/CONSTRUCTION_DIG EntityWorkHandlers, remove from RecruitSystem | 1,2,3 | Multiple files |
| 5 | Tests | Full lifecycle: place → recruit → dig → build → complete | all | `tests/unit/` |

## Shared Contracts

```typescript
// ── src/game/features/building-construction/construction-site-demand.ts ──

/** Tracks one worker demand for a construction site. */
export interface ConstructionWorkerDemand {
    /** Construction site (building entity ID). */
    siteId: number;
    /** Role: digger or builder. */
    role: 'digger' | 'builder';
    /** Committed worker ID, or null if still searching for a candidate. */
    workerId: number | null;
    /** Player who owns the site. */
    player: number;
}

/**
 * Manages construction worker demands across all active sites.
 * Creates demands when sites need workers, finds candidates (idle
 * specialists or carriers to recruit), builds choreo jobs, and
 * pushes next assignments on work completion.
 */
export class ConstructionSiteDemandSystem implements TickSystem {
    /** Create demands for a newly registered site. */
    onSiteRegistered(siteId: number): void;

    /** Cancel all demands for a removed site, release workers. */
    onSiteRemoved(siteId: number): void;

    /** Called when leveling completes — release diggers, create builder demands. */
    onLevelingComplete(siteId: number): void;

    /** Called when a worker's choreo job completes — push next assignment. */
    onWorkerJobCompleted(workerId: number, siteId: number): void;

    /** Called when a worker's choreo job fails/is interrupted — release, re-demand. */
    onWorkerJobFailed(workerId: number, siteId: number): void;
}

// ── src/game/features/building-construction/construction-jobs.ts ──

/** Build a choreo job for a digger to level one tile. */
function buildDigTileJob(tileX: number, tileY: number, siteId: number): ChoreoJobState;

/** Build a choreo job for a builder to perform one build cycle at a site. */
function buildBuildStepJob(posX: number, posY: number, siteId: number): ChoreoJobState;

/** Build a full recruit-then-dig job (carrier → digger → first tile). */
function buildRecruitDiggerJob(
    pileX: number, pileY: number, pileEntityId: number,
    tileX: number, tileY: number, siteId: number
): ChoreoJobState;

/** Build a full recruit-then-build job (carrier → builder → first position). */
function buildRecruitBuilderJob(
    pileX: number, pileY: number, pileEntityId: number,
    posX: number, posY: number, siteId: number
): ChoreoJobState;

// Example job shapes:

// Recruit digger + first tile:
choreo('RECRUIT_DIGGER')
  .goTo(pile.x, pile.y, pileEntityId)
  .transformRecruit(UnitType.Digger)
  .goTo(tile.x, tile.y)
  .addNode(ChoreoTaskType.DIG_TILE)
  .target(pileEntityId)
  .meta({ siteId })
  .build()

// Existing digger → next tile:
choreo('DIG_TILE')
  .goTo(tile.x, tile.y)
  .addNode(ChoreoTaskType.DIG_TILE)
  .meta({ siteId })
  .build()

// Recruit builder + first position:
choreo('RECRUIT_BUILDER')
  .goTo(pile.x, pile.y, pileEntityId)
  .transformRecruit(UnitType.Builder)
  .goTo(pos.x, pos.y)
  .addNode(ChoreoTaskType.BUILD_STEP)
  .target(pileEntityId)
  .meta({ siteId })
  .build()

// Existing builder → next cycle:
choreo('BUILD_STEP')
  .goTo(pos.x, pos.y)
  .addNode(ChoreoTaskType.BUILD_STEP)
  .meta({ siteId })
  .build()
```

## Subsystem Details

### 1. ConstructionSiteDemandSystem
**Files**: `src/game/features/building-construction/construction-site-demand.ts`
**Key decisions**:
- Owns `Map<number, ConstructionWorkerDemand[]>` keyed by siteId.
- On site registered: queries ConstructionSiteManager for required digger/builder slot counts, creates that many demands.
- Tick-driven drain (every ~1s): iterates unfulfilled demands, tries to find candidates:
  1. Find idle digger/builder (via `settlerTaskSystem.findIdleSpecialist`)
  2. If none: find idle carrier, build recruit+work choreo job
  3. If none: retry next tick
- **Global cap**: tracks total committed workers per type per player. Won't create demands beyond cap (4 diggers, 4 builders). When a worker finishes at one site and another site has pending demands, the worker can be reassigned.
- Listens to `settler:taskCompleted` / `settler:taskFailed` to detect when a worker's job finishes, then pushes next assignment or releases the worker.
- On leveling complete: releases all digger demands for that site, creates builder demands.
- On materials exhausted (builder job completes but no materials left): releases builder, marks slot as vacant. Does NOT create a new demand — waits for material delivery event.
- On materials delivered (`construction:materialsDelivered` or similar): checks vacant builder slots, creates new demands for them (re-acquires builders from the idle pool or recruits new ones).
- On building complete: releases all builders, removes all demands for site.
- On site removed: cancels all demands, interrupts committed workers' jobs.
- **Workers are loosely assigned**: committed to a site via demand tracking, but no `homeAssignment` (they're not building-assigned in the SettlerTaskSystem sense). The demand system owns the worker↔site relationship.

### 2. Construction Choreo Jobs
**Files**: `src/game/features/building-construction/construction-jobs.ts`
**Key decisions**:
- Factory functions using ChoreoBuilder. Each returns a `ChoreoJobState`.
- `siteId` stashed in `metadata` so executors and the demand system can look up the site.
- Recruit jobs chain: `goTo(pile) → transformRecruit → goTo(workPos) → DIG_TILE/BUILD_STEP`
- Continuing jobs (next tile/cycle): `goTo(workPos) → DIG_TILE/BUILD_STEP`
- If idle specialist found, job is just: `goTo(workPos) → DIG_TILE/BUILD_STEP`

### 3. Work Executors
**Files**: `src/game/features/building-construction/internal/construction-executors.ts`
**Key decisions**:
- `DIG_TILE` executor:
  - Reads `job.metadata.siteId`, reads the tile reservation for this worker from ConstructionSiteManager
  - Calls `constructionSiteManager.completeTile(siteId, tileIndex)`
  - Returns `TaskResult.DONE` — the demand system handles what comes next
- `BUILD_STEP` executor:
  - Reads `job.metadata.siteId`
  - Calls `constructionSiteManager.advanceConstruction(siteId, progressPerCycle)`
  - Handles material consumption (same logic as current `onWorkComplete` in builder handler)
  - Returns `TaskResult.DONE` — demand system checks material availability and either pushes next cycle or releases the builder
- Both are single-tick executors (work happens instantly on arrival, like today's `onWorkTick: () => true`)
- Registered on ChoreoSystem in the building-construction feature's `create()` function
- **Tile reservation**: For diggers, the demand system reserves a tile when building the job (via `constructionSiteManager.reserveUnleveledTile`). The tile coords are baked into the choreo job's `goTo`. On interrupt, the demand system releases the reservation.

### 4. Cleanup
**Files**: Multiple
**Key decisions**:
- Delete `createDiggerHandler` and `createBuilderHandler` from `work-handlers.ts`
- Remove `SearchType.CONSTRUCTION` and `SearchType.CONSTRUCTION_DIG` handler registrations from SettlerTaskSystem
- Remove `construction:workerNeeded` listener and all Builder/Digger demand logic from RecruitSystem
- Remove `MAX_AUTO_BUILDERS`, `MAX_AUTO_DIGGERS` from RecruitSystem (moved to demand system)
- SettlerConfig for Builder/Digger: search type may change or become irrelevant (they no longer self-search). The idle loop for these unit types should defer to the demand system entirely — if a builder has no active job, it's because the demand system hasn't assigned one yet.
- **`shouldWaitForWork`**: Builders/diggers currently have `shouldWaitForWork: true` on their handler. With site-driven dispatch, idle builders just... wait. The demand system assigns work when available. No scan needed.

### 5. Tests
**Files**: `tests/unit/`
**Key decisions**:
- Full lifecycle: place building → site creates digger demands → carrier recruited → transforms → walks to tile → digs → next tile → leveling complete → builder demands created → carrier recruited → builds → complete
- Cap: 5 sites placed → only 4 diggers recruited, remaining sites wait
- Site cancelled mid-work: workers released, become idle, picked up by other sites
- Worker killed: demand system detects failure, creates new demand for replacement

## File Map

### New Files
| File | Subsystem | Purpose |
|------|-----------|---------|
| `src/game/features/building-construction/construction-site-demand.ts` | 1 | Site-driven demand orchestration |
| `src/game/features/building-construction/construction-jobs.ts` | 2 | Choreo job factories for dig/build |
| `src/game/features/building-construction/internal/construction-executors.ts` | 3 | DIG_TILE and BUILD_STEP choreo executors |

### Modified Files
| File | Change |
|------|--------|
| `src/game/systems/choreo/types.ts` | Add `DIG_TILE`, `BUILD_STEP` to ChoreoTaskType |
| `src/game/features/settler-tasks/work-handlers.ts` | Delete `createDiggerHandler`, `createBuilderHandler` |
| `src/game/features/settler-tasks/settler-task-system.ts` | Remove CONSTRUCTION/CONSTRUCTION_DIG handler registration |
| `src/game/systems/recruit/recruit-system.ts` | Remove construction demand logic, caps |
| `src/game/features/building-construction/building-construction-feature.ts` | Register ConstructionSiteDemandSystem, register DIG_TILE/BUILD_STEP executors |

## Verification
1. **Digger lifecycle**: Place building → demand created → carrier recruited → transforms → walks to tile → digs → site pushes next tile → repeat → leveling complete → digger released
2. **Builder lifecycle**: Leveling done → builder demands → recruit → walk to position → build step → site pushes next cycle → repeat → building complete → released
3. **Cap enforcement**: 5 simultaneous sites → max 4 diggers, rest queued. When a digger finishes a site, it gets reassigned to a waiting site.
4. **Site cancelled**: Remove building during construction → workers' jobs interrupted → demand system releases them → available for other sites
5. **Worker killed**: Worker dies mid-dig → demand system detects `settler:taskFailed` → creates replacement demand
6. **Idle specialist reuse**: Existing idle builder → demand system skips recruitment, builds `goTo(pos) → BUILD_STEP` directly
7. **Materials exhausted → re-acquire**: Builder working → materials run out → builder released → carrier delivers materials → site re-creates demand → idle builder (or new recruit) assigned → building resumes
8. **Materials exhausted, builder reassigned**: Site A runs out of materials, releases builder → Site B has materials and pending demand → builder dispatched to Site B
