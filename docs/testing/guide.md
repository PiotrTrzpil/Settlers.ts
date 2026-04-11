# Testing Best Practices

Guidelines for writing effective tests in Settlers.ts.

## Test Organization

### File Structure
```
tests/
  unit/                       # Fast, isolated unit tests (Vitest)
    helpers/
      test-game.ts            # GameState, entity factories, command helpers
      test-map.ts             # Map/terrain fixtures, TERRAIN constants
    flows/                    # Integration tests spanning multiple subsystems
    carriers/, inventory/, logistics/, service-areas/, integration/
  e2e/                        # End-to-end browser tests (Playwright)
    game-page.ts              # Page object facade — delegates to helper modules
    game-actions.ts           # Game commands (place, spawn, move, find tiles)
    game-queries.ts           # Unit/animation/movement state queries
    audio-helpers.ts          # Audio state reads and toggles
    sprite-helpers.ts         # Sprite loading verification and cache ops
    matchers.ts               # Custom Playwright matchers (polling-based)
    fixtures.ts               # Shared fixtures (worker + test scoped)
    wait-config.ts            # Centralized frame/timeout/poll constants
    wait-profiler.ts          # Built-in wait performance tracking
    *.spec.ts                 # Test files
```

### Naming Conventions
- Unit test files: `*.spec.ts` matching the source file name
- E2E test files: `*.spec.ts` describing the feature

---

## What to Test (AI-Assisted Development)

AI rarely introduces typos, off-by-one errors, or missing null checks. The bugs it *does* introduce
are subtler: misunderstood contracts between modules, code that works but doesn't match intent,
stale assumptions about how the system behaves, and silent semantic drift during refactoring. Test
strategy should target these failure modes.

### High-value tests — write these

| Category | Why it catches AI bugs | Example |
|----------|----------------------|---------|
| **Integration boundaries** | AI reads one module, assumes how another works — assumptions break at the seam | `building-lifecycle.spec.ts`: construction + placement + materials + carriers |
| **Behavioral specifications** | Encodes *what the user actually wanted*, not implementation details — catches "works but wrong" | "carrier delivers to nearest site first", not "carrierAssign calls sort" |
| **State machine transitions** | AI gets happy paths right but mishandles edge transitions | Builder arrives at a site that was cancelled mid-construction |
| **Regression anchors** | AI will re-introduce the same bug in a future refactor — it doesn't remember prior context | After fixing a bug, write a test that fails without the fix |
| **Multi-step flows with ordering** | Composition of correct pieces can still be wrong | Production chain: tree → log → sawmill → board → construction site |

### Low-value tests — skip or deprioritize

| Category | Why it's low value |
|----------|--------------------|
| **Trivial pure functions** | AI won't mess up `clamp(value, min, max)` — only test when logic encodes complex domain rules |
| **Mock-heavy isolation tests** | Mocking 5 dependencies to test 1 function tests mocks, not code — the real bugs live in the interactions you mocked away |
| **Coverage-driven tests** | "Every function needs a test" is waste — AI can generate code + passing tests without catching real issues |
| **Implementation-detail tests** | Asserting internal method calls or private state breaks on every refactor and catches nothing |

### Litmus test

Before writing a test, ask: **"Could an AI re-implementing this feature from the type signatures
alone get it wrong in a way this test would catch?"** If yes — valuable test. If it would pass
regardless of any reasonable implementation — skip it.

### Structure preferences

- **Scenario-based over unit-based** — organize tests around user-visible behaviors ("builder
  constructs a woodcutter hut"), not around classes/functions. One scenario test exercising the real
  pipeline catches more than 10 isolated unit tests.
- **Real dependencies over mocks** — use `test-game.ts` helpers. Wire up real systems, only fake
  what you must (rendering, assets). The integration surface is where bugs live.
- **Event/state assertions over call assertions** — assert on observable events and state changes,
  not internal calls. This makes tests resilient to refactoring while still catching behavioral
  regressions. The timeline DB (query with `pnpm timeline`) is ideal for this.

---

## E2E Test Tiers (Projects)

The Playwright config defines **test projects** with different timeouts based on tags:

| Project | Tag | Timeout | Purpose |
|---------|-----|---------|---------|
| `smoke` | `@smoke` | 10s | Core functionality, run on every commit |
| `default` | (no special tag) | 15s | Standard integration tests |
| `slow` | `@slow` | 30s | Complex tests, multiple phases |
| `assets` | `@requires-assets` | 60s | Needs real Settlers 4 game files |
| `visual` | `@screenshot` | 20s | Visual regression tests |

**Use tags instead of manual `test.setTimeout()`** — projects handle timeouts automatically.

```typescript
test.describe('App Loading', { tag: '@smoke' }, () => { ... });
test.describe('Sprite Loading', { tag: ['@requires-assets', '@slow'] }, () => { ... });
```

---

## E2E Architecture Overview

### Layer diagram

```
  Spec files  →  GamePage (page object)  →  Debug bridges  →  Game engine
                 matchers.ts (custom expect)
                 fixtures.ts (shared fixture)

  Spec files interact with the game through:
  1. UI interactions   — click buttons, hover canvas, navigate routes
  2. GamePage helpers  — waitForReady, moveCamera, placeBuilding, spawnUnit, etc.
  3. game.execute()    — the command pipeline (same path the UI uses)
  4. Debug reads       — getDebugField(), getViewField(), getGameState()
  5. Custom matchers   — toHaveEntity, toHaveMode, toHaveUnitCount, etc.
```

### Debug bridges (window globals)

The game exposes several window globals for test access. The primary ones:

| Bridge | Purpose |
|--------|---------|
| `__settlers_debug__` | Read-only stats (frameCount, entityCount, camera, etc.) |
| `__settlers_game__` | Execute commands, read entities, `restoreToInitialState()` |
| `__settlers_view_state__` | Reactive view state (entity counts, mode, etc.) |
| `__settlers_game_settings__` | Game speed, player settings |
| `__settlers_input__` | Switch modes with proper lifecycle |
| `__settlers_viewpoint__` | Camera positioning (use `setPosition()`) |

See `game-page.ts` and `game-actions.ts` for the full set of bridges used.

### Key principle: go through regular game logic

Tests should use the same code paths a player would. Ranked from most preferred to least:

1. **UI interaction** — click buttons, hover canvas, keyboard shortcuts
2. **Game commands** — `game.execute({ type: 'place_building', ... })`
3. **Public API methods** — `viewPoint.setPosition()`, `inputManager.switchMode()`
4. **Debug bridge reads** — `getDebugField('entityCount')`
5. **Internal state reads** — `game.state.entities.filter(...)` (acceptable for verification)

**Never:**
- Set private/internal properties directly (e.g. `vp.posX = x`)
- Access private class members via `(obj as any).privateField`
- Skip the command pipeline for entity creation/removal
- Mutate game state without going through `game.execute()`

---

## E2E Tests (Playwright)

### Read before changing
**Always read the existing e2e tests and `game-page.ts` before modifying or adding tests.**
Understand what helpers exist, what patterns are used, and avoid duplicating functionality.

### Import structure

```typescript
// Tests using shared fixture (testMap pre-loaded, state reset between tests)
import { test, expect } from './fixtures';

// Tests managing their own page (screenshot regression, navigation, real assets)
import { test, expect } from './matchers';
import { GamePage } from './game-page';
```

Both provide custom matchers. Never import `expect` directly from `@playwright/test`
in spec files — always go through `matchers.ts` or `fixtures.ts`.

### GamePage Helpers

`GamePage` is a facade that delegates to specialized helper modules. All wait methods
are instrumented by the Wait Profiler. **Read `game-page.ts` for the full API** — key
categories:

- **Navigation & waiting** — `goto()`, `waitForReady()`, `waitForGameReady()` (no WebGL), `waitForFrames()`, `waitForTicks()`
- **Polling helpers** — `waitForUnitCount()`, `waitForBuildingCount()`, `waitForUnitsMoving()`, `waitForUnitAtDestination()`, `waitForMovementIdle()`, `waitForMode()`
- **Game actions** (from `game-actions.ts`) — `placeBuilding()`, `placeResource()`, `spawnUnit()`, `moveUnit()`, `setGameSpeed()`, `findBuildableTile()`, `findPassableTile()`
- **State reads** (from `game-actions.ts` / `game-queries.ts`) — `getDebugField()`, `getViewField()`, `getEntities()`, `getUnitState()`, `getAnimationState()`, `getMovementControllerState()`
- **UI actions** — `moveCamera()`, `resetGameState()`, `selectMode()`, `clickButton()`, `collectErrors()`

### Custom matchers

Custom matchers in `matchers.ts` provide domain-specific assertions.
**All matchers automatically poll** at 100ms intervals until the condition is met or timeout
(default 5s). No need to wrap with `expect.toPass()`.

```typescript
await expect(gp).toHaveEntity({ type: 2, subType: 1, x: 10, y: 15 });
await expect(gp).toHaveUnitCount(3);
await expect(gp).toHaveBuildingCount(2);
await expect(gp).toHaveUnitsMoving(1);
await expect(gp).toHaveAtLeastUnitsMoving(1);
await expect(gp).toHaveNoUnitsMoving();
await expect(gp).toHaveMode('select');
await expect(gp).toHaveCameraAt(100, 100, tolerance);

// Override timeout
await expect(gp).toHaveUnitCount(5, { timeout: 10_000 });
```

**Important:** Test map has ~500 environment entities (trees). Use `toHaveUnitCount` or
`toHaveBuildingCount` instead of `toHaveEntityCount` when checking for "empty" state.

For **point-in-time checks** without polling, use `GamePage.getViewField()` directly:
```typescript
const count = await gp.getViewField('unitCount');
expect(count).toBe(5);
```

### Polling patterns

**Prefer GamePage polling helpers:**
```typescript
// GOOD — use built-in polling helper
await gp.waitForUnitsMoving(1, 5000);
await gp.waitForUnitToMove(unit.id, unit.x, unit.y, 8000);

// ACCEPTABLE — simple single-condition polling
await page.waitForFunction(
    ({ unitId }) => game.state.getEntity(unitId)?.x !== startX,
    { unitId },
    { timeout: 3000 }
);
```

**Never make timing assumptions:**
```typescript
// BAD — assumes game tick hasn't run
expect(unitState.moveProgress).toBe(0);

// GOOD — check path was set (stable property)
expect(unitState.pathLength).toBeGreaterThan(0);
```

### `test.step()` for complex tests

Use `test.step()` to structure multi-phase tests (3+ distinct phases). Steps appear in
traces and reports, making it clear which phase failed.

**Consolidate when** multiple tests navigate to the same page or share expensive setup.
**Keep separate when** tests need different fixture states or are genuinely independent.

### Avoid race conditions at high game speeds

Fixtures use 4x game speed by default. Short movements (3-5 tiles) can complete
before assertions run, causing flaky tests.

```typescript
// BAD — 5 tiles at 4x speed completes too fast
await gs.moveUnit(unit.id, unit.x + 5, unit.y);
await gs.waitForUnitsMoving(1, 5000);  // May fail if already finished

// GOOD — 15 tiles gives enough time to catch the "moving" state
await gs.moveUnit(unit.id, unit.x + 15, unit.y);
await gs.waitForUnitsMoving(1, 5000);
```

For timing-sensitive tests, use `setGameSpeed(1.0)` or the `gpNormal` fixture.

### Never use `waitForTimeout`
Use deterministic waiting: `waitForFrames()`, `waitForUnitCount()`, `waitForUnitsMoving()`,
or `page.waitForFunction()` with an explicit `{ timeout }`.

### `waitForFrames` uses relative counting
`waitForFrames(n)` waits for `n` **new** frames from the current frame count.
Never compare directly against absolute `frameCount`.

### Use `testMap: true` for all game tests
Only use `testMap: false` when testing real asset loading (e.g., sprite files).

### Entity type constants
When filtering entities, use `EntityType` enum values:
- `EntityType.Unit` (1) — carrier, swordsman, etc.
- `EntityType.Building` (2) — WoodcutterHut, StorageArea, etc.
- `EntityType.Environment` (3) — trees, stones (**present in test map, ~500**)
- `EntityType.StackedResource` (4) — log piles, stone piles

`BuildingType` starts at 1 (WoodcutterHut=1, StorageArea=2, Sawmill=3). Never use `buildingType: 0`.

### Don't duplicate GamePage helpers
If a test needs to find buildable terrain, use `gp.findBuildableTile()` instead of
writing a custom spiral search inline. If you need new shared logic, add it to `GamePage`
or the appropriate helper module.

### Camera positioning
Use `gp.moveCamera(tileX, tileY)` — it calls `ViewPoint.setPosition()` with proper
isometric coordinate conversion. Never directly set `posX`/`posY`.

### Mode switching
For tests, switch modes via UI buttons (`gp.selectMode()`, `gp.clickButton('btn-woodcutter')`).
`resetGameState()` uses `InputManager.switchMode('select')` which fires proper lifecycle callbacks.

### collectErrors() filter
The filter is intentionally narrow — only suppresses known-harmless messages (missing GFX files,
WebGL context warnings, procedural texture fallbacks). Add new patterns explicitly with comments.

---

## Shared Test Map Fixture

Most e2e tests use the shared fixture from `tests/e2e/fixtures.ts`:

```typescript
import { test, expect } from './fixtures';

test('my test', async ({ gp }) => {
    // gp is a GamePage with testMap loaded and state reset. 4x game speed.
    // No need to call goto() or waitForReady()
    await gp.spawnUnit(1);
    await gp.waitForUnitCount(1);
});
```

### Fixture types

**Worker-scoped** (one shared page per parallel worker):
- `testMapPage` — full WebGL, `?testMap=true`, waits for renderer ready
- `gameStatePage` — game state only, no WebGL requirement
- `assetPage` — real game assets (not testMap), waits for sprites loaded

**Test-scoped** (reset before each test, 4x game speed):
- `gp` — wraps `testMapPage` (WebGL required)
- `gs` — wraps `gameStatePage` (no WebGL — for game-state-only tests)
- `gpNormal` — like `gp` but 1x speed
- `gpWithUI` — `gp` + Buildings tab open
- `gpWithBuilding`, `gpWithUnit`, `gpWithMovingUnit` — preset entity state
- `gpCentered` — camera centered on map
- `gpAssets` — real game assets (skips in CI if unavailable)

See `fixtures.ts` for the full list and setup details.

### When to use `gp` vs `gs`

Use `gp` when the test needs WebGL rendering (visual assertions, canvas interaction).
Use `gs` when the test only needs game state (movement, animation state, entity queries).
`gs` works in headless environments without WebGL support.

### State reset

`resetGameState()` calls `game.restoreToInitialState()` which restores the game to
its initial map state via the persistence pipeline — removing all current entities,
recreating from the initial snapshot, and restoring all feature state.
Then switches mode to 'select' via InputManager and waits for propagation.

### When NOT to use the shared fixture
- Screenshot regression tests (need fresh pixel state)
- Non-testMap pages (sprite browser, real assets)
- Navigation/loading tests

For those, import from `./matchers` and manage the page yourself.

---

## Wait Configuration

Centralized in `tests/e2e/wait-config.ts`:

- **`Frames`** — semantic frame counts: `IMMEDIATE` (1), `STATE_PROPAGATE` (2), `RENDER_SETTLE` (5), `ANIMATION_SETTLE` (10), `VISUAL_STABLE` (15)
- **`Timeout`** — semantic timeouts: `FAST` (3s), `DEFAULT` (5s), `MOVEMENT` (8s), `LONG_MOVEMENT` (10s), `INITIAL_LOAD` (20s), `ASSET_LOAD` (30s)
- **`PollIntervals`** — arrays for `expect.toPass()`: `FAST`, `DEFAULT`, `MOVEMENT`

Always pass explicit `{ timeout }` to `page.waitForFunction()` in spec files.

---

## Unit Tests (Vitest)

### Shared Test Helpers

**`test-game.ts`** — GameState, entity factories, and command helpers:
```typescript
import { createGameState, createTestContext, addUnit, addBuilding,
    addBuildingWithInventory, placeBuilding, spawnUnit, moveUnit } from '../helpers/test-game';

const state = createGameState();                              // Minimal state + movement
const ctx = createTestContext();                               // Full context with all managers
const { entity, unitState } = addUnit(state, 10, 10);
const building = addBuildingWithInventory(state, 15, 15, BuildingType.Sawmill);
```

**`test-map.ts`** — Map and terrain fixtures:
```typescript
import { createTestMap, TERRAIN, setTerrainAt, setHeightAt, blockColumn } from '../helpers/test-map';

const testMap = createTestMap(64, 64);              // 64x64 all-grass flat map
setTerrainAt(testMap, 10, 10, TERRAIN.WATER);
blockColumn(testMap, 5, 0, 10);                     // Block tiles for pathfinding tests
```

### Use Enums and Constants, Never Magic Numbers

```typescript
import { EntityType } from '@/game/entity';
import { BuildingType } from '@/game/buildings';
import { UnitType } from '@/game/unit-types';
import { EMaterialType } from '@/game/economy/material-type';
import { TERRAIN } from '../helpers/test-map';

// GOOD
placeBuilding(state, map, x, y, BuildingType.WoodcutterHut);
spawnUnit(state, map, x, y, UnitType.Carrier);
ctx.map.groundType[index] = TERRAIN.WATER;
const units = state.entityIndex.query(EntityType.Unit).toArray();

// BAD — magic numbers, full entity scan
placeBuilding(state, map, x, y, 1);
state.entities.filter(e => e.type === 2);
```

### Key Principles

- **Prefer fewer, comprehensive tests** over many granular ones
- **Use `describe` blocks** to group related tests by behavior
- **Use `beforeEach`** for common setup with `createGameState()` / `createTestContext()`
- **Use builder functions** (`addUnit`, `addBuildingWithInventory`, etc.) not inline object literals
- **Test through public APIs** — not direct state mutation
- **Test contracts, not implementation** — return values and observable behavior, not private fields
- **Use TDD for bug fixes** — write a failing test first

### Writing Meaningful Simulation Assertions

When using `runUntil` or `runTicks`, think carefully about what the assertion actually proves:

**Don't assert what `runUntil` already guarantees:**
```typescript
// BAD — tautological: runUntil stopped at >= 1, so the expect always passes
sim.runUntil(() => sim.getOutput(id, EMaterialType.LOG) >= 1);
expect(sim.getOutput(id, EMaterialType.LOG)).toBeGreaterThanOrEqual(1);

// GOOD — run extra ticks AFTER the condition, then assert a bound
sim.runUntil(() => sim.getOutput(id, EMaterialType.LOG) >= 3, { maxTicks: 300 * 30 });
sim.runTicks(60 * 30); // extra idle time
expect(sim.getOutput(id, EMaterialType.LOG)).toBe(3); // proves no more were produced
```

**Use `runTicks` instead of `runUntil` when checking upper bounds:**
```typescript
// BAD — can't check upper bounds because runUntil stops at the threshold
sim.runUntil(() => output >= 3);
expect(output).toBeLessThanOrEqual(5); // vacuous — it's always exactly 3

// GOOD — run for a fixed duration, then check both bounds
sim.runTicks(300 * 30);
expect(sim.getOutput(id, EMaterialType.LOG)).toBeGreaterThanOrEqual(3);
expect(sim.getOutput(id, EMaterialType.LOG)).toBeLessThanOrEqual(5);
```

**Account for material consumption in multi-building chains:**
```typescript
// BAD — sawmill may have already consumed logs, so input shows 0
expect(sim.getInput(sawmillId, EMaterialType.LOG)).toBeGreaterThanOrEqual(1);

// GOOD — boards at the end of the chain prove the entire pipeline worked
expect(sim.getOutput(sawmillId, EMaterialType.BOARD)).toBeGreaterThanOrEqual(1);
```

**Test boundaries, not just happy paths:**
```typescript
// Plant 3 reachable trees + 5 unreachable (beyond working area radius)
sim.plantTreesNear(woodcutterId, 3);
sim.plantTreesFar(woodcutterId, 5);
sim.runTicks(300 * 30);
expect(sim.getOutput(woodcutterId, EMaterialType.LOG)).toBe(3); // only nearby trees cut
```

### Anti-Patterns to Avoid

1. **Duplicating helpers** — check `test-game.ts` and `test-map.ts` first
2. **Direct state mutation** — use manager/system APIs instead
3. **Magic numbers** — use `EntityType`, `BuildingType`, `UnitType`, `EMaterialType`, `TERRAIN`
4. **Testing implementation details** — test behavior through public APIs
5. **Test interdependency** — each test must be independent and repeatable
6. **Tautological assertions** — don't assert what `runUntil` already guarantees (see above)
7. **`useStubData` in `tests/unit/integration/`** — see rule below

### Rule: `tests/unit/integration/` always uses real data

All tests in `tests/unit/integration/` **must** use `createSimulation()` with real game data (no
`useStubData: true`, no `useStubData` argument at all). Wrap the entire describe block with
`describe.skipIf(!hasRealData)`. Integration tests exist to verify multi-system behavior against real
building definitions, positions, and XML content — stub data defeats the purpose and silently tests
nothing meaningful about the actual game. Pure unit tests that don't need a simulation belong in the
sibling directories (`carriers/`, `inventory/`, `buildings/`, etc.), not in `integration/`.

---

## Test Tier Decision Guide

### Tier 1: Visual (E2E Required)
**Requires browser + WebGL.** Screenshot regression, sprite loading, canvas rendering.
Use `gp` fixture.

### Tier 2: Spatial (E2E `gs` fixture OR Unit Test)
**Requires game loop but not WebGL.** Movement, animation state, multi-system ticks.
Use `gs` fixture for real-time behavior across ticks, unit tests for single-tick logic.

### Tier 3: Logic/Economic (Unit Test Preferred)
**Pure game state.** Manager state, command results, event handling, job state machines.
**Always prefer unit tests for Tier 3.**

### Decision Flowchart

```
Does the test verify visual/pixel output?
├── YES → Tier 1 (E2E with gp, screenshots)
└── NO
    Does the test need real-time behavior over multiple game ticks?
    ├── YES → Tier 2 (E2E with gs fixture OR unit test with tick simulation)
    └── NO
        Can it be tested with direct API calls on GameState/managers?
        ├── YES → Tier 3 (Unit test) ← STRONGLY PREFER THIS
        └── NO → Re-evaluate what you're actually testing
```

---

## Running Tests

```sh
pnpm test:unit              # All unit tests
pnpm test:unit path/to/test # Specific test file
pnpm test:watch             # Watch mode

pnpm lint                   # Type-check + ESLint before e2e tests
npx playwright test         # E2E tests (uses dev server locally, build in CI)
npx playwright test --headed -g "test name"  # Run specific test visually

# Project-based execution (recommended)
npx playwright test --project=smoke    # Only smoke tests (10s timeout)
npx playwright test --project=default  # Standard tests (15s timeout)
npx playwright test --project=slow     # Slow tests (30s timeout)
npx playwright test --project=assets   # Asset-dependent (60s timeout)
```

### CRITICAL: Reporter Selection

**NEVER use `--reporter=line`** — it suppresses stdout from workers, hiding Wait Profiler
output. Use `--reporter=list` instead.

---

## Wait Profiler

E2E tests include a built-in **Wait Profiler** (`wait-profiler.ts`) that tracks all wait
operations and reports the slowest ones at worker teardown. Enabled by default.

```sh
WAIT_PROFILER_VERBOSE=1 npx playwright test   # Per-wait logging
WAIT_PROFILER=0 npx playwright test           # Disable profiler
```
