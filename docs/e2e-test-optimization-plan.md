# E2E Test Optimization Plan

This document outlines improvements to reduce e2e test runtime and improve reliability.

**Current state:** 76 tests across 12 files, ~3.5 min total runtime with 2 workers.

---

## Phase 1: Quick Wins (1-2 hours)

### 1.1 Reduce Remaining High Frame Waits

**Problem:** 8 calls still use `waitForFrames(10)` or `waitForFrames(15)` - each adds ~1-2s.

**Locations:**
| File | Line | Current | Likely Reducible To |
|------|------|---------|---------------------|
| building-placement.spec.ts | 385 | 15 | 5 (after placeBuilding) |
| building-placement.spec.ts | 418 | 15 | 5 (verify buildings exist) |
| building-placement.spec.ts | 472 | 15 | 5 (multiple buildings) |
| building-placement.spec.ts | 496 | 10 | 5 (hover preview) |
| resource-placement.spec.ts | 228 | 10 | 5 (verify resource exists) |
| resource-placement.spec.ts | 256 | 10 | 5 (hover preview) |
| unit-movement-animations.spec.ts | 250 | 10 | Keep (animation sampling) |
| map-loading.spec.ts | 46 | 10 | Keep (timing measurement) |

**Action:** Change 6 calls from 10-15 frames to 5 frames, validate tests pass.

**Expected savings:** ~6-8s total runtime.

---

### 1.2 Use Specialized Fixtures

**Problem:** Tests manually set up scenarios that fixtures already provide.

**Existing underutilized fixtures:**
- `gpWithBuilding` - has Lumberjack already placed
- `gpWithUnit` - has Carrier spawned
- `gpWithMovingUnit` - has Carrier moving east
- `gpCentered` - camera centered on map

**Candidates for migration:**

```typescript
// building-placement.spec.ts - "placed building is visually rendered"
// Currently:
test('placed building is visually rendered', async ({ gp }) => {
    const building = await gp.placeBuilding(1, x, y);
    await gp.waitForFrames(15);
    // assertions...
});

// Should be:
test('placed building is visually rendered', async ({ gpWithBuilding }) => {
    // building already exists, no setup wait needed
    // assertions...
});
```

**Action:** Audit tests, migrate 5-10 tests to use preset fixtures.

**Expected savings:** ~5-10s (eliminates setup + wait per migrated test).

---

### 1.3 Increase Worker Count

**Problem:** Only 2 parallel workers, but tests are independent.

**Action:** In `playwright.config.ts`:
```typescript
export default defineConfig({
    workers: process.env.CI ? 2 : 4,  // 4 workers locally, 2 in CI
});
```

**Validation:** Run full suite, check for flakiness from resource contention.

**Expected savings:** ~30-40% faster locally (diminishing returns past 4 workers).

---

## Phase 2: Smarter Waits (2-4 hours)

### 2.1 Condition-Based Waits

**Problem:** Fixed frame waits are guesswork - either too long (slow) or too short (flaky).

**Current pattern:**
```typescript
await gp.placeBuilding(1, x, y);
await gp.waitForFrames(15);  // Hope it's rendered by now
await expect(gp).toHaveEntity({ type: 2 });
```

**Better pattern:**
```typescript
await gp.placeBuilding(1, x, y);
// Matcher already retries with polling - no fixed wait needed
await expect(gp).toHaveEntity({ type: 2 }, { timeout: 5000 });
```

**Implementation:**

1. **Audit frame waits followed by assertions** - most can be eliminated if assertion has retry logic.

2. **Add missing polling matchers** if needed:
```typescript
// In matchers.ts - add if not present
toHaveEntityRendered: async (gp, filter, options) => {
    // Poll until entity appears in renderer's visible set
}
```

3. **For rendering verification**, add a dedicated helper:
```typescript
// game-page.ts
async waitForEntityRendered(entityId: number, timeout = 5000): Promise<void> {
    await this.page.waitForFunction(
        (id) => {
            const renderer = (window as any).__settlers_entity_renderer__;
            return renderer?.isEntityVisible(id);
        },
        entityId,
        { timeout }
    );
}
```

**Action:**
- Identify all `waitForFrames` immediately before `expect()` calls
- Remove the wait, increase assertion timeout if needed
- Add condition-based helpers for rendering verification

**Expected savings:** More reliable tests + ~10-15s total.

---

## Phase 3: Test Map Variants (4-6 hours)

### 3.1 Pre-Configured Test Maps

**Problem:** Tests that need buildings/units spend time setting them up.

**Solution:** Multiple test map configurations loaded once per worker.

**Implementation:**

1. **Extend test map generator** (`src/resources/map/test-map-generator.ts`):
```typescript
export type TestMapVariant = 'empty' | 'withBuildings' | 'withUnits' | 'withBoth';

export function generateTestMap(variant: TestMapVariant = 'empty'): MapData {
    const map = generateBaseTestMap();

    if (variant === 'withBuildings' || variant === 'withBoth') {
        // Add 3 Lumberjacks at known positions
        map.addBuilding(BuildingType.WoodcutterHut, 100, 100, 0);
        map.addBuilding(BuildingType.WoodcutterHut, 110, 100, 0);
        map.addBuilding(BuildingType.Warehouse, 105, 110, 0);
    }

    if (variant === 'withUnits' || variant === 'withBoth') {
        // Add 5 Carriers at known positions
        for (let i = 0; i < 5; i++) {
            map.addUnit(UnitType.Carrier, 100 + i * 2, 105, 0);
        }
    }

    return map;
}
```

2. **Add query param support:**
```
/map-view?testMap=true&variant=withBuildings
```

3. **Add worker fixtures for each variant:**
```typescript
// fixtures.ts
testMapWithBuildings: [async ({ browser }, use) => {
    const page = await browser.newPage();
    const gp = new GamePage(page);
    await gp.goto({ testMap: true, variant: 'withBuildings' });
    await gp.waitForReady();
    await use(page);
}, { scope: 'worker' }],
```

4. **Create derived fixtures:**
```typescript
gpWithPresetBuildings: [async ({ testMapWithBuildings }, use) => {
    const gp = new GamePage(testMapWithBuildings);
    await gp.resetGameState();  // Keeps the pre-placed buildings
    await use(gp);
}],
```

**Expected savings:** Eliminates setup time for 10-15 tests that need buildings/units.

---

## Phase 4: Architecture Improvements (1-2 days)

### 4.1 Split Game Logic from Rendering Tests

**Problem:** Many tests only verify game logic but wait for rendering.

**Example:**
```typescript
// This test is really about game state, not rendering
test('building placement creates entity', async ({ gp }) => {
    const building = await gp.placeBuilding(1, x, y);
    await gp.waitForFrames(15);  // Why wait for render?
    expect(building).not.toBeNull();
    expect(building.type).toBe(2);
});
```

**Solution:** Create two test categories:

1. **Game Logic Tests** (fast, no render waits):
```typescript
// tests/e2e/game-logic/*.spec.ts
test('building placement creates entity', async ({ gp }) => {
    const building = await gp.placeBuilding(1, x, y);
    // No frame wait - we're testing game state, not rendering
    expect(building).not.toBeNull();
    expect(building.type).toBe(2);
});
```

2. **Rendering Tests** (slower, visual verification):
```typescript
// tests/e2e/rendering/*.spec.ts
test('building is visually rendered', async ({ gp }) => {
    const building = await gp.placeBuilding(1, x, y);
    await gp.waitForEntityRendered(building.id);
    await expect(gp.canvas).toHaveScreenshot();
});
```

**Action:**
- Categorize existing tests: ~50% are game logic, ~30% rendering, ~20% mixed
- Move pure game logic tests to skip render waits
- Keep rendering tests with appropriate waits

**Expected savings:** ~30-40% faster for game logic tests.

---

### 4.2 Vitest Browser Mode for Logic Tests

**Problem:** Playwright has overhead (IPC, browser management) even for non-visual tests.

**Solution:** Use Vitest's experimental browser mode for game logic tests.

**Benefits:**
- Same browser environment as Playwright
- Much faster startup (~100ms vs ~2s)
- Direct function calls instead of IPC
- Can share code with unit tests

**Implementation:**

1. **Configure Vitest browser mode:**
```typescript
// vitest.config.ts
export default defineConfig({
    test: {
        include: ['tests/browser/**/*.spec.ts'],
        browser: {
            enabled: true,
            name: 'chromium',
            provider: 'playwright',
        },
    },
});
```

2. **Create browser test helpers:**
```typescript
// tests/browser/helpers.ts
export async function loadTestMap(): Promise<Game> {
    // Direct game instantiation without Playwright page
    const game = await createGame({ testMap: true });
    return game;
}
```

3. **Migrate pure logic tests:**
```typescript
// tests/browser/building-placement.spec.ts
import { loadTestMap } from './helpers';

test('building placement creates entity', async () => {
    const game = await loadTestMap();
    const result = game.execute({ type: 'place_building', ... });
    expect(result).toBe(true);
});
```

**Candidates for migration:**
- All `game.execute()` tests
- Entity state verification tests
- Command validation tests
- Pathfinding tests (if any)

**Expected savings:** 5-10x faster for migrated tests.

---

### 4.3 Lazy Asset Loading Mock

**Problem:** Tests wait for sprite/GFX loading even when not testing rendering.

**Current flow:**
```
Page load → Asset fetch (500ms+) → Game ready → Test runs
```

**Solution:** Mock asset loading for non-rendering tests.

**Implementation:**

1. **Add mock mode to SpriteLoader:**
```typescript
// sprite-loader.ts
export class SpriteLoader {
    constructor(private mockMode = false) {}

    async loadFileSet(id: string): Promise<FileSet | null> {
        if (this.mockMode) {
            return this.createMockFileSet(id);
        }
        // ... real loading
    }

    private createMockFileSet(id: string): FileSet {
        // Return minimal valid structure with 1x1 transparent sprites
        return { /* mock data */ };
    }
}
```

2. **Add query param:**
```
/map-view?testMap=true&mockAssets=true
```

3. **Use in fixtures:**
```typescript
// For game logic tests
gpFast: [async ({ browser }, use) => {
    const page = await browser.newPage();
    await page.goto('/map-view?testMap=true&mockAssets=true');
    // ...
}],
```

**Expected savings:** ~500ms-1s per test that uses this mode.

---

## Implementation Priority

| Phase | Effort | Impact | Priority |
|-------|--------|--------|----------|
| 1.1 Reduce frame waits | 30 min | Medium | Do first |
| 1.2 Use fixtures | 1 hour | Medium | Do first |
| 1.3 Increase workers | 15 min | High | Do first |
| 2.1 Condition waits | 2-3 hours | High | Do second |
| 3.1 Test map variants | 4-6 hours | Medium | Do third |
| 4.1 Split logic/render | 1 day | High | Do fourth |
| 4.2 Vitest browser | 1 day | Very High | Evaluate ROI |
| 4.3 Asset mocking | 4-6 hours | Medium | Do with 4.1 |

---

## Success Metrics

| Metric | Current | Target |
|--------|---------|--------|
| Total runtime (2 workers) | ~3.5 min | < 2 min |
| Total runtime (4 workers) | N/A | < 1.5 min |
| Average test time | ~2.5s | < 1.5s |
| Flaky test rate | ~2% | < 0.5% |

---

## Notes

- Always run full suite after changes to catch regressions
- Use `WAIT_PROFILER_VERBOSE=1` to measure impact
- Commit incrementally - one optimization per commit for easy rollback
