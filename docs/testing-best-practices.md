# Testing Best Practices

Guidelines for writing effective tests in Settlers.ts.

## Test Organization

### File Structure
```
tests/
  unit/                           # Fast, isolated unit tests (Vitest)
  e2e/                            # End-to-end browser tests (Playwright)
    game-page.ts                  # Page object — all shared helpers live here
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

## E2E Architecture Overview

### Layer diagram

```
  Spec files  →  GamePage (page object)  →  Debug bridges  →  Game engine
                 fixtures.ts (shared fixture)

  Spec files interact with the game through:
  1. UI interactions   — click buttons, hover canvas, navigate routes
  2. GamePage helpers  — waitForReady, moveCamera, spawnBearer, etc.
  3. game.execute()    — the command pipeline (same path the UI uses)
  4. Debug reads       — __settlers_debug__, getGameState(), getDebugField()
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

Key `GamePage` helpers — **use these instead of reimplementing**:
- `goto({ testMap: true })` — navigate to map view with synthetic test map
- `waitForReady(minFrames)` — wait for game loaded + renderer ready + N new frames
- `waitForFrames(n)` — wait for N **new** frames (relative counting)
- `waitForEntityCountAbove(n)` — poll until entity count exceeds N
- `findBuildableTile(buildingType?)` — spiral from map center to find valid spot
- `moveCamera(x, y)` — center camera on tile (uses `ViewPoint.setPosition()`)
- `resetGameState()` — remove all entities + reset mode via InputManager
- `getDebugField(key)` — read a single debug bridge field
- `getGameState()` — structured game state with entities
- `collectErrors()` — error collector with known-harmless warning filter

### Never use `waitForTimeout`
Use deterministic waiting instead:
```typescript
// BAD — flaky, slow
await page.waitForTimeout(500);

// GOOD — wait for N new frames
await gp.waitForFrames(5);

// GOOD — poll for specific condition
await gp.waitForEntityCountAbove(countBefore);

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
- `type === 3` → MapObject (trees, stones)

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
    await gp.spawnBearer();
    await gp.waitForEntityCountAbove(0);
    // ...
});
```

The `gp` fixture:
- Loads the test map **once per worker** (not per test)
- Calls `resetGameState()` before each test (removes entities via command pipeline, resets mode via InputManager)
- Calls `selectMode()` to ensure clean select mode state
- Waits for 2 frames to propagate cleanup
- Provides a `GamePage` ready for immediate use

**When NOT to use the shared fixture:**
- Screenshot regression tests (need pixel-perfect fresh state)
- Tests that need a non-testMap page (sprite browser, real assets)
- Tests that intentionally corrupt page state (navigation tests)

For those, import from `@playwright/test` and manage the page yourself.

### State reset details

`resetGameState()` goes through proper game logic:
1. Calls `game.removeAllEntities()` — iterates all entities and calls
   `game.execute({ type: 'remove_entity', ... })` for each, which handles
   terrain restoration, movement cleanup, selection, territory rebuild
2. Calls `inputManager.switchMode('select')` — goes through proper
   `onExit`/`onEnter` lifecycle (cleans up mode data, fires callbacks)
3. Waits for entity count to reach 0

### Adding new tests to the shared fixture

```typescript
// tests/e2e/my-feature.spec.ts
import { test, expect } from './fixtures';

test.describe('My Feature', () => {
    test('test case', async ({ gp }) => {
        const page = gp.page;
        // gp is ready to use — game loaded, state clean
        // Use game.execute() for setup, UI for interaction
    });
});
```

---

## Timeouts

Every wait must have an explicit timeout. The global test timeout is configurable
via the `E2E_TIMEOUT` env variable (default: 30s):

```sh
E2E_TIMEOUT=60000 npx playwright test   # 60s per test
```

The Playwright config also sets `actionTimeout` (10s) and `navigationTimeout` (15s)
so individual actions like clicks and page navigations can't hang indefinitely.

When using `page.waitForFunction` in spec files, always pass an explicit `{ timeout }`:
```typescript
// GOOD — explicit timeout
await page.waitForFunction(predicate, args, { timeout: 5000 });

// BAD — relies on global default, unclear intent
await page.waitForFunction(predicate, args);
```

The `GamePage` helpers (`waitForReady`, `waitForFrames`, `waitForEntityCountAbove`)
all have sensible default timeouts (5–20s) that are capped by the global test timeout.

---

## Unit Tests (Vitest)

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
Use `describe` blocks to group related tests:
```typescript
describe('PlaceBuildingMode', () => {
    describe('mode entry and exit', () => { ... });
    describe('cancel actions', () => { ... });
    describe('building placement', () => { ... });
});
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
E2E_TIMEOUT=60000 npx playwright test          # Custom timeout
```
