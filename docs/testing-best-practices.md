# Testing Best Practices

Guidelines for writing effective tests in Settlers.ts.

## Test Organization

### File Structure
```
tests/
  unit/           # Fast, isolated unit tests (Vitest)
  e2e/            # End-to-end browser tests (Playwright)
    game-page.ts  # Page object for e2e tests
```

### Naming Conventions
- Unit test files: `*.spec.ts` matching the source file name
- E2E test files: `*.e2e.ts` describing the feature

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
    // Valid entry
    mode.onEnter(mockContext, { buildingType: BuildingType.Lumberjack, player: 1 });
    expect(modeData?.buildingType).toBe(BuildingType.Lumberjack);

    // Invalid entry - switches to select
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
    describe('preview positioning', () => { ... });
    describe('render state', () => { ... });
});
```

### Mock Patterns

**Creating minimal mocks for interfaces:**
```typescript
function createPointerData(overrides: Partial<PointerData> = {}): PointerData {
    return {
        screenX: 100,
        screenY: 100,
        button: MouseButton.Left,
        shiftKey: false,
        ctrlKey: false,
        altKey: false,
        originalEvent: {} as PointerEvent, // Cast for unit tests
        ...overrides,
    };
}
```

**Mock context with tracking:**
```typescript
let executedCommands: any[];
let switchedToMode: string | null;

beforeEach(() => {
    executedCommands = [];
    switchedToMode = null;

    mockContext = {
        executeCommand: (cmd: any) => {
            executedCommands.push(cmd);
            return true;
        },
        switchMode: (name: string) => { switchedToMode = name; },
        // ...
    } as unknown as InputContext;
});
```

### Test Edge Cases in Groups
Test happy path and edge cases together when they're related:
```typescript
it('should NOT place or exit when preview is invalid or command fails', () => {
    // Invalid preview
    modeData!.previewValid = false;
    mode.onPointerUp(createPointerData(), mockContext);
    expect(executedCommands).toHaveLength(0);
    expect(switchedToMode).toBeNull();

    // Command failure
    modeData!.previewValid = true;
    mockContext.executeCommand = () => false;
    mode.onPointerUp(createPointerData(), mockContext);
    expect(switchedToMode).toBeNull();
});
```

### Use TDD for Bug Fixes
When fixing coordinate/math bugs, write a failing test first:
```typescript
it('should round-trip through screenToTile and tileToWorld', () => {
    // Test multiple coordinates including odd/even Y values
    const testCoords = [
        { x: 320, y: 320 },  // even Y
        { x: 320, y: 321 },  // odd Y (different stagger offset)
        { x: 0, y: 0 },      // edge case
    ];

    for (const coord of testCoords) {
        const world = tileToWorld(coord.x, coord.y);
        const tile = screenToTile(world.x, world.y);
        expect(tile).toEqual(coord);
    }
});
```

## E2E Tests (Playwright)

### Read before changing
**Always read the existing e2e tests and `game-page.ts` before modifying or adding tests.**
Understand what helpers exist, what patterns are used, and avoid duplicating functionality.

### Use Page Objects
All e2e tests should use `GamePage` from `tests/e2e/game-page.ts`:
```typescript
// tests/e2e/building-placement.spec.ts
test('can place building', async ({ page }) => {
    const gp = new GamePage(page);
    await gp.goto({ testMap: true });
    await gp.waitForReady();
    // ...
});
```

Key `GamePage` helpers — **use these instead of reimplementing**:
- `goto({ testMap: true })` — navigate to map view with synthetic test map
- `waitForReady(minFrames)` — wait for game loaded + renderer ready + N frames
- `waitForFrames(n)` — wait for N frames rendered
- `waitForEntityCountAbove(n)` — poll until entity count exceeds N
- `findBuildableTile()` — spiral from map center to find valid placement spot
- `moveCamera(x, y)` — position camera on specific tile
- `getDebugField(key)` — read a single debug bridge field
- `getGameState()` — structured game state with entities
- `collectErrors()` — error collector with WebGL warning filter

### Never use `waitForTimeout`
Use deterministic waiting instead:
```typescript
// BAD — flaky, slow
await page.waitForTimeout(500);
const count = await gp.getDebugField('entityCount');

// GOOD — deterministic, fast
await gp.waitForFrames(5);
const count = await gp.getDebugField('entityCount');

// GOOD — poll for specific condition
await page.waitForFunction(
    (min) => (window as any).__settlers_debug__?.entityCount > min,
    countBefore,
    { timeout: 5000 },
);
```

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

`BuildingType` starts at 1 (Lumberjack). Never use `buildingType: 0`.

### Don't duplicate GamePage helpers
If a test needs to find buildable terrain, use `gp.findBuildableTile()` instead of
writing a custom spiral search inline. If you need new shared logic, add it to `GamePage`.

### No debug-only test files
Tests should have meaningful assertions — not just capture screenshots or log data.
Debug/diagnostic scripts belong in `scripts/`, not in the test suite.

### E2E vs Unit test boundary
**E2E tests should verify the full UI pipeline**: button clicks, canvas interactions,
visual rendering, navigation, error-free loading. If a test only calls `game.execute()`
and checks state without any UI interaction, it should be a unit test instead.

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

### Timeouts

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

### Resetting game state between tests

`GamePage.resetGameState()` removes all entities and resets mode to 'select'.
Use this in `beforeEach` when tests share a page to avoid state leaking:

```typescript
test.describe('Feature', () => {
    let gp: GamePage;

    test.beforeAll(async ({ browser }) => {
        const page = await browser.newPage();
        gp = new GamePage(page);
        await gp.goto({ testMap: true });
        await gp.waitForReady();
    });

    test.beforeEach(async () => {
        await gp.resetGameState();
    });

    test('first test', async () => { /* uses gp */ });
    test('second test', async () => { /* clean state */ });
});
```

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
