# E2E Test Tiers: Visual, Spatial, and Economic

Analysis of how to restructure e2e tests into layered abstraction tiers so that
only the lowest tier needs textures/rendering, while higher tiers operate on
progressively more abstract game concepts.

---

## The Three Tiers

### Tier 1: Visual (Rendering)

**What it tests**: Correct textures, sprite assignments, directions rendered on screen,
screenshot baselines, pixel colors, canvas output.

**Depends on**: Full WebGL2 pipeline, sprite loading, texture atlases, shaders.

**Assertions look like**:
- Screenshot matches baseline (pixel comparison)
- Canvas pixels at (x, y) are not background color (entity was rendered)
- Sprite registry has N loaded sprites
- JIL lookup returns correct animation jobs
- Player color tint is applied to building sprites

**Current tests in this tier**:

| Test file | Specific tests |
|-----------|---------------|
| `terrain-rendering.spec.ts` | Screenshot baseline comparison |
| `building-placement.spec.ts` | "placed building is visually rendered on canvas" |
| `building-placement.spec.ts` | "building renders with player color (procedural fallback)" |
| `building-placement.spec.ts` | "multiple buildings rendered correctly" (visual check) |
| `resource-placement.spec.ts` | "placed resource is rendered on canvas" |
| `unit-sprites.spec.ts` | All tests (sprite loading, texture rendering, JIL lookup) |
| `sprite-cache.spec.ts` | Cache hit/miss timing for sprite atlas loading |

**Environment**: Requires GPU or working SwiftShader. Cannot run headless without WebGL.

---

### Tier 2: Spatial (Entity Positions, Movement, Animations)

**What it tests**: Entity positions, pathfinding, movement interpolation, animation
state machines (which animation is *playing*, not what it *looks like*), spatial
relationships between entities, terrain passability.

**Depends on**: Game state + game loop running. Needs entities with positions and
movement controllers. Does NOT need to read pixels or verify visual output.

**Assertions look like**:
- Unit position changed from (x1, y1) to (x2, y2)
- Path length > 0 after move command
- No position jump > 2 tiles between samples (smooth movement)
- Animation state is `{playing: true, sequenceKey: 'walk'}`
- Direction is valid (0-5) and matches movement vector
- Movement controller state is 'idle' after arriving
- Entity created at correct (x, y) with correct type/subType
- Terrain at (x, y) is passable / is water

**Current tests in this tier**:

| Test file | Specific tests |
|-----------|---------------|
| `unit-movement.spec.ts` | All 5 tests (start+complete, smooth, multi-unit, redirect, debug stats) |
| `unit-movement-animations.spec.ts` | All 4 tests (walk anim, consistency, direction, events) |
| `building-placement.spec.ts` | Entity creation tests (correct type, position, multiple placement) |
| `building-placement.spec.ts` | Terrain validation ("spawned unit is on passable terrain") |
| `building-placement.spec.ts` | Pointer events, tile clicking, mode switching |
| `resource-placement.spec.ts` | Entity creation tests (correct type, amount, position) |
| `resource-placement.spec.ts` | Placement preview state (`indicatorsEnabled`, `previewBuildingType`) |

**Environment**: Needs game loop ticking. Currently coupled to renderer (see
[Architectural Coupling](#architectural-coupling) below).

---

### Tier 3: Economic (Goals, Goods, Logistics)

**What it tests**: Service areas, inventories, carrier jobs, resource requests,
production chains, supply/demand, economy rules. Deals with abstract game concepts —
no coordinates, no textures.

**Depends on**: Pure game state. Needs entity managers (carrier, inventory, service area,
request) but doesn't need positions, movement, or rendering.

**Assertions look like**:
- Building has service area (`hasServiceArea(id) === true`)
- Building has inventory (`hasInventory(id) === true`)
- Carrier is registered with home building
- Carrier has no active job (`hasJob === false`)
- Resource request is pending with correct material type and amount
- (Future) Production building consumed 1 LOG and produced 1 PLANK
- (Future) Carrier picked up goods from source and delivered to destination

**Current tests in this tier**:

| Test file | Specific tests |
|-----------|---------------|
| `carrier-logistics.spec.ts` | "residence creates service area" |
| `carrier-logistics.spec.ts` | "sawmill gets inventory" |
| `carrier-logistics.spec.ts` | "carrier registration" |
| `carrier-logistics.spec.ts` | "resource request creation" |

**Environment**: Needs only `game.execute()` and state managers. No rendering, no
positions, no animation. These tests should be the fastest and most portable.

---

## Tier Boundary Rules

### Tier 3 (Economic) MUST NOT:
- Assert positions, coordinates, or distances
- Read animation state or sprite data
- Sample pixel colors or take screenshots
- Depend on `waitForFrames()` for synchronization
- Reference movement controllers or path data

### Tier 2 (Spatial) MUST NOT:
- Read canvas pixels (`gl.readPixels`)
- Take or compare screenshots
- Assert sprite textures, atlas contents, or cache state
- Reference sprite loaders, sprite managers, or JIL data
- Assert visual appearance (color, size, opacity)

### Tier 1 (Visual) CAN:
- Do everything Tier 2 and 3 can, plus read pixels and compare screenshots
- This tier is the only one that truly needs WebGL rendering output

---

## Architectural Coupling Problem

Currently, all three tiers require a working WebGL2 renderer because of how the
game initialization pipeline works:

```
use-renderer.ts:initRenderersAsync()
│
├── landscapeRenderer.init(gl)     ← Requires WebGL2
│   └── sets gameLoaded = true
│
├── entityRenderer.init(gl)        ← Requires WebGL2
│   └── sets rendererReady = true
│
└── entityRenderer.onSpritesLoaded
    └── game.gameLoop.enableTicks() ← Game ticks DON'T START until sprites load
```

**Three coupling points block headless Tier 2/3 tests:**

1. **`gameLoaded` requires WebGL**: Set after `landscapeRenderer.init(gl)`, which
   needs a WebGL context. Without WebGL, `gameLoaded` is never `true`.

2. **`rendererReady` requires WebGL**: Set after `entityRenderer.init(gl)`.
   The shared fixture waits for both flags.

3. **Game ticks require sprite loading**: `game.gameLoop.enableTicks()` is called
   from `entityRenderer.onSpritesLoaded`, which only fires after the entity renderer
   finishes loading sprites. Without WebGL, sprites never load, ticks never start,
   game state never advances.

4. **Debug stats update in render callback**: `debugStats.updateFromGame(game)` runs
   inside `createRenderCallback()`, which is the per-frame render function. Without
   rendering, entity counts/movement stats in `__settlers_debug__` never update.

### What this means

Even pure game-state tests (Tier 3: "does this building have inventory?") currently
fail without WebGL because the game never finishes initializing.

---

## Proposed Architecture Changes

To enable Tier 2 and Tier 3 tests without WebGL:

### Change 1: Decouple `gameLoaded` from renderer initialization

```typescript
// BEFORE (use-renderer.ts)
async function initRenderersAsync(gl, landscapeRenderer, entityRenderer, game) {
    await landscapeRenderer.init(gl);
    debugStats.state.gameLoaded = true;        // ← tied to WebGL
    await entityRenderer.init(gl);
    debugStats.state.rendererReady = true;     // ← tied to WebGL
}

// AFTER: Split game readiness from renderer readiness
// In Game.start() or game-loop.ts:
debugStats.state.gameLoaded = true;  // Game state is ready (map loaded, entities created)

// In use-renderer.ts:
async function initRenderersAsync(gl, landscapeRenderer, entityRenderer, game) {
    await landscapeRenderer.init(gl);
    // gameLoaded already set by game initialization
    await entityRenderer.init(gl);
    debugStats.state.rendererReady = true;     // Only renderer flag here
}
```

### Change 2: Enable game ticks independently of sprite loading

```typescript
// BEFORE
entityRenderer.onSpritesLoaded = () => game.gameLoop.enableTicks();

// AFTER: Enable ticks when game state is ready, not when sprites load
// For testMap mode (no real sprites), ticks should start immediately
if (game.useProceduralTextures) {
    game.gameLoop.enableTicks();  // No sprites to wait for
} else {
    entityRenderer.onSpritesLoaded = () => game.gameLoop.enableTicks();
}
```

### Change 3: Update debug stats outside render callback

```typescript
// BEFORE: debugStats.updateFromGame(game) only in render callback

// AFTER: Also update from game loop tick (independent of rendering)
// In game-loop.ts tick():
debugStats.updateFromGame(game);  // Runs every tick regardless of rendering
```

### Change 4: Add a game-only fixture for Tier 2/3 tests

```typescript
// tests/e2e/fixtures.ts — new fixture for headless game state tests
const gameOnlyPage = test.extend<{}, { gameStatePage: GamePage }>({
    gameStatePage: [async ({ browser }, use) => {
        const page = await browser.newPage();
        const gp = new GamePage(page);
        await gp.goto({ testMap: true });
        // Wait only for gameLoaded, NOT rendererReady
        await gp.waitForGameReady();  // New helper
        await use(gp);
        await page.close();
    }, { scope: 'worker', timeout: 30_000 }],
});
```

### Change 5: Add `waitForGameReady()` to GamePage

```typescript
// Waits for game state to be initialized, without requiring rendering
async waitForGameReady(timeout = 20_000): Promise<void> {
    await this.page.waitForFunction(
        () => {
            const debug = (window as any).__settlers_debug__;
            return debug && debug.gameLoaded;
        },
        undefined,
        { timeout }
    );
}
```

### Change 6: Alternative tick synchronization for non-rendering tests

```typescript
// Instead of waitForFrames (which needs frameCount from render loop),
// use waitForTicks which polls game tick count
async waitForTicks(n: number, timeout = 5_000): Promise<void> {
    await this.page.waitForFunction(
        ({ target }) => {
            const game = (window as any).__settlers_game__;
            return game && game.gameLoop.tickCount >= target;
        },
        { target: currentTickCount + n },
        { timeout }
    );
}
```

---

## Migration Path

### Phase 1: Extract Tier 3 (Economic) tests — no engine changes needed

Tier 3 tests that only check manager state after `game.execute()` calls can be
migrated to **unit tests** immediately. They don't actually need a browser:

```typescript
// tests/unit/carrier-logistics.spec.ts (unit test, not e2e)
describe('carrier logistics', () => {
    it('residence creates service area', () => {
        const state = createGameState();
        const building = placeBuilding(state, ...);
        expect(state.serviceAreaManager.hasServiceArea(building.id)).toBe(true);
    });
});
```

These tests use `game.execute()` which is testable with Vitest. Moving them to
unit tests makes them:
- ~100x faster (no browser, no page load)
- Independent of WebGL
- Runnable in any environment

### Phase 2: Decouple game init from renderer (engine changes)

Apply Changes 1-3 above to allow the game to start ticking without a renderer.
This unblocks Tier 2 spatial tests in headless environments.

### Phase 3: Create the game-only fixture

Apply Changes 4-6 to create a lightweight fixture for Tier 2 tests that don't
need pixel output. These tests verify positions, paths, and animation state machines
but never read canvas pixels.

### Phase 4: Tag and organize tests by tier

```typescript
// Tier 1 — needs full rendering
test.describe('Building Rendering', { tag: ['@visual', '@requires-webgl'] }, () => {
    test('placed building is visually rendered on canvas', ...);
});

// Tier 2 — needs game loop, not rendering
test.describe('Unit Movement', { tag: '@spatial' }, () => {
    test('unit starts moving and completes path', ...);
});

// Tier 3 — pure game state (or move to unit tests entirely)
test.describe('Carrier Logistics', { tag: '@economic' }, () => {
    test('residence creates service area', ...);
});
```

Run by tier:
```sh
npx playwright test --grep @visual        # Only rendering tests
npx playwright test --grep @spatial       # Positions and movement
npx playwright test --grep @economic      # Pure game logic
npx playwright test --grep-invert @visual # Everything except rendering
```

---

## Current Test Inventory by Tier

### Tier 1: Visual (8 tests)

| File | Test | What it checks |
|------|------|---------------|
| terrain-rendering | screenshot baseline | Pixel-perfect terrain colors |
| building-placement | visually rendered on canvas | Pixels changed after placement |
| building-placement | player color rendering | Procedural color tints |
| building-placement | multiple buildings rendered | Visual entity count |
| resource-placement | rendered on canvas | Pixels changed after placement |
| unit-sprites | load from sprite registry | Sprite file parsing |
| unit-sprites | swordsman with texture | Textured vs color dot |
| unit-sprites | JIL index lookup | Animation file indexing |

### Tier 2: Spatial (24 tests)

| File | Test | What it checks |
|------|------|---------------|
| unit-movement | start + complete path | Position change, path data |
| unit-movement | smooth movement | No teleporting between samples |
| unit-movement | multiple units consistent speeds | Distance variance |
| unit-movement | redirect mid-movement | Path replacement |
| unit-movement | debug stats moving count | unitsMoving counter |
| unit-movement-animations | walk anim plays + stops | Animation state machine |
| unit-movement-animations | consistency during movement | 20 samples all playing |
| unit-movement-animations | direction updates on redirect | Direction value 0-5 |
| unit-movement-animations | movementStopped event | Event bus firing |
| building-placement | pointer events on canvas | DOM event dispatch |
| building-placement | tile click sets hoveredTile | Tile coordinate tracking |
| building-placement | building mode activation | Mode state change |
| building-placement | select mode returns | Mode state change |
| building-placement | entity creation attributes | Type, subType, x, y, player |
| building-placement | canvas click placement | Click-to-entity pipeline |
| building-placement | no placement in select mode | Mode gating |
| building-placement | multiple canvas placements | Batch entity creation |
| building-placement | different building types | SubType selection |
| building-placement | spawn on passable terrain | Terrain + position validation |
| building-placement | spawn swordsman | Entity creation |
| building-placement | spawn at clicked tile | Tile → position mapping |
| building-placement | placement preview state | Preview object properties |
| resource-placement | (most tests) | Entity creation, amounts, types |
| terrain-rendering | correct initial state | Entity counts, mode, loaded flags |

### Tier 3: Economic (4 tests)

| File | Test | What it checks |
|------|------|---------------|
| carrier-logistics | service area creation | Manager state after building placement |
| carrier-logistics | sawmill inventory | Manager state after building placement |
| carrier-logistics | carrier registration | Carrier-building relationship |
| carrier-logistics | resource request creation | Request manager state |

### Cross-cutting (not game-tier-specific)

| File | Tests | Category |
|------|-------|----------|
| game-logic | 11 tests | App loading, routing, DOM, input events |
| sprite-browser | 5 tests | Tool page UI |
| map-loading | 3 tests | Load pipeline performance |
| audio | 4 tests | Audio state machine |
| sprite-cache | 1 test | Caching performance |

---

## Recommendation

**Start with Phase 1** — move Tier 3 (economic) tests to unit tests. This requires
zero engine changes and immediately gives you fast, reliable tests for logistics,
inventory, service areas, and carrier state. These concepts are purely about game
rules and don't need a browser.

**Phase 2** is the highest-value engine change: decoupling `gameLoaded` and game
ticks from the renderer. This unblocks ~24 spatial tests in headless CI environments
and makes the test suite much more portable.

**Phases 3-4** are organizational improvements that become valuable once the engine
supports headless game state testing.
