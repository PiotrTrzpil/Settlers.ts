# Testing Best Practices

Guidelines for writing effective tests in Settlers.ts.

## Test Organization

### File Structure
```
tests/
  unit/                           # Fast, isolated unit tests (Vitest)
  e2e/                            # End-to-end browser tests (Playwright)
    game-page.ts                  # Page object — all shared helpers live here
    matchers.ts                   # Custom Playwright matchers (toHaveEntity, etc.)
    fixtures.ts                   # Shared test map fixture (worker-scoped)
    game-logic.spec.ts            # App loading, navigation, canvas interaction
    building-placement.spec.ts    # Building placement, unit spawning, rendering
    unit-movement.spec.ts         # Movement commands, interpolation, debug stats
    terrain-rendering.spec.ts     # Screenshot regression + initial state checks
    unit-sprites.spec.ts          # Sprite loading (requires real game assets)
    sprite-browser.spec.ts        # JIL/GFX view pages
```

### Naming Conventions
- Unit test files: `*.spec.ts` matching the source file name
- E2E test files: `*.spec.ts` describing the feature

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

Run specific tiers:
```sh
npx playwright test --project=smoke           # Only smoke tests
npx playwright test --project=assets          # Only asset-dependent tests
npx playwright test --grep @smoke             # Alternative: by tag
npx playwright test --grep-invert @slow       # Skip slow tests
```

**Tagging tests:**
```typescript
// On describe blocks
test.describe('App Loading', { tag: '@smoke' }, () => { ... });

// On individual tests
test('screenshot baseline', { tag: '@screenshot' }, async ({ page }) => { ... });

// Multiple tags — matches any project with either tag
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
  4. Debug reads       — __settlers_debug__, getGameState(), getDebugField()
  5. Custom matchers   — toHaveEntity, toHaveMode, toHaveUnitCount, etc.
```

### Debug bridges (window globals)

| Bridge | Type | Purpose |
|--------|------|---------|
| `__settlers_debug__` | DebugStatsState | Read-only game stats (frameCount, entityCount, mode, camera, etc.) |
| `__settlers_game__` | Game | Execute commands, read entities, map data |
| `__settlers_input__` | InputManager | Switch modes, access camera (proper lifecycle) |
| `__settlers_viewpoint__` | ViewPoint | Camera positioning (use setPosition for tile centering) |
| `__settlers_entity_renderer__` | EntityRenderer | Read renderer state (public properties only) |
| `__settlers_landscape__` | LandscapeRenderer | Landscape renderer access |

### Key principle: go through regular game logic

Tests should use the same code paths a player would. Ranked from most preferred to least:

1. **UI interaction** — click buttons, hover canvas, keyboard shortcuts
2. **Game commands** — `game.execute({ type: 'place_building', ... })`
3. **Public API methods** — `viewPoint.setPosition()`, `inputManager.switchMode()`
4. **Debug bridge reads** — `__settlers_debug__.entityCount`
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

Tests import from one of two sources depending on whether they need the shared fixture:

```typescript
// Tests using shared fixture (testMap pre-loaded, state reset between tests)
import { test, expect } from './fixtures';

// Tests managing their own page (screenshot regression, navigation, real assets)
import { test, expect } from './matchers';
import { GamePage } from './game-page';
```

Both provide custom matchers. Never import `expect` directly from `@playwright/test`
in spec files — always go through `matchers.ts` or `fixtures.ts`.

### Use Page Objects
All e2e tests should use `GamePage` from `tests/e2e/game-page.ts`:
```typescript
test('can place building', async ({ page }) => {
    const gp = new GamePage(page);
    await gp.goto({ testMap: true });
    await gp.waitForReady();
    // ...
});
```

### GamePage Helpers

**Navigation & waiting:**
- `goto({ testMap: true })` — navigate to map view with synthetic test map
- `waitForReady(minFrames)` — wait for game loaded + renderer ready + N new frames
- `waitForFrames(n)` — wait for N **new** frames (relative counting)
- `waitForEntityCountAbove(n)` — poll until entity count exceeds N

**Polling helpers (use instead of inline waitForFunction):**
- `waitForUnitCount(n, timeout)` — poll until unit count equals N
- `waitForBuildingCount(n, timeout)` — poll until building count equals N
- `waitForUnitsMoving(n, timeout)` — poll until at least N units are moving
- `waitForNoUnitsMoving(timeout)` — poll until all units are stationary
- `waitForUnitToMove(unitId, startX, startY, timeout)` — poll until unit moves from start
- `waitForUnitAtDestination(unitId, targetX, targetY, timeout)` — poll until unit arrives
- `waitForMode(mode, timeout)` — poll until mode changes

**Game actions (command pipeline):**
- `placeBuilding(type, x, y, player?)` — place via `game.execute()`, returns entity info
- `placeResource(type, x, y, amount?)` — place via `game.execute()`, returns entity info
- `spawnUnit(unitType?, x?, y?, player?)` — spawn via `game.execute()`, returns entity info
- `moveUnit(entityId, targetX, targetY)` — issue move command, returns success

**State reads:**
- `getDebugField(key)` — read a single debug bridge field
- `getGameState()` — structured game state with entities
- `getEntities(filter?)` — read entities with optional type/subType/player filter
- `findBuildableTile(buildingType?)` — spiral from map center to find valid spot
- `findPassableTile()` — find a tile suitable for resource/unit placement

**UI actions:**
- `moveCamera(x, y)` — center camera on tile (uses `ViewPoint.setPosition()`)
- `resetGameState()` — remove user-placed entities + reset mode via InputManager
- `selectMode()` — click select mode button
- `collectErrors()` — error collector with known-harmless warning filter

### Custom matchers

Custom matchers in `tests/e2e/matchers.ts` provide domain-specific assertions:

```typescript
// Entity assertions
await expect(gp).toHaveEntity({ type: 2, subType: 1, x: 10, y: 15 });
await expect(gp).toHaveEntityCount(500);  // Includes environment (trees)
await expect(gp).toHaveUnitCount(3);      // Only units (EntityType.Unit)
await expect(gp).toHaveBuildingCount(2);  // Only buildings

// Movement assertions
await expect(gp).toHaveUnitsMoving(1);
await expect(gp).toHaveNoUnitsMoving();

// Mode/camera assertions
await expect(gp).toHaveMode('select');
await expect(gp).toHaveCameraAt(100, 100, tolerance);
```

**Important:** Test map has ~500 environment entities (trees). Use `toHaveUnitCount` or
`toHaveBuildingCount` instead of `toHaveEntityCount` when checking for "empty" state.

These are **point-in-time checks** (no auto-retry). For polling, wrap with `expect.toPass()`:
```typescript
await expect(async () => {
    await expect(gp).toHaveUnitCount(5);
}).toPass({ timeout: 5000 });
```

Or use the GamePage polling helpers directly:
```typescript
await gp.waitForUnitCount(5, 5000);
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

// GOOD for multi-condition — expect.toPass() with clear error messages
await expect(async () => {
    const state = await page.evaluate(/* read state */);
    expect(state.x).toBe(targetX);
    expect(state.y).toBe(targetY);
    expect(state.isStationary).toBe(true);
}).toPass({ timeout: 5000, intervals: [100, 200, 500, 1000] });
```

**Never make timing assumptions:**
```typescript
// BAD — assumes game tick hasn't run
expect(unitState.moveProgress).toBe(0);

// GOOD — check path was set (stable property)
expect(unitState.pathLength).toBeGreaterThan(0);
```

### `test.step()` for complex tests

Use `test.step()` to structure multi-phase tests. Steps appear in traces and reports,
making it clear which phase failed:

```typescript
test('building is rendered on canvas', async({ page }) => {
    const gp = new GamePage(page);
    await gp.goto({ testMap: true });
    await gp.waitForReady(10);

    await test.step('place building at buildable tile', async () => {
        const tile = await gp.findBuildableTile();
        await gp.placeBuilding(1, tile!.x, tile!.y);
        await gp.waitForFrames(15);
    });

    await test.step('verify building exists', async () => {
        await expect(gp).toHaveEntity({ type: 2 });
    });
});
```

Only add `test.step()` to tests with 3+ distinct phases. Simple tests don't need it.

### Never use `waitForTimeout`
Use deterministic waiting instead:
```typescript
// BAD — flaky, slow
await page.waitForTimeout(500);

// GOOD — wait for N new frames
await gp.waitForFrames(5);

// GOOD — poll for specific condition
await gp.waitForUnitCount(1);
await gp.waitForUnitsMoving(1);

// GOOD — custom condition with explicit timeout
await page.waitForFunction(
    (min) => (window as any).__settlers_debug__?.entityCount > min,
    countBefore,
    { timeout: 5000 },
);
```

### `waitForFrames` uses relative counting
`waitForFrames(n)` waits for `n` **new** frames from the current frame count.
It reads `frameCount` first, then waits for `frameCount >= current + n`.
This is critical for the shared fixture where `frameCount` is already high.
Never compare directly against absolute `frameCount`.

### Use `testMap: true` for all game tests
Tests that interact with game state should use the synthetic test map:
- No game asset dependencies
- Deterministic terrain layout
- Fast loading

Only use `testMap: false` when testing real asset loading (e.g., sprite files).

### Entity type constants
When filtering entities, use the correct `EntityType` values:
- `type === 1` → Unit (bearer, swordsman, etc.)
- `type === 2` → Building (lumberjack, warehouse, etc.)
- `type === 3` → Environment (trees, stones) — **present in test map**
- `type === 4` → StackedResource (logs, stone piles, etc.)

`BuildingType` starts at 1 (Lumberjack=1, Warehouse=2, Sawmill=3). Never use `buildingType: 0`.

### Don't duplicate GamePage helpers
If a test needs to find buildable terrain, use `gp.findBuildableTile()` instead of
writing a custom spiral search inline. Pass a `buildingType` for larger buildings:
`gp.findBuildableTile(2)` for Warehouse (3x3). If you need new shared logic, add it
to `GamePage`.

### Camera positioning
Use `gp.moveCamera(tileX, tileY)` to center the camera on a tile. It calls
`ViewPoint.setPosition()` (public API with proper isometric coordinate conversion).
Never directly set `posX`/`posY` on the viewpoint.

### Mode switching
For tests, switch modes via UI buttons:
```typescript
await gp.selectMode();  // clicks the select button
await page.locator('[data-testid="btn-lumberjack"]').click();
```

For `resetGameState()`, mode switching goes through `InputManager.switchMode('select')`
which fires proper `onExit`/`onEnter` lifecycle callbacks and cleans up mode data.

### No debug-only test files
Tests should have meaningful assertions — not just capture screenshots or log data.
Debug/diagnostic scripts belong in `scripts/`, not in the test suite.

### No `console.log` in tests
Tests should assert, not print. Remove any `console.log` debugging before committing.

### E2E vs Unit test boundary
**E2E tests should verify the full UI pipeline**: button clicks, canvas interactions,
visual rendering, navigation, error-free loading. If a test only calls `game.execute()`
and checks state without any UI interaction, it should be a unit test instead.

### collectErrors() filter
The `collectErrors()` helper filters only specific known-harmless messages:
- Missing GFX asset files (e.g. '2.gh6')
- WebGL context warnings from headless Chrome
- Procedural texture fallback warnings

If you need to suppress a new error pattern, add it explicitly with a comment explaining
why it's harmless. Keep the filter narrow — broad filters hide real bugs.

---

## Shared Test Map Fixture (Faster Tests)

Most e2e tests load the same `?testMap=true` page. To avoid repeating that
expensive navigation for every test, use the shared fixture from `tests/e2e/fixtures.ts`:

```typescript
// Import from fixtures instead of @playwright/test
import { test, expect } from './fixtures';

test('my test', async ({ gp }) => {
    // gp is a GamePage with testMap already loaded and state reset
    // No need to call goto() or waitForReady()
    await gp.spawnUnit(1);  // Bearer = UnitType 1
    await gp.waitForUnitCount(1);
    // ...
});
```

### Fixture hierarchy

```
testMapPage (worker-scoped, 45s timeout)
    └── gp (test-scoped, 5s setup timeout)
        ├── gpWithBuilding (has Lumberjack placed)
        ├── gpWithUnit (has Bearer spawned)
        ├── gpWithMovingUnit (has Bearer moving east)
        └── gpCentered (camera centered on map)
```

The base `gp` fixture:
- Loads the test map **once per worker** (not per test)
- Calls `resetGameState()` before each test (removes user entities, keeps trees)
- Uses `force: true` for UI clicks to skip actionability waits
- Has a 5-second fixture timeout (separate from test timeout)

### Preset fixtures

For tests that need common starting state, use preset fixtures:

```typescript
// Test with a Lumberjack building already placed
test('verify building state', async ({ gpWithBuilding }) => {
    await expect(gpWithBuilding).toHaveBuildingCount(1);
});

// Test with a Bearer unit already spawned
test('verify unit state', async ({ gpWithUnit }) => {
    await expect(gpWithUnit).toHaveUnitCount(1);
});

// Test with a unit already moving
test('test movement redirection', async ({ gpWithMovingUnit }) => {
    await expect(gpWithMovingUnit).toHaveUnitsMoving(1);
});
```

**When NOT to use the shared fixture:**
- Screenshot regression tests (need pixel-perfect fresh state)
- Tests that need a non-testMap page (sprite browser, real assets)
- Tests that intentionally corrupt page state (navigation tests)

For those, import from `./matchers` and manage the page yourself.

### State reset details

`resetGameState()` goes through proper game logic:
1. Removes only user-placed entities (type 1, 2, 4) via `game.execute()`
2. **Keeps environment objects** (type 3 = trees) — test map has ~500 of these
3. Calls `inputManager.switchMode('select')` with proper lifecycle
4. Waits for 2 frames to propagate cleanup

### Adding new tests to the shared fixture

```typescript
// tests/e2e/my-feature.spec.ts
import { test, expect } from './fixtures';

test.describe('My Feature', { tag: '@smoke' }, () => {
    test('test case', async ({ gp }) => {
        const page = gp.page;
        // gp is ready to use — game loaded, state clean
        // Use game.execute() for setup, UI for interaction
    });
});
```

---

## Timeouts

### Project-based timeouts (preferred)

The Playwright config defines timeouts per project based on tags. **Use tags instead
of manual `test.setTimeout()`:**

```typescript
// GOOD — project handles timeout automatically
test.describe('Slow Tests', { tag: '@slow' }, () => {
    test('complex multi-phase test', async ({ gp }) => {
        // Gets 30s timeout from 'slow' project
    });
});

// AVOID — redundant if tag is set correctly
test('slow test', async ({ gp }) => {
    test.setTimeout(30_000);  // Unnecessary if @slow tag is used
});
```

### Explicit timeouts in waits

When using `page.waitForFunction` in spec files, always pass an explicit `{ timeout }`:
```typescript
// GOOD — explicit timeout
await page.waitForFunction(predicate, args, { timeout: 5000 });

// BAD — relies on global default, unclear intent
await page.waitForFunction(predicate, args);
```

The `GamePage` helpers (`waitForReady`, `waitForFrames`, `waitForUnitCount`, etc.)
all have sensible default timeouts (3–20s) that are capped by the global test timeout.

### Fixture timeouts

Fixtures have their own timeout separate from test timeout:
- `testMapPage`: 45s (worker-scoped, one-time setup)
- `gp` and presets: 5s (test-scoped, quick reset)

This prevents fixture setup from eating into test time.

---

## Unit Tests (Vitest)

### Shared Test Helpers

Use the shared helpers in `tests/unit/helpers/` to reduce boilerplate:

**`test-game.ts`** — GameState and entity factories:
```typescript
import {
    createGameState,
    addUnit,
    addBuilding,
    addBuildingWithInventory,
    addUnitWithPath,
    initializeAnimationState,
    createPickupJob,
    createDeliverJob,
    createReturnHomeJob,
    placeBuilding,
    spawnUnit,
    moveUnit,
    removeEntity,
    createTestEventBus,
} from '../helpers/test-game';

// Usage
const state = createGameState();
const { entity, unitState } = addUnit(state, 10, 10);
const building = addBuildingWithInventory(state, 15, 15, BuildingType.Sawmill);
initializeAnimationState(entity);
const job = createPickupJob(building.id, EMaterialType.LOG, 5);
```

**`test-map.ts`** — Map and terrain fixtures:
```typescript
import { createTestMap, TERRAIN, setTerrainAt, blockColumn } from '../helpers/test-map';

const testMap = createTestMap(64, 64);  // 64x64 grass map
setTerrainAt(testMap, 10, 10, TERRAIN.WATER);
blockColumn(testMap, 5, 0, 10);  // Block tiles for pathfinding tests
```

### Keep Tests Focused

**Prefer fewer, more comprehensive tests over many granular ones.**

Bad (39 tests for simple mode):
```typescript
it('should return HANDLED', () => { ... });
it('should set mode data', () => { ... });
it('should update preview', () => { ... });
```

Good (focused test covering related behavior):
```typescript
it('should initialize with building type and switch to select if missing', () => {
    mode.onEnter(mockContext, { buildingType: BuildingType.Lumberjack, player: 1 });
    expect(modeData?.buildingType).toBe(BuildingType.Lumberjack);

    switchedToMode = null;
    mode.onEnter(mockContext, undefined);
    expect(switchedToMode).toBe('select');
});
```

### Test Structure

Use `describe` blocks to group related tests by behavior:
```typescript
describe('CarrierManager', () => {
    describe('createCarrier', () => { ... });
    describe('removeCarrier', () => { ... });
    describe('canAssignJobTo', () => { ... });
    describe('assignJob', () => { ... });
});
```

### Standard Setup Pattern

Use `beforeEach` for common setup:
```typescript
describe('CarrierMovementController', () => {
    let carrierManager: CarrierManager;
    let gameState: GameState;
    let testMap: TestMap;

    beforeEach(() => {
        carrierManager = new CarrierManager();
        gameState = createGameState();
        testMap = createTestMap(64, 64);
        gameState.setTerrainData(
            testMap.groundType,
            testMap.groundHeight,
            testMap.mapSize.width,
            testMap.mapSize.height,
        );
    });

    // Tests can assume fresh state
});
```

### Test Data Builders

Use builder functions for complex test objects:
```typescript
// GOOD — use shared builders
const job = createPickupJob(200, EMaterialType.LOG, 5);

// BAD — inline object literals everywhere
const job: CarrierJob = {
    type: 'pickup',
    fromBuilding: 200,
    material: EMaterialType.LOG,
    amount: 5,
};
```

### Mock Patterns

**Creating minimal mocks for interfaces:**
```typescript
function createPointerData(overrides: Partial<PointerData> = {}): PointerData {
    return {
        screenX: 100, screenY: 100,
        button: MouseButton.Left,
        shiftKey: false, ctrlKey: false, altKey: false,
        originalEvent: {} as PointerEvent,
        ...overrides,
    };
}
```

### Named Constants Over Magic Numbers

Use named constants for test fixture IDs:
```typescript
// GOOD — clear what IDs represent
const TAVERN_ID = 100;
const SAWMILL_ID = 200;
const CARRIER_ID = 1;

const tavern = addBuilding(state, 5, 5, BuildingType.ResidenceSmall);
const sawmill = addBuildingWithInventory(state, 10, 10, BuildingType.Sawmill);

// BAD — magic numbers
manager.assignJob(1, { fromBuilding: 200, ... });
```

### Use Public APIs, Not Direct Mutation

Test through public APIs instead of directly mutating state:
```typescript
// GOOD — use manager API
manager.setStatus(carrierId, CarrierStatus.Walking);
manager.assignJob(carrierId, job);

// BAD — direct mutation
const carrier = manager.getCarrier(carrierId)!;
carrier.status = CarrierStatus.Walking;
carrier.currentJob = job;
```

### Test Contracts, Not Implementation Details

**Prefer testing return values and observable behavior over internal state.**

Tests coupled to implementation details break when refactoring, even if behavior is unchanged.

```typescript
// GOOD — test the contract (return value)
const result = manager.assignJob(carrierId, job);
expect(result).toBe(true);

// Then verify observable behavior through public API
const carrier = manager.getCarrier(carrierId);
expect(carrier?.currentJob?.type).toBe('pickup');

// BAD — reaching into private/internal state
expect((manager as any).pendingAssignments.size).toBe(1);
expect(manager['internalQueue'].length).toBe(0);
```

**What to test:**
- Return values from public methods
- State accessible through public getters
- Events emitted (subscribe and verify)
- Side effects visible through other public APIs

**What NOT to test:**
- Private fields or methods
- Internal data structures
- Implementation-specific intermediate states
- Execution order of private helpers

This makes tests resilient to refactoring — you can change *how* something works as long as *what* it does remains the same.

### Use TDD for Bug Fixes

When fixing coordinate/math bugs, write a failing test first:
```typescript
it('should round-trip through screenToTile and tileToWorld', () => {
    for (const coord of [{ x: 320, y: 320 }, { x: 320, y: 321 }, { x: 0, y: 0 }]) {
        const world = tileToWorld(coord.x, coord.y);
        const tile = screenToTile(world.x, world.y);
        expect(tile).toEqual(coord);
    }
});
```

### Test Both Success and Error Cases

Cover both happy path and error scenarios:
```typescript
describe('assignJob', () => {
    it('should assign job to idle carrier', () => {
        manager.createCarrier(1, 100);
        const assigned = manager.assignJob(1, job);
        expect(assigned).toBe(true);
    });

    it('should reject assignment for non-existent carrier', () => {
        const assigned = manager.assignJob(999, job);
        expect(assigned).toBe(false);
    });

    it('should reject assignment for busy carrier', () => {
        manager.createCarrier(1, 100);
        manager.assignJob(1, job);
        const assigned = manager.assignJob(1, anotherJob);
        expect(assigned).toBe(false);
    });
});
```

### Anti-Patterns to Avoid

1. **Duplicating helpers** — If you write a helper function, check if it belongs in `test-game.ts`
2. **Direct state mutation** — Use manager/system APIs instead of setting properties
3. **Magic numbers** — Use named constants for IDs and values
4. **Inline object literals** — Use test data builders for repeated structures
5. **Test interdependency** — Each test must be independent and repeatable
6. **Testing implementation details** — Test behavior through public APIs

---

## What to Test

### Unit Tests
- Pure functions (pathfinding, placement validation, coordinate transforms)
- State machines (input modes, game state transitions)
- Data transformations (command execution)
- Game logic (entity lifecycle, economy, behavior trees)

### E2E Tests
- User flows (click button → mode changes → click canvas → building appears)
- Visual rendering (screenshot comparisons)
- Canvas interactions (pointer events, wheel, right-click)
- Navigation and app loading
- Debug bridge integration

### Skip Testing
- Simple getters/setters
- Framework code (Vue reactivity, Vite)
- Implementation details that could change

---

## Running Tests

```sh
pnpm test:unit              # All unit tests
pnpm test:unit path/to/test # Specific test file
pnpm test:watch             # Watch mode

pnpm build                  # Must rebuild before e2e tests
npx playwright test         # E2E tests (uses built dist)
npx playwright test --headed -g "test name"  # Run specific test visually
npx playwright test building-placement.spec.ts  # Run specific file

# Project-based execution (recommended)
npx playwright test --project=smoke    # Only smoke tests (10s timeout)
npx playwright test --project=default  # Standard tests (15s timeout)
npx playwright test --project=slow     # Slow tests (30s timeout)
npx playwright test --project=assets   # Asset-dependent (60s timeout)

# Tag-based filtering (alternative)
npx playwright test --grep @smoke              # Only smoke tests
npx playwright test --grep-invert @slow        # Skip slow tests
npx playwright test --grep-invert @requires-assets  # Skip asset-dependent
```
