# Project Review — 2026-02-14

## Summary

Settlers.ts is a **well-architected, modular game engine** with clean separation of concerns, strong documentation, and battle-tested patterns. The codebase passes all 748 unit tests, 55/56 e2e tests (1 flaky test fixed), and has no linting errors. Most code follows the CLAUDE.md guidelines. Key issues found are: silent fallbacks with `?? 0` patterns that could hide bugs, optional chaining on required dependencies in several renderer/audio files, and a few fire-and-forget promises without proper error handling.

## Fixes Applied

1. **src/game/audio/sound-manager.ts:294,355** — Added missing radix parameter to `parseInt()` calls to prevent potential octal parsing issues with sound indices like "Snd:01"

2. **tests/e2e/game-logic.spec.ts:133** — Fixed flaky test "canvas handles click events without errors" by adding `force: true` to the click action, avoiding Playwright's wait for "scheduled navigations" which was timing out intermittently

3. **src/game/renderer/texture-map-16bit.ts:49,124** — Fixed typo: renamed property `buttom` to `bottom` (getter and its usage)

4. **tests/e2e/resource-placement.spec.ts:30** — Fixed flaky test "select mode button returns to select mode from resource placement" by adding `force: true` to click (same issue as #2)

5. **src/types/env.d.ts** — Added proper Window type declarations for HMR-safe singletons (`__settlers_sound_manager__`, `debugSound`)

6. **src/game/audio/sound-manager.ts:51-61** — Replaced `(window as any)` singleton access with typed `window.__settlers_sound_manager__`

7. **src/game/game.ts:97-102** — Added `.catch()` error handler to `soundManager.init()` promise to log initialization failures

8. **src/game/game.ts:24-28,37,105-111,233,252-254** — Created `IScriptService` interface and replaced `any` casts with proper typing for dynamically-loaded script service

9. **src/game/renderer/entity-renderer.ts:291-304** — Added `.catch()` error handler to `spriteManager.init()` promise; replaced `spriteManager?.` with `spriteManager!` since we're in the `if (this.spriteManager)` block

10. **src/game/renderer/sprite-render-manager.ts:505-507** — Upgraded IndexedDB cache save failure logging from debug to warn level

11. **src/game/scripting/script-service.ts:11,167-169** — Imported `ScriptEventType` and replaced `event as any` with proper typing

## Issues Found

### Critical

None found. The codebase is stable and functional.

### Recommended Refactors

#### 1. Optional Chaining on Required Dependencies (Medium Priority)

**Problem**: Several files use `?.` optional chaining on dependencies that should always exist after initialization, hiding potential bugs.

**Files affected**:
- `src/game/renderer/entity-renderer.ts` — Lines 264, 295, 368, 653, 754, 836, 907: `this.animationService?.`, `this.spriteManager?.`, `this.frameContext?.`
- `src/game/renderer/sprite-render-manager.ts` — Lines 217, 230, 237, 244, 254, 263, 270, 277, 298, 306, 314, 315, 327, 328, 349: Multiple `this._spriteRegistry?.` calls
- `src/game/input/use-input-manager.ts` — Lines 134, 139, 144, 151, 155, 159, 164, 170, 176: `manager.value?.` calls
- `src/game/scripting/script-service.ts` — Lines 161, 168: `this.scriptSystem?.`
- `src/game/audio/music-controller.ts` — Lines 61, 117, 219: `this.currentMusic?.`

**Target state**: Replace `this.dependency?.method()` with `this.dependency!.method()` for dependencies that must exist after initialization. Add clear `@throws` documentation for methods that can legitimately be called before initialization.

**Scope**: ~50 lines across 6 files. Low risk refactor.

---

#### 2. Silent Fallbacks That Could Hide Bugs (Medium Priority)

**Problem**: Many places use `?? 0`, `?? null`, or `|| 0` patterns that silently return default values instead of crashing when data is missing.

**Files affected**:
- `src/game/systems/settler-tasks/settler-task-system.ts` — Lines 226, 311, 451, 539, 767, 1083: `controller?.direction ?? 0`, `homeBuilding?.id ?? null`
- `src/game/animation/animation-service.ts` — Lines 105-106: `options.startFrame ?? 0`
- `src/game/input/modes/camera-mode.ts` — Lines 53, 60: `this.viewPoint?.x ?? 0`
- `src/game/renderer/optimized-depth-sorter.ts` — Line 124: `worldPos?.worldY ?? 0`
- `src/game/renderer/texture-map-16bit.ts` — Line 124: `this.slots[this.slots.length - 1]?.bottom ?? 0`
- `src/game/features/inventory/building-inventory.ts` — Lines 358, 369: `slot?.currentAmount ?? 0`

**Target state**: Audit each usage. For values that must exist (not nullable by design), replace with `!` assertion or `getEntityOrThrow`-style helpers with context. For legitimately optional values, keep `??` but add comments explaining why.

**Scope**: ~30 locations across 10 files. Medium risk — requires understanding each case.

### Minor

#### 1. Build Warning: Large Chunks
The production build produces chunks >500KB. Consider code-splitting the map-view module which is 471KB.

#### 2. Unused TODOs
~28 TODO comments exist in the scripting/AI API files. These are documented incomplete features, not bugs, but should be tracked in an issue tracker.

#### 3. Empty Catch Blocks
15 empty `catch {}` blocks exist. Most are acceptable (localStorage access, optional debug utils), but a few could benefit from comments explaining why the error is intentionally ignored.

## Observations

### Positive Patterns

1. **Strong architecture documentation** — `docs/SYSTEM_DESIGN_RULES.md`, `docs/feature-module-architecture.md`, and `docs/coding-guidelines.md` provide clear guidance

2. **Good test coverage** — 748 unit tests covering core game logic, 56 e2e tests for UI/integration

3. **Well-structured feature modules** — Features in `src/game/features/` are self-contained with clear public APIs

4. **Proper entity lookup** — No instances of `getEntity(id)!` found; the codebase uses `getEntityOrThrow(id, 'context')` correctly

5. **No security vulnerabilities** — No hardcoded secrets, no eval/innerHTML patterns, proper input validation at system boundaries

6. **Clean lint status** — ESLint passes with no errors

7. **Deterministic game logic** — Seeded RNG used throughout for reproducibility

8. **Good HMR handling** — Singletons stored on window survive hot module replacement

### Well-Tested Areas

- Pathfinding and movement systems (extensive unit tests)
- Building construction phases
- Inventory and carrier systems
- Command execution pipeline
- Entity creation/removal

### Code Quality Highlights

- Consistent naming conventions matching original game XML files
- Clear separation between game logic (systems) and rendering
- Event-driven architecture avoiding circular dependencies
- Fixed-timestep game loop with proper interpolation
