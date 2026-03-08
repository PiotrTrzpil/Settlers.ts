# Movement & Pathfinding Simplification — Design

## Overview

Replace the current multi-strategy collision resolution pipeline (detour → path repair → push → yield → wait → escalated repath → give up) with a simpler model inspired by Settlers 4: **always pathfind ignoring units, resolve collisions by bumping on arrival**. This eliminates the root cause of stuck units — treating other units as walls during pathfinding.

## Current State

- **What exists**: A* pathfinding with `ignoreOccupancy` flag, 5-strategy `CollisionResolver`, `BlockedStateHandler` escalation state machine (0s → 0.5s repath → 2s give-up), `MovementController` with idle/moving/blocked phase, `PathfindingService` wrapper, `push-utils.ts` with priority-based pushing.
- **Root problem**: By default, A* treats unit-occupied tiles as impassable. In dense areas (near buildings, construction sites), units form impassable walls for each other. The elaborate collision pipeline tries to recover but creates oscillation, loops, and permanent stuck states.
- **What stays**: A* algorithm (`astar.ts`), hex grid system, `MovementController` core (position, progress, interpolation), `PathfindingService` wrapper, `MovementSystem` shell (controller lifecycle, tick loop, events), building tunnel logic, path smoothing.
- **What changes**: Remove `CollisionResolver`, `BlockedStateHandler`, simplify `MovementController` phases. A* always ignores unit occupancy. Collision resolved by simple bump-or-wait at the point of movement.
- **What gets deleted**: `collision-resolver.ts`, `blocked-state-handler.ts`, `push-utils.ts` (standalone functions absorbed into simpler inline logic), `.bak` files.

## Summary for Review

- **Interpretation**: Units getting stuck is caused by A* refusing to path through tiles occupied by other (moving) units. The fix is to never treat units as pathfinding obstacles — path through them, then resolve collisions locally when the unit actually tries to step onto an occupied tile.
- **Key decisions**:
  - A* **always** ignores unit occupancy (the `ignoreOccupancy` parameter and all occupancy-aware pathfinding is removed)
  - Collision resolution is a single simple rule: when stepping onto an occupied tile, **bump** the occupant to a free neighbor (if idle/blocked) or **wait** briefly (if the occupant is moving and will leave soon)
  - No escalation state machine — just bump or wait. If waiting exceeds a timeout, repath (still ignoring units) to get a fresh route around the *terrain/building* obstacles
  - Priority: lower entity ID bumps higher entity ID (same as current `shouldYieldToPush`)
- **Assumptions**: The original Settlers 4 used a similar "path through units, bump on contact" model. This works because units are transient obstacles — they move away. Only buildings and terrain are permanent obstacles worth routing around.
- **Scope**: Movement system and pathfinding only. Does not change task assignment, logistics, or building construction. Tests updated to match new behavior.

## Conventions

- Optimistic programming: no `?.` on required deps, no silent fallbacks, throw with context
- TickSystems catch errors per-entity (Rule 10.1)
- Deterministic iteration: sort by entity ID (Rule 8.2)
- `systems/pathfinding` must never import from `features/` (Rule 2.0)
- Config object pattern for 3+ dependencies (Rule 4.4)
- Constants over magic numbers for timeouts/thresholds (Rule 7.4)

## Architecture

### Subsystems

| # | Subsystem | Responsibility | Depends On | Files |
|---|-----------|---------------|------------|-------|
| 1 | A* cleanup | Remove occupancy-aware pathfinding from A* | — | `astar.ts`, `path-smoothing.ts` |
| 2 | PathfindingService cleanup | Remove `ignoreOccupancy` parameter | 1 | `pathfinding-service.ts` |
| 3 | Bump resolver | Simple bump-or-wait logic inline in MovementSystem | — | `movement-system.ts` |
| 4 | Controller simplification | Remove `blocked` phase, simplify to idle/moving + wait counter | — | `movement-controller.ts` |
| 5 | MovementSystem integration | Wire new bump logic, remove old resolver/handler refs | 2, 3, 4 | `movement-system.ts`, `movement-feature.ts` |
| 6 | Cleanup & tests | Delete old files, update tests | 1–5 | tests, deleted files |

## Shared Contracts

```typescript
// --- MovementController phases (simplified) ---
type ControllerPhase =
    | { readonly tag: 'idle' }
    | { readonly tag: 'moving'; path: TileCoord[]; pathIndex: number; waitTime: number };

// waitTime: accumulated seconds the unit has been waiting at its current position
// because the next tile is occupied. Resets to 0 on successful step.

// --- Constants ---
/** After waiting this long, repath to find an alternative route around terrain */
const REPATH_WAIT_TIMEOUT = 0.5; // seconds

/** After this long, clear path and let the task system reassign */
const GIVEUP_WAIT_TIMEOUT = 2.0; // seconds

// --- A* signature (simplified — no ignoreOccupancy) ---
function findPathAStar(
    startX: number, startY: number,
    goalX: number, goalY: number,
    terrain: PathfindingTerrain,
    buildingOccupancy: Set<string>,
): TileCoord[] | null;

// --- PathfindingService (simplified) ---
interface IPathfinder {
    findPath(startX: number, startY: number, goalX: number, goalY: number): TileCoord[] | null;
    hasTerrainData(): boolean;
}

// --- Bump logic (inline in MovementSystem, not a separate class) ---
// When unit A tries to step onto tile occupied by unit B:
//   1. If B is idle or waiting: bump B to a free neighbor (lower ID has priority)
//   2. If B is moving (will leave soon): wait
//   3. If waiting > REPATH_WAIT_TIMEOUT: repath from current position
//   4. If waiting > GIVEUP_WAIT_TIMEOUT: clear path, emit stopped
```

## Subsystem Details

### 1. A* Cleanup
**Files**: `src/game/systems/pathfinding/astar.ts`, `src/game/systems/pathfinding/path-smoothing.ts`
**Key decisions**:
- Remove `tileOccupancy` parameter from `findPathAStar` — A* only considers terrain and building footprints
- Remove `ignoreOccupancy` parameter entirely
- Remove occupancy check from `canEnterTile` — only terrain passability + building bitmap
- Remove `tileOccupancy` from `SearchContext`
- Remove occupancy from path-smoothing `hasLineOfSight` checks
- Keep building tunnel logic (exit/entry through building footprints) unchanged
- Keep diagnostics but simplify neighbor diagnosis (no unit occupancy to report)
- Keep the `tileOccupancy` parameter in tunnel functions (they need it to identify which building owns a footprint tile) but remove it from the main search loop

### 2. PathfindingService Cleanup
**Files**: `src/game/systems/movement/pathfinding-service.ts`
**Key decisions**:
- Remove `ignoreOccupancy` parameter from `findPath` and `IPathfinder`
- Remove `setOccupancy` method — service no longer needs tile occupancy reference
- Keep `setBuildingOccupancy` — buildings are still permanent obstacles
- Still pass `tileOccupancy` to `findPathAStar` for building tunnel identification (it needs to know which entity owns footprint tiles) — but A* won't use it for blocking

**Wait — re-reading the tunnel logic**: `tileOccupancy` is used in `clearBuildingTunnelFromBitmap` to identify which tiles belong to the same building. This is for building entry/exit only. We can pass it as a separate "building ownership" parameter or keep passing `tileOccupancy` to `findPathAStar` but only for tunnel lookup, not for blocking. Simplest: keep the parameter, rename it to clarify it's only for tunnel identification.

### 3. Bump Resolver
**Files**: `src/game/systems/movement/movement-system.ts` (inline, ~40 lines)
**Key decisions**:
- No separate class — bump logic is simple enough to be a private method on `MovementSystem`
- Bump = move idle/waiting occupant to a free neighbor tile
  - Pick the neighbor closest to the occupant's own goal (if it has one), else closest to the bumper's goal, else any free neighbor
  - "Free" = passable terrain, not a building footprint, not occupied by another unit
  - After bumping, the bumped unit repaths to its goal (if it has one)
- Wait = do nothing this tick, increment `waitTime` on the controller
- Priority: entity with lower ID can bump entity with higher ID. Higher ID waits instead of bumping.
- **No recursive bumping** — if the bump target can't be displaced (all neighbors full), the bumper waits instead

### 4. Controller Simplification
**Files**: `src/game/systems/movement/movement-controller.ts`
**Key decisions**:
- Remove `blocked` phase — only `idle` and `moving`
- Add `waitTime: number` to the `moving` phase (tracks how long unit has been waiting for an occupied tile)
- Remove `setBlocked()`, `addBlockedTime()`, `resetBlockedTime()` methods
- Add `addWaitTime(dt)` and `resetWaitTime()` methods on the moving phase
- `state` getter returns `'idle' | 'moving'` only (remove `'blocked'` from `MovementState`)
- Keep all path manipulation methods (`startPath`, `redirectPath`, `clearPath`, `insertDetour` → remove `insertDetour`, `replacePathPrefix`, `replacePathSuffix` — these were only used by collision resolver)
- Simplify to: `startPath`, `redirectPath`, `replacePath`, `clearPath`

### 5. MovementSystem Integration
**Files**: `src/game/systems/movement/movement-system.ts`, `src/game/features/movement/movement-feature.ts`
**Key decisions**:
- Remove `CollisionResolver` and `BlockedStateHandler` imports and instantiation
- `moveUnit()` no longer passes `ignoreOccupancy: true` — the parameter doesn't exist anymore
- `updateController()` loop:
  1. Advance progress
  2. While `canMove()`: check next waypoint occupancy
     - Free → `executeMove()` + `updatePosition()`, reset waitTime
     - Occupied → attempt bump or wait (increment waitTime)
     - If `waitTime > REPATH_WAIT_TIMEOUT` → repath from current position to goal
     - If `waitTime > GIVEUP_WAIT_TIMEOUT` → `clearPath()`
  3. `finalizeTick()`
- `MovementFeature` unchanged (already just creates MovementSystem and wires events)
- Remove `rng` from `MovementSystemConfig` — no longer needed (bump uses deterministic neighbor scoring, not random)

### 6. Cleanup & Tests
**Files**: deleted files, `tests/unit/movement/movement-collision.spec.ts`, `tests/unit/integration/movement/pathfinding.spec.ts`
**Key decisions**:
- Delete `collision-resolver.ts`, `blocked-state-handler.ts`, `push-utils.ts`
- Delete `.bak` files (`movement-system.ts.bak`, `push-utils.ts.bak`)
- Update collision tests: replace multi-strategy tests with simple bump/wait scenarios
- Update pathfinding tests: remove ignoreOccupancy parameter from test calls
- Key test scenarios: bump idle unit, bump moves unit toward its goal, two units meeting head-on (lower ID bumps higher), unit waits for moving unit, unit repaths after timeout, unit gives up after long timeout

## File Map

### New Files
None — all logic fits in existing files.

### Modified Files
| File | Change |
|------|--------|
| `src/game/systems/pathfinding/astar.ts` | Remove `tileOccupancy` blocking, remove `ignoreOccupancy`, keep tunnels |
| `src/game/systems/pathfinding/path-smoothing.ts` | Remove occupancy from line-of-sight checks |
| `src/game/systems/movement/pathfinding-service.ts` | Remove `ignoreOccupancy` param, remove `setOccupancy` |
| `src/game/systems/movement/movement-controller.ts` | Remove `blocked` phase, add `waitTime` to moving, simplify API |
| `src/game/systems/movement/movement-system.ts` | Replace resolver/handler with inline bump logic |
| `src/game/systems/movement/index.ts` | Remove re-exports of deleted modules |
| `src/game/features/movement/movement-feature.ts` | Remove rng passing if needed |
| `tests/unit/movement/movement-collision.spec.ts` | Rewrite for bump/wait model |
| `tests/unit/integration/movement/pathfinding.spec.ts` | Remove ignoreOccupancy tests |

### Deleted Files
| File | Reason |
|------|--------|
| `src/game/systems/movement/collision-resolver.ts` | Replaced by inline bump logic |
| `src/game/systems/movement/blocked-state-handler.ts` | Replaced by waitTime + simple thresholds |
| `src/game/systems/movement/push-utils.ts` | `findBestNeighbor` moved inline, rest deleted |
| `src/game/systems/movement/movement-system.ts.bak` | Stale backup |
| `src/game/systems/movement/push-utils.ts.bak` | Stale backup |

## Verification
1. **Dense area pathfinding**: Place 6+ carriers near a building entrance. All should reach their destinations without getting permanently stuck.
2. **Head-on collision**: Two units walking toward each other on a narrow path. Lower-ID unit bumps higher-ID; both eventually reach goals.
3. **Idle bump**: Moving carrier encounters idle unit blocking a doorway. Carrier bumps idle unit aside and enters.
4. **Timeout repath**: Unit's path goes through a temporarily congested area. After 0.5s waiting, it repaths and finds alternative route around terrain.
5. **No regression**: Existing pathfinding tests pass (terrain/building obstacles still work correctly).
