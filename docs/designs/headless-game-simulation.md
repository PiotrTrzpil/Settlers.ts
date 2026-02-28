# Headless Game Simulation — Design

## Overview

Enable the full game engine to run in a Node.js (Vitest) environment without a browser, renderer, sprites, or audio. The economy simulation tests (`economy-simulation.spec.ts`) will use real game objects wired through `GameServices` with real XML-derived game data loaded from disk, replacing the current stub-based `installTestGameData()` approach.

## Architecture

### Current State

The test simulation (`tests/unit/helpers/test-simulation.ts`) already bypasses the browser-dependent `Game` and `GameLoop` classes, directly instantiating `GameServices` and manually ticking systems. This works because **all game logic is pure TypeScript** — browser APIs are confined to `GameLoop` (rAF, document), `Renderer` (WebGL), `SoundManager` (Web Audio), and `InputManager` (DOM events). None of these are imported by `GameServices`.

The single gap: game data is injected via `installTestGameData()` which provides minimal stubs. The tests cannot exercise the real XML-derived choreographies, production configs, building definitions, or settler values.

### Target State

```
                    ┌──────────────────────────────┐
                    │   loadGameDataFromFiles()     │
                    │   (reads XML from disk via    │
                    │    Node.js fs, parses with    │
                    │    existing parsers)           │
                    └──────────────┬───────────────┘
                                   │ GameData
                    ┌──────────────▼───────────────┐
                    │   GameDataLoader.setData()    │
                    │   (singleton injection —      │
                    │    same as current stubs)      │
                    └──────────────┬───────────────┘
                                   │
    ┌──────────────────────────────▼──────────────────────────────┐
    │   createSimulation()  (existing test-simulation.ts)         │
    │   ┌─────────────────────────────────────────────────────┐   │
    │   │  GameServices  (real composition root)              │   │
    │   │  ├─ MovementSystem         ├─ SettlerTaskSystem     │   │
    │   │  ├─ BuildingConstruction   ├─ LogisticsDispatcher   │   │
    │   │  ├─ FeatureRegistry        ├─ CarrierManager        │   │
    │   │  │  ├─ InventoryFeature    ├─ WorkHandlers          │   │
    │   │  │  ├─ TreeFeature         └─ InventoryVisualizer   │   │
    │   │  │  ├─ StoneFeature                                 │   │
    │   │  │  ├─ CropFeature                                  │   │
    │   │  │  ├─ MaterialRequests                             │   │
    │   │  │  └─ Combat                                       │   │
    │   │  └─ EventBus + GameState                            │   │
    │   └─────────────────────────────────────────────────────┘   │
    │   tick() → manual loop over getTickSystems()                │
    └─────────────────────────────────────────────────────────────┘
```

### What Changes

| Layer | Change | Reason |
|-------|--------|--------|
| XML loading | New `loadGameDataFromFiles()` function | Load real game data from disk in Node.js |
| GameDataLoader | No change (already has `setData()`) | Injection path already exists |
| GameSettingsManager | Guard `localStorage` access | Constructor calls `loadSettings()` which uses `localStorage` |
| debugStats | Guard `localStorage` access | Singleton constructor calls `loadDebugSettings()` |
| test-simulation.ts | Use real game data, keep stub fallback | Tests should use real data when XML files are present |
| economy-simulation.spec.ts | Rewrite tests against real game data | Replace stub-dependent test expectations |

### What Does NOT Change

- `GameServices` — already pure, no modifications needed
- `Game` class — stays browser-only, not used by tests
- `GameLoop` — stays browser-only, not used by tests
- `Renderer`, `SoundManager`, `InputManager` — untouched
- All game systems, features, commands — already pure TypeScript
- `test-game-data.ts` — kept as fallback for tests without XML files

## Subsystems

| # | Subsystem | Responsibility | Files |
|---|-----------|---------------|-------|
| 1 | Disk-based XML Loader | Read XML files from `public/Siedler4/GameData/` using `fs`, parse with existing parsers, return `GameData` | `src/resources/game-data/load-game-data-from-files.ts` |
| 2 | localStorage Guards | Guard all `localStorage.getItem/setItem` calls for Node.js safety | `src/game/game-settings.ts`, `src/game/debug-stats.ts` |
| 3 | Test Simulation Upgrade | Update `createSimulation()` to use real XML data when available, improve test helpers | `tests/unit/helpers/test-simulation.ts`, `tests/unit/helpers/test-game-data.ts` |
| 4 | Economy Simulation Tests | Rewrite `economy-simulation.spec.ts` to use real game data, add richer assertions | `tests/unit/integration/economy-simulation.spec.ts` |

## Data Models

### GameData (existing — no changes)

| Field | Type | Description |
|-------|------|-------------|
| buildings | `Map<RaceId, RaceBuildingData>` | Per-race building definitions from buildingInfo.xml |
| jobs | `Map<RaceId, RaceJobData>` | Per-race job choreographies from jobInfo.xml |
| objects | `Map<string, ObjectInfo>` | Object definitions from objectInfo.xml |
| buildingTriggers | `Map<RaceId, RaceBuildingTriggerData>` | Building triggers from BuildingTrigger.xml |
| settlers | `Map<RaceId, RaceSettlerValueData>` | Settler values from SettlerValues.xml |

### Simulation (existing interface — no changes)

The `Simulation` interface exposed by `createSimulation()` stays identical. It already provides `placeBuilding`, `plantTreesNear`, `tick`, `runTicks`, `runUntil`, `getOutput`, `getInput`, `countEntities`, `destroy`.

## API Contracts

### New: `loadGameDataFromFiles(basePath: string): GameData`

Synchronous function. Reads XML files from disk and parses them using the existing parsers (`parseBuildingInfo`, `parseJobInfo`, `parseObjectInfo`, `parseBuildingTriggers`, `parseSettlerValues`).

```ts
// Signature
export function loadGameDataFromFiles(basePath: string): GameData;

// Usage in tests
import { loadGameDataFromFiles } from '@/resources/game-data/load-game-data-from-files';
const data = loadGameDataFromFiles('public/Siedler4/GameData');
GameDataLoader.getInstance().setData(data);
```

**Behavior:**
- Reads each XML file synchronously (`fs.readFileSync`)
- If a file is missing, uses empty map for that category (matches `GameDataLoader.doLoad()` behavior)
- Throws only on parse errors (not on missing files)

### New: `installRealGameData(): boolean`

Test helper function. Attempts to load real XML data from disk, returns `true` on success.

```ts
// Signature (in test-game-data.ts)
export function installRealGameData(): boolean;

// Usage — test conditionally skips when no XML files present
const hasRealData = installRealGameData();
describe.skipIf(!hasRealData)('Economy simulation (real data)', () => { ... });
```

### Existing: `installTestGameData()` — kept as-is

Still available as fallback for tests that don't need real XML data.

## Error Handling & Boundaries

| Layer | On error... | Example |
|-------|------------|---------|
| `loadGameDataFromFiles` | Missing file → empty map for that category, log warning | `buildingInfo.xml` missing → `buildings = new Map()` |
| `loadGameDataFromFiles` | Parse error → throw with file name and original error | `throw new Error('Failed to parse buildingInfo.xml: ...')` |
| `localStorage` guards | Access error → catch, use defaults | `try { localStorage.getItem(...) } catch { return defaults }` |
| `installRealGameData` | XML dir missing → return `false` | Test uses `describe.skipIf(!hasRealData)` |
| Simulation `runUntil` | Max ticks exceeded → return elapsed (no throw) | Caller asserts on output values |

## Subsystem Details

### Subsystem 1: Disk-based XML Loader

**Files:** `src/resources/game-data/load-game-data-from-files.ts`

**Owns:** Reading XML files from the filesystem and producing a `GameData` object using the existing parsers.

**Key decisions:**
- **Synchronous** — test setup is synchronous (`createSimulation()` is sync). Using `readFileSync` avoids async complexity in test harness.
- **Lives in `src/resources/game-data/`** next to the existing parsers, not in `tests/`. It's a legitimate utility for the game-data module ("load from files instead of HTTP"). Tests import it.
- **Reuses 100% of existing parsers** — `parseBuildingInfo`, `parseJobInfo`, `parseObjectInfo`, `parseBuildingTriggers`, `parseSettlerValues`. These all accept raw XML strings and return parsed structures. No changes needed.
- **Path resolution** — Accepts a base path, constructs full paths to each XML file. In tests, the caller passes the project-relative path `public/Siedler4/GameData` (resolved from project root).

**Implementation approach:**
```ts
import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';

export function loadGameDataFromFiles(basePath: string): GameData {
    const absPath = resolve(basePath);

    function readXml(filename: string): string | null {
        const filePath = resolve(absPath, filename);
        if (!existsSync(filePath)) return null;
        return readFileSync(filePath, 'utf-8');
    }

    const buildingXml = readXml('buildingInfo.xml');
    const jobXml = readXml('jobInfo.xml');
    // ... same for objectInfo.xml, BuildingTrigger.xml, SettlerValues.xml

    return {
        buildings: buildingXml ? parseBuildingInfo(buildingXml) : new Map(),
        jobs: jobXml ? parseJobInfo(jobXml) : new Map(),
        // ...
    };
}
```

---

### Subsystem 2: localStorage Guards

**Files:** `src/game/game-settings.ts`, `src/game/debug-stats.ts`

**Owns:** Making `localStorage` access safe in Node.js environments.

**Key decisions:**
- **`debugStats`** — The `DebugStats` singleton is instantiated at module load (`export const debugStats = new DebugStats()`). Its constructor calls `loadDebugSettings()` which accesses `localStorage.getItem()`. This is already wrapped in try/catch, so **it already works in Node.js** — the catch block returns defaults. **No change needed.**
- **`GameSettingsManager`** — Its `loadSettings()` function accesses `localStorage.getItem()`. Also already wrapped in try/catch. **Already safe.** However, the `setupAutoSave()` method uses Vue's `watch()` which calls `saveSettings()` → `localStorage.setItem()` on every change. This is also try/catch guarded. **No change needed.**

**Verification:** Both files already handle `localStorage` errors gracefully via try/catch with fallback to defaults. The headless simulation already uses `GameSettingsManager` successfully in Vitest today. **This subsystem requires no code changes** — only verification that the existing guards are sufficient.

---

### Subsystem 3: Test Simulation Upgrade

**Files:** `tests/unit/helpers/test-simulation.ts`, `tests/unit/helpers/test-game-data.ts`

**Owns:** Upgrading the simulation harness to use real XML game data when available.

**Key decisions:**
- **`installRealGameData()` added to `test-game-data.ts`** — Tries to load XML files from `public/Siedler4/GameData/`. Returns `true` if at least the core files (buildingInfo.xml, jobInfo.xml, SettlerValues.xml) exist and parse successfully. Falls back to `false`.
- **Path resolution** — Uses `process.cwd()` + `'public/Siedler4/GameData'`. Vitest runs from project root, so this resolves correctly.
- **`createSimulation()` unchanged** — It does not decide which data to use. The caller (test file) calls `installRealGameData()` or `installTestGameData()` before `createSimulation()`. This keeps the harness data-agnostic.
- **Existing `installTestGameData()` stays** — Lower-level unit tests that don't need real data continue using stubs.

**Implementation approach in test-game-data.ts:**
```ts
import { loadGameDataFromFiles } from '@/resources/game-data/load-game-data-from-files';
import { existsSync } from 'fs';
import { resolve } from 'path';

const GAME_DATA_DIR = resolve(process.cwd(), 'public/Siedler4/GameData');

export function installRealGameData(): boolean {
    if (!existsSync(resolve(GAME_DATA_DIR, 'buildingInfo.xml'))) return false;

    const data = loadGameDataFromFiles(GAME_DATA_DIR);
    GameDataLoader.getInstance().setData(data);
    return true;
}
```

---

### Subsystem 4: Economy Simulation Tests

**Files:** `tests/unit/integration/economy-simulation.spec.ts`

**Owns:** Rewriting economy simulation tests to use real game data and validate real production chains.

**Key decisions:**
- **Conditional execution** — Tests use `describe.skipIf(!hasRealData)` so CI environments without game assets skip gracefully rather than fail.
- **Same `Simulation` API** — Tests still call `sim.placeBuilding()`, `sim.plantTreesNear()`, `sim.runUntil()`, etc. The harness API doesn't change.
- **Real game data means real timing** — Production delays, worker search radii, and choreography durations come from XML. Tests use generous `maxTicks` bounds rather than exact timing assertions.
- **Observable outcomes only** — Tests assert on inventory counts, entity existence, and material flow. Not on internal state, animation frames, or tick counts.

**Test cases:**
1. **Woodcutter produces logs from nearby trees** — Place `ResidenceSmall` + `WoodcutterHut`, plant trees, run until `LOG >= 1`. Validates full choreography: unit spawns → finds tree → walks → chops → picks up log → returns → deposits.
2. **Carrier delivers logs from woodcutter to sawmill** — Place `WoodcutterHut` + `Sawmill`, run until sawmill receives `LOG >= 1`. Validates logistics: material request → carrier assignment → pickup → delivery.
3. **Woodcutter → sawmill chain produces boards** — Full pipeline: trees → logs → boards. Validates multi-building production chain.
4. **Multiple production cycles accumulate output** — Run until `LOG >= 3`. Validates that workers loop back to find new targets.
5. **Forester replants trees** — Place `ForesterHut` near cleared area, run, verify new trees appear.
6. **Stonecutter mines stone** — Place `StonecutterHut` near stones, run until `STONE >= 1`.

**Test structure:**
```ts
const hasRealData = installRealGameData();

describe.skipIf(!hasRealData)('Economy simulation (headless)', () => {
    let sim: Simulation;

    afterEach(() => {
        sim?.destroy();
        cleanupSimulation();
    });

    it('woodcutter produces logs from nearby trees', () => {
        sim = createSimulation();
        sim.placeBuilding(BuildingType.ResidenceSmall);
        const woodcutterId = sim.placeBuilding(BuildingType.WoodcutterHut);
        sim.plantTreesNear(woodcutterId, 3);
        sim.runUntil(() => sim.getOutput(woodcutterId, EMaterialType.LOG) >= 1, { maxTicks: 120 * 30 });
        expect(sim.getOutput(woodcutterId, EMaterialType.LOG)).toBeGreaterThanOrEqual(1);
    });

    // ... additional test cases
});
```

## File Map

### New Files

| File | Subsystem | Purpose |
|------|-----------|---------|
| `src/resources/game-data/load-game-data-from-files.ts` | 1 | Disk-based XML loader for Node.js |

### Modified Files

| File | Change |
|------|--------|
| `tests/unit/helpers/test-game-data.ts` | Add `installRealGameData()` function |
| `tests/unit/integration/economy-simulation.spec.ts` | Rewrite tests to use real game data, add new test cases |

## Open Questions

1. **Game asset availability in CI** — The XML files in `public/Siedler4/GameData/` may not be present in CI (they're game assets, possibly gitignored). The design uses `describe.skipIf(!hasRealData)` so tests skip gracefully. Should we also keep a parallel `describe` block with stub data for CI coverage?

2. **Test timeout bounds** — With real XML data, production delays and choreography timing may differ from stubs. The proposed `maxTicks` values (120×30 = 3600 ticks) are generous but may need tuning once real data is loaded. Should we expose a `sim.setGameSpeed()` or similar to accelerate simulation?

## Out of Scope

- **Modifying the `Game` class** — `Game` stays browser-only. Tests use `GameServices` directly, which IS the real game engine (minus renderer/audio/input chrome).
- **Modifying `GameLoop`** — The manual tick loop in `test-simulation.ts` is the correct approach for headless mode. No need to abstract `GameLoop` for Node.js.
- **Loading binary game assets** (GFX, LIB sprites) — Only XML data files are needed for game logic. Sprites are renderer-only.
- **Map file loading** — Tests use `createTestMap()` (synthetic flat terrain). Real `.map` file parsing is out of scope.
- **Headless renderer stubs** — No WebGL mocking. The simulation runs without any visual output.
