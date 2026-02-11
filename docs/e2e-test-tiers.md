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

Without the Phase 2 changes, even pure game-state tests fail without WebGL because
the game never finishes initializing.

---

## Architecture Changes (Phase 2 — Implemented)

The following changes decouple game ticks from rendering, enabling Tier 2 and Tier 3
tests without WebGL:

### Change 1+2: Headless fallback in `use-renderer.ts`

When `gl` is null (no WebGL), the renderer can't initialize. Instead of leaving
the game stuck, we now set `gameLoaded = true` and enable ticks immediately for
procedural/testMap mode:

```typescript
// src/components/use-renderer.ts — initRenderer()
const gl = renderer.gl;
if (gl) {
    void initRenderersAsync(gl, landscapeRenderer, entityRenderer, game);
} else {
    // No WebGL — game state still works
    debugStats.state.gameLoaded = true;
    if (game.useProceduralTextures) {
        game.gameLoop.enableTicks();
    }
}
```

When WebGL IS available, the original flow is unchanged: `initRenderersAsync` sets
`gameLoaded` after landscape init and `rendererReady` after entity renderer init.

### Change 3: Debug stats update from tick (not just render callback)

Added `debugStats.updateFromGameState(gameState)` — a new method that updates
entity counts and movement stats from `GameState` alone (no `Game` wrapper needed).
Called at the end of every `GameLoop.tick()`:

```typescript
// src/game/game-loop.ts — tick()
private tick(dt: number): void {
    debugStats.recordTick();
    // ... run all systems ...
    debugStats.updateFromGameState(this.gameState);
}
```

The render callback's `debugStats.updateFromGame(game)` now delegates to
`updateFromGameState` internally, then adds audio state and window exposure.

### Change 4: Monotonic tick counter in debug stats

Added `tickCount` to `DebugStatsState` — a monotonically increasing counter
that increments on every `recordTick()`. Unlike `ticksPerSec` (which resets
every second), this provides a stable target for `waitForTicks()`.

### Change 5: `waitForGameReady()` and `waitForTicks()` in GamePage

```typescript
// Wait for gameLoaded + N ticks (no rendering required)
await gp.waitForGameReady(5, timeout);

// Wait for N additional ticks from current count
await gp.waitForTicks(5, timeout);
```

### Change 6: `gameStatePage` fixture + `gs` test fixture

```typescript
// Worker fixture — waits for gameLoaded only (not rendererReady)
gameStatePage: [async({ browser }, use) => {
    const page = await context.newPage();
    const gp = new GamePage(page);
    await gp.goto({ testMap: true });
    await gp.waitForGameReady(5, timeout);
    await use(page);
}, { scope: 'worker' }]

// Test fixture — uses gameStatePage, resets state, 4x speed
gs: [async({ gameStatePage }, use) => {
    const gp = new GamePage(gameStatePage);
    await gp.resetGameState();
    await gp.setGameSpeed(4.0);
    await use(gp);
}]
```

Usage: `test('my test', async ({ gs }) => { ... })` for tests that don't need WebGL.

---

## Migration Path

### Phase 1: Extract Tier 3 (Economic) tests — DONE

Tier 3 carrier-logistics tests moved to unit tests in
`tests/unit/integration/carrier-inventory-integration.spec.ts`.
Runs in ~4ms instead of ~15s.

### Phase 2: Decouple game init from renderer — DONE

Changes 1-6 above implemented. Game ticks run without WebGL in testMap mode.
`gameStatePage` fixture + `gs` test fixture available for Tier 2/3 tests.

### Phase 3: Migrate Tier 2 tests to `gs` fixture — DONE

Migrated 18 spatial tests from `gp`/`gpNormal` to `gs` fixture:

- **unit-movement.spec.ts**: All 5 tests → `gs`. `waitForFrames` → `waitForTicks`.
- **unit-movement-animations.spec.ts**: All 4 tests → `gs`. `gpNormal` tests set 1x
  speed explicitly. `waitForFrames` → `waitForTicks`.
- **building-placement.spec.ts**: 5 tests → `gs` (entity creation via `game.execute()`,
  all 4 unit spawning tests). 14 tests stay on `gp` (canvas clicks, UI buttons,
  visual rendering, placement preview).
- **resource-placement.spec.ts**: 4 tests → `gs` (entity creation, amounts, batch
  placement). 6 tests stay on `gp`/`gpWithUI` (canvas clicks, UI buttons, rendering,
  placement preview).

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

## Current Status

**Phase 1** (done): Tier 3 economic tests run as unit tests (~4ms).

**Phase 2** (done): Engine decoupled — `gameLoaded` and ticks work without WebGL.
`gs` fixture available for tests that don't need rendering.

**Phase 3** (done): 18 spatial tests migrated from `gp` to `gs` fixture. These tests
no longer require WebGL — they use `gameStatePage` (game-state only) instead of
`testMapPage` (full rendering). `waitForFrames` replaced with `waitForTicks` where
applicable.

**Next**: Phase 4 — add `@visual`/`@spatial`/`@economic` tags for selective CI runs.
