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

### Use Page Objects
```typescript
// tests/e2e/game-page.ts
export class GamePage {
    async waitForGameReady() { ... }
    async clickTile(x: number, y: number) { ... }
    async getDebugState() { ... }
}

// tests/e2e/building.e2e.ts
test('can place building', async ({ page }) => {
    const gamePage = new GamePage(page);
    await gamePage.waitForGameReady();
    await gamePage.clickBuildingButton('lumberjack');
    // ...
});
```

### Test with `?testMap=true`
Use synthetic test maps that don't require game assets:
```typescript
await page.goto('/?testMap=true');
```

### Access Debug State
Use the debug bridge for assertions:
```typescript
const debug = await page.evaluate(() => window.__settlers_debug__);
expect(debug.mode).toBe('select');
```

## What to Test

### Unit Tests
- Pure functions (pathfinding, placement validation, coordinate transforms)
- State machines (input modes, game state transitions)
- Data transformations (command execution)

### E2E Tests
- User flows (select building → place → verify)
- Visual rendering (screenshot comparisons)
- Integration between systems

### Skip Testing
- Simple getters/setters
- Framework code (Vue reactivity, Vite)
- Implementation details that could change

## Running Tests

```sh
pnpm test:unit              # All unit tests
pnpm test:unit path/to/test # Specific test file
pnpm test:watch             # Watch mode

npx playwright test         # E2E tests (runs build first)
npx playwright test --ui    # Interactive UI mode
```
